/**
 * @module cmd/help
 * Global and command-specific help command.
 */

import { parseArgs as parseArgsFn } from "@std/cli/parse-args";
import { CLI_BIN } from "../../constants.js";
import { getCliCommandDefinitions, getCommandDefinition } from "../registry.js";

/**
 * @typedef {Object} CommandDependencies
 * @property {typeof parseArgsFn} [parseArgs]
 * @property {(code: number) => never} [exit]
 */

/**
 * Print global CLI usage/help text.
 */
export function printGlobalHelp() {
    console.log("RunWield — Plan-by-Default Coding Harness\n");
    console.log("Usage:");
    console.log(`  ${CLI_BIN} \"<user request>\"`);
    console.log(`  ${CLI_BIN} --continue \"<optional message>\"`);
    console.log(`  ${CLI_BIN} <command> [args]\n`);

    console.log("Commands:");
    const commands = getCliCommandDefinitions();
    const nameWidth = Math.max(...commands.map((command) => command.name.length));
    for (const command of commands) {
        console.log(`  ${command.name.padEnd(nameWidth)} ${command.summary}`);
    }

    console.log("\nGlobal flags:");
    console.log("  --continue, -c   Continue newest saved session (default startup route only)");
    console.log("  --help, -h       Show global help or command help");
    console.log("  --version, -v    Print version and target architecture");
    console.log("  --mode acp       Start the ACP stdio adapter (stdout reserved for protocol frames)");

    console.log("\nHelp:");
    console.log(`  ${CLI_BIN} help`);
    console.log(`  ${CLI_BIN} help <command>`);
    console.log(`  ${CLI_BIN} --help <command>`);
    console.log(`  ${CLI_BIN} <command> --help`);
}

/**
 * Print usage/help text for a specific command.
 *
 * @param {string} commandName
 * @returns {boolean}
 */
export function printCommandHelp(commandName) {
    const command = getCommandDefinition(commandName);
    if (!command) return false;

    console.log(`Usage (${command.name}):`);
    for (const line of command.usage) {
        console.log(`  ${line}`);
    }

    if (command.notes && command.notes.length > 0) {
        console.log("\nNotes:");
        for (const note of command.notes) {
            console.log(`  - ${note}`);
        }
    }

    return true;
}

/**
 * Run help command
 *
 * @param {string[]} argv
 * @param {{ __testDeps?: CommandDependencies }} [options]
 */
export async function runHelpCommand(argv, options = {}) {
    await Promise.resolve();

    const deps = /** @type {CommandDependencies} */ ((/** @type {any} */ (options)).__testDeps || {});
    const {
        parseArgs: parseArgsDep,
        exit: exitDep,
    } = deps;

    const parseArgs = parseArgsDep || parseArgsFn;
    const exit = exitDep || Deno.exit;

    const parsed = parseArgs(argv, {
        boolean: ["help"],
        alias: { h: "help" },
    });

    const [commandName] = parsed._.map(String);

    const found = printCommandHelp(commandName);
    if (!found && commandName) {
        console.error(`[RunWield] Unknown command for help: ${commandName}`);
        console.log();
        exit(1);
    }

    !commandName && printGlobalHelp();
}
