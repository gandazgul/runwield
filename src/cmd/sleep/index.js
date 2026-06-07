/**
 * @module cmd/sleep
 * Sleep command: run memory optimization/cleanup agent invocation.
 */

import { parseArgs as parseArgsFn } from "@std/cli/parse-args";
import { COMMAND_NAMES } from "../../constants.js";
import { runAgentSession as runAgentSessionFn } from "../../shared/session/session.js";
import { printCommandHelp as printCommandHelpFn } from "../help/index.js";
import { ensureMnemosyneBinary as ensureMnemosyneBinaryFn } from "../../shared/runtime-preflight.js";

/**
 * @typedef {Object} CommandDependencies
 * @property {typeof parseArgsFn} [parseArgs]
 * @property {typeof printCommandHelpFn} [printCommandHelp]
 * @property {typeof ensureMnemosyneBinaryFn} [ensureMnemosyneBinary]
 * @property {typeof runAgentSessionFn} [runAgentSession]
 */

/**
 * Handle `sleep` command.
 *
 * @param {string[]} argv
 * @param {{ __testDeps?: CommandDependencies, uiAPI?: { appendSystemMessage?: (message: string) => void } }} [options]
 */
export async function runSleepCommand(argv, options = {}) {
    const deps = /** @type {CommandDependencies} */ ((/** @type {any} */ (options)).__testDeps || {});
    const {
        parseArgs: parseArgsDep,
        printCommandHelp: printCommandHelpDep,
        ensureMnemosyneBinary: ensureMnemosyneBinaryDep,
        runAgentSession: runAgentSessionDep,
    } = deps;

    const parseArgs = parseArgsDep || parseArgsFn;
    const printCommandHelp = printCommandHelpDep || printCommandHelpFn;
    const ensureMnemosyneBinary = ensureMnemosyneBinaryDep || ensureMnemosyneBinaryFn;
    const runAgentSession = runAgentSessionDep || runAgentSessionFn;

    const parsed = parseArgs(argv, {
        boolean: ["help"],
        alias: { h: "help" },
        stopEarly: true,
    });

    if (parsed.help) {
        printCommandHelp(COMMAND_NAMES.SLEEP);
        return;
    }

    await ensureMnemosyneBinary();

    const uiAPI = options.uiAPI;
    /** @param {string} message */
    const notify = (message) => {
        if (uiAPI?.appendSystemMessage) {
            uiAPI.appendSystemMessage(message);
            return;
        }
        console.log(message);
    };

    notify("[Harns] Running sleep mode (memory optimization)...");

    // Route through the /sleep prompt template using the operator agent
    await runAgentSession({
        agentName: "operator",
        userRequest: "/sleep",
    });

    notify("[Harns] ✅ Sleep complete.");
}
