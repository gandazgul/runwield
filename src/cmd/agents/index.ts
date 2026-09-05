/** List available Agents or start/switch to a chosen active Agent. */

import type { Component } from "@earendil-works/pi-tui";
import { printCommandHelp } from "../help/index.ts";
import {
    buildWorkflowOnlyAgentMessage,
    isWorkflowOnlyAgent,
    listAvailableAgents,
} from "../../shared/session/agents.js";
import type { SessionRuntime } from "../../shared/session/session-runtime.js";
import { AGENTS, getCwd } from "../../constants.js";
import { COMMAND_NAMES } from "../registry.js";
import { setTerminalTitleForName } from "../../ui/tui/terminal-title.ts";
import type { InteractiveSessionPort } from "../../ui/tui/interactive-session-port.ts";

export { getAgentCompletions } from "./getArgumentCompletions.js";

interface AgentsCommandOptions {
    tui?: import("../../ui/tui/types.js").TuiAPI;
    uiAPI?: import("../../ui/tui/types.js").UiAPI;
    editor?: import("../../ui/tui/types.js").EditorAPI;
    sessionId?: string;
    sessionRuntime?: SessionRuntime;
    sessionPort: InteractiveSessionPort;
}

interface AgentsTuiOptions {
    tui: import("../../ui/tui/types.js").TuiAPI;
    uiAPI: import("../../ui/tui/types.js").UiAPI;
    editor: import("../../ui/tui/types.js").EditorAPI;
    sessionId?: string;
    sessionRuntime?: SessionRuntime;
}

async function runAgentsCommandCli(
    agentName: string,
    rest: string[],
    sessionPort: InteractiveSessionPort,
): Promise<void> {
    const agents = await listAvailableAgents(getCwd());

    if (!agentName) {
        console.log("\nAvailable agents:\n");
        for (const agent of agents) {
            console.log(`  ${agent.name.padEnd(14)} ${agent.description}`);
        }
        console.log(`\nUsage: wld agent <name> ["<prompt>"]\n`);
        return;
    }

    const match = agents.find((agent) => agent.name === agentName);
    if (!match) {
        if (await isWorkflowOnlyAgent(agentName, getCwd())) {
            console.log(`\n${buildWorkflowOnlyAgentMessage(agentName, getCwd())}\n`);
            return;
        }
        console.error(`\nUnknown agent: "${agentName}"\n`);
        console.log("Available agents:");
        for (const agent of agents) {
            console.log(`  ${agent.name.padEnd(14)} ${agent.description}`);
        }
        Deno.exit(1);
    }

    const userRequest = rest.join(" ").trim();
    await sessionPort.startInteractiveSession(userRequest || null, {
        initialAgentName: match.name,
    });
}

async function runAgentsCommandTUI(
    agentName: string,
    options: AgentsTuiOptions,
): Promise<void> {
    const { tui, uiAPI, editor, sessionId, sessionRuntime } = options;
    const projectRoot = sessionId && sessionRuntime ? sessionRuntime.getSessionSnapshot(sessionId)?.cwd : undefined;
    const agents = await listAvailableAgents(projectRoot);
    editor.setText("");

    let chosenAgent: string | null = agentName;
    if (!chosenAgent) {
        const agentOptions = agents
            .slice()
            .sort((agentA, agentB) => agentA.name.localeCompare(agentB.name))
            .map((agent) => ({
                value: agent.name,
                label: agent.name,
                description: agent.name === AGENTS.ROUTER ? "Reset to default router (triage flow)" : agent.description,
            }));

        const selected = await uiAPI.promptSelect("Switch agent:", agentOptions, { persistResult: false });
        if (!selected) return;
        chosenAgent = selected;
    }

    const match = agents.find((agent) => agent.name === chosenAgent);
    if (!match) {
        // An explicitly named workflow-only Agent is not a typo; say what activates
        // it and leave the active Agent alone.
        uiAPI.appendSystemMessage(
            await isWorkflowOnlyAgent(chosenAgent, projectRoot)
                ? buildWorkflowOnlyAgentMessage(chosenAgent, projectRoot)
                : `Agent "${chosenAgent}" not found`,
        );
        return;
    }

    if (sessionId && sessionRuntime) {
        try {
            const switchResult = await sessionRuntime.switchAgent(sessionId, {
                agentName: match.name,
                releaseActiveWorkflow: true,
            });
            if (!switchResult?.ok) {
                const detail = typeof switchResult?.error === "string" ? switchResult.error : "Agent switch failed";
                uiAPI.appendSystemMessage(
                    `Could not switch to Agent "${match.name}": ${detail}. The active Agent did not change. Use /model or /settings to choose an available model, then try /agent again.`,
                    true,
                );
                tui.setFocus(editor as import("../../ui/tui/types.js").EditorAPI & Component);
                return;
            }
            if (!sessionRuntime.getSessionSnapshot(sessionId)?.name) setTerminalTitleForName(undefined);
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            uiAPI.appendSystemMessage(
                `Could not switch to Agent "${match.name}": ${detail}. The active Agent did not change. Use /model or /settings to choose an available model, then try /agent again.`,
                true,
            );
            tui.setFocus(editor as import("../../ui/tui/types.js").EditorAPI & Component);
            return;
        }
    }

    tui.setFocus(editor as import("../../ui/tui/types.js").EditorAPI & Component);
}

export async function runAgentsCommand(
    argv: string[],
    options: AgentsCommandOptions,
): Promise<void> {
    const [agentName = ""] = argv;

    if (agentName === "help" || agentName === "--help" || agentName === "-h") {
        printCommandHelp(COMMAND_NAMES.AGENT);
        return;
    }

    if (options.uiAPI && options.editor && options.tui) {
        await runAgentsCommandTUI(agentName, {
            uiAPI: options.uiAPI,
            editor: options.editor,
            tui: options.tui,
            sessionId: options.sessionId,
            sessionRuntime: options.sessionRuntime,
        });
        return;
    }

    await runAgentsCommandCli(agentName, argv.slice(1), options.sessionPort);
}
