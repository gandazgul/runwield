/**
 * @module cli
 * Harness — Plan-by-Default Coding Harness
 *
 * Usage:
 *   deno run -A src/cli.js "<user request>"
 *   deno run -A src/cli.js router "<user request>"
 *   deno run -A src/cli.js resume <plan-name-or-path>
 *   deno run -A src/cli.js plans
 *   deno run -A src/cli.js --help
 */

import { parseArgs } from "@std/cli/parse-args";
import { COMMAND_NAMES } from "./constants.js";
import { commandRegistry } from "./cmd/registry.js";
import { printGlobalHelp } from "./shared/help-text.js";

/**
 * Main CLI entrypoint.
 */
async function main() {
    const args = Deno.args;

    if (args.length === 0) {
        printGlobalHelp();
        Deno.exit(1);
    }

    const parsed = parseArgs(args, {
        boolean: ["help"],
        alias: { h: "help" },
        stopEarly: true,
    });

    const [firstPositional] = parsed._.map(String);

    // Explicit help command: `cli.js help [command]`
    if (firstPositional === COMMAND_NAMES.HELP) {
        await commandRegistry[COMMAND_NAMES.HELP](args.slice(1));
        return;
    }

    // Global help flag with no command token: `cli.js --help`
    if (parsed.help && !firstPositional) {
        printGlobalHelp();
        return;
    }

    // Explicit command dispatch: `cli.js <command> ...`
    if (firstPositional && commandRegistry[firstPositional]) {
        await commandRegistry[firstPositional](args.slice(1));
        return;
    }

    // Any other global --help form falls back to global help.
    if (parsed.help) {
        printGlobalHelp();
        return;
    }

    // Default command route: `cli.js "<prompt>"` => router
    await commandRegistry[COMMAND_NAMES.ROUTER](args);
}

main().catch((err) => {
    console.error("[Harness] Fatal error:", err);
    Deno.exit(1);
});
