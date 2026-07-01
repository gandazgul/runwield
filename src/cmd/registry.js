/**
 * @module cmd/registry
 * Central command handler registry.
 */

import { CLI_BIN, DEV_CLI_RUN } from "../constants.js";
import { runPlansCommand } from "./plans/index.js";
import { runRouterCommand } from "./router/index.js";
import { runSleepCommand } from "./sleep/index.js";
import { runHelpCommand } from "./help/index.js";
import { getAgentCompletions, runAgentsCommand } from "./agents/index.js";
import { getModelCompletions, runModelsCommand } from "./models/index.js";
import { runLoginCommand, runLogoutCommand, runStatusCommand } from "./auth/index.js";
import { runQuitCommand } from "./quit/index.js";
import { getLoadPlanCompletions, runLoadPlanCommand } from "./load-plan/index.js";
import { runExportCommand } from "./export/index.js";
import { runNewCommand } from "./new/index.js";
import { runNameCommand } from "./name/index.js";
import { runSessionCommand } from "./session/index.js";
import { runShareCommand } from "./share/index.js";
import { runResumeCommand } from "./resume/index.js";
import { runInitCommand } from "./init/index.js";
import { runThemeCommand } from "./theme/index.js";
import { runInstallCommand } from "./install/index.js";
import { runRemoveCommand } from "./remove/index.js";
import { runCompactCommand } from "./compact/index.js";
import { runCopyCommand } from "./copy/index.js";
import { runReloadCommand } from "./reload/index.js";
import { runVersionCommand } from "./version/index.js";
import { runSnipFiltersCommand } from "./snip-filters/index.js";
import { getAgentDisplayName } from "../shared/session/agents.js";

/** Known CLI / slash command names. Defined alongside the registry so adding a new command only touches one file. */
/** @type {Readonly<{ROUTER: string, AGENT: string, MODEL: string, LOGIN: string, LOGOUT: string, STATUS: string, EXPORT: string, SHARE: string, LOAD_PLAN: string, RESUME: string, NEW: string, NAME: string, SESSION: string, PLANS: string, SLEEP: string, HELP: string, VERSION: string, QUIT: string, EXIT: string, INIT: string, THEME: string, INSTALL: string, REMOVE: string, COMPACT: string, RELOAD: string, SNIP_FILTERS: string, COPY: string}>} */
export const COMMAND_NAMES = Object.freeze({
    ROUTER: "router",
    AGENT: "agent",
    MODEL: "model",
    LOGIN: "login",
    LOGOUT: "logout",
    STATUS: "status",
    EXPORT: "export",
    SHARE: "share",
    LOAD_PLAN: "load-plan",
    RESUME: "resume",
    NEW: "new",
    NAME: "name",
    SESSION: "session",
    PLANS: "plans",
    SLEEP: "sleep",
    HELP: "help",
    VERSION: "version",
    QUIT: "quit",
    EXIT: "exit",
    INIT: "init",
    THEME: "theme",
    INSTALL: "install",
    REMOVE: "remove",
    COMPACT: "compact",
    RELOAD: "reload",
    SNIP_FILTERS: "snip-filters",
    COPY: "copy",
});

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
 * @property {(cancel: (() => void) | null) => void} [registerOperationCancel]  Set by the slash dispatcher; lets a long-running command install its own Esc handler.
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
 * @property {("cli" | "slash")[]} surfaces
 * @property {(argumentPrefix: string) => Promise<CommandCompletionItem[]>} [getArgumentCompletions]
 */

