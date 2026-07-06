/**
 * @module shared/interactive/chat-session
 * High-level interactive loop for the TUI. This manages the long-running
 * user interaction — distinct from individual agent invocations (see session.js).
 */

import {
    CombinedAutocompleteProvider,
    Container,
    Editor,
    Spacer,
    Text,
    truncateToWidth,
    visibleWidth,
} from "@earendil-works/pi-tui";
import { initTUI } from "../ui/tui.js";
import { setTerminalTitleForSession } from "../ui/terminal-title.js";
import { applyPersistedTheme, getEditorTheme, initRunWieldTheme, onThemeChange, theme } from "../ui/theme.js";
import { VERSION } from "../version.js";
import { endBlink, renderBootLogo } from "../ui/boot-logo.js";
import { createUiApi } from "../ui/api.js";
import { SpinnerBlock, SystemMessageBlock } from "../ui/blocks.js";
import {
    abortActiveSession,
    ensureRootAgentSession,
    listPromptTemplates,
    listSkills,
    steerRootSessionWithTarget,
} from "../session/session.js";
import { ensureMnemosyneBinary } from "../runtime-preflight.js";
import { commandRegistry, getCommandInvocationNames, getSlashCommandDefinitions } from "../../cmd/registry.js";
import { AGENTS } from "../../constants.js";
import {
    EMPTY_PROJECT_DIRECTORY_HEADER,
    EMPTY_PROJECT_DIRECTORY_PROMPT_NOTE,
    EMPTY_PROJECT_DIRECTORY_WELCOME_BODY,
    isEmptyProjectDirectory,
} from "../project-state.js";
import { COMMAND_NAMES } from "../../cmd/registry.js";
import { getAgentDisplayName, listAvailableAgents } from "../session/agents.js";
import { createAgentHandler } from "../session/agent-handler.js";
import { getModelRegistry } from "../models/model-registry.js";
import { getSettingsManager, initSettings } from "../settings.js";
import {
    isInitDone as isInitDoneFn,
    isInitOffered as isInitOfferedFn,
    recordInitOffered as recordInitOfferedFn,
} from "../../cmd/init/init-state.js";
import { SessionHost } from "../session/session-host.js";
import { parseProviderModel } from "../models/model-validation.js";
import { createRootSessionManager } from "../session/root-session.js";
import { createGenerationGuard } from "./generation-guard.js";
import { restorePersistedMessagesToUi } from "./message-hydration.js";
import { installUiApiOverrides } from "./ui-api-overrides.js";
import { renderBootBanner } from "./boot-banner.js";
import { getSelectedDefaultModelAvailability, maybeShowModelWelcome } from "./model-welcome.js";
import { handleBashCommand } from "./bash-interceptor.js";
import { handleSlashCommand } from "./slash-dispatch.js";
import { installKeybindings } from "./keybindings.js";
import {
    modelSupportsImageInput,
    persistImageAttachment,
    preflightImageAttachments,
    resolveVisionFallbackModel,
} from "../session/image-attachments.js";

const CHAT_PROMPT_AGENT_NAME = AGENTS.OPERATOR;

/** @type {() => ReturnType<typeof getSettingsManager>} */
let getSettingsManagerForPersistence = getSettingsManager;

/**
 * Test-only hook for code paths that persist model/thinking selections.
 *
 * @param {(() => ReturnType<typeof getSettingsManager>) | null} provider
 */
export function __setSettingsManagerForPersistenceTests(provider) {
    getSettingsManagerForPersistence = provider || getSettingsManager;
}

/** @type {Set<string>} */
export let CHAT_BUILTIN_SLASH_NAMES = new Set();

/**
 * Format token counts for footer display (same formatting as Pi.dev).
 * @param {number} count
 * @returns {string}
 */
function formatTokens(count) {
    if (count < 1000) return String(count);
    if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
    if (count < 1000000) return `${Math.round(count / 1000)}k`;
    if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
    return `${Math.round(count / 1000000)}M`;
}

/**
 * @param {any} usage
 * @returns {{ input: number, output: number, cacheRead: number, cacheWrite: number, cost: number }}
 */
function normalizeFooterUsage(usage) {
    return {
        input: Number(usage?.input ?? usage?.inputTokens ?? 0) || 0,
        output: Number(usage?.output ?? usage?.outputTokens ?? 0) || 0,
        cacheRead: Number(usage?.cacheRead ?? usage?.cacheReadTokens ?? 0) || 0,
        cacheWrite: Number(usage?.cacheWrite ?? usage?.cacheWriteTokens ?? 0) || 0,
        cost: Number(usage?.cost?.total ?? usage?.cost ?? 0) || 0,
    };
}

/**
 * @param {any} session
 * @returns {Array<any>}
 */
function getFooterSessionEntries(session) {
    try {
        return session?.sessionManager?.getEntries?.() || [];
    } catch {
        return [];
    }
}

/**
 * @param {Array<any>} sessions
 * @returns {{ input: number, output: number, cacheRead: number, cacheWrite: number, cost: number }}
 */
export function collectFooterUsage(sessions) {
    const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };

    for (const session of sessions) {
        for (const entry of getFooterSessionEntries(session)) {
            if (entry?.type !== "message" || entry?.message?.role !== "assistant") continue;
            const usage = normalizeFooterUsage(entry.message.usage);
            totals.input += usage.input;
            totals.output += usage.output;
            totals.cacheRead += usage.cacheRead;
            totals.cacheWrite += usage.cacheWrite;
            totals.cost += usage.cost;
        }
    }

    return totals;
}

/**
 * @param {string} modelStr
 * @param {string} thinkingLevel
 * @returns {boolean}
 */
export function shouldShowFooterThinkingLevel(modelStr, thinkingLevel) {
    return Boolean(modelStr) && thinkingLevel !== "off";
}

/**
 * @param {any} rootSession
 * @param {Iterable<any>} subAgentSessions
 * @returns {Array<any>}
 */
export function getFooterSessions(rootSession, subAgentSessions) {
    return [
        ...(rootSession ? [rootSession] : []),
        ...Array.from(subAgentSessions || []),
    ];
}

/**
 * @param {any} session
 * @returns {{ provider: string, model: string } | null}
 */
function getSessionModelParts(session) {
    const model = session?.state?.model;
    if (!model) return null;
    if (typeof model === "string") {
        const slashIndex = model.indexOf("/");
        if (slashIndex > 0) {
            return { provider: model.slice(0, slashIndex), model: model.slice(slashIndex + 1) };
        }
        return { provider: "", model };
    }
    if (typeof model === "object") {
        const provider = typeof model.provider === "string" ? model.provider : "";
        const id = typeof model.id === "string" ? model.id : typeof model.model === "string" ? model.model : "";
        if (id) return { provider, model: id };
    }
    return null;
}

/**
 * @param {Array<any>} sessions
 * @returns {{ provider: string, model: string } | null}
 */
function getMostRecentSessionModelParts(sessions) {
    for (let i = sessions.length - 1; i >= 0; i--) {
        const parts = getSessionModelParts(sessions[i]);
        if (parts) return parts;
    }
    return null;
}

/**
 * @typedef {Object} PendingSteeringEntry
 * @property {import('@earendil-works/pi-coding-agent').AgentSession} session
 * @property {string} text
 * @property {import('../session/types.js').ImageAttachment[]} images
 * @property {SystemMessageBlock} systemBlock
 * @property {Spacer} spacer
 */

