/**
 * @module ui/tui/system-notifications
 * Best-effort terminal bell and desktop notifications for TUI attention events.
 */

import { getCwd } from "../../constants.js";
import { getMergedCustomSetting } from "../../shared/settings.js";
import { formatSessionTerminalTitle } from "../../shared/session/session-name.js";

export type NotificationEventName = "agentStopped" | "planWritten" | "userInterview" | "compactionFinished";
export type NotificationActivationMode = "tab" | "app" | "none";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

interface NotificationEventSettings {
    agentStopped?: boolean;
    planWritten?: boolean;
    userInterview?: boolean;
    compactionFinished?: boolean;
}

export interface NotificationSettings {
    enabled: boolean;
    activation: NotificationActivationMode;
    events: NotificationEventSettings;
    terminalBell: boolean;
}

export interface TerminalIdentity {
    sessionLabel: string;
    terminalTitle: string;
    tty?: string;
    termProgram?: string;
    term?: string;
    itermSessionId?: string;
    weztermPane?: string;
    kittyListenOn?: string;
    kittyWindowId?: string;
    windowId?: string;
    pid?: number;
}

export interface CommandResult {
    success: boolean;
    stdout: string;
    stderr: string;
}

export interface CommandSpec {
    cmd: string;
    args: string[];
}

/** The operating-system boundary used for process, terminal, and environment interaction. */
export interface NotificationSystemPort {
    readonly os: string;
    readonly env: Record<string, string | undefined>;
    readonly pid: number;
    runCommand(cmd: string, args?: string[]): Promise<CommandResult>;
    writeTerminal(bytes: Uint8Array): void;
}

interface NotifyRunWieldEventOptions {
    sessionName?: string;
    agentName?: string;
    port?: NotificationSystemPort;
}

export interface NotificationResult {
    sent: boolean;
    reason: string;
    eventName: string;
    title: string;
    message: string;
    command: CommandSpec | null;
    terminal: TerminalIdentity;
    terminalBellEmitted: boolean;
}

interface NotificationCommandOptions {
    eventName: NotificationEventName;
    title: string;
    message: string;
    terminal: TerminalIdentity;
    settings: NotificationSettings;
}

const EVENT_LABELS: Record<NotificationEventName, string> = {
    agentStopped: "Agent stopped",
    planWritten: "Plan ready",
    userInterview: "Input requested",
    compactionFinished: "Compaction finished",
};

const EVENT_MESSAGES: Record<NotificationEventName, string> = {
    agentStopped: "The agent has stopped and is waiting for you.",
    planWritten: "A plan is ready for review or approval.",
    userInterview: "The agent is asking you a question.",
    compactionFinished: "The /compact command finished. Return to view the result.",
};

const TERMINAL_NOTIFIER_FALLBACK_REASON = "terminal_notifier_failed";
const TERMINAL_BELL_BYTES = new Uint8Array([7]);

function writeTerminal(bytes: Uint8Array): void {
    Deno.stdout.writeSync(bytes);
}

const DEFAULT_NOTIFICATION_SYSTEM_PORT: NotificationSystemPort = {
    os: Deno.build.os,
    // Read live rather than snapshotting at import time: the Golden TUI child
    // process sets its isolation env after this module is already loaded.
    get env() {
        return Deno.env.toObject();
    },
    pid: Deno.pid,
    runCommand,
    writeTerminal,
};

/** Send a best-effort RunWield notification for an attention event. */
export async function notifyRunWieldEvent(
    eventName: string,
    options: NotifyRunWieldEventOptions = {},
): Promise<NotificationResult> {
    const port = options.port || DEFAULT_NOTIFICATION_SYSTEM_PORT;
    const settings = resolveNotificationSettings(getMergedCustomSetting("notifications", getCwd()));
    const sessionLabel = normalizeLabel(options.sessionName) || "RunWield";
    const initialTerminal = {
        sessionLabel,
        terminalTitle: formatSessionTerminalTitle(sessionLabel),
    };
    const initialTitle = buildNotificationTitle(eventName, initialTerminal, options.agentName);
    const initialMessage = buildNotificationMessage(eventName, initialTerminal);

    const baseResult: NotificationResult = {
        sent: false,
        reason: "not_sent",
        eventName,
        title: initialTitle,
        message: initialMessage,
        command: null,
        terminal: initialTerminal,
        terminalBellEmitted: false,
    };

    if (!isKnownEvent(eventName)) return { ...baseResult, reason: "unknown_event" };

    // Golden TUI scenarios compose the production TUI, so they reach this notifier
    // with production wiring. A test run must never reach the developer's
    // Notification Center, regardless of the fixture settings.
    if (port.env.WLD_GOLDEN_TUI || port.env.WLD_GOLDEN_TUI_CHILD) {
        return { ...baseResult, reason: "golden_tui" };
    }

    if (!settings.enabled) return { ...baseResult, reason: "disabled" };
    if (settings.events[eventName] === false) return { ...baseResult, reason: "event_disabled" };

    const terminalBellEmitted = settings.terminalBell ? emitTerminalBell(port) : false;
    const terminal = await detectTerminalIdentity(sessionLabel, port);
    const title = buildNotificationTitle(eventName, terminal, options.agentName);
    const message = buildNotificationMessage(eventName, terminal);
    const enabledResult: NotificationResult = {
        ...baseResult,
        title,
        message,
        terminal,
        terminalBellEmitted,
    };

    const command = await buildNotificationCommand({ eventName, title, message, terminal, settings }, port);
    if (!command) return { ...enabledResult, reason: "unsupported" };

    try {
        const output = await port.runCommand(command.cmd, command.args);
        if (output.success) return { ...enabledResult, command, sent: true, reason: "sent" };

        const fallbackCommand = await buildOsascriptNotificationCommand({ title, message }, port);
        if (fallbackCommand && command.cmd === "terminal-notifier") {
            const fallbackOutput = await port.runCommand(fallbackCommand.cmd, fallbackCommand.args);
            return {
                ...enabledResult,
                command: fallbackCommand,
                sent: fallbackOutput.success,
                reason: fallbackOutput.success ? `sent:${TERMINAL_NOTIFIER_FALLBACK_REASON}` : "command_failed",
            };
        }

        return { ...enabledResult, command, sent: false, reason: "command_failed" };
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return { ...enabledResult, command, reason: `command_error:${reason}` };
    }
}

