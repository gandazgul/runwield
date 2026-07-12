/**
 * @module shared/session
 * Shared helpers for loading agent definitions and running agent invocations.
 */

import {
    createAgentSession,
    createBashToolDefinition,
    createEditToolDefinition,
    createFindToolDefinition,
    createGrepToolDefinition,
    createLsToolDefinition,
    createReadToolDefinition,
    createWriteToolDefinition,
    DefaultResourceLoader,
    estimateTokens,
    SessionManager,
    shouldCompact,
} from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { createEditWithFallbackToolDefinition } from "../../tools/edit-with-fallback.js";
import { createRunWieldGrepToolDefinition } from "../../tools/grep.js";
import { extractYaml, test as hasFrontMatter } from "@std/front-matter";
import { dirname, join } from "@std/path";
import { AGENT_DEFS_DIR, AGENTS, CWD, HOME_DIR, PROMPT_TEMPLATES_DIR, SKILLS_DIR } from "../../constants.js";
import { emitHostedSessionRuntimeEvent, RuntimeEventTypes } from "./session-runtime-events.js";
import mnemosyneExtension, {
    memoryDeleteToolDef,
    memoryRecallGlobalToolDef,
    memoryRecallToolDef,
    memoryStoreGlobalToolDef,
    memoryStoreToolDef,
} from "../../extensions/mnemosyne/index.js";
import cymbalExtension, {
    codeBatchToolDef,
    codeImpactToolDef,
    codeImplsToolDef,
    codeImportersToolDef,
    codeInvestigateToolDef,
    codeOutlineToolDef,
    codeRefsToolDef,
    codeSearchToolDef,
    codeShowToolDef,
    codeStructureToolDef,
    codeTraceToolDef,
} from "../../extensions/cymbal/index.js";
import snipExtension from "../../extensions/snip/index.js";
import { ensureCymbalBinary, ensureMnemosyneBinary, hasSnipBinary } from "../runtime-preflight.js";
import { executeReturnToRouter, returnToRouterTool } from "../../tools/return-to-router.js";
import { createUserInterviewTool } from "../../tools/user-interview.js";
import { createSeeImageTool } from "../../tools/see-image.js";
import { discoverProviderModel, getModelRegistry } from "../models/model-registry.js";
import { parseProviderModel } from "../models/model-validation.js";
import { directoryExists, fileExists } from "../helpers.js";
import {
    _AGENT_ATTENTION_NUDGES,
    ATTENTION_NUDGE_TURN_INTERVAL,
    loadAgentDef,
    resolveAgentDefsDir as _resolveAgentDefsDir,
    resolveSessionToolNames,
} from "./agents.js";
import { getCustomSetting, getMergedCustomSetting, getSettingsDir, getSettingsManager } from "../settings.js";
import { modelSupportsImageInput, prepareImagesForModel, resolveVisionFallbackModel } from "./image-attachments.js";
import { recordActiveAgent } from "./active-agent-session.js";
import { getPackagePromptTemplatePaths, resolveInstalledPackagePromptResources } from "../package-resources.js";
import { getWldExtensionPaths, resolveInstalledWldExtensionResources } from "../extensions/wld-extension-manifest.js";
import { recordToolCallFinished, recordToolCallStarted, recordWorkflowMetric } from "../workflow/metrics.js";

const HOME_PROMPTS_DIR = HOME_DIR ? join(HOME_DIR, ".wld", "prompts") : null;
const HIDDEN_UI_TOOL_BLOCK_NAMES = new Set(["review_complete", "user_interview"]);