/**
 * @typedef {Object} SteeringState
 * @property {Map<number, PendingSteeringEntry>} pendingMessages
 * @property {Map<import('@earendil-works/pi-coding-agent').AgentSession, () => void>} pendingUnsubs
 * @property {number} nextId
 * @property {import('@earendil-works/pi-tui').Container | undefined} messageList
 * @property {import('@earendil-works/pi-tui').TUI | undefined} tui
 * @property {import('../ui/types.js').UiAPI | undefined} uiAPI
 */

/** @returns {SteeringState} */
export function createSteeringState() {
    return {
        pendingMessages: new Map(),
        pendingUnsubs: new Map(),
        nextId: 1,
        messageList: undefined,
        tui: undefined,
        uiAPI: undefined,
    };
}

/**
 * @param {readonly string[] | undefined} steering
 * @returns {Map<string, number>}
 */
function countQueuedSteeringByText(steering) {
    /** @type {Map<string, number>} */
    const counts = new Map();
    for (const text of steering || []) {
        counts.set(text, (counts.get(text) || 0) + 1);
    }
    return counts;
}

/**
 * @param {SteeringState} steeringState
 * @param {import('@earendil-works/pi-coding-agent').AgentSession} session
 */
function cleanupSteeringSubscriptionIfIdle(steeringState, session) {
    for (const entry of steeringState.pendingMessages.values()) {
        if (entry.session === session) return;
    }
    const unsubscribe = steeringState.pendingUnsubs.get(session);
    if (unsubscribe) {
        unsubscribe();
        steeringState.pendingUnsubs.delete(session);
    }
}

/**
 * @param {SteeringState} steeringState
 * @param {number} id
 * @param {PendingSteeringEntry} entry
 */
function transitionSteeringToUserMessage(steeringState, id, entry) {
    if (!steeringState.messageList || !steeringState.uiAPI || !steeringState.tui) return;
    steeringState.messageList.removeChild(entry.systemBlock);
    steeringState.messageList.removeChild(entry.spacer);
    steeringState.uiAPI.appendUserMessage?.(entry.text);
    if (entry.images.length > 0) {
        for (const img of entry.images) {
            steeringState.uiAPI.appendImage?.(img.base64, img.mimeType);
        }
    }
    steeringState.pendingMessages.delete(id);
    cleanupSteeringSubscriptionIfIdle(steeringState, entry.session);
    steeringState.tui.requestRender();
}

/**
 * Subscribe to the exact session that accepted a steering message. When the
 * message is consumed by the LLM (no longer in that session's queue_update
 * steering list), transition from "Steering:" to a proper UserPromptBlock.
 *
 * @param {SteeringState} steeringState
 * @param {import('@earendil-works/pi-coding-agent').AgentSession} session
 */
function setupSteeringConsumedListener(steeringState, session) {
    if (steeringState.pendingUnsubs.has(session)) return;
    steeringState.pendingUnsubs.set(
        session,
        session.subscribe((event) => {
            if (event.type !== "queue_update") return;
            if (!steeringState.messageList || !steeringState.uiAPI || !steeringState.tui) return;
            const activeSteeringCounts = countQueuedSteeringByText(event.steering);
            for (const [id, entry] of steeringState.pendingMessages) {
                if (entry.session !== session) continue;
                const activeCount = activeSteeringCounts.get(entry.text) || 0;
                if (activeCount > 0) {
                    activeSteeringCounts.set(entry.text, activeCount - 1);
                    continue;
                }
                transitionSteeringToUserMessage(steeringState, id, entry);
            }
        }),
    );
}

/**
 * @param {SteeringState} steeringState
 * @param {import('@earendil-works/pi-coding-agent').AgentSession} session
 * @param {string} text
 * @param {import('../session/types.js').ImageAttachment[]} images
 * @param {SystemMessageBlock} systemBlock
 * @param {Spacer} spacer
 */
export function trackPendingSteeringMessage(steeringState, session, text, images, systemBlock, spacer) {
    setupSteeringConsumedListener(steeringState, session);
    const id = steeringState.nextId++;
    steeringState.pendingMessages.set(id, {
        session,
        text,
        images: [...images],
        systemBlock,
        spacer,
    });
    return id;
}

/**
 * Test-only hook for exercising steering queue consumption without booting the TUI.
 *
 * @param {SteeringState} steeringState
 * @param {import('@earendil-works/pi-tui').Container} messageList
 * @param {import('../ui/types.js').UiAPI} uiAPI
 * @param {import('@earendil-works/pi-tui').TUI} tui
 */
export function __setSteeringUiRefsForTests(steeringState, messageList, uiAPI, tui) {
    steeringState.messageList = messageList;
    steeringState.uiAPI = uiAPI;
    steeringState.tui = tui;
}

/** @param {SteeringState} steeringState */
export function clearSteeringState(steeringState) {
    steeringState.pendingMessages.clear();
    for (const unsubscribe of steeringState.pendingUnsubs.values()) {
        unsubscribe();
    }
    steeringState.pendingUnsubs.clear();
    steeringState.nextId = 1;
    steeringState.messageList = undefined;
    steeringState.uiAPI = undefined;
    steeringState.tui = undefined;
}

/** @param {SteeringState} steeringState */
export function __resetPendingSteeringForTests(steeringState) {
    clearSteeringState(steeringState);
}

/**
 * Update the active agent and its message handler.
 *
 * Footer state (agent display name + model) is NOT changed here — it is
 * updated only when the root session is actually rebuilt for the new agent,
 * via `buildAgentSession` → `uiAPI.setAgentInfo`. This guarantees the footer
 * reflects the agent that's truly handling turns and never claims a switch
 * that has not yet taken effect.
 *
 * Callers must pass the internal agent name from the `AGENTS` constant; the
 * display name is read from the agent definition's frontmatter when needed.
 *
 * @param {any} hostedSession
 * @param {any} agentName  Internal agent name (filename of the agent
 *   definition without `.md`, e.g. `AGENTS.ROUTER` → `"router"`).
 * @param {any} [handler]
 * @param {any} [uiAPI]
 * @param {any} [agentModel]
 * @param {any} [options]
 */
export function setActiveAgent(hostedSession, agentName, handler, uiAPI, agentModel, options = {}) {
    if (!hostedSession || typeof hostedSession !== "object" || typeof hostedSession.setActiveOnMessage !== "function") {
        uiAPI?.appendSystemMessage?.("Cannot switch agents before a HostedSession is available.");
        uiAPI?.requestRender?.();
        return;
    }
    hostedSession.setActiveOnMessage(/** @type {import('../session/types.js').AgentMessageHandler} */ (handler));

    if (uiAPI) {
        hostedSession.setActiveUiAPI(uiAPI);
    }

    // If the active root is already this agent, no swap is needed and the
    // footer already matches reality.
    if (agentName === hostedSession.getRootAgentName()) {
        uiAPI?.requestRender();
        return;
    }

    // Queue a root rebuild. The actual swap (and the corresponding footer
    // update + "Switched to X" message) is applied at the next turn boundary
    // by applyPendingRootSwap() — it is unsafe to dispose the root mid-prompt,
    // and updating the footer earlier would let the UI claim a switch that
    // has not yet taken effect.
    /** @type {import('../session/hosted-session.js').PendingRootSwap} */
    const pendingSwap = {
        agentName: /** @type {string} */ (agentName),
        displayName: getAgentDisplayName(/** @type {string} */ (agentName)),
        model: agentModel,
    };
    if (options.allowReturnToRouter !== undefined) {
        pendingSwap.allowReturnToRouter = options.allowReturnToRouter;
    }
    hostedSession.setPendingRootSwap(pendingSwap);

    uiAPI?.requestRender();
}

