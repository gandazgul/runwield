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
async function resolveAgentDefsDir() {
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

/** @type {import('@mariozechner/pi-coding-agent').AgentSession | null} */
let activeSession = null;

/**
 * Stop the currently active agent session.
 */
export function abortActiveSession() {
    if (activeSession) {
        activeSession.abort();
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
                // If a markdown block is open, close it so tool messages appear below the text generated so far
                currentMarkdownBlock = null;

                const filePath = getFilePathForTool(event.toolName, event.args);
                let msg = `[Tool] ${event.toolName}`;
                if (filePath) msg += `\n  📄 ${filePath}`;
                if (event.toolName === "bash") {
                    msg += `\n    Command: ${event.args?.command || "N/A"}`;
                }

                if (uiAPI) {
                    uiAPI.appendSystemMessage(msg);
                } else {
                    console.log(`\n  ${msg.replace(/\n/g, "\n  ")}`);
                }
                break;
            }
            case "tool_execution_end": {
                const msg = `[Tool] ${event.toolName} — ${event.isError ? "error" : "ok"}`;
                if (uiAPI) {
                    uiAPI.appendSystemMessage(msg);
                } else {
                    console.log(`  ${msg}`);
                }
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
        activeSession = session;
        await session.prompt(userRequest, requestOptions);
        await session.agent.waitForIdle();
    } finally {
        activeSession = null;
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
