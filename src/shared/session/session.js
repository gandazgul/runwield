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
import { completeSimple } from "@earendil-works/pi-ai/compat";
import { createEditWithFallbackToolDefinition } from "../../tools/edit-with-fallback.js";
import { createEditDocsToolDefinition, createWriteDocsToolDefinition } from "../../tools/docs-file-tools.js";
import { wrapPlanSafeFileTool } from "../../tools/plan-safe-file-tools.ts";
import { WORKFLOW_ADVANCEMENT_TOOL_NAMES } from "../../tools/registry.js";
import { createRunWieldGrepToolDefinition } from "../../tools/grep.js";
import { createRunWieldReadToolDefinition } from "../../tools/read.js";
import { extractYaml, test as hasFrontMatter } from "@std/front-matter";
import { dirname, join } from "@std/path";
import { AGENTS, getHomeDir, PROMPT_TEMPLATES_DIR, SKILLS_DIR } from "../../constants.js";
import {
    emitHostedSessionRuntimeEvent,
    emitSystemStatus,
    normalizeRuntimeToolResult,
    normalizeRuntimeUsage,
    RuntimeEventTypes,
} from "./session-runtime-events.js";
import mnemosyneExtension, { memoryToolDef } from "../../extensions/mnemosyne/index.js";
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
import ketchExtension, {
    webCodeSearchToolDef,
    webDocsSearchToolDef,
    webFetchToolDef,
    webSearchToolDef,
} from "../../extensions/ketch/index.ts";
import snipExtension from "../../extensions/snip/index.js";
import reAnchorExtension from "../../extensions/re-anchor/index.ts";
import { ensureCymbalBinary, ensureMnemosyneBinary, hasSnipBinary } from "../runtime-preflight.ts";
import { createUserInterviewTool } from "../../tools/user-interview.ts";
import { createSeeImageTool } from "../../tools/see-image.ts";
import {
    discoverProviderModel,
    getModelRegistry,
    getModelRuntime,
    SYSTEM_MODEL_DISCOVERY_NETWORK,
} from "../models/model-registry.ts";
import { assertModelExecutionBackendSupported } from "../models/model-execution.ts";
import {
    createClaudeExecutionSession,
    createPiExecutionSession,
    getExecutionSteeringTarget,
    getRootExecutionMessages,
    isExecutionSession,
} from "./execution-backend.ts";
import { ClaudeCliExecutionSession } from "./backends/claude-cli/execution-session.ts";
import { completeRequestDispatch, failRequestDispatch, prepareRequestDispatch } from "./request-dispatch.ts";
import { formatProviderModelReference, parseProviderModel } from "../models/model-validation.ts";
import { directoryExists, fileExists } from "../helpers.js";
import {
    _AGENT_ATTENTION_NUDGES,
    ATTENTION_NUDGE_TURN_INTERVAL,
    loadAgentDef,
    normalizeAgentInternalName,
    resolveAgentDefsDir as _resolveAgentDefsDir,
    resolveSessionToolNames,
} from "./agents.js";
import { getCustomSetting, getMergedCustomSetting, getSettingsDir, getSettingsManager } from "../settings.js";
import { modelSupportsImageInput, prepareImagesForModel, resolveVisionFallbackModel } from "./image-attachments.js";
import { readPersistedActiveAgentName, readPersistedModelState, recordActiveAgent } from "./active-agent-session.js";
import { extractBundledSkills, getBundledAgentDefsPath } from "./agent-assets.js";
import { getPackagePromptTemplatePaths, resolveInstalledPackagePromptResources } from "../package-resources.js";
import { getWldExtensionPaths, resolveInstalledWldExtensionResources } from "../extensions/wld-extension-manifest.js";
import { recordToolCallFinished, recordToolCallStarted, recordWorkflowMetric } from "../workflow/metrics.js";
import { describeRuntimeTool } from "./tool-event-title.js";
import { createSessionContextProjection, estimateContextTextTokens } from "./session-context-report.js";
import { installEarlySteeringInterruption } from "./early-steering.js";
import { loadSubAgentDefinition } from "./subagent-definitions.ts";
import { formatGitPromptState, readGitPromptState } from "../git.js";
import { sanitizeSessionName } from "./session-name.js";

/** @returns {string | null} */
function homePromptsDir() {
    const homeDir = getHomeDir();
    return homeDir ? join(homeDir, ".wld", "prompts") : null;
}

