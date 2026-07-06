/**
 * @module cmd/resume
 * Command to browse and resume a recent session.
 *
 * When resuming a large session, estimates the token count against the current
 * model's context window and offers to compact first.
 */

import { estimateTokens } from "@earendil-works/pi-coding-agent";
import { getRunWieldSessionDir } from "../../shared/session/root-session.js";
import { disposeRootAgentSessionForNewSession, ensureRootAgentSession } from "../../shared/session/session.js";
import { HostedSession } from "../../shared/session/hosted-session.js";
import { createAgentHandler } from "../../shared/session/agent-handler.js";
import { restorePersistedMessagesToUi } from "../../shared/interactive/message-hydration.js";
import { getMergedCustomSetting, getSettingsManager } from "../../shared/settings.js";
import { getModelRegistry } from "../../shared/models/model-registry.js";
import { resolveResumeAgentName } from "../../shared/session/active-agent-session.js";
import { setTerminalTitleForSession } from "../../shared/ui/terminal-title.js";

/** Default threshold percentage for compaction-offer prompt. */
const DEFAULT_COMPACT_ON_RESUME_PCT = 50;

/**
 * Default context window fallback when no model is configured.
 * Matches pi's built-in default for unknown models.
 * @type {number}
 */
const DEFAULT_CONTEXT_WINDOW = 128000;

/**
 * Estimate the token count for the actual context that would be sent to the LLM
 * after this session is resumed. This deliberately uses `buildSessionContext()`
 * instead of scanning raw JSONL, because compacted sessions should count only
 * the compaction summary plus retained messages, not the full pre-compaction
 * history represented by `tokensBefore`.
 *
 * @param {{ buildSessionContext?: () => { messages?: unknown[], model?: { provider: string, modelId: string } | null } }} sessionManager
 * @returns {{ estimatedTokens: number, messageCount: number, model: { provider: string, modelId: string } | null }}
 */
export function estimateSessionContextTokens(sessionManager) {
    try {
        const context = sessionManager.buildSessionContext?.();
        const messages = Array.isArray(context?.messages) ? context.messages : [];
        const model = context?.model && typeof context.model === "object"
            ? /** @type {{ provider: string, modelId: string }} */ (context.model)
            : null;
        let estimatedTokens = 0;

        for (const message of messages) {
            estimatedTokens += estimateTokens(/** @type {any} */ (message));
        }

        return { estimatedTokens, messageCount: messages.length, model };
    } catch {
        return { estimatedTokens: 0, messageCount: 0, model: null };
    }
}

/**
 * Resolve the context window for the currently configured default model.
 *
 * Resolution order:
 * 1. Default provider/model from settings via `getSettingsManager()`
 * 2. Look up the model in the registry
 * 3. Fall back to 128000 if unconfigured
 *
 * @returns {number}
 */
function getCurrentModelContextWindow() {
    try {
        const settingsManager = getSettingsManager();
        const provider = settingsManager.getDefaultProvider();
        const modelId = settingsManager.getDefaultModel();

        if (provider && modelId) {
            const modelRegistry = getModelRegistry();
            const model = modelRegistry.find(provider, modelId);
            if (model && typeof model.contextWindow === "number") {
                return model.contextWindow;
            }
        }
    } catch {
        // If settings are unreadable or registry fails, use the default.
    }

    return DEFAULT_CONTEXT_WINDOW;
}

/**
 * Decide which model `/resume` should use when the session records a previous
 * model. If the previous model is still configured, use it and judge against
 * its context window. Otherwise fall back to the model RunWield would normally
 * choose today.
 *
 * @param {{ provider: string, modelId: string } | null} sessionModel
 * @returns {{ modelOverride: string | undefined, contextWindow: number }}
 */
function getResumeModelSelection(sessionModel) {
    if (sessionModel?.provider && sessionModel.modelId) {
        try {
            const modelRegistry = getModelRegistry();
            const model = modelRegistry.find(sessionModel.provider, sessionModel.modelId);
            if (model && modelRegistry.hasConfiguredAuth(model)) {
                return {
                    modelOverride: `${model.provider}/${model.id}`,
                    contextWindow: typeof model.contextWindow === "number"
                        ? model.contextWindow
                        : DEFAULT_CONTEXT_WINDOW,
                };
            }
        } catch {
            // Fall through to normal model resolution fallback.
        }
    }

    return { modelOverride: undefined, contextWindow: getCurrentModelContextWindow() };
}

