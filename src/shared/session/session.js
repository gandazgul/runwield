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
    SessionManager,
} from "@earendil-works/pi-coding-agent";
import { extractYaml, test as hasFrontMatter } from "@std/front-matter";
import { join } from "@std/path";
import { CWD, HOME_DIR, PROMPT_TEMPLATES_DIR, SKILLS_DIR } from "../../constants.js";
import mnemosyneExtension, {
    memoryDeleteToolDef,
    memoryRecallGlobalToolDef,
    memoryRecallToolDef,
    memoryStoreGlobalToolDef,
    memoryStoreToolDef,
} from "../../extensions/mnemosyne/index.js";
import cymbalExtension, {
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
import { ensureCymbalBinary, ensureMnemosyneBinary } from "../runtime-preflight.js";
import { executeSwitchAgent, switchAgentTool, triggerAgent } from "../../tools/switch-agent.js";
import { createUserInterviewTool } from "../../tools/user-interview.js";
import { getModelRegistry } from "../models/model-registry.js";
import { parseProviderModel } from "../models/model-validation.js";
import { getActiveModelState, getRootAgentSession, isUserModelOverride, setRootAgentSession } from "./session-state.js";
import { directoryExists, fileExists } from "../helpers.js";
import { loadAgentDef, resolveAgentDefsDir as _resolveAgentDefsDir, resolveSessionToolNames } from "./agents.js";
import { getSettingsDir } from "../settings.js";

const HOME_PROMPTS_DIR = HOME_DIR ? join(HOME_DIR, ".hns", "prompts") : null;
const LOCAL_PROMPTS_DIR = join(CWD, ".hns", "prompts");

/** @typedef {"local" | "home" | "bundled"} PromptTemplateSource */

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
 */

/**
 * Resolve prompt template search paths by priority: local > home > bundled.
 *
 * @returns {string[]}
 */
export function getPromptTemplatePaths() {
    return [
        LOCAL_PROMPTS_DIR,
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
 * @returns {Promise<PromptTemplateMeta[]>}
 */
export async function listPromptTemplates() {
    /** @type {PromptTemplateMeta[]} */
    const templates = [];
    promptTemplateModelByName.clear();
    const seen = new Set();

    /** @type {Array<{dir: string, source: PromptTemplateSource}>} */
    const layers = [
        { dir: LOCAL_PROMPTS_DIR, source: "local" },
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

    return templates;
}

/**
 * @typedef {Object} SkillMeta
 * @property {string} name
 * @property {string} description
 * @property {string} path
 * @property {"local" | "home" | "bundled"} source
 */

/**
 * List all known skills across bundled + home + local layers.
 * First name wins, based on priority local > home > bundled.
 *
 * @returns {Promise<SkillMeta[]>}
 */
export async function listSkills() {
    const skills = [];
    const seen = new Set();

    const layers = [
        { dir: join(CWD, ".hns", "skills"), source: /** @type {"local" | "home" | "bundled"} */ ("local") },
        ...(HOME_DIR
            ? [{ dir: join(HOME_DIR, ".hns", "skills"), source: /** @type {"local" | "home" | "bundled"} */ ("home") }]
            : []),
        { dir: SKILLS_DIR, source: /** @type {"local" | "home" | "bundled"} */ ("bundled") },
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

                skills.push({
                    name,
                    description,
                    path: skillMdPath,
                    source: layer.source,
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
 * Report which HARNS.md files exist in the locations
 * `assembleFinalSystemPrompt` reads from. Used by the boot banner to show
 * the user what context was actually injected into the system prompt.
 *
 * @returns {Promise<{ path: string, source: "home" | "local" }[]>}
 */
export async function listLoadedAgentMdFiles() {
    /** @type {{ path: string, source: "home" | "local" }[]} */
    const results = [];

    if (HOME_DIR) {
        const homePath = join(HOME_DIR, ".hns", "HARNS.md");
        const fallbackPath = join(HOME_DIR, ".pi", "agent", "HARNS.md");
        if (await fileExists(homePath)) {
            results.push({ path: homePath, source: "home" });
        } else if (await fileExists(fallbackPath)) {
            results.push({ path: fallbackPath, source: "home" });
        }
    }

    const projectPath = join(CWD, "HARNS.md");
    if (await fileExists(projectPath)) {
        results.push({ path: projectPath, source: "local" });
    }

    return results;
}

/** @type {Set<import('@earendil-works/pi-coding-agent').AgentSession>} */
const activeSessions = new Set();

/**
 * Stop all currently active agent sessions.
 *
 * @returns {boolean} true when at least one active session was aborted
 */
export function abortActiveSession() {
    const hadActiveSessions = activeSessions.size > 0;
    for (const session of activeSessions) {
        session.abort();
    }
    return hadActiveSessions;
}

/**
 * Steer the root (user-facing) session with a message injected between tool calls.
 * Sub-agent sessions spawned by tools are intentionally excluded.
 *
 * @param {string} text
 * @param {import('./types.js').ImageAttachment[]} [images]
 * @returns {Promise<boolean>} true when the root session was steered
 */
export async function steerRootSession(text, images) {
    const session = getRootAgentSession();
    if (!session) return false;
    /** @type {Array<{type: "image", data: string, mimeType: string}>} */
    const imageContent = images && images.length > 0
        ? images.map((img) => ({ type: /** @type {"image"} */ ("image"), data: img.base64, mimeType: img.mimeType }))
        : [];
    await session.steer(text, imageContent.length > 0 ? imageContent : undefined);
    return true;
}

/**
 * Resolve the model to use for an agent invocation, based on the following priority:
 * 1) Explicit model override passed to `runAgentSession`
 * 2) Active model state (e.g. from a previous /model switch)
 *
 * @param {string | undefined} modelOverride
 * @param {import('./types.js').AgentDefinition} agentDef
 *
 * @returns {any | null}
 */
function resolveModel(modelOverride, agentDef) {
    let resolvedModel = null;
    const modelRegistry = getModelRegistry();

    /** @type {string[]} */
    const candidateModels = [];
    if (modelOverride) candidateModels.push(modelOverride);

    const activeModelState = getActiveModelState();
    if (activeModelState.model) {
        candidateModels.push(
            activeModelState.provider
                ? `${activeModelState.provider}/${activeModelState.model}`
                : activeModelState.model,
        );
    }

    if (agentDef.model) {
        candidateModels.push(agentDef.model);
    }

    for (const candidate of candidateModels) {
        const parsed = parseProviderModel(candidate);
        if (!parsed.ok) {
            throw new Error(`Invalid model format: ${candidate}. Use provider/id.`);
        }

        const found = modelRegistry.find(parsed.provider, parsed.id);
        if (!found) {
            if (candidate === modelOverride) {
                throw new Error(`Unknown model: ${candidate}`);
            }
            continue;
        }

        if (!modelRegistry.hasConfiguredAuth(found)) {
            if (candidate === modelOverride) {
                throw new Error(`No API key configured for ${found.provider}/${found.id}`);
            }
            continue;
        }

        resolvedModel = found;
        break;
    }

    return resolvedModel;
}

/**
 * Assemble the final system prompt by resolving placeholders.
 *
 * @param {import('./types.js').AgentDefinition} agentDef
 * @param {string[]} tools
 * @param {import('@earendil-works/pi-coding-agent').ToolDefinition[]} finalCustomTools
 * @returns {Promise<string>}
 */
export async function assembleFinalSystemPrompt(agentDef, tools, finalCustomTools) {
    const piTools = [
        createBashToolDefinition(CWD),
        createGrepToolDefinition(CWD),
        createFindToolDefinition(CWD),
        createLsToolDefinition(CWD),
        createReadToolDefinition(CWD),
        createWriteToolDefinition(CWD),
        createEditToolDefinition(CWD),
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
    // 1. Add custom tools and dynamically injected tools
    for (const tool of finalCustomTools) {
        customToolMap.set(tool.name, tool.promptSnippet || tool.description);
    }
    // 2. Add extension tool descriptions
    for (const tool of extensionTools) {
        customToolMap.set(tool.name, tool.promptSnippet || tool.description);
    }
    // 3. Add pi-coding-agent built-in tools
    for (const tool of piTools) {
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
        try {
            globalAgentsMd = await Deno.readTextFile(join(homeDir, ".hns", "HARNS.md"));
        } catch {
            try {
                globalAgentsMd = await Deno.readTextFile(join(homeDir, ".pi", "agent", "HARNS.md"));
            } catch {
                globalAgentsMd = "";
            }
        }
    }
    finalSystemPrompt = finalSystemPrompt.replace("{{GLOBAL_AGENTSMD}}", globalAgentsMd);

    let projectAgentsMd = "";
    try {
        projectAgentsMd = await Deno.readTextFile(join(CWD, "HARNS.md"));
    } catch {
        projectAgentsMd = "";
    }
    finalSystemPrompt = finalSystemPrompt.replace("{{PROJECT_AGENTSMD}}", projectAgentsMd);

    let memories = "";
    try {
        const command = new Deno.Command("mnemosyne", {
            args: ["list", "-t", "core", "-f", "plain"],
            cwd: CWD,
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
        const skills = await listSkills();
        skillsBlock = skills
            .filter((skill) => skill.name && skill.description)
            .map((skill) => `- ${skill.name} - ${skill.description}`)
            .join("\n");
    } catch {
        skillsBlock = "";
    }
    finalSystemPrompt = finalSystemPrompt.replace("{{SKILLS}}", skillsBlock);

    return finalSystemPrompt;
}

/**
 * Run a single agent invocation and wait for idle.
 *
 * @param {Object} opts
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
 *
 * @returns {Promise<import('@earendil-works/pi-agent-core').AgentMessage[]>}
 */
export async function runAgentSession(
    {
        agentName,
        toolNames,
        customTools,
        modelOverride,
        userRequest,
        images,
        uiAPI,
        sessionManager,
        triageMeta,
        _agentDefOverride,
    },
) {
    await ensureMnemosyneBinary();
    await ensureCymbalBinary();
    const agentDef = _agentDefOverride || await loadAgentDef(agentName);

    const customToolNames = (customTools || []).map((t) => t.name);
    const tools = resolveSessionToolNames(agentDef.tools, toolNames, customToolNames);

    const finalCustomTools = [...(customTools || [])];

    // Auto-wire internal custom tools if requested by name and not already provided.
    // This keeps agent frontmatter declarative: adding/removing tool names controls availability,
    // while Harns runtime injects the concrete tool implementations.

    if (tools.includes("switch_agent") && !finalCustomTools.find((t) => t.name === "switch_agent")) {
        finalCustomTools.push({
            ...switchAgentTool,
            execute(_toolCallId, params, _signal, _onUpdate, context) {
                return executeSwitchAgent(
                    /** @type {{ agentName: string, reason: string }} */ (params),
                    uiAPI,
                    context,
                    triggerAgent,
                );
            },
        });
    }

    if (tools.includes("plan_written") && uiAPI && !finalCustomTools.find((t) => t.name === "plan_written")) {
        const { createPlanWrittenTool } = await import("../../tools/plan-written.js");
        finalCustomTools.push(createPlanWrittenTool({ uiAPI, triageMeta, agentName }));
    }

    if (tools.includes("triage_report") && !finalCustomTools.find((t) => t.name === "triage_report")) {
        const { createTriageReportTool } = await import("../../tools/triage-report.js");
        finalCustomTools.push(createTriageReportTool({ uiAPI }));
    }

    if (tools.includes("user_interview") && !finalCustomTools.find((t) => t.name === "user_interview")) {
        finalCustomTools.push(createUserInterviewTool(uiAPI));
    }

    // Update the agent info in the UI footer.
    if (uiAPI?.setAgentInfo) {
        // If the user has an active /model override, don't clobber it — only update the agent name.
        if (isUserModelOverride()) {
            uiAPI.setAgentInfo(agentDef.name);
        } else {
            const agentModelForUi = modelOverride || agentDef.model;
            uiAPI.setAgentInfo(agentDef.name, agentModelForUi);
        }
    }

    // Resolve system prompt placeholders
    const finalSystemPrompt = await assembleFinalSystemPrompt(agentDef, tools, finalCustomTools);

    const loader = new DefaultResourceLoader({
        cwd: CWD,
        agentDir: getSettingsDir("global"),
        systemPromptOverride: () => finalSystemPrompt,
        extensionFactories: [mnemosyneExtension, cymbalExtension],
        additionalPromptTemplatePaths: getPromptTemplatePaths(),
        noPromptTemplates: true,
    });
    await loader.reload();

    const resolvedModel = resolveModel(modelOverride, agentDef);

    const { session, extensionsResult } = await createAgentSession({
        cwd: CWD,
        tools,
        customTools: finalCustomTools,
        resourceLoader: loader,
        sessionManager: sessionManager || SessionManager.inMemory(),
        ...(resolvedModel ? { model: resolvedModel } : {}),
    });

    if (extensionsResult?.errors?.length) {
        for (const err of extensionsResult.errors) {
            const msg = `[Harns] Extension warning (${err.path}): ${err.error}`;
            if (uiAPI) uiAPI.appendSystemMessage(msg);
            else console.warn(msg);
            if (String(err.error).toLowerCase().includes("mnemosyne")) {
                const msg2 =
                    "[Harns] Memory extension issue detected. Install mnemosyne: https://github.com/gandazgul/mnemosyne#quick-start";
                if (uiAPI) uiAPI.appendSystemMessage(msg2);
                else console.warn(msg2);
            }
        }
    }

    // Ensure extension lifecycle hooks (e.g. session_start) are activated for this agent invocation.
    await session.bindExtensions({});

    /** @type {{ appendText: (delta: string) => void } | null} */
    let currentMarkdownBlock = null;
    /** @type {string[]} */
    const invokedToolNames = [];
    /** @type {{ appendDelta: (delta: string) => void, end: () => void } | null} */
    let currentThinkingStream = null;

    const endThinking = () => {
        if (currentThinkingStream) {
            currentThinkingStream.end();
            currentThinkingStream = null;
        }
    };

    session.subscribe((event) => {
        switch (event.type) {
            case "message_start": {
                if (event.message.role === "assistant") {
                    // Start a fresh assistant message context, but do not render a block yet.
                    // We only create assistant blocks lazily when we receive actual text deltas
                    // (or when rendering an assistant error on message_end).
                    currentMarkdownBlock = null;
                    endThinking();
                }
                break;
            }
            case "message_update": {
                if (event.assistantMessageEvent.type === "thinking_delta") {
                    if (!currentThinkingStream && uiAPI) {
                        currentThinkingStream = uiAPI.appendThinkingStart?.() ?? null;
                    }
                    if (currentThinkingStream) {
                        currentThinkingStream.appendDelta(event.assistantMessageEvent.delta);
                    } else {
                        console.log(event.assistantMessageEvent.delta);
                    }
                    break;
                }

                if (event.assistantMessageEvent.type === "thinking_end") {
                    endThinking();
                    break;
                }

                if (event.assistantMessageEvent.type === "text_delta") {
                    endThinking();
                    if (uiAPI) {
                        if (!currentMarkdownBlock) {
                            currentMarkdownBlock = uiAPI.appendAgentMessageStart(
                                agentDef.name,
                            );
                        }
                        currentMarkdownBlock.appendText(event.assistantMessageEvent.delta);
                        uiAPI.requestRender();
                    } else {
                        Deno.stdout.writeSync(
                            new TextEncoder().encode(event.assistantMessageEvent.delta),
                        );
                    }
                }
                break;
            }
            case "message_end": {
                if (event.message.role === "assistant") {
                    endThinking();
                }

                if (
                    event.message.role === "assistant" && event.message.stopReason === "error" &&
                    uiAPI
                ) {
                    if (!currentMarkdownBlock) {
                        currentMarkdownBlock = uiAPI.appendAgentMessageStart(agentDef.name);
                    }
                    currentMarkdownBlock.appendText(
                        `\n\n**Error:** ${event.message.errorMessage || "Unknown LLM error"}`,
                    );
                    uiAPI.requestRender();
                }
                break;
            }
            case "auto_retry_start": {
                if (uiAPI) {
                    uiAPI.appendSystemMessage(
                        `[Retry ${event.attempt}/${event.maxAttempts}] ${event.errorMessage} — waiting ${event.delayMs}ms...`,
                    );
                }
                break;
            }
            case "auto_retry_end": {
                if (uiAPI && !event.success) {
                    uiAPI.appendSystemMessage(
                        `Auto-retry failed after ${event.attempt} attempts: ${event.finalError || "Unknown error"}`,
                        true,
                    );
                }
                break;
            }
            case "tool_execution_start": {
                currentMarkdownBlock = null;
                invokedToolNames.push(event.toolName);

                const filePath = getFilePathForTool(event.toolName, event.args);
                let headerArgs = "";
                if (filePath) headerArgs = `${filePath}`;
                else if (event.toolName === "bash") headerArgs = event.args?.command || "";
                else if (event.toolName === "grep") {
                    headerArgs = `${event.args?.pattern} in ${event.args?.path || "."}`;
                } else if (event.toolName === "find") {
                    headerArgs = `${event.args?.pattern} in ${event.args?.path || "."}`;
                }

                if (uiAPI && uiAPI.startToolExecution) {
                    const headerName = event.toolName === "bash" ? "$" : event.toolName;
                    uiAPI.startToolExecution(event.toolCallId, headerName, headerArgs);
                } else {
                    console.log(`\n  [Tool] ${event.toolName} ${headerArgs}`);
                }
                break;
            }
            case "tool_execution_update": {
                if (uiAPI && uiAPI.getActiveToolBlock) {
                    const block = uiAPI.getActiveToolBlock(event.toolCallId);
                    if (block && event.partialResult && event.partialResult.content) {
                        const newContentText = event.partialResult.content
                            .map((/** @type {{ text?: string } | null | undefined } */ contentBlock) =>
                                contentBlock && typeof contentBlock === "object" ? String(contentBlock.text || "") : ""
                            )
                            .join("");
                        const currentText = block.bodyText || "";
                        if (newContentText.length > currentText.length) {
                            block.appendOutput(newContentText.slice(currentText.length));
                        }
                    }
                }
                break;
            }
            case "tool_execution_end": {
                if (uiAPI && uiAPI.getActiveToolBlock) {
                    const block = uiAPI.getActiveToolBlock(event.toolCallId);
                    if (block) {
                        // Make sure we append any final result text that wasn't streamed
                        if (event.result && event.result.content) {
                            const newContentText = event.result.content
                                .map((/** @type {{ text?: string } | null | undefined } */ contentBlock) =>
                                    contentBlock && typeof contentBlock === "object"
                                        ? String(contentBlock.text || "")
                                        : ""
                                )
                                .join("");
                            const currentText = block.bodyText || "";
                            if (newContentText.length > currentText.length) {
                                block.appendOutput(newContentText.slice(currentText.length));
                            }
                        }
                        const durationMs = Date.now() - block.startTime;
                        block.endExecution(event.isError, durationMs);
                    }
                } else {
                    console.log(`  [Tool] ${event.toolName} — ${event.isError ? "error" : "ok"}`);
                }
                break;
            }
            case "turn_start": {
                if (uiAPI && uiAPI.setBusy) uiAPI.setBusy(true);
                break;
            }
            case "turn_end": {
                if (uiAPI && uiAPI.setBusy) uiAPI.setBusy(false);
                break;
            }
        }
    });

    const requestOptions = {};
    if (images && images.length > 0) {
        requestOptions.images = images.map((img) => ({
            type: /** @type {"image"} */ ("image"),
            data: img.base64,
            mimeType: img.mimeType,
        }));
    }

    const debugEnabled = Deno.env.get("DEBUG") === "1";
    if (debugEnabled) {
        const startTitle = agentName === "router"
            ? "ROUTER INVOCATION START"
            : `AGENT INVOCATION START: ${agentDef.name} (${agentName})`;
        const logEntry = [
            `Event: ${startTitle}`,
            `Timestamp: ${new Date().toISOString()}`,
            `System Prompt:`,
            finalSystemPrompt,
            `User Request:`,
            userRequest,
            "",
        ].join("\n");
        try {
            Deno.writeTextFileSync(join(Deno.cwd(), "debug.log"), logEntry, { append: true });
        } catch (_e) {
            // Ignore log error
        }
    }

    /** @type {Error | null} */
    let promptError = null;

    const isRoot = activeSessions.size === 0;

    try {
        activeSessions.add(session);
        if (isRoot) setRootAgentSession(session);
        await session.prompt(userRequest, requestOptions);
        await session.agent.waitForIdle();
    } catch (error) {
        promptError = error instanceof Error ? error : new Error(String(error));
        throw error;
    } finally {
        activeSessions.delete(session);
        if (isRoot) setRootAgentSession(null);

        // Defensive cleanup: end any active thinking stream and force idle UI state.
        // This handles abort/error edge paths where turn_end events may never fire.
        endThinking();
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
            const logEntry = agentName === "router"
                ? [
                    `Event: ROUTER INVOCATION END`,
                    `Timestamp: ${new Date().toISOString()}`,
                    `Router Tools Used: ${invokedToolNames.join(", ") || "(none)"}`,
                    promptError ? `Status: ERROR (${promptError.message})` : `Status: OK`,
                    "",
                ].join("\n")
                : [
                    `Event: AGENT INVOCATION END: ${agentDef.name} (${agentName})`,
                    `Timestamp: ${new Date().toISOString()}`,
                    `Tools Used: ${invokedToolNames.join(", ") || "(none)"}`,
                    promptError ? `Status: ERROR (${promptError.message})` : `Status: OK`,
                    `Summary:`,
                    summary || "(empty)",
                    "",
                ].join("\n");
            try {
                Deno.writeTextFileSync(join(Deno.cwd(), "debug.log"), logEntry, { append: true });
            } catch (_e) {
                // Ignore log error
            }
        }
    }

    return session.agent.state.messages;
}

/**
 * Extract file path from tool arguments for read/edit/write tools.
 *
 * @param {string} toolName
 * @param {{ path?: string, file_path?: string }} args
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
