/**
 * @module cmd/registry
 * Central command handler registry.
 */

import { CLI_BIN, DEV_CLI_RUN } from "../constants.js";
import { runPlansCommand } from "./plans/index.ts";
import { runWorkRecordsCommand } from "./wr/index.ts";
import { runRouterCommand } from "./router/index.ts";
import { runSleepCommand, SYSTEM_SLEEP_MNEMOTECA_PORT } from "./sleep/index.ts";
import { runHelpCommand } from "./help/index.js";
import { getAgentCompletions, runAgentsCommand } from "./agents/index.ts";
import { getModelCompletions, runModelsCommand } from "./models/index.ts";
import { runLoginCommand, runLogoutCommand, runStatusCommand } from "./auth/index.ts";
import { runQuitCommand } from "./quit/index.ts";
import { getLoadPlanCompletions, runLoadPlanCommand } from "./load-plan/index.ts";
import { runExportCommand } from "./export/index.js";
import { runNewCommand } from "./new/index.ts";
import { runNameCommand } from "./name/index.ts";
import { runSessionCommand } from "./session/index.js";
import { runContextCommand } from "./context/index.js";
import { runShareCommand, SYSTEM_GITHUB_CLI_PORT } from "./share/index.ts";
import { runResumeCommand } from "./resume/index.ts";
import { runInitCommand } from "./init/index.ts";
import { runThemeCommand } from "./theme/index.ts";
import { runInstallCommand } from "./install/index.ts";
import { runRemoveCommand } from "./remove/index.ts";
import { runCompactCommand } from "./compact/index.js";
import { runSettingsCommand } from "./settings/index.ts";
import { runCopyCommand } from "./copy/index.js";
import { runReloadCommand } from "./reload/index.js";
import { runVersionCommand } from "./version/index.js";
import { runTerminalAuthSetup } from "../ui/tui/terminal-auth-setup.ts";
import {
    runUpdateCommand,
    SYSTEM_INSTALLER_PROCESS_PORT,
    SYSTEM_PROCESS_EXIT_PORT,
    SYSTEM_UPDATE_NETWORK_PORT,
} from "./update/index.ts";
import { runSnipFiltersCommand } from "./snip-filters/index.ts";
import { runAcpCommand } from "./acp/index.js";
import { runWorkspaceCommand } from "./workspace/index.ts";
import { getAgentDisplayName } from "../shared/session/agents.js";
import { SYSTEM_INTERACTIVE_SESSION_PORT } from "../ui/tui/interactive-session-port.ts";
import { SYSTEM_WORK_RECORD_MNEMOTECA_PORT } from "../shared/work-records/mnemoteca-port.ts";

/** Known CLI / slash command names. Defined alongside the registry so adding a new command only touches one file. */
/** @type {Readonly<{ROUTER: string, AGENT: string, MODEL: string, LOGIN: string, LOGOUT: string, STATUS: string, EXPORT: string, SHARE: string, LOAD_PLAN: string, RESUME: string, NEW: string, NAME: string, SESSION: string, PLANS: string, WR: string, SLEEP: string, HELP: string, VERSION: string, UPDATE: string, QUIT: string, EXIT: string, INIT: string, THEME: string, INSTALL: string, REMOVE: string, COMPACT: string, SETTINGS: string, RELOAD: string, SNIP_FILTERS: string, COPY: string, CONTEXT: string, ACP: string, WORKSPACE: string}>} */
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
    WR: "wr",
    SLEEP: "sleep",
    HELP: "help",
    VERSION: "version",
    UPDATE: "update",
    QUIT: "quit",
    EXIT: "exit",
    INIT: "init",
    THEME: "theme",
    INSTALL: "install",
    REMOVE: "remove",
    COMPACT: "compact",
    SETTINGS: "settings",
    RELOAD: "reload",
    SNIP_FILTERS: "snip-filters",
    COPY: "copy",
    CONTEXT: "context",
    ACP: "acp",
    WORKSPACE: "workspace",
});

/** @param {...string} parts */
const bin = (...parts) => [CLI_BIN, ...parts].join(" ");

/**
 * Slash-only commands are dispatched with a real interactive UI. Keep that
 * surface guarantee at the registry boundary so the command itself receives a
 * required capability instead of an optional dependency bag.
 *
 * @param {CommandContext | undefined} options
 * @returns {CommandContext & { uiAPI: import('../ui/tui/types.js').UiAPI }}
 */
