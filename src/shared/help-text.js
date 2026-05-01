/**
 * @module shared/help-text
 * Shared help text rendering for global and per-command usage.
 */

import { CLI_BIN, COMMAND_NAMES, DEV_CLI_RUN } from "../constants.js";

const COMMAND_SUMMARIES = {
    [COMMAND_NAMES.ROUTER]: "Route a request through triage and execution/planning flow (default command).",
    [COMMAND_NAMES.AGENT]: "List available agents or talk directly to one (--agent shorthand).",
    [COMMAND_NAMES.MODEL]: "Switch active AI model via slash command or CLI.",
    [COMMAND_NAMES.RESUME]: "Resume work from a saved plan by name or file path.",
    [COMMAND_NAMES.PLANS]: "List saved plans.",
    [COMMAND_NAMES.SLEEP]: "Run /sleep prompt template (via operator) for memory optimization/cleanup.",
    [COMMAND_NAMES.HELP]: "Show global help or help for a specific command.",
};

/** @param {...string} parts */
const bin = (...parts) => [CLI_BIN, ...parts].join(" ");

/** @type {Record<string, { usage: string[]; notes: string[] }>} */
const COMMAND_DETAILS = {
    [COMMAND_NAMES.ROUTER]: {
        usage: [
            `${bin('"<user request>"')}`,
            `${bin('router "<user request>"')}`,
            `${bin("router --help")}`,
        ],
        notes: [
            "This is the default command when no explicit command is provided.",
            `Source-run fallback: ${DEV_CLI_RUN} \"<user request>\"`,
        ],
    },
    [COMMAND_NAMES.AGENT]: {
        usage: [
            `${bin("--agent")}                            List available agents`,
            `${bin("--agent <name>")}                     Talk directly to an agent`,
            `${bin('--agent <name> "<user request>"')}    Start with a prompt`,
            `${bin("agent")}                              Same as --agent`,
        ],
        notes: [
            "Bypasses the router triage flow — sends prompts directly to the agent.",
            "Use /agent inside the TUI to switch agents at any time.",
        ],
    },
    [COMMAND_NAMES.MODEL]: {
        usage: ["models <provider>/<model_id>"],
        notes: [
            "Switch the active AI model.",
            "Inside the interactive session, use '/model <tab>' for autocomplete.",
        ],
    },
    [COMMAND_NAMES.RESUME]: {
        usage: [
            `${bin("resume <plan-name>")}`,
            `${bin("resume plans/<plan>.md")}`,
            `${bin("resume --help")}`,
        ],
        notes: [
            "If the plan is approved, you can proceed, re-open review, or inspect details.",
        ],
    },
    [COMMAND_NAMES.PLANS]: {
        usage: [
            `${bin("plans")}`,
            `${bin("plans --help")}`,
        ],
        notes: [
            "Shows status, classification, complexity, summary, and creation time.",
        ],
    },
    [COMMAND_NAMES.SLEEP]: {
        usage: [
            `${bin("sleep")}`,
            `${bin("sleep --help")}`,
        ],
        notes: [
            "Requires mnemosyne binary in PATH.",
            "Invokes bundled /sleep prompt template via operator.",
            "You can also run /sleep directly inside the interactive TUI.",
        ],
    },
    [COMMAND_NAMES.HELP]: {
        usage: [
            `${bin("--help")}`,
            `${bin("help")}`,
            `${bin("help <command>")}`,
        ],
        notes: [],
    },
};

/**
 * Print global CLI usage/help text.
 */
export function printGlobalHelp() {
    console.log("Harns — Plan-by-Default Coding Harness\n");
    console.log("Usage:");
    console.log(`  ${bin('"<user request>"')}`);
    console.log(`  ${bin("<command> [args]")}\n`);

    console.log("Commands:");
    for (const [name, summary] of Object.entries(COMMAND_SUMMARIES)) {
        console.log(`  ${name.padEnd(8)} ${summary}`);
    }

    console.log("\nHelp:");
    console.log(`  ${bin("--help")}`);
    console.log(`  ${bin("help <command>")}`);
    console.log(`\nDeveloper fallback: ${DEV_CLI_RUN} --help`);
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
