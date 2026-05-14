/**
 * @module cmd/init
 * Init command handler — bootstraps Harns into a project.
 *
 * Implements both CLI (`hns init`) and TUI slash (`/init`) dispatch.
 * Uses init-state guard to warn on re-runs. Loads the init agent from
 * `src/cmd/init/init-agent-prompt.md` via loadAgentDefFromPath(), so it
 * stays invisible to /agent listings and uses its own model/tools.
 */

import { parseArgs as parseArgsFn } from "@std/cli/parse-args";
import { dirname, fromFileUrl, join } from "@std/path";
import { COMMAND_NAMES } from "../../constants.js";
import { loadAgentDefFromPath as loadAgentDefFromPathFn } from "../../shared/session/agents.js";
import { runAgentSession as runAgentSessionFn } from "../../shared/session/session.js";
import { printCommandHelp as printCommandHelpFn } from "../help/index.js";
import {
    isInitDone as isInitDoneFn,
    recordInitDone as recordInitDoneFn,
    recordInitOffered as recordInitOfferedFn,
} from "./init-state.js";
import { setActiveAgentName } from "../../shared/session/session-state.js";

export const __dirname = dirname(fromFileUrl(import.meta.url));

/**
 * @typedef {Object} CommandDependencies
 * @property {typeof parseArgsFn} [parseArgs]
 * @property {typeof printCommandHelpFn} [printCommandHelp]
 * @property {typeof isInitDoneFn} [isInitDone]
 * @property {typeof recordInitDoneFn} [recordInitDone]
 * @property {typeof recordInitOfferedFn} [recordInitOffered]
 * @property {typeof runAgentSessionFn} [runAgentSession]
 * @property {typeof loadAgentDefFromPathFn} [loadAgentDefFromPath]
 * @property {typeof Deno.cwd} [cwd]
 */

/**
 * Run the init command.
 *
 * @param {string[]} argv
 * @param {import("../registry.js").CommandContext & { __testDeps?: CommandDependencies }} [options]
 */
export async function runInitCommand(argv, options = {}) {
    const deps = /** @type {CommandDependencies} */ ((/** @type {any} */ (options)).__testDeps || {});
    const {
        parseArgs: parseArgsDep,
        printCommandHelp: printCommandHelpDep,
        isInitDone: isInitDoneDep,
        recordInitDone: recordInitDoneDep,
        recordInitOffered: recordInitOfferedDep,
        runAgentSession: runAgentSessionDep,
        loadAgentDefFromPath: loadAgentDefFromPathDep,
        cwd: cwdDep,
    } = deps;

    const parseArgs = parseArgsDep || parseArgsFn;
    const printCommandHelp = printCommandHelpDep || printCommandHelpFn;
    const isInitDone = isInitDoneDep || isInitDoneFn;
    const recordInitDone = recordInitDoneDep || recordInitDoneFn;
    const recordInitOffered = recordInitOfferedDep || recordInitOfferedFn;

    const runAgentSession = runAgentSessionDep || runAgentSessionFn;

    const cwd = cwdDep || (() => Deno.cwd());
    const loadAgentDefFromPath = loadAgentDefFromPathDep || loadAgentDefFromPathFn;

    const parsed = parseArgs(argv, {
        boolean: ["help"],
        alias: { h: "help" },
        stopEarly: true,
    });

    if (parsed.help) {
        printCommandHelp(COMMAND_NAMES.INIT);
        return;
    }

    // ── Init-state guard ──────────────────────────────────────────
    if (await isInitDone()) {
        const msg = `[Harns] Init has already been run for this project (${cwd()}).\n` +
            `[Harns] To re-run, delete or edit the entry in ~/.hns/init-state.json manually.`;
        if (options.uiAPI) {
            options.uiAPI.appendSystemMessage(msg);
        } else {
            console.warn(msg);
        }
        return;
    }

    // ── Load init agent definition directly from bundled path ──────
    const initAgentPath = join(__dirname, "init-agent-prompt.md");
    const agentDef = await loadAgentDefFromPath(initAgentPath);

    await recordInitOffered();

    // Set the footer to show the init agent's display name.
    setActiveAgentName(agentDef.displayName);

    // Run the init agent session using its own definition (model, tools, system prompt).
    // We use a dedicated "init" agent name so it's distinct from the operator.
    try {
        await runAgentSession({
            agentName: "init",
            userRequest: "Initialize this project for Harns. Follow the instructions in your system prompt.",
            uiAPI: options.uiAPI,
            sessionManager: options.sessionManager,
            _agentDefOverride: agentDef,
        });

        await recordInitDone();

        if (options.uiAPI) {
            options.uiAPI.appendSystemMessage(
                "✅ Init complete. CONTEXT.md has been written to the project root.",
            );
            const { setActiveAgent } = await import("../../shared/interactive/chat-session.js");
            const { createDirectAgentHandler } = await import("../../shared/session/direct-agent.js");
            setActiveAgent("Router", createDirectAgentHandler("router"), options.uiAPI);
        } else {
            console.log(`\n[Harns] ✅ Init complete for ${cwd()}.`);
        }
    } catch (err) {
        // Don't record success if the agent failed or was aborted
        const msg = `[Harns] Init failed: ${err instanceof Error ? err.message : String(err)}`;
        if (options.uiAPI) {
            options.uiAPI.appendSystemMessage(msg, true);
        } else {
            console.error(msg);
        }
        throw err;
    }
}
