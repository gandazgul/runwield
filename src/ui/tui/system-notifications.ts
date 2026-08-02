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

interface SystemNotificationDeps {
    env?: Record<string, string | undefined>;
    pid?: number;
    getMergedCustomSetting?: (key: string) => NonNullable<ReturnType<typeof getMergedCustomSetting>> | undefined;
    writeTerminal?: (bytes: Uint8Array) => void;
    getTerminalFocusState?: () => TerminalFocusState;
}

interface NotifyRunWieldEventOptions {
    sessionName?: string;
    agentName?: string;
    terminalFocusState?: TerminalFocusState;
    __deps?: SystemNotificationDeps;
}

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

interface RequiredSystemNotificationDeps {
    env: Record<string, string | undefined>;
    pid: number;
    getMergedCustomSetting: (key: string) => NonNullable<ReturnType<typeof getMergedCustomSetting>> | undefined;
    writeTerminal: (bytes: Uint8Array) => void;
    getTerminalFocusState: () => TerminalFocusState;
}

function writeTerminal(bytes: Uint8Array): void {
    Deno.stdout.writeSync(bytes);
}

const defaultDeps = {
    get env(): Record<string, string | undefined> {
        return Deno.env.toObject();
    },
    pid: Deno.pid,
    getMergedCustomSetting,
    writeTerminal,
    getTerminalFocusState: getCurrentTerminalFocusState,
};

export async function notifyRunWieldEvent(
    eventName: string,
    options: NotifyRunWieldEventOptions = {},
): Promise<NotificationResult> {
    await Promise.resolve();
    const deps = mergeDeps(options.__deps);
    const settings = resolveNotificationSettings(deps.getMergedCustomSetting("notifications"));
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

    if (deps.env.WLD_GOLDEN_TUI || deps.env.WLD_GOLDEN_TUI_CHILD) {
        return { ...baseResult, reason: "golden_tui" };
    }

    if (!settings.enabled) {
        return { ...baseResult, reason: "disabled" };
    }

    if (settings.events[eventName] === false) {
        return { ...baseResult, reason: "event_disabled" };
    }

    const focusState = options.terminalFocusState ?? deps.getTerminalFocusState();
    if (shouldSuppressAttentionNotification(settings, focusState)) {
        return { ...baseResult, reason: "focused" };
    }

    const terminal = detectTerminalIdentity(sessionLabel, deps);
    const title = buildNotificationTitle(eventName, terminal, options.agentName);
    const message = buildNotificationMessage(eventName, terminal);
    const protocol = selectNativeNotificationProtocol(terminal);
    const terminalBellEmitted = settings.terminalBell ? emitTerminalBell(deps) : false;
    const oscEmitted = protocol === "unsupported" ? false : emitNativeNotification(protocol, title, message, deps);

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
}

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
    deps: Pick<RequiredSystemNotificationDeps, "env" | "pid"> = defaultDeps,
): TerminalIdentity {
    const env = deps.env || {};
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
        pid: deps.pid,
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
        return `\x1b]99;i=runwield:d=0:o=unfocused:${base64Url(title)};${base64Url(message)}\x1b\\`;
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
    deps: RequiredSystemNotificationDeps,
): boolean {
    const sequence = buildNativeNotificationSequence(protocol, title, message);
    if (!sequence) return false;
    try {
        deps.writeTerminal(TEXT_ENCODER.encode(sequence));
        return true;
    } catch {
        return false;
    }
}

function emitTerminalBell(deps: RequiredSystemNotificationDeps): boolean {
    try {
        deps.writeTerminal(TERMINAL_BELL_BYTES);
        return true;
    } catch {
        return false;
    }
}

function mergeDeps(overrides: SystemNotificationDeps | undefined): RequiredSystemNotificationDeps {
    return {
        env: overrides?.env || defaultDeps.env,
        pid: overrides?.pid || defaultDeps.pid,
        getMergedCustomSetting: overrides?.getMergedCustomSetting || defaultDeps.getMergedCustomSetting,
        writeTerminal: overrides?.writeTerminal || defaultDeps.writeTerminal,
        getTerminalFocusState: overrides?.getTerminalFocusState || defaultDeps.getTerminalFocusState,
    };
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

function base64Url(value: string): string {
    return btoa(unescape(encodeURIComponent(value))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
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