/**
 * If a pending root swap is queued, build a new root for the target agent
 * without disposing the current root. Safe to call when the root is idle
 * (between user turns).
 *
 * The footer (active agent name + model) is updated as a side-effect of
 * `buildAgentSession` calling `uiAPI.setAgentInfo`, so it changes exactly when
 * the new root is in place — never before. The user-facing "Switched to X"
 * notice is emitted here only after the rebuild succeeds, for the same reason.
 *
 * @param {any} hostedSession
 * @param {any} [uiAPI]
 * @returns {Promise<void>}
 */
export async function applyPendingRootSwap(hostedSession, uiAPI) {
    if (!hostedSession || typeof hostedSession !== "object" || typeof hostedSession.getPendingRootSwap !== "function") {
        return;
    }
    const targetHostedSession = /** @type {import('../session/hosted-session.js').HostedSession} */ (hostedSession);
    const pending = targetHostedSession.getPendingRootSwap();
    if (!pending) return;
    if (pending.agentName === targetHostedSession.getRootAgentName()) {
        targetHostedSession.setPendingRootSwap(null);
        return;
    }
    targetHostedSession.setPendingRootSwap(null);
    try {
        targetHostedSession.clearUserModelOverride();
        await ensureRootAgentSession({
            hostedSession: targetHostedSession,
            agentName: pending.agentName,
            modelOverride: pending.model,
            uiAPI: /** @type {any} */ (uiAPI),
            sessionManager: /** @type {any} */ (targetHostedSession.getRootSessionManager() || undefined),
            allowReturnToRouter: pending.allowReturnToRouter,
        });
        const modelText = pending.model ? ` (model: ${pending.model})` : "";
        uiAPI?.appendSystemMessage?.(`Switched to ${pending.displayName}${modelText}.`);
        uiAPI?.requestRender?.();
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        uiAPI?.appendSystemMessage?.(`Failed to switch root agent to "${pending.agentName}": ${msg}`);
    }
}

/**
 * @param {import('../session/hosted-session.js').HostedSession} hostedSession
 * @param {string} model
 * @param {string} [provider]
 */
export async function setActiveModel(hostedSession, model, provider) {
    hostedSession.setActiveModelState(model, provider || "", true);

    try {
        const settingsManager = getSettingsManagerForPersistence();
        await settingsManager.setDefaultModel(model);
        await settingsManager.setDefaultProvider(provider || "");
    } catch (e) {
        console.error(`Failed to persist model selection: ${e}`);
    }

    // Rebuild the root session so image capability changes update the available tool set.
    const session = /** @type {any} */ (hostedSession.getRootAgentSession());
    const rootAgentName = hostedSession.getRootAgentName();
    if (session && rootAgentName) {
        try {
            await ensureRootAgentSession({
                hostedSession,
                agentName: rootAgentName,
                modelOverride: provider ? `${provider}/${model}` : model,
                uiAPI: /** @type {any} */ (hostedSession.getActiveUiAPIState() || undefined),
                sessionManager: /** @type {any} */ (hostedSession.getRootSessionManager() || undefined),
            });
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            (/** @type {any} */ (hostedSession.getActiveUiAPIState()))?.appendSystemMessage?.(
                `Failed to switch model: ${msg}`,
                true,
            );
        }
    } else if (session && typeof session.setModel === "function") {
        const modelRegistry = getModelRegistry();
        const found = modelRegistry.find(provider || "", model);
        if (found && modelRegistry.hasConfiguredAuth(found)) {
            try {
                await session.setModel(found);
            } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                (/** @type {any} */ (hostedSession.getActiveUiAPIState()))?.appendSystemMessage?.(
                    `Failed to switch model: ${msg}`,
                    true,
                );
            }
        }
    }

    (/** @type {any} */ (hostedSession.getActiveUiAPIState()))?.requestRender();
}

/**
 * @param {"off" | "minimal" | "low" | "medium" | "high" | "xhigh"} level
 */
export async function persistThinkingLevel(level) {
    try {
        const settingsManager = getSettingsManagerForPersistence();
        await settingsManager.setDefaultThinkingLevel(level);
    } catch (e) {
        console.error(`Failed to persist thinking level: ${e}`);
    }
}

/**
 * Get the active UI API reference.
 * @returns {import('../workflow/workflow.js').UiAPI | null}
 */
/**
 * @param {import('../session/hosted-session.js').HostedSession} [hostedSession]
 * @returns {any}
 */
export function getActiveUiAPI(hostedSession = undefined) {
    return hostedSession?.getActiveUiAPIState?.() || null;
}

/**
 * Get the active model identifier (may include provider prefix).
 * @param {import('../session/hosted-session.js').HostedSession} hostedSession
 * @returns {string}
 */
export function getActiveModel(hostedSession) {
    return hostedSession.getActiveModelState().model;
}

/**
 * Testable core of the interactive submit loop. It applies root swaps and
 * follows return_to_router handoffs recorded on the supplied HostedSession only.
 *
 * @param {Object} args
 * @param {import('../session/hosted-session.js').HostedSession} args.hostedSession
 * @param {import('../ui/types.js').UiAPI} args.uiAPI
 * @param {string} args.initialRequest
 * @param {import('../session/types.js').ImageAttachment[]} args.initialImages
 * @param {(uiAPI: import('../ui/types.js').UiAPI) => Promise<void>} args.applyPendingRootSwapImpl
 */
export async function runScopedSubmitHandoffLoop(
    { hostedSession, uiAPI, initialRequest, initialImages, applyPendingRootSwapImpl },
) {
    let currentRequest = initialRequest;
    let currentImages = initialImages;
    let isHandoff = false;
    let handoffsLeft = 4;

    while (true) {
        await applyPendingRootSwapImpl(uiAPI);
        const activeOnMessage = hostedSession.getActiveOnMessage();
        const rootSessionManager = hostedSession.getRootSessionManager();
        if (!activeOnMessage || !rootSessionManager) {
            uiAPI.appendSystemMessage?.("Error: No active agent handler or session manager.");
            break;
        }
        hostedSession.setActiveUiAPI(uiAPI);
        if (isHandoff) {
            uiAPI.appendSystemMessage?.(currentRequest, false, "Handoff:");
        }
        await activeOnMessage(currentRequest, currentImages, uiAPI, rootSessionManager);

        const handoff = hostedSession.consumePendingSwitchHandoff();
        if (!handoff) break;
        if (handoffsLeft-- <= 0) {
            uiAPI.appendSystemMessage?.(
                "return_to_router handoff limit reached — refusing further chained handoffs in this turn.",
            );
            break;
        }
        currentRequest = handoff.reason;
        currentImages = [];
        isHandoff = true;
    }
}

/**
 * Resolve and validate a template-declared model.
 * Requires strict provider/id format and configured auth.
 *
 * @param {string} templateModel
 * @param {object} [modelRegistry]
 * @returns {{ ok: true, provider: string, id: string } | { ok: false }}
 */
export function resolveTemplateModel(templateModel, modelRegistry) {
    const registry =
        /** @type {{ find: (provider: string, model: string) => unknown, hasConfiguredAuth: (model: unknown) => boolean }} */ (
            modelRegistry || getModelRegistry()
        );
    const parsed = parseProviderModel(templateModel);
    if (!parsed.ok) {
        return { ok: false };
    }

    const resolvedModel = registry.find(parsed.provider, parsed.id);
    if (!resolvedModel || !registry.hasConfiguredAuth(resolvedModel)) {
        return { ok: false };
    }

    const configuredModel = /** @type {{ provider: string, id: string }} */ (resolvedModel);
    return { ok: true, provider: configuredModel.provider, id: configuredModel.id };
}

