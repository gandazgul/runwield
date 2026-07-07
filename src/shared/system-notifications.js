/**
 * @module shared/system-notifications
 * Best-effort desktop notifications for RunWield attention events.
 */

import { getMergedCustomSetting } from "./settings.js";
import { formatTerminalTitle } from "../ui/tui/terminal-title.js";

const EVENT_LABELS = {
    agentStopped: "Agent stopped",
    planWritten: "Plan ready",
    userInterview: "Input requested",
};

const EVENT_MESSAGES = {
    agentStopped: "The agent has stopped and is waiting for you.",
    planWritten: "A plan is ready for review or approval.",
    userInterview: "The agent is asking you a question.",
};

/**
 * @typedef {"agentStopped" | "planWritten" | "userInterview"} NotificationEventName
 */

/**
 * @typedef {"tab" | "app" | "none"} NotificationActivationMode
 */

/**
 * @typedef {Object} NotificationEventSettings
 * @property {boolean} [agentStopped]
 * @property {boolean} [planWritten]
 * @property {boolean} [userInterview]
 */

/**
 * @typedef {Object} NotificationSettings
 * @property {boolean} enabled
 * @property {NotificationActivationMode} activation
 * @property {NotificationEventSettings} events
 */

/**
 * @typedef {Object} TerminalIdentity
 * @property {string} sessionLabel
 * @property {string} terminalTitle
 * @property {string} [tty]
 * @property {string} [termProgram]
 * @property {string} [term]
 * @property {string} [itermSessionId]
 * @property {string} [weztermPane]
 * @property {string} [kittyListenOn]
 * @property {string} [kittyWindowId]
 * @property {string} [windowId]
 * @property {number} [pid]
 */

/**
 * @typedef {Object} CommandResult
 * @property {boolean} success
 * @property {string} stdout
 * @property {string} stderr
 */

/**
 * @typedef {Object} CommandSpec
 * @property {string} cmd
 * @property {string[]} args
 */

/**
 * @typedef {Object} SystemNotificationDeps
 * @property {string} [os]
 * @property {Record<string, string | undefined>} [env]
 * @property {number} [pid]
 * @property {(key: string) => unknown} [getMergedCustomSetting]
 * @property {(cmd: string, args?: string[]) => Promise<CommandResult>} [runCommand]
 */

/**
 * @typedef {Object} NotifyRunWieldEventOptions
 * @property {string} [sessionName]
 * @property {string} [agentName]
 * @property {SystemNotificationDeps} [__deps]
 */

/**
 * @typedef {Object} NotificationResult
 * @property {boolean} sent
 * @property {string} reason
 * @property {NotificationEventName} eventName
 * @property {string} title
 * @property {string} message
 * @property {CommandSpec | null} command
 * @property {TerminalIdentity} terminal
 */

const defaultDeps = {
    os: Deno.build.os,
    env: Deno.env.toObject(),
    pid: Deno.pid,
    getMergedCustomSetting,
    runCommand,
};

/**
 * Send a RunWield system notification for an attention event.
 *
 * This helper is intentionally best-effort: callers may await the structured
 * result in tests, but production UI/workflow paths should not fail if the OS,
 * terminal, or notifier command is unavailable.
 *
 * @param {NotificationEventName} eventName
 * @param {NotifyRunWieldEventOptions} [options]
 * @returns {Promise<NotificationResult>}
 */
export async function notifyRunWieldEvent(eventName, options = {}) {
    const deps = mergeDeps(options.__deps);
    const settings = resolveNotificationSettings(deps.getMergedCustomSetting("notifications"));
    const sessionLabel = normalizeLabel(options.sessionName) || "RunWield";
    const terminal = await detectTerminalIdentity(sessionLabel, deps);
    const title = buildNotificationTitle(eventName, terminal, options.agentName);
    const message = buildNotificationMessage(eventName, terminal);

    const baseResult = /** @type {NotificationResult} */ ({
        sent: false,
        reason: "not_sent",
        eventName,
        title,
        message,
        command: null,
        terminal,
    });

    if (!isKnownEvent(eventName)) {
        return { ...baseResult, reason: "unknown_event" };
    }

    if (!settings.enabled) {
        return { ...baseResult, reason: "disabled" };
    }

    if (settings.events[eventName] === false) {
        return { ...baseResult, reason: "event_disabled" };
    }

    const command = await buildNotificationCommand({ eventName, title, message, terminal, settings }, deps);
    if (!command) {
        return { ...baseResult, reason: "unsupported" };
    }

    try {
        const output = await deps.runCommand(command.cmd, command.args);
        return {
            ...baseResult,
            command,
            sent: output.success,
            reason: output.success ? "sent" : "command_failed",
        };
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return { ...baseResult, command, reason: `command_error:${reason}` };
    }
}

