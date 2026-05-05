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
} from "@mariozechner/pi-coding-agent";
import { extractYaml, test as hasFrontMatter } from "@std/front-matter";
import { dirname, fromFileUrl, join } from "@std/path";
import { AGENT_DEFS_DIR, CWD, PROMPT_TEMPLATES_DIR } from "../../constants.js";
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
import { planWrittenTool } from "../../tools/plan-written.js";
import { executeSwitchAgent, switchAgentTool, triggerAgent } from "../../tools/switch-agent.js";
import { triageReportTool } from "../../tools/triage-report.js";
import { createUserInterviewTool } from "../../tools/user-interview.js";
import { getModelRegistry } from "../models/model-registry.js";
import { parseProviderModel } from "../models/model-validation.js";
import { getActiveModelState } from "./session-state.js";

const HOME_DIR = Deno.env.get("HOME") || "";
const HOME_AGENT_DEFS_DIR = HOME_DIR ? join(HOME_DIR, ".hns", "agents") : null;
const LOCAL_AGENT_DEFS_DIR = join(CWD, ".hns", "agents");

const HOME_PROMPTS_DIR = HOME_DIR ? join(HOME_DIR, ".hns", "prompts") : null;
const LOCAL_PROMPTS_DIR = join(CWD, ".hns", "prompts");

const __dirname = dirname(fromFileUrl(import.meta.url));
const CORE_SYSTEM_PROMPT = await Deno.readTextFile(join(__dirname, "SYSTEM_PROMPT_TEMPLATE.md"));

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
 * @returns {string[]}
 */
function getAgentDefLayerDirs() {
    return [
        AGENT_DEFS_DIR,
        ...(HOME_AGENT_DEFS_DIR ? [HOME_AGENT_DEFS_DIR] : []),
        LOCAL_AGENT_DEFS_DIR,
    ];
}

/**
 * @returns {string[]}
 */
function getAgentDefDirsByPriority() {
    return [
        LOCAL_AGENT_DEFS_DIR,
        ...(HOME_AGENT_DEFS_DIR ? [HOME_AGENT_DEFS_DIR] : []),
        AGENT_DEFS_DIR,
    ];
}

/**
 * @param {string} path
 * @returns {Promise<boolean>}
 */
async function directoryExists(path) {
    try {
        const stat = await Deno.stat(path);
        return stat.isDirectory;
    } catch {
        return false;
    }
}

/**
 * @param {string} path
 * @returns {Promise<boolean>}
 */
async function fileExists(path) {
    try {
        const stat = await Deno.stat(path);
        return stat.isFile;
    } catch {
        return false;
    }
}

/**
 * Tools that are always available in Harns regardless of frontmatter overrides.
 *
 * @type {string[]}
 */
const INTERNAL_TOOL_NAMES = [
    "switch_agent",
    "plan_written",
    "triage_report",
    "user_interview",
    "memory_recall",
    "memory_recall_global",
    "memory_store",
    "memory_store_global",
    "memory_delete",
    "code_search",
    "code_show",
    "code_outline",
    "code_refs",
    "code_impact",
    "code_trace",
    "code_investigate",
    "code_structure",
    "code_impls",
    "code_importers",
];

/**
 * Normalize unknown tool list input into a deduped array of non-empty strings.
 *
 * @param {unknown} tools
 * @returns {string[]}
 */
function normalizeToolNames(tools) {
    if (!Array.isArray(tools)) return [];

    /** @type {string[]} */
    const normalized = [];

    for (const tool of tools) {
        const toolName = typeof tool === "string" ? tool.trim() : "";
        if (!toolName) continue;
        if (!normalized.includes(toolName)) normalized.push(toolName);
    }

    return normalized;
}

/**
 * Append internal Harns tools while preserving existing order and avoiding duplicates.
 *
 * @param {string[] | undefined} baseTools
 * @returns {string[]}
 */
function addInternalTools(baseTools) {
    const merged = [...(baseTools || [])];

    for (const toolName of INTERNAL_TOOL_NAMES) {
        if (!merged.includes(toolName)) merged.push(toolName);
    }

    return merged;
}

/**
 * Resolve an existing agent definitions directory for pi-coding-agent resource loading.
 * Priority: local (`.hns/agents`) > home (`~/.hns/agents`) > bundled defaults.
 *
 * @returns {Promise<string>}
 */
export async function resolveAgentDefsDir() {
    for (const dir of getAgentDefDirsByPriority()) {
        if (await directoryExists(dir)) return dir;
    }

    throw new Error(
        [
            "Could not find any agent defs directory.",
            `Tried local: ${LOCAL_AGENT_DEFS_DIR}`,
            ...(HOME_AGENT_DEFS_DIR ? [`Tried home: ${HOME_AGENT_DEFS_DIR}`] : []),
            `Tried bundled: ${AGENT_DEFS_DIR}`,
        ].join(" "),
    );
}

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
 * List all known agent definition names across bundled + home + local layers.
 *
 * @returns {Promise<string[]>}
 */