/** Regex to detect an HTML body in an error message (e.g. from a 404 page). */
const HTML_ERROR_RE = /^(.*?\b404\b.*?)(?:<!DOCTYPE|<html|<body)/i;
const UNSUPPORTED_TEMPERATURE_RE =
    /\bunsupported (?:parameter|field|argument)\b[^.:\n]*(?::|\b)\s*["']?temperature["']?|\btemperature\b[^.:\n]*\b(?:unsupported|not supported|not allowed|not accepted|invalid temperature)\b|\binvalid temperature\b.*\bonly\b.*\ballowed\b/i;

/** @type {Set<string>} */
const modelsWithoutTemperature = new Set();

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
export function appendDebugLog(debugLogPath, text) {
    if (!debugLogPath) return;
    try {
        Deno.mkdirSync(dirname(debugLogPath), { recursive: true });
        Deno.writeTextFileSync(debugLogPath, text.endsWith("\n") ? text : `${text}\n`, { append: true });
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
 * Resolve the effective tool list for a session.
 *
 * @param {string[]} agentTools
 * @param {unknown} toolNames
 * @param {string[]} customToolNames
 * @returns {string[]}
 */
export function resolveEffectiveSessionToolNames(agentTools, toolNames, customToolNames) {
    const resolvedTools = resolveSessionToolNames(agentTools, toolNames, customToolNames);
    const normalizedTools = resolvedTools.map((toolName) =>
        toolName === "multi_replace_file_content" ? "multi_file_edit" : toolName
    );
    return [...new Set(normalizedTools)];
}

/** @type {Set<string>} */
const WORKFLOW_ADVANCEMENT_TOOL_NAME_SET = new Set(WORKFLOW_ADVANCEMENT_TOOL_NAMES);

const NO_WORKFLOW_AUTHORITY_PROMPT = [
    "This is a one-turn Prompt Template invocation.",
    "You have no authority to start, complete, validate, repair, finalize, or advance a RunWield workflow.",
    "Do not try to call workflow completion or lifecycle tools. Finish in ordinary assistant prose.",
].join("\n");

/** @param {string[]} toolNames @param {boolean} shouldFilter */
function filterWorkflowAdvancementTools(toolNames, shouldFilter) {
    if (!shouldFilter) return toolNames;
    return toolNames.filter((toolName) => !WORKFLOW_ADVANCEMENT_TOOL_NAME_SET.has(toolName));
}

/**
 * @param {import('@earendil-works/pi-coding-agent').ToolDefinition[]} tools
 * @param {boolean} shouldFilter
 */
function filterCustomWorkflowAdvancementTools(tools, shouldFilter) {
    if (!shouldFilter) return [...tools];
    return tools.filter((tool) => !WORKFLOW_ADVANCEMENT_TOOL_NAME_SET.has(tool.name));
}

/**
 * @param {any} model
 * @param {string} thinkingLevel
 * @param {boolean} explicit
 */
function assertThinkingLevelSupportedForInvocation(model, thinkingLevel, explicit) {
    if (!explicit || !thinkingLevel || thinkingLevel === "off") return;
    if (model?.reasoning === true) return;
    throw new Error(
        `Model ${model?.provider || ""}/${model?.id || ""} does not support thinkingLevel "${thinkingLevel}".`,
    );
}

/** @param {import('../models/model-registry.ts').RunWieldModel | undefined} model @param {string | undefined} thinkingLevel */
function assertThinkingLevelBackendSupportedForInvocation(model, thinkingLevel) {
    if (!thinkingLevel || thinkingLevel === "off") return;
    if (model?.executionBackend !== "claude-cli") return;
    throw new Error(
        `Model ${model?.provider || ""}/${
            model?.id || ""
        } uses Claude CLI, which does not support thinkingLevel "${thinkingLevel}" for RunWield named invocations.`,
    );
}

/** @param {{ provider?: string, id?: string } | undefined} model @param {number} totalTokens @param {number} contextWindow */
function contextCapacityGuidance(model, totalTokens, contextWindow) {
    const modelLabel = `${model?.provider || ""}/${model?.id || ""}`.replace(/^\//, "") || "the selected model";
    return `The current Session history does not fit ${modelLabel}. Estimated input: ${totalTokens} tokens; context window: ${contextWindow} tokens. Compact the Session, start a fresh Session, or choose a larger model.`;
}

/**
 * @param {{ agentName: string, cwd: string, agentDef: import('./types.js').AgentDefinition, thinkingLevelOverride?: string }} options
 */
function resolveExecutionThinkingLevel(options) {
    let thinkingLevelSource = undefined;
    let resolvedThinkingLevel = options.thinkingLevelOverride;
    if (resolvedThinkingLevel) {
        thinkingLevelSource = "invocation thinking level override";
    }
    if (!resolvedThinkingLevel) {
        resolvedThinkingLevel = options.agentName
            ? getConfiguredAgentThinkingLevel(options.agentName, options.cwd)
            : undefined;
        if (resolvedThinkingLevel) {
            thinkingLevelSource = "settings agent thinking level";
        }
    }
    if (!resolvedThinkingLevel) {
        resolvedThinkingLevel = getSettingsManager(options.cwd).getDefaultThinkingLevel();
        if (resolvedThinkingLevel) thinkingLevelSource = "settings default thinking level";
    }
    if (!resolvedThinkingLevel) {
        resolvedThinkingLevel = options.agentDef.thinkingLevel;
        if (resolvedThinkingLevel) thinkingLevelSource = "agent definition thinking level";
    }
    return { resolvedThinkingLevel, thinkingLevelSource };
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
 * @property {string | undefined} agent
 * @property {string | undefined} thinkingLevel
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
export function getPromptTemplatePaths(cwd) {
    return [
        ...(cwd ? [join(cwd, ".wld", "prompts")] : []),
        ...(homePromptsDir() ? [/** @type {string} */ (homePromptsDir())] : []),
        PROMPT_TEMPLATES_DIR,
    ];
}

/**
 * Parse prompt-template markdown metadata.
 *
 * @param {string} filePath
 * @returns {Promise<{ description: string, argumentHint?: string, model?: string, agent?: string, thinkingLevel?: string }>}
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
    const agent = typeof attrs.agent === "string" && attrs.agent.trim() ? attrs.agent.trim() : undefined;
    const thinkingLevel = typeof attrs.thinkingLevel === "string" && attrs.thinkingLevel.trim()
        ? attrs.thinkingLevel.trim()
        : undefined;

    return {
        description: frontmatterDescription || inferredDescription,
        argumentHint,
        model,
        agent,
        thinkingLevel,
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
    const cwd = options.cwd;

    /** @type {Array<{dir: string, source: PromptTemplateSource}>} */
    const layers = [
        ...(cwd ? [{ dir: join(cwd, ".wld", "prompts"), source: /** @type {PromptTemplateSource} */ ("local") }] : []),
        ...(homePromptsDir()
            ? [{ dir: /** @type {string} */ (homePromptsDir()), source: /** @type {PromptTemplateSource} */ ("home") }]
            : []),
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
                    agent: meta.agent,
                    thinkingLevel: meta.thinkingLevel,
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
        : await resolveInstalledPackagePromptResources({ cwd }).catch(() => []);

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
                agent: meta.agent,
                thinkingLevel: meta.thinkingLevel,
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

    const extractedBundledDir = await extractBundledSkills();
    const bundledDirs = extractedBundledDir && extractedBundledDir !== SKILLS_DIR
        ? [extractedBundledDir, SKILLS_DIR]
        : [SKILLS_DIR];

    const enableExternalSkills = getCustomSetting("enableExternalSkills", "global") ?? true;

    const homeDir = getHomeDir();
    const layers = [
        ...(options.cwd
            ? [{
                dir: join(options.cwd, ".wld", "skills"),
                source: /** @type {"local" | "home" | "bundled" | "external"} */ ("local"),
            }]
            : []),
        ...(homeDir
            ? [{
                dir: join(homeDir, ".wld", "skills"),
                source: /** @type {"local" | "home" | "bundled" | "external"} */ ("home"),
            }]
            : []),
        ...bundledDirs.map((dir) => ({
            dir,
            source: /** @type {"local" | "home" | "bundled" | "external"} */ ("bundled"),
        })),
        // ── External (Pi-compatible / marketplace) skills ──
        ...(enableExternalSkills && homeDir
            ? [{
                dir: join(homeDir, ".agents", "skills"),
                source: /** @type {"local" | "home" | "bundled" | "external"} */ ("external"),
            }]
            : []),
    ];

    for (const layer of layers) {
        if (!(await directoryExists(layer.dir))) continue;

        try {
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
        } catch (error) {
            if (!(error instanceof Deno.errors.NotFound)) throw error;
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
        join(homeDir, ".wld", "RUNWIELD.md"),
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
export async function listLoadedAgentMdFiles(cwd) {
    /** @type {{ path: string, source: "home" | "external" | "local" }[]} */
    const results = [];

    const homeDir = getHomeDir();
    for (const homePath of getGlobalAgentMdPaths(homeDir)) {
        if (await fileExists(homePath)) {
            const source = homePath === join(homeDir, ".agents", "AGENTS.md")
                ? /** @type {"external"} */ ("external")
                : /** @type {"home"} */ ("home");
            results.push({ path: homePath, source });
            break;
        }
    }

    if (cwd) {
        for (const projectPath of [join(cwd, "RUNWIELD.md"), join(cwd, "AGENTS.md")]) {
            if (await fileExists(projectPath)) {
                results.push({ path: projectPath, source: "local" });
                break;
            }
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
    const rootTarget = root && isExecutionSession(root) ? root.session : root;
    if (rootTarget && rootTarget.isStreaming) {
        try {
            rootTarget.abort();
        } catch (_e) { /* ignore */ }
        aborted = true;
    }
    // Clear any stale steering/follow-up messages from the agent's queue
    if (rootTarget) {
        try {
            rootTarget.clearQueue();
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
 * Steer a concrete AgentSession and return the session that accepted the message.
 *
 * @param {any} session
 * @param {string | import('./types.js').ImageAttachment[]} [text]
 * @param {import('./types.js').ImageAttachment[]} [images]
 * @returns {Promise<import('@earendil-works/pi-coding-agent').AgentSession | null>}
 */
export async function steerAgentSessionWithTarget(session, text, images) {
    if (!session) return null;
    if (!session.isStreaming) return null;
    const activeModel = session.model || { input: ["text", "image"] };
    const fallback = images && images.length > 0 && session.model && !modelSupportsImageInput(session.model)
        ? await resolveVisionFallbackModel(
            /** @type {any} */ (session).runWieldModelRegistry || /** @type {any} */ (session).modelRegistry ||
                getModelRegistry(),
            SYSTEM_MODEL_DISCOVERY_NETWORK,
        )
        : undefined;
    const prepared = prepareImagesForModel({
        text: /** @type {string} */ (text),
        images,
        activeModel,
        fallbackModelRef: fallback?.modelRef,
    });
    if (!prepared.ok) throw new Error(prepared.message);
    await session.steer(prepared.text, prepared.images && prepared.images.length > 0 ? prepared.images : undefined);
    return session;
}

/**
 * Steer the root (user-facing) session with a message injected between tool calls.
 * Foreground sub-agent steering uses steerActiveSessionWithTarget instead.
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
 * Steer the root session and return the AgentSession that accepted the message.
 *
 * @param {import('./hosted-session.js').HostedSession | string} hostedSession
 * @param {string | import('./types.js').ImageAttachment[]} [text]
 * @param {import('./types.js').ImageAttachment[]} [images]
 * @returns {Promise<import('@earendil-works/pi-coding-agent').AgentSession | null>}
 */
export async function steerRootSessionWithTarget(hostedSession, text, images) {
    const targetHostedSession = requireHostedSession(hostedSession, "steerRootSessionWithTarget");
    const root = /** @type {any} */ (targetHostedSession.getRootAgentSession());
    return await steerAgentSessionWithTarget(
        root && isExecutionSession(root) ? getExecutionSteeringTarget(root) : root,
        text,
        images,
    );
}

/**
 * Steer the current foreground session if it is streaming, otherwise the streaming root session.
 *
 * @param {import('./hosted-session.js').HostedSession | string} hostedSession
 * @param {string | import('./types.js').ImageAttachment[]} [text]
 * @param {import('./types.js').ImageAttachment[]} [images]
 * @returns {Promise<import('@earendil-works/pi-coding-agent').AgentSession | null>}
 */
export async function steerActiveSessionWithTarget(hostedSession, text, images) {
    const targetHostedSession = requireHostedSession(hostedSession, "steerActiveSessionWithTarget");
    const activeSession = /** @type {any} */ (targetHostedSession.getActiveSteeringTargetSession?.());
    if (activeSession?.isStreaming) return await steerAgentSessionWithTarget(activeSession, text, images);
    return await steerAgentSessionWithTarget(
        /** @type {any} */ (targetHostedSession.getRootAgentSession()),
        text,
        images,
    );
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
 * @param {string} projectRoot
 * @returns {string | undefined}
 */
export function getConfiguredAgentModel(agentName, projectRoot) {
    if (!projectRoot) throw new Error("getConfiguredAgentModel: projectRoot is required");
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
 * @param {string} projectRoot
 * @returns {string | undefined}
 */
export function getConfiguredAgentThinkingLevel(agentName, projectRoot) {
    if (!projectRoot) throw new Error("getConfiguredAgentThinkingLevel: projectRoot is required");
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
 * @param {import('@earendil-works/pi-ai').Model<any>} model
 * @returns {string}
 */
function getTemperatureCapabilityModelKey(model) {
    return [model.provider, model.api, model.id].filter(Boolean).join(":");
}

/**
 * @param {import('@earendil-works/pi-ai').Model<any>} model
 * @returns {boolean}
 */
function isKnownNoSamplingModelFamily(model) {
    const provider = String(model.provider || "").toLowerCase();
    const api = String(model.api || "").toLowerCase();
    const id = String(model.id || "").toLowerCase();
    return provider === "openai-codex" || api === "openai-codex-responses" ||
        provider.includes("kimi") || id.includes("kimi-code") || id.includes("kimi-coding");
}

/**
 * @param {import('@earendil-works/pi-ai').Model<any>} model
 * @returns {boolean}
 */
function isKimiModelFamily(model) {
    const provider = String(model.provider || "").toLowerCase();
    const id = String(model.id || "").toLowerCase();
    return provider.includes("kimi") || id.includes("kimi-code") || id.includes("kimi-coding");
}

/**
 * @param {import('@earendil-works/pi-ai').Model<any>} model
 * @returns {import('@earendil-works/pi-ai').Model<any>}
 */
function withModelCompatibility(model) {
    if (!isKimiModelFamily(model)) return model;
    const compatibleModel = {
        ...model,
        compat: {
            .../** @type {Record<string, unknown> | undefined} */ (model.compat),
            supportsDeveloperRole: false,
            supportsTemperature: false,
        },
    };
    const source = modelSelectionSourceByModel.get(model);
    if (source) modelSelectionSourceByModel.set(compatibleModel, source);
    return compatibleModel;
}

/**
 * The ChatGPT Codex Responses endpoint and some coding-model families reject
 * sampling temperature. Detect known capability signals up front and remember
 * runtime rejections so later calls avoid repeating the failed request.
 *
 * @param {import('@earendil-works/pi-ai').Model<any>} model
 * @returns {boolean}
 */
function modelSupportsTemperature(model) {
    const compat = /** @type {{ supportsTemperature?: unknown } | undefined} */ (model.compat);
    if (compat?.supportsTemperature === false) return false;
    if (isKnownNoSamplingModelFamily(model)) return false;
    return !modelsWithoutTemperature.has(getTemperatureCapabilityModelKey(model));
}

/**
 * Some provider/model APIs reject `temperature` even though pi-ai exposes it as
 * a generic stream option. Retry once without temperature when the provider
 * reports that exact incompatibility before emitting assistant content.
 *
 * @param {import('@earendil-works/pi-ai').AssistantMessageEventStream | Promise<import('@earendil-works/pi-ai').AssistantMessageEventStream>} firstSource
 * @param {() => import('@earendil-works/pi-ai').AssistantMessageEventStream | Promise<import('@earendil-works/pi-ai').AssistantMessageEventStream>} retryWithoutTemperature
 * @param {() => void} [onUnsupportedTemperature]
 * @returns {import('@earendil-works/pi-ai').AssistantMessageEventStream}
 */
function createTemperatureFallbackStream(firstSource, retryWithoutTemperature, onUnsupportedTemperature) {
    const output = createAssistantMessageEventStream();

    /**
     * @param {import('@earendil-works/pi-ai').AssistantMessageEventStream | Promise<import('@earendil-works/pi-ai').AssistantMessageEventStream>} sourcePromise
     * @param {boolean} canRetry
     * @returns {Promise<"retry" | "done">}
     */
    async function forward(sourcePromise, canRetry) {
        let source;
        try {
            source = await sourcePromise;
        } catch (error) {
            if (canRetry && isUnsupportedTemperatureError(error)) {
                onUnsupportedTemperature?.();
                return "retry";
            }
            throw error;
        }
        let emittedAssistantContent = false;
        /** @type {import('@earendil-works/pi-ai').AssistantMessageEvent[]} */
        const pendingLifecycleEvents = [];
        for await (const event of source) {
            if (
                event.type === "error" &&
                !emittedAssistantContent &&
                canRetry &&
                isUnsupportedTemperatureError(event.error)
            ) {
                onUnsupportedTemperature?.();
                return "retry";
            }

            // Providers may emit `start` before reporting request validation
            // errors. Hold it until the first substantive event so a fallback
            // can discard the failed attempt without duplicating lifecycle
            // events in the replacement stream.
            if (event.type === "start") {
                pendingLifecycleEvents.push(event);
                continue;
            }
            for (const pendingEvent of pendingLifecycleEvents.splice(0)) {
                output.push(pendingEvent);
            }
            if (event.type !== "error" && event.type !== "done") {
                emittedAssistantContent = true;
            }
            output.push(event);
        }
        for (const pendingEvent of pendingLifecycleEvents) {
            output.push(pendingEvent);
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
 * @param {string} projectRoot
 * @returns {number | undefined}
 */
export function getConfiguredAgentTemperature(agentName, projectRoot) {
    if (!projectRoot) throw new Error("getConfiguredAgentTemperature: projectRoot is required");
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
    const agent = /** @type {any} */ (session.agent);
    const streamKey = typeof agent.streamFunction === "function" ? "streamFunction" : "streamFn";
    const originalStreamFunction = agent[streamKey];
    agent[streamKey] = (
        /** @type {import('@earendil-works/pi-ai').Model<any>} */ model,
        /** @type {import('@earendil-works/pi-ai').Context} */ context,
        /** @type {import('@earendil-works/pi-ai').SimpleStreamOptions | undefined} */ options,
    ) => {
        if (!modelSupportsTemperature(model)) {
            return originalStreamFunction(model, context, omitTemperatureOption(options));
        }
        const optionsWithTemperature = {
            ...options,
            temperature,
        };
        try {
            const firstSource = originalStreamFunction(model, context, optionsWithTemperature);
            return createTemperatureFallbackStream(
                firstSource,
                () => originalStreamFunction(model, context, omitTemperatureOption(options)),
                () => modelsWithoutTemperature.add(getTemperatureCapabilityModelKey(model)),
            );
        } catch (error) {
            if (isUnsupportedTemperatureError(error)) {
                modelsWithoutTemperature.add(getTemperatureCapabilityModelKey(model));
                return originalStreamFunction(model, context, omitTemperatureOption(options));
            }
            throw error;
        }
    };
}

/** @type {WeakMap<object, Set<string>>} */
const emittedAgentModelFallbacks = new WeakMap();

/**
 * @param {import('./hosted-session.js').HostedSession | undefined} hostedSession
 * @param {string} agentName
 * @param {string} displayName
 * @param {string} engineerModel
 */
function emitAgentModelFallback(hostedSession, agentName, displayName, engineerModel) {
    const key = `${agentName}\u0000${engineerModel}`;
    if (hostedSession) {
        let emitted = emittedAgentModelFallbacks.get(hostedSession);
        if (!emitted) {
            emitted = new Set();
            emittedAgentModelFallbacks.set(hostedSession, emitted);
        }
        if (emitted.has(key)) return;
        emitted.add(key);
    }
    const subject = agentName === AGENTS.REVIEWER_FEEDBACK_ENGINEER ? "The repair Engineer" : displayName;
    emitSystemStatus(
        hostedSession,
        `${subject} is using the Engineer model: ${engineerModel}.`,
        { level: "info", header: "RunWield" },
    );
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
 * @param {string} [projectRoot]
 * @param {{ ignoreManualModelOverride?: boolean }} [options]
 *
 * @returns {Promise<any>}
 */
async function resolveModel(
    modelOverride,
    agentDef,
    agentName,
    modelRegistry = getModelRegistry(),
    hostedSession = undefined,
    projectRoot = hostedSession?.cwd,
    options = {},
) {
    let resolvedModel = null;
    if (!projectRoot) throw new Error("resolveModel: projectRoot is required");
    const metricProjectRoot = projectRoot;
    /** @param {Parameters<typeof recordWorkflowMetric>[0]} metric */
    function recordModelMetric(metric) {
        return recordWorkflowMetric(metric, metricProjectRoot);
    }

    /** @type {Array<{ model: string, source: string, strict: boolean }>} */
    const candidateModels = [];

    // A manual choice is scoped to the current Agent. Build a replacement
    // without borrowing that choice, while retaining it if construction fails.
    const activeModelState = hostedSession?.getActiveModelState?.() || { model: "", provider: "" };
    const activeAgentName = hostedSession?.getRootAgentName?.() ||
        readPersistedActiveAgentName(hostedSession?.getRootSessionManager?.() || undefined) ||
        hostedSession?.getActiveAgentInfo?.()?.agentName;
    const sameAgent = !activeAgentName || !agentName ||
        normalizeAgentInternalName(activeAgentName) === normalizeAgentInternalName(agentName);
    if (
        !options.ignoreManualModelOverride && activeModelState.model && hostedSession?.isUserModelOverride?.() &&
        sameAgent
    ) {
        candidateModels.push({
            model: formatProviderModelReference(activeModelState),
            source: "manual /model override",
            strict: true,
        });
    }

    if (modelOverride) {
        candidateModels.push({ model: modelOverride, source: "invocation model override", strict: true });
    }

    // Config-driven per-agent model override (agents.<name>.model or active preset)
    if (agentName) {
        const configuredModel = getConfiguredAgentModel(agentName, projectRoot);
        if (configuredModel) {
            candidateModels.push({
                model: configuredModel,
                source: `settings model for agent "${agentName}"`,
                strict: true,
            });
        } else if (candidateModels.length === 0 && agentName.toLowerCase() !== "engineer") {
            const engineerModel = getConfiguredAgentModel("engineer", projectRoot);
            if (engineerModel) {
                emitAgentModelFallback(
                    hostedSession || undefined,
                    agentName,
                    agentDef.displayName || agentName,
                    engineerModel,
                );
                candidateModels.push({
                    model: engineerModel,
                    source: `Engineer fallback model for agent "${agentName}"`,
                    strict: true,
                });
            }
        }
    }

    // Settings default is still a settings value, so it wins over layered agent definitions.
    const settingsManager = getSettingsManager(projectRoot);
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
                found = await discoverProviderModel(
                    modelRegistry,
                    parsed.provider,
                    parsed.id,
                    SYSTEM_MODEL_DISCOVERY_NETWORK,
                );
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

        const authConfigured = modelRegistry.hasConfiguredAuth(found);
        const selectable = typeof modelRegistry.isSelectable === "function"
            ? modelRegistry.isSelectable(found)
            : authConfigured;
        if (!selectable) {
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
                    authConfigured,
                    selectable: false,
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
                authConfigured,
                selectable: true,
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
 * @param {string} text
 * @returns {string}
 */
function removePromptPlaceholders(text) {
    return String(text || "").replace(/{{[A-Z0-9_]+}}/g, "");
}

/**
 * @param {SystemPromptContextProjectionOptions} options
 * @returns {string}
 */
function resolvePromptSessionName(options) {
    const names = [
        options.sessionName,
        options.hostedSession?.getRootSessionManager?.()?.getSessionName?.(),
        options.sessionManager?.getSessionName?.(),
    ];
    for (const value of names) {
        const name = sanitizeSessionName(value || "");
        if (name) return name;
    }
    return "";
}

/**
 * @param {string[]} tools
 * @param {SystemPromptContextProjectionOptions} options
 * @returns {string}
 */
function buildSessionNameReminder(tools, options) {
    if (!tools.includes("set_session_name")) return "";
    if (resolvePromptSessionName(options)) return "";
    return "If this Session is unnamed, call `set_session_name` early with a short descriptive name.";
}

/**
 * @param {string} label
 * @param {string} text
 * @param {Partial<import('./session-context-report.js').ContextProjectionItem>} [extra]
 * @returns {import('./session-context-report.js').ContextProjectionItem | null}
 */
function createContextProjectionItem(label, text, extra = {}) {
    const tokens = estimateContextTextTokens(text);
    if (tokens <= 0) return null;
    return { label, tokens, ...extra };
}

/**
 * @param {import('@earendil-works/pi-coding-agent').ToolDefinition[]} toolDefinitions
 * @returns {Map<string, import('@earendil-works/pi-coding-agent').ToolDefinition>}
 */
function mapToolDefinitionsByName(toolDefinitions) {
    const map = new Map();
    for (const tool of toolDefinitions) {
        if (tool?.name) map.set(tool.name, tool);
    }
    return map;
}

/**
 * Estimate the resident provider tool context for one effective ToolDefinition.
 * Keep this text local to attribution only: reports expose token counts and tool names,
 * not schemas or prompt snippets.
 *
 * @param {string} name
 * @param {import('@earendil-works/pi-coding-agent').ToolDefinition | undefined} tool
 * @param {string} fallbackDescription
 * @returns {string}
 */
function serializeToolContextForProjection(name, tool, fallbackDescription) {
    const parts = [`Tool: ${name}`];
    const label = typeof tool?.label === "string" && tool.label ? tool.label : "";
    if (label && label !== name) parts.push(`Label: ${label}`);
    const description = typeof tool?.description === "string" && tool.description
        ? tool.description
        : fallbackDescription;
    if (description) parts.push(`Description: ${description}`);
    if (typeof tool?.promptSnippet === "string" && tool.promptSnippet) {
        parts.push(`Prompt snippet: ${tool.promptSnippet}`);
    }
    if (Array.isArray(tool?.promptGuidelines) && tool.promptGuidelines.length > 0) {
        parts.push(`Prompt guidelines: ${tool.promptGuidelines.join("\n- ")}`);
    }
    const parametersText = stringifyToolParameters(tool?.parameters);
    if (parametersText) parts.push(`Parameters schema: ${parametersText}`);
    return parts.join("\n");
}

/**
 * @param {unknown} parameters
 * @returns {string}
 */
function stringifyToolParameters(parameters) {
    if (!parameters) return "";
    const seen = new WeakSet();
    try {
        return JSON.stringify(parameters, (_key, value) => {
            if (typeof value === "function") return undefined;
            if (typeof value === "object" && value !== null) {
                if (seen.has(value)) return "[Circular]";
                seen.add(value);
            }
            return value;
        });
    } catch {
        return "";
    }
}

/**
 * @param {string} cwd
 * @returns {Promise<{ text: string, path: string, source: "local" } | null>}
 */
async function readProjectInstructionFile(cwd) {
    for (const path of [join(cwd, "RUNWIELD.md"), join(cwd, "AGENTS.md")]) {
        try {
            return { text: await Deno.readTextFile(path), path, source: "local" };
        } catch {
            // Try next candidate.
        }
    }
    return null;
}

/**
 * @param {string} homeDir
 * @returns {Promise<{ text: string, path: string, source: "home" | "external" } | null>}
 */
async function readGlobalInstructionFile(homeDir) {
    for (const path of getGlobalAgentMdPaths(homeDir)) {
        try {
            const source = path === join(homeDir, ".agents", "AGENTS.md")
                ? /** @type {"external"} */ ("external")
                : /** @type {"home"} */ ("home");
            return { text: await Deno.readTextFile(path), path, source };
        } catch {
            // Try next candidate.
        }
    }
    return null;
}

/**
 * @typedef {Object} SystemPromptContextProjectionOptions
 * @property {string} [homeDir]
 * @property {import('./hosted-session.js').HostedSession} [hostedSession]
 * @property {import('@earendil-works/pi-coding-agent').SessionManager} [sessionManager]
 * @property {string} [sessionName]
 */

/**
 * Assemble the final system prompt and resident-context projection by resolving placeholders.
 *
 * @param {import('./types.js').AgentDefinition} agentDef
 * @param {string[]} tools
 * @param {import('@earendil-works/pi-coding-agent').ToolDefinition[]} finalCustomTools
 * @param {string | undefined} cwd
 * @param {string} [projectStateContext]
 * @param {SystemPromptContextProjectionOptions} [options]
 * @returns {Promise<{ prompt: string, projection: import('./session-context-report.js').SessionContextProjection }>}
 */
export async function assembleFinalSystemPromptWithContextProjection(
    agentDef,
    tools,
    finalCustomTools,
    cwd,
    projectStateContext = "",
    options = {},
) {
    if (!cwd) throw new Error("assembleFinalSystemPrompt: cwd is required");
    const piTools = [
        createBashToolDefinition(cwd),
        createGrepToolDefinition(cwd),
        createFindToolDefinition(cwd),
        createLsToolDefinition(cwd),
        createReadToolDefinition(cwd),
        wrapPlanSafeFileTool(createWriteToolDefinition(cwd), { cwd, mode: "write" }),
        wrapPlanSafeFileTool(createEditToolDefinition(cwd), { cwd, mode: "edit" }),
    ];

    const extensionTools = [
        memoryToolDef,
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
        webSearchToolDef,
        webFetchToolDef,
        webCodeSearchToolDef,
        webDocsSearchToolDef,
    ];

    let finalSystemPrompt = agentDef.systemPrompt;
    const hasGlobalAgentsPlaceholder = finalSystemPrompt.includes("{{GLOBAL_AGENTSMD}}");
    const hasProjectAgentsPlaceholder = finalSystemPrompt.includes("{{PROJECT_AGENTSMD}}");
    const hasProjectStatePlaceholder = finalSystemPrompt.includes("{{PROJECT_STATE_CONTEXT}}");
    const hasMemoriesPlaceholder = finalSystemPrompt.includes("{{MEMORIES}}");
    const hasSkillsPlaceholder = finalSystemPrompt.includes("{{SKILLS}}");
    const hasImageAttachmentsPlaceholder = finalSystemPrompt.includes("{{IMAGE_ATTACHMENTS_SECTION}}");
    const hasBundledAgentDefsPlaceholder = finalSystemPrompt.includes("{{BUNDLED_AGENT_DEFS_DIR}}");

    finalSystemPrompt = finalSystemPrompt.replace(
        "{{SESSION_NAME_REMINDER}}",
        buildSessionNameReminder(tools, options),
    );

    const effectiveToolMap = mapToolDefinitionsByName([...piTools, ...extensionTools, ...finalCustomTools]);
    const customToolMap = new Map();
    for (const [name, tool] of effectiveToolMap.entries()) {
        customToolMap.set(name, tool.promptSnippet || tool.description);
    }

    const toolItems = tools.map((t) => {
        const desc = customToolMap.get(t) || "Built-in tool";
        const line = `- ${t} - ${desc}`;
        const schemaText = serializeToolContextForProjection(t, effectiveToolMap.get(t), desc);
        return { line, item: createContextProjectionItem(t, schemaText, { name: t }) };
    });
    const availableToolsStr = toolItems.map((tool) => tool.line).join("\n");
    finalSystemPrompt = finalSystemPrompt?.replace("{{AVAILABLE_TOOLS}}", availableToolsStr);

    /** @type {import('./session-context-report.js').ContextProjectionItem[]} */
    const instructionItems = [];
    let globalAgentsMd = "";
    const homeDir = options.homeDir || getHomeDir();
    if (hasGlobalAgentsPlaceholder && homeDir) {
        const globalFile = await readGlobalInstructionFile(homeDir);
        if (globalFile) {
            globalAgentsMd = globalFile.text;
            const item = createContextProjectionItem(globalFile.path, globalFile.text, {
                path: globalFile.path,
                source: globalFile.source,
            });
            if (item) instructionItems.push(item);
        }
    }
    finalSystemPrompt = finalSystemPrompt.replace("{{GLOBAL_AGENTSMD}}", globalAgentsMd);

    let projectAgentsMd = "";
    if (hasProjectAgentsPlaceholder) {
        const projectFile = await readProjectInstructionFile(cwd);
        if (projectFile) {
            projectAgentsMd = projectFile.text;
            const item = createContextProjectionItem(projectFile.path, projectFile.text, {
                path: projectFile.path,
                source: projectFile.source,
            });
            if (item) instructionItems.push(item);
        }
    }
    finalSystemPrompt = finalSystemPrompt.replace("{{PROJECT_AGENTSMD}}", projectAgentsMd);

    const gitPromptState = hasProjectStatePlaceholder ? await readGitPromptState(cwd) : null;
    const projectStateSections = [];
    if (projectStateContext) projectStateSections.push(["### Project State", "", projectStateContext].join("\n"));
    if (gitPromptState) projectStateSections.push(formatGitPromptState(gitPromptState));
    const projectStateContextSection = hasProjectStatePlaceholder && projectStateSections.length > 0
        ? `${projectStateSections.join("\n\n")}\n`
        : "";
    finalSystemPrompt = finalSystemPrompt.replace("{{PROJECT_STATE_CONTEXT}}", projectStateContextSection);

    let memories = "";
    if (hasMemoriesPlaceholder) {
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
    }
    finalSystemPrompt = finalSystemPrompt.replace("{{MEMORIES}}", memories);

    let skillsBlock = "";
    /** @type {import('./session-context-report.js').ContextProjectionItem[]} */
    const skillItems = [];
    if (hasSkillsPlaceholder) {
        try {
            const skills = await listSkills({ cwd });
            const visibleSkills = skills.filter((skill) =>
                skill.name && skill.description && !skill.disableModelInvocation
            );
            skillsBlock = visibleSkills
                .map((skill) => {
                    const line = `- ${skill.name} - ${skill.description} (read: ${skill.path})`;
                    const item = createContextProjectionItem(skill.name, line, {
                        name: skill.name,
                        path: skill.path,
                        source: skill.source,
                    });
                    if (item) skillItems.push(item);
                    return line;
                })
                .join("\n");
        } catch {
            skillsBlock = "";
        }
    }
    finalSystemPrompt = finalSystemPrompt.replace("{{SKILLS}}", skillsBlock);

    // Conditionally include the Image Attachments section only when see_image is available
    // (i.e. the active model is text-only with a vision fallback configured).
    const imageAttachmentsSection = hasImageAttachmentsPlaceholder && tools.includes("see_image")
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
    const bundledAgentDefsPath = hasBundledAgentDefsPlaceholder ? await getBundledAgentDefsPath() : "";
    finalSystemPrompt = finalSystemPrompt.replace("{{BUNDLED_AGENT_DEFS_DIR}}", bundledAgentDefsPath);

    // Append timezone so LLMs can reconcile the midnight boundary between the
    // local date (pi-coding-agent's "Current date: YYYY-MM-DD") and UTC timestamps
    // in session data and memories. No duplicated date line — pi-coding-agent's
    // buildSystemPrompt already appends that after this function returns.
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const timezoneLine = `Timezone: ${tz}`;
    finalSystemPrompt += `\n${timezoneLine}`;

    const agentText = [
        removePromptPlaceholders(agentDef.systemPrompt),
        imageAttachmentsSection,
        bundledAgentDefsPath,
        timezoneLine,
    ].filter(Boolean).join("\n");
    const agentInstructionsItem = createContextProjectionItem("Agent Definition", agentText, { source: "agent" });
    const memoriesItem = createContextProjectionItem("Core Memories", memories, { source: "mnemosyne" });
    const projectStateItem = createContextProjectionItem("Project State", projectStateContextSection, {
        source: "runtime",
    });

    const projection = createSessionContextProjection([
        {
            id: "agent_instructions",
            label: "Agent instructions",
            tokens: agentInstructionsItem?.tokens || 0,
            items: agentInstructionsItem ? [agentInstructionsItem] : [],
        },
        {
            id: "tools",
            label: "Tools",
            tokens: toolItems.reduce((sum, tool) => sum + (tool.item?.tokens || 0), 0),
            items: /** @type {import('./session-context-report.js').ContextProjectionItem[]} */ (
                toolItems.map((tool) => tool.item).filter(Boolean)
            ),
        },
        {
            id: "instruction_files",
            label: "Instruction files",
            tokens: instructionItems.reduce((sum, item) => sum + item.tokens, 0),
            items: instructionItems,
        },
        {
            id: "core_memories",
            label: "Core Memories",
            tokens: memoriesItem?.tokens || 0,
            items: memoriesItem ? [memoriesItem] : [],
        },
        {
            id: "skill_catalog",
            label: "Skill catalog",
            tokens: estimateContextTextTokens(skillsBlock),
            items: skillItems,
        },
        {
            id: "project_state",
            label: "Project State",
            tokens: projectStateItem?.tokens || 0,
            items: projectStateItem ? [projectStateItem] : [],
        },
    ]);

    return { prompt: finalSystemPrompt, projection };
}

/**
 * Assemble the final system prompt by resolving placeholders.
 *
 * @param {import('./types.js').AgentDefinition} agentDef
 * @param {string[]} tools
 * @param {import('@earendil-works/pi-coding-agent').ToolDefinition[]} finalCustomTools
 * @param {string} [cwd]
 * @param {string} [projectStateContext]
 * @param {SystemPromptContextProjectionOptions} [options]
 * @returns {Promise<string>}
 */
export async function assembleFinalSystemPrompt(
    agentDef,
    tools,
    finalCustomTools,
    cwd,
    projectStateContext = "",
    options = {},
) {
    const result = await assembleFinalSystemPromptWithContextProjection(
        agentDef,
        tools,
        finalCustomTools,
        cwd,
        projectStateContext,
        options,
    );
    return result.prompt;
}

/**
 * @param {unknown} entry
 * @returns {{ version: number, compactInvocation: string, expandedRequest: string } | null}
 */
function readNamedInvocationContextEntry(entry) {
    if (!entry || typeof entry !== "object") return null;
    const value =
        /** @type {{ type?: string, customType?: string, data?: { version?: number, compactInvocation?: string, expandedRequest?: string } }} */ (entry);
    if (value.type !== "custom" || value.customType !== "runwield.named_invocation") return null;
    if (value.data?.version !== 1) return null;
    if (typeof value.data.compactInvocation !== "string" || typeof value.data.expandedRequest !== "string") return null;
    return {
        version: value.data.version,
        compactInvocation: value.data.compactInvocation,
        expandedRequest: value.data.expandedRequest,
    };
}

/**
 * @typedef {Object} TextMessageContentBlock
 * @property {string} [type]
 * @property {string} [text]
 */

/**
 * @typedef {Object} MessageWithEditableContent
 * @property {string | TextMessageContentBlock[]} [content]
 */

/** @param {MessageWithEditableContent | undefined} message */
function messageText(message) {
    const content = message?.content;
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content.filter((block) => block?.type === "text").map((block) => block.text || "").join("");
}

/**
 * @param {MessageWithEditableContent | undefined} message
 * @param {string} text
 */
function replaceMessageText(message, text) {
    if (!message || typeof message !== "object") return;
    const content = message.content;
    if (!Array.isArray(content)) {
        message.content = [{ type: "text", text }];
        return;
    }
    const nonText = content.filter((block) => block?.type !== "text");
    message.content = [{ type: "text", text }, ...nonText];
}

/**
 * @typedef {Object} NamedInvocationContextEntry
 * @property {string} [id]
 * @property {string} [type]
 * @property {string} [firstKeptEntryId]
 * @property {{ role?: string }} [message]
 */

/**
 * @param {NamedInvocationContextEntry[]} entries
 * @returns {NamedInvocationContextEntry[]}
 */
function namedInvocationExpansionEntries(entries) {
    const compactionIndex = entries.findLastIndex((entry) => entry.type === "compaction");
    if (compactionIndex < 0) return entries;

    const compaction = entries[compactionIndex];
    const contextEntries = [compaction];
    let foundFirstKept = false;
    for (let index = 0; index < compactionIndex; index += 1) {
        const entry = entries[index];
        if (entry.id === compaction.firstKeptEntryId) foundFirstKept = true;
        if (foundFirstKept) contextEntries.push(entry);
    }
    contextEntries.push(...entries.slice(compactionIndex + 1));
    return contextEntries;
}

/**
 * @param {import('@earendil-works/pi-coding-agent').AgentSession} session
 * @param {import('@earendil-works/pi-coding-agent').SessionManager} sessionManager
 */
function applyNamedInvocationExpansionToPiSession(session, sessionManager) {
    const stateMessages = session?.agent?.state?.messages;
    if (!Array.isArray(stateMessages)) return;
    const entries = sessionManager?.getBranch?.() || sessionManager?.getEntries?.() || [];
    if (!Array.isArray(entries)) return;
    const activeEntries = namedInvocationExpansionEntries(/** @type {NamedInvocationContextEntry[]} */ (entries));
    /** @type {{ version: number, compactInvocation: string, expandedRequest: string } | null} */
    let pending = null;
    let stateIndex = 0;
    for (const entry of activeEntries) {
        const named = readNamedInvocationContextEntry(entry);
        if (named) {
            pending = named;
            continue;
        }
        if (entry.type !== "message") continue;
        if (!pending || entry.message?.role !== "user") {
            pending = null;
            continue;
        }
        const currentPending = pending;
        const matchIndex = stateMessages.findIndex((message, index) =>
            index >= stateIndex && message?.role === "user" &&
            messageText(/** @type {MessageWithEditableContent | undefined} */ (message)) ===
                currentPending.compactInvocation
        );
        if (matchIndex >= 0) {
            replaceMessageText(
                /** @type {MessageWithEditableContent | undefined} */ (stateMessages[matchIndex]),
                currentPending.expandedRequest,
            );
            stateIndex = matchIndex + 1;
        }
        pending = null;
    }
}

/**
 * Build a configured AgentSession for the given agent without running a prompt.
 *
 * Used by:
 *  - runRootTurn's initial root construction (via ensureRootAgentSession in chat-session)
 *  - runIsolatedAgentSession's transient sub-agent path
 *
 * @param {Object} opts
 * @param {import('./hosted-session.js').HostedSession} [opts.hostedSession]
 * @param {string} opts.agentName
 * @param {string[]} [opts.toolNames]
 * @param {import('@earendil-works/pi-coding-agent').ToolDefinition[]} [opts.customTools]
 * @param {string} [opts.modelOverride]
 * @param {"off"|"minimal"|"low"|"medium"|"high"|"xhigh"|"max"} [opts.thinkingLevelOverride]
 * @param {import('@earendil-works/pi-coding-agent').SessionManager} [opts.sessionManager]
 * @param {import('../../tools/plan-written.ts').TriageMeta} [opts.triageMeta]
 * @param {{ id: import('./subagent-definitions.ts').SubAgentDefinitionId, options?: import('./subagent-definitions.ts').LoadSubAgentDefinitionOptions }} [opts.subAgentDefinition]
 * @param {string} [opts.cwd] - Execution cwd for file tools and agent operations. Defaults to primary project root.
 * @param {string} [opts.debugLogPath] - Optional DEBUG log destination for this invocation.
 * @param {string} [opts.projectStateContext] - Optional session-scoped project state note for the system prompt.
 * @param {boolean} [opts.includeEditFallback] - Internal: whether to register the edit fallback custom tool.
 * @param {boolean} [opts.workflowAuthority] - False for one-turn auxiliary Prompt Template sessions.
 * @param {boolean} [opts.ignoreManualModelOverride] - True when invocation policy must not borrow root /model state.
 * @param {boolean} [opts.updateHostedThinkingLevel] - False when thinking is temporary and must not update root footer state.
 * @param {boolean} [opts.persistModelChange] - False for temporary Claude CLI turns that must not append a root model marker.
 * @param {boolean} [opts.disableAutoCompaction] - True when a temporary turn must fail instead of compacting root context.
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
 *   contextProjection: import('./session-context-report.js').SessionContextProjection,
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
    thinkingLevelOverride,
    sessionManager,
    triageMeta,
    subAgentDefinition,
    cwd,
    debugLogPath,
    projectStateContext,
    includeEditFallback,
    workflowAuthority,
    ignoreManualModelOverride,
    updateHostedThinkingLevel,
}) {
    const targetHostedSession = hostedSession ? requireHostedSession(hostedSession, "buildAgentSession") : null;
    const sessionCwd = cwd || targetHostedSession?.cwd;
    if (!sessionCwd) throw new Error("buildAgentSession: cwd or hostedSession cwd is required");
    await ensureMnemosyneBinary();
    await ensureCymbalBinary();
    const agentDef = subAgentDefinition
        ? await loadSubAgentDefinition(subAgentDefinition.id, subAgentDefinition.options)
        : await loadAgentDef(agentName, sessionCwd);

    const modelRuntime = await getModelRuntime();
    const modelRegistry = getModelRegistry();
    const resolvedModel = withModelCompatibility(
        await resolveModel(
            modelOverride,
            agentDef,
            agentName,
            modelRegistry,
            targetHostedSession || undefined,
            sessionCwd,
            { ignoreManualModelOverride: ignoreManualModelOverride === true },
        ),
    );
    assertModelExecutionBackendSupported(resolvedModel);
    const activeModelSupportsImages = modelSupportsImageInput(resolvedModel);
    const visionFallback = activeModelSupportsImages
        ? undefined
        : await resolveVisionFallbackModel(modelRegistry, SYSTEM_MODEL_DISCOVERY_NETWORK);
    const effectiveSessionManager = sessionManager || SessionManager.inMemory(sessionCwd);

    const customToolNames = (customTools || []).map((t) => t.name);
    const parentDelegableTools = filterWorkflowAdvancementTools(
        resolveEffectiveSessionToolNames(agentDef.tools, toolNames, []),
        workflowAuthority === false,
    );
    let tools = filterWorkflowAdvancementTools(
        resolveEffectiveSessionToolNames(agentDef.tools, toolNames, customToolNames),
        workflowAuthority === false,
    );

    const finalCustomTools = filterCustomWorkflowAdvancementTools(customTools || [], workflowAuthority === false);
    if (!activeModelSupportsImages && visionFallback && !tools.includes("see_image")) {
        tools = [...tools, "see_image"];
    }

    // Auto-wire internal custom tools if requested by name and not already provided.
    // This keeps agent frontmatter declarative: adding/removing tool names controls availability,
    // while RunWield runtime injects the concrete tool implementations.

    if (
        tools.includes("plan_written") && targetHostedSession &&
        !finalCustomTools.find((t) => t.name === "plan_written")
    ) {
        const { createPlanWrittenTool } = await import("../../tools/plan-written.ts");
        finalCustomTools.push(
            createPlanWrittenTool({
                triageMeta,
                agentName,
                hostedSession: targetHostedSession || undefined,
            }),
        );
    }

    if (
        tools.includes("artifact_written") && targetHostedSession &&
        !finalCustomTools.find((t) => t.name === "artifact_written")
    ) {
        const { createArtifactWrittenTool } = await import("../../tools/artifact-written.ts");
        finalCustomTools.push(createArtifactWrittenTool({ hostedSession: targetHostedSession, agentName }));
    }

    if (tools.includes("triage_report") && !finalCustomTools.find((t) => t.name === "triage_report")) {
        const { createTriageReportTool } = await import("../../tools/triage-report.ts");
        finalCustomTools.push(createTriageReportTool({ hostedSession: targetHostedSession || undefined }));
    }

    if (tools.includes("set_session_name") && !finalCustomTools.find((t) => t.name === "set_session_name")) {
        const { createSetSessionNameTool } = await import("../../tools/set-session-name.ts");
        finalCustomTools.push(createSetSessionNameTool({ hostedSession: targetHostedSession || undefined }));
    }

    if (tools.includes("user_interview") && !finalCustomTools.find((t) => t.name === "user_interview")) {
        finalCustomTools.push(createUserInterviewTool({ hostedSession: targetHostedSession || undefined }));
    }

    const workRecordAccessMode = [AGENTS.GUIDE, AGENTS.RECORDER].includes(agentName) ? "all" : "current";
    if (tools.includes("work_record_search") && !finalCustomTools.find((t) => t.name === "work_record_search")) {
        const { createWorkRecordSearchTool } = await import("../../tools/work-record-search.ts");
        const { SYSTEM_WORK_RECORD_MNEMOSYNE_PORT } = await import("../work-records/mnemosyne-port.ts");
        finalCustomTools.push(createWorkRecordSearchTool({
            cwd: sessionCwd,
            accessMode: workRecordAccessMode,
            mnemosynePort: SYSTEM_WORK_RECORD_MNEMOSYNE_PORT,
        }));
    }
    if (tools.includes("work_record_read") && !finalCustomTools.find((t) => t.name === "work_record_read")) {
        const { createWorkRecordReadTool } = await import("../../tools/work-record-read.ts");
        finalCustomTools.push(createWorkRecordReadTool({ cwd: sessionCwd, accessMode: workRecordAccessMode }));
    }

    if (
        tools.includes("task_completed") && targetHostedSession &&
        !finalCustomTools.find((t) => t.name === "task_completed")
    ) {
        const { createTaskCompletedTool } = await import("../../tools/task-completed.ts");
        finalCustomTools.push(
            createTaskCompletedTool({ hostedSession: targetHostedSession, agentName: agentDef.displayName }),
        );
    }

    if (
        tools.includes("review_complete") && targetHostedSession &&
        !finalCustomTools.find((t) => t.name === "review_complete")
    ) {
        const { createReviewCompletedTool } = await import("../../tools/review-complete.ts");
        finalCustomTools.push(
            createReviewCompletedTool({ hostedSession: targetHostedSession, agentName: agentDef.displayName }),
        );
    }

    if (
        tools.includes("delegate_agent") && targetHostedSession &&
        !finalCustomTools.find((t) => t.name === "delegate_agent")
    ) {
        const { createDelegateAgentTool } = await import("../../tools/delegate-agent.ts");
        finalCustomTools.push(createDelegateAgentTool({
            hostedSession: targetHostedSession,
            cwd: sessionCwd,
            parentTools: parentDelegableTools,
            runIsolatedAgentSession,
        }));
    }

    // Override the built-in read tool to block Git internals and unsafe binary/control-byte output.
    if (!finalCustomTools.find((t) => t.name === "read")) {
        finalCustomTools.push(createRunWieldReadToolDefinition(sessionCwd));
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
        const { createMultiFileEditTool } = await import("../../tools/multi_file_edit.ts");
        finalCustomTools.push(createMultiFileEditTool(sessionCwd));
    }

    if (tools.includes("write_docs") && !finalCustomTools.find((t) => t.name === "write_docs")) {
        finalCustomTools.push(createWriteDocsToolDefinition(sessionCwd));
    }

    if (tools.includes("edit_docs") && !finalCustomTools.find((t) => t.name === "edit_docs")) {
        finalCustomTools.push(createEditDocsToolDefinition(sessionCwd));
    }

    if (tools.includes("see_image") && visionFallback && !finalCustomTools.find((t) => t.name === "see_image")) {
        finalCustomTools.push(createSeeImageTool({
            cwd: sessionCwd,
            sessionManager: effectiveSessionManager,
            fallbackModel: visionFallback.model,
            completeSimpleFn: completeSimple,
        }));
    }

    // Resolve system prompt placeholders
    const { prompt: finalSystemPrompt, projection: contextProjection } =
        await assembleFinalSystemPromptWithContextProjection(
            agentDef,
            tools,
            finalCustomTools,
            sessionCwd,
            projectStateContext,
            {
                hostedSession: targetHostedSession || undefined,
                sessionManager: effectiveSessionManager,
            },
        );
    const promptState = {
        text: workflowAuthority === false
            ? `${finalSystemPrompt}\n\n${NO_WORKFLOW_AUTHORITY_PROMPT}`
            : finalSystemPrompt,
    };
    const packagePromptResources = await resolveInstalledPackagePromptResources({ cwd: sessionCwd }).catch(() => []);
    const packageExtensionResources = await resolveInstalledWldExtensionResources({ cwd: sessionCwd }).catch(() => []);
    const extensionFactories = [
        mnemosyneExtension,
        cymbalExtension,
        ketchExtension,
        // Re-anchoring is per-agent-session: the agent identity is fixed here, and
        // the Plan pointer is read from live session state at compaction time.
        (/** @type {import('@earendil-works/pi-coding-agent').ExtensionAPI} */ pi) =>
            reAnchorExtension(pi, { agentName, hostedSession: targetHostedSession }),
    ];
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
        modelRuntime,
        settingsManager: getSettingsManager(sessionCwd),
        tools,
        customTools: finalCustomTools,
        resourceLoader: loader,
        sessionManager: effectiveSessionManager,
        ...(resolvedModel ? { model: resolvedModel } : {}),
    });
    applyNamedInvocationExpansionToPiSession(session, effectiveSessionManager);
    /** @type {any} */ (session).runWieldModelRegistry = modelRegistry;
    installEarlySteeringInterruption(/** @type {any} */ (session));
    installEngineerAutoCompactionThreshold(session, agentName);
    installTaskCompletedAutoCompactionExclusion(session);

    const configuredTemperature = agentName ? getConfiguredAgentTemperature(agentName, sessionCwd) : undefined;
    const temperatureSource = configuredTemperature !== undefined ? "settings agent temperature" : (
        agentDef.temperature !== undefined ? "agent definition temperature" : undefined
    );
    const resolvedTemperature = configuredTemperature ?? agentDef.temperature;
    applySessionTemperature(session, resolvedTemperature);

    if (extensionsResult?.errors?.length) {
        for (const err of extensionsResult.errors) {
            const msg = `[RunWield] Extension warning (${err.path}): ${err.error}`;
            emitSystemStatus(targetHostedSession || undefined, msg, { level: "warning" });
            if (String(err.error).toLowerCase().includes("mnemosyne")) {
                const msg2 =
                    "[RunWield] Memory extension issue detected. Rerun the RunWield installer to install required runtime helpers: curl -fsSL https://raw.githubusercontent.com/gandazgul/runwield/main/install.sh | bash";
                emitSystemStatus(targetHostedSession || undefined, msg2, { level: "warning" });
            }
        }
    }

    // Apply thinking level — invocation overrides take priority for isolated delegated sessions.
    const { resolvedThinkingLevel, thinkingLevelSource } = resolveExecutionThinkingLevel({
        agentName,
        cwd: sessionCwd,
        agentDef,
        thinkingLevelOverride,
    });
    if (resolvedThinkingLevel) {
        assertThinkingLevelSupportedForInvocation(
            resolvedModel,
            resolvedThinkingLevel,
            Boolean(thinkingLevelOverride && workflowAuthority === false),
        );
        session.setThinkingLevel(
            /** @type {import('@earendil-works/pi-agent-core').ThinkingLevel} */ (resolvedThinkingLevel),
        );
        // Keep the HostedSession footer in sync with what the root AgentSession is using.
        if (updateHostedThinkingLevel !== false) {
            targetHostedSession?.setThinkingLevel(
                /** @type {"off"|"minimal"|"low"|"medium"|"high"|"xhigh"|"max"|"max"} */ (resolvedThinkingLevel),
            );
        }
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
    }, sessionCwd);
    return {
        session,
        agentDef,
        promptState,
        tools,
        finalCustomTools,
        resolvedModel,
        resolvedThinkingLevel,
        resolvedTemperature,
        contextProjection,
        imageMode,
        visionFallbackModelRef: visionFallback?.modelRef,
    };
}

/**
 * Compose the eligible RunWield lifecycle Tool Definitions for a Claude CLI
 * execution session: the intersection of the Agent Definition's declared tools
 * with plan_written / task_completed / review_complete, instantiated with the
 * same factories Pi uses. Returned in `finalCustomTools` so existing root
 * configuration checks remain valid while Pi wiring stays unchanged.
 *
 * @param {{
 *   agentDef: import('./types.js').AgentDefinition,
 *   agentName: string,
 *   hostedSession: import('./hosted-session.js').HostedSession | null,
 *   triageMeta: import('../../tools/plan-written.ts').TriageMeta | undefined,
 *   cwd: string,
 *   customTools?: import('@earendil-works/pi-coding-agent').ToolDefinition[],
 *   workflowAuthority?: boolean,
 * }} opts
 * @returns {Promise<import('@earendil-works/pi-coding-agent').ToolDefinition[]>}
 */
export async function composeClaudeCliBridgedTools({
    agentDef,
    agentName,
    hostedSession,
    triageMeta,
    cwd,
    customTools = [],
    workflowAuthority = true,
}) {
    /** @type {import('@earendil-works/pi-coding-agent').ToolDefinition[]} */
    const finalCustomTools = filterCustomWorkflowAdvancementTools(customTools, workflowAuthority === false);
    const declaredTools = filterWorkflowAdvancementTools(
        resolveEffectiveSessionToolNames(
            agentDef.tools,
            undefined,
            finalCustomTools.map((tool) => tool.name),
        ),
        workflowAuthority === false,
    );
    const declared = new Set(declaredTools);
    /** @param {string} name */
    const hasTool = (name) => finalCustomTools.find((tool) => tool.name === name);

    const { createClaudeCliCapabilityTools, CLAUDE_CLI_CAPABILITY_TOOL_NAMES } = await import(
        "./backends/claude-cli/capability-tools.ts"
    );
    const capabilityNameSet = new Set(/** @type {readonly string[]} */ (CLAUDE_CLI_CAPABILITY_TOOL_NAMES));
    for (const tool of createClaudeCliCapabilityTools({ cwd })) {
        if (declared.has(tool.name) && capabilityNameSet.has(tool.name) && !hasTool(tool.name)) {
            finalCustomTools.push(tool);
        }
    }

    if (declared.has("plan_written") && hostedSession && !hasTool("plan_written")) {
        const { createPlanWrittenTool } = await import("../../tools/plan-written.ts");
        finalCustomTools.push(createPlanWrittenTool({ triageMeta, agentName, hostedSession }));
    }
    if (declared.has("artifact_written") && hostedSession && !hasTool("artifact_written")) {
        const { createArtifactWrittenTool } = await import("../../tools/artifact-written.ts");
        finalCustomTools.push(createArtifactWrittenTool({ hostedSession, agentName }));
    }
    if (declared.has("task_completed") && hostedSession && !hasTool("task_completed")) {
        const { createTaskCompletedTool } = await import("../../tools/task-completed.ts");
        finalCustomTools.push(createTaskCompletedTool({ hostedSession, agentName: agentDef.displayName }));
    }
    if (declared.has("review_complete") && hostedSession && !hasTool("review_complete")) {
        const { createReviewCompletedTool } = await import("../../tools/review-complete.ts");
        finalCustomTools.push(createReviewCompletedTool({ hostedSession, agentName: agentDef.displayName }));
    }
    if (declared.has("triage_report") && hostedSession && !hasTool("triage_report")) {
        const { createTriageReportTool } = await import("../../tools/triage-report.ts");
        finalCustomTools.push(createTriageReportTool({ hostedSession }));
    }
    if (declared.has("set_session_name") && !hasTool("set_session_name")) {
        const { createSetSessionNameTool } = await import("../../tools/set-session-name.ts");
        finalCustomTools.push(createSetSessionNameTool({ hostedSession }));
    }
    if (declared.has("user_interview") && hostedSession && !hasTool("user_interview")) {
        finalCustomTools.push(createUserInterviewTool({ hostedSession }));
    }

    const workRecordAccessMode = [AGENTS.GUIDE, AGENTS.RECORDER].includes(agentName) ? "all" : "current";
    if (declared.has("work_record_search") && !hasTool("work_record_search")) {
        const { createWorkRecordSearchTool } = await import("../../tools/work-record-search.ts");
        const { SYSTEM_WORK_RECORD_MNEMOSYNE_PORT } = await import("../work-records/mnemosyne-port.ts");
        finalCustomTools.push(createWorkRecordSearchTool({
            cwd,
            accessMode: workRecordAccessMode,
            mnemosynePort: SYSTEM_WORK_RECORD_MNEMOSYNE_PORT,
        }));
    }
    if (declared.has("work_record_read") && !hasTool("work_record_read")) {
        const { createWorkRecordReadTool } = await import("../../tools/work-record-read.ts");
        finalCustomTools.push(createWorkRecordReadTool({ cwd, accessMode: workRecordAccessMode }));
    }
    if (declared.has("multi_file_edit") && !hasTool("multi_file_edit")) {
        const { createMultiFileEditTool } = await import("../../tools/multi_file_edit.ts");
        finalCustomTools.push(createMultiFileEditTool(cwd));
    }

    return finalCustomTools.filter((tool) => tool.name !== "delegate_agent");
}

/**
 * Build the model-selected execution session for root and HostedSession-backed isolated turns.
 * Pi models continue through buildAgentSession(); Claude CLI models bypass Pi entirely.
 *
 * @param {Parameters<typeof buildAgentSession>[0]} opts
 * @returns {Promise<{
 *   executionSession: import('./execution-backend.ts').ExecutionSession,
 *   session: any,
 *   agentDef: import('./types.js').AgentDefinition,
 *   promptState: { text: string },
 *   tools: string[],
 *   finalCustomTools: import('@earendil-works/pi-coding-agent').ToolDefinition[],
 *   resolvedModel: any,
 *   resolvedThinkingLevel: string | undefined,
 *   resolvedTemperature: number | undefined,
 *   contextProjection: import('./session-context-report.js').SessionContextProjection,
 *   imageMode?: string,
 *   visionFallbackModelRef?: string
 * }>}
 */
export async function buildExecutionSession(opts) {
    const targetHostedSession = opts.hostedSession
        ? requireHostedSession(opts.hostedSession, "buildExecutionSession")
        : null;
    const sessionCwd = opts.cwd || targetHostedSession?.cwd;
    if (!sessionCwd) throw new Error("buildExecutionSession: cwd or hostedSession cwd is required");
    const agentDef = opts.subAgentDefinition
        ? await loadSubAgentDefinition(opts.subAgentDefinition.id, opts.subAgentDefinition.options)
        : await loadAgentDef(opts.agentName, sessionCwd);
    const modelRegistry = getModelRegistry();
    const resolvedModel = withModelCompatibility(
        await resolveModel(
            opts.modelOverride,
            agentDef,
            opts.agentName,
            modelRegistry,
            targetHostedSession || undefined,
            sessionCwd,
            { ignoreManualModelOverride: opts.ignoreManualModelOverride === true },
        ),
    );
    assertModelExecutionBackendSupported(resolvedModel);
    const backendThinking = resolveExecutionThinkingLevel({
        agentName: opts.agentName,
        cwd: sessionCwd,
        agentDef,
        thinkingLevelOverride: opts.thinkingLevelOverride,
    }).resolvedThinkingLevel;
    assertThinkingLevelSupportedForInvocation(
        resolvedModel,
        opts.thinkingLevelOverride || "",
        Boolean(opts.thinkingLevelOverride && opts.workflowAuthority === false),
    );
    const backend =
        /** @type {import('../models/model-registry.ts').RunWieldModel} */ (resolvedModel)?.executionBackend || "pi";
    if (backend !== "pi") assertThinkingLevelBackendSupportedForInvocation(resolvedModel, backendThinking);
    if (backend === "pi") {
        const built = await buildAgentSession(opts);
        return { ...built, executionSession: createPiExecutionSession(built.session) };
    }
    if (backend !== "claude-cli") {
        throw new Error(
            `Unsupported model execution backend "${backend}" for ${resolvedModel.provider}/${resolvedModel.id}.`,
        );
    }
    const effectiveSessionManager = opts.sessionManager || SessionManager.inMemory(sessionCwd);
    const finalCustomTools = await composeClaudeCliBridgedTools({
        agentDef,
        agentName: opts.agentName,
        hostedSession: targetHostedSession,
        triageMeta: opts.triageMeta,
        cwd: sessionCwd,
        customTools: filterCustomWorkflowAdvancementTools(opts.customTools || [], opts.workflowAuthority === false),
        workflowAuthority: opts.workflowAuthority !== false,
    });
    const rebuildToolNames = filterWorkflowAdvancementTools(
        resolveEffectiveSessionToolNames(
            agentDef.tools,
            opts.toolNames,
            finalCustomTools.map((tool) => tool.name),
        ),
        opts.workflowAuthority === false,
    );
    const { prompt: finalSystemPrompt, projection: contextProjection } =
        await assembleFinalSystemPromptWithContextProjection(
            agentDef,
            rebuildToolNames,
            finalCustomTools,
            sessionCwd,
            opts.projectStateContext,
            {
                hostedSession: targetHostedSession || undefined,
                sessionManager: effectiveSessionManager,
            },
        );
    const promptState = {
        text: opts.workflowAuthority === false
            ? `${finalSystemPrompt}\n\n${NO_WORKFLOW_AUTHORITY_PROMPT}`
            : finalSystemPrompt,
    };
    const session = new ClaudeCliExecutionSession({
        cwd: sessionCwd,
        agentName: opts.agentName,
        finalSystemPrompt: promptState.text,
        model: resolvedModel,
        sessionManager: effectiveSessionManager,
        hostedSession: targetHostedSession || undefined,
        bridgedTools: finalCustomTools,
        persistModelChange: opts.persistModelChange !== false,
    });
    await recordWorkflowMetric({
        category: "model_selection",
        event: "session_configured",
        agentName: opts.agentName,
        details: {
            provider: resolvedModel.provider,
            model: resolvedModel.id,
            source: resolvedModel && typeof resolvedModel === "object"
                ? modelSelectionSourceByModel.get(resolvedModel)
                : undefined,
            selectedProvider: resolvedModel.provider,
            selectedModel: resolvedModel.id,
            selectedSource: resolvedModel && typeof resolvedModel === "object"
                ? modelSelectionSourceByModel.get(resolvedModel)
                : undefined,
            imageMode: "blocked",
            hasVisionFallback: false,
            resolvedThinkingLevel: backendThinking,
        },
    }, sessionCwd);
    return {
        executionSession: createClaudeExecutionSession(session),
        session,
        agentDef,
        promptState,
        tools: rebuildToolNames,
        finalCustomTools,
        resolvedModel,
        resolvedThinkingLevel: backendThinking,
        resolvedTemperature: undefined,
        contextProjection,
        imageMode: "blocked",
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
 * @typedef {Object} AssistantToolCallContent
 * @property {string} [type]
 * @property {string} [name]
 */

/**
 * @typedef {Object} AssistantMessageLike
 * @property {string} [role]
 * @property {unknown} [content]
 */

/**
 * @typedef {Object} AutoCompactionSessionPatch
 * @property {(assistantMessage: unknown, skipAbortedCheck?: boolean) => Promise<boolean> | boolean} [_checkCompaction]
 * @property {(reason: string, willRetry: boolean) => Promise<boolean>} [_runAutoCompaction]
 * @property {boolean} [__runWieldTaskCompletedAutoCompactionExcluded]
 * @property {boolean} [__runWieldEngineerAutoCompactionInstalled]
 */

/**
 * @typedef {Object} EngineerCompactionState
 * @property {boolean} armed
 * @property {number | null} postCompactionBaselineTokens
 */

const ENGINEER_COMPACTION_CONTEXT_RATIO = 0.5;
const ENGINEER_COMPACTION_MAX_TOKENS = 80_000;
const ENGINEER_COMPACTION_REARM_GROWTH_RATIO = 0.05;
const ENGINEER_COMPACTION_REARM_MAX_GROWTH_TOKENS = 8_000;
const ENGINEER_AGENT_NAMES = new Set([
    AGENTS.ENGINEER,
    AGENTS.PLAN_ENGINEER,
    AGENTS.FRONTEND_ENGINEER,
    AGENTS.REVIEWER_FEEDBACK_ENGINEER,
]);

/** @type {WeakMap<import('@earendil-works/pi-coding-agent').AgentSession, EngineerCompactionState>} */
const engineerCompactionStates = new WeakMap();

/**
 * Return the early compaction threshold for an Engineer execution session.
 * Other agents use Pi's configured reserve-token threshold.
 *
 * @param {string} agentName
 * @param {number} contextWindow
 * @returns {number | null}
 */
export function getEngineerCompactionThreshold(agentName, contextWindow) {
    if (!ENGINEER_AGENT_NAMES.has(agentName) || !Number.isFinite(contextWindow) || contextWindow <= 0) return null;
    return Math.min(Math.floor(contextWindow * ENGINEER_COMPACTION_CONTEXT_RATIO), ENGINEER_COMPACTION_MAX_TOKENS);
}

/**
 * @param {import('@earendil-works/pi-coding-agent').AgentSession} session
 * @returns {EngineerCompactionState}
 */
function getEngineerCompactionState(session) {
    let state = engineerCompactionStates.get(session);
    if (!state) {
        state = { armed: true, postCompactionBaselineTokens: null };
        engineerCompactionStates.set(session, state);
    }
    return state;
}

/**
 * Prevent repeated compaction when a summary itself remains above the early
 * threshold. Re-arm immediately below the threshold. Above it, require new
 * context equal to 5% of the window, capped at 8K tokens.
 *
 * @param {import('@earendil-works/pi-coding-agent').AgentSession} session
 * @param {number} currentTokens
 * @param {number} totalTokens
 * @param {number} threshold
 * @param {number} contextWindow
 * @returns {boolean}
 */
function shouldRunEngineerCompaction(session, currentTokens, totalTokens, threshold, contextWindow) {
    const state = getEngineerCompactionState(session);
    if (!state.armed) {
        if (currentTokens < threshold) {
            state.armed = true;
            state.postCompactionBaselineTokens = null;
        } else if (state.postCompactionBaselineTokens === null) {
            state.postCompactionBaselineTokens = currentTokens;
            return false;
        } else {
            const requiredGrowth = Math.min(
                Math.max(1, Math.floor(contextWindow * ENGINEER_COMPACTION_REARM_GROWTH_RATIO)),
                ENGINEER_COMPACTION_REARM_MAX_GROWTH_TOKENS,
            );
            if (currentTokens - state.postCompactionBaselineTokens < requiredGrowth) return false;
            state.armed = true;
            state.postCompactionBaselineTokens = null;
        }
    }
    return totalTokens >= threshold;
}

/**
 * @param {import('@earendil-works/pi-coding-agent').AgentSession} session
 */
function markEngineerCompactionComplete(session) {
    const state = getEngineerCompactionState(session);
    state.armed = false;
    state.postCompactionBaselineTokens = null;
}

/**
 * Add the Engineer threshold to Pi's normal post-response compaction check.
 * Pi runs first so overflow recovery and its configured threshold stay intact.
 *
 * @param {import('@earendil-works/pi-coding-agent').AgentSession} session
 * @param {string} agentName
 */
export function installEngineerAutoCompactionThreshold(session, agentName) {
    if (!ENGINEER_AGENT_NAMES.has(agentName)) return;

    const target = /** @type {AutoCompactionSessionPatch} */ (/** @type {unknown} */ (session));
    if (target.__runWieldEngineerAutoCompactionInstalled || typeof target._checkCompaction !== "function") return;

    const originalCheckCompaction = target._checkCompaction;
    target._checkCompaction = async function (assistantMessage, skipAbortedCheck = true) {
        const compactedByPi = await originalCheckCompaction.call(this, assistantMessage, skipAbortedCheck);
        if (compactedByPi) {
            markEngineerCompactionComplete(session);
            return true;
        }

        const message = /** @type {{ stopReason?: string }} */ (assistantMessage);
        if (skipAbortedCheck && message.stopReason === "aborted") return false;
        if (!session.settingsManager?.getCompactionSettings?.()?.enabled) return false;

        const contextWindow = session.model?.contextWindow ?? 0;
        const activeThreshold = getEngineerCompactionThreshold(agentName, contextWindow);
        const usage = session.getContextUsage?.();
        const currentTokens = typeof usage?.tokens === "number" ? usage.tokens : null;
        if (activeThreshold === null || currentTokens === null) return false;
        if (!shouldRunEngineerCompaction(session, currentTokens, currentTokens, activeThreshold, contextWindow)) {
            return false;
        }
        if (typeof target._runAutoCompaction !== "function") return false;

        const compacted = await target._runAutoCompaction.call(this, "threshold", false);
        if (compacted) markEngineerCompactionComplete(session);
        return compacted;
    };
    target.__runWieldEngineerAutoCompactionInstalled = true;
}

/**
 * @param {unknown} message
 * @returns {boolean}
 */
export function shouldBypassAutoCompactionForAssistantMessage(message) {
    const typedMessage = /** @type {AssistantMessageLike} */ (message);
    if (typedMessage.role !== "assistant" || !Array.isArray(typedMessage.content)) return false;

    return typedMessage.content.some((block) => {
        const typedBlock = /** @type {AssistantToolCallContent} */ (block);
        return (typedBlock.type === "tool_use" || typedBlock.type === "toolCall") &&
            typedBlock.name === "task_completed";
    });
}

/**
 * Pi checks threshold auto-compaction after each assistant message, including
 * assistant messages that only exist to call a tool. `task_completed` is usually
 * a terminal workflow signal, so compacting immediately before the session ends
 * burns an extra model call without preserving useful future context. Other
 * tool calls keep Pi's normal auto-compaction behavior.
 *
 * @param {import('@earendil-works/pi-coding-agent').AgentSession} session
 */
function installTaskCompletedAutoCompactionExclusion(session) {
    const target = /** @type {AutoCompactionSessionPatch} */ (/** @type {unknown} */ (session));
    if (target.__runWieldTaskCompletedAutoCompactionExcluded || typeof target._checkCompaction !== "function") return;

    const originalCheckCompaction = target._checkCompaction;
    target._checkCompaction = function (assistantMessage, skipAbortedCheck = true) {
        if (shouldBypassAutoCompactionForAssistantMessage(assistantMessage)) return Promise.resolve(false);
        return originalCheckCompaction.call(this, assistantMessage, skipAbortedCheck);
    };
    target.__runWieldTaskCompletedAutoCompactionExcluded = true;
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
 * @param {PreparedPromptContent} prepared
 * @returns {number}
 */
function estimatePendingPromptTokens(prepared) {
    const pendingUserMessage = {
        role: "user",
        content: [
            { type: "text", text: prepared.text },
            ...(prepared.images || []),
        ],
        timestamp: Date.now(),
    };
    return estimateTokens(/** @type {any} */ (pendingUserMessage));
}

/**
 * @param {import('@earendil-works/pi-coding-agent').AgentSession} session
 * @returns {number}
 */
function estimateCurrentContextTokens(session) {
    const usage = session.getContextUsage?.();
    let currentTokens = typeof usage?.tokens === "number" ? usage.tokens : 0;
    const contextMessages = session.sessionManager?.buildSessionContext?.().messages;
    if (Array.isArray(contextMessages)) {
        currentTokens = Math.max(currentTokens, estimateAgentMessagesTokens(contextMessages));
    }
    return currentTokens;
}

/**
 * @param {import('@earendil-works/pi-coding-agent').AgentSession} session
 * @param {PreparedPromptContent} prepared
 * @param {import('../models/model-registry.ts').RunWieldModel | undefined} model
 */
function assertPreparedPromptFitsContext(session, prepared, model) {
    const contextWindow = model?.contextWindow ?? session.model?.contextWindow ?? 0;
    if (typeof contextWindow !== "number" || contextWindow <= 0) return;
    const totalTokens = estimateCurrentContextTokens(session) + estimatePendingPromptTokens(prepared);
    if (totalTokens <= contextWindow) return;
    throw new Error(contextCapacityGuidance(model || session.model, totalTokens, contextWindow));
}

/**
 * @param {import('@earendil-works/pi-coding-agent').AgentSession} session
 * @param {PreparedPromptContent} prepared
 * @param {string} agentName
 * @returns {Promise<boolean>} true when a compaction attempt was started and succeeded
 */
async function compactBeforePromptIfNeeded(session, prepared, agentName) {
    const settings = session.settingsManager?.getCompactionSettings?.();
    if (!settings?.enabled) return false;
    if (session.isStreaming || session.isCompacting) return false;

    const contextWindow = session.model?.contextWindow ?? 0;
    if (typeof contextWindow !== "number" || contextWindow <= 0) return false;

    const currentTokens = estimateCurrentContextTokens(session);
    const totalTokens = currentTokens + estimatePendingPromptTokens(prepared);
    const engineerThreshold = getEngineerCompactionThreshold(agentName, contextWindow);
    const needsCompaction = engineerThreshold === null
        ? shouldCompact(totalTokens, contextWindow, settings)
        : shouldRunEngineerCompaction(session, currentTokens, totalTokens, engineerThreshold, contextWindow);
    if (!needsCompaction) return false;

    const runAutoCompaction = /** @type {{ _runAutoCompaction?: (reason: string, willRetry: boolean) => Promise<boolean> }} */
        (/** @type {unknown} */ (session))._runAutoCompaction;
    if (typeof runAutoCompaction !== "function") return false;
    const compacted = await runAutoCompaction.call(session, "threshold", false);
    if (compacted && engineerThreshold !== null) markEngineerCompactionComplete(session);
    return compacted;
}

/**
 * Attach semantic event subscribers to an AgentSession. Called once per AgentSession lifetime
 * (whether root or transient). Returns lifecycle handles for the caller to reset turn-scoped
 * state between prompts.
 *
 * @param {import('@earendil-works/pi-coding-agent').AgentSession} session
 * @param {import('./types.js').AgentDefinition} agentDef
 * @param {string} [debugLogPath]
 * @param {import('./hosted-session.js').HostedSession} [hostedSession]
 *
 * @returns {SubscriberState}
 */
export function attachSessionEventSubscribers(
    session,
    agentDef,
    debugLogPath = undefined,
    hostedSession = undefined,
) {
    /** @type {string[]} */
    let invokedToolNames = [];
    let thinkingActive = false;
    let currentRuntimeTurnId = crypto.randomUUID();
    let assistantMessageSequence = 0;
    let thinkingMessageSequence = 0;
    /** @type {string | null} */
    let currentAssistantMessageId = null;
    /** @type {string | null} */
    let currentThinkingMessageId = null;
    /** @type {Map<string, number>} */
    const toolStartedAt = new Map();
    /** @type {Map<string, ReturnType<typeof describeRuntimeTool>>} */
    const runtimeTools = new Map();
    const runtimeAgentName = agentDef.displayName || agentDef.name;

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

    const endThinking = () => {
        if (!thinkingActive || !currentThinkingMessageId) return;
        emitRuntimeEvent({
            type: RuntimeEventTypes.ASSISTANT_THINKING_END,
            messageId: currentThinkingMessageId,
            agentName: runtimeAgentName,
        });
        thinkingActive = false;
    };

    const unsubscribe = session.subscribe((event) => {
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
                    endThinking();
                    currentAssistantMessageId = /** @type {any} */ (event.message).id || nextAssistantMessageId();
                    currentThinkingMessageId = null;
                }
                break;
            }
            case "message_update": {
                if (event.assistantMessageEvent.type === "thinking_delta") {
                    currentThinkingMessageId = currentThinkingMessageId || nextThinkingMessageId();
                    thinkingActive = true;
                    emitRuntimeEvent({
                        type: RuntimeEventTypes.ASSISTANT_THINKING_DELTA,
                        messageId: currentThinkingMessageId,
                        delta: event.assistantMessageEvent.delta,
                        agentName: runtimeAgentName,
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
                    break;
                }

                if (event.assistantMessageEvent.type === "thinking_end") {
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
                    endThinking();
                    emitRuntimeEvent({
                        type: RuntimeEventTypes.ASSISTANT_TEXT_DELTA,
                        messageId: currentAssistantMessageId,
                        delta: event.assistantMessageEvent.delta,
                        agentName: runtimeAgentName,
                        messageKind: "assistant",
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
                        usage: normalizeRuntimeUsage(endedMessage.usage),
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
                });
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
                    });
                }
                break;
            }
            case "tool_execution_start": {
                invokedToolNames.push(event.toolName);
                toolStartedAt.set(event.toolCallId, Date.now());
                const runtimeTool = describeRuntimeTool(event.toolName, event.args);
                runtimeTools.set(event.toolCallId, runtimeTool);
                if (hostedSession?.cwd) {
                    void recordToolCallStarted(
                        event.toolCallId,
                        event.toolName,
                        event.args,
                        hostedSession.cwd,
                        agentDef.displayName || agentDef.name,
                    );
                }

                if (event.toolName === "plan_written") {
                    endThinking();
                }

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

                emitRuntimeEvent({
                    type: RuntimeEventTypes.TOOL_START,
                    toolCallId: event.toolCallId,
                    ...runtimeTool,
                    args: event.args,
                });

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
                emitRuntimeEvent({
                    type: RuntimeEventTypes.TOOL_UPDATE,
                    toolCallId: event.toolCallId,
                    ...(runtimeTools.get(event.toolCallId) || describeRuntimeTool(event.toolName, event.args)),
                    ...normalizeRuntimeToolResult(event.partialResult),
                });
                break;
            }
            case "tool_execution_end": {
                if (hostedSession?.cwd) {
                    void recordToolCallFinished(
                        event.toolCallId,
                        event.toolName,
                        Boolean(event.isError),
                        hostedSession.cwd,
                        agentDef.displayName || agentDef.name,
                    );
                }
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
                emitRuntimeEvent({
                    type: RuntimeEventTypes.TOOL_END,
                    toolCallId: event.toolCallId,
                    ...(runtimeTools.get(event.toolCallId) || describeRuntimeTool(event.toolName, undefined)),
                    isError: Boolean(event.isError),
                    ...normalizeRuntimeToolResult(event.result),
                    durationMs: toolStartedAt.has(event.toolCallId)
                        ? Date.now() - /** @type {number} */ (toolStartedAt.get(event.toolCallId))
                        : null,
                });
                toolStartedAt.delete(event.toolCallId);
                runtimeTools.delete(event.toolCallId);
                break;
            }
            case "turn_start": {
                currentRuntimeTurnId = /** @type {any} */ (event).turnId || crypto.randomUUID();
                assistantMessageSequence = 0;
                thinkingMessageSequence = 0;
                currentAssistantMessageId = null;
                currentThinkingMessageId = null;
                emitRuntimeEvent({ type: RuntimeEventTypes.TURN_START, turnId: currentRuntimeTurnId });
                break;
            }
            case "turn_end": {
                emitRuntimeEvent({ type: RuntimeEventTypes.TURN_END, turnId: currentRuntimeTurnId, ok: true });
                currentAssistantMessageId = null;
                currentThinkingMessageId = null;
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
                    });
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
                        });
                    } else if (event.result) {
                        const message = `Auto-compacted. Tokens before: ${event.result.tokensBefore.toLocaleString()}`;
                        emitRuntimeEvent({
                            type: RuntimeEventTypes.SYSTEM_STATUS,
                            level: "info",
                            message,
                        });
                    } else if (event.errorMessage) {
                        const message = `Auto-compaction failed: ${sanitizeApiErrorMessage(event.errorMessage)}`;
                        emitRuntimeEvent({
                            type: RuntimeEventTypes.SYSTEM_STATUS,
                            level: "error",
                            message,
                        });
                    }
                }
                break;
            }
        }
    });

    return {
        resetTurn: () => {
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
 * Handles debug logging, defensive stream cleanup, and per-turn state reset.
 *
 * @param {Object} opts
 * @param {import('@earendil-works/pi-coding-agent').AgentSession} opts.session
 * @param {import('./types.js').AgentDefinition} opts.agentDef
 * @param {string} opts.agentName
 * @param {string} opts.userRequest
 * @param {string} opts.finalSystemPrompt  Used only for debug log.
 * @param {Array<{base64: string, mimeType: string}>} [opts.images]
 * @param {SubscriberState} opts.subscriberState
 * @param {any} [opts.resolvedModel]
 * @param {string} [opts.resolvedThinkingLevel]
 * @param {string} [opts.cwd]
 * @param {string} [opts.debugLogPath]
 * @param {AbortSignal} [opts.signal]
 * @param {boolean} [opts.disableAutoCompaction]
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
    subscriberState,
    resolvedModel,
    resolvedThinkingLevel,
    cwd,
    debugLogPath,
    signal,
    disableAutoCompaction = false,
}) {
    subscriberState.resetTurn();

    const fallback = images && images.length > 0 && !modelSupportsImageInput(session.model)
        ? await resolveVisionFallbackModel(
            /** @type {any} */ (session).runWieldModelRegistry || /** @type {any} */ (session).modelRegistry ||
                getModelRegistry(),
            SYSTEM_MODEL_DISCOVERY_NETWORK,
        )
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
            `Execution CWD: ${cwd}`,
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
    const abortPrompt = () => {
        try {
            session.abort();
        } catch (_e) {
            // Cancellation is best effort; the active prompt still observes the AbortSignal check below.
        }
    };

    try {
        signal?.throwIfAborted();
        signal?.addEventListener("abort", abortPrompt, { once: true });
        if (!disableAutoCompaction) {
            await compactBeforePromptIfNeeded(session, {
                text: preparedImages.text,
                images: preparedImages.images,
            }, agentName);
        } else {
            assertPreparedPromptFitsContext(session, {
                text: preparedImages.text,
                images: preparedImages.images,
            }, resolvedModel);
        }
        signal?.throwIfAborted();
        await session.prompt(preparedImages.text, requestOptions);
        signal?.throwIfAborted();
        await session.agent.waitForIdle();
    } catch (error) {
        promptError = error instanceof Error ? error : new Error(String(error));
        throw error;
    } finally {
        signal?.removeEventListener("abort", abortPrompt);
        // Defensive cleanup handles abort/error paths where thinking_end may never fire.
        subscriberState.endThinking();

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

/** @type {WeakMap<import('@earendil-works/pi-coding-agent').AgentSession, { agentDef: import('./types.js').AgentDefinition, subAgentDefinition?: { id: import('./subagent-definitions.ts').SubAgentDefinitionId, options?: import('./subagent-definitions.ts').LoadSubAgentDefinitionOptions }, promptState: { text: string }, subscriberState: SubscriberState, agentName: string, tools: string[], finalCustomTools: import('@earendil-works/pi-coding-agent').ToolDefinition[], rootTurnCount: number, projectStateContext: string, cwd: string, model?: string, contextProjection?: import('./session-context-report.js').SessionContextProjection, imageMode?: string, visionFallbackModelRef?: string, steeringTargetId?: string }>} */
const rootSessionMetadata = new WeakMap();

/** @type {WeakMap<import('./hosted-session.js').HostedSession, { agentName: string, debugLogPath?: string }>} */
const pendingAgentSwitchLogs = new WeakMap();

/**
 * @param {import('./hosted-session.js').HostedSession} hostedSession
 * @param {{ agentName: string, debugLogPath?: string }} state
 */
export function markRootAgentSwitch(hostedSession, state) {
    pendingAgentSwitchLogs.set(hostedSession, state);
}

/**
 * @param {import('./hosted-session.js').HostedSession} hostedSession
 * @returns {{ agentName: string, debugLogPath?: string } | undefined}
 */
function consumePendingAgentSwitchLog(hostedSession) {
    const state = pendingAgentSwitchLogs.get(hostedSession);
    pendingAgentSwitchLogs.delete(hostedSession);
    return state;
}

/**
 * Test-only access to root session metadata.
 * @param {import('@earendil-works/pi-coding-agent').AgentSession} session
 * @returns {any}
 */
export function __getRootSessionMetadataForTests(session) {
    return rootSessionMetadata.get(session);
}

/**
 * @param {import('./hosted-session.js').HostedSession} hostedSession
 * @returns {{ agentName: string, model?: string, cwd?: string } | null}
 */
export function getRootSessionSwitchState(hostedSession) {
    const session = /** @type {any} */ (hostedSession?.getRootAgentSession?.());
    if (!session) return null;
    const meta = rootSessionMetadata.get(session);
    if (!meta) return null;
    return {
        agentName: meta.agentName,
        model: meta.model,
        cwd: meta.cwd,
    };
}

/**
 * @param {import('./hosted-session.js').HostedSession} hostedSession
 * @returns {Partial<import('./agent-switching.js').AgentSwitchOptions>}
 */
export function getRootSessionRebuildOptions(hostedSession) {
    const session = /** @type {any} */ (hostedSession?.getRootAgentSession?.());
    if (!session) return {};
    const meta = rootSessionMetadata.get(session);
    if (!meta) return {};
    return {
        cwd: meta.cwd,
        subAgentDefinition: meta.subAgentDefinition,
        customTools: meta.finalCustomTools,
        toolNames: meta.tools,
        projectStateContext: meta.projectStateContext,
    };
}

/**
 * @param {import('./hosted-session.js').HostedSession} hostedSession
 * @returns {{ projection: import('./session-context-report.js').SessionContextProjection, activeMessageTokens: number, agentName: string, agentDisplayName: string, model?: string } | null}
 */
export function getRootSessionContextProjection(hostedSession) {
    const session = /** @type {any} */ (hostedSession?.getRootAgentSession?.());
    if (!session) return null;
    const meta = rootSessionMetadata.get(session);
    if (!meta?.contextProjection) return null;
    const contextMessages = session.sessionManager?.buildSessionContext?.().messages;
    const messages = Array.isArray(contextMessages) ? contextMessages : getRootExecutionMessages(session);
    return {
        projection: meta.contextProjection,
        activeMessageTokens: estimateAgentMessagesTokens(/** @type {any} */ (messages)),
        agentName: meta.agentName,
        agentDisplayName: meta.agentDef.displayName,
        model: meta.model,
    };
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
            if (meta?.steeringTargetId) targetHostedSession.popSteeringTargetSession(meta.steeringTargetId);
        } catch (_e) { /* ignore */ }
        try {
            if (isExecutionSession(existing)) existing.session.dispose();
            else existing.dispose();
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
 * @param {"off"|"minimal"|"low"|"medium"|"high"|"xhigh"|"max"} [opts.thinkingLevelOverride]
 * @param {import('@earendil-works/pi-coding-agent').SessionManager} [opts.sessionManager]
 * @param {{ id: import('./subagent-definitions.ts').SubAgentDefinitionId, options?: import('./subagent-definitions.ts').LoadSubAgentDefinitionOptions }} [opts.subAgentDefinition]
 * @param {string} [opts.cwd]
 * @param {string} [opts.projectStateContext]
 * @param {boolean} [opts.includeEditFallback]
 * @param {import('./types.js').AgentMessageHandler} [opts.activeHandler]
 * @param {string} [opts.debugLogPath]
 * @param {import('./managed-operation.ts').ManagedOperationCapability} [opts.managedOperationCapability]
 *
 * @returns {Promise<import('@earendil-works/pi-coding-agent').AgentSession>}
 */
export async function ensureRootAgentSession(opts) {
    const hostedSession = requireHostedSession(opts.hostedSession, "ensureRootAgentSession");
    const existing = /** @type {any} */ (hostedSession.getRootAgentSession());
    const existingMeta = existing ? rootSessionMetadata.get(existing) : undefined;
    const rootProjectStateContext = opts.projectStateContext ?? hostedSession.getProjectStateContext();
    const built = await buildExecutionSession({
        ...opts,
        hostedSession,
        cwd: opts.cwd || hostedSession.cwd,
        sessionManager: /** @type {any} */ (opts.sessionManager || hostedSession.getRootSessionManager() || undefined),
        projectStateContext: rootProjectStateContext,
    });
    const {
        session,
        agentDef,
        promptState,
        tools,
        finalCustomTools,
        resolvedModel,
        contextProjection,
        imageMode,
        visionFallbackModelRef,
    } = built;
    const executionSession = built.executionSession || null;
    const rootSession = executionSession?.kind === "claude-cli" ? executionSession : session;

    try {
        hostedSession.assertActive();
    } catch (error) {
        try {
            session.dispose();
        } catch (_disposeError) { /* ignore */ }
        throw error;
    }

    const subscriberState = executionSession?.kind === "claude-cli"
        ? {
            resetTurn: () => {},
            drainInvokedToolNames: () => [],
            endThinking: () => {},
            unsubscribe: () => {},
        }
        : attachSessionEventSubscribers(session, agentDef, opts.debugLogPath, hostedSession);

    if (existing) {
        try {
            existingMeta?.subscriberState.unsubscribe();
        } catch (_e) { /* ignore */ }
        try {
            if (existingMeta?.steeringTargetId) hostedSession.popSteeringTargetSession(existingMeta.steeringTargetId);
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

    hostedSession.setRootAgentSession(rootSession, opts.managedOperationCapability || null);
    const steeringTargetId = hostedSession.pushSteeringTargetSession(
        executionSession ? getExecutionSteeringTarget(executionSession) : session,
    );
    hostedSession.setRootAgentName(opts.agentName, opts.managedOperationCapability || null);
    if (opts.activeHandler) hostedSession.setActiveOnMessage(opts.activeHandler);
    const activeSessionManager = /** @type {import('@earendil-works/pi-coding-agent').SessionManager | undefined} */ (
        opts.sessionManager || hostedSession.getRootSessionManager?.() ||
        /** @type {{ sessionManager?: import('@earendil-works/pi-coding-agent').SessionManager }} */ (session)
            .sessionManager
    );
    // Pi writes the initial model, but does not write model changes when a
    // replacement root shares an existing transcript. Always save the selected
    // model, including preset reloads of the same Agent. Hydration selects the
    // saved model, so rebuilding an unchanged root adds no duplicate entry.
    if (activeSessionManager && resolvedModel) {
        const persistedModel = readPersistedModelState(activeSessionManager);
        if (
            !persistedModel || persistedModel.provider !== resolvedModel.provider ||
            persistedModel.model !== resolvedModel.id
        ) {
            activeSessionManager.appendModelChange(resolvedModel.provider, resolvedModel.id);
        }
    }
    recordActiveAgent(
        /** @type {any} */ (activeSessionManager),
        opts.agentName,
    );
    rootSessionMetadata.set(rootSession, {
        agentDef,
        subAgentDefinition: opts.subAgentDefinition,
        promptState,
        subscriberState,
        agentName: opts.agentName,
        tools,
        finalCustomTools,
        rootTurnCount: 0,
        projectStateContext: rootProjectStateContext,
        cwd: opts.cwd || hostedSession.cwd,
        model: finalModelForUi,
        contextProjection,
        imageMode,
        visionFallbackModelRef,
        steeringTargetId,
    });

    return rootSession;
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
 * @param {import('@earendil-works/pi-coding-agent').ToolDefinition[]} [opts.customTools]
 * @param {AbortSignal} [opts.signal]
 * @param {import('./request-dispatch.ts').RequestDispatchKind} [opts.dispatchKind]
 * @param {boolean} [opts.disableAutoCompaction]
 * @param {import('./managed-operation.ts').ManagedOperationCapability} [opts.managedOperationCapability]
 * @returns {Promise<import('@earendil-works/pi-agent-core').AgentMessage[]>}
 */
export async function runRootTurn({
    hostedSession,
    agentName,
    userRequest,
    images,
    customTools,
    signal,
    dispatchKind = "interactive",
    disableAutoCompaction = false,
}) {
    const targetHostedSession = requireHostedSession(hostedSession, "runRootTurn");
    const session = /** @type {any} */ (targetHostedSession.getRootAgentSession());
    if (!session) {
        throw new Error(`runRootTurn: no root AgentSession (expected agent "${agentName}")`);
    }
    if (targetHostedSession.getRootAgentName() !== agentName) {
        throw new Error(
            `runRootTurn: root agent is "${targetHostedSession.getRootAgentName()}", not "${agentName}". The agent activation transaction must rebuild first.`,
        );
    }
    const meta = rootSessionMetadata.get(session);
    if (!meta) {
        throw new Error(
            "runRootTurn: root AgentSession is missing metadata (was it built via ensureRootAgentSession?)",
        );
    }

    const requiredCustomToolNames = (customTools || []).map((tool) => tool.name);
    const existingCustomToolNames = meta.finalCustomTools.map((tool) => tool.name);
    const hasRequiredCustomTools = requiredCustomToolNames.every((name) => existingCustomToolNames.includes(name));
    if (!hasRequiredCustomTools && customTools?.length) {
        throw new Error(
            "runRootTurn: active root is missing required custom tools. Activate the Agent with its full configuration before running the turn.",
        );
    }

    const priorMessages = getRootExecutionMessages(session);
    const pendingAgentSwitch = consumePendingAgentSwitchLog(targetHostedSession);
    if (pendingAgentSwitch) {
        const activeSessionManager = isExecutionSession(session)
            ? session.session.sessionManager
            : session.sessionManager;
        appendDebugLog(
            pendingAgentSwitch.debugLogPath,
            [
                "",
                "----------------------------------------",
                "Event: FIRST TURN AFTER AGENT SWITCH",
                `Timestamp: ${new Date().toISOString()}`,
                `Agent: ${pendingAgentSwitch.agentName}`,
                `Session: ${activeSessionManager.getSessionId()}`,
                `Dispatch Kind: ${dispatchKind}`,
                "The user request and current system prompt are logged by AGENT INVOCATION START below.",
                "----------------------------------------",
                "",
            ].join("\n"),
        );
    }
    const sessionManager = isExecutionSession(session) ? session.session.sessionManager : session.sessionManager;
    const backend = isExecutionSession(session) ? session.kind : "pi";
    const transitionSteering = targetHostedSession.consumeAgentTransitionSteering?.() || [];
    const transitionText = transitionSteering.map((entry) => entry.text.trim()).filter(Boolean).join("\n\n");
    const effectiveUserRequest = transitionText
        ? `${userRequest}\n\nUser steering received during Agent handoff:\n${transitionText}`
        : userRequest;
    const dispatch = prepareRequestDispatch(sessionManager, {
        userRequest: effectiveUserRequest,
        dispatchKind,
        backend,
    });
    const effectiveImages = [
        ...(images || []),
        ...transitionSteering.flatMap((entry) => entry.images || []),
    ];
    meta.rootTurnCount += 1;
    const finalRequest = dispatch.promptMode === "continuation"
        ? dispatch.userRequest
        : applyAttentionNudge(agentName, dispatch.userRequest, meta.rootTurnCount);
    try {
        let messages;
        if (isExecutionSession(session) && session.kind === "claude-cli") {
            messages = await session.session.runTurn({
                userRequest: finalRequest,
                images: effectiveImages,
                signal,
                requestId: dispatch.requestId,
                attemptId: dispatch.attemptId,
            });
        } else {
            messages = await runPrompt({
                session: isExecutionSession(session) ? session.session : session,
                agentDef: meta.agentDef,
                agentName,
                userRequest: finalRequest,
                finalSystemPrompt: meta.promptState.text,
                images: effectiveImages,
                subscriberState: meta.subscriberState,
                signal,
                disableAutoCompaction,
            });
        }
        completeRequestDispatch(sessionManager, dispatch);
        return messages;
    } catch (error) {
        failRequestDispatch(sessionManager, dispatch, getRootExecutionMessages(session).length > priorMessages.length);
        throw error;
    }
}

/**
 * @param {Record<string, unknown>} opts
 * @param {string | null} rootAgentName
 * @returns {boolean}
 */
export function shouldReuseExistingRootSession(opts, rootAgentName) {
    if (!rootAgentName || rootAgentName !== opts.agentName) return false;

    const rootChangingKeys = [
        "toolNames",
        "customTools",
        "modelOverride",
        "triageMeta",
        "subAgentDefinition",
        "cwd",
        "debugLogPath",
        "projectStateContext",
        "includeEditFallback",
    ];
    return !rootChangingKeys.some((key) => Object.hasOwn(opts, key) && opts[key] !== undefined);
}

/**
 * Run one disposable non-interactive Agent prompt without a HostedSession.
 * @param {Object} opts
 * @param {string} opts.cwd
 * @param {string} opts.agentName
 * @param {string} opts.userRequest
 * @param {string} [opts.modelOverride]
 * @param {"off"|"minimal"|"low"|"medium"|"high"|"xhigh"|"max"} [opts.thinkingLevelOverride]
 * @param {string} [opts.debugLogPath]
 * @param {string} [opts.projectStateContext]
 * @returns {Promise<import('@earendil-works/pi-agent-core').AgentMessage[]>}
 */
export async function runNonInteractiveAgentPrompt({
    cwd,
    agentName,
    userRequest,
    modelOverride,
    thinkingLevelOverride,
    debugLogPath,
    projectStateContext,
}) {
    const { session } = await buildAgentSession({
        cwd,
        agentName,
        modelOverride,
        thinkingLevelOverride,
        debugLogPath,
        projectStateContext,
        includeEditFallback: false,
    });
    try {
        await session.prompt(userRequest);
        await session.agent.waitForIdle();
        return session.agent.state.messages;
    } finally {
        try {
            session.dispose();
        } catch (_e) { /* ignore */ }
    }
}

/**
 * Run a disposable isolated Agent invocation. Interactive root Agents must be
 * activated through switchActiveAgent/runActiveAgentTurn instead.
 *
 * @callback ExecutionSessionBuiltCallback
 * @param {Awaited<ReturnType<typeof buildExecutionSession>>} built
 * @returns {void}
 *
 * @param {Object} opts
 * @param {import('./hosted-session.js').HostedSession} [opts.hostedSession]
 * @param {string} opts.agentName
 * @param {string[]} [opts.toolNames] - Optional explicit tool override; defaults to agent frontmatter tools.
 * @param {import('@earendil-works/pi-coding-agent').ToolDefinition[]} [opts.customTools]
 * @param {string} [opts.modelOverride] - Optional explicit model override in provider/id format.
 * @param {"off"|"minimal"|"low"|"medium"|"high"|"xhigh"|"max"} [opts.thinkingLevelOverride]
 * @param {string} opts.userRequest - The user-facing request/instruction to send to the agent
 * @param {Array<{base64: string, mimeType: string}>} [opts.images]
 * @param {import('../../tools/plan-written.ts').TriageMeta} [opts.triageMeta] - Optional triage metadata threaded into auto-wired plan_written.
 * @param {{ id: import('./subagent-definitions.ts').SubAgentDefinitionId, options?: import('./subagent-definitions.ts').LoadSubAgentDefinitionOptions }} [opts.subAgentDefinition] - Select a definition from RunWield's canonical hidden-subagent registry.
 * @param {import('@earendil-works/pi-coding-agent').SessionManager} [opts.sessionManager] - Optional manager to carry
 *   context across successive isolated invocations (e.g. nudging a Reviewer that omitted its terminal tool call).
 *   Defaults to a fresh in-memory manager, which keeps the invocation isolated from the workflow transcript.
 * @param {string} [opts.cwd] - Execution cwd for file tools and agent operations.
 * @param {string} [opts.debugLogPath] - Optional DEBUG log destination for this invocation.
 * @param {string} [opts.projectStateContext] - Optional session-scoped project state note for the system prompt.
 * @param {boolean} [opts.includeEditFallback] - Internal: whether to register the edit fallback custom tool.
 * @param {boolean} [opts.workflowAuthority] - False for one-turn auxiliary Prompt Template sessions.
 * @param {boolean} [opts.ignoreManualModelOverride] - True when invocation policy must not borrow root /model state.
 * @param {boolean} [opts.updateHostedThinkingLevel] - False when thinking is temporary and must not update root footer state.
 * @param {boolean} [opts.persistModelChange] - False for temporary Claude CLI turns that must not append a root model marker.
 * @param {boolean} [opts.disableAutoCompaction] - True when a temporary turn must fail instead of compacting root context.
 * @param {AbortSignal} [opts.signal] - Optional cancellation signal for transient delegated sessions.
 * @param {import('./request-dispatch.ts').RequestDispatchKind} [opts.dispatchKind]
 * @param {import('./managed-operation.ts').ManagedOperationCapability} [opts.managedOperationCapability]
 * @param {ExecutionSessionBuiltCallback} [opts.onExecutionSessionBuilt]
 * @returns {Promise<import('@earendil-works/pi-agent-core').AgentMessage[]>}
 */
export async function runIsolatedAgentSession(opts) {
    const hostedSession = requireHostedSession(opts.hostedSession, "runIsolatedAgentSession");
    const managedOperationCapability = opts.managedOperationCapability ||
        hostedSession.getManagedOperationCapability?.() || null;
    const projectStateContext = opts.projectStateContext ?? hostedSession.getProjectStateContext();

    const built = await buildExecutionSession({
        ...opts,
        hostedSession,
        cwd: opts.cwd || hostedSession.cwd,
        projectStateContext,
    });
    const { session, agentDef, promptState, resolvedModel, resolvedThinkingLevel } = built;
    const executionSession = built.executionSession || null;
    const executionRoot = executionSession || session;
    const steeringTarget = executionSession ? getExecutionSteeringTarget(executionSession) : session;
    /** @type {SubscriberState | undefined} */
    let subscriberState;
    let agentInfoId = "";
    let steeringTargetId = "";
    let registeredSubAgent = false;
    const abortChild = () => {
        try {
            steeringTarget.abort();
        } catch (_e) { /* ignore */ }
    };

    try {
        opts.signal?.throwIfAborted();
        subscriberState = executionSession?.kind === "claude-cli"
            ? {
                resetTurn: () => {},
                drainInvokedToolNames: () => [],
                endThinking: () => {},
                unsubscribe: () => {},
            }
            : attachSessionEventSubscribers(session, agentDef, opts.debugLogPath, hostedSession);
        hostedSession.addSubAgentSession(
            steeringTarget,
            managedOperationCapability,
        );
        registeredSubAgent = true;

        const finalModel = resolvedModel ? `${resolvedModel.provider}/${resolvedModel.id}` : undefined;
        agentInfoId = hostedSession.pushAgentInfo(
            agentDef.displayName,
            finalModel,
            resolvedModel?.provider || "",
            opts.agentName,
        );
        opts.onExecutionSessionBuilt?.(built);
        steeringTargetId = hostedSession.pushSteeringTargetSession(steeringTarget);
        opts.signal?.addEventListener("abort", abortChild, { once: true });
        opts.signal?.throwIfAborted();
        const dispatch = prepareRequestDispatch(session.sessionManager, {
            userRequest: opts.userRequest,
            dispatchKind: opts.dispatchKind || "interactive",
            backend: executionSession?.kind || "pi",
        });
        const beforeCount = getRootExecutionMessages(executionRoot).length;
        try {
            let messages;
            if (executionSession?.kind === "claude-cli") {
                if (opts.disableAutoCompaction === true) {
                    assertPreparedPromptFitsContext(session, {
                        text: dispatch.userRequest,
                        images: opts.images || [],
                    }, resolvedModel);
                }
                messages = await executionSession.session.runTurn({
                    userRequest: dispatch.userRequest,
                    images: opts.images,
                    signal: opts.signal,
                    requestId: dispatch.requestId,
                    attemptId: dispatch.attemptId,
                });
            } else {
                messages = await runPrompt({
                    session,
                    agentDef,
                    agentName: opts.agentName,
                    userRequest: dispatch.userRequest,
                    finalSystemPrompt: promptState.text,
                    images: opts.images,
                    subscriberState,
                    resolvedModel,
                    resolvedThinkingLevel,
                    cwd: opts.cwd || hostedSession.cwd,
                    debugLogPath: opts.debugLogPath,
                    signal: opts.signal,
                    disableAutoCompaction: opts.disableAutoCompaction === true,
                });
            }
            completeRequestDispatch(session.sessionManager, dispatch);
            return messages;
        } catch (error) {
            failRequestDispatch(
                session.sessionManager,
                dispatch,
                getRootExecutionMessages(executionRoot).length > beforeCount,
            );
            throw error;
        }
    } finally {
        opts.signal?.removeEventListener("abort", abortChild);
        if (steeringTargetId) {
            try {
                hostedSession.popSteeringTargetSession(steeringTargetId);
            } catch (_e) { /* ignore */ }
        }
        if (agentInfoId) {
            try {
                hostedSession.popAgentInfo(agentInfoId);
            } catch (_e) { /* ignore */ }
        }
        if (registeredSubAgent) {
            try {
                hostedSession.removeSubAgentSession(steeringTarget);
            } catch (_e) { /* ignore */ }
        }
        try {
            subscriberState?.unsubscribe();
        } catch (_e) { /* ignore */ }
        try {
            if (isExecutionSession(executionRoot)) executionRoot.session.dispose();
            else session.dispose();
        } catch (_e) { /* ignore */ }
    }
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
export async function expandSkillCommand(skillName, additionalInstructions, cwd) {
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