/**
 * Fire a notification without letting async failures affect the caller.
 *
 * @param {NotificationEventName} eventName
 * @param {NotifyRunWieldEventOptions} [options]
 */
export function notifyRunWieldEventQuietly(eventName, options = {}) {
    notifyRunWieldEvent(eventName, options).catch(() => {});
}

/**
 * @param {unknown} raw
 * @returns {NotificationSettings}
 */
export function resolveNotificationSettings(raw) {
    const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const record = /** @type {Record<string, unknown>} */ (source);
    const eventsRaw = record.events && typeof record.events === "object" && !Array.isArray(record.events)
        ? /** @type {Record<string, unknown>} */ (record.events)
        : {};

    return {
        enabled: record.enabled !== false,
        activation: normalizeActivation(record.activation),
        events: {
            agentStopped: eventsRaw.agentStopped !== false,
            planWritten: eventsRaw.planWritten !== false,
            userInterview: eventsRaw.userInterview !== false,
        },
    };
}

/**
 * @param {string} sessionLabel
 * @param {Required<SystemNotificationDeps>} deps
 * @returns {Promise<TerminalIdentity>}
 */
export async function detectTerminalIdentity(sessionLabel, deps = defaultDeps) {
    const env = deps.env || {};
    const terminalTitle = formatTerminalTitle(sessionLabel);
    const tty = await readTty(deps);
    return {
        sessionLabel,
        terminalTitle,
        tty: tty || undefined,
        termProgram: env.TERM_PROGRAM || undefined,
        term: env.TERM || undefined,
        itermSessionId: env.ITERM_SESSION_ID || undefined,
        weztermPane: env.WEZTERM_PANE || undefined,
        kittyListenOn: env.KITTY_LISTEN_ON || undefined,
        kittyWindowId: env.KITTY_WINDOW_ID || undefined,
        windowId: env.WINDOWID || undefined,
        pid: deps.pid,
    };
}

/**
 * @param {{ eventName: NotificationEventName, title: string, message: string, terminal: TerminalIdentity, settings: NotificationSettings }} options
 * @param {Required<SystemNotificationDeps>} deps
 * @returns {Promise<CommandSpec | null>}
 */
export async function buildNotificationCommand(options, deps = defaultDeps) {
    if (deps.os !== "darwin") return null;

    const activationCommand = buildActivationCommand(options.terminal, options.settings.activation);
    if (activationCommand && await commandExists("terminal-notifier", deps)) {
        return {
            cmd: "terminal-notifier",
            args: [
                "-title",
                options.title,
                "-message",
                options.message,
                "-group",
                `runwield-${options.eventName}`,
                "-execute",
                activationCommand,
            ],
        };
    }

    if (await commandExists("osascript", deps)) {
        return {
            cmd: "osascript",
            args: [
                "-e",
                `display notification ${appleScriptString(options.message)} with title ${
                    appleScriptString(options.title)
                }`,
            ],
        };
    }

    return null;
}

/**
 * @param {TerminalIdentity} terminal
 * @param {NotificationActivationMode} activation
 * @returns {string | null}
 */
export function buildActivationCommand(terminal, activation = "tab") {
    if (activation === "none") return null;
    if (activation === "tab") {
        const exact = buildExactActivationCommand(terminal);
        if (exact) return exact;
    }

    const appName = inferTerminalApplication(terminal);
    if (!appName) return null;
    return `osascript -e ${shellQuote(`tell application ${appleScriptString(appName)} to activate`)}`;
}

/**
 * @param {TerminalIdentity} terminal
 * @returns {string | null}
 */
export function buildExactActivationCommand(terminal) {
    if (terminal.weztermPane) {
        return `wezterm cli activate-pane --pane-id ${shellQuote(terminal.weztermPane)}`;
    }

    if (isKitty(terminal) && terminal.kittyListenOn && terminal.kittyWindowId) {
        return `kitty @ --to ${shellQuote(terminal.kittyListenOn)} focus-window --match ${
            shellQuote(`id:${terminal.kittyWindowId}`)
        }`;
    }

    if (isITerm(terminal) && terminal.tty) {
        return osascriptCommand(buildITermActivationScript(terminal.tty));
    }

    if (isAppleTerminal(terminal) && terminal.tty) {
        return osascriptCommand(buildAppleTerminalActivationScript(terminal.tty));
    }

    return null;
}

/**
 * @param {TerminalIdentity} terminal
 * @returns {string | null}
 */
export function inferTerminalApplication(terminal) {
    if (isITerm(terminal)) return "iTerm2";
    if (isAppleTerminal(terminal)) return "Terminal";
    if (terminal.weztermPane || terminal.termProgram === "WezTerm") return "WezTerm";
    if (isKitty(terminal)) return "kitty";
    return null;
}

