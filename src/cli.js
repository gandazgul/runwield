/**
 * @module cli
 * Harns — Plan-by-Default Coding Harness
 *
 * Usage:
 *   hns "<user request>"
 *   hns router "<user request>"
 *   hns load-plan <plan-name-or-path>
 *   hns plans
 *   hns sleep
 *   hns help
 *
 * Source-run fallback for contributors:
 *   deno run -A src/cli.js "<user request>"
 */

import { parseArgs } from "@std/cli/parse-args";
import { COMMAND_NAMES } from "./constants.js";
import { commandRegistry, getCommandDefinition, hasCommandSurface } from "./cmd/registry.js";
import { printCommandHelp, printGlobalHelp } from "./cmd/help/index.js";
import { stopTUI } from "./shared/ui/tui.js";

/**
 * Remove leading global flags from argv so command/default handlers receive clean positional args.
 *
 * @param {string[]} argv
 * @returns {string[]}
 */
function stripLeadingGlobalFlags(argv) {
    const stripped = [];
    let stillInGlobalPrefix = true;

    for (const arg of argv) {
        if (stillInGlobalPrefix && (arg === "--help" || arg === "-h" || arg === "--continue" || arg === "-c")) {
            continue;
        }
        stillInGlobalPrefix = false;
        stripped.push(arg);
    }

    return stripped;
}

/**
 * @param {string} arg
 * @returns {boolean}
 */
function isHelpFlag(arg) {
    return arg === "--help" || arg === "-h";
}

/**
 * @param {string} arg
 * @returns {boolean}
 */
function isGlobalFlag(arg) {
    return isHelpFlag(arg) || arg === "--continue" || arg === "-c";
}

/**
 * Resolve all supported help spellings:
 * - hns help
 * - hns --help
 * - hns help <command>
 * - hns --help <command>
 * - hns <command> --help
 *
 * @param {string[]} argv
 * @returns {{ requested: false } | { requested: true, commandName?: string }}
 */
function resolveHelpRequest(argv) {
    if (argv[0] === COMMAND_NAMES.HELP) {
        const commandName = argv.slice(1).find((arg) => !isHelpFlag(arg));
        return commandName ? { requested: true, commandName } : { requested: true };
    }

    if (!argv.some(isHelpFlag)) return { requested: false };

    const commandName = argv.find((arg) => !isGlobalFlag(arg));
    return commandName ? { requested: true, commandName } : { requested: true };
}

/**
 * Main CLI entrypoint.
 */
async function main() {
    const args = Deno.args;

    const parsed = parseArgs(args, {
        stopEarly: true,
        boolean: ["help", "continue"],
        alias: { h: "help", c: "continue" },
    });

    const normalizedArgs = stripLeadingGlobalFlags(args);
    const [firstPositional] = parsed._.map(String);

    const helpRequest = resolveHelpRequest(args);
    if (helpRequest.requested) {
        if (!helpRequest.commandName) {
            printGlobalHelp();
            return;
        }
        if (!printCommandHelp(helpRequest.commandName)) {
            console.error(`[Harns] Unknown command for help: ${helpRequest.commandName}`);
            console.log();
            Deno.exit(1);
        }
        return;
    }

    // Explicit command dispatch: `cli.js <command> ...`
    const positionalCommand = getCommandDefinition(firstPositional);
    if (positionalCommand) {
        if (!hasCommandSurface(positionalCommand, "cli")) {
            console.error(
                `[Harns] Command '${firstPositional}' is only available inside interactive chat as /${firstPositional}.`,
            );
            Deno.exit(1);
        }
        const [, ...commandArgs] = normalizedArgs;
        await positionalCommand.execute(commandArgs);
        return;
    }

    // Help flag: `cli.js --help` or `cli.js -h`
    if (parsed.help) {
        printGlobalHelp();
        return;
    }

    if (normalizedArgs[0]?.startsWith("-")) {
        console.error(`[Harns] Unknown option: ${normalizedArgs[0]}`);
        console.error("Use positional commands, for example: hns <command> [args]");
        Deno.exit(1);
    }

    // Default command route: `cli.js "<user request>"` => router
    await commandRegistry[COMMAND_NAMES.ROUTER].execute(normalizedArgs, {
        sessionStartMode: parsed.continue ? "continue" : "new",
    });
}

main().catch((err) => {
    try {
        stopTUI();
    } catch (_e) { /* ignore */ }
    if (err instanceof Error && err.message.includes("Mnemosyne binary not found")) {
        console.error(err.message);
    } else {
        console.error("[Harns] Fatal error:", err);
    }
    Deno.exit(1);
});