export async function listAgentDefNames() {
    const names = new Set();

    for (const dir of getAgentDefLayerDirs()) {
        if (!(await directoryExists(dir))) continue;
        for await (const entry of Deno.readDir(dir)) {
            if (!entry.isFile || !entry.name.endsWith(".md")) continue;
            names.add(entry.name.replace(/\.md$/, ""));
        }
    }

    return [...names].sort((a, b) => a.localeCompare(b));
}

/**
 * @typedef {Object} AgentDef
 * @property {string} name - Agent display name (from frontmatter or filename)
 * @property {string} model - Model identifier
 * @property {string} description - One-line description from merged frontmatter
 * @property {string[]} tools - Allowed tool names from merged frontmatter
 * @property {string} systemPrompt - Core system prompt + merged agent prompt
 */

/**
 * Load and merge an agent definition from layered files:
 * 1) bundled: `src/agent-definitions/<name>.md`
 * 2) home override: `~/.hns/agents/<name>.md`
 * 3) local override: `<cwd>/.hns/agents/<name>.md`
 *
 * Higher layers override scalar attrs. Prompt body appends by default; if a
 * layer sets `promptOverride: true`, lower-layer prompt content is discarded.
 * Tool lists are replaced when a higher layer defines `tools`.
 *
 * @param {string} agentName
 * @returns {Promise<AgentDef>}
 */
export async function loadAgentDef(agentName) {
    const layerDirs = getAgentDefLayerDirs();

    /** @type {{ name?: string, model?: string, description?: string, promptOverride?: boolean, tools?: unknown[], [key: string]: unknown }} */
    let mergedAttrs = {};
    /** @type {string[]} */
    let mergedTools = [];
    /** @type {string[]} */
    let promptSegments = [];
    let found = false;

    for (const dir of layerDirs) {
        const filePath = join(dir, `${agentName}.md`);
        if (!(await fileExists(filePath))) continue;

        const raw = await Deno.readTextFile(filePath);
        if (!hasFrontMatter(raw)) {
            throw new Error(`Agent def ${filePath} has no frontmatter`);
        }

        const { attrs, body } = extractYaml(raw);
        found = true;

        mergedAttrs = { ...mergedAttrs, ...attrs };
        if (Object.prototype.hasOwnProperty.call(attrs, "tools")) {
            mergedTools = normalizeToolNames(attrs.tools);
        }

        if (attrs.promptOverride === true) {
            promptSegments = [];
        }

        const trimmedBody = body.trim();
        if (trimmedBody) promptSegments.push(trimmedBody);
    }

    if (!found) {
        throw new Error(
            [
                `Could not find agent def for "${agentName}".`,
                `Checked bundled: ${join(AGENT_DEFS_DIR, `${agentName}.md`)}`,
                ...(HOME_AGENT_DEFS_DIR ? [`Checked home: ${join(HOME_AGENT_DEFS_DIR, `${agentName}.md`)}`] : []),
                `Checked local: ${join(LOCAL_AGENT_DEFS_DIR, `${agentName}.md`)}`,
            ].join(" "),
        );
    }

    const name = typeof mergedAttrs.name === "string" && mergedAttrs.name.trim() ? mergedAttrs.name : agentName;
    const model = typeof mergedAttrs.model === "string" && mergedAttrs.model.trim()
        ? mergedAttrs.model
        : "claude-sonnet-4-20250514";
    const description = typeof mergedAttrs.description === "string" ? mergedAttrs.description : "";

    const mergedPromptBody = promptSegments.join("\n\n").trim();
    const systemPrompt = CORE_SYSTEM_PROMPT.replace("{{AGENT_PROMPT}}", mergedPromptBody);

    return {
        name,
        model,
        description,
        tools: addInternalTools(mergedTools),
        systemPrompt,
    };
}

/** @type {Set<import('@mariozechner/pi-coding-agent').AgentSession>} */
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
 * Resolve the model to use for an agent invocation, based on the following priority:
 * 1) Explicit model override passed to `runAgentSession`
 * 2) Active model state (e.g. from a previous /model switch)
 *
 * @param {string | undefined} modelOverride
 * @param {AgentDef} agentDef
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
 * @param {AgentDef} agentDef
 * @param {string[]} tools
 * @param {import('@mariozechner/pi-coding-agent').ToolDefinition[]} finalCustomTools
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
    finalSystemPrompt = finalSystemPrompt.replace("{{AVAILABLE_TOOLS}}", availableToolsStr);

    let globalAgentsMd = "";
    const homeDir = Deno.env.get("HOME") || "";
    if (homeDir) {
        try {
            globalAgentsMd = await Deno.readTextFile(join(homeDir, ".hns", "AGENTS.md"));
        } catch {
            try {
                globalAgentsMd = await Deno.readTextFile(join(homeDir, ".pi", "agent", "AGENTS.md"));
            } catch {
                globalAgentsMd = "";
            }
        }
    }
    finalSystemPrompt = finalSystemPrompt.replace("{{GLOBAL_AGENTSMD}}", globalAgentsMd);

    let projectAgentsMd = "";
    try {
        projectAgentsMd = await Deno.readTextFile(join(CWD, "AGENTS.md"));
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

    return finalSystemPrompt;
}

