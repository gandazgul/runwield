/**
 * @module cmd/settings
 * Settings menu for interactive sessions.
 */

import type { SettingsManager } from "@earendil-works/pi-coding-agent";
import { getCwd } from "../../constants.js";
import type { SessionRuntime } from "../../shared/session/session-runtime.js";
import {
    getSettingsManager,
    setCompactionKeepRecentTokens,
    setCompactionReserveTokens,
} from "../../shared/settings.js";
import { theme } from "../../ui/theme/theme.js";
import { printCommandHelp } from "../help/index.js";

interface CompactionSettings {
    enabled: boolean;
    reserveTokens: number;
    keepRecentTokens: number;
}

interface ContextUsage {
    tokens: number | null;
    contextWindow: number | null;
    percent: number | null;
}

interface ContextSession {
    getContextUsage?(): ContextUsage | undefined;
    model?: {
        contextWindow?: number | null;
    };
}

interface SettingsSelectItem {
    value: string;
    label: string;
    description?: string;
}

interface SettingsTextOptions {
    defaultValue: string;
    placeholder: string;
    allowEmpty: boolean;
}

interface SettingsCommandUi {
    appendSystemMessage(message: string): void;
    promptSelect(title: string, options: SettingsSelectItem[]): Promise<string | null>;
    promptText(title: string, options: SettingsTextOptions): Promise<string | null>;
    requestRender?(): void;
}

interface SettingsCommandEditor {
    disableSubmit: boolean;
    setText?(text: string): void;
}

interface SettingsCommandOptions {
    editor?: SettingsCommandEditor;
    sessionId?: string;
    sessionRuntime?: SessionRuntime;
    uiAPI?: SettingsCommandUi;
}

function formatMaybeTokens(value: number | null | undefined): string {
    return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString() : "unknown";
}

function parsePositiveInteger(value: string | null | undefined): number | null {
    const text = String(value ?? "").trim();
    if (!text) return null;
    const parsed = Number(text.replaceAll(",", ""));
    return Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
}

function getContextUsage(session: ContextSession): ContextUsage | undefined {
    const usage = session.getContextUsage?.();
    if (usage) return usage;
    const contextWindow = session.model?.contextWindow;
    if (typeof contextWindow === "number" && contextWindow > 0) {
        return { tokens: null, contextWindow, percent: null };
    }
    return undefined;
}

export function formatCompactionBehavior(
    settings: CompactionSettings,
    session: ContextSession,
    settingsManager: SettingsManager,
): string {
    const usage = getContextUsage(session);
    const contextWindow = usage?.contextWindow ?? session.model?.contextWindow;
    const threshold = typeof contextWindow === "number" && contextWindow > 0
        ? Math.max(0, contextWindow - settings.reserveTokens)
        : null;
    const currentContext = usage && typeof usage.tokens === "number"
        ? `${usage.tokens.toLocaleString()}/${formatMaybeTokens(usage.contextWindow)} tokens` +
            (typeof usage.percent === "number" ? ` (${usage.percent.toFixed(1)}%)` : "")
        : "unknown";
    const projectCompaction = settingsManager.getProjectSettings().compaction;
    const overrideNote = projectCompaction
        ? "\nProject settings define compaction overrides; effective values are shown above."
        : "";

    return [
        theme.bold("Compaction behavior"),
        `${theme.fg("dim", "Auto-compact:")} ${settings.enabled ? "enabled" : "disabled"}`,
        `${theme.fg("dim", "Reserve tokens:")} ${settings.reserveTokens.toLocaleString()}`,
        `${theme.fg("dim", "Keep recent tokens:")} ${settings.keepRecentTokens.toLocaleString()}`,
        `${theme.fg("dim", "Auto threshold:")} ${
            threshold === null
                ? "unknown"
                : `${threshold.toLocaleString()} / ${formatMaybeTokens(contextWindow)} tokens`
        }`,
        `${theme.fg("dim", "Current context:")} ${currentContext}`,
        "",
        `Auto-compaction triggers when current context exceeds the threshold. Compaction keeps about ${settings.keepRecentTokens.toLocaleString()} tokens of recent messages.`,
    ].join("\n") + overrideNote;
}

function formatCompactionMenuDescription(
    settings: CompactionSettings,
    session: ContextSession,
    settingsManager: SettingsManager,
): string {
    const usage = getContextUsage(session);
    const contextWindow = usage?.contextWindow ?? session.model?.contextWindow;
    const threshold = typeof contextWindow === "number" && contextWindow > 0
        ? Math.max(0, contextWindow - settings.reserveTokens).toLocaleString()
        : "unknown";
    const overrideSuffix = settingsManager.getProjectSettings().compaction ? " (project override active)" : "";
    return `${
        settings.enabled ? "enabled" : "disabled"
    }; threshold ${threshold}; keep ${settings.keepRecentTokens.toLocaleString()}${overrideSuffix}`;
}

