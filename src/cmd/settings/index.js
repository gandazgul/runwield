/**
 * @module cmd/settings
 * Settings menu for interactive sessions.
 */

import {
    getSettingsManager as getSettingsManagerFn,
    setCompactionKeepRecentTokens as setCompactionKeepRecentTokensFn,
    setCompactionReserveTokens as setCompactionReserveTokensFn,
} from "../../shared/settings.js";
import { theme } from "../../ui/theme/theme.js";

/**
 * @typedef {Object} CompactionSettings
 * @property {boolean} enabled
 * @property {number} reserveTokens
 * @property {number} keepRecentTokens
 */

/**
 * @typedef {Object} CommandDependencies
 * @property {() => any} [getSettingsManager]
 * @property {() => any} [getRootAgentSession]
 * @property {(value: number) => Promise<void>} [setCompactionReserveTokens]
 * @property {(value: number) => Promise<void>} [setCompactionKeepRecentTokens]
 * @property {(commandName: string) => boolean} [printCommandHelp]
 */

/**
 * @param {number | null | undefined} value
 * @returns {string}
 */
function formatMaybeTokens(value) {
    return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString() : "unknown";
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function parsePositiveInteger(value) {
    const text = String(value ?? "").trim();
    if (!text) return null;
    const parsed = Number(text.replaceAll(",", ""));
    return Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
}

/**
 * @param {any} session
 * @returns {{ tokens: number | null, contextWindow: number | null, percent: number | null } | undefined}
 */
function getContextUsage(session) {
    const usage = session?.getContextUsage?.();
    if (usage) return usage;
    const contextWindow = session?.model?.contextWindow;
    if (typeof contextWindow === "number" && contextWindow > 0) {
        return { tokens: null, contextWindow, percent: null };
    }
    return undefined;
}

/**
 * @param {CompactionSettings} settings
 * @param {any} session
 * @param {any} settingsManager
 * @returns {string}
 */
export function formatCompactionBehavior(settings, session, settingsManager) {
    const usage = getContextUsage(session);
    const contextWindow = usage?.contextWindow ?? session?.model?.contextWindow;
    const threshold = typeof contextWindow === "number" && contextWindow > 0
        ? Math.max(0, contextWindow - settings.reserveTokens)
        : null;
    const currentContext = usage && typeof usage.tokens === "number"
        ? `${usage.tokens.toLocaleString()}/${formatMaybeTokens(usage.contextWindow)} tokens` +
            (typeof usage.percent === "number" ? ` (${usage.percent.toFixed(1)}%)` : "")
        : "unknown";
    const projectCompaction = settingsManager?.getProjectSettings?.().compaction;
    const overrideNote = projectCompaction && typeof projectCompaction === "object"
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

/**
 * @param {CompactionSettings} settings
 * @param {any} session
 * @param {any} settingsManager
 * @returns {string}
 */
function formatCompactionMenuDescription(settings, session, settingsManager) {
    const usage = getContextUsage(session);
    const contextWindow = usage?.contextWindow ?? session?.model?.contextWindow;
    const threshold = typeof contextWindow === "number" && contextWindow > 0
        ? Math.max(0, contextWindow - settings.reserveTokens).toLocaleString()
        : "unknown";
    const projectCompaction = settingsManager?.getProjectSettings?.().compaction;
    const overrideSuffix = projectCompaction && typeof projectCompaction === "object"
        ? " (project override active)"
        : "";
    return `${
        settings.enabled ? "enabled" : "disabled"
    }; threshold ${threshold}; keep ${settings.keepRecentTokens.toLocaleString()}${overrideSuffix}`;
}

/**
 * @param {any} settingsManager
 * @returns {CompactionSettings}
 */
function getCompactionSettings(settingsManager) {
    return settingsManager.getCompactionSettings();
}

/**
 * @param {string} label
 * @param {number} currentValue
 * @param {any} uiAPI
 * @param {(value: number) => Promise<void>} setter
 * @returns {Promise<void>}
 */
async function editTokenSetting(label, currentValue, uiAPI, setter) {
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

/**
 * @param {string[]} argv
 * @param {import('../registry.js').CommandContext & { __testDeps?: CommandDependencies }} [options]
 */
export async function runSettingsCommand(argv, options = {}) {
    const deps = /** @type {CommandDependencies} */ (options.__testDeps || {});
    const getSettingsManager = deps.getSettingsManager || getSettingsManagerFn;
    const getRootAgentSession = deps.getRootAgentSession || (() => options.hostedSession?.getRootAgentSession?.());
    const setCompactionReserveTokens = deps.setCompactionReserveTokens || setCompactionReserveTokensFn;
    const setCompactionKeepRecentTokens = deps.setCompactionKeepRecentTokens || setCompactionKeepRecentTokensFn;

    const firstArg = argv[0]?.trim();
    if (firstArg === "help" || firstArg === "--help" || firstArg === "-h") {
        const printCommandHelp = deps.printCommandHelp || (await import("../help/index.js")).printCommandHelp;
        printCommandHelp("settings");
        return;
    }

    const { uiAPI, editor } = options;
    if (!uiAPI?.promptSelect || !uiAPI?.promptText) {
        console.error("The /settings command is only available inside an interactive session.");
        return;
    }

    const settingsManager = getSettingsManager();

    while (true) {
        const session = getRootAgentSession();
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

        if (selection === "compaction") {
            while (true) {
                const activeSession = getRootAgentSession();
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
                        if (activeSession?.setAutoCompactionEnabled) {
                            activeSession.setAutoCompactionEnabled(enabled);
                            await activeSession.settingsManager?.flush?.();
                        } else {
                            settingsManager.setCompactionEnabled(enabled);
                            await settingsManager.flush?.();
                        }
                        await settingsManager.reload?.();
                        uiAPI.appendSystemMessage(`Auto-compact ${enabled ? "enabled" : "disabled"}.`);
                        uiAPI.requestRender?.();
                    } else if (compactionChoice === "reserve") {
                        await editTokenSetting(
                            "Reserve tokens",
                            activeSettings.reserveTokens,
                            uiAPI,
                            setCompactionReserveTokens,
                        );
                    } else if (compactionChoice === "keep-recent") {
                        await editTokenSetting(
                            "Keep recent tokens",
                            activeSettings.keepRecentTokens,
                            uiAPI,
                            setCompactionKeepRecentTokens,
                        );
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
    }

    if (editor) {
        editor.setText?.("");
        editor.disableSubmit = false;
    }
}