/**
 * Run a single agent invocation and wait for idle.
 *
 * @param {Object} opts
 * @param {string} opts.agentName
 * @param {string[]} [opts.toolNames] - Optional explicit tool override; defaults to agent frontmatter tools.
 * @param {import('@mariozechner/pi-coding-agent').ToolDefinition[]} [opts.customTools]
 * @param {string} [opts.modelOverride] - Optional explicit model override in provider/id format.
 * @param {string} opts.userRequest - The user-facing request/instruction to send to the agent
 * @param {Array<{base64: string, mimeType: string}>} [opts.images]
 * @param {import('../workflow/workflow.js').UiAPI} [opts.uiAPI]
 * @param {import('@mariozechner/pi-coding-agent').SessionManager} [opts.sessionManager]
 *
 * @returns {Promise<import('@mariozechner/pi-agent-core').AgentMessage[]>}
 */
export async function runAgentSession(
    { agentName, toolNames, customTools, modelOverride, userRequest, images, uiAPI, sessionManager },
) {
    await ensureMnemosyneBinary();
    await ensureCymbalBinary();
    const resourceAgentDir = await resolveAgentDefsDir();
    const agentDef = await loadAgentDef(agentName);

    const customToolNames = (customTools || []).map((t) => t.name);
    const selectedToolNames = toolNames || agentDef.tools;
    const tools = addInternalTools([...new Set([...(selectedToolNames || []), ...customToolNames])]);
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

    if (tools.includes("plan_written") && !finalCustomTools.find((t) => t.name === "plan_written")) {
        finalCustomTools.push(planWrittenTool);
    }

    if (tools.includes("triage_report") && !finalCustomTools.find((t) => t.name === "triage_report")) {
        finalCustomTools.push(triageReportTool);
    }

    if (tools.includes("user_interview") && !finalCustomTools.find((t) => t.name === "user_interview")) {
        finalCustomTools.push(createUserInterviewTool(uiAPI));
    }

    // Update the agent info in the UI footer.
    const agentModelForUi = modelOverride || agentDef.model;
    if (uiAPI?.setAgentInfo) {
        uiAPI.setAgentInfo(agentDef.name, agentModelForUi);
    }

    // Resolve system prompt placeholders
    const finalSystemPrompt = await assembleFinalSystemPrompt(agentDef, tools, finalCustomTools);

    const loader = new DefaultResourceLoader({
        cwd: CWD,
        agentDir: resourceAgentDir,
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
    let pendingThinkingText = "";

    const flushThinking = () => {
        if (!pendingThinkingText.trim()) {
            pendingThinkingText = "";
            return;
        }

        if (uiAPI) {
            uiAPI.appendSystemMessage(pendingThinkingText);
        } else {
            console.log(`\n${pendingThinkingText}`);
        }

        pendingThinkingText = "";
    };

    session.subscribe((event) => {
        switch (event.type) {
            case "message_start": {
                if (event.message.role === "assistant") {
                    // Start a fresh assistant message context, but do not render a block yet.
                    // We only create assistant blocks lazily when we receive actual text deltas
                    // (or when rendering an assistant error on message_end).
                    currentMarkdownBlock = null;
                    pendingThinkingText = "";
                }
                break;
            }
            case "message_update": {
                if (event.assistantMessageEvent.type === "thinking_delta") {
                    pendingThinkingText += event.assistantMessageEvent.delta;
                    break;
                }

                if (event.assistantMessageEvent.type === "thinking_end") {
                    flushThinking();
                    break;
                }

                if (event.assistantMessageEvent.type === "text_delta") {
                    flushThinking();
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
                    flushThinking();
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

    try {
        activeSessions.add(session);
        await session.prompt(userRequest, requestOptions);
        await session.agent.waitForIdle();
    } catch (error) {
        promptError = error instanceof Error ? error : new Error(String(error));
        throw error;
    } finally {
        activeSessions.delete(session);

        // Defensive cleanup: clear pending thinking buffer and force idle UI state.
        // This handles abort/error edge paths where turn_end events may never fire.
        pendingThinkingText = "";
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
 * @param {import('@mariozechner/pi-agent-core').AgentMessage[]} messages
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
