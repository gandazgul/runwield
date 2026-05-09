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
 *   hns --help
 *
 * Source-run fallback for contributors:
 *   deno run -A src/cli.js "<user request>"
 */

import { parseArgs } from "@std/cli/parse-args";
import { COMMAND_NAMES } from "./constants.js";
import { commandRegistry } from "./cmd/registry.js";
import { printGlobalHelp } from "./cmd/help/index.js";
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

    // Explicit command dispatch: `cli.js <command> ...`
    if (commandRegistry[firstPositional]) {
        if (!commandRegistry[firstPositional].isCli) {
            console.error(
                `[Harns] Command '${firstPositional}' is only available inside interactive chat as /${firstPositional}.`,
            );
            Deno.exit(1);
        }
        const [, ...commandArgs] = normalizedArgs;
        await commandRegistry[firstPositional].execute(commandArgs);
        return;
    }

    // Help flag: `cli.js --help` or `cli.js -h`
    if (parsed.help) {
        printGlobalHelp();
        return;
    }

    // Default command route: `cli.js "<user request>"` => router
    // this is the same as cli.js --agent router "request"
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