function getCompactionSettings(settingsManager: SettingsManager): CompactionSettings {
    return settingsManager.getCompactionSettings();
}

async function editTokenSetting(
    label: string,
    currentValue: number,
    uiAPI: SettingsCommandUi,
    setter: (value: number) => Promise<void>,
): Promise<void> {
    const value = await uiAPI.promptText(`${label}:`, {
        defaultValue: String(currentValue),
        placeholder: "Positive integer token count",
        allowEmpty: false,
    });
    if (value === null) return;

    const parsed = parsePositiveInteger(value);
    if (parsed === null) {
        uiAPI.appendSystemMessage(`${label} must be a positive integer.`);
        return;
    }

    await setter(parsed);
    uiAPI.appendSystemMessage(`${label} set to ${parsed.toLocaleString()}.`);
}

export async function runSettingsCommand(argv: string[], options: SettingsCommandOptions = {}): Promise<void> {
    const firstArg = argv[0]?.trim();
    if (firstArg === "help" || firstArg === "--help" || firstArg === "-h") {
        printCommandHelp("settings");
        return;
    }

    const { uiAPI, editor, sessionRuntime, sessionId } = options;
    if (!uiAPI) {
        console.error("The /settings command is only available inside an interactive session.");
        return;
    }
    if (!sessionRuntime || !sessionId) {
        throw new Error("Settings require an active runtime session.");
    }

    const projectRoot = sessionRuntime.getSessionSnapshot(sessionId)?.cwd || getCwd();
    const settingsManager = getSettingsManager(projectRoot);
    const getActiveSession = (): ContextSession => {
        const usage = sessionRuntime.getSessionSnapshot(sessionId)?.contextUsage || undefined;
        return {
            getContextUsage: () => usage || undefined,
            model: { contextWindow: usage?.contextWindow },
        };
    };

    while (true) {
        const session = getActiveSession();
        const settings = getCompactionSettings(settingsManager);
        const selection = await uiAPI.promptSelect("Settings", [
            {
                value: "compaction",
                label: "Compaction",
                description: formatCompactionMenuDescription(settings, session, settingsManager),
            },
            { value: "done", label: "Done" },
        ]);

        if (!selection || selection === "done") break;
        if (selection !== "compaction") continue;

        while (true) {
            const activeSession = getActiveSession();
            const activeSettings = getCompactionSettings(settingsManager);
            const compactionChoice = await uiAPI.promptSelect("Compaction Settings", [
                {
                    value: "toggle",
                    label: `Auto-compact: ${activeSettings.enabled ? "enabled" : "disabled"}`,
                    description: "Automatically compact context when it gets too large",
                },
                {
                    value: "reserve",
                    label: `Reserve tokens: ${activeSettings.reserveTokens.toLocaleString()}`,
                    description: "Space reserved for compaction prompt and summary output",
                },
                {
                    value: "keep-recent",
                    label: `Keep recent tokens: ${activeSettings.keepRecentTokens.toLocaleString()}`,
                    description: "Approximate recent context retained after compaction",
                },
                {
                    value: "summary",
                    label: "Show behavior summary",
                    description: "Print current compaction thresholds and context usage",
                },
                { value: "back", label: "Back" },
            ]);

            if (!compactionChoice || compactionChoice === "back") break;

            try {
                if (compactionChoice === "toggle") {
                    const enabled = !activeSettings.enabled;
                    const result = await sessionRuntime.setSessionAutoCompaction(sessionId, enabled);
                    if (!result.ok) throw new Error("Active runtime session does not support auto-compaction.");
                    await settingsManager.reload();
                    uiAPI.appendSystemMessage(`Auto-compact ${enabled ? "enabled" : "disabled"}.`);
                    uiAPI.requestRender?.();
                } else if (compactionChoice === "reserve") {
                    await editTokenSetting(
                        "Reserve tokens",
                        activeSettings.reserveTokens,
                        uiAPI,
                        setCompactionReserveTokens,
                    );
                    await settingsManager.reload();
                } else if (compactionChoice === "keep-recent") {
                    await editTokenSetting(
                        "Keep recent tokens",
                        activeSettings.keepRecentTokens,
                        uiAPI,
                        setCompactionKeepRecentTokens,
                    );
                    await settingsManager.reload();
                } else if (compactionChoice === "summary") {
                    uiAPI.appendSystemMessage(
                        formatCompactionBehavior(activeSettings, activeSession, settingsManager),
                    );
                }
            } catch (error) {
                uiAPI.appendSystemMessage(error instanceof Error ? error.message : String(error));
            }
        }
    }

    if (editor) {
        editor.setText?.("");
        editor.disableSubmit = false;
    }
}