/**
 * Starts the interactive TUI loop.
 * @param {string | null} initialUserRequest
 * @param {import('../session/types.js').AgentMessageHandler | null} onMessage - Handler for user submissions
 * @param {{ sessionStartMode?: "new" | "continue", initialAgentName?: string, initialAgentModel?: string }} [options]
 */
export async function startInteractiveSession(initialUserRequest, onMessage, options = {}) {
    CHAT_BUILTIN_SLASH_NAMES = new Set(
        getSlashCommandDefinitions().map((command) => command.name),
    );

    const sessionHost = new SessionHost();
    const rootSessionManager = await createRootSessionManager(options.sessionStartMode || "new", Deno.cwd());
    let hostedSession = sessionHost.createSession({ sessionManager: rootSessionManager, cwd: Deno.cwd() });
    initSettings();
    const sessionStartedAt = rootSessionManager.getHeader()?.timestamp || new Date().toISOString();

    let sessionStartedEmptyProjectDirectory = false;
    try {
        sessionStartedEmptyProjectDirectory = await isEmptyProjectDirectory(Deno.cwd());
    } catch {
        sessionStartedEmptyProjectDirectory = false;
    }
    hostedSession.setProjectStateContext(
        sessionStartedEmptyProjectDirectory ? EMPTY_PROJECT_DIRECTORY_PROMPT_NOTE : "",
    );

    // Pre-warm the display-name cache so any sync getAgentDisplayName call
    // before the root session is built can resolve from cache instead of
    // re-reading the frontmatter file. (The footer itself is not set here —
    // ensureRootAgentSession below will populate it via setAgentInfo once the
    // session actually exists, so the UI never shows an agent name that has
    // no live session behind it.)
    await listAvailableAgents();

    // Track which agent the initial root will be built for. Callers (e.g. `wld agent <name>`)
    // can override via options.initialAgentName.
    const initialAgentInternalName = options.initialAgentName || AGENTS.ROUTER;
    hostedSession.setActiveOnMessage(onMessage || createAgentHandler(initialAgentInternalName, { hostedSession }));
    await ensureMnemosyneBinary();
    initRunWieldTheme();
    await applyPersistedTheme();
    const tui = initTUI();
    setTerminalTitleForSession(rootSessionManager, Deno.cwd());

    const container = new Container();
    const suppressStartupHeader = options.sessionStartMode === "continue";

    // Header
    const titleLine = `${theme.fg("accent", theme.bold("RunWield ─ Plan-by-Default Harness"))} ${
        theme.fg("dim", `${VERSION}`)
    }`;

    const compactHelp = theme.fg(
        "muted",
        ["esc interrupt", "ctrl+c clear/exit", "/ commands", "! bash", "ctrl+o more"].join(" · "),
    );
    const expandedHelp = theme.fg(
        "muted",
        [
            "esc          to interrupt",
            "ctrl+c       to clear input",
            "ctrl+c twice to exit",
            "shift+tab    to cycle thinking level",
            "ctrl+o       to expand tool outputs / collapse this help",
            "ctrl+t       to toggle thinking block visibility",
            "ctrl+g       for external editor (not-implemented)",
            "ctrl+v       to paste image",
            "shift+enter  to insert newline",
            "/            for commands",
            "!            to run bash",
            "!!           to run bash (no context)",
        ].join("\n"),
    );

    let helpExpanded = false;
    const helpText = new Text(compactHelp, 0, 0);
    /** @param {boolean} expanded */
    function setHelpExpanded(expanded) {
        helpExpanded = expanded;
        helpText.setText(expanded ? expandedHelp : compactHelp);
    }

    if (!suppressStartupHeader) {
        // Render the logo first
        renderBootLogo(container);
        // Title line
        container.addChild(new Text(titleLine, 0, 0));
        // Help text
        container.addChild(helpText);

        // Blank lines before first message
        container.addChild(new Spacer(1));
        container.addChild(new Spacer(1));
        container.addChild(new Spacer(1));
    }

    const messageList = new Container();
    container.addChild(messageList);
    container.addChild(new Spacer(1));

    const runningTasksComponent = new SpinnerBlock();
    container.addChild(runningTasksComponent);

    /** @type {import('../session/types.js').ImageAttachment[]} */
    const pastedImages = [];
    const previewImages = new Container();
    container.addChild(previewImages);

    const editor = new Editor(tui, getEditorTheme());
    container.addChild(editor);

    // Footer
    const cwd = Deno.cwd().replace(Deno.env.get("HOME") || "", "~");
    let branch = "main";
    try {
        const cmd = new Deno.Command("git", { args: ["branch", "--show-current"] });
        const { success, stdout } = cmd.outputSync();
        if (success) {
            branch = new TextDecoder().decode(stdout).trim();
        }
    } catch (_e) {
        branch = "unknown";
    }

    const getModelAndProvider = () => {
        const settingsManager = getSettingsManager();
        const defaults = {
            model: settingsManager.getDefaultModel() ?? "",
            provider: settingsManager.getDefaultProvider() ?? "",
        };
        let { model, provider } = defaults;

        const activeModel = hostedSession.getActiveModelState();
        if (activeModel.model) {
            const slashIndex = activeModel.model.indexOf("/");
            if (slashIndex > 0) {
                provider = activeModel.model.slice(0, slashIndex);
                model = activeModel.model.slice(slashIndex + 1);
            } else {
                model = activeModel.model;
                if (activeModel.provider) {
                    provider = activeModel.provider;
                }
            }
        } else if (activeModel.provider) {
            provider = activeModel.provider;
        }

        const sessionModel = getMostRecentSessionModelParts(
            getFooterSessions(hostedSession.getRootAgentSession(), hostedSession.getSubAgentSessions()),
        );
        if (!activeModel.model && sessionModel?.model) {
            model = sessionModel.model;
            provider = sessionModel.provider || provider;
        }

        const thinkingLevel = hostedSession.getThinkingLevel();

        return { model, provider, thinkingLevel };
    };

    let ctrlCPendingExit = false;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let ctrlCPendingTimer = null;

    function markCtrlCPendingExit() {
        ctrlCPendingExit = true;
        if (ctrlCPendingTimer) clearTimeout(ctrlCPendingTimer);
        ctrlCPendingTimer = setTimeout(() => {
            ctrlCPendingExit = false;
            ctrlCPendingTimer = null;
            tui.requestRender();
        }, 1000);
        tui.requestRender();
    }

    /** @type {Map<string, string>} */
    const thinkingLevelTheme = new Map([
        ["off", "thinkingOff"],
        ["minimal", "thinkingMinimal"],
        ["low", "thinkingLow"],
        ["medium", "thinkingMedium"],
        ["high", "thinkingHigh"],
        ["xhigh", "thinkingXhigh"],
    ]);

    /**
     * @param {string} level
     * @returns {import('@earendil-works/pi-coding-agent').ThemeColor}
     */
    function getThinkingThemeToken(level) {
        return /** @type {import('@earendil-works/pi-coding-agent').ThemeColor} */ (thinkingLevelTheme.get(level) ||
            "thinkingOff");
    }

    const footer = {
        invalidate: () => {},
        /** @param {number} w */
        render: (w) => {
            const { model, provider, thinkingLevel } = getModelAndProvider();
            const modelStr = model
                ? provider && !model.startsWith(`${provider}/`) ? `${provider}/${model}` : model
                : "";
            const activeAgentName = hostedSession.getActiveAgentName() ||
                (hostedSession.getRootAgentName()
                    ? getAgentDisplayName(/** @type {string} */ (hostedSession.getRootAgentName()))
                    : "");

            // Right block (agent name) is always pinned flush to the right edge.
            // The left block (cwd/branch) is truncated when it would collide,
            // so the right segment never gets pushed inward on long content.
            const line1RightWidth = visibleWidth(activeAgentName);
            const line1LeftRaw = `${cwd} (${branch})`;
            const line1LeftMax = Math.max(0, w - line1RightWidth - 1);
            const line1Left = truncateToWidth(line1LeftRaw, line1LeftMax);
            const line1Pad = Math.max(1, w - visibleWidth(line1Left) - line1RightWidth);
            const line1 = theme.fg("dim", line1Left) +
                " ".repeat(line1Pad) +
                theme.fg("accent", activeAgentName);

            // ── Token consumption data (Pi.dev-style footer) ──
            const sessions = getFooterSessions(
                hostedSession.getRootAgentSession(),
                hostedSession.getSubAgentSessions(),
            );
            const activeUsageSession = sessions[sessions.length - 1];
            const usage = collectFooterUsage(sessions);
            let contextStr = "";

            if (activeUsageSession) {
                const contextUsage = activeUsageSession.getContextUsage?.();
                if (contextUsage) {
                    const cw = contextUsage.contextWindow ?? 0;
                    const pct = contextUsage.percent;
                    const pctDisplay = pct !== null ? `${pct.toFixed(1)}%` : "?";
                    const cwStr = formatTokens(cw);
                    const compactionSettings = activeUsageSession?.settingsManager?.getCompactionSettings?.();
                    const compactEnabled = compactionSettings ? compactionSettings.enabled : true;
                    const autoIndicator = compactEnabled ? " (Auto-compact)" : "";
                    const rawContext = `${pctDisplay}/${cwStr}${autoIndicator}`;
                    const pctValue = pct ?? 0;
                    contextStr = pctValue > 90
                        ? theme.fg("error", rawContext)
                        : pctValue > 70
                        ? theme.fg("warning", rawContext)
                        : rawContext;
                }
            }

            const statsParts = [];
            if (usage.input > 0) statsParts.push(`↑${formatTokens(usage.input)}`);
            if (usage.output > 0) statsParts.push(`↓${formatTokens(usage.output)}`);
            if (usage.cacheRead > 0) statsParts.push(`R${formatTokens(usage.cacheRead)}`);
            if (usage.cacheWrite > 0) statsParts.push(`W${formatTokens(usage.cacheWrite)}`);

            const usingSubscription = activeUsageSession?.state?.model
                ? activeUsageSession.modelRegistry?.isUsingOAuth?.(activeUsageSession.state.model)
                : false;
            if (usage.cost > 0 || usingSubscription) {
                statsParts.push(`$${usage.cost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`);
            }

            if (contextStr) statsParts.push(contextStr);
            const statsSegment = statsParts.length > 0 ? statsParts.join(" ") : "";

            const showThinkingLevel = shouldShowFooterThinkingLevel(modelStr, thinkingLevel);
            const thinkingStr = `(${thinkingLevel})`;
            const thinkingStyled = theme.fg(getThinkingThemeToken(thinkingLevel), thinkingStr);
            // Right block (model + thinking level) is always pinned flush to the
            // right edge. The left block (token stats) is truncated when it would
            // collide, so the model segment never drifts toward the middle on long
            // sessions. Widths use visibleWidth() so embedded ANSI color codes in
            // the stats segment don't throw off the padding math.
            const thinkingWidth = showThinkingLevel ? visibleWidth(thinkingStr) + 1 : 0;
            const line2RightWidth = visibleWidth(modelStr) + thinkingWidth;
            const line2LeftRaw = ctrlCPendingExit ? "Ctrl+C - Press again to exit" : statsSegment;
            const line2LeftMax = Math.max(0, w - line2RightWidth - 1);
            const line2LeftTrunc = truncateToWidth(line2LeftRaw, line2LeftMax);
            const line2LeftStyled = ctrlCPendingExit
                ? theme.fg("warning", line2LeftTrunc)
                : theme.fg("dim", line2LeftTrunc);
            const line2Pad = Math.max(1, w - visibleWidth(line2LeftTrunc) - line2RightWidth);
            const line2 = line2LeftStyled +
                " ".repeat(line2Pad) +
                theme.fg("dim", modelStr) +
                (showThinkingLevel ? " " + thinkingStyled : "");

            return [line1, line2];
        },
    };
    container.addChild(footer);

    const rootWrapper = {
        invalidate: () => container.invalidate(),
        /** @param {number} w */
        render: (w) => {
            const rightMargin = 2;

            return container.render(Math.max(10, w - rightMargin));
        },
    };

    tui.addChild(rootWrapper);
    tui.setFocus(editor);

    // ── Init state check: conditionally filter /init from slash commands ──
    const initDone = await isInitDoneFn();
    if (initDone) {
        CHAT_BUILTIN_SLASH_NAMES.delete("init");
    }

    // Load prompt-template metadata once per interactive session.
    const promptTemplates = await listPromptTemplates();

    // Load skills metadata once per interactive session.
    const skills = await listSkills();

    // Expose a UI API for agents to append to the message list
    const uiAPI = createUiApi(tui, messageList, runningTasksComponent);
    const steeringState = createSteeringState();
    steeringState.messageList = messageList;
    steeringState.tui = tui;
    steeringState.uiAPI = uiAPI;

    hostedSession.setActiveUiAPI(uiAPI);
    hostedSession.setEventSink(uiAPI);

    /**
     * @param {import('../session/hosted-session.js').HostedSession | string | undefined} hostedSessionOrAgentName
     * @param {string | import('../session/types.js').AgentMessageHandler} agentNameOrHandler
     * @param {import('../session/types.js').AgentMessageHandler | import('../ui/types.js').UiAPI} [handlerOrUiAPI]
     * @param {import('../ui/types.js').UiAPI | string} [uiAPIOrAgentModel]
     * @param {string | { allowReturnToRouter?: boolean }} [agentModelOrOptions]
     * @param {{ allowReturnToRouter?: boolean }} [agentOptions]
     */
    const setCurrentActiveAgent = (
        hostedSessionOrAgentName,
        agentNameOrHandler,
        handlerOrUiAPI,
        uiAPIOrAgentModel,
        agentModelOrOptions,
        agentOptions,
    ) => {
        const hasExplicitSession = hostedSessionOrAgentName && typeof hostedSessionOrAgentName === "object";
        const targetHostedSession = hasExplicitSession
            ? /** @type {import('../session/hosted-session.js').HostedSession} */ (hostedSessionOrAgentName)
            : hostedSession;
        const agentName = hasExplicitSession ? agentNameOrHandler : hostedSessionOrAgentName;
        const handler = hasExplicitSession ? handlerOrUiAPI : agentNameOrHandler;
        const uiAPIArg = hasExplicitSession ? uiAPIOrAgentModel : handlerOrUiAPI;
        const agentModel = hasExplicitSession ? agentModelOrOptions : uiAPIOrAgentModel;
        const nextAgentOptions = hasExplicitSession ? agentOptions : agentModelOrOptions;
        setActiveAgent(
            targetHostedSession,
            agentName,
            handler,
            uiAPIArg,
            typeof agentModel === "string" ? agentModel : undefined,
            typeof nextAgentOptions === "object" ? nextAgentOptions : undefined,
        );
    };
    /**
     * @param {import('../session/hosted-session.js').HostedSession | import('../ui/types.js').UiAPI | undefined} hostedSessionOrUiAPI
     * @param {import('../ui/types.js').UiAPI} [uiAPIArg]
     */
    const applyCurrentPendingRootSwap = (hostedSessionOrUiAPI, uiAPIArg) => {
        const hasExplicitSession = hostedSessionOrUiAPI && typeof hostedSessionOrUiAPI === "object" &&
            typeof /** @type {any} */ (hostedSessionOrUiAPI).getPendingRootSwap === "function";
        return applyPendingRootSwap(
            hasExplicitSession
                ? /** @type {import('../session/hosted-session.js').HostedSession} */ (hostedSessionOrUiAPI)
                : hostedSession,
            hasExplicitSession ? uiAPIArg : /** @type {import('../ui/types.js').UiAPI} */ (hostedSessionOrUiAPI),
        );
    };
    /** @param {string} model @param {string} [provider] */
    const setCurrentActiveModel = (model, provider) => setActiveModel(hostedSession, model, provider);

    /**
     * @param {import('../session/hosted-session.js').HostedSession} nextSession
     */
    function replaceHostedSession(nextSession) {
        const previousHostedSession = hostedSession;
        if (previousHostedSession !== nextSession) {
            if (!sessionHost.disposeSession(previousHostedSession.id)) {
                previousHostedSession.dispose();
            }
        }
        hostedSession = nextSession;
        hostedSession.setActiveUiAPI(uiAPI);
        hostedSession.setEventSink(uiAPI);
        hostedSession.setActiveOnMessage(createAgentHandler(AGENTS.ROUTER, { hostedSession }));
        hostedSession.setPendingRootSwap(null);
        hostedSession.setPendingSwitchHandoff(null);
        pastedImages.length = 0;
        previewImages.clear();
        submissionQueue.length = 0;
        clearSteeringState(steeringState);
        steeringState.messageList = messageList;
        steeringState.tui = tui;
        steeringState.uiAPI = uiAPI;
        editor.setText("");
        tui.setFocus(editor);
        tui.requestRender();
    }

    // Install chat-session-specific UiAPI methods (setAgentInfo, enableInput,
    // showModelSelector, …) BEFORE building the first root session — buildAgentSession
    // calls uiAPI.setAgentInfo() to seed the footer with the agent's display name
    // and model, and that setter only exists once the overrides are installed.
    installUiApiOverrides({
        uiAPI,
        tui,
        editor,
        container,
        messageList,
        setActiveModel: setCurrentActiveModel,
        getActiveModelState: () => hostedSession.getActiveModelState(),
    });

    const modelWelcomeResult = await maybeShowModelWelcome({
        uiAPI,
        editor,
        tui,
        hostedSession,
        sessionManager: rootSessionManager,
        ensureRootAgentSession,
        initialAgentInternalName,
        initialAgentModel: options.initialAgentModel,
        commandRegistry,
        getModelRegistry,
    });

    // ── Eagerly build the root AgentSession for the initial agent ──
    // The root persists across turns of the same agent so /compact and other long-lived
    // session operations have something to act on. setActiveAgent rebuilds the root on
    // an agent switch (applied at turn boundaries via applyPendingRootSwap).
    if (!modelWelcomeResult.shown) {
        try {
            await ensureRootAgentSession({
                hostedSession,
                agentName: initialAgentInternalName,
                modelOverride: options.initialAgentModel,
                uiAPI,
                sessionManager: rootSessionManager,
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            uiAPI.appendSystemMessage(`Failed to initialize root agent "${initialAgentInternalName}": ${msg}`);
        }
    }

    /**
     * @param {string} userRequest
     * @returns {boolean}
     */
    function isModelSetupRecoveryCommand(userRequest) {
        const commandName = userRequest.trim().slice(1).split(/\s+/, 1)[0];
        return [
            COMMAND_NAMES.LOGIN,
            COMMAND_NAMES.MODEL,
            COMMAND_NAMES.QUIT,
            COMMAND_NAMES.EXIT,
        ].includes(commandName);
    }

    let modelSetupRequired = modelWelcomeResult.noModel;

    /** @returns {boolean} */
    function shouldBlockForModelSetup() {
        if (!modelSetupRequired) return false;
        const availability = getSelectedDefaultModelAvailability(getModelRegistry, getSettingsManager);
        if (availability.available) {
            modelSetupRequired = false;
            editor.disableSubmit = false;
            return false;
        }
        return true;
    }

    /** @type {Set<string>} */
    const warnedImageRefs = new Set();

    /** @param {import('../session/types.js').ImageAttachment} image */
    function imageWarningKey(image) {
        return image.ref || image.path || `${image.mimeType}:${image.base64.slice(0, 24)}`;
    }

    /**
     * @param {import('../session/types.js').ImageAttachment[]} images
     * @returns {Promise<{ ok: true, warning?: string } | { ok: false, message: string }>}
     */
    async function preflightCurrentImages(images) {
        const session = /** @type {any} */ (hostedSession.getRootAgentSession());
        const activeModel = session?.model;
        let fallbackModelRef = undefined;
        if (images.length > 0 && !modelSupportsImageInput(activeModel)) {
            try {
                fallbackModelRef = (await resolveVisionFallbackModel(session?.modelRegistry || getModelRegistry()))
                    ?.modelRef;
            } catch (error) {
                return { ok: false, message: error instanceof Error ? error.message : String(error) };
            }
        }
        const result = preflightImageAttachments(images, { activeModel, fallbackModelRef });
        if (!result.ok) return result;
        return { ok: true, warning: result.warning };
    }

    /**
     * @param {import('../session/types.js').ImageAttachment} image
     * @returns {Promise<import('../session/types.js').ImageAttachment | null>}
     */
    async function handleImagePaste(image) {
        const persisted = await persistImageAttachment(
            image,
            /** @type {any} */ (hostedSession.getRootSessionManager()),
            Deno.cwd(),
        );
        const preflight = await preflightCurrentImages([persisted]);
        if (!preflight.ok) {
            uiAPI.appendSystemMessage(preflight.message);
            return null;
        }
        if (preflight.warning) {
            uiAPI.appendSystemMessage(preflight.warning);
            warnedImageRefs.add(imageWarningKey(persisted));
        }
        return persisted;
    }

    // ── Init auto-offer: conditionally offer /init on first TUI visit ──
    if (!sessionStartedEmptyProjectDirectory && !initDone && !modelWelcomeResult.noModel) {
        const alreadyOffered = await isInitOfferedFn();
        if (!alreadyOffered) {
            const choice = await uiAPI.promptSelect(
                "Would you like to run /init to bootstrap RunWield?",
                [
                    { value: "yes", label: "Yes" },
                    { value: "no", label: "No" },
                ],
            );

            if (choice === "yes") {
                // User accepted — run init and record success
                await commandRegistry[COMMAND_NAMES.INIT].execute([], {
                    uiAPI,
                    hostedSession,
                    sessionHost,
                    sessionManager: /** @type {any} */ (hostedSession.getRootSessionManager() || undefined),
                });
                // Dynamically hide /init from slash commands for the rest of this session
                CHAT_BUILTIN_SLASH_NAMES.delete("init");
            } else {
                // User declined or dismissed — record that init was offered
                await recordInitOfferedFn();
            }
            // Restore focus to editor after init prompt (before the wrapper is applied)
            tui.setFocus(editor);
            tui.requestRender();
        }
    }

    // ── Build autocomplete AFTER auto-offer (so /init removal is reflected) ──
    const builtinSlashInvocationNames = new Set(
        Array.from(CHAT_BUILTIN_SLASH_NAMES).flatMap((name) => getCommandInvocationNames(commandRegistry[name])),
    );
    const invokablePromptTemplates = promptTemplates.filter((template) =>
        !builtinSlashInvocationNames.has(template.name)
    );
    const blockedPromptTemplates = promptTemplates.filter((template) => builtinSlashInvocationNames.has(template.name));
    /** @type {Map<string, (typeof invokablePromptTemplates)[number]>} */
    const promptTemplateByName = new Map(invokablePromptTemplates.map((template) => [template.name, template]));

    const autocompleteProvider = new CombinedAutocompleteProvider(
        [
            ...Array.from(CHAT_BUILTIN_SLASH_NAMES).map((name) => {
                /** @type {import('@earendil-works/pi-tui').SlashCommand} */
                return {
                    name,
                    description: commandRegistry[name].description,
                    getArgumentCompletions: commandRegistry[name].getArgumentCompletions,
                };
            }),
            ...invokablePromptTemplates.map((template) => ({
                name: template.name,
                argumentHint: template.argumentHint,
                description: template.description,
            })),
            // ── Skill commands ──
            ...skills
                .filter((skill) => skill.description && skill.description !== "No description provided")
                .map((skill) => ({
                    name: `skill:${skill.name}`,
                    description: skill.description,
                })),
        ],
        Deno.cwd(),
        "fd", // Since pi 0.20 the agent guarantees that fd is available in PATH or it polyfills it so using 'fd' directly as binary path is safe.
    );
    editor.setAutocompleteProvider(autocompleteProvider);

    // Ensure modal prompts (select/text) always return focus to the editor once settled.
    const basePromptSelect = uiAPI.promptSelect?.bind(uiAPI);
    if (basePromptSelect) {
        uiAPI.promptSelect = async (title, options, hooks) => {
            const result = await basePromptSelect(title, options, hooks);
            tui.setFocus(editor);
            tui.requestRender();
            return result;
        };
    }

    const basePromptText = uiAPI.promptText?.bind(uiAPI);
    if (basePromptText) {
        uiAPI.promptText = async (title, opts) => {
            const result = await basePromptText(title, opts);
            tui.setFocus(editor);
            tui.requestRender();
            return result;
        };
    }

    // Repaint everything when the theme swaps (live preview for /theme, plus any
    // future theme-change source). Invalidate drops cached layout in Text/Markdown
    // and re-bakes themed strings in PromptSelectBlock / PromptTextBlock.
    onThemeChange(() => {
        tui.invalidate();
        tui.requestRender();
    });

    // ─── Unified Active-Operation Cancellation State ──────────────────

    /** @type {(() => void) | null} */
    let activeOperationCancel = null;

    /** @type {{ pid?: number, kill?: () => void } | null} */
    let activeBashProc = null;

    const generationGuard = createGenerationGuard();
    const generationStillCurrent = generationGuard.isCurrent;

    /** Reset UI to idle state regardless of what was running.
     *  Safe to call multiple times (idempotent). */
    function forceResetUI() {
        editor.disableSubmit = false;
        if (uiAPI.setBusy) uiAPI.setBusy(false);
        if (uiAPI.enableInput) uiAPI.enableInput();
        tui.setFocus(editor);
        tui.requestRender();
    }

    /** Cancel the currently active operation, if any.
     *  Returns true if something was actually canceled.
     */
    function cancelActiveOperation() {
        // 1. Kill running bash process
        if (activeBashProc) {
            try {
                if (activeBashProc.kill) activeBashProc.kill();
            } catch (_e) { /* ignore */ }
            activeBashProc = null;
        }
        // 2. Call registered operation cancel callback
        if (activeOperationCancel) {
            try {
                activeOperationCancel();
            } catch (_e) { /* ignore */ }
            activeOperationCancel = null;
            return true;
        }
        return false;
    }

    // @ts-ignore: TS doesn't know about pi-tui Editor internals
    editor.onFocus = () => {
        try {
            tui.requestRender();
        } catch (_e) {
            // Ignore
        }
    };
    // @ts-ignore: TS doesn't know about pi-tui Editor internals
    editor.onBlur = () => {
        try {
            tui.requestRender();
        } catch (_e) {
            // Ignore
        }
    };
    editor.onChange = () => {
        try {
            tui.requestRender();
        } catch (_e) {
            // Ignore
        }
    };

    /** Force-unset the focused component and resolve any hanging prompt promise.
     *  Calling abortActivePrompt settles the promise with null, so the async chain
     *  can gracefully unspool instead of waiting forever. */
    function dismissActivePrompt() {
        if (uiAPI.abortActivePrompt) {
            uiAPI.abortActivePrompt();
        }
        tui.setFocus(editor);
    }

    // Handle Editor events
    /** @type {Array<{text: string, images: import('../session/types.js').ImageAttachment[], block?: SystemMessageBlock, spacer?: Spacer}>} */
    const submissionQueue = [];
    let isProcessingSubmission = false;

    /** Pop the most recent queued submission and restore it into the editor.
     *  Returns true if a queued message was dequeued. */
    function dequeueLastSubmission() {
        if (submissionQueue.length === 0) return false;
        const item = submissionQueue.pop();
        if (!item) return false;
        if (item.block) messageList.removeChild(item.block);
        if (item.spacer) messageList.removeChild(item.spacer);
        editor.setText(item.text);
        if (item.images && item.images.length > 0) {
            for (const img of item.images) {
                pastedImages.push(img);
                previewImages.addChild(
                    new Text(theme.fg("dim", `[Attached image: ${img.mimeType}]`)),
                );
            }
        }
        tui.requestRender();
        return true;
    }

    async function processSubmissions() {
        if (isProcessingSubmission) return;
        isProcessingSubmission = true;

        while (submissionQueue.length > 0) {
            const item = submissionQueue.shift();
            if (!item) continue;
            const { text, images: savedImages } = item;
            await executeUserRequest(text, savedImages);
        }

        isProcessingSubmission = false;
        forceResetUI();
    }

    // Handle Editor events
    /**
     * @param {string} userRequest
     * @param {import('../session/types.js').ImageAttachment[]} savedImages
     */
    async function submitToActiveRoot(userRequest, savedImages) {
        // Generation gating
        const thisGen = generationGuard.bump();

        uiAPI.appendUserMessage?.(userRequest);
        savedImages.forEach((/** @type {import('../session/types.js').ImageAttachment} */ img) => {
            if (uiAPI.appendImage) uiAPI.appendImage(img.base64, img.mimeType);
        });

        try {
            await runScopedSubmitHandoffLoop({
                hostedSession,
                uiAPI,
                initialRequest: userRequest,
                initialImages: savedImages,
                applyPendingRootSwapImpl: applyCurrentPendingRootSwap,
            });
        } catch (err) {
            if (generationStillCurrent(thisGen)) {
                uiAPI.appendSystemMessage(
                    `Error: ${err instanceof Error ? err.message : String(err)}`,
                );
            }
        } finally {
            // Drain any pending root swap recorded during the last turn (covers the
            // case where the agent queued a swap but didn't call return_to_router).
            await applyCurrentPendingRootSwap(uiAPI);
        }
    }

    /**
     * @param {string} text
     * @param {import('../session/types.js').ImageAttachment[]} savedImages
     */
    async function executeUserRequest(text, savedImages) {
        const userRequest = text.trim();
        if (!userRequest) return;

        editor.addToHistory?.(userRequest);

        // Slash commands (`/builtin` or `/template`)
        const handledSlash = await handleSlashCommand({
            userRequest,
            savedImages,
            hostedSession,
            sessionHost,
            uiAPI,
            editor,
            tui,
            sessionStartedAt,
            originalHandleInput,
            builtinNames: CHAT_BUILTIN_SLASH_NAMES,
            promptTemplateByName,
            skills,
            chatPromptAgentName: CHAT_PROMPT_AGENT_NAME,
            resolveTemplateModel,
            setActiveAgent: setCurrentActiveAgent,
            applyPendingRootSwap: applyCurrentPendingRootSwap,
            dispatchExpandedUserRequest: submitToActiveRoot,
            setActiveModel: setCurrentActiveModel,
            replaceHostedSession,
            generationGuard,
            registerOperationCancel: (cancel) => {
                activeOperationCancel = cancel;
            },
        });
        if (handledSlash) return;

        await submitToActiveRoot(userRequest, savedImages);
    }

    editor.onSubmit = async (text) => {
        // end the logo blink and make it static
        endBlink();

        const userRequest = text.trim();
        if (!userRequest) return;

        if (shouldBlockForModelSetup() && !(userRequest.startsWith("/") && isModelSetupRecoveryCommand(userRequest))) {
            uiAPI.appendSystemMessage(
                "Choose a default model before sending chat messages. Run /model to select a model, run /login to configure credentials, or quit with /quit.",
                true,
                "RunWield",
            );
            editor.disableSubmit = false;
            tui.setFocus(editor);
            tui.requestRender();
            return;
        }

        const images = [...pastedImages];
        if (images.length > 0) {
            const preflight = await preflightCurrentImages(images);
            if (!preflight.ok) {
                uiAPI.appendSystemMessage(preflight.message);
                tui.requestRender();
                return;
            }
            const unwarnedImages = images.filter((image) => !warnedImageRefs.has(imageWarningKey(image)));
            if (preflight.warning && unwarnedImages.length > 0) {
                uiAPI.appendSystemMessage(preflight.warning);
                for (const image of unwarnedImages) warnedImageRefs.add(imageWarningKey(image));
            }
        }

        editor.addToHistory?.(userRequest);

        pastedImages.length = 0;
        previewImages.clear();
        editor.setText("");

        // Bash interception (`!cmd` / `!!cmd`) runs ahead of the steering and
        // queueing paths so a stray `!` typed during a model turn is executed
        // locally instead of being sent as steering text.
        if (userRequest.startsWith("!")) {
            handleBashCommand({
                userRequest,
                uiAPI,
                tui,
                editor,
                getSessionManager: () => /** @type {any} */ (hostedSession.getRootSessionManager()),
                generationGuard,
                registerBashProc: (proc) => {
                    activeBashProc = proc;
                },
                concurrent: isProcessingSubmission,
            }).catch(() => {/* swallow — UI already surfaces errors */});
            return;
        }

        if (isProcessingSubmission) {
            if (userRequest === "/model" || userRequest.startsWith("/model ")) {
                uiAPI.appendSystemMessage(
                    "I'm not able to change the model right now wait until idle or cancel with Esc.",
                    false,
                    "RunWield",
                );
                return;
            }

            steerRootSessionWithTarget(hostedSession, userRequest, images).then((steeredSession) => {
                if (steeredSession) {
                    // Phase 1: Show "Steering:" system block immediately
                    const block = new SystemMessageBlock(userRequest, false, "Steering:");
                    const spacer = new Spacer(1);
                    messageList.addChild(block);
                    messageList.addChild(spacer);
                    // Track for phase 2 transition when consumed by LLM
                    trackPendingSteeringMessage(steeringState, steeredSession, userRequest, images, block, spacer);
                } else {
                    // Add the visual block manually (bypassing appendSystemMessage's coalescing)
                    // so we can remove this exact block if the user dequeues with up-arrow.
                    const block = new SystemMessageBlock(userRequest, false, "Queued message:");
                    const spacer = new Spacer(1);
                    messageList.addChild(block);
                    messageList.addChild(spacer);
                    submissionQueue.push({ text: userRequest, images, block, spacer });
                }
                tui.requestRender();
            }).catch((_err) => {
                // On error (e.g. extension command rejected by session.steer()),
                // fall back to queuing for next submission
                const block = new SystemMessageBlock(userRequest, false, "Queued message (steer failed):");
                const spacer = new Spacer(1);
                messageList.addChild(block);
                messageList.addChild(spacer);
                submissionQueue.push({ text: userRequest, images, block, spacer });
                tui.requestRender();
            });
            return;
        }

        submissionQueue.push({ text: userRequest, images });
        processSubmissions();
    };

    // Initialize thinking level from settings
    const settingsManager = getSettingsManager();
    const savedThinkingLevel = settingsManager.getDefaultThinkingLevel();
    if (savedThinkingLevel) {
        hostedSession.setThinkingLevel(savedThinkingLevel);
    }

    // Ordered thinking levels for cycling
    /** @type {("off" | "minimal" | "low" | "medium" | "high" | "xhigh")[]} */
    const THINKING_LEVELS = [
        "off",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
    ];

    /** Cycle the thinking level and persist to settings */
    async function cycleThinkingLevel() {
        // If an active agent session exists, delegate to it for model-aware cycling
        const session = /** @type {any} */ (hostedSession.getRootAgentSession());
        if (session) {
            const newLevel = session.cycleThinkingLevel();
            if (newLevel === undefined) {
                uiAPI.appendSystemMessage("Current model does not support thinking");
                return;
            }
            hostedSession.setThinkingLevel(newLevel);
            await persistThinkingLevel(newLevel);
            tui.requestRender();
            return;
        }
        // No active session: cycle through levels directly and persist
        const current = hostedSession.getThinkingLevel();
        const currentIdx = THINKING_LEVELS.indexOf(current);
        const nextIdx = (currentIdx + 1) % THINKING_LEVELS.length;
        const nextLevel = THINKING_LEVELS[nextIdx];
        hostedSession.setThinkingLevel(nextLevel);
        await persistThinkingLevel(nextLevel);
        tui.requestRender();
    }

    // Re-render UI after handling pasted images
    tui.requestRender();

    const originalHandleInput = installKeybindings({
        editor,
        tui,
        uiAPI,
        pastedImages,
        previewImages,
        submissionQueue,
        generationGuard,
        cancelActiveOperation,
        dismissActivePrompt,
        dequeueLastSubmission,
        forceResetUI,
        markCtrlCPendingExit,
        isCtrlCPendingExit: () => ctrlCPendingExit,
        toggleStartupHelp: () => setHelpExpanded(!helpExpanded),
        cycleThinkingLevel,
        handleImagePaste,
        abortActiveSession: () => abortActiveSession(hostedSession),
        clearPendingSteeringMessages: () => {
            steeringState.pendingMessages.clear();
            for (const unsubscribe of steeringState.pendingUnsubs.values()) {
                unsubscribe();
            }
            steeringState.pendingUnsubs.clear();
            // Also flush any stale steering messages from the agent's queue
            const session = /** @type {any} */ (hostedSession.getRootAgentSession());
            if (session) {
                try {
                    session.clearQueue();
                } catch (_e) { /* ignore */ }
            }
        },
    });

    if (!suppressStartupHeader && sessionStartedEmptyProjectDirectory && !initialUserRequest) {
        uiAPI.appendSystemMessage(
            EMPTY_PROJECT_DIRECTORY_WELCOME_BODY,
            false,
            EMPTY_PROJECT_DIRECTORY_HEADER,
            { headingColor: "success", bodyColor: "accent" },
        );
    } else if (!suppressStartupHeader && !modelWelcomeResult.suppressBootBanner) {
        await renderBootBanner({
            uiAPI,
            invokablePromptTemplates,
            blockedPromptTemplates,
            chatPromptAgentName: CHAT_PROMPT_AGENT_NAME,
        });
    }

    // Hydrate TUI from persisted root-session history (e.g. --continue)
    // Keep this after startup system notices so those appear first.
    restorePersistedMessagesToUi(/** @type {any} */ (hostedSession.getRootSessionManager()), uiAPI, { hostedSession });

    // Trigger initial user request
    if (initialUserRequest) {
        editor.setText(initialUserRequest);
        editor.onSubmit(initialUserRequest);
    }

    return uiAPI;
}
