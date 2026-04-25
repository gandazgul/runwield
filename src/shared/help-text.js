/**
 * @module shared/help-text
 * Shared help text rendering for global and per-command usage.
 */

import { COMMAND_NAMES } from "../constants.js";

const COMMAND_SUMMARIES = {
    [COMMAND_NAMES.ROUTER]: "Route a request through triage and execution/planning flow (default command).",
    [COMMAND_NAMES.RESUME]: "Resume work from a saved plan by name or file path.",
    [COMMAND_NAMES.PLANS]: "List saved plans.",
    [COMMAND_NAMES.HELP]: "Show global help or help for a specific command.",
};

const COMMAND_DETAILS = {
    [COMMAND_NAMES.ROUTER]: {
        usage: [
            'deno run -A src/cli.js "<user request>"',
            'deno run -A src/cli.js router "<user request>"',
            "deno run -A src/cli.js router --help",
        ],
        notes: [
            "This is the default command when no explicit command is provided.",
            "Equivalent forms: cli.js \"prompt\" and cli.js router \"prompt\".",
        ],
    },
    [COMMAND_NAMES.RESUME]: {
        usage: [
            "deno run -A src/cli.js resume <plan-name>",
            "deno run -A src/cli.js resume plans/<plan>.md",
            "deno run -A src/cli.js resume --help",
        ],
        notes: [
            "If the plan is approved, you can proceed, re-open review, or inspect details.",
        ],
    },
    [COMMAND_NAMES.PLANS]: {
        usage: [
            "deno run -A src/cli.js plans",
            "deno run -A src/cli.js plans --help",
        ],
        notes: [
            "Shows status, classification, complexity, summary, and creation time.",
        ],
    },
    [COMMAND_NAMES.HELP]: {
        usage: [
            "deno run -A src/cli.js --help",
            "deno run -A src/cli.js help",
            "deno run -A src/cli.js help <command>",
        ],
        notes: [],
    },
};

/**
 * Print global CLI usage/help text.
 */
export function printGlobalHelp() {
    console.log("Harness — Plan-by-Default Coding Harness\n");
    console.log("Usage:");
    console.log('  deno run -A src/cli.js "<user request>"');
    console.log("  deno run -A src/cli.js <command> [args]\n");

    console.log("Commands:");
    for (const [name, summary] of Object.entries(COMMAND_SUMMARIES)) {
        console.log(`  ${name.padEnd(8)} ${summary}`);
    }

    console.log("\nHelp:");
    console.log("  deno run -A src/cli.js --help");
    console.log("  deno run -A src/cli.js help <command>");
}

/**
 * Print usage/help text for a specific command.
 *
 * @param {string} commandName
 * @returns {boolean} true if command exists, false otherwise.
 */
export function printCommandHelp(commandName) {
    const details = COMMAND_DETAILS[commandName];
    if (!details) return false;

    console.log(`Usage (${commandName}):`);
    for (const line of details.usage) {
        console.log(`  ${line}`);
    }

    if (details.notes.length > 0) {
        console.log("\nNotes:");
        for (const note of details.notes) {
            console.log(`  - ${note}`);
        }
    }

    return true;
}

/**
 * Check if a command name is a known command.
 *
 * @param {string | undefined} commandName
 * @returns {boolean}
 */
export function isKnownCommand(commandName) {
    if (!commandName) return false;
    return commandName in COMMAND_SUMMARIES;
}
