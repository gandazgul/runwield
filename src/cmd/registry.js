/**
 * @module cmd/registry
 * Central command handler registry.
 */

import { CLI_BIN, COMMAND_NAMES, DEV_CLI_RUN } from "../constants.js";
import { runPlansCommand } from "./plans/index.js";
import { runRouterCommand } from "./router/index.js";
import { runSleepCommand } from "./sleep/index.js";
import { runHelpCommand } from "./help/index.js";
import { getAgentCompletions, runAgentsCommand } from "./agents/index.js";
import { getModelCompletions, runModelsCommand } from "./models/index.js";
import { runQuitCommand } from "./quit/index.js";
import { getLoadPlanCompletions, runLoadPlanCommand } from "./load-plan/index.js";
import { runExportCommand } from "./export/index.js";
import { runNewCommand } from "./new/index.js";
import { runSessionCommand } from "./session/index.js";
import { runShareCommand } from "./share/index.js";
import { runResumeCommand } from "./resume/index.js";
import { runInitCommand } from "./init/index.js";

/** @param {...string} parts */
const bin = (...parts) => [CLI_BIN, ...parts].join(" ");

/**
 * @typedef {{ value: string, label: string, description?: string, [key: string]: unknown }} CommandCompletionItem
 */

/**
 * @typedef {Object} CommandContext
 * @property {import('../shared/ui/types.js').UiAPI} [uiAPI]
 * @property {import('../shared/ui/types.js').EditorAPI} [editor]
 * @property {import('../shared/session/types.js').SessionManagerLike} [sessionManager]
 * @property {string} [sessionStartedAt]
 * @property {import('../shared/ui/types.js').TuiAPI} [tui]
 * @property {(data: string) => void | Promise<void>} [originalHandleInput]
 * @property {"new" | "continue"} [sessionStartMode]
 * @property {Record<string, unknown>} [__testDeps]
 */

/**
 * @typedef {(argv: string[], options?: CommandContext) => Promise<void>} CommandHandler
 */

/**
 * @typedef {Object} CommandDefinition
 * @property {string} name
 * @property {string[]} [aliases]
 * @property {string} displayName
 * @property {string} description
 * @property {string} summary
 * @property {string[]} usage
 * @property {string[]} [notes]
 * @property {CommandHandler} execute
 * @property {boolean} isSlash
 * @property {boolean} isCli
 * @property {(argumentPrefix: string) => Promise<CommandCompletionItem[]>} [getArgumentCompletions]
 */

