/**
 * @module cmd/resume
 * Browse and resume a persisted conversation through SessionRuntime.
 */

import { getMergedCustomSetting, getSettingsManager } from "../../shared/settings.js";
import { getModelRegistry } from "../../shared/models/model-registry.js";
import { setTerminalTitleForName } from "../../ui/tui/terminal-title.js";

const DEFAULT_COMPACT_ON_RESUME_PCT = 50;
const DEFAULT_CONTEXT_WINDOW = 128000;

/** @returns {number} */
function getCurrentModelContextWindow() {
    try {
        const settingsManager = getSettingsManager();
        const provider = settingsManager.getDefaultProvider();
        const modelId = settingsManager.getDefaultModel();
        if (provider && modelId) {
            const model = getModelRegistry().find(provider, modelId);
            if (model && typeof model.contextWindow === "number") return model.contextWindow;
        }
    } catch {
        // Configuration errors are represented by the engine's default context size.
    }
    return DEFAULT_CONTEXT_WINDOW;
}

/**
 * @param {{ provider: string, modelId: string } | null} sessionModel
 * @returns {{ modelOverride: string | undefined, contextWindow: number }}
 */
export function getResumeModelSelection(sessionModel) {
    if (sessionModel?.provider && sessionModel.modelId) {
        try {
            const registry = getModelRegistry();
            const model = registry.find(sessionModel.provider, sessionModel.modelId);
            if (model && registry.hasConfiguredAuth(model)) {
                return {
                    modelOverride: `${model.provider}/${model.id}`,
                    contextWindow: typeof model.contextWindow === "number"
                        ? model.contextWindow
                        : DEFAULT_CONTEXT_WINDOW,
                };
            }
        } catch {
            // An unavailable historical model is intentionally replaced by the current configured model.
        }
    }
    return { modelOverride: undefined, contextWindow: getCurrentModelContextWindow() };
}

/** @returns {number} */
export function getCompactThresholdPercent() {
    try {
        const value = getMergedCustomSetting("compactOnResumeThresholdPercent");
        if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 100) return value;
    } catch {
        // Invalid settings use the documented default threshold.
    }
    return DEFAULT_COMPACT_ON_RESUME_PCT;
}

/**
 * @typedef {Object} ResumeCommandDependencies
 * @property {typeof getResumeModelSelection} [getResumeModelSelection]
 * @property {typeof getCompactThresholdPercent} [getCompactThresholdPercent]
 */

/**
 * @param {string[]} _argv
 * @param {import('../registry.js').CommandContext & { __testDeps?: ResumeCommandDependencies }} [options]
 */
export async function runResumeCommand(_argv, options = {}) {
    const { uiAPI, editor, sessionRuntime, sessionId, replaceRuntimeSession } = options;
    if (!uiAPI || !editor) {
        console.error("The /resume command is only available inside an interactive session.");
        return;
    }
    if (!sessionRuntime || !sessionId || !replaceRuntimeSession) {
        throw new Error("Resume requires an active runtime session and replacement surface.");
    }

    const current = sessionRuntime.getSessionSnapshot(sessionId);
    if (!current) throw new Error("The active runtime session is missing.");
    const sessions = await sessionRuntime.listResumableSessions(current.cwd);
    if (sessions.length === 0) {
        uiAPI.appendSystemMessage("No recent sessions found to resume.");
        return;
    }

    const selectedPath = await uiAPI.promptSelect(
        "Select a session to resume:",
        sessions.map((session) => {
            let display = (session.firstMessage || session.id).trim().replace(/\n/g, " ");
            if (display.length > 60) display = `${display.slice(0, 57)}...`;
            return {
                value: session.path,
                label: session.name ? `${session.name} (${display})` : display,
                description: `Modified: ${
                    new Date(session.modified || 0).toLocaleString()
                } | Messages: ${session.messageCount}`,
            };
        }),
    );
    if (!selectedPath) {
        editor.setText("");
        editor.disableSubmit = false;
        return;
    }

    const selected = sessions.find((session) => session.path === selectedPath);
    if (!selected) throw new Error("Selected persisted session is no longer available.");
    const inspection = await sessionRuntime.inspectResumableSession({
        cwd: current.cwd,
        sessionId: selected.id,
        sessionPath: selected.path,
    });
    const deps = options.__testDeps || {};
    const selectModel = deps.getResumeModelSelection || getResumeModelSelection;
    const readThreshold = deps.getCompactThresholdPercent || getCompactThresholdPercent;
    const { modelOverride, contextWindow } = selectModel(inspection.model);
    const thresholdTokens = contextWindow * (readThreshold() / 100);
    let compact = false;

    if (inspection.estimatedTokens > thresholdTokens) {
        const pctUsed = ((inspection.estimatedTokens / contextWindow) * 100).toFixed(1);
        const choice = await uiAPI.promptSelect("Session is large — how would you like to resume?", [
            {
                value: "compact",
                label: `Compact now (estimated ~${pctUsed}% of ${contextWindow.toLocaleString()} tokens)`,
            },
            { value: "resume", label: "Resume as-is" },
            { value: "cancel", label: "Cancel" },
        ]);
        if (!choice || choice === "cancel") {
            editor.setText("");
            editor.disableSubmit = false;
            return;
        }
        compact = choice === "compact";
    }

    const loaded = await sessionRuntime.loadSession({
        cwd: current.cwd,
        sessionId: selected.id,
        sessionPath: selected.path,
        modelOverride,
    });
    replaceRuntimeSession(loaded.sessionId);
    let notice = `Resumed session: ${loaded.sessionManagerId}`;

    if (compact) {
        uiAPI.appendSystemMessage("Compacting session before resume... (Esc to cancel)");
        try {
            const result = await sessionRuntime.compactSession(loaded.sessionId);
            notice =
                `Compacted. Tokens before: ${result.tokensBefore.toLocaleString()}\nResumed (compacted) session: ${loaded.sessionManagerId}`;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const canceled = message === "Compaction cancelled" || message.includes("cancelled");
            notice = canceled
                ? `Compaction cancelled, resuming as-is...\n${notice}`
                : `Compaction failed: ${message} — resuming as-is...\n${notice}`;
        }
    }

    uiAPI.clearMessages?.();
    sessionRuntime.replaySession(loaded.sessionId);
    uiAPI.appendSystemMessage(notice);
    const resumed = sessionRuntime.getSessionSnapshot(loaded.sessionId);
    setTerminalTitleForName(resumed?.name || loaded.sessionManagerId);
}