/** @type {Record<string, CommandDefinition>} */
export const commandRegistry = {
    [COMMAND_NAMES.ROUTER]: {
        name: COMMAND_NAMES.ROUTER,
        displayName: getAgentDisplayName(COMMAND_NAMES.ROUTER),
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
        surfaces: ["cli"],
    },
    [COMMAND_NAMES.AGENT]: {
        name: COMMAND_NAMES.AGENT,
        aliases: ["agents"],
        displayName: "Agent",
        description: "Switch active agent",
        summary: "List available agents or talk directly to one.",
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
        surfaces: ["cli", "slash"],
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
        surfaces: ["cli", "slash"],
        getArgumentCompletions: getModelCompletions,
    },
    [COMMAND_NAMES.LOGIN]: {
        name: COMMAND_NAMES.LOGIN,
        displayName: "Login",
        description: "Configure model authentication",
        summary: "Sign in with a subscription or save an API key for a model provider.",
        usage: [
            "/login",
            "/login subscription openai-codex",
            "/login api-key openai",
        ],
        notes: [
            "Credentials are stored in RunWield config at ~/.wld/auth.json.",
            "Use /status to inspect configured providers.",
        ],
        execute: runLoginCommand,
        surfaces: ["slash"],
    },
    [COMMAND_NAMES.LOGOUT]: {
        name: COMMAND_NAMES.LOGOUT,
        displayName: "Logout",
        description: "Remove stored model credentials",
        summary: "Remove credentials stored by /login.",
        usage: [
            "/logout",
            "/logout openai-codex",
        ],
        notes: [
            "Environment variables and models.json provider config are not changed.",
        ],
        execute: runLogoutCommand,
        surfaces: ["slash"],
    },
    [COMMAND_NAMES.STATUS]: {
        name: COMMAND_NAMES.STATUS,
        displayName: "Status",
        description: "Show model authentication status",
        summary: "Show configured providers and available model count.",
        usage: [
            "/status",
        ],
        notes: [
            "This reports model/auth status for the current RunWield configuration.",
        ],
        execute: runStatusCommand,
        surfaces: ["slash"],
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
        surfaces: ["cli", "slash"],
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
        surfaces: ["slash"],
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
        surfaces: ["slash"],
    },
    [COMMAND_NAMES.NAME]: {
        name: COMMAND_NAMES.NAME,
        displayName: "Session Name",
        description: "Set or show the current session name",
        summary: "Set or show the current session name.",
        usage: [
            "/name",
            "/name <name>",
        ],
        notes: [
            "Slash command only (interactive session).",
        ],
        execute: runNameCommand,
        surfaces: ["slash"],
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
        surfaces: ["slash"],
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
        surfaces: ["slash"],
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
        surfaces: ["slash"],
    },
    [COMMAND_NAMES.PLANS]: {
        name: COMMAND_NAMES.PLANS,
        displayName: "Plans",
        description: "List, read, archive, restore, or launch the local Plans Workspace",
        summary: "Manage saved plans and start the read-only local browser Workspace.",
        usage: [
            `${bin("plans")}`,
            `${bin("plans read <plan-name-or-id>")}`,
            `${bin("plans archive")}`,
            `${bin("plans archive <plan-name-or-id> [--reason <text>] [--force]")}`,
            `${bin("plans archive restore <archived-plan-name-or-id> [--to <plan-name>]")}`,
            `${bin("plans ui [--bind <host>|--host <host>] [--port <port>] [--no-open]")}`,
            `${bin("plans --help")}`,
            `${bin("plans ui --help")}`,
        ],
        notes: [
            "Default behavior lists active Plans only; plaintext archives under plans/archived/ are hidden from this list.",
            "Use plans archive with no target to list archived Plans, and plans read to inspect active or archived markdown.",
            "Archive moves verified and closed_without_verification Plans by default; other statuses require --force and recoverable worktree states stay blocked.",
            "The Workspace binds to 127.0.0.1 and a random available port by default.",
            "Use --bind/--host only for explicit non-loopback exposure; RunWield prints a plaintext Plan-content warning.",
            "Workspace HTML and APIs require the per-server token in the launch URL or x-runwield-workspace-token header.",
        ],
        execute: runPlansCommand,
        surfaces: ["cli"],
    },
    [COMMAND_NAMES.SLEEP]: {
        name: COMMAND_NAMES.SLEEP,
        displayName: "Sleep",
        description: "Let the model consolidate context",
        summary: "Run command-owned memory optimization/cleanup via an isolated operator session.",
        usage: [
            `${bin("sleep")}`,
            `${bin("sleep --help")}`,
        ],
        notes: [
            "Requires mnemosyne binary in PATH.",
            "Invokes a built-in sleep prompt via operator.",
            "You can also run /sleep directly inside the interactive TUI.",
        ],
        execute: runSleepCommand,
        surfaces: ["cli", "slash"],
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
        surfaces: ["cli"],
    },
    [COMMAND_NAMES.VERSION]: {
        name: COMMAND_NAMES.VERSION,
        displayName: "Version",
        description: "Show version and architecture info",
        summary: "Print runwield version and platform architecture.",
        usage: [
            `${bin("--version")}`,
            `${bin("version")}`,
        ],
        notes: [],
        execute: runVersionCommand,
        surfaces: ["cli"],
    },
    [COMMAND_NAMES.QUIT]: {
        name: COMMAND_NAMES.QUIT,
        displayName: "Quit",
        description: "Exit the application",
        summary: "Exit the interactive session.",
        usage: ["/quit"],
        notes: [],
        execute: runQuitCommand,
        surfaces: ["slash"],
    },
    [COMMAND_NAMES.EXIT]: {
        name: COMMAND_NAMES.EXIT,
        displayName: "Exit",
        description: "Exit the application",
        summary: "Alias for /quit.",
        usage: ["/exit"],
        notes: [],
        execute: runQuitCommand,
        surfaces: ["slash"],
    },
    [COMMAND_NAMES.INIT]: {
        name: COMMAND_NAMES.INIT,
        aliases: ["initialize"],
        displayName: "Init",
        description: "Initialize RunWield into the current project",
        summary: "Initialize RunWield into the current project (bootstraps context index and memory).",
        usage: [
            `${bin("init")}`,
        ],
        notes: [
            "Runs a one-time agent that explores the codebase and writes a CONTEXT.md summary.",
            "Safe to run multiple times — subsequent runs in the same directory will warn and exit.",
            "This command is also available as /init inside the interactive TUI.",
        ],
        execute: runInitCommand,
        surfaces: ["cli", "slash"],
    },
    [COMMAND_NAMES.THEME]: {
        name: COMMAND_NAMES.THEME,
        displayName: "Theme",
        description: "Switch TUI theme",
        summary: "Switch the active visual theme.",
        usage: [
            "/theme",
            `${bin("theme <name>")}`,
            `${bin("theme --list")}`,
        ],
        notes: [
            "Inside the TUI, /theme opens an interactive picker with live previews.",
        ],
        execute: runThemeCommand,
        surfaces: ["cli", "slash"],
    },
    [COMMAND_NAMES.INSTALL]: {
        name: COMMAND_NAMES.INSTALL,
        displayName: "Install",
        description: "Install a package",
        summary: "Install package themes and prompt templates from npm, git, or local path.",
        usage: [
            `${bin("install npm:<spec>")}`,
            `${bin("install git:<url>")}`,
            `${bin("install local:<path>")}`,
        ],
        notes: [
            "Theme (.json) resources and passive prompt templates are registered.",
            "Pi package skills are ignored; install them separately with `npx skills add <source>`.",
            "Code extensions are loaded only when marked WLD-compatible and approved during install.",
        ],
        execute: runInstallCommand,
        surfaces: ["cli"],
    },
    [COMMAND_NAMES.REMOVE]: {
        name: COMMAND_NAMES.REMOVE,
        displayName: "Remove",
        description: "Remove an installed theme package",
        summary: "Uninstall a theme package.",
        usage: [
            `${bin("remove <source>")}`,
        ],
        notes: [],
        execute: runRemoveCommand,
        surfaces: ["cli"],
    },
    [COMMAND_NAMES.SNIP_FILTERS]: {
        name: COMMAND_NAMES.SNIP_FILTERS,
        aliases: ["snip-filter"],
        displayName: "Snip Filters",
        description: "Install or clean up RunWield Deno Snip filters",
        summary: "Install, clean up, or inspect RunWield-managed Deno Snip filters in Snip's default filter directory.",
        usage: [
            `${bin("snip-filters status")}`,
            `${bin("snip-filters install")}`,
            `${bin("snip-filters cleanup")}`,
        ],
        notes: [
            "Install copies RunWield-managed Deno filters into ~/.config/snip/filters so plain Snip commands can find them.",
            "Cleanup removes only files marked as RunWield-managed.",
        ],
        execute: runSnipFiltersCommand,
        surfaces: ["cli"],
    },
    [COMMAND_NAMES.COMPACT]: {
        name: COMMAND_NAMES.COMPACT,
        displayName: "Compact",
        description: "Compact the session context",
        summary: "Manually compact the session context to free up tokens.",
        usage: [
            "/compact",
            '/compact "focus on summarizing the architecture decisions"',
        ],
        notes: [
            "Slash command only (interactive session).",
            "Optionally pass custom instructions to guide the summarization.",
        ],
        execute: runCompactCommand,
        surfaces: ["slash"],
    },
    [COMMAND_NAMES.COPY]: {
        name: COMMAND_NAMES.COPY,
        displayName: "Copy",
        description: "Copy the last assistant message to clipboard",
        summary: "Copy the last assistant response text to the system clipboard.",
        usage: [
            "/copy",
        ],
        notes: [
            "Slash command only (interactive session).",
            "Uses pbcopy (macOS), xclip/xsel (Linux), or clip (Windows).",
        ],
        execute: runCopyCommand,
        surfaces: ["slash"],
    },
    [COMMAND_NAMES.RELOAD]: {
        name: COMMAND_NAMES.RELOAD,
        displayName: "Reload",
        description: "Reload dynamic config and context",
        summary: "Reload themes, settings, system prompt, and memories without losing the active session.",
        usage: [
            "/reload",
        ],
        notes: [
            "Slash command only (interactive session).",
            "Refreshes memories, RUNWEILD.md, prompt templates, skills, model settings, and themes.",
        ],
        execute: runReloadCommand,
        surfaces: ["slash"],
    },
};

/**
 * @param {CommandDefinition} command
 * @param {"cli" | "slash"} surface
 * @returns {boolean}
 */
export function hasCommandSurface(command, surface) {
    return command.surfaces.includes(surface);
}

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
    return Object.values(commandRegistry).filter((command) => hasCommandSurface(command, "cli"));
}

/**
 * @returns {CommandDefinition[]}
 */
export function getSlashCommandDefinitions() {
    return Object.values(commandRegistry).filter((command) => hasCommandSurface(command, "slash"));
}

/**
 * @param {CommandDefinition} command
 * @returns {string[]}
 */
export function getCommandInvocationNames(command) {
    return [command.name, ...(command.aliases || [])];
}

/**
 * @returns {string[]}
 */
export function getSlashCommandInvocationNames() {
    return getSlashCommandDefinitions().flatMap(getCommandInvocationNames);
}

/**
 * @param {string | undefined} commandName
 * @returns {CommandDefinition | undefined}
 */
export function getSlashCommandDefinition(commandName) {
    const command = getCommandDefinition(commandName);
    if (!command || !hasCommandSurface(command, "slash")) return undefined;
    return command;
}
