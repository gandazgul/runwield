/**
 * @module cli
 * Harns — Plan-by-Default Coding Harness
 *
 * Usage:
 *   hns "<user request>"
 *   hns router "<user request>"
 *   hns resume <plan-name-or-path>
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
import { printGlobalHelp } from "./shared/help-text.js";

/**
 * Main CLI entrypoint.
 */
async function main() {
    const args = Deno.args;

    const parsed = parseArgs(args, {
        boolean: ["help"],
        string: ["agent"],
        alias: { h: "help", a: "agent" },
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

    // --agent flag: delegate to agents command
    if ("agent" in parsed) {
        const agentArgs = parsed.agent ? [parsed.agent, ...parsed._.map(String)] : [];
        await commandRegistry[COMMAND_NAMES.AGENTS](agentArgs);
        return;
    }

    // Default command route: `cli.js "<user request>"` => router
    await commandRegistry[COMMAND_NAMES.ROUTER](args);
}

main().catch((err) => {
    console.error("[Harns] Fatal error:", err);
    Deno.exit(1);
});
