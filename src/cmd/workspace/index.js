/** @module cmd/workspace */

import { CLI_BIN } from "../../constants.js";
import { runWorkspacePairCommand } from "./pair.js";
import { runWorkspaceServeCommand } from "./serve.js";

export function printWorkspaceHelp() {
    console.log(`Usage: ${CLI_BIN} workspace <command>`);
    console.log("");
    console.log("Commands:");
    console.log("  serve           Start the persistent owner Workspace");
    console.log("  pair <code>     Approve a browser pairing request");
}

/**
 * @param {string[]} argv
 * @param {{ __testDeps?: any }} [options]
 */
export async function runWorkspaceCommand(argv, options = {}) {
    const command = argv[0];
    if (!command || command === "--help" || command === "-h") return printWorkspaceHelp();
    if (command === "serve") return await runWorkspaceServeCommand(argv.slice(1), options);
    if (command === "pair") return await runWorkspacePairCommand(argv.slice(1), options);
    console.error(`[RunWield] Unknown workspace command: ${command}`);
    console.error(`Run '${CLI_BIN} workspace --help' for usage.`);
}
