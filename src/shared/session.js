/**
 * @module shared/session
 * Shared helpers for loading agents and running streamed sessions.
 */

import {
    createAgentSession,
    DefaultResourceLoader,
    SessionManager,
} from "@mariozechner/pi-coding-agent";
import { extractYaml, test as hasFrontMatter } from "@std/front-matter";
import { join } from "@std/path";
import { AGENTS_DIR, CORE_SYSTEM_PROMPT, CWD } from "../constants.js";

/**
 * @typedef {Object} AgentDef
 * @property {string} name - Agent name (from frontmatter or filename)
 * @property {string} model - Model identifier
 * @property {string} systemPrompt - Core prompt + agent-specific prompt
 */

/**
 * Load an agent definition from `.pi/agents/<name>.md`.
 *
 * @param {string} agentName
 * @returns {Promise<AgentDef>}
 */
export async function loadAgent(agentName) {
    const filePath = join(AGENTS_DIR, `${agentName}.md`);
    const raw = await Deno.readTextFile(filePath);

    if (!hasFrontMatter(raw)) {
        throw new Error(`Agent file ${filePath} has no frontmatter`);
    }

    const { attrs, body } = extractYaml(raw);
    const name = attrs.name || agentName;
    const model = attrs.model || "claude-sonnet-4-20250514";
    const systemPrompt = CORE_SYSTEM_PROMPT + "\n\n" + body.trim();

    return { name, model, systemPrompt };
}

/**
 * Run an agent session and wait for idle.
 *
 * @param {Object} opts
 * @param {string} opts.agentName
 * @param {string[]} opts.toolNames
 * @param {import('@mariozechner/pi-coding-agent').ToolDefinition[]} [opts.customTools]
 * @param {string} opts.prompt
 * @returns {Promise<import('@mariozechner/pi-agent-core').AgentMessage[]>}
 */
export async function runSession({ agentName, toolNames, customTools, prompt }) {
    const agentDef = await loadAgent(agentName);
    console.log(`\n[Harness] Loading agent: ${agentDef.name} (model: ${agentDef.model})`);

    const loader = new DefaultResourceLoader({
        cwd: CWD,
        agentDir: AGENTS_DIR,
        systemPromptOverride: () => agentDef.systemPrompt,
    });
    await loader.reload();

    const { session } = await createAgentSession({
        cwd: CWD,
        tools: [...toolNames, ...(customTools || []).map((t) => t.name)],
        customTools: customTools || [],
        resourceLoader: loader,
        sessionManager: SessionManager.inMemory(),
    });

    session.subscribe((event) => {
        switch (event.type) {
            case "message_update":
                if (event.assistantMessageEvent.type === "text_delta") {
                    process.stdout.write(event.assistantMessageEvent.delta);
                }
                break;
            case "tool_execution_start":
                console.log(
                    `\n  [Tool] ${event.toolName}${event.toolName === "bash" ? `\n    Command: ${event.args?.command || "N/A"}` : ""}`,
                );
                break;
            case "tool_execution_end":
                console.log(`  [Tool] ${event.toolName} — ${event.isError ? "error" : "ok"}`);
                break;
        }
    });

    await session.prompt(prompt);
    await session.agent.waitForIdle();

    return session.agent.state.messages;
}
