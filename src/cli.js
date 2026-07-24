/**
 * @module cli
 * RunWield — Plan-by-Default Coding Harness
 *
 * Usage:
 *   wld "<user request>"
 *   wld router "<user request>"
 *   wld load-plan <plan-name-or-path>
 *   wld plans
 *   wld sleep
 *   wld help
 *
 * Source-run fallback for contributors:
 *   deno run -A src/cli.js "<user request>"
 */

import { parseArgs } from "@std/cli/parse-args";
import { createRequire } from "node:module";
import { runVersionCommand } from "./cmd/version/index.js";

if (Deno.build.standalone) {
    /** @type {Record<string, unknown>} */ (globalThis).require = createRequire(import.meta.url);
}

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
        if (
            stillInGlobalPrefix &&
            (arg === "--help" || arg === "-h" || arg === "--continue" || arg === "-c" || arg === "--version" ||
                arg === "-v")
        ) {
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
 * - wld help
 * - wld --help
 * - wld help <command>
 * - wld --help <command>
 * - wld <command> --help
 *
 * @param {string[]} argv
 * @param {{ HELP: string }} commandNames
 * @returns {{ requested: false } | { requested: true, commandName?: string }}
 */
function resolveHelpRequest(argv, commandNames) {
    if (argv[0] === commandNames.HELP) {
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
        boolean: ["help", "continue", "version"],
        string: ["mode"],
        alias: { h: "help", c: "continue", v: "version" },
    });

    const normalizedArgs = stripLeadingGlobalFlags(args);
    const [firstPositional] = parsed._.map(String);

    // Version flag: `cli.js --version` or `cli.js -v`
    if (parsed.version) {
        await runVersionCommand();
        return;
    }

    // ACP mode must route before normal command/TUI dispatch so stdout stays protocol-pure.
    if (parsed.mode === "acp") {
        const { runAcpCommand } = await import("./cmd/acp/index.js");
        await runAcpCommand([]);
        return;
    }

    if (firstPositional === "plans") {
        const { runPlansCommand } = await import("./cmd/plans/index.js");
        const [, ...commandArgs] = normalizedArgs;
        await runPlansCommand(commandArgs);
        return;
    }

    const { COMMAND_NAMES, commandRegistry, getCommandDefinition, hasCommandSurface } = await import(
        "./cmd/registry.js"
    );
    const { printCommandHelp, printGlobalHelp } = await import("./cmd/help/index.js");

    const helpRequest = resolveHelpRequest(args, COMMAND_NAMES);
    if (helpRequest.requested) {
        if (!helpRequest.commandName) {
            printGlobalHelp();
            return;
        }
        if (!printCommandHelp(helpRequest.commandName)) {
            console.error(`[RunWield] Unknown command for help: ${helpRequest.commandName}`);
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
                `[RunWield] Command '${firstPositional}' is only available inside interactive chat as /${firstPositional}.`,
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
        console.error(`[RunWield] Unknown option: ${normalizedArgs[0]}`);
        console.error("Use positional commands, for example: wld <command> [args]");
        Deno.exit(1);
    }

    // Default command route: `cli.js "<user request>"` => router
    await commandRegistry[COMMAND_NAMES.ROUTER].execute(normalizedArgs, {
        sessionStartMode: parsed.continue ? "continue" : "new",
    });
}

main().catch(async (err) => {
    try {
        const { stopTUI } = await import("./ui/tui/tui.js");
        stopTUI();
    } catch (_e) { /* ignore */ }
    if (err instanceof Error && err.message.includes("Mnemosyne binary not found")) {
        console.error(err.message);
    } else {
        console.error("[RunWield] Fatal error:", err);
    }
    Deno.exit(1);
});