/**
 * Read the `compactOnResumeThresholdPercent` from merged custom settings
 * (project scope preferred, falls back to global). Validates result is 1–100.
 *
 * @returns {number}
 */
function getCompactThresholdPercent() {
    try {
        const value = getMergedCustomSetting("compactOnResumeThresholdPercent");
        if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 100) {
            return value;
        }
    } catch {
        // Fall through to default
    }
    return DEFAULT_COMPACT_ON_RESUME_PCT;
}

/**
 * Rebuild the root AgentSession around the selected SessionManager and hydrate
 * the UI from persisted messages.
 *
 * @param {import('@earendil-works/pi-coding-agent').SessionManager} rootSessionManager
 * @param {import('../../shared/ui/types.js').UiAPI} uiAPI
 * @param {import('../registry.js').CommandContext} options
 * @param {ResumeCommandDeps} deps
 * @param {{ agentName: string, message?: string, modelOverride?: string }} resumeOptions
 */
async function resumeWithManager(rootSessionManager, uiAPI, options, deps, resumeOptions) {
    const hostedSession = prepareHostedSessionForResume(rootSessionManager, uiAPI, options);

    await deps.ensureRootAgentSession({
        hostedSession,
        agentName: resumeOptions.agentName,
        modelOverride: resumeOptions.modelOverride,
        uiAPI,
        sessionManager: rootSessionManager,
    });
    hostedSession.setActiveOnMessage(createAgentHandler(resumeOptions.agentName, { hostedSession }));

    if (uiAPI.clearMessages) {
        uiAPI.clearMessages();
    }
    deps.restorePersistedMessagesToUi(rootSessionManager, uiAPI, { hostedSession });
    uiAPI.appendSystemMessage(resumeOptions.message || `Resumed session: ${rootSessionManager.getSessionId()}`);
    setTerminalTitleForSession(rootSessionManager, Deno.cwd());
}

/**
 * @param {import('@earendil-works/pi-coding-agent').SessionManager} rootSessionManager
 * @param {import('../../shared/ui/types.js').UiAPI} uiAPI
 * @param {import('../registry.js').CommandContext} options
 * @returns {import('../../shared/session/hosted-session.js').HostedSession}
 */
function prepareHostedSessionForResume(rootSessionManager, uiAPI, options) {
    if (options.replaceHostedSession) {
        const nextSession = options.sessionHost?.createSession?.({
            sessionManager: rootSessionManager,
            cwd: Deno.cwd(),
            uiAPI,
            eventSink: uiAPI,
        }) || new HostedSession({
            id: rootSessionManager.getSessionId?.() || crypto.randomUUID(),
            cwd: Deno.cwd(),
            sessionManager: rootSessionManager,
            uiAPI,
            eventSink: uiAPI,
        });
        options.replaceHostedSession(nextSession);
        return nextSession;
    }

    const hostedSession = options.hostedSession;
    if (!hostedSession) throw new Error("/resume requires an active HostedSession.");
    const previousManager = hostedSession.getRootSessionManager();
    disposeRootAgentSessionForNewSession(hostedSession);
    if (previousManager && previousManager !== rootSessionManager) {
        try {
            previousManager.dispose?.();
        } catch {
            // Resume should continue even if the old persistence object cannot be disposed.
        }
    }
    hostedSession.setRootSessionManager(rootSessionManager);
    hostedSession.setActiveUiAPI(uiAPI);
    hostedSession.setEventSink(uiAPI);
    return hostedSession;
}

/**
 * Run compaction, then hydrate the UI. On compaction failure or cancellation,
 * resume the already-open session as-is.
 *
 * @param {import('@earendil-works/pi-coding-agent').SessionManager} rootSessionManager
 * @param {import('../../shared/ui/types.js').UiAPI} uiAPI
 * @param {import('../registry.js').CommandContext} options
 * @param {ResumeCommandDeps} deps
 * @param {string} agentName
 * @param {string | undefined} modelOverride
 */