function requireInteractiveCommandContext(options) {
    if (!options?.uiAPI) throw new Error("This command is only available in the interactive session.");
    return { ...options, uiAPI: options.uiAPI };
}

/**
 * @typedef {{ value: string, label: string, description?: string, [key: string]: unknown }} CommandCompletionItem
 */

/**
 * @typedef {Object} CommandContext
 * @property {import('../ui/tui/types.js').UiAPI} [uiAPI]
 * @property {import('../ui/tui/types.js').EditorAPI} [editor]
 * @property {string} [sessionId]
 * @property {import('../shared/session/session-runtime.js').SessionRuntime} [sessionRuntime]
 * @property {string} [sessionStartedAt]
 * @property {import('../ui/tui/types.js').TuiAPI} [tui]
 * @property {(data: string) => void | Promise<void>} [originalHandleInput]
 * @property {"new" | "continue"} [sessionStartMode]
 * @property {(nextSessionId: string) => void} [replaceRuntimeSession]
 * @property {(eventName: string, options?: object) => void | Promise<unknown>} [notifyRunWieldEvent]
 * @property {boolean} [skipPostLoginSetup]
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
        execute: (argv, options) =>
            runRouterCommand(argv, { ...options, sessionPort: SYSTEM_INTERACTIVE_SESSION_PORT }),
        surfaces: ["cli"],
    },
    [COMMAND_NAMES.ACP]: {
        name: COMMAND_NAMES.ACP,
        displayName: "ACP",
        description: "Run the ACP stdio adapter",
        summary: "Start the Agent Client Protocol stdio server without launching the TUI.",
        usage: [
            `${bin("acp")}`,
            `${bin("--mode acp")}`,
        ],
        notes: [
            "CLI only: stdout is reserved for ACP JSON-RPC protocol frames.",
            "Handles initialize, session new/load/prompt/close, and session cancellation; other ACP methods return structured unimplemented errors.",
        ],
        execute: runAcpCommand,
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
        execute: (argv, options) =>
            runAgentsCommand(argv, { ...options, sessionPort: SYSTEM_INTERACTIVE_SESSION_PORT }),
        surfaces: ["cli", "slash"],
        getArgumentCompletions: getAgentCompletions,
    },
    [COMMAND_NAMES.MODEL]: {
        name: COMMAND_NAMES.MODEL,
        aliases: ["models"],
        displayName: "Model",
        description: "Switch AI model",
        summary: "Switch the active AI model or set the CLI default.",
        usage: [
            `${bin("model")}                         Show CLI usage when no model is supplied`,
            `${bin("model <provider>/<model_id>")}`,
            `${bin("models <provider>/<model_id>")}`,
            "/model                              Open the interactive model selector",
            "/model <provider>/<model_id>",
        ],
        notes: [
            "The slash command switches the current runtime Session; the CLI command sets the default for future Sessions.",
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
            `${bin("login")}`,
            `${bin("login <provider>")}`,
            `${bin("login subscription openai-codex")}`,
            `${bin("login api-key openai")}`,
            "/login",
            "/login <provider>",
            "/login subscription openai-codex",
            "/login api-key openai",
        ],
        notes: [
            "Without arguments, prompts for authentication type and provider.",
            "When only a provider is supplied, subscription-capable providers use subscription login; other providers use API key login.",
            "The CLI command exits after credentials and a usable default model are configured.",
            "Credentials are stored in RunWield config at ~/.wld/auth.json.",
            "Use /status to inspect configured providers.",
        ],
        execute: async (argv, options) => {
            if (options?.uiAPI) {
                await runLoginCommand(argv, requireInteractiveCommandContext(options));
                return;
            }
            const result = await runTerminalAuthSetup(argv);
            if (result.status === "ready") return;
            console.error(result.message);
            Deno.exit(1);
        },
        surfaces: ["cli", "slash"],
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
        execute: (argv, options) => runLogoutCommand(argv, requireInteractiveCommandContext(options)),
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
        execute: (argv, options) => runStatusCommand(argv, requireInteractiveCommandContext(options)),
        surfaces: ["slash"],
    },
    [COMMAND_NAMES.LOAD_PLAN]: {
        name: COMMAND_NAMES.LOAD_PLAN,
        displayName: "Load Plan",
        description: "Load and continue a saved plan",
        summary: "Load a saved plan by name or file path and continue work on it.",
        usage: [
            `${bin("load-plan <plan-name-or-id>")}`,
            `${bin("load-plan docs/plans/<plan>.md")}`,
            "/load-plan                         Open the interactive Plan selector",
            "/load-plan <plan-name-or-id>",
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
            `${bin("resume <session-id>")}`,
        ],
        notes: [
            "Use /resume to browse saved Sessions, or pass an exact Session ID on the command line.",
        ],
        execute: runResumeCommand,
        surfaces: ["cli", "slash"],
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
    [COMMAND_NAMES.CONTEXT]: {
        name: COMMAND_NAMES.CONTEXT,
        displayName: "Context Usage",
        description: "Show active Agent Session context-window usage",
        summary: "Show current context-window usage and estimated resident context categories.",
        usage: [
            "/context",
        ],
        notes: [
            "Slash command only (interactive session).",
            "Reports current resident context, unlike /session's cumulative session statistics.",
        ],
        execute: runContextCommand,
        surfaces: ["slash"],
    },
    [COMMAND_NAMES.SHARE]: {
        name: COMMAND_NAMES.SHARE,
        displayName: "Share",
        description: "Share current session as a secret GitHub Gist",
        summary: "Export the current session JSONL snapshot and upload it as a secret GitHub Gist.",
        usage: [
            "/share",
        ],
        notes: [
            "Requires GitHub CLI ('gh') to be installed and authenticated.",
            "Saves session as a secret (private) Gist.",
        ],
        execute: (argv, options) => runShareCommand(argv, { ...options, githubCli: SYSTEM_GITHUB_CLI_PORT }),
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
        description: "List, read, archive, restore, share, pull, push, unshare, or launch the local Plans Workspace",
        summary:
            "Manage saved plans, publish Shared Spaces, sync remote revisions, delete Shared Spaces, and start the read-only local browser Workspace.",
        usage: [
            `${bin("plans")}`,
            `${bin("plans read <plan-name-or-id> [--help]")}`,
            `${bin("plans doctor [--repair] [--help]")}`,
            `${bin("plans clean-objective-checks [--dry-run] [--help]")}`,
            `${bin("plans share <plan-name-or-id> [--plan-server <url>] [--project-secrets] [--help]")}`,
            `${
                bin("plans pull <maintainer-url-or-plan-name-or-id> [--plan-server <url>] [--project-secrets] [--to <plan-name>] [--help]")
            }`,
            `${bin("plans push <plan-name-or-id> [--plan-server <url>] [--project-secrets] [--help]")}`,
            `${bin("plans unshare <plan-name-or-id> [--plan-server <url>] [--project-secrets] [--force] [--help]")}`,
            `${bin("plans archive [--help]")}`,
            `${bin("plans archive <plan-name-or-id> [--reason <text>] [--force] [--help]")}`,
            `${bin("plans archive --all --status <status> [--reason <text>] [--force] [--help]")}`,
            `${bin("plans archive restore <archived-plan-name-or-id> [--to <plan-name>] [--help]")}`,
            `${bin("plans prune [--dry-run] [--yes] [--help]")}`,
            `${bin("plans ui [--bind <host>|--host <host>] [--port <port>] [--no-open]")}`,
            `${bin("plans --help")}`,
            `${bin("plans ui --help")}`,
        ],
        notes: [
            "Default behavior lists active Plans only; plaintext archives under docs/plans/archived/ are hidden from this list.",
            "Use plans archive with no target to list archived Plans, and plans read to open active or archived markdown in a local read-only browser view.",
            "Use plans share to publish an active saved Plan to a Plan Server; --plan-server overrides planServerUrl for one invocation.",
            "Share output prints secret reviewer and maintainer URLs once; anyone with the maintainer URL can pull, push, close, or unshare.",
            "Use plans pull with a maintainer URL to import secrets and create/update a locked local Plan; --to chooses the local filename for fresh URL pulls.",
            "Use plans push to publish the current local shared Plan as a new encrypted remote Revision; it refuses stale remote state and no-op duplicates.",
            "Push output never prints maintainer URLs by default; existing reviewer links remain valid across revisions.",
            "Use plans unshare to destructively delete a remote Shared Space with maintainer secrets, remove local collaboration secrets, and clear local lock metadata; --force skips the prompt but not safety checks.",
            "After unshare, old reviewer/maintainer links stop working and other checkouts need deleted-remote recovery before local edits.",
            "Archive moves verified, user_verified, and closed_without_verification Plans by default; other statuses require --force and recoverable worktree states stay blocked.",
            "Use plans archive --all --status verified for best-effort bulk cleanup of active Plans with an exact status match.",
            "Use plans prune to delete archived Plans that are covered by a Work Record and past the repository retention policy; --yes skips the prompt.",
            "The Workspace binds to 127.0.0.1 and a random available port by default.",
            "Use --bind/--host only for explicit non-loopback exposure; RunWield prints a plaintext Plan-content warning.",
            "Workspace HTML and APIs require the per-server token in the launch URL or x-runwield-workspace-token header.",
        ],
        execute: runPlansCommand,
        surfaces: ["cli"],
    },
    [COMMAND_NAMES.WORKSPACE]: {
        name: COMMAND_NAMES.WORKSPACE,
        displayName: "Workspace",
        description: "Start the persistent owner Workspace or approve browser pairing",
        summary: "Serve the persistent multi-Project owner Workspace and approve paired browser devices.",
        usage: [
            `${
                bin("workspace serve [--bind <host>|--host <host>] [--port <port>] [--public-origin <origin>] [--trust-tls-terminator] [--no-open]")
            }`,
            `${bin("workspace pair <code>")}`,
            `${bin("workspace --help")}`,
        ],
        notes: [
            "Owner Workspace uses the owner coordination database and paired-device authorization.",
            "Use plans ui for the temporary current-checkout compatibility Plan Board.",
        ],
        execute: runWorkspaceCommand,
        surfaces: ["cli"],
    },
    [COMMAND_NAMES.WR]: {
        name: COMMAND_NAMES.WR,
        displayName: "Work Records",
        description: "List, search, read, index, backfill, and resolve canonical Work Records",
        summary: "Retrieve repo-local Work Record markdown, backfill records, and resolve supersession proposals.",
        usage: [
            `${bin("wr")}`,
            `${bin("wr list")}`,
            `${bin("wr list --all")}`,
            `${bin("wr search <query>")}`,
            `${bin("wr search <query> --all")}`,
            `${bin("wr read <recordId> [--no-open]")}`,
            `${bin("wr index rebuild")}`,
            `${bin("wr supersede")}`,
            `${bin("wr supersede <successorRecordId>")}`,
            `${bin("wr supersede <successorRecordId> --confirm <predecessorRecordId>")}`,
            `${bin("wr supersede <successorRecordId> --reject <predecessorRecordId>")}`,
            `${bin("wr backfill")}`,
            `${bin("wr backfill --dry-run")}`,
            `${bin("wr backfill --yes")}`,
            `${bin("wr --help")}`,
        ],
        notes: [
            "Default list/search behavior includes current usable Work Records only: approved, non-archived, non-superseded records.",
            "Use wr search --all or wr list --all for maintenance inspection of draft, pending, superseded, or archived records with warnings.",
            "Use wr read <recordId> to open canonical Markdown by stable ID in a local read-only browser view, independent of file moves; --no-open prints the URL without launching a browser.",
            "Use wr index rebuild to repair or bootstrap only the derived Work Record Mnemoteca collection.",
            "Use wr supersede without an ID to list pending proposals and reasons. Pass a successor ID to choose confirm, reject, or later for each candidate.",
            "The --confirm and --reject forms are mutually exclusive and accept exactly one pending predecessor relation. Later or canceled prompts preserve the proposal.",
            "Backfill asks about each generated supersession proposal even with --yes. Proposal decisions do not change whether backfill succeeded.",
            "Manual create remains deferred to later Work Records slices.",
        ],
        execute: (argv, options) =>
            runWorkRecordsCommand(argv, { ...options, mnemotecaPort: SYSTEM_WORK_RECORD_MNEMOTECA_PORT }),
        surfaces: ["cli"],
    },
    [COMMAND_NAMES.SLEEP]: {
        name: COMMAND_NAMES.SLEEP,
        displayName: "Sleep",
        description: "Safely back up and consolidate memory",
        summary: "Create a session-scoped memory backup, then optimize memory with Engineer.",
        usage: [
            `${bin("sleep")}`,
            `${bin("sleep --help")}`,
        ],
        notes: [
            "Requires mnemoteca binary in PATH.",
            "Creates a verified backup under ~/.wld/sessions before any memory changes.",
            "Starts or switches to Engineer and keeps that Agent active for follow-up questions.",
            "You can also run /sleep directly inside the interactive TUI.",
        ],
        execute: (argv, options) =>
            runSleepCommand(argv, {
                ...options,
                mnemotecaPort: SYSTEM_SLEEP_MNEMOTECA_PORT,
                sessionPort: SYSTEM_INTERACTIVE_SESSION_PORT,
            }),
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
            `${bin("--help <command>")}`,
            `${bin("<command> --help")}`,
        ],
        notes: [],
        execute: runHelpCommand,
        surfaces: ["cli", "slash"],
    },
    [COMMAND_NAMES.VERSION]: {
        name: COMMAND_NAMES.VERSION,
        displayName: "Version",
        description: "Show version and architecture info",
        summary: "Print runwield version and platform architecture.",
        usage: [
            `${bin("--version")}`,
            `${bin("-v")}`,
            `${bin("version")}`,
        ],
        notes: [],
        execute: runVersionCommand,
        surfaces: ["cli", "slash"],
    },
    [COMMAND_NAMES.UPDATE]: {
        name: COMMAND_NAMES.UPDATE,
        aliases: ["upgrade"],
        displayName: "Update",
        description: "Install the latest Stable release",
        summary: "Update RunWield by running the public Stable-channel installer.",
        usage: [
            `${bin("update")}`,
            `${bin("upgrade")}`,
        ],
        notes: [
            "Installs the latest Stable RunWield release; Candidate prereleases are not selected by this command.",
            "When possible, WLD_INSTALL_DIR is set to the current wld binary directory before running install.sh.",
            "Set WLD_INSTALL_DIR yourself to choose a specific installation directory.",
        ],
        execute: (argv, options) =>
            runUpdateCommand(argv, {
                ...options,
                networkPort: SYSTEM_UPDATE_NETWORK_PORT,
                installerPort: SYSTEM_INSTALLER_PROCESS_PORT,
                exitPort: SYSTEM_PROCESS_EXIT_PORT,
            }),
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
            `${bin("init --help")}`,
            "/init",
        ],
        notes: [
            "Runs a one-time agent that explores the codebase and writes docs/domain-language.md.",
            "Safe to run multiple times — subsequent runs in the same directory will warn and exit.",
            "This command is also available as /init inside the interactive TUI.",
        ],
        execute: (argv, options) =>
            options?.sessionRuntime && options.sessionId
                ? runInitCommand(argv, {
                    uiAPI: options.uiAPI,
                    sessionPort: SYSTEM_INTERACTIVE_SESSION_PORT,
                    sessionRuntime: options.sessionRuntime,
                    sessionId: options.sessionId,
                })
                : runInitCommand(argv, {
                    uiAPI: options?.uiAPI,
                    sessionPort: SYSTEM_INTERACTIVE_SESSION_PORT,
                }),
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
        description: "Install a package source",
        summary:
            "Install package themes, prompt templates, and WLD-compatible extensions from npm, git, or local path.",
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
        description: "Remove an installed package source",
        summary: "Uninstall a package source and unregister its resources.",
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
            `${bin("snip-filters")}`,
            `${bin("snip-filters status")}`,
            `${bin("snip-filters install")}`,
            `${bin("snip-filters cleanup")}`,
            `${bin("snip-filters remove")}`,
            `${bin("snip-filters uninstall")}`,
        ],
        notes: [
            "Default action is status.",
            "Install copies RunWield-managed Deno filters into ~/.config/snip/filters so plain Snip commands can find them.",
            "Cleanup/remove/uninstall removes only files marked as RunWield-managed.",
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
    [COMMAND_NAMES.SETTINGS]: {
        name: COMMAND_NAMES.SETTINGS,
        displayName: "Settings",
        description: "Open settings menu",
        summary: "Open the interactive settings menu (compaction, model presets).",
        usage: [
            "/settings",
        ],
        notes: [
            "Slash command only (interactive session).",
            "Exposes compaction settings (auto-compact, reserve tokens, keep-recent tokens) and model preset selection (activeModelPreset).",
        ],
        execute: runSettingsCommand,
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
            "Refreshes memories, RUNWIELD.md, prompt templates, skills, model settings, and themes.",
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
