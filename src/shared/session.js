/**
 * @module shared/session
 * Shared helpers for loading agent definitions and running agent invocations.
 */

import { createAgentSession, DefaultResourceLoader, SessionManager } from "@mariozechner/pi-coding-agent";
import { extractYaml, test as hasFrontMatter } from "@std/front-matter";
import { join } from "@std/path";
import { AGENT_DEFS_DIR, CORE_SYSTEM_PROMPT, CWD } from "../constants.js";
import mnemosyneExtension from "../extensions/mnemosyne/index.js";

const PROJECT_AGENT_DEFS_DIR = join(CWD, ".pi", "agents");

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
 * Resolve agent definition directory with bundled-first strategy.
 * 1) Bundled agent defs shipped with Harns binary
 * 2) Project-local .pi/agents fallback
 *
 * @returns {Promise<string>}
 */
export async function resolveAgentDefsDir() {
    if (await directoryExists(AGENT_DEFS_DIR)) return AGENT_DEFS_DIR;
    if (await directoryExists(PROJECT_AGENT_DEFS_DIR)) return PROJECT_AGENT_DEFS_DIR;

    throw new Error(
        `Could not find bundled agent defs at ${AGENT_DEFS_DIR} or project agent defs at ${PROJECT_AGENT_DEFS_DIR}`,
    );
}

/**
 * @typedef {Object} AgentDef
 * @property {string} name - Agent name (from frontmatter or filename)
 * @property {string} model - Model identifier
 * @property {string} systemPrompt - Core system prompt + agent-specific system prompt
 */

/**
 * Load an agent definition from `.pi/agents/<name>.md`.
 *
 * @param {string} agentName
 * @param {string} [agentDefsDir]
 * @returns {Promise<AgentDef>}
 */
export async function loadAgentDef(agentName, agentDefsDir) {
    const resolvedDir = agentDefsDir || await resolveAgentDefsDir();
    const filePath = join(resolvedDir, `${agentName}.md`);
    const raw = await Deno.readTextFile(filePath);

    if (!hasFrontMatter(raw)) {
        throw new Error(`Agent def ${filePath} has no frontmatter`);
    }

    const { attrs, body } = extractYaml(raw);
    const name = attrs.name || agentName;
    const model = attrs.model || "claude-sonnet-4-20250514";
    const systemPrompt = CORE_SYSTEM_PROMPT + "\n\n" + body.trim();

    return { name, model, systemPrompt };
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
 * @param {string[]} opts.toolNames
 * @param {import('@mariozechner/pi-coding-agent').ToolDefinition[]} [opts.customTools]
 * @param {string} opts.userRequest - The user-facing request/instruction to send to the agent
 * @param {Array<{base64: string, mimeType: string}>} [opts.images]
 * @param {import('./workflow.js').UiAPI} [opts.uiAPI]
 * @returns {Promise<import('@mariozechner/pi-agent-core').AgentMessage[]>}
 */
export async function runAgentSession(
    { agentName, toolNames, customTools, userRequest, images, uiAPI },
) {
    const agentDefsDir = await resolveAgentDefsDir();
    const agentDef = await loadAgentDef(agentName, agentDefsDir);

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
        agentDir: agentDefsDir,
        systemPromptOverride: () => agentDef.systemPrompt,
        extensionFactories: [mnemosyneExtension],
    });
    await loader.reload();

    const { session, extensionsResult } = await createAgentSession({
        cwd: CWD,
        tools: [...toolNames, ...(customTools || []).map((t) => t.name)],
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
                else if (event.toolName === "grep_search") {
                    headerArgs = `${event.args?.query} in ${event.args?.path || event.args?.dir || "."}`;
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