async function compactThenResume(rootSessionManager, uiAPI, options, deps, agentName, modelOverride) {
    /** @type {import('../../shared/session/hosted-session.js').HostedSession | null} */
    let hostedSession = null;
    try {
        hostedSession = prepareHostedSessionForResume(rootSessionManager, uiAPI, options);

        await deps.ensureRootAgentSession({
            hostedSession,
            agentName,
            modelOverride,
            uiAPI,
            sessionManager: rootSessionManager,
        });
        hostedSession.setActiveOnMessage(createAgentHandler(agentName, { hostedSession }));

        // 3. Run compaction
        const session = /** @type {any} */ (hostedSession.getRootAgentSession());
        if (!session) {
            throw new Error("Failed to create agent session");
        }

        uiAPI.appendSystemMessage("Compacting session before resume... (Esc to cancel)");

        if (options.registerOperationCancel) {
            options.registerOperationCancel(() => {
                try {
                    session.abortCompaction();
                } catch (_e) { /* ignore */ }
            });
        }

        const result = await session.compact();

        if (uiAPI.clearMessages) {
            uiAPI.clearMessages();
        }
        deps.restorePersistedMessagesToUi(rootSessionManager, uiAPI, { hostedSession });
        uiAPI.appendSystemMessage(
            `Compacted. Tokens before: ${result.tokensBefore.toLocaleString()}\nResumed (compacted) session: ${rootSessionManager.getSessionId()}`,
        );
        setTerminalTitleForSession(rootSessionManager, Deno.cwd());
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const isCancelled = message === "Compaction cancelled" || message.includes("cancelled");

        const resumeNotice = isCancelled
            ? "Compaction cancelled, resuming as-is..."
            : `Compaction failed: ${message} — resuming as-is...`;

        if (!hostedSession) {
            await resumeWithManager(rootSessionManager, uiAPI, options, deps, {
                agentName,
                message: `${resumeNotice}\nResumed session: ${rootSessionManager.getSessionId()}`,
                modelOverride,
            });
            return;
        }
        if (uiAPI.clearMessages) {
            uiAPI.clearMessages();
        }
        deps.restorePersistedMessagesToUi(rootSessionManager, uiAPI, { hostedSession });
        uiAPI.appendSystemMessage(`${resumeNotice}\nResumed session: ${rootSessionManager.getSessionId()}`);
        setTerminalTitleForSession(rootSessionManager, Deno.cwd());
    }
}

/**
 * @typedef {Object} ResumeCommandDeps
 * @property {typeof ensureRootAgentSession} ensureRootAgentSession
 * @property {typeof restorePersistedMessagesToUi} restorePersistedMessagesToUi
 * @property {(sessionModel: { provider: string, modelId: string } | null) => { modelOverride: string | undefined, contextWindow: number }} getResumeModelSelection
 * @property {() => number} getCompactThresholdPercent
 * @property {(sessionManager: import('@earendil-works/pi-coding-agent').SessionManager) => Promise<string>} resolveResumeAgentName
 * @property {(sessionManager: { buildSessionContext?: () => { messages?: unknown[], model?: { provider: string, modelId: string } | null } }) => { estimatedTokens: number, messageCount: number, model: { provider: string, modelId: string } | null } | Promise<{ estimatedTokens: number, messageCount: number, model: { provider: string, modelId: string } | null }>} estimateSessionContextTokens
 * @property {{ list: (cwd: string, sessionDir: string) => Promise<Array<{ path: string, id: string, modified: Date | string | number, messageCount: number, firstMessage?: string, name?: string }>>, open: (path: string, sessionDir: string, cwd: string) => import('@earendil-works/pi-coding-agent').SessionManager } | undefined} SessionManager
 */

/**
 * @param {import('../registry.js').CommandContext} options
 * @returns {ResumeCommandDeps}
 */
