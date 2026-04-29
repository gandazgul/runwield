/**
 * @module shared/session
 * Shared helpers for loading agent definitions and running agent invocations.
 */

import { createAgentSession, DefaultResourceLoader, SessionManager } from "@mariozechner/pi-coding-agent";
import { extractYaml, test as hasFrontMatter } from "@std/front-matter";
import { join } from "@std/path";
import { AGENT_DEFS_DIR, CORE_SYSTEM_PROMPT, CWD } from "../constants.js";
import mnemosyneExtension from "../extensions/mnemosyne/index.js";

const HOME_DIR = Deno.env.get("HOME") || "";
const HOME_AGENT_DEFS_DIR = HOME_DIR ? join(HOME_DIR, ".hns", "agents") : null;
const LOCAL_AGENT_DEFS_DIR = join(CWD, ".hns", "agents");

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
 * Merge tool names by union + stable order, keeping lower-layer defaults and
 * appending any new higher-layer tools.
 *
 * @param {string[]} baseTools
 * @param {unknown} nextTools
 * @returns {string[]}
 */
function mergeTools(baseTools, nextTools) {
    const merged = [...baseTools];
    if (!Array.isArray(nextTools)) return merged;

    for (const tool of nextTools) {
        const toolName = typeof tool === "string" ? tool.trim() : "";
        if (!toolName) continue;
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
 * Tools are merged by union (deduped), preserving existing defaults.
 *
 * @param {string} agentName
 * @returns {Promise<AgentDef>}
 */
export async function loadAgentDef(agentName) {
    const layerDirs = getAgentDefLayerDirs();

    /** @type {Record<string, unknown>} */
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
        mergedTools = mergeTools(mergedTools, attrs.tools);

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
    const systemPrompt = mergedPromptBody ? `${CORE_SYSTEM_PROMPT}\n\n${mergedPromptBody}` : CORE_SYSTEM_PROMPT;

    return {
        name,
        model,
        description,
        tools: mergedTools,
        systemPrompt,
    };
}

/** @type {Set<import('@mariozechner/pi-coding-agent').AgentSession>} */
const activeSessions = new Set();

/**
 * Stop all currently active agent sessions.
 */
export function abortActiveSession() {
    for (const session of activeSessions) {
        session.abort();
    }
}

/**
 * Run a single agent invocation and wait for idle.
 *
 * @param {Object} opts
 * @param {string} opts.agentName
 * @param {string[]} [opts.toolNames] - Optional explicit tool override; defaults to agent frontmatter tools.
 * @param {import('@mariozechner/pi-coding-agent').ToolDefinition[]} [opts.customTools]
 * @param {string} opts.userRequest - The user-facing request/instruction to send to the agent
 * @param {Array<{base64: string, mimeType: string}>} [opts.images]
 * @param {import('./workflow.js').UiAPI} [opts.uiAPI]
 * @returns {Promise<import('@mariozechner/pi-agent-core').AgentMessage[]>}
 */
export async function runAgentSession(
    { agentName, toolNames, customTools, userRequest, images, uiAPI },
) {
    const resourceAgentDir = await resolveAgentDefsDir();
    const agentDef = await loadAgentDef(agentName);

    const customToolNames = (customTools || []).map((t) => t.name);
    const selectedToolNames = toolNames || agentDef.tools;
    const tools = [...new Set([...(selectedToolNames || []), ...customToolNames])];

    // Attempt to update the agent info in the UI footer.
    if (uiAPI) {
        if (uiAPI.setAgentInfo) {
            uiAPI.setAgentInfo(agentDef.name, agentDef.model);
        }
        uiAPI.appendSystemMessage(
            `[Harns] Loading agent: ${agentDef.name} (model: ${agentDef.model})`,
        );
    } else {
        console.log(
            `\n[Harns] Loading agent: ${agentDef.name} (model: ${agentDef.model})`,
        );
    }

    const loader = new DefaultResourceLoader({
        cwd: CWD,
        agentDir: resourceAgentDir,
        systemPromptOverride: () => agentDef.systemPrompt,
        extensionFactories: [mnemosyneExtension],
    });
    await loader.reload();

    const { session, extensionsResult } = await createAgentSession({
        cwd: CWD,
        tools,
        customTools: customTools || [],
        resourceLoader: loader,
        sessionManager: SessionManager.inMemory(),
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

    /** @type {any} */
    let currentMarkdownBlock = null;

    session.subscribe((event) => {
        switch (event.type) {
            case "message_update": {
                if (event.assistantMessageEvent.type === "text_delta") {
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
            case "tool_execution_start": {
                currentMarkdownBlock = null;

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
                    uiAPI.startToolExecution(event.toolCallId, event.toolName, headerArgs);
                } else {
                    console.log(`\n  [Tool] ${event.toolName} ${headerArgs}`);
                }
                break;
            }
            case "tool_execution_update": {
                if (uiAPI && uiAPI.getActiveToolBlock) {
                    const block = uiAPI.getActiveToolBlock(event.toolCallId);
                    if (block && event.partialResult && event.partialResult.content) {
                        const newContentText = event.partialResult.content.map((/** @type {any} */ c) => c.text || "")
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
                            const newContentText = event.result.content.map((/** @type {any} */ c) => c.text || "")
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

    try {
        activeSessions.add(session);

        if (Deno.env.get("DEBUG") === "1") {
            const logEntry = [
                `===========================================`,
                `=== AGENT INVOCATION: ${agentDef.name} ===`,
                `=== TIMESTAMP: ${new Date().toISOString()} ===`,
                `=== TOOLS: ${tools.join(", ")} ===`,
                `=== SYSTEM PROMPT ===`,
                agentDef.systemPrompt,
                `=== USER REQUEST ===`,
                userRequest,
                `===========================================`,
                "",
            ].join("\n");
            try {
                Deno.writeTextFileSync(join(Deno.cwd(), "debug.log"), logEntry, { append: true });
            } catch (_e) {
                // Ignore log error
            }
        }

        await session.prompt(userRequest, requestOptions);
        await session.agent.waitForIdle();
    } finally {
        activeSessions.delete(session);
    }

    return session.agent.state.messages;
}

/**
 * Extract file path from tool arguments for read/edit/write tools.
 *
 * @param {string} toolName
 * @param {Record<string, unknown>} args
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