/**
 * @param {string} tty
 * @returns {string}
 */
export function buildAppleTerminalActivationScript(tty) {
    return `tell application "Terminal"
activate
repeat with w in windows
repeat with t in tabs of w
if tty of t is ${appleScriptString(tty)} then
set selected of t to true
set index of w to 1
return
end if
end repeat
end repeat
end tell`;
}

/**
 * @param {string} tty
 * @returns {string}
 */
export function buildITermActivationScript(tty) {
    return `tell application "iTerm2"
activate
repeat with w in windows
repeat with t in tabs of w
repeat with s in sessions of t
if tty of s is ${appleScriptString(tty)} then
select w
select t
select s
return
end if
end repeat
end repeat
end repeat
end tell`;
}

/**
 * @param {string} value
 * @returns {string}
 */
export function shellQuote(value) {
    return `'${String(value).replaceAll("'", "'\\''")}'`;
}

/**
 * @param {string} value
 * @returns {string}
 */
export function appleScriptString(value) {
    return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/**
 * @param {string} script
 * @returns {string}
 */
function osascriptCommand(script) {
    return `osascript -e ${shellQuote(script)}`;
}

/**
 * @param {string} cmd
 * @param {Required<SystemNotificationDeps>} deps
 * @returns {Promise<boolean>}
 */
async function commandExists(cmd, deps) {
    try {
        const result = await deps.runCommand("command", ["-v", cmd]);
        return result.success;
    } catch {
        return false;
    }
}

/**
 * @param {Required<SystemNotificationDeps>} deps
 * @returns {Promise<string>}
 */
async function readTty(deps) {
    try {
        const result = await deps.runCommand("tty", []);
        if (!result.success) return "";
        const tty = result.stdout.trim();
        return tty === "not a tty" ? "" : tty;
    } catch {
        return "";
    }
}

/**
 * @param {string} cmd
 * @param {string[]} [args]
 * @returns {Promise<CommandResult>}
 */
async function runCommand(cmd, args = []) {
    const actualCmd = cmd === "command" ? "sh" : cmd;
    const actualArgs = cmd === "command" ? ["-c", ["command", ...(args || [])].map(shellQuote).join(" ")] : args;
    const command = new Deno.Command(actualCmd, { args: actualArgs, stdout: "piped", stderr: "piped" });
    const { success, stdout, stderr } = await command.output();
    return {
        success,
        stdout: new TextDecoder().decode(stdout),
        stderr: new TextDecoder().decode(stderr),
    };
}

/**
 * @param {SystemNotificationDeps | undefined} overrides
 * @returns {Required<SystemNotificationDeps>}
 */
function mergeDeps(overrides) {
    return {
        os: overrides?.os || defaultDeps.os,
        env: overrides?.env || defaultDeps.env,
        pid: overrides?.pid || defaultDeps.pid,
        getMergedCustomSetting: overrides?.getMergedCustomSetting || defaultDeps.getMergedCustomSetting,
        runCommand: overrides?.runCommand || defaultDeps.runCommand,
    };
}

/**
 * @param {unknown} value
 * @returns {NotificationActivationMode}
 */
function normalizeActivation(value) {
    return value === "app" || value === "none" || value === "tab" ? value : "tab";
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeLabel(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

/**
 * @param {unknown} eventName
 * @returns {eventName is NotificationEventName}
 */
function isKnownEvent(eventName) {
    return eventName === "agentStopped" || eventName === "planWritten" || eventName === "userInterview";
}

/**
 * @param {NotificationEventName} eventName
 * @param {TerminalIdentity} terminal
 * @param {string | undefined} agentName
 * @returns {string}
 */
function buildNotificationTitle(eventName, terminal, agentName) {
    const label = EVENT_LABELS[eventName] || "Attention needed";
    const agentPrefix = agentName ? `${agentName}: ` : "";
    return `${agentPrefix}${label} — ${terminal.sessionLabel}`;
}

/**
 * @param {NotificationEventName} eventName
 * @param {TerminalIdentity} terminal
 * @returns {string}
 */
function buildNotificationMessage(eventName, terminal) {
    const base = EVENT_MESSAGES[eventName] || "RunWield needs your attention.";
    return `${base}\nSession: ${terminal.terminalTitle}`;
}

/** @param {TerminalIdentity} terminal */
function isITerm(terminal) {
    return terminal.termProgram === "iTerm.app" || terminal.termProgram === "iTerm2" || !!terminal.itermSessionId;
}

/** @param {TerminalIdentity} terminal */
function isAppleTerminal(terminal) {
    return terminal.termProgram === "Apple_Terminal";
}

/** @param {TerminalIdentity} terminal */
function isKitty(terminal) {
    return terminal.termProgram === "kitty" || terminal.term === "xterm-kitty" || !!terminal.kittyListenOn;
}