function getDeps(options) {
    const testDeps = /** @type {Partial<ResumeCommandDeps> | undefined} */ (options.__testDeps);
    return {
        ensureRootAgentSession: testDeps?.ensureRootAgentSession || ensureRootAgentSession,
        restorePersistedMessagesToUi: testDeps?.restorePersistedMessagesToUi || restorePersistedMessagesToUi,
        getResumeModelSelection: testDeps?.getResumeModelSelection || getResumeModelSelection,
        getCompactThresholdPercent: testDeps?.getCompactThresholdPercent || getCompactThresholdPercent,
        resolveResumeAgentName: testDeps?.resolveResumeAgentName || resolveResumeAgentName,
        estimateSessionContextTokens: testDeps?.estimateSessionContextTokens || estimateSessionContextTokens,
        SessionManager: testDeps?.SessionManager,
    };
}

/**
 * Handle resume session command.
 *
 * @param {string[]} _argv
 * @param {import('../registry.js').CommandContext} [options]
 */
export async function runResumeCommand(_argv, options = {}) {
    if (!options?.uiAPI || !options?.editor) {
        console.error("The /resume command is only available inside an interactive session.");
        return;
    }

    const { uiAPI, editor } = options;
    const deps = getDeps(options);

    const { SessionManager } = deps.SessionManager
        ? { SessionManager: deps.SessionManager }
        : await import("@earendil-works/pi-coding-agent");
    const cwd = Deno.cwd();
    const sessionDir = getRunWieldSessionDir(cwd);

    // List recent sessions
    const sessions =
        /** @type {Array<{ path: string, id: string, modified: Date | string | number, messageCount: number, firstMessage?: string, name?: string }>} */ (
            await SessionManager.list(cwd, sessionDir)
        );

    if (sessions.length === 0) {
        uiAPI.appendSystemMessage("No recent sessions found to resume.");
        return;
    }

    // Prepare options for promptSelect
    const selectOptions = sessions.map((s) => {
        let displayMsg = (s.firstMessage || s.id).trim().replace(/\n/g, " ");
        if (displayMsg.length > 60) {
            displayMsg = displayMsg.substring(0, 57) + "...";
        }

        const title = s.name ? `${s.name} (${displayMsg})` : displayMsg;
        const modified = new Date(s.modified).toLocaleString();
        return {
            value: s.path,
            label: title,
            description: `Modified: ${modified} | Messages: ${s.messageCount}`,
        };
    });

    const chosenPath = await uiAPI.promptSelect("Select a session to resume:", selectOptions);

    if (!chosenPath) {
        // User pressed Esc or cancelled
        editor.setText("");
        editor.disableSubmit = false;
        return;
    }

    const rootSessionManager = SessionManager.open(chosenPath, sessionDir, cwd);

    const agentName = await deps.resolveResumeAgentName(rootSessionManager);
    const { estimatedTokens, model } = await deps.estimateSessionContextTokens(rootSessionManager);
    const thresholdPct = deps.getCompactThresholdPercent();
    const { modelOverride, contextWindow } = deps.getResumeModelSelection(model);
    const thresholdTokens = contextWindow * (thresholdPct / 100);

    if (estimatedTokens > thresholdTokens) {
        const pctUsed = ((estimatedTokens / contextWindow) * 100).toFixed(1);

        const choice = await uiAPI.promptSelect(
            "Session is large — how would you like to resume?",
            [
                {
                    value: "compact",
                    label: `Compact now (estimated ~${pctUsed}% of ${contextWindow.toLocaleString()} tokens)`,
                },
                { value: "resume", label: "Resume as-is" },
                { value: "cancel", label: "Cancel" },
            ],
        );

        if (!choice || choice === "cancel") {
            // User pressed Esc or selected Cancel
            editor.setText("");
            editor.disableSubmit = false;
            return;
        }

        if (choice === "compact") {
            await compactThenResume(rootSessionManager, uiAPI, options, deps, agentName, modelOverride);
            return;
        }
        // choice === "resume" — fall through to normal resume
    }

    await resumeWithManager(rootSessionManager, uiAPI, options, deps, { agentName, modelOverride });
}
