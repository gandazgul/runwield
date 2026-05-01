/**
 * @module cmd/sleep
 * Sleep command: run memory optimization/cleanup agent invocation.
 */

import { parseArgs } from "@std/cli/parse-args";
import { COMMAND_NAMES } from "../../constants.js";
import { runAgentSession } from "../../shared/session/session.js";
import { printCommandHelp } from "../../shared/help-text.js";
import { ensureMnemosyneBinary } from "../../shared/runtime-preflight.js";

/**
 * Handle `sleep` command.
 *
 * @param {string[]} argv
 */
export async function runSleepCommand(argv) {
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

    console.log("[Harns] Running sleep mode (memory optimization)...\n");

    // Route through the /sleep prompt template using the operator agent
    await runAgentSession({
        agentName: "operator",
        userRequest: "/sleep",
    });

    console.log("\n[Harns] ✅ Sleep complete.");
}
