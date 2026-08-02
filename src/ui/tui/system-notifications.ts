/**
 * @module ui/tui/system-notifications
 * Best-effort terminal bell and native terminal OSC notifications for TUI attention events.
 */

import { getMergedCustomSetting } from "../../shared/settings.js";
import { formatSessionTerminalTitle } from "../../shared/session/session-name.js";
import { getCurrentTerminalFocusState, type TerminalFocusState } from "./terminal-focus-state.ts";

const EVENT_LABELS = {
    agentStopped: "Agent stopped",
    planWritten: "Plan ready",
    userInterview: "Input requested",
    compactionFinished: "Compaction finished",
} as const;

const EVENT_MESSAGES = {
    agentStopped: "The agent has stopped and is waiting for you.",
    planWritten: "A plan is ready for review or approval.",
    userInterview: "The agent is asking you a question.",
    compactionFinished: "The /compact command finished. Return to view the result.",
} as const;

const TERMINAL_BELL_BYTES = new Uint8Array([7]);
const TEXT_ENCODER = new TextEncoder();

type NotificationEventName = keyof typeof EVENT_LABELS;
type NotificationActivationMode = "tab" | "app" | "none";
export type NativeNotificationProtocol = "osc99" | "osc777" | "osc9" | "unsupported";

type NotificationEventSettings = Partial<Record<NotificationEventName, boolean>>;

export interface NotificationSettings {
    enabled: boolean;
    activation: NotificationActivationMode;
    events: Record<NotificationEventName, boolean>;
    terminalBell: boolean;
    suppressWhenFocused: boolean;
}

export interface TerminalIdentity {
    sessionLabel: string;
    terminalTitle: string;
    termProgram?: string;
    term?: string;
    itermSessionId?: string;
    weztermPane?: string;
    kittyListenOn?: string;
    kittyWindowId?: string;
    windowId?: string;
    pid?: number;
}

export interface SystemNotificationPort {
    readEnvironment(): Record<string, string | undefined>;
    getProcessId(): number;
    readNotificationSetting(): ReturnType<typeof getMergedCustomSetting>;
    writeTerminal(bytes: Uint8Array): void;
}

interface NotifyRunWieldEventOptions {
    sessionName?: string;
    agentName?: string;
}

export type RunWieldEventNotifier = (
    eventName: string,
    options?: NotifyRunWieldEventOptions,
) => Promise<NotificationResult>;

export interface NotificationResult {
    sent: boolean;
    reason: string;
    eventName: string;
    title: string;
    message: string;
    protocol: NativeNotificationProtocol;
    terminal: TerminalIdentity;
    terminalBellEmitted: boolean;
    oscEmitted: boolean;
}

interface TerminalProcessSnapshot {
    env: Record<string, string | undefined>;
    pid: number;
}

function writeTerminal(bytes: Uint8Array): void {
    Deno.stdout.writeSync(bytes);
}

const systemNotificationPort: SystemNotificationPort = {
    readEnvironment: () => Deno.env.toObject(),
    getProcessId: () => Deno.pid,
    readNotificationSetting: () => getMergedCustomSetting("notifications"),
    writeTerminal,
};

export function createSystemNotificationNotifier(port: SystemNotificationPort): RunWieldEventNotifier {
    return async (eventName: string, options: NotifyRunWieldEventOptions = {}): Promise<NotificationResult> => {
        await Promise.resolve();
        const env = port.readEnvironment();
        const settings = resolveNotificationSettings(port.readNotificationSetting());
        const sessionLabel = normalizeLabel(options.sessionName) || "RunWield";
        const initialTerminal = {
            sessionLabel,
            terminalTitle: formatSessionTerminalTitle(sessionLabel),
        } satisfies TerminalIdentity;
        const initialTitle = buildNotificationTitle(eventName, initialTerminal, options.agentName);
        const initialMessage = buildNotificationMessage(eventName, initialTerminal);
        const baseResult = {
            sent: false,
            reason: "not_sent",
            eventName,
            title: initialTitle,
            message: initialMessage,
            protocol: "unsupported",
            terminal: initialTerminal,
            terminalBellEmitted: false,
            oscEmitted: false,
        } satisfies NotificationResult;

        if (!isKnownEvent(eventName)) {
            return { ...baseResult, reason: "unknown_event" };
        }

        if (env.WLD_GOLDEN_TUI || env.WLD_GOLDEN_TUI_CHILD) {
            return { ...baseResult, reason: "golden_tui" };
        }

        if (!settings.enabled) {
            return { ...baseResult, reason: "disabled" };
        }

        if (settings.events[eventName] === false) {
            return { ...baseResult, reason: "event_disabled" };
        }

        const focusState = getCurrentTerminalFocusState();
        if (shouldSuppressAttentionNotification(settings, focusState)) {
            return { ...baseResult, reason: "focused" };
        }

        const terminal = detectTerminalIdentity(sessionLabel, { env, pid: port.getProcessId() });
        const title = buildNotificationTitle(eventName, terminal, options.agentName);
        const message = buildNotificationMessage(eventName, terminal);
        const protocol = selectNativeNotificationProtocol(terminal);
        const terminalBellEmitted = settings.terminalBell ? emitTerminalBell(port) : false;
        const oscEmitted = protocol === "unsupported" ? false : emitNativeNotification(protocol, title, message, port);

        return {
            ...baseResult,
            sent: oscEmitted,
            reason: oscEmitted ? "sent" : protocol === "unsupported" ? "unsupported" : "write_failed",
            title,
            message,
            protocol,
            terminal,
            terminalBellEmitted,
            oscEmitted,
        };
    };
}

export const notifyRunWieldEvent = createSystemNotificationNotifier(systemNotificationPort);

