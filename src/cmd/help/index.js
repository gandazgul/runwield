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
 * @returns {string}
 */
function formatGlobalHelp() {
    const lines = [
        "RunWield — Plan-by-Default Coding Harness",
        "",
        "Usage:",
        `  ${CLI_BIN} "<user request>"`,
        `  ${CLI_BIN} --continue "<optional message>"`,
        `  ${CLI_BIN} <command> [args]`,
        "",
        "Commands:",
    ];

    const commands = getCliCommandDefinitions();
    const nameWidth = Math.max(...commands.map((command) => command.name.length));
    for (const command of commands) {
        lines.push(`  ${command.name.padEnd(nameWidth)} ${command.summary}`);
    }

    lines.push(
        "",
        "Global flags:",
        "  --continue, -c   Continue newest saved session (default startup route only)",
        "  --help, -h       Show global help or command help",
        "  --version, -v    Print version and target architecture",
        "  --mode acp       Start the ACP stdio adapter (stdout reserved for protocol frames)",
        "",
        "Help:",
        `  ${CLI_BIN} help`,
        `  ${CLI_BIN} help <command>`,
        `  ${CLI_BIN} --help <command>`,
        `  ${CLI_BIN} <command> --help`,
    );
    return lines.join("\n");
}

/**
 * @param {string} commandName
 * @returns {string | null}
 */
function formatCommandHelp(commandName) {
    const command = getCommandDefinition(commandName);
    if (!command) return null;

    const lines = [`Usage (${command.name}):`];
    for (const line of command.usage) {
        lines.push(`  ${line}`);
    }

    if (command.notes && command.notes.length > 0) {
        lines.push("", "Notes:");
        for (const note of command.notes) {
            lines.push(`  - ${note}`);
        }
    }

    return lines.join("\n");
}

/**
 * Print global CLI usage/help text.
 */
export function printGlobalHelp() {
    console.log(formatGlobalHelp());
}

/**
 * Print usage/help text for a specific command.
 *
 * @param {string} commandName
 * @returns {boolean}
 */
export function printCommandHelp(commandName) {
    const message = formatCommandHelp(commandName);
    if (!message) return false;
    console.log(message);
    return true;
}

/**
 * Run help command
 *
 * @param {string[]} argv
 * @param {{ uiAPI?: import('../../ui/tui/types.js').UiAPI, __testDeps?: CommandDependencies }} [options]
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

    if (options.uiAPI) {
        const message = commandName ? formatCommandHelp(commandName) : formatGlobalHelp();
        if (message) {
            options.uiAPI.appendSystemMessage(message);
            return;
        }
        options.uiAPI.appendSystemMessage(`[RunWield] Unknown command for help: ${commandName}`, true);
        return;
    }

    const found = commandName ? printCommandHelp(commandName) : false;
    if (!found && commandName) {
        console.error(`[RunWield] Unknown command for help: ${commandName}`);
        console.log();
        exit(1);
    }

    !commandName && printGlobalHelp();
}