/** Fire a notification without letting async failures affect the caller. */
export function notifyRunWieldEventQuietly(eventName: string, options: NotifyRunWieldEventOptions = {}): void {
    notifyRunWieldEvent(eventName, options).catch(() => {});
}

export function resolveNotificationSettings(raw: JsonValue | undefined): NotificationSettings {
    const record = isJsonRecord(raw) ? raw : {};
    const eventsRaw = isJsonRecord(record.events) ? record.events : {};
    return {
        enabled: record.enabled !== false,
        activation: normalizeActivation(record.activation),
        events: {
            agentStopped: eventsRaw.agentStopped !== false,
            planWritten: eventsRaw.planWritten !== false,
            userInterview: eventsRaw.userInterview !== false,
            compactionFinished: eventsRaw.compactionFinished !== false,
        },
        terminalBell: record.terminalBell !== false,
    };
}

export async function detectTerminalIdentity(
    sessionLabel: string,
    port: NotificationSystemPort = DEFAULT_NOTIFICATION_SYSTEM_PORT,
): Promise<TerminalIdentity> {
    const terminalTitle = formatSessionTerminalTitle(sessionLabel);
    const tty = await readTty(port);
    return {
        sessionLabel,
        terminalTitle,
        tty: tty || undefined,
        termProgram: port.env.TERM_PROGRAM || undefined,
        term: port.env.TERM || undefined,
        itermSessionId: port.env.ITERM_SESSION_ID || undefined,
        weztermPane: port.env.WEZTERM_PANE || undefined,
        kittyListenOn: port.env.KITTY_LISTEN_ON || undefined,
        kittyWindowId: port.env.KITTY_WINDOW_ID || undefined,
        windowId: port.env.WINDOWID || undefined,
        pid: port.pid,
    };
}

export async function buildNotificationCommand(
    options: NotificationCommandOptions,
    port: NotificationSystemPort = DEFAULT_NOTIFICATION_SYSTEM_PORT,
): Promise<CommandSpec | null> {
    if (port.os !== "darwin") return null;

    if (await commandExists("terminal-notifier", port)) {
        const activationCommand = buildActivationCommand(options.terminal, options.settings.activation);
        const senderBundleId = inferTerminalSenderBundleId(options.terminal);
        return {
            cmd: "terminal-notifier",
            args: [
                "-title",
                options.title,
                "-message",
                options.message,
                "-group",
                buildNotificationGroup(options.eventName, options.terminal),
                ...(activationCommand ? ["-execute", activationCommand] : []),
                ...(senderBundleId ? ["-sender", senderBundleId] : []),
            ],
        };
    }

    return await buildOsascriptNotificationCommand({ title: options.title, message: options.message }, port);
}

function buildNotificationGroup(eventName: NotificationEventName, terminal: TerminalIdentity): string {
    const sessionKey = normalizeLabel(terminal.sessionLabel || terminal.terminalTitle || "RunWield")
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "") || "runwield";
    return `runwield-${eventName}-${sessionKey}`;
}

async function buildOsascriptNotificationCommand(
    options: { title: string; message: string },
    port: NotificationSystemPort,
): Promise<CommandSpec | null> {
    if (port.os !== "darwin") return null;
    if (!await commandExists("osascript", port)) return null;
    return {
        cmd: "osascript",
        args: [
            "-e",
            `display notification ${appleScriptString(options.message)} with title ${appleScriptString(options.title)}`,
        ],
    };
}

export function buildActivationCommand(
    terminal: TerminalIdentity,
    activation: NotificationActivationMode = "tab",
): string | null {
    if (activation === "none") return null;
    if (activation === "tab") {
        const exact = buildExactActivationCommand(terminal);
        if (exact) return exact;
    }
    const appName = inferTerminalApplication(terminal);
    if (!appName) return null;
    return `osascript -e ${shellQuote(`tell application ${appleScriptString(appName)} to activate`)}`;
}