export function notifyRunWieldEventQuietly(eventName: string, options: NotifyRunWieldEventOptions = {}): void {
    notifyRunWieldEvent(eventName, options).catch(() => {});
}

export function resolveNotificationSettings(raw: ReturnType<typeof getMergedCustomSetting>): NotificationSettings {
    const record = raw && typeof raw === "object" && !Array.isArray(raw)
        ? raw as Record<string, boolean | string | NotificationEventSettings>
        : {};
    const eventsRaw = record.events && typeof record.events === "object" && !Array.isArray(record.events)
        ? record.events as NotificationEventSettings
        : {};

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
        suppressWhenFocused: record.suppressWhenFocused !== false,
    };
}

export function detectTerminalIdentity(
    sessionLabel: string,
    process: TerminalProcessSnapshot,
): TerminalIdentity {
    const env = process.env;
    const terminalTitle = formatSessionTerminalTitle(sessionLabel);
    return {
        sessionLabel,
        terminalTitle,
        termProgram: env.TERM_PROGRAM || undefined,
        term: env.TERM || undefined,
        itermSessionId: env.ITERM_SESSION_ID || undefined,
        weztermPane: env.WEZTERM_PANE || undefined,
        kittyListenOn: env.KITTY_LISTEN_ON || undefined,
        kittyWindowId: env.KITTY_WINDOW_ID || undefined,
        windowId: env.WINDOWID || undefined,
        pid: process.pid,
    };
}

export function selectNativeNotificationProtocol(terminal: TerminalIdentity): NativeNotificationProtocol {
    if (isKitty(terminal)) return "osc99";
    if (isWezTerm(terminal) || isGhostty(terminal)) return "osc777";
    if (isITerm(terminal)) return "osc9";
    return "unsupported";
}

export function shouldSuppressAttentionNotification(
    settings: Pick<NotificationSettings, "suppressWhenFocused">,
    focusState: TerminalFocusState,
): boolean {
    return settings.suppressWhenFocused && focusState === "focused";
}

export function buildNativeNotificationSequence(
    protocol: NativeNotificationProtocol,
    title: string,
    message: string,
): string | null {
    if (protocol === "osc99") {
        const titleSequence = `\x1b]99;i=runwield:d=0:e=1:o=unfocused:p=title;${base64(title)}\x1b\\`;
        const bodySequence = `\x1b]99;i=runwield:d=1:e=1:o=unfocused:p=body;${base64(message)}\x1b\\`;
        return titleSequence + bodySequence;
    }
    if (protocol === "osc777") {
        return `\x1b]777;notify;${sanitizeOscField(title)};${sanitizeOscField(message)}\x07`;
    }
    if (protocol === "osc9") {
        return `\x1b]9;${sanitizeOscField(`${title}: ${message}`)}\x07`;
    }
    return null;
}

function emitNativeNotification(
    protocol: NativeNotificationProtocol,
    title: string,
    message: string,
    terminal: Pick<SystemNotificationPort, "writeTerminal">,
): boolean {
    const sequence = buildNativeNotificationSequence(protocol, title, message);
    if (!sequence) return false;
    try {
        terminal.writeTerminal(TEXT_ENCODER.encode(sequence));
        return true;
    } catch {
        return false;
    }
}

function emitTerminalBell(terminal: Pick<SystemNotificationPort, "writeTerminal">): boolean {
    try {
        terminal.writeTerminal(TERMINAL_BELL_BYTES);
        return true;
    } catch {
        return false;
    }
}

function normalizeActivation(
    value: string | boolean | NotificationEventSettings | undefined,
): NotificationActivationMode {
    return value === "app" || value === "none" || value === "tab" ? value : "tab";
}

function normalizeLabel(value: string | undefined): string {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function isKnownEvent(eventName: string): eventName is NotificationEventName {
    return eventName === "agentStopped" || eventName === "planWritten" || eventName === "userInterview" ||
        eventName === "compactionFinished";
}

function buildNotificationTitle(eventName: string, terminal: TerminalIdentity, agentName: string | undefined): string {
    const label = isKnownEvent(eventName) ? EVENT_LABELS[eventName] : "Attention needed";
    const agentPrefix = agentName ? `${agentName}: ` : "";
    return `${agentPrefix}${label} — ${terminal.sessionLabel}`;
}

function buildNotificationMessage(eventName: string, terminal: TerminalIdentity): string {
    const base = isKnownEvent(eventName) ? EVENT_MESSAGES[eventName] : "RunWield needs your attention.";
    return `${base}\nSession: ${terminal.terminalTitle}`;
}

function sanitizeOscField(value: string): string {
    const normalized = String(value).replaceAll("\x1b\\", " ");
    let sanitized = "";
    for (const char of normalized) {
        const code = char.charCodeAt(0);
        sanitized += code < 32 || code === 127 || char === ";" ? " " : char;
    }
    return sanitized.replace(/\s+/g, " ").trim();
}

function base64(value: string): string {
    return btoa(unescape(encodeURIComponent(value)));
}

function isITerm(terminal: TerminalIdentity): boolean {
    return terminal.termProgram === "iTerm.app" || terminal.termProgram === "iTerm2" || !!terminal.itermSessionId;
}

function isWezTerm(terminal: TerminalIdentity): boolean {
    return terminal.termProgram === "WezTerm" || !!terminal.weztermPane;
}

function isKitty(terminal: TerminalIdentity): boolean {
    return terminal.termProgram === "kitty" || terminal.termProgram === "Kitty" || terminal.term === "xterm-kitty" ||
        !!terminal.kittyListenOn || !!terminal.kittyWindowId;
}

function isGhostty(terminal: TerminalIdentity): boolean {
    return terminal.termProgram === "ghostty" || terminal.termProgram === "Ghostty" ||
        terminal.term === "xterm-ghostty";
}