/** @type {Record<string, CommandDefinition>} */
export const commandRegistry = {
    [COMMAND_NAMES.ROUTER]: {
        name: COMMAND_NAMES.ROUTER,
        displayName: "Router",
        description: "Triage the current request (default)",
        summary: "Route a request through triage and execution/planning flow (default command).",
        usage: [
            `${bin('"<user request>"')}`,
            `${bin('router "<user request>"')}`,
            `${bin("router --help")}`,
        ],
        notes: [
            "This is the default command when no explicit command is provided.",
            `Source-run fallback: ${DEV_CLI_RUN} "<user request>"`,
        ],
        execute: runRouterCommand,
        isSlash: false,
        isCli: true,
    },
    [COMMAND_NAMES.AGENT]: {
        name: COMMAND_NAMES.AGENT,
        aliases: ["agents"],
        displayName: "Agent",
        description: "Switch active agent",
        summary: "List available agents or talk directly to one (--agent shorthand).",
        usage: [
            `${bin("agent")}                            List available agents`,
            `${bin("agent <name>")}                     Talk directly to an agent`,
            `${bin('agent <name> "<user request>"')}    Start with a prompt`,
        ],
        notes: [
            "Bypasses the router triage flow — sends prompts directly to the agent.",
            "Use /agent inside the TUI to switch agents at any time.",
        ],
        execute: runAgentsCommand,
        isSlash: true,
        isCli: true,
        getArgumentCompletions: getAgentCompletions,
    },
    [COMMAND_NAMES.MODEL]: {
        name: COMMAND_NAMES.MODEL,
        aliases: ["models"],
        displayName: "Model",
        description: "Switch AI model",
        summary: "Switch active AI model via slash command or CLI.",
        usage: [
            `${bin("model <provider>/<model_id>")}`,
            `${bin("models <provider>/<model_id>")}`,
        ],
        notes: [
            "Switch the active AI model.",
            "Inside the interactive session, use '/model <tab>' for autocomplete.",
        ],
        execute: runModelsCommand,
        isSlash: true,
        isCli: false,
        getArgumentCompletions: getModelCompletions,
    },
    [COMMAND_NAMES.LOAD_PLAN]: {
        name: COMMAND_NAMES.LOAD_PLAN,
        displayName: "Load Plan",
        description: "Load and continue a saved plan",
        summary: "Load a saved plan by name or file path and continue work on it.",
        usage: [
            `${bin("load-plan <plan-name>")}`,
            `${bin("load-plan plans/<plan>.md")}`,
            `${bin("load-plan --help")}`,
        ],
        notes: [
            "If the plan is approved, you can proceed, re-open review, or inspect details.",
        ],
        execute: runLoadPlanCommand,
        isSlash: true,
        isCli: true,
        getArgumentCompletions: getLoadPlanCompletions,
    },
    [COMMAND_NAMES.RESUME]: {
        name: COMMAND_NAMES.RESUME,
        displayName: "Resume Session",
        description: "Browse and resume a recent session",
        summary: "Browse and resume a recent session.",
        usage: [
            "/resume",
        ],
        notes: [
            "Slash command only (interactive session).",
        ],
        execute: runResumeCommand,
        isSlash: true,
        isCli: false,
    },
    [COMMAND_NAMES.NEW]: {
        name: COMMAND_NAMES.NEW,
        displayName: "New Session",
        description: "Start a new interactive session",
        summary: "Start a brand new root session.",
        usage: [
            "/new",
            "/new <optional name>",
        ],
        notes: [
            "Slash command only (interactive session).",
        ],
        execute: runNewCommand,
        isSlash: true,
        isCli: false,
    },
    [COMMAND_NAMES.SESSION]: {
        name: COMMAND_NAMES.SESSION,
        displayName: "Session Info",
        description: "Show information about the current session",
        summary: "Show information about the current session.",
        usage: [
            "/session",
        ],
        notes: [
            "Slash command only (interactive session).",
        ],
        execute: runSessionCommand,
        isSlash: true,
        isCli: false,
    },
    [COMMAND_NAMES.SHARE]: {
        name: COMMAND_NAMES.SHARE,
        displayName: "Share",
        description: "Share current session as a secret GitHub Gist",
        summary: "Export the current session to HTML and upload it as a secret GitHub Gist.",
        usage: [
            "/share",
        ],
        notes: [
            "Requires GitHub CLI ('gh') to be installed and authenticated.",
            "Saves session as a secret (private) Gist.",
        ],
        execute: runShareCommand,
        isSlash: true,
        isCli: false,
    },
    [COMMAND_NAMES.EXPORT]: {
        name: COMMAND_NAMES.EXPORT,
        displayName: "Export",
        description: "Export current session (HTML default, or specify .html/.jsonl path)",
        summary: "Export current interactive session to HTML (default) or JSONL.",
        usage: [
            "/export",
            "/export output.html",
            "/export output.jsonl",
        ],
        notes: [
            "Slash command only (interactive session).",
            "Default output path is session-<iso-datetime>.html in the current working directory.",
        ],
        execute: runExportCommand,
        isSlash: true,
        isCli: false,
    },
    [COMMAND_NAMES.PLANS]: {
        name: COMMAND_NAMES.PLANS,
        displayName: "Plans",
        description: "List or manage plans",
        summary: "List saved plans.",
        usage: [
            `${bin("plans")}`,
            `${bin("plans --help")}`,
        ],
        notes: [
            "Shows status, classification, complexity, summary, and creation time.",
        ],
        execute: runPlansCommand,
        isSlash: false,
        isCli: true,
    },
    [COMMAND_NAMES.SLEEP]: {
        name: COMMAND_NAMES.SLEEP,
        displayName: "Sleep",
        description: "Let the model consolidate context",
        summary: "Run /sleep prompt template (via operator) for memory optimization/cleanup.",
        usage: [
            `${bin("sleep")}`,
            `${bin("sleep --help")}`,
        ],
        notes: [
            "Requires mnemosyne binary in PATH.",
            "Invokes bundled /sleep prompt template via operator.",
            "You can also run /sleep directly inside the interactive TUI.",
        ],
        execute: runSleepCommand,
        isSlash: true,
        isCli: true,
    },
    [COMMAND_NAMES.HELP]: {
        name: COMMAND_NAMES.HELP,
        displayName: "Help",
        description: "Show help information",
        summary: "Show global help or help for a specific command.",
        usage: [
            `${bin("--help")}`,
            `${bin("help")}`,
            `${bin("help <command>")}`,
        ],
        notes: [],
        execute: runHelpCommand,
        isSlash: false,
        isCli: true,
    },
    [COMMAND_NAMES.QUIT]: {
        name: COMMAND_NAMES.QUIT,
        displayName: "Quit",
        description: "Exit the application",
        summary: "Exit the interactive session.",
        usage: ["/quit"],
        notes: [],
        execute: runQuitCommand,
        isSlash: true,
        isCli: false,
    },
    [COMMAND_NAMES.EXIT]: {
        name: COMMAND_NAMES.EXIT,
        displayName: "Exit",
        description: "Exit the application",
        summary: "Alias for /quit.",
        usage: ["/exit"],
        notes: [],
        execute: runQuitCommand,
        isSlash: true,
        isCli: false,
    },
    [COMMAND_NAMES.INIT]: {
        name: COMMAND_NAMES.INIT,
        aliases: ["initialize"],
        displayName: "Init",
        description: "Initialize Harns into the current project",
        summary: "Initialize Harns into the current project (bootstraps context index and memory).",
        usage: [
            `${bin("init")}`,
        ],
        notes: [
            "Runs a one-time agent that explores the codebase and writes a CONTEXT.md summary.",
            "Safe to run multiple times — subsequent runs in the same directory will warn and exit.",
            "This command is also available as /init inside the interactive TUI.",
        ],
        execute: runInitCommand,
        isSlash: true,
        isCli: true,
    },
};

/**
 * @param {string | undefined} commandName
 * @returns {CommandDefinition | undefined}
 */
export function getCommandDefinition(commandName) {
    if (!commandName) return undefined;
    const name = String(commandName);
    if (commandRegistry[name]) return commandRegistry[name];
    return Object.values(commandRegistry).find((command) => command.aliases?.includes(name));
}

/**
 * @returns {CommandDefinition[]}
 */
export function getCliCommandDefinitions() {
    return Object.values(commandRegistry).filter((command) => command.isCli);
}