export function buildExactActivationCommand(terminal: TerminalIdentity): string | null {
    if (terminal.weztermPane) return `wezterm cli activate-pane --pane-id ${shellQuote(terminal.weztermPane)}`;
    if (isKitty(terminal) && terminal.kittyListenOn && terminal.kittyWindowId) {
        return `kitty @ --to ${shellQuote(terminal.kittyListenOn)} focus-window --match ${
            shellQuote(`id:${terminal.kittyWindowId}`)
        }`;
    }
    if (isITerm(terminal) && terminal.tty) return osascriptCommand(buildITermActivationScript(terminal.tty));
    if (isAppleTerminal(terminal) && terminal.tty) {
        return osascriptCommand(buildAppleTerminalActivationScript(terminal.tty));
    }
    return null;
}

export function inferTerminalApplication(terminal: TerminalIdentity): string | null {
    if (isITerm(terminal)) return "iTerm2";
    if (isAppleTerminal(terminal)) return "Terminal";
    if (terminal.weztermPane || terminal.termProgram === "WezTerm") return "WezTerm";
    if (isKitty(terminal)) return "kitty";
    if (isGhostty(terminal)) return "Ghostty";
    return null;
}

export function inferTerminalSenderBundleId(terminal: TerminalIdentity): string | null {
    if (isITerm(terminal)) return "com.googlecode.iterm2";
    if (isAppleTerminal(terminal)) return "com.apple.Terminal";
    if (isGhostty(terminal)) return "com.mitchellh.ghostty";
    return null;
}

export function buildAppleTerminalActivationScript(tty: string): string {
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

export function buildITermActivationScript(tty: string): string {
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

export function shellQuote(value: string): string {
    return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export function appleScriptString(value: string): string {
    return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function osascriptCommand(script: string): string {
    return `osascript -e ${shellQuote(script)}`;
}

async function commandExists(cmd: string, port: NotificationSystemPort): Promise<boolean> {
    try {
        const result = await port.runCommand("command", ["-v", cmd]);
        return result.success;
    } catch {
        return false;
    }
}

async function readTty(port: NotificationSystemPort): Promise<string> {
    try {
        const result = await port.runCommand("tty", []);
        if (!result.success) return "";
        const tty = result.stdout.trim();
        return tty === "not a tty" ? "" : tty;
    } catch {
        return "";
    }
}

function emitTerminalBell(port: NotificationSystemPort): boolean {
    try {
        port.writeTerminal(TERMINAL_BELL_BYTES);
        return true;
    } catch {
        return false;
    }
}

async function runCommand(cmd: string, args: string[] = []): Promise<CommandResult> {
    const actualCmd = cmd === "command" ? "sh" : cmd;
    const actualArgs = cmd === "command" ? ["-c", ["command", ...args].map(shellQuote).join(" ")] : args;
    const command = new Deno.Command(actualCmd, { args: actualArgs, stdout: "piped", stderr: "piped" });
    const { success, stdout, stderr } = await command.output();
    return {
        success,
        stdout: new TextDecoder().decode(stdout),
        stderr: new TextDecoder().decode(stderr),
    };
}

function normalizeActivation(value: JsonValue | undefined): NotificationActivationMode {
    return value === "app" || value === "none" || value === "tab" ? value : "tab";
}

function normalizeLabel(value: string | null | undefined): string {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function isKnownEvent(eventName: string): eventName is NotificationEventName {
    return eventName === "agentStopped" || eventName === "planWritten" || eventName === "userInterview" ||
        eventName === "compactionFinished";
}

function buildNotificationTitle(eventName: string, terminal: TerminalIdentity, agentName?: string): string {
    const label = isKnownEvent(eventName) ? EVENT_LABELS[eventName] : "Attention needed";
    const agentPrefix = agentName ? `${agentName}: ` : "";
    return `${agentPrefix}${label} — ${terminal.sessionLabel}`;
}

function buildNotificationMessage(eventName: string, terminal: TerminalIdentity): string {
    const base = isKnownEvent(eventName) ? EVENT_MESSAGES[eventName] : "RunWield needs your attention.";
    return `${base}\nSession: ${terminal.terminalTitle}`;
}

function isJsonRecord(value: JsonValue | undefined): value is { [key: string]: JsonValue } {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isITerm(terminal: TerminalIdentity): boolean {
    return terminal.termProgram === "iTerm.app" || terminal.termProgram === "iTerm2" || !!terminal.itermSessionId;
}

function isAppleTerminal(terminal: TerminalIdentity): boolean {
    return terminal.termProgram === "Apple_Terminal";
}

function isKitty(terminal: TerminalIdentity): boolean {
    return terminal.termProgram === "kitty" || terminal.term === "xterm-kitty" || !!terminal.kittyListenOn;
}

function isGhostty(terminal: TerminalIdentity): boolean {
    return terminal.termProgram === "ghostty" || terminal.term === "xterm-ghostty";
}