/** Regex to detect an HTML body in an error message (e.g. from a 404 page). */
const HTML_ERROR_RE = /^(.*?\b404\b.*?)(?:<!DOCTYPE|<html|<body)/i;
const UNSUPPORTED_TEMPERATURE_RE =
    /\bunsupported (?:parameter|field|argument)\b[^.:\n]*(?::|\b)\s*["']?temperature["']?|\btemperature\b[^.:\n]*\bunsupported\b/i;

/** @type {WeakMap<object, string>} */
const modelSelectionSourceByModel = new WeakMap();

/**
 * @param {unknown} hostedSession
 * @param {string} caller
 * @returns {import('./hosted-session.js').HostedSession}
 */
function requireHostedSession(hostedSession, caller) {
    if (!hostedSession || typeof hostedSession !== "object") {
        throw new Error(`${caller}: hostedSession is required`);
    }
    const candidate = /** @type {import('./hosted-session.js').HostedSession} */ (hostedSession);
    if (
        typeof candidate.getRootAgentSession !== "function" ||
        typeof candidate.setRootAgentSession !== "function" ||
        typeof candidate.getRootAgentName !== "function" ||
        typeof candidate.setRootAgentName !== "function"
    ) {
        throw new Error(`${caller}: hostedSession must be a HostedSession`);
    }
    return candidate;
}

/**
 * Replace 404 error messages that contain an HTML body with a clean generic
 * message so the user does not see a raw HTML dump.
 *
 * @param {string} msg
 * @returns {string}
 */
function sanitizeApiErrorMessage(msg) {
    const match = HTML_ERROR_RE.exec(msg);
    if (match) {
        const prefix = match[1].trim();
        return prefix.endsWith(" -") || prefix.endsWith(".")
            ? `${prefix.slice(0, -1)} — Model not found or endpoint unavailable`
            : `${prefix} — Model not found or endpoint unavailable`;
    }
    return msg;
}

/**
 * @param {string | undefined} debugLogPath
 * @param {string} text
 */
function appendDebugLog(debugLogPath, text) {
    const path = debugLogPath || join(Deno.cwd(), "debug.log");
    try {
        Deno.mkdirSync(dirname(path), { recursive: true });
        Deno.writeTextFileSync(path, text.endsWith("\n") ? text : `${text}\n`, { append: true });
    } catch (_e) {
        // Debug logging must never affect agent execution.
    }
}

/**
 * @param {string | undefined} debugLogPath
 * @returns {boolean}
 */
function shouldWriteDebugLog(debugLogPath) {
    return Boolean(debugLogPath) || Deno.env.get("DEBUG") === "1";
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function formatDebugJson(value) {
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

/**
 * Resolve the effective tool list for a session, applying runtime-only gates
 * that should not mutate the agent frontmatter source of truth.
 *
 * @param {string[]} agentTools
 * @param {unknown} toolNames
 * @param {string[]} customToolNames
 * @param {{ allowReturnToRouter?: boolean }} [options]
 * @returns {string[]}
 */
export function resolveEffectiveSessionToolNames(agentTools, toolNames, customToolNames, options = {}) {
    const resolvedTools = resolveSessionToolNames(agentTools, toolNames, customToolNames);
    const normalizedTools = resolvedTools.map((toolName) =>
        toolName === "multi_replace_file_content" ? "multi_file_edit" : toolName
    );
    const dedupedTools = [...new Set(normalizedTools)];
    return options.allowReturnToRouter === true
        ? dedupedTools
        : dedupedTools.filter((toolName) => toolName !== "return_to_router");
}

/** @typedef {"local" | "home" | "bundled" | "package"} PromptTemplateSource */

/** @type {Map<string, string | undefined>} */
const promptTemplateModelByName = new Map();

/**
 * @typedef {Object} PromptTemplateMeta
 * @property {string} name
 * @property {string} description
 * @property {string | undefined} argumentHint
 * @property {string | undefined} model
 * @property {string} path
 * @property {PromptTemplateSource} source
 * @property {string | undefined} [packageSource]
 * @property {string | undefined} [packageBaseDir]
 */

/**
 * Resolve prompt template search paths by priority: local > home > bundled.
 *
 * @param {string} [cwd]
 * @returns {string[]}
 */
export function getPromptTemplatePaths(cwd = CWD) {
    return [
        join(cwd, ".wld", "prompts"),
        ...(HOME_PROMPTS_DIR ? [HOME_PROMPTS_DIR] : []),
        PROMPT_TEMPLATES_DIR,
    ];
}

/**
 * Parse prompt-template markdown metadata.
 *
 * @param {string} filePath
 * @returns {Promise<{ description: string, argumentHint?: string, model?: string }>}
 */
async function parsePromptTemplateMeta(filePath) {
    const raw = await Deno.readTextFile(filePath);

    /** @type {{ description?: string, model?: string, [key: string]: unknown }} */
    let attrs = {};
    let body = raw;

    if (hasFrontMatter(raw)) {
        const parsed = extractYaml(raw);
        attrs = parsed.attrs;
        body = parsed.body;
    }

    const frontmatterDescription = typeof attrs.description === "string" ? attrs.description.trim() : "";
    const inferredDescription = body.split("\n").map((line) => line.trim()).find((line) => line.length > 0) || "";

    const argumentHint = typeof attrs["argument-hint"] === "string" && attrs["argument-hint"].trim()
        ? attrs["argument-hint"].trim()
        : undefined;

    const model = typeof attrs.model === "string" && attrs.model.trim() ? attrs.model.trim() : undefined;

    return {
        description: frontmatterDescription || inferredDescription,
        argumentHint,
        model,
    };
}

/**
 * List all known prompt templates across bundled + home + local layers.
 * First name wins, based on priority local > home > bundled.
 *
 * @param {{ cwd?: string, packagePromptResources?: import("../package-resources.js").ResolvedResource[] }} [options]
 * @returns {Promise<PromptTemplateMeta[]>}
 */
export async function listPromptTemplates(options = {}) {
    /** @type {PromptTemplateMeta[]} */
    const templates = [];
    promptTemplateModelByName.clear();
    const seen = new Set();
    const cwd = options.cwd || CWD;

    /** @type {Array<{dir: string, source: PromptTemplateSource}>} */
    const layers = [
        { dir: join(cwd, ".wld", "prompts"), source: "local" },
        ...(HOME_PROMPTS_DIR ? [{ dir: HOME_PROMPTS_DIR, source: /** @type {PromptTemplateSource} */ ("home") }] : []),
        { dir: PROMPT_TEMPLATES_DIR, source: "bundled" },
    ];

    for (const layer of layers) {
        if (!(await directoryExists(layer.dir))) continue;

        for await (const entry of Deno.readDir(layer.dir)) {
            if (!entry.isFile || !entry.name.endsWith(".md")) continue;
            const name = entry.name.replace(/\.md$/, "");
            if (seen.has(name)) continue;

            const filePath = join(layer.dir, entry.name);
            try {
                const meta = await parsePromptTemplateMeta(filePath);
                templates.push({
                    name,
                    description: meta.description,
                    argumentHint: meta.argumentHint,
                    model: meta.model,
                    path: filePath,
                    source: layer.source,
                });
                promptTemplateModelByName.set(name, meta.model);
                seen.add(name);
            } catch {
                // Ignore unreadable prompt templates.
            }
        }
    }

    const packagePromptResources = Array.isArray(options.packagePromptResources)
        ? options.packagePromptResources
        : await resolveInstalledPackagePromptResources().catch(() => []);

    for (const resource of packagePromptResources || []) {
        const name = resource.path.split(/[\\/]/).pop()?.replace(/\.md$/, "") || "";
        if (!name || seen.has(name)) continue;
        try {
            const meta = await parsePromptTemplateMeta(resource.path);
            templates.push({
                name,
                description: meta.description,
                argumentHint: meta.argumentHint,
                model: meta.model,
                path: resource.path,
                source: "package",
                packageSource: resource.metadata?.source,
                packageBaseDir: resource.metadata?.baseDir,
            });
            promptTemplateModelByName.set(name, meta.model);
            seen.add(name);
        } catch {
            // Ignore unreadable package prompt templates.
        }
    }

    return templates;
}

/**
 * @typedef {Object} SkillMeta
 * @property {string} name
 * @property {string} description
 * @property {string} path
 * @property {"local" | "home" | "bundled" | "external"} source
 * @property {boolean} [disableModelInvocation]
 */

const BUNDLED_SKILLS_CACHE_DIR = HOME_DIR ? join(HOME_DIR, ".wld", "bundled-skills") : null;
const BUNDLED_AGENT_DEFS_CACHE_DIR = HOME_DIR ? join(HOME_DIR, ".wld", "bundled-agent-definitions") : null;

/** @type {Promise<string | null> | null} */
let bundledSkillsExtractionPromise = null;

/** @type {Promise<string | null> | null} */
let bundledAgentDefsExtractionPromise = null;

/**
 * Recursively copy `srcDir` (which may live inside a Deno-compile virtual
 * filesystem) into `destDir` on the real filesystem, so external tools can
 * read the files via their absolute path.
 *
 * @param {string} srcDir
 * @param {string} destDir
 */
async function copyTreeFromBundle(srcDir, destDir) {
    await Deno.mkdir(destDir, { recursive: true });
    for await (const entry of Deno.readDir(srcDir)) {
        const srcPath = join(srcDir, entry.name);
        const destPath = join(destDir, entry.name);
        if (entry.isDirectory) {
            await copyTreeFromBundle(srcPath, destPath);
        } else if (entry.isFile) {
            const bytes = await Deno.readFile(srcPath);
            await Deno.writeFile(destPath, bytes);
        }
    }
}

/**
 * Extract bundled skills (compiled into the binary) to a real on-disk cache so
 * external read tools can access them. Runs at most once per process.
 *
 * @returns {Promise<string | null>} Real path to extracted skills, or null if unavailable.
 */
export function extractBundledSkills() {
    if (bundledSkillsExtractionPromise) return bundledSkillsExtractionPromise;
    bundledSkillsExtractionPromise = (async () => {
        if (!BUNDLED_SKILLS_CACHE_DIR) return null;
        if (!(await directoryExists(SKILLS_DIR))) return null;
        try {
            await Deno.remove(BUNDLED_SKILLS_CACHE_DIR, { recursive: true });
        } catch {
            // Cache dir may not exist yet — fine.
        }
        try {
            await copyTreeFromBundle(SKILLS_DIR, BUNDLED_SKILLS_CACHE_DIR);
            return BUNDLED_SKILLS_CACHE_DIR;
        } catch {
            return null;
        }
    })();
    return bundledSkillsExtractionPromise;
}

/**
 * Extract bundled agent definitions (compiled into the binary) to a real
 * on-disk cache so external read tools can access them. Runs at most once
 * per process. Mirrors the bundled-skills extraction pattern.
 *
 * @returns {Promise<string | null>} Real path to extracted agent defs, or null if unavailable.
 */
export function extractBundledAgentDefs() {
    if (bundledAgentDefsExtractionPromise) return bundledAgentDefsExtractionPromise;
    bundledAgentDefsExtractionPromise = (async () => {
        if (!BUNDLED_AGENT_DEFS_CACHE_DIR) return null;
        if (!(await directoryExists(AGENT_DEFS_DIR))) return null;
        try {
            await Deno.remove(BUNDLED_AGENT_DEFS_CACHE_DIR, { recursive: true });
        } catch {
            // Cache dir may not exist yet — fine.
        }
        try {
            await copyTreeFromBundle(AGENT_DEFS_DIR, BUNDLED_AGENT_DEFS_CACHE_DIR);
            return BUNDLED_AGENT_DEFS_CACHE_DIR;
        } catch {
            return null;
        }
    })();
    return bundledAgentDefsExtractionPromise;
}

/**
 * Resolve the runtime-readable bundled agent definitions directory.
 * Returns the extracted cache path when available (compiled binary or first-run),
 * falling back to the bundled source directory.
 *
 * @returns {Promise<string>} Absolute path to the agent-defs root.
 */
export function getBundledAgentDefsPath() {
    return getBundledAgentDefsPathInner();
}

/** @type {Promise<string> | null} */
let bundledAgentDefsPathPromise = null;

function getBundledAgentDefsPathInner() {
    if (bundledAgentDefsPathPromise) return bundledAgentDefsPathPromise;
    bundledAgentDefsPathPromise = extractBundledAgentDefs().then((extracted) => extracted ?? AGENT_DEFS_DIR);
    return bundledAgentDefsPathPromise;
}

/**
 * Resolve a bundled agent-definition asset to a real readable path. In compiled
 * binaries, the extraction cache can be stale or missing a newly-added nested
 * asset, so this heals the cache from the bundled virtual filesystem when
 * possible instead of letting downstream prompt loads hard-crash.
 *
 * @param {string} relativePath - Path relative to `src/agent-definitions`.
 * @returns {Promise<string>}
 */
export async function ensureBundledAgentDefFile(relativePath) {
    const bundledDir = await getBundledAgentDefsPath();
    const targetPath = join(bundledDir, relativePath);
    if (await fileExists(targetPath)) return targetPath;

    const sourcePath = join(AGENT_DEFS_DIR, relativePath);
    try {
        const bytes = await Deno.readFile(sourcePath);
        await Deno.mkdir(dirname(targetPath), { recursive: true });
        await Deno.writeFile(targetPath, bytes);
        return targetPath;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Bundled agent asset is missing: ${relativePath}. ${message}`);
    }
}

/**
 * List all known skills across bundled + home + local layers.
 * First name wins, based on priority local > home > bundled.
 *
 * @param {{ cwd?: string }} [options]
 * @returns {Promise<SkillMeta[]>}
 */
export async function listSkills(options = {}) {
    const skills = [];
    const seen = new Set();

    const bundledDir = (await extractBundledSkills()) ?? SKILLS_DIR;

    const enableExternalSkills = getCustomSetting("enableExternalSkills", "global") ?? true;

    const layers = [
        {
            dir: join(options.cwd || CWD, ".wld", "skills"),
            source: /** @type {"local" | "home" | "bundled" | "external"} */ ("local"),
        },
        ...(HOME_DIR
            ? [{
                dir: join(HOME_DIR, ".wld", "skills"),
                source: /** @type {"local" | "home" | "bundled" | "external"} */ ("home"),
            }]
            : []),
        { dir: bundledDir, source: /** @type {"local" | "home" | "bundled" | "external"} */ ("bundled") },
        // ── External (Pi-compatible / marketplace) skills ──
        ...(enableExternalSkills && HOME_DIR
            ? [{
                dir: join(HOME_DIR, ".agents", "skills"),
                source: /** @type {"local" | "home" | "bundled" | "external"} */ ("external"),
            }]
            : []),
    ];

    for (const layer of layers) {
        if (!(await directoryExists(layer.dir))) continue;

        for await (const entry of Deno.readDir(layer.dir)) {
            if (!entry.isDirectory) continue;

            const skillName = entry.name;
            if (seen.has(skillName)) continue;

            const skillMdPath = join(layer.dir, entry.name, "SKILL.md");
            if (!(await fileExists(skillMdPath))) continue;

            try {
                const raw = await Deno.readTextFile(skillMdPath);
                /** @type {{ name?: string, description?: string, [key: string]: unknown }} */
                let attrs = {};
                if (hasFrontMatter(raw)) {
                    attrs = extractYaml(raw).attrs;
                }

                const name = typeof attrs.name === "string" ? attrs.name.trim() : skillName;
                const description = typeof attrs.description === "string"
                    ? attrs.description.trim()
                    : "No description provided";
                const rawDisabled = attrs["disable-model-invocation"];
                const disableModelInvocation = rawDisabled === true || rawDisabled === "true";

                skills.push({
                    name,
                    description,
                    path: skillMdPath,
                    source: layer.source,
                    disableModelInvocation,
                });
                seen.add(skillName);
            } catch {
                // Ignore unreadable skills.
            }
        }
    }

    return skills;
}

/**
 * @param {string} homeDir
 * @param {{ includeExternal?: boolean }} [options]
 * @returns {string[]}
 */
export function getGlobalAgentMdPaths(homeDir, options = {}) {
    if (!homeDir) return [];
    const includeExternal = options.includeExternal ??
        (getCustomSetting("enableExternalGlobalAgentsMd", "global") ?? true);
    return [
        join(homeDir, ".wld", "RUNWEILD.md"),
        join(homeDir, ".wld", "AGENTS.md"),
        ...(includeExternal ? [join(homeDir, ".agents", "AGENTS.md")] : []),
    ];
}

/**
 * @param {string} homeDir
 * @param {{ includeExternal?: boolean }} [options]
 * @returns {Promise<string>}
 */
export async function readGlobalAgentMd(homeDir, options = {}) {
    for (const path of getGlobalAgentMdPaths(homeDir, options)) {
        try {
            return await Deno.readTextFile(path);
        } catch {
            // Try next candidate.
        }
    }
    return "";
}

/**
 * Report which instruction files exist in the locations
 * `assembleFinalSystemPrompt` reads from. Used by the boot banner to show
 * the user what context was actually injected into the system prompt.
 *
 * @param {string} [cwd]
 * @returns {Promise<{ path: string, source: "home" | "external" | "local" }[]>}
 */
export async function listLoadedAgentMdFiles(cwd = CWD) {
    /** @type {{ path: string, source: "home" | "external" | "local" }[]} */
    const results = [];

    for (const homePath of getGlobalAgentMdPaths(HOME_DIR)) {
        if (await fileExists(homePath)) {
            const source = homePath === join(HOME_DIR, ".agents", "AGENTS.md")
                ? /** @type {"external"} */ ("external")
                : /** @type {"home"} */ ("home");
            results.push({ path: homePath, source });
            break;
        }
    }

    for (const projectPath of [join(cwd, "RUNWEILD.md"), join(cwd, "AGENTS.md")]) {
        if (await fileExists(projectPath)) {
            results.push({ path: projectPath, source: "local" });
            break;
        }
    }

    return results;
}

/**
 * Stop all currently active agent sessions — root (only while streaming) plus
 * any transient sub-agents. The root AgentSession lives for the entire chat,
 * so its mere existence does NOT mean a run is in flight; gate on isStreaming
 * to avoid reporting "Agent run canceled" when the user presses Esc at idle.
 *
 * @param {import('./hosted-session.js').HostedSession} [hostedSession]
 * @returns {boolean} true when at least one active session was aborted
 */
export function abortActiveSession(hostedSession) {
    const targetHostedSession = requireHostedSession(hostedSession, "abortActiveSession");
    let aborted = false;
    const root = /** @type {any} */ (targetHostedSession.getRootAgentSession());
    if (root && root.isStreaming) {
        try {
            root.abort();
        } catch (_e) { /* ignore */ }
        aborted = true;
    }
    // Clear any stale steering/follow-up messages from the agent's queue
    if (root) {
        try {
            root.clearQueue();
        } catch (_e) { /* ignore */ }
    }
    for (const subSession of targetHostedSession.getSubAgentSessions()) {
        const sub = /** @type {any} */ (subSession);
        try {
            sub.abort();
        } catch (_e) { /* ignore */ }
        aborted = true;
    }
    return aborted;
}

/**
 * Steer the root (user-facing) session with a message injected between tool calls.
 * Sub-agent sessions spawned by tools are intentionally excluded.
 *
 * @param {import('./hosted-session.js').HostedSession | string} hostedSession
 * @param {string | import('./types.js').ImageAttachment[]} [text]
 * @param {import('./types.js').ImageAttachment[]} [images]
 * @returns {Promise<boolean>} true when the root session was steered
 */
export async function steerRootSession(hostedSession, text, images) {
    return Boolean(await steerRootSessionWithTarget(hostedSession, text, images));
}

/**
 * Steer the root session and return the exact AgentSession that accepted the
 * message, so UI callers can track queue consumption on the right session.
 *
 * @param {import('./hosted-session.js').HostedSession | string} hostedSession
 * @param {string | import('./types.js').ImageAttachment[]} [text]
 * @param {import('./types.js').ImageAttachment[]} [images]
 * @returns {Promise<import('@earendil-works/pi-coding-agent').AgentSession | null>}
 */
export async function steerRootSessionWithTarget(hostedSession, text, images) {
    const targetHostedSession = requireHostedSession(hostedSession, "steerRootSessionWithTarget");
    const session = /** @type {any} */ (targetHostedSession.getRootAgentSession());
    if (!session) return null;
    // If the session is not actively streaming, queuing a steering message
    // on the agent would be lost — the agent loop has already exited.
    // Return null so the caller queues it for the next submission instead.
    if (!session.isStreaming) return null;
    const activeModel = session.model || { input: ["text", "image"] };
    const fallback = images && images.length > 0 && session.model && !modelSupportsImageInput(session.model)
        ? await resolveVisionFallbackModel(session.modelRegistry)
        : undefined;
    const preparedImages = prepareImagesForModel({
        text: /** @type {string} */ (text),
        images,
        activeModel,
        fallbackModelRef: fallback?.modelRef,
    });
    if (!preparedImages.ok) throw new Error(preparedImages.message);
    await session.steer(
        preparedImages.text,
        preparedImages.images && preparedImages.images.length > 0 ? preparedImages.images : undefined,
    );
    return session;
}

/**
 * Get the configured model override for an agent from merged (global + project) settings.
 *
 * Resolution order:
 * 1. If `activeModelPreset` is set and names a preset in `modelPresets`,
 *    and that preset has an `agents.<agentName>.model` entry, use that.
 * 2. Otherwise, fall back to `agents.<agentName>.model` from base config.
 *
 * @param {string} agentName
 * @returns {string | undefined}
 */
export function getConfiguredAgentModel(agentName, projectRoot = CWD) {
    const agents = /** @type {Record<string, { model?: string }> | undefined} */ (
        getMergedCustomSetting("agents", projectRoot)
    );

    // Check active preset first
    const activeModelPreset = /** @type {string | undefined} */ (
        getMergedCustomSetting("activeModelPreset", projectRoot)
    );
    if (activeModelPreset) {
        const modelPresets =
            /** @type {Record<string, { agents?: Record<string, { model?: string }> }> | undefined} */ (
                getMergedCustomSetting("modelPresets", projectRoot)
            );
        const preset = modelPresets?.[activeModelPreset];
        const presetModel = preset?.agents?.[agentName]?.model;
        if (presetModel) return presetModel;
    }

    // Fall back to base agents config
    return agents?.[agentName]?.model;
}

/**
 * Get the configured thinking level override for an agent from merged (global + project) settings.
 *
 * Resolution order:
 * 1. If `activeModelPreset` is set and names a preset in `modelPresets`,
 *    and that preset has an `agents.<agentName>.thinkingLevel` entry, use that.
 * 2. Otherwise, fall back to `agents.<agentName>.thinkingLevel` from base config.
 *
 * @param {string} agentName
 * @returns {string | undefined}
 */
export function getConfiguredAgentThinkingLevel(agentName, projectRoot = CWD) {
    const agents = /** @type {Record<string, { thinkingLevel?: string }> | undefined} */ (
        getMergedCustomSetting("agents", projectRoot)
    );

    // Check active preset first
    const activeModelPreset = /** @type {string | undefined} */ (
        getMergedCustomSetting("activeModelPreset", projectRoot)
    );
    if (activeModelPreset) {
        const modelPresets =
            /** @type {Record<string, { agents?: Record<string, { thinkingLevel?: string }> }> | undefined} */ (
                getMergedCustomSetting("modelPresets", projectRoot)
            );
        const preset = modelPresets?.[activeModelPreset];
        const presetLevel = preset?.agents?.[agentName]?.thinkingLevel;
        if (presetLevel) return presetLevel;
    }

    // Fall back to base agents config
    return agents?.[agentName]?.thinkingLevel;
}

/**
 * @param {unknown} value
 * @returns {number | undefined}
 */
export function normalizeAgentTemperature(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
    if (value < 0 || value > 2) return undefined;
    return value;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function getErrorMessage(value) {
    if (value instanceof Error) return value.message;
    if (value && typeof value === "object" && "errorMessage" in value) {
        return String(/** @type {{ errorMessage?: unknown }} */ (value).errorMessage ?? "");
    }
    return String(value ?? "");
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isUnsupportedTemperatureError(error) {
    return UNSUPPORTED_TEMPERATURE_RE.test(getErrorMessage(error));
}

/**
 * Some provider/model APIs reject `temperature` even though pi-ai exposes it as
 * a generic stream option. Retry once without temperature when the provider
 * reports that exact incompatibility before emitting assistant content.
 *
 * @param {import('@earendil-works/pi-ai').AssistantMessageEventStream | Promise<import('@earendil-works/pi-ai').AssistantMessageEventStream>} firstSource
 * @param {() => import('@earendil-works/pi-ai').AssistantMessageEventStream | Promise<import('@earendil-works/pi-ai').AssistantMessageEventStream>} retryWithoutTemperature
 * @returns {import('@earendil-works/pi-ai').AssistantMessageEventStream}
 */
function createTemperatureFallbackStream(firstSource, retryWithoutTemperature) {
    const output = createAssistantMessageEventStream();

    /**
     * @param {import('@earendil-works/pi-ai').AssistantMessageEventStream | Promise<import('@earendil-works/pi-ai').AssistantMessageEventStream>} sourcePromise
     * @param {boolean} canRetry
     * @returns {Promise<"retry" | "done">}
     */
    async function forward(sourcePromise, canRetry) {
        const source = await sourcePromise;
        let emittedAssistantContent = false;
        for await (const event of source) {
            if (
                event.type === "error" &&
                !emittedAssistantContent &&
                canRetry &&
                isUnsupportedTemperatureError(event.error)
            ) {
                return "retry";
            }
            if (event.type !== "error" && event.type !== "done") {
                emittedAssistantContent = true;
            }
            output.push(event);
        }
        return "done";
    }

    (async () => {
        const result = await forward(firstSource, true);
        if (result === "retry") {
            await forward(retryWithoutTemperature(), false);
        }
        output.end();
    })();

    return output;
}

/**
 * @param {object | undefined} options
 * @returns {object | undefined}
 */
function omitTemperatureOption(options) {
    if (!options) return undefined;
    const { temperature: _temperature, ...withoutTemperature } =
        /** @type {{ temperature?: unknown, [key: string]: unknown }} */ (options);
    return withoutTemperature;
}

/**
 * Get the configured temperature override for an agent from merged (global + project) settings.
 *
 * Resolution order:
 * 1. If `activeModelPreset` is set and names a preset in `modelPresets`,
 *    and that preset has an `agents.<agentName>.temperature` entry, use that.
 * 2. Otherwise, fall back to `agents.<agentName>.temperature` from base config.
 *
 * @param {string} agentName
 * @returns {number | undefined}
 */
export function getConfiguredAgentTemperature(agentName, projectRoot = CWD) {
    const agents = /** @type {Record<string, { temperature?: unknown }> | undefined} */ (
        getMergedCustomSetting("agents", projectRoot)
    );

    const activeModelPreset = /** @type {string | undefined} */ (
        getMergedCustomSetting("activeModelPreset", projectRoot)
    );
    if (activeModelPreset) {
        const modelPresets =
            /** @type {Record<string, { agents?: Record<string, { temperature?: unknown }> }> | undefined} */ (
                getMergedCustomSetting("modelPresets", projectRoot)
            );
        const preset = modelPresets?.[activeModelPreset];
        const presetTemperature = normalizeAgentTemperature(preset?.agents?.[agentName]?.temperature);
        if (presetTemperature !== undefined) return presetTemperature;
    }

    return normalizeAgentTemperature(agents?.[agentName]?.temperature);
}

/**
 * Apply an agent-level temperature as the default for provider requests in a session.
 *
 * @param {import('@earendil-works/pi-coding-agent').AgentSession} session
 * @param {number | undefined} temperature
 */
export function applySessionTemperature(session, temperature) {
    if (temperature === undefined) return;
    const originalStreamFn = session.agent.streamFn;
    session.agent.streamFn = (model, context, options) => {
        const optionsWithTemperature = {
            ...options,
            temperature,
        };
        try {
            const firstSource = originalStreamFn(model, context, optionsWithTemperature);
            return createTemperatureFallbackStream(
                firstSource,
                () => originalStreamFn(model, context, omitTemperatureOption(options)),
            );
        } catch (error) {
            if (isUnsupportedTemperatureError(error)) {
                return originalStreamFn(model, context, omitTemperatureOption(options));
            }
            throw error;
        }
    };
}

/**
 * Resolve the model to use for an agent invocation, based on the following priority:
 * 1) Active model state from a manual /model switch
 * 2) Invocation-specific model override (for example, prompt-template frontmatter)
 * 3) Configured per-agent model from settings (agents / modelPresets)
 * 4) Default model from settings
 * 5) Agent definition model from layered frontmatter
 *
 * @param {string | undefined} modelOverride
 * @param {import('./types.js').AgentDefinition} agentDef
 * @param {string} [agentName] - Used to look up settings-based model override.
 * @param {ReturnType<typeof getModelRegistry>} [modelRegistry]
 * @param {import('./hosted-session.js').HostedSession} [hostedSession]
 *
 * @returns {Promise<any>}
 */
async function resolveModel(
    modelOverride,
    agentDef,
    agentName,
    modelRegistry = getModelRegistry(),
    hostedSession = undefined,
) {
    let resolvedModel = null;
    const projectRoot = hostedSession?.cwd || CWD;
    /** @param {Parameters<typeof recordWorkflowMetric>[0]} metric */
    function recordModelMetric(metric) {
        return recordWorkflowMetric(metric, { cwd: projectRoot });
    }

    /** @type {Array<{ model: string, source: string, strict: boolean }>} */
    const candidateModels = [];

    // Only use the active model if the user explicitly selected it via /model.
    // After agent switches, clearUserModelOverride() clears the flag but the
    // activeModel may still hold the previous agent's model — we must skip it.
    const activeModelState = hostedSession?.getActiveModelState?.() || { model: "", provider: "" };
    if (activeModelState.model && hostedSession?.isUserModelOverride?.()) {
        candidateModels.push({
            model: activeModelState.provider
                ? `${activeModelState.provider}/${activeModelState.model}`
                : activeModelState.model,
            source: "manual /model override",
            strict: true,
        });
    }

    if (modelOverride) {
        candidateModels.push({ model: modelOverride, source: "invocation model override", strict: true });
    }

    // Config-driven per-agent model override (agents.<name>.model or active preset)
    if (agentName) {
        const configuredModel = getConfiguredAgentModel(agentName, hostedSession?.cwd || CWD);
        if (configuredModel) {
            candidateModels.push({
                model: configuredModel,
                source: `settings model for agent "${agentName}"`,
                strict: true,
            });
        }
    }

    // Settings default is still a settings value, so it wins over layered agent definitions.
    const settingsManager = getSettingsManager(hostedSession?.cwd || CWD);
    const defaultModelId = settingsManager.getDefaultModel();
    const defaultProvider = settingsManager.getDefaultProvider();
    if (defaultModelId) {
        candidateModels.push({
            model: defaultProvider ? `${defaultProvider}/${defaultModelId}` : defaultModelId,
            source: "settings default model",
            strict: true,
        });
    }

    if (agentDef.model) {
        candidateModels.push({
            model: agentDef.model,
            source: `agent definition model for "${agentDef.displayName || agentName || agentDef.name}"`,
            strict: false,
        });
    }

    for (const candidate of candidateModels) {
        const parsed = parseProviderModel(candidate.model);
        if (!parsed.ok) {
            await recordModelMetric({
                category: "model_selection",
                event: "candidate_evaluated",
                agentName,
                details: {
                    source: candidate.source,
                    strict: candidate.strict,
                    parsed: false,
                    selected: false,
                    failedReason: "invalid_candidate",
                },
            });
            if (candidate.strict) {
                await recordModelMetric({
                    category: "model_selection",
                    event: "selection_failed",
                    agentName,
                    details: { reason: "invalid_candidate", source: candidate.source },
                });
                throw new Error(`Invalid ${candidate.source}: ${candidate.model}. Use provider/id.`);
            }
            continue;
        }

        let found = modelRegistry.find(parsed.provider, parsed.id);
        let discovered = false;
        if (!found) {
            try {
                found = await discoverProviderModel(modelRegistry, parsed.provider, parsed.id);
                discovered = Boolean(found);
            } catch (error) {
                await recordModelMetric({
                    category: "model_selection",
                    event: "candidate_evaluated",
                    agentName,
                    details: {
                        source: candidate.source,
                        strict: candidate.strict,
                        parsed: true,
                        found: false,
                        discovered: false,
                        selected: false,
                        failedReason: "discovery_error",
                    },
                });
                if (candidate.strict) {
                    const message = error instanceof Error ? error.message : String(error);
                    await recordModelMetric({
                        category: "model_selection",
                        event: "selection_failed",
                        agentName,
                        details: { reason: "unknown_candidate", source: candidate.source, parsed: true },
                    });
                    throw new Error(`Unknown ${candidate.source}: ${candidate.model}. ${message}`);
                }
            }
        }

        if (!found) {
            await recordModelMetric({
                category: "model_selection",
                event: "candidate_evaluated",
                agentName,
                details: {
                    source: candidate.source,
                    strict: candidate.strict,
                    parsed: true,
                    found: false,
                    discovered: false,
                    selected: false,
                    failedReason: "unknown_candidate",
                },
            });
            if (candidate.strict) {
                await recordModelMetric({
                    category: "model_selection",
                    event: "selection_failed",
                    agentName,
                    details: { reason: "unknown_candidate", source: candidate.source, parsed: true },
                });
                throw new Error(`Unknown ${candidate.source}: ${candidate.model}`);
            }
            continue;
        }

        if (!modelRegistry.hasConfiguredAuth(found)) {
            await recordModelMetric({
                category: "model_selection",
                event: "candidate_evaluated",
                agentName,
                details: {
                    source: candidate.source,
                    strict: candidate.strict,
                    provider: found.provider,
                    model: found.id,
                    parsed: true,
                    found: true,
                    discovered,
                    authConfigured: false,
                    selected: false,
                    failedReason: "missing_auth",
                },
            });
            if (candidate.strict) {
                await recordModelMetric({
                    category: "model_selection",
                    event: "selection_failed",
                    agentName,
                    details: {
                        reason: "missing_auth",
                        source: candidate.source,
                        provider: found.provider,
                        model: found.id,
                    },
                });
                throw new Error(`No API key configured for ${candidate.source}: ${found.provider}/${found.id}`);
            }
            continue;
        }

        await recordModelMetric({
            category: "model_selection",
            event: "candidate_evaluated",
            agentName,
            details: {
                source: candidate.source,
                strict: candidate.strict,
                provider: found.provider,
                model: found.id,
                parsed: true,
                found: true,
                discovered,
                authConfigured: true,
                selected: true,
            },
        });
        await recordModelMetric({
            category: "model_selection",
            event: "selection_resolved",
            agentName,
            details: {
                source: candidate.source,
                provider: found.provider,
                model: found.id,
                discovered,
            },
        });
        if (found && typeof found === "object") modelSelectionSourceByModel.set(found, candidate.source);
        resolvedModel = found;
        break;
    }

    if (resolvedModel) return resolvedModel;

    await recordModelMetric({
        category: "model_selection",
        event: "selection_failed",
        agentName,
        details: { reason: "no_configured_model", candidateCount: candidateModels.length },
    });
    throw new Error(
        `No configured model found${agentName ? ` for agent "${agentName}"` : ""}. Select one with /model, ` +
            "or configure activeModelPreset/modelPresets, agents.<agent>.model, defaultProvider/defaultModel, " +
            "or an agent definition model.",
    );
}

/**
 * Assemble the final system prompt by resolving placeholders.
 *
 * @param {import('./types.js').AgentDefinition} agentDef
 * @param {string[]} tools
 * @param {import('@earendil-works/pi-coding-agent').ToolDefinition[]} finalCustomTools
 * @param {string} [cwd]
 * @param {string} [projectStateContext]
 * @returns {Promise<string>}
 */
export async function assembleFinalSystemPrompt(
    agentDef,
    tools,
    finalCustomTools,
    cwd = CWD,
    projectStateContext = "",
) {
    const piTools = [
        createBashToolDefinition(cwd),
        createGrepToolDefinition(cwd),
        createFindToolDefinition(cwd),
        createLsToolDefinition(cwd),
        createReadToolDefinition(cwd),
        createWriteToolDefinition(cwd),
        createEditToolDefinition(cwd),
    ];

    const extensionTools = [
        memoryRecallToolDef,
        memoryRecallGlobalToolDef,
        memoryStoreToolDef,
        memoryStoreGlobalToolDef,
        memoryDeleteToolDef,
        codeSearchToolDef,
        codeShowToolDef,
        codeOutlineToolDef,
        codeBatchToolDef,
        codeRefsToolDef,
        codeImpactToolDef,
        codeTraceToolDef,
        codeInvestigateToolDef,
        codeStructureToolDef,
        codeImplsToolDef,
        codeImportersToolDef,
    ];

    let finalSystemPrompt = agentDef.systemPrompt;

    const customToolMap = new Map();
    // 1. Add pi-coding-agent built-in tools.
    for (const tool of piTools) {
        customToolMap.set(tool.name, tool.promptSnippet || tool.description);
    }
    // 2. Add extension tool descriptions.
    for (const tool of extensionTools) {
        customToolMap.set(tool.name, tool.promptSnippet || tool.description);
    }
    // 3. Add custom tools last so runtime overrides are reflected in the prompt.
    for (const tool of finalCustomTools) {
        customToolMap.set(tool.name, tool.promptSnippet || tool.description);
    }

    const availableToolsStr = tools.map((t) => {
        const desc = customToolMap.get(t) || "Built-in tool";
        return `- ${t} - ${desc}`;
    }).join("\n");
    finalSystemPrompt = finalSystemPrompt?.replace("{{AVAILABLE_TOOLS}}", availableToolsStr);

    let globalAgentsMd = "";
    const homeDir = Deno.env.get("HOME") || "";
    if (homeDir) {
        globalAgentsMd = await readGlobalAgentMd(homeDir);
    }
    finalSystemPrompt = finalSystemPrompt.replace("{{GLOBAL_AGENTSMD}}", globalAgentsMd);

    let projectAgentsMd = "";
    for (const projectPath of [join(cwd, "RUNWEILD.md"), join(cwd, "AGENTS.md")]) {
        try {
            projectAgentsMd = await Deno.readTextFile(projectPath);
            break;
        } catch {
            projectAgentsMd = "";
        }
    }
    finalSystemPrompt = finalSystemPrompt.replace("{{PROJECT_AGENTSMD}}", projectAgentsMd);

    const projectStateContextSection = projectStateContext
        ? ["### Project State", "", projectStateContext, ""].join("\n")
        : "";
    finalSystemPrompt = finalSystemPrompt.replace("{{PROJECT_STATE_CONTEXT}}", projectStateContextSection);

    let memories = "";
    try {
        const command = new Deno.Command("mnemosyne", {
            args: ["list", "-t", "core", "-f", "plain"],
            cwd,
            stdout: "piped",
            stderr: "piped",
        });
        const output = await command.output();
        if (output.success) {
            memories = new TextDecoder().decode(output.stdout).trim();
            if (memories.startsWith("No documents") || memories.startsWith("Error:")) memories = "";
        }
    } catch {
        memories = "";
    }
    finalSystemPrompt = finalSystemPrompt.replace("{{MEMORIES}}", memories);

    let skillsBlock = "";
    try {
        const skills = await listSkills({ cwd });
        skillsBlock = skills
            .filter((skill) => skill.name && skill.description && !skill.disableModelInvocation)
            .map((skill) => `- ${skill.name} - ${skill.description} (read: ${skill.path})`)
            .join("\n");
    } catch {
        skillsBlock = "";
    }
    finalSystemPrompt = finalSystemPrompt.replace("{{SKILLS}}", skillsBlock);

    // Conditionally include the Image Attachments section only when see_image is available
    // (i.e. the active model is text-only with a vision fallback configured).
    const imageAttachmentsSection = tools.includes("see_image")
        ? [
            "## Image Attachments",
            "",
            "When the user pastes an image and your current model cannot receive images directly, the image is stored as a session",
            "artifact and a text marker is placed in the conversation instead:",
            "",
            "```",
            "[Image attached: attachment:<uuid> <mimeType>]",
            "```",
            "",
            "If `see_image` is listed in your available tools, use it to inspect these markers. Call `see_image` with",
            '`imageRef: "attachment:<uuid>"` (the full reference from the marker) to get a textual description of the image from the',
            "configured vision fallback model. You can also pass an optional `question` parameter to ask about a specific aspect of",
            "the image.",
        ].join("\n")
        : "";

    finalSystemPrompt = finalSystemPrompt.replace("{{IMAGE_ATTACHMENTS_SECTION}}", imageAttachmentsSection);

    // Resolve the bundled agent definitions path (extracted cache or fallback)
    const bundledAgentDefsPath = await getBundledAgentDefsPath();
    finalSystemPrompt = finalSystemPrompt.replace("{{BUNDLED_AGENT_DEFS_DIR}}", bundledAgentDefsPath);

    // Append timezone so LLMs can reconcile the midnight boundary between the
    // local date (pi-coding-agent's "Current date: YYYY-MM-DD") and UTC timestamps
    // in session data and memories. No duplicated date line — pi-coding-agent's
    // buildSystemPrompt already appends that after this function returns.
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    finalSystemPrompt += `\nTimezone: ${tz}`;

    return finalSystemPrompt;
}

/**
 * Build a configured AgentSession for the given agent without running a prompt.
 *
 * Used by:
 *  - runRootTurn's initial root construction (via ensureRootAgentSession in chat-session)
 *  - runAgentSession's transient sub-agent path
 *
 * @param {Object} opts
 * @param {import('./hosted-session.js').HostedSession} [opts.hostedSession]
 * @param {string} opts.agentName
 * @param {string[]} [opts.toolNames]
 * @param {import('@earendil-works/pi-coding-agent').ToolDefinition[]} [opts.customTools]
 * @param {string} [opts.modelOverride]
 * @param {import('../workflow/workflow.js').UiAPI} [opts.uiAPI]
 * @param {import('@earendil-works/pi-coding-agent').SessionManager} [opts.sessionManager]
 * @param {import('../../tools/plan-written.js').TriageMeta} [opts.triageMeta]
 * @param {import('./types.js').AgentDefinition} [opts._agentDefOverride]
 * @param {boolean} [opts.allowReturnToRouter]
 * @param {string} [opts.cwd] - Execution cwd for file tools and agent operations. Defaults to primary project root.
 * @param {string} [opts.debugLogPath] - Optional DEBUG log destination for this invocation.
 * @param {string} [opts.projectStateContext] - Optional session-scoped project state note for the system prompt.
 * @param {boolean} [opts.includeEditFallback] - Internal: whether to register the edit fallback custom tool.
 *
 * @returns {Promise<{
 *   session: import('@earendil-works/pi-coding-agent').AgentSession,
 *   agentDef: import('./types.js').AgentDefinition,
 *   promptState: { text: string },
 *   tools: string[],
 *   finalCustomTools: import('@earendil-works/pi-coding-agent').ToolDefinition[],
 *   resolvedModel: any,
 *   resolvedThinkingLevel: string | undefined,
 *   resolvedTemperature: number | undefined,
 *   imageMode?: string,
 *   visionFallbackModelRef?: string
 * }>}
 */
export async function buildAgentSession({
    hostedSession,
    agentName,
    toolNames,
    customTools,
    modelOverride,
    uiAPI,
    sessionManager,
    triageMeta,
    _agentDefOverride,
    allowReturnToRouter,
    cwd,
    debugLogPath,
    projectStateContext,
    includeEditFallback,
}) {
    const targetHostedSession = hostedSession ? requireHostedSession(hostedSession, "buildAgentSession") : null;
    const sessionCwd = cwd || targetHostedSession?.cwd || CWD;
    await ensureMnemosyneBinary();
    await ensureCymbalBinary();
    const agentDef = _agentDefOverride || await loadAgentDef(agentName, sessionCwd);

    const modelRegistry = getModelRegistry();
    const resolvedModel = await resolveModel(
        modelOverride,
        agentDef,
        agentName,
        modelRegistry,
        targetHostedSession || undefined,
    );
    const activeModelSupportsImages = modelSupportsImageInput(resolvedModel);
    const visionFallback = activeModelSupportsImages ? undefined : await resolveVisionFallbackModel(modelRegistry);
    const effectiveSessionManager = sessionManager || SessionManager.inMemory(sessionCwd);

    const customToolNames = (customTools || []).map((t) => t.name);
    let tools = resolveEffectiveSessionToolNames(agentDef.tools, toolNames, customToolNames, { allowReturnToRouter });

    const finalCustomTools = [...(customTools || [])];
    if (!activeModelSupportsImages && visionFallback && !tools.includes("see_image")) {
        tools = [...tools, "see_image"];
    }

    // Auto-wire internal custom tools if requested by name and not already provided.
    // This keeps agent frontmatter declarative: adding/removing tool names controls availability,
    // while RunWield runtime injects the concrete tool implementations.

    if (tools.includes("return_to_router") && !finalCustomTools.find((t) => t.name === "return_to_router")) {
        // Root sessions are hosted explicitly; close over the session/UI used to
        // build this AgentSession instead of relying on dynamic tool context or
        // any module-level active session state.
        const returnToRouterHostedSession = targetHostedSession;
        const returnToRouterUiAPI = uiAPI;
        finalCustomTools.push({
            ...returnToRouterTool,
            execute(_toolCallId, params, _signal, _onUpdate, _context) {
                return executeReturnToRouter(
                    /** @type {{ reason: string }} */ (params),
                    returnToRouterUiAPI,
                    returnToRouterHostedSession,
                );
            },
        });
    }

    if (tools.includes("plan_written") && uiAPI && !finalCustomTools.find((t) => t.name === "plan_written")) {
        const { createPlanWrittenTool } = await import("../../tools/plan-written.js");
        finalCustomTools.push(
            createPlanWrittenTool({ uiAPI, triageMeta, agentName, hostedSession: targetHostedSession }),
        );
    }

    if (tools.includes("triage_report") && !finalCustomTools.find((t) => t.name === "triage_report")) {
        const { createTriageReportTool } = await import("../../tools/triage-report.js");
        finalCustomTools.push(createTriageReportTool({ uiAPI, hostedSession: targetHostedSession || undefined }));
    }

    if (tools.includes("user_interview") && !finalCustomTools.find((t) => t.name === "user_interview")) {
        finalCustomTools.push(createUserInterviewTool({ uiAPI, hostedSession: targetHostedSession || undefined }));
    }

    if (tools.includes("task_completed") && uiAPI && !finalCustomTools.find((t) => t.name === "task_completed")) {
        const { createTaskCompletedTool } = await import("../../tools/task-completed.js");
        finalCustomTools.push(createTaskCompletedTool({ uiAPI, agentName: agentDef.displayName }));
    }

    if (tools.includes("review_complete") && uiAPI && !finalCustomTools.find((t) => t.name === "review_complete")) {
        const { createReviewCompletedTool } = await import("../../tools/review-complete.js");
        finalCustomTools.push(createReviewCompletedTool({ uiAPI, agentName: agentDef.displayName }));
    }

    // Override the built-in edit tool to return file contents on failure.
    if (includeEditFallback !== false) {
        finalCustomTools.push(createEditWithFallbackToolDefinition(sessionCwd));
    }

    // Override the built-in grep tool to accept shell-shaped multi-path input.
    if (!finalCustomTools.find((t) => t.name === "grep")) {
        finalCustomTools.push(createRunWieldGrepToolDefinition(sessionCwd));
    }

    if (tools.includes("multi_file_edit") && !finalCustomTools.find((t) => t.name === "multi_file_edit")) {
        const { createMultiFileEditTool } = await import("../../tools/multi_file_edit.js");
        finalCustomTools.push(createMultiFileEditTool(sessionCwd));
    }

    if (tools.includes("see_image") && visionFallback && !finalCustomTools.find((t) => t.name === "see_image")) {
        finalCustomTools.push(createSeeImageTool({
            cwd: sessionCwd,
            sessionManager: effectiveSessionManager,
            fallbackModel: visionFallback.model,
            modelRegistry,
        }));
    }

    // Resolve system prompt placeholders
    const finalSystemPrompt = await assembleFinalSystemPrompt(
        agentDef,
        tools,
        finalCustomTools,
        sessionCwd,
        projectStateContext,
    );
    const promptState = { text: finalSystemPrompt };
    const packagePromptResources = await resolveInstalledPackagePromptResources({ cwd: sessionCwd }).catch(() => []);
    const packageExtensionResources = await resolveInstalledWldExtensionResources({ cwd: sessionCwd }).catch(() => []);
    const extensionFactories = [mnemosyneExtension, cymbalExtension];
    if (await hasSnipBinary()) {
        extensionFactories.push((pi) => snipExtension(pi));
    }

    const loader = new DefaultResourceLoader({
        cwd: sessionCwd,
        agentDir: getSettingsDir("global"),
        systemPromptOverride: () => promptState.text,
        extensionFactories,
        additionalExtensionPaths: getWldExtensionPaths(packageExtensionResources),
        additionalPromptTemplatePaths: [
            ...getPromptTemplatePaths(sessionCwd),
            ...getPackagePromptTemplatePaths(packagePromptResources),
        ],
        noExtensions: true,
        noContextFiles: true,
        noPromptTemplates: true,
    });
    await loader.reload();

    if (!sessionManager && shouldWriteDebugLog(debugLogPath)) {
        const debugMsg =
            `[RunWield] buildAgentSession("${agentName}"): no sessionManager — using in-memory. Messages will NOT persist.`;
        appendDebugLog(debugLogPath, debugMsg);
    }

    const { session, extensionsResult } = await createAgentSession({
        cwd: sessionCwd,
        agentDir: getSettingsDir("global"),
        authStorage: modelRegistry.authStorage,
        modelRegistry,
        settingsManager: getSettingsManager(sessionCwd),
        tools,
        customTools: finalCustomTools,
        resourceLoader: loader,
        sessionManager: effectiveSessionManager,
        ...(resolvedModel ? { model: resolvedModel } : {}),
    });

    const configuredTemperature = agentName ? getConfiguredAgentTemperature(agentName, sessionCwd) : undefined;
    const temperatureSource = configuredTemperature !== undefined ? "settings agent temperature" : (
        agentDef.temperature !== undefined ? "agent definition temperature" : undefined
    );
    const resolvedTemperature = configuredTemperature ?? agentDef.temperature;
    applySessionTemperature(session, resolvedTemperature);

    if (extensionsResult?.errors?.length) {
        for (const err of extensionsResult.errors) {
            const msg = `[RunWield] Extension warning (${err.path}): ${err.error}`;
            if (uiAPI) uiAPI.appendSystemMessage(msg);
            else console.warn(msg);
            if (String(err.error).toLowerCase().includes("mnemosyne")) {
                const msg2 =
                    "[RunWield] Memory extension issue detected. Install mnemosyne: https://github.com/gandazgul/mnemosyne#quick-start";
                if (uiAPI) uiAPI.appendSystemMessage(msg2);
                else console.warn(msg2);
            }
        }
    }

    // Apply thinking level — settings values take priority over layered frontmatter.
    let thinkingLevelSource = undefined;
    let resolvedThinkingLevel = agentName ? getConfiguredAgentThinkingLevel(agentName, sessionCwd) : undefined;
    if (resolvedThinkingLevel) {
        thinkingLevelSource = "settings agent thinking level";
    }
    if (!resolvedThinkingLevel) {
        resolvedThinkingLevel = getSettingsManager(sessionCwd).getDefaultThinkingLevel();
        if (resolvedThinkingLevel) thinkingLevelSource = "settings default thinking level";
    }
    if (!resolvedThinkingLevel) {
        resolvedThinkingLevel = agentDef.thinkingLevel;
        if (resolvedThinkingLevel) thinkingLevelSource = "agent definition thinking level";
    }
    if (resolvedThinkingLevel) {
        session.setThinkingLevel(
            /** @type {import('@earendil-works/pi-agent-core').ThinkingLevel} */ (resolvedThinkingLevel),
        );
        // Keep the HostedSession footer in sync with what the AgentSession is using.
        targetHostedSession?.setThinkingLevel(
            /** @type {"off"|"minimal"|"low"|"medium"|"high"|"xhigh"} */ (resolvedThinkingLevel),
        );
    }

    // Ensure extension lifecycle hooks (e.g. session_start) are activated for this agent invocation.
    await session.bindExtensions({});

    const imageMode = activeModelSupportsImages ? "direct" : (visionFallback ? "fallback" : "blocked");
    await recordWorkflowMetric({
        category: "model_selection",
        event: "session_configured",
        agentName,
        details: {
            provider: resolvedModel?.provider,
            model: resolvedModel?.id,
            source: resolvedModel && typeof resolvedModel === "object"
                ? modelSelectionSourceByModel.get(resolvedModel)
                : undefined,
            selectedProvider: resolvedModel?.provider,
            selectedModel: resolvedModel?.id,
            selectedSource: resolvedModel && typeof resolvedModel === "object"
                ? modelSelectionSourceByModel.get(resolvedModel)
                : undefined,
            imageMode,
            hasVisionFallback: Boolean(visionFallback),
            resolvedThinkingLevel,
            thinkingLevelSource,
            temperatureConfigured: resolvedTemperature !== undefined,
            temperatureSource,
        },
    }, { cwd: sessionCwd });
    return {
        session,
        agentDef,
        promptState,
        tools,
        finalCustomTools,
        resolvedModel,
        resolvedThinkingLevel,
        resolvedTemperature,
        imageMode,
        visionFallbackModelRef: visionFallback?.modelRef,
    };
}

/**
 * Per-session subscriber state. Lives alongside the AgentSession and is reset
 * at the start of each prompt via resetTurn().
 *
 * @typedef {Object} SubscriberState
 * @property {() => void} resetTurn  Clear turn-scoped fields (invokedToolNames, currentMarkdownBlock).
 * @property {() => string[]} drainInvokedToolNames  Snapshot of tools used this turn; clears the list.
 * @property {() => void} endThinking  End any in-progress thinking stream (defensive cleanup).
 * @property {() => void} unsubscribe  Detach the subscription.
 */

/**
 * @typedef {Object} PreparedPromptContent
 * @property {string} text
 * @property {Array<{base64?: string, mimeType?: string, type?: string}>} [images]
 */

/**
 * @param {import('@earendil-works/pi-agent-core').AgentMessage[]} messages
 * @returns {number}
 */
function estimateAgentMessagesTokens(messages) {
    let tokens = 0;
    for (const message of messages) {
        tokens += estimateTokens(message);
    }
    return tokens;
}

/**
 * Pi's built-in threshold compaction checks the last assistant response before
 * adding the next user prompt. That can miss a large incoming prompt: the
 * previous turn is under the threshold, but previous context + new prompt no
 * longer leaves enough reserve tokens and the provider rejects it before Pi can
 * compact. RunWield performs a pre-prompt threshold check that includes the
 * prepared user message, then delegates to Pi's auto-compaction path so normal
 * compaction events and extension hooks still fire with reason "threshold".
 *
 * @param {import('@earendil-works/pi-coding-agent').AgentSession} session
 * @param {PreparedPromptContent} prepared
 * @returns {Promise<boolean>} true when a compaction attempt was started and succeeded
 */
async function compactBeforePromptIfNeeded(session, prepared) {
    const settings = session.settingsManager?.getCompactionSettings?.();
    if (!settings?.enabled) return false;
    if (session.isStreaming || session.isCompacting) return false;

    const contextWindow = session.model?.contextWindow ?? 0;
    if (typeof contextWindow !== "number" || contextWindow <= 0) return false;

    const usage = session.getContextUsage?.();
    let currentTokens = typeof usage?.tokens === "number" ? usage.tokens : 0;
    const contextMessages = session.sessionManager?.buildSessionContext?.().messages;
    if (Array.isArray(contextMessages)) {
        currentTokens = Math.max(currentTokens, estimateAgentMessagesTokens(contextMessages));
    }

    const pendingUserMessage = {
        role: "user",
        content: [
            { type: "text", text: prepared.text },
            ...(prepared.images || []),
        ],
        timestamp: Date.now(),
    };
    const totalTokens = currentTokens + estimateTokens(/** @type {any} */ (pendingUserMessage));
    if (!shouldCompact(totalTokens, contextWindow, settings)) return false;

    const runAutoCompaction = /** @type {{ _runAutoCompaction?: (reason: string, willRetry: boolean) => Promise<boolean> }} */
        (/** @type {unknown} */ (session))._runAutoCompaction;
    if (typeof runAutoCompaction !== "function") return false;
    return await runAutoCompaction.call(session, "threshold", false);
}

/**
 * Attach UI event subscribers to an AgentSession. Called once per AgentSession lifetime
 * (whether root or transient). Returns lifecycle handles for the caller to reset turn-scoped
 * state between prompts.
 *
 * @param {import('@earendil-works/pi-coding-agent').AgentSession} session
 * @param {import('./types.js').AgentDefinition} agentDef
 * @param {import('../workflow/workflow.js').UiAPI | undefined} uiAPI
 * @param {string} [debugLogPath]
 * @param {import('./hosted-session.js').HostedSession} [hostedSession]
 *
 * @returns {SubscriberState}
 */
export function attachUiSubscribers(
    session,
    agentDef,
    uiAPI,
    debugLogPath = undefined,
    hostedSession = undefined,
) {
    /** @type {{ appendText: (delta: string) => void } | null} */
    let currentMarkdownBlock = null;
    // Whether the agent-name header has already been rendered this turn. Only
    // the first assistant block of a turn shows the "Agent:" header; blocks
    // created after a tool call (the tool-call continuation) must not repeat it.
    let agentHeaderShown = false;
    /** @type {string[]} */
    let invokedToolNames = [];
    /** @type {{ appendDelta: (delta: string) => void, end: () => void } | null} */
    let currentThinkingStream = null;
    let currentRuntimeTurnId = crypto.randomUUID();
    let assistantMessageSequence = 0;
    let thinkingMessageSequence = 0;
    /** @type {string | null} */
    let currentAssistantMessageId = null;
    /** @type {string | null} */
    let currentThinkingMessageId = null;

    /** @returns {string} */
    const nextAssistantMessageId = () => `${currentRuntimeTurnId}:assistant:${++assistantMessageSequence}`;
    /** @returns {string} */
    const nextThinkingMessageId = () => `${currentRuntimeTurnId}:thinking:${++thinkingMessageSequence}`;

    /**
     * @param {Partial<import('./session-runtime-events.js').SessionRuntimeEvent> & { type: string }} runtimeEvent
     */
    const emitRuntimeEvent = (runtimeEvent) => {
        const eventWithTurnId = runtimeEvent.turnId ? runtimeEvent : { turnId: currentRuntimeTurnId, ...runtimeEvent };
        return emitHostedSessionRuntimeEvent(hostedSession, eventWithTurnId);
    };

    const hasRuntimeEventSink = () => Boolean(hostedSession?.getEventSink?.());

    const endThinking = () => {
        if (currentThinkingStream) {
            currentThinkingStream.end();
            currentThinkingStream = null;
        }
    };

    const unsubscribe = session.subscribe((event) => {
        const liveUiAPI = /** @type {any} */ (uiAPI || hostedSession?.getActiveUiAPIState?.() || undefined);
        const renderUiAPI = liveUiAPI?._runtimeEventBridge === true ? null : liveUiAPI;

        switch (event.type) {
            case "message_start": {
                if (shouldWriteDebugLog(debugLogPath) && debugLogPath) {
                    appendDebugLog(
                        debugLogPath,
                        [
                            `Event: MESSAGE START`,
                            `Timestamp: ${new Date().toISOString()}`,
                            `Role: ${event.message.role}`,
                            "",
                        ].join("\n"),
                    );
                }
                if (event.message.role === "assistant") {
                    // Start a fresh assistant message context, but do not render a block yet.
                    // We only create assistant blocks lazily when we receive actual text deltas
                    // (or when rendering an assistant error on message_end).
                    currentMarkdownBlock = null;
                    agentHeaderShown = false;
                    currentAssistantMessageId = /** @type {any} */ (event.message).id || nextAssistantMessageId();
                    currentThinkingMessageId = null;
                    endThinking();
                }
                break;
            }
            case "message_update": {
                if (event.assistantMessageEvent.type === "thinking_delta") {
                    currentThinkingMessageId = currentThinkingMessageId || nextThinkingMessageId();
                    emitRuntimeEvent({
                        type: RuntimeEventTypes.ASSISTANT_THINKING_DELTA,
                        messageId: currentThinkingMessageId,
                        delta: event.assistantMessageEvent.delta,
                    });
                    if (shouldWriteDebugLog(debugLogPath) && debugLogPath) {
                        appendDebugLog(
                            debugLogPath,
                            [
                                `Event: ASSISTANT THINKING DELTA`,
                                `Timestamp: ${new Date().toISOString()}`,
                                `Delta:`,
                                event.assistantMessageEvent.delta,
                                "",
                            ].join("\n"),
                        );
                    }
                    if (!currentThinkingStream && renderUiAPI) {
                        currentThinkingStream = renderUiAPI.appendThinkingStart?.() ?? null;
                    }
                    if (currentThinkingStream) {
                        currentThinkingStream.appendDelta(event.assistantMessageEvent.delta);
                    } else if (!hasRuntimeEventSink()) {
                        console.log(event.assistantMessageEvent.delta);
                    }
                    break;
                }

                if (event.assistantMessageEvent.type === "thinking_end") {
                    emitRuntimeEvent({
                        type: RuntimeEventTypes.ASSISTANT_THINKING_END,
                        ...(currentThinkingMessageId ? { messageId: currentThinkingMessageId } : {}),
                    });
                    if (shouldWriteDebugLog(debugLogPath) && debugLogPath) {
                        appendDebugLog(
                            debugLogPath,
                            [
                                `Event: ASSISTANT THINKING END`,
                                `Timestamp: ${new Date().toISOString()}`,
                                "",
                            ].join("\n"),
                        );
                    }
                    endThinking();
                    break;
                }

                if (event.assistantMessageEvent.type === "text_delta") {
                    currentAssistantMessageId = currentAssistantMessageId || nextAssistantMessageId();
                    emitRuntimeEvent({
                        type: RuntimeEventTypes.ASSISTANT_TEXT_DELTA,
                        messageId: currentAssistantMessageId,
                        delta: event.assistantMessageEvent.delta,
                        _meta: { agentName: agentDef.displayName },
                    });
                    if (shouldWriteDebugLog(debugLogPath) && debugLogPath) {
                        appendDebugLog(
                            debugLogPath,
                            [
                                `Event: ASSISTANT TEXT DELTA`,
                                `Timestamp: ${new Date().toISOString()}`,
                                `Delta:`,
                                event.assistantMessageEvent.delta,
                                "",
                            ].join("\n"),
                        );
                    }
                    endThinking();
                    if (renderUiAPI) {
                        const block = currentMarkdownBlock ?? renderUiAPI.appendAgentMessageStart(
                            agentHeaderShown ? "" : agentDef.displayName,
                        );
                        currentMarkdownBlock = block;
                        agentHeaderShown = true;
                        block.appendText(event.assistantMessageEvent.delta);
                        renderUiAPI.requestRender();
                    } else if (!hasRuntimeEventSink()) {
                        Deno.stdout.writeSync(
                            new TextEncoder().encode(event.assistantMessageEvent.delta),
                        );
                    }
                }
                break;
            }
            case "message_end": {
                if (shouldWriteDebugLog(debugLogPath) && debugLogPath) {
                    const message =
                        /** @type {import('@earendil-works/pi-agent-core').AgentMessage & { stopReason?: string, errorMessage?: string, usage?: unknown }} */ (event
                            .message);
                    appendDebugLog(
                        debugLogPath,
                        [
                            `Event: MESSAGE END`,
                            `Timestamp: ${new Date().toISOString()}`,
                            `Role: ${message.role}`,
                            message.stopReason ? `Stop Reason: ${message.stopReason}` : "",
                            message.errorMessage ? `Error: ${message.errorMessage}` : "",
                            "",
                        ].filter((line) => line !== "").join("\n"),
                    );
                }
                if (event.message.role === "assistant") {
                    endThinking();
                }

                const endedMessage = /** @type {any} */ (event.message);
                if (endedMessage?.usage) {
                    emitRuntimeEvent({
                        type: RuntimeEventTypes.USAGE,
                        raw: endedMessage.usage,
                    });
                }

                if (event.message.role === "assistant" && event.message.stopReason === "error") {
                    const message = sanitizeApiErrorMessage(event.message.errorMessage || "Unknown LLM error");
                    emitRuntimeEvent({
                        type: RuntimeEventTypes.TERMINAL_ERROR,
                        message,
                        error: event.message.errorMessage,
                    });
                }

                if (
                    event.message.role === "assistant" && event.message.stopReason === "error" &&
                    renderUiAPI
                ) {
                    if (shouldWriteDebugLog(debugLogPath) && debugLogPath) {
                        appendDebugLog(
                            debugLogPath,
                            [
                                `Event: ASSISTANT MESSAGE ERROR`,
                                `Timestamp: ${new Date().toISOString()}`,
                                `Error: ${sanitizeApiErrorMessage(event.message.errorMessage || "Unknown LLM error")}`,
                                "",
                            ].join("\n"),
                        );
                    }
                    const block = currentMarkdownBlock ?? renderUiAPI.appendAgentMessageStart(
                        agentHeaderShown ? "" : agentDef.displayName,
                    );
                    currentMarkdownBlock = block;
                    agentHeaderShown = true;
                    block.appendText(
                        `\n\n**Error:** ${sanitizeApiErrorMessage(event.message.errorMessage || "Unknown LLM error")}`,
                    );
                    renderUiAPI.requestRender();
                }
                break;
            }
            case "auto_retry_start": {
                const message = `[Retry ${event.attempt}/${event.maxAttempts}] ${
                    sanitizeApiErrorMessage(event.errorMessage)
                } — waiting ${event.delayMs}ms...`;
                emitRuntimeEvent({
                    type: RuntimeEventTypes.SYSTEM_STATUS,
                    level: "warning",
                    message,
                    raw: event,
                });
                if (renderUiAPI) {
                    renderUiAPI.appendSystemMessage(message);
                }
                break;
            }
            case "auto_retry_end": {
                if (!event.success) {
                    const message = `Auto-retry failed after ${event.attempt} attempts: ${
                        event.finalError || "Unknown error"
                    }`;
                    emitRuntimeEvent({
                        type: RuntimeEventTypes.SYSTEM_STATUS,
                        level: "error",
                        message,
                        raw: event,
                    });
                    if (renderUiAPI) {
                        renderUiAPI.appendSystemMessage(message, true);
                    }
                }
                break;
            }
            case "tool_execution_start": {
                currentMarkdownBlock = null;
                invokedToolNames.push(event.toolName);
                recordToolCallStarted(
                    event.toolCallId,
                    event.toolName,
                    event.args,
                    agentDef.displayName || agentDef.name,
                    { cwd: hostedSession?.cwd },
                );

                if (event.toolName === "plan_written" || event.toolName === "user_interview") {
                    emitRuntimeEvent({
                        type: RuntimeEventTypes.ATTENTION_REQUESTED,
                        reason: event.toolName === "plan_written" ? "planWritten" : "userInterview",
                        agentName: agentDef.displayName,
                    });
                }

                if (shouldWriteDebugLog(debugLogPath) && debugLogPath) {
                    appendDebugLog(
                        debugLogPath,
                        [
                            `Event: TOOL START`,
                            `Timestamp: ${new Date().toISOString()}`,
                            `Tool Call ID: ${event.toolCallId}`,
                            `Tool: ${event.toolName}`,
                            `Args:`,
                            formatDebugJson(event.args),
                            "",
                        ].join("\n"),
                    );
                }

                const filePath = getFilePathForTool(event.toolName, event.args);
                let headerArgs = "";
                if (filePath) headerArgs = `${filePath}`;
                else if (event.toolName === "bash") headerArgs = event.args?.command || "";
                else if (event.toolName === "grep") {
                    const path = Array.isArray(event.args?.path) ? event.args.path.join(" ") : event.args?.path || ".";
                    headerArgs = `${event.args?.pattern} in ${path}`;
                } else if (event.toolName === "find") {
                    headerArgs = `${event.args?.pattern} in ${event.args?.path || "."}`;
                } else if (event.toolName === "ls") {
                    headerArgs = event.args?.path || ".";
                } else if (event.toolName === "code_search") {
                    const q = event.args?.query || "";
                    headerArgs = event.args?.textSearch ? `${q} (text)` : q;
                } else if (event.toolName === "code_show") {
                    headerArgs = event.args?.target || "";
                } else if (event.toolName === "code_outline") {
                    headerArgs = event.args?.file || "";
                } else if (event.toolName === "code_batch") {
                    headerArgs = formatCodeBatchHeaderArgs(event.args);
                } else if (
                    event.toolName === "code_refs" || event.toolName === "code_impact" ||
                    event.toolName === "code_trace" || event.toolName === "code_investigate" ||
                    event.toolName === "code_impls"
                ) {
                    headerArgs = event.args?.symbol || "";
                } else if (event.toolName === "code_importers") {
                    headerArgs = event.args?.target || "";
                } else if (
                    event.toolName === "code_structure" || event.toolName === "code_codebase_info"
                ) {
                    // no args to show
                } else if (event.toolName === "plan_written") {
                    const planName = String(event.args?.planName || "").replace(/\.md$/i, "").trim();
                    headerArgs = planName ? `plans/${planName}.md` : "";
                } else if (
                    event.toolName === "memory_recall" || event.toolName === "memory_recall_global"
                ) {
                    headerArgs = event.args?.query || "";
                } else if (
                    event.toolName === "memory_store" || event.toolName === "memory_store_global"
                ) {
                    const c = event.args?.content || "";
                    headerArgs = c.length > 80 ? c.slice(0, 77) + "..." : c;
                } else if (event.toolName === "memory_delete") {
                    headerArgs = `id: ${event.args?.id}`;
                } else if (event.toolName === "task_completed") {
                    const m = event.args?.message || "";
                    headerArgs = m.length > 60 ? m.slice(0, 57) + "..." : m;
                } else if (event.toolName === "return_to_router") {
                    headerArgs = "to router";
                }

                emitRuntimeEvent({
                    type: RuntimeEventTypes.TOOL_START,
                    toolCallId: event.toolCallId,
                    toolName: event.toolName,
                    title: event.toolName === "bash"
                        ? `$ ${headerArgs}`.trim()
                        : `${event.toolName} ${headerArgs}`.trim(),
                    args: event.args,
                });

                if (event.toolName === "task_completed" || HIDDEN_UI_TOOL_BLOCK_NAMES.has(event.toolName)) {
                    break;
                }

                if (renderUiAPI && renderUiAPI.startToolExecution) {
                    const headerName = event.toolName === "bash" ? "$" : event.toolName;
                    renderUiAPI.startToolExecution(event.toolCallId, headerName, headerArgs);
                } else if (!hasRuntimeEventSink()) {
                    console.log(`\n  [Tool] ${event.toolName} ${headerArgs}`);
                }
                break;
            }
            case "tool_execution_update": {
                if (shouldWriteDebugLog(debugLogPath) && debugLogPath) {
                    appendDebugLog(
                        debugLogPath,
                        [
                            `Event: TOOL UPDATE`,
                            `Timestamp: ${new Date().toISOString()}`,
                            `Tool Call ID: ${event.toolCallId}`,
                            `Tool: ${event.toolName}`,
                            `Partial Result:`,
                            formatDebugJson(event.partialResult),
                            "",
                        ].join("\n"),
                    );
                }
                const partialText = event.partialResult?.content
                    ?.map((/** @type {{ text?: string } | null | undefined } */ contentBlock) =>
                        contentBlock && typeof contentBlock === "object" ? String(contentBlock.text || "") : ""
                    )
                    .join("") || "";
                emitRuntimeEvent({
                    type: RuntimeEventTypes.TOOL_UPDATE,
                    toolCallId: event.toolCallId,
                    toolName: event.toolName,
                    partialResult: event.partialResult,
                    text: partialText,
                });
                if (renderUiAPI && renderUiAPI.getActiveToolBlock) {
                    const block = renderUiAPI.getActiveToolBlock(event.toolCallId);
                    if (block && event.partialResult && event.partialResult.content) {
                        const newContentText = partialText;
                        const currentText = block.bodyText || "";
                        if (newContentText.length > currentText.length) {
                            block.appendOutput(newContentText.slice(currentText.length));
                        }
                    }
                }
                break;
            }
            case "tool_execution_end": {
                recordToolCallFinished(
                    event.toolCallId,
                    event.toolName,
                    Boolean(event.isError),
                    agentDef.displayName || agentDef.name,
                    { cwd: hostedSession?.cwd },
                );
                if (shouldWriteDebugLog(debugLogPath) && debugLogPath) {
                    appendDebugLog(
                        debugLogPath,
                        [
                            `Event: TOOL END`,
                            `Timestamp: ${new Date().toISOString()}`,
                            `Tool Call ID: ${event.toolCallId}`,
                            `Tool: ${event.toolName}`,
                            `Status: ${event.isError ? "ERROR" : "OK"}`,
                            `Result:`,
                            formatDebugJson(event.result),
                            "",
                        ].join("\n"),
                    );
                }
                const resultText = event.result?.content
                    ?.map((/** @type {{ text?: string } | null | undefined } */ contentBlock) =>
                        contentBlock && typeof contentBlock === "object" ? String(contentBlock.text || "") : ""
                    )
                    .join("") || "";
                emitRuntimeEvent({
                    type: RuntimeEventTypes.TOOL_END,
                    toolCallId: event.toolCallId,
                    toolName: event.toolName,
                    isError: event.isError,
                    result: event.result,
                    text: resultText,
                });
                if (renderUiAPI && renderUiAPI.getActiveToolBlock) {
                    const block = renderUiAPI.getActiveToolBlock(event.toolCallId);
                    if (block) {
                        // Make sure we append any final result text that wasn't streamed
                        if (event.result && event.result.content) {
                            const newContentText = resultText;
                            const currentText = block.bodyText || "";
                            if (newContentText.length > currentText.length) {
                                block.appendOutput(newContentText.slice(currentText.length));
                            }
                        }
                        const durationMs = Date.now() - block.startTime;
                        block.endExecution(event.isError, durationMs);
                    }
                } else if (!hasRuntimeEventSink()) {
                    console.log(`  [Tool] ${event.toolName} — ${event.isError ? "error" : "ok"}`);
                }
                break;
            }
            case "turn_start": {
                currentRuntimeTurnId = /** @type {any} */ (event).turnId || crypto.randomUUID();
                assistantMessageSequence = 0;
                thinkingMessageSequence = 0;
                currentAssistantMessageId = null;
                currentThinkingMessageId = null;
                emitRuntimeEvent({ type: RuntimeEventTypes.TURN_START, turnId: currentRuntimeTurnId });
                if (renderUiAPI && renderUiAPI.setBusy) renderUiAPI.setBusy(true);
                break;
            }
            case "turn_end": {
                emitRuntimeEvent({ type: RuntimeEventTypes.TURN_END, turnId: currentRuntimeTurnId, ok: true });
                currentAssistantMessageId = null;
                currentThinkingMessageId = null;
                if (renderUiAPI && renderUiAPI.setBusy) renderUiAPI.setBusy(false);
                break;
            }
            case "compaction_start": {
                // Manual /compact has its own UI in cmd/compact/index.js — avoid duplicate status.
                if (event.reason !== "manual") {
                    const label = event.reason === "overflow"
                        ? "Context overflow detected, auto-compacting..."
                        : "Auto-compacting context...";
                    emitRuntimeEvent({
                        type: RuntimeEventTypes.SYSTEM_STATUS,
                        level: "info",
                        message: label,
                        raw: event,
                    });
                    if (renderUiAPI) renderUiAPI.appendSystemMessage(label);
                }
                break;
            }
            case "compaction_end": {
                // Manual /compact's success/failure is reported by the slash command itself
                // (which awaits session.compact()). Only emit a UI message for auto runs.
                if (event.reason !== "manual") {
                    if (event.aborted) {
                        emitRuntimeEvent({
                            type: RuntimeEventTypes.SYSTEM_STATUS,
                            level: "warning",
                            message: "Auto-compaction cancelled.",
                            raw: event,
                        });
                        if (renderUiAPI) renderUiAPI.appendSystemMessage("Auto-compaction cancelled.");
                    } else if (event.result) {
                        const message = `Auto-compacted. Tokens before: ${event.result.tokensBefore.toLocaleString()}`;
                        emitRuntimeEvent({
                            type: RuntimeEventTypes.SYSTEM_STATUS,
                            level: "info",
                            message,
                            raw: event,
                        });
                        if (renderUiAPI) renderUiAPI.appendSystemMessage(message);
                    } else if (event.errorMessage) {
                        const message = `Auto-compaction failed: ${sanitizeApiErrorMessage(event.errorMessage)}`;
                        emitRuntimeEvent({
                            type: RuntimeEventTypes.SYSTEM_STATUS,
                            level: "error",
                            message,
                            raw: event,
                        });
                        if (renderUiAPI) renderUiAPI.appendSystemMessage(message);
                    }
                }
                break;
            }
        }
    });

    return {
        resetTurn: () => {
            currentMarkdownBlock = null;
            invokedToolNames = [];
        },
        drainInvokedToolNames: () => {
            const snapshot = invokedToolNames.slice();
            invokedToolNames = [];
            return snapshot;
        },
        endThinking,
        unsubscribe,
    };
}

/**
 * Run a single prompt() on an already-constructed AgentSession with attached subscribers.
 * Handles debug logging, defensive UI cleanup, and per-turn state reset.
 *
 * @param {Object} opts
 * @param {import('@earendil-works/pi-coding-agent').AgentSession} opts.session
 * @param {import('./types.js').AgentDefinition} opts.agentDef
 * @param {string} opts.agentName
 * @param {string} opts.userRequest
 * @param {string} opts.finalSystemPrompt  Used only for debug log.
 * @param {Array<{base64: string, mimeType: string}>} [opts.images]
 * @param {import('../workflow/workflow.js').UiAPI} [opts.uiAPI]
 * @param {SubscriberState} opts.subscriberState
 * @param {any} [opts.resolvedModel]
 * @param {string} [opts.resolvedThinkingLevel]
 * @param {string} [opts.cwd]
 * @param {string} [opts.debugLogPath]
 *
 * @returns {Promise<import('@earendil-works/pi-agent-core').AgentMessage[]>}
 */
export async function runPrompt({
    session,
    agentDef,
    agentName,
    userRequest,
    finalSystemPrompt,
    images,
    uiAPI,
    subscriberState,
    resolvedModel,
    resolvedThinkingLevel,
    cwd,
    debugLogPath,
}) {
    subscriberState.resetTurn();

    const fallback = images && images.length > 0 && !modelSupportsImageInput(session.model)
        ? await resolveVisionFallbackModel(session.modelRegistry)
        : undefined;
    const preparedImages = prepareImagesForModel({
        text: userRequest,
        images,
        activeModel: session.model,
        fallbackModelRef: fallback?.modelRef,
    });
    if (!preparedImages.ok) throw new Error(preparedImages.message);

    const requestOptions = {};
    if (preparedImages.images && preparedImages.images.length > 0) {
        requestOptions.images = preparedImages.images;
    }

    const debugEnabled = shouldWriteDebugLog(debugLogPath);
    if (debugEnabled) {
        const startTitle = agentName === AGENTS.ROUTER
            ? "ROUTER INVOCATION START"
            : `AGENT INVOCATION START: ${agentDef.name} (${agentName})`;
        const logEntry = [
            `Event: ${startTitle}`,
            `Timestamp: ${new Date().toISOString()}`,
            `Agent: ${agentDef.displayName} (${agentName})`,
            `Provider: ${resolvedModel?.provider || "(session default)"}`,
            `Model: ${resolvedModel?.id || "(session default)"}`,
            `Model Name: ${resolvedModel?.name || "(not available)"}`,
            `Thinking Level: ${resolvedThinkingLevel || "(default)"}`,
            `Execution CWD: ${cwd || CWD}`,
            `System Prompt:`,
            finalSystemPrompt,
            `User Request:`,
            preparedImages.text,
            "",
        ].join("\n");
        appendDebugLog(debugLogPath, logEntry);
    }

    /** @type {Error | null} */
    let promptError = null;

    try {
        await compactBeforePromptIfNeeded(session, {
            text: preparedImages.text,
            images: preparedImages.images,
        });
        await session.prompt(preparedImages.text, requestOptions);
        await session.agent.waitForIdle();
    } catch (error) {
        promptError = error instanceof Error ? error : new Error(String(error));
        throw error;
    } finally {
        // Defensive cleanup: end any active thinking stream and force idle UI state.
        // This handles abort/error edge paths where turn_end events may never fire.
        subscriberState.endThinking();
        if (uiAPI) {
            try {
                if (uiAPI.setBusy) uiAPI.setBusy(false);
            } catch (_e) {
                // Ignore UI API errors during cleanup
            }
        }

        if (debugEnabled) {
            const messages = session.agent.state.messages;
            const summary = extractAssistantSummary(messages);
            const invokedToolNames = subscriberState.drainInvokedToolNames();
            const logEntry = agentName === AGENTS.ROUTER
                ? [
                    `Event: ROUTER INVOCATION END`,
                    `Timestamp: ${new Date().toISOString()}`,
                    `Provider: ${resolvedModel?.provider || "(session default)"}`,
                    `Model: ${resolvedModel?.id || "(session default)"}`,
                    `Thinking Level: ${resolvedThinkingLevel || "(default)"}`,
                    `Router Tools Used: ${invokedToolNames.join(", ") || "(none)"}`,
                    promptError ? `Status: ERROR (${promptError.message})` : `Status: OK`,
                    "",
                ].join("\n")
                : [
                    `Event: AGENT INVOCATION END: ${agentDef.name} (${agentName})`,
                    `Timestamp: ${new Date().toISOString()}`,
                    `Provider: ${resolvedModel?.provider || "(session default)"}`,
                    `Model: ${resolvedModel?.id || "(session default)"}`,
                    `Thinking Level: ${resolvedThinkingLevel || "(default)"}`,
                    `Tools Used: ${invokedToolNames.join(", ") || "(none)"}`,
                    promptError ? `Status: ERROR (${promptError.message})` : `Status: OK`,
                    `Summary:`,
                    summary || "(empty)",
                    "",
                ].join("\n");
            appendDebugLog(debugLogPath, logEntry);
        }
    }

    return session.agent.state.messages;
}

/**
 * @param {string} agentName
 * @param {string} userRequest
 * @param {number} rootTurnCount
 * @returns {string}
 */
export function applyAttentionNudge(agentName, userRequest, rootTurnCount) {
    const nudge = _AGENT_ATTENTION_NUDGES[agentName];
    if (!nudge) return userRequest;
    if (rootTurnCount <= 1 || rootTurnCount % ATTENTION_NUDGE_TURN_INTERVAL !== 0) return userRequest;

    return [
        "<attention_nudge>",
        nudge,
        "</attention_nudge>",
        "",
        userRequest,
    ].join("\n");
}

/** @type {WeakMap<import('@earendil-works/pi-coding-agent').AgentSession, { agentDef: import('./types.js').AgentDefinition, promptState: { text: string }, subscriberState: SubscriberState, agentName: string, tools: string[], finalCustomTools: import('@earendil-works/pi-coding-agent').ToolDefinition[], rootTurnCount: number, projectStateContext: string, imageMode?: string, visionFallbackModelRef?: string }>} */
const rootSessionMetadata = new WeakMap();

/**
 * Test-only access to root session metadata.
 * @param {import('@earendil-works/pi-coding-agent').AgentSession} session
 * @returns {any}
 */
export function __getRootSessionMetadataForTests(session) {
    return rootSessionMetadata.get(session);
}

/**
 * Dispose and clear the active root AgentSession for an explicit fresh-session
 * boundary. This is intentionally separate from ensureRootAgentSession() so
 * agent switches, model switches, and reloads cannot accidentally kill root
 * context. /new is the only production caller.
 *
 * @param {import('./hosted-session.js').HostedSession} hostedSession
 */
export function disposeRootAgentSessionForNewSession(hostedSession) {
    const targetHostedSession = requireHostedSession(hostedSession, "disposeRootAgentSessionForNewSession");
    const existing = /** @type {any} */ (targetHostedSession.getRootAgentSession());
    if (existing) {
        const meta = rootSessionMetadata.get(existing);
        try {
            meta?.subscriberState.unsubscribe();
        } catch (_e) { /* ignore */ }
        try {
            existing.dispose();
        } catch (_e) { /* ignore */ }
        rootSessionMetadata.delete(existing);
    }
    targetHostedSession.setRootAgentSession(null);
    targetHostedSession.setRootAgentName(null);
}

/**
 * Eagerly build and install the root AgentSession for the given agent.
 * If a root already exists, it is detached from RunWield UI state only after
 * the replacement is ready. Do not dispose the old root here: agent switches,
 * model switches, and reloads must not kill root sessions. Explicit fresh
 * sessions (for example /new) own any intentional disposal/reset behavior.
 *
 * @param {Object} opts
 * @param {import('./hosted-session.js').HostedSession} [opts.hostedSession]
 * @param {string} opts.agentName  Internal name (matches agent definition filename).
 * @param {string[]} [opts.toolNames]
 * @param {import('@earendil-works/pi-coding-agent').ToolDefinition[]} [opts.customTools]
 * @param {string} [opts.modelOverride]
 * @param {import('../workflow/workflow.js').UiAPI} [opts.uiAPI]
 * @param {import('@earendil-works/pi-coding-agent').SessionManager} [opts.sessionManager]
 * @param {boolean} [opts.allowReturnToRouter]
 * @param {import('./types.js').AgentDefinition} [opts._agentDefOverride]
 * @param {string} [opts.cwd]
 * @param {string} [opts.projectStateContext]
 * @param {boolean} [opts.includeEditFallback]
 * @param {Function} [opts._buildAgentSession]
 * @param {Function} [opts._attachUiSubscribers]
 * @param {string} [opts.debugLogPath]
 *
 * @returns {Promise<import('@earendil-works/pi-coding-agent').AgentSession>}
 */
export async function ensureRootAgentSession(opts) {
    const hostedSession = requireHostedSession(opts.hostedSession, "ensureRootAgentSession");
    const existing = /** @type {any} */ (hostedSession.getRootAgentSession());
    const existingMeta = existing ? rootSessionMetadata.get(existing) : undefined;
    const rootProjectStateContext = opts.projectStateContext ?? hostedSession.getProjectStateContext();
    const buildAgentSessionFn = opts._buildAgentSession || buildAgentSession;
    const attachUiSubscribersFn = opts._attachUiSubscribers || attachUiSubscribers;
    const {
        session,
        agentDef,
        promptState,
        tools,
        finalCustomTools,
        resolvedModel,
        imageMode,
        visionFallbackModelRef,
    } = await buildAgentSessionFn({
        ...opts,
        hostedSession,
        cwd: opts.cwd || hostedSession.cwd,
        sessionManager: /** @type {any} */ (opts.sessionManager || hostedSession.getRootSessionManager() || undefined),
        projectStateContext: rootProjectStateContext,
        allowReturnToRouter: opts.allowReturnToRouter ?? true,
    });

    try {
        hostedSession.assertActive();
    } catch (error) {
        try {
            session.dispose();
        } catch (_disposeError) { /* ignore */ }
        throw error;
    }

    const subscriberState = attachUiSubscribersFn(session, agentDef, opts.uiAPI, opts.debugLogPath, hostedSession);

    if (existing) {
        try {
            existingMeta?.subscriberState.unsubscribe();
        } catch (_e) { /* ignore */ }
        rootSessionMetadata.delete(existing);
    }

    const finalModelForUi = resolvedModel ? `${resolvedModel.provider}/${resolvedModel.id}` : undefined;
    hostedSession.resetAgentInfoStack(
        agentDef.displayName,
        finalModelForUi,
        resolvedModel?.provider || "",
        opts.agentName,
    );

    hostedSession.setRootAgentSession(session);
    hostedSession.setRootAgentName(opts.agentName);
    recordActiveAgent(
        /** @type {any} */ (opts.sessionManager || hostedSession.getRootSessionManager() || undefined),
        opts.agentName,
    );
    rootSessionMetadata.set(session, {
        agentDef,
        promptState,
        subscriberState,
        agentName: opts.agentName,
        tools,
        finalCustomTools,
        rootTurnCount: 0,
        projectStateContext: rootProjectStateContext,
        imageMode,
        visionFallbackModelRef,
    });

    return session;
}

/**
 * Run a turn on the existing root AgentSession. The root must already be built
 * (via ensureRootAgentSession) and must match the requested agentName.
 *
 * @param {Object} opts
 * @param {import('./hosted-session.js').HostedSession} [opts.hostedSession]
 * @param {string} opts.agentName  Internal name used to verify the root matches.
 * @param {string} opts.userRequest
 * @param {Array<{base64: string, mimeType: string}>} [opts.images]
 * @param {import('../workflow/workflow.js').UiAPI} [opts.uiAPI]
 * @param {import('@earendil-works/pi-coding-agent').SessionManager} [opts.sessionManager]
 * @param {import('@earendil-works/pi-coding-agent').ToolDefinition[]} [opts.customTools]
 * @param {import('./types.js').AgentDefinition} [opts._agentDefOverride]
 * @param {boolean} [opts.allowReturnToRouter]
 * @param {Function} [opts._buildAgentSession]
 * @param {Function} [opts._attachUiSubscribers]
 * @param {Function} [opts._runPrompt]
 *
 * @returns {Promise<import('@earendil-works/pi-agent-core').AgentMessage[]>}
 */
export async function runRootTurn({
    hostedSession,
    agentName,
    userRequest,
    images,
    uiAPI,
    sessionManager,
    customTools,
    _agentDefOverride,
    allowReturnToRouter,
    _buildAgentSession,
    _attachUiSubscribers,
    _runPrompt,
}) {
    const targetHostedSession = requireHostedSession(hostedSession, "runRootTurn");
    let session = /** @type {any} */ (targetHostedSession.getRootAgentSession());
    if (!session) {
        throw new Error(`runRootTurn: no root AgentSession (expected agent "${agentName}")`);
    }
    if (targetHostedSession.getRootAgentName() !== agentName) {
        throw new Error(
            `runRootTurn: root agent is "${targetHostedSession.getRootAgentName()}", not "${agentName}". setActiveAgent must rebuild first.`,
        );
    }
    let meta = rootSessionMetadata.get(session);
    if (!meta) {
        throw new Error(
            "runRootTurn: root AgentSession is missing metadata (was it built via ensureRootAgentSession?)",
        );
    }

    const requiredCustomToolNames = (customTools || []).map((tool) => tool.name);
    const existingCustomToolNames = meta.finalCustomTools.map((tool) => tool.name);
    const hasRequiredCustomTools = requiredCustomToolNames.every((name) => existingCustomToolNames.includes(name));
    if (!hasRequiredCustomTools && customTools?.length) {
        session = await ensureRootAgentSession({
            hostedSession: targetHostedSession,
            agentName,
            uiAPI,
            sessionManager,
            customTools,
            _agentDefOverride,
            allowReturnToRouter,
            _buildAgentSession,
            _attachUiSubscribers,
            projectStateContext: meta.projectStateContext,
        });
        meta = rootSessionMetadata.get(session);
        if (!meta) {
            throw new Error(
                "runRootTurn: rebuilt root AgentSession is missing metadata (was it built via ensureRootAgentSession?)",
            );
        }
    }

    meta.rootTurnCount += 1;
    const finalRequest = applyAttentionNudge(agentName, userRequest, meta.rootTurnCount);
    const runPromptFn = _runPrompt || runPrompt;

    return await runPromptFn({
        session,
        agentDef: meta.agentDef,
        agentName,
        userRequest: finalRequest,
        finalSystemPrompt: meta.promptState.text,
        images,
        uiAPI,
        subscriberState: meta.subscriberState,
    });
}

/**
 * @param {Record<string, unknown>} opts
 * @param {string | null} rootAgentName
 * @returns {boolean}
 */
export function shouldReuseExistingRootSession(opts, rootAgentName) {
    if (opts.useRootSession === false) return false;
    if (!rootAgentName || rootAgentName !== opts.agentName) return false;

    const rootChangingKeys = [
        "toolNames",
        "customTools",
        "modelOverride",
        "triageMeta",
        "_agentDefOverride",
        "allowReturnToRouter",
        "cwd",
        "debugLogPath",
        "projectStateContext",
        "includeEditFallback",
    ];
    return !rootChangingKeys.some((key) => Object.hasOwn(opts, key) && opts[key] !== undefined);
}

/**
 * Run a single Agent invocation. By default this uses the root AgentSession so
 * the turn remains in follow-up context; callers that intentionally need a
 * disposable one-off session must pass `useRootSession: false`.
 *
 * @param {Object} opts
 * @param {import('./hosted-session.js').HostedSession} [opts.hostedSession]
 * @param {string} opts.agentName
 * @param {string[]} [opts.toolNames] - Optional explicit tool override; defaults to agent frontmatter tools.
 * @param {import('@earendil-works/pi-coding-agent').ToolDefinition[]} [opts.customTools]
 * @param {string} [opts.modelOverride] - Optional explicit model override in provider/id format.
 * @param {string} opts.userRequest - The user-facing request/instruction to send to the agent
 * @param {Array<{base64: string, mimeType: string}>} [opts.images]
 * @param {import('../workflow/workflow.js').UiAPI} [opts.uiAPI]
 * @param {import('@earendil-works/pi-coding-agent').SessionManager} [opts.sessionManager]
 * @param {import('../../tools/plan-written.js').TriageMeta} [opts.triageMeta] - Optional triage metadata threaded into auto-wired plan_written.
 * @param {import('./types.js').AgentDefinition} [opts._agentDefOverride] - Internal: skip loadAgentDef() and use this pre-loaded definition.
 * @param {boolean} [opts.allowReturnToRouter] - Internal: expose return_to_router only for interactive direct/root flows.
 * @param {string} [opts.cwd] - Execution cwd for file tools and agent operations.
 * @param {string} [opts.debugLogPath] - Optional DEBUG log destination for this invocation.
 * @param {string} [opts.projectStateContext] - Optional session-scoped project state note for the system prompt.
 * @param {boolean} [opts.includeEditFallback] - Internal: whether to register the edit fallback custom tool.
 * @param {boolean} [opts.useRootSession=true] - Set false only for intentional disposable one-off sessions.
 * @param {Function} [opts._buildAgentSession]
 * @param {Function} [opts._attachUiSubscribers]
 * @param {Function} [opts._runPrompt]
 *
 * @returns {Promise<import('@earendil-works/pi-agent-core').AgentMessage[]>}
 */
export async function runAgentSession(opts) {
    const hostedSession = requireHostedSession(opts.hostedSession, "runAgentSession");
    const projectStateContext = opts.projectStateContext ?? hostedSession.getProjectStateContext();

    if (opts.useRootSession !== false) {
        if (shouldReuseExistingRootSession(opts, hostedSession.getRootAgentName())) {
            return await runRootTurn({
                ...opts,
                hostedSession,
                agentName: opts.agentName,
                userRequest: opts.userRequest,
                images: opts.images,
                uiAPI: opts.uiAPI,
                sessionManager: opts.sessionManager,
            });
        }

        await ensureRootAgentSession({
            ...opts,
            hostedSession,
            projectStateContext,
            allowReturnToRouter: opts.allowReturnToRouter ?? false,
        });
        return await runRootTurn({
            ...opts,
            hostedSession,
            agentName: opts.agentName,
            userRequest: opts.userRequest,
            images: opts.images,
            uiAPI: opts.uiAPI,
        });
    }

    const buildAgentSessionFn = opts._buildAgentSession || buildAgentSession;
    const attachUiSubscribersFn = opts._attachUiSubscribers || attachUiSubscribers;
    const runPromptFn = opts._runPrompt || runPrompt;
    const { session, agentDef, promptState, resolvedModel, resolvedThinkingLevel } = await buildAgentSessionFn({
        ...opts,
        hostedSession,
        cwd: opts.cwd || hostedSession.cwd,
        projectStateContext,
    });
    const subscriberState = attachUiSubscribersFn(session, agentDef, opts.uiAPI, opts.debugLogPath, hostedSession);
    hostedSession.addSubAgentSession(session);

    const suppressUI = opts.uiAPI?.isOutputSuppressed?.();
    if (!suppressUI) {
        const finalModelForUi = resolvedModel ? `${resolvedModel.provider}/${resolvedModel.id}` : undefined;
        hostedSession.pushAgentInfo(
            agentDef.displayName,
            finalModelForUi,
            resolvedModel?.provider || "",
            opts.agentName,
        );
        opts.uiAPI?.requestRender?.();
    }

    try {
        return await runPromptFn({
            session,
            agentDef,
            agentName: opts.agentName,
            userRequest: opts.userRequest,
            finalSystemPrompt: promptState.text,
            images: opts.images,
            uiAPI: opts.uiAPI,
            subscriberState,
            resolvedModel,
            resolvedThinkingLevel,
            cwd: opts.cwd || hostedSession.cwd,
            debugLogPath: opts.debugLogPath,
        });
    } finally {
        if (!suppressUI) {
            hostedSession.popAgentInfo();
            opts.uiAPI?.requestRender?.();
        }
        hostedSession.removeSubAgentSession(session);
        try {
            subscriberState.unsubscribe();
        } catch (_e) { /* ignore */ }
        try {
            session.dispose();
        } catch (_e) { /* ignore */ }
    }
}

/**
 * Reloads the active root session without destroying it.
 * Re-reads settings.json from disk, refreshes the dynamic system prompt,
 * resource loader, model, and thinking level. TUI theme reload belongs to the
 * TUI command adapter and is intentionally outside shared core.
 *
 * @param {import('./hosted-session.js').HostedSession | import('../workflow/workflow.js').UiAPI} [hostedSession]
 * @param {import('../workflow/workflow.js').UiAPI} [uiAPI]
 * @returns {Promise<boolean>} True if reloaded successfully, false if no active session
 */
export async function reloadRootAgentSession(hostedSession, uiAPI) {
    const targetHostedSession = requireHostedSession(hostedSession, "reloadRootAgentSession");
    const session = /** @type {any} */ (targetHostedSession.getRootAgentSession());
    if (!session) return false;
    const meta = rootSessionMetadata.get(session);
    if (!meta) return false;

    const settings = getSettingsManager(targetHostedSession.cwd);
    await settings.reload();

    await ensureRootAgentSession({
        hostedSession: targetHostedSession,
        agentName: meta.agentName,
        uiAPI: /** @type {any} */ (uiAPI || targetHostedSession.getActiveUiAPIState() || undefined),
        sessionManager: /** @type {any} */ (targetHostedSession.getRootSessionManager() || undefined),
        projectStateContext: meta.projectStateContext,
    });

    return true;
}

/**
 * Expand a /skill:{name} command into an XML <skill> block.
 * Modeled after Pi's _expandSkillCommand() in agent-session.ts.
 *
 * @param {string} skillName
 * @param {string} [additionalInstructions]
 * @param {string} [cwd]
 * @returns {Promise<string>} Formatted skill block string
 */
export async function expandSkillCommand(skillName, additionalInstructions, cwd = CWD) {
    const skills = await listSkills({ cwd });
    const skill = skills.find((s) => s.name === skillName);
    if (!skill) {
        throw new Error(`Unknown skill: ${skillName}`);
    }

    try {
        const raw = await Deno.readTextFile(skill.path);
        let body = raw;

        // Strip YAML frontmatter if present
        if (hasFrontMatter(raw)) {
            body = extractYaml(raw).body;
        }
        body = body.trim();

        // Build the XML block (matches Pi's format exactly)
        const skillBlock = `<skill name="${skill.name}" location="${skill.path}">\nReferences are relative to ${
            skill.path.replace(/\/SKILL\.md$/, "")
        }.\n\n${body}\n</skill>`;

        // Prepend an invocation header so the LLM understands this is an active command,
        // not just a passive skill reference.
        const header = `The user has invoked the "${skill.name}" skill. Follow the instructions below:`;
        const expanded = `${header}\n\n${skillBlock}`;

        // Append user instructions after the skill block
        if (additionalInstructions) {
            return `${expanded}\n\n${additionalInstructions}`;
        }
        return expanded;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to read skill "${skill.name}": ${message}`);
    }
}

/**
 * Expand a prompt template file into a final user request string.
 *
 * @param {string} templatePath
 * @param {string} [additionalInstructions]
 * @returns {Promise<string>} Formatted prompt template string
 */
export async function expandPromptTemplate(templatePath, additionalInstructions) {
    try {
        const raw = await Deno.readTextFile(templatePath);
        let body = raw;

        // Strip YAML frontmatter if present
        if (hasFrontMatter(raw)) {
            body = extractYaml(raw).body;
        }
        body = body.trim();

        // Append user instructions after the template block
        if (additionalInstructions) {
            return `${body}\n\n${additionalInstructions}`;
        }
        return body;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to read prompt template at "${templatePath}": ${message}`);
    }
}

/**
 * @typedef {Object} CodeBatchOperation
 * @property {string} op
 * @property {string} [target]
 * @property {string} [file]
 */

/**
 * @param {{ operations?: CodeBatchOperation[] } | undefined | null} args
 * @returns {string}
 */
function formatCodeBatchHeaderArgs(args) {
    if (!args || !Array.isArray(args.operations)) return "0 operations";

    const operations = args.operations;
    if (operations.length === 0) return "0 operations";

    const summaries = operations.slice(0, 3).map((operation) => {
        if (operation.op === "show") return `show ${operation.target || ""}`.trim();
        if (operation.op === "outline") return `outline ${operation.file || ""}`.trim();
        return operation.op || "operation";
    });
    const remainingCount = operations.length - summaries.length;
    if (remainingCount > 0) summaries.push(`+${remainingCount} more`);
    return summaries.join("; ");
}

/**
 * Extract file path from tool arguments for read/edit/write tools.
 *
 * @param {string} toolName
 * @param {{ path?: string, file_path?: string, edits?: Array<{ path?: string, file_path?: string }> }} args
 * @returns {string | null}
 */
function getFilePathForTool(toolName, args) {
    if (!args) return null;

    switch (toolName) {
        case "read":
        case "edit":
        case "write": {
            const path = typeof args.path === "string"
                ? args.path
                : typeof args.file_path === "string"
                ? args.file_path
                : null;
            return path;
        }
        case "multi_file_edit": {
            if (!Array.isArray(args.edits) || args.edits.length === 0) return null;
            const paths = args.edits
                .map((edit) =>
                    typeof edit.path === "string"
                        ? edit.path
                        : typeof edit.file_path === "string"
                        ? edit.file_path
                        : null
                )
                .filter(Boolean);
            const uniquePaths = [...new Set(paths)];
            if (uniquePaths.length === 0) return null;
            if (uniquePaths.length === 1) return uniquePaths[0];
            return `${uniquePaths[0]} +${uniquePaths.length - 1} files`;
        }
        default:
            return null;
    }
}

/**
 * @param {import('@earendil-works/pi-agent-core').AgentMessage[]} messages
 * @returns {string}
 */
function extractAssistantSummary(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        if (!message || message.role !== "assistant" || !Array.isArray(message.content)) continue;

        const text = message.content
            .map((contentBlock) => {
                if (!contentBlock || typeof contentBlock !== "object") return "";
                const block = /** @type {{ text?: string }} */ (contentBlock);
                return typeof block.text === "string" ? block.text : "";
            })
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();

        if (!text) continue;
        if (text.length > 240) return `${text.slice(0, 237)}...`;
        return text;
    }

    return "";
}
