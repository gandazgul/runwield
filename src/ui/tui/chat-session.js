/**
 * @module ui/tui/chat-session
 * High-level interactive loop for the TUI. This manages the long-running
 * user interaction — distinct from individual agent invocations (see session.js).
 */

import {
    CombinedAutocompleteProvider,
    Container,
    Editor,
    Image,
    Spacer,
    Text,
    truncateToWidth,
    visibleWidth,
} from "@earendil-works/pi-tui";
import { initTUI } from "./tui.js";
import { setTerminalTitleForSession } from "./terminal-title.js";
import {
    applyPersistedTheme,
    getEditorTheme,
    imageTheme,
    initRunWieldTheme,
    onThemeChange,
    theme,
} from "../theme/theme.js";
import { VERSION } from "../../shared/version.js";
import { endBlink, renderBootLogo } from "./boot-logo.js";
import { createUiApi } from "./api.js";
import { attachTuiRuntimeAdapter } from "./runtime-adapter.js";
import { SpinnerBlock, SystemMessageBlock } from "./blocks.js";
import {
    ensureRootAgentSession,
    listPromptTemplates,
    listSkills,
    steerRootSessionWithTarget,
} from "../../shared/session/session.js";
import { ensureMnemosyneBinary } from "../../shared/runtime-preflight.js";
import { commandRegistry, getCommandInvocationNames, getSlashCommandDefinitions } from "../../cmd/registry.js";
import { AGENTS } from "../../constants.js";
import {
    EMPTY_PROJECT_DIRECTORY_HEADER,
    EMPTY_PROJECT_DIRECTORY_PROMPT_NOTE,
    EMPTY_PROJECT_DIRECTORY_WELCOME_BODY,
    isEmptyProjectDirectory,
} from "../../shared/project-state.js";
import { COMMAND_NAMES } from "../../cmd/registry.js";
import { getAgentDisplayName, listAvailableAgents } from "../../shared/session/agents.js";
import { createAgentHandler } from "../../shared/session/agent-handler.js";
import { getModelRegistry } from "../../shared/models/model-registry.js";
import { getSettingsManager, initSettings } from "../../shared/settings.js";
import {
    isInitDone as isInitDoneFn,
    isInitOffered as isInitOfferedFn,
    recordInitOffered as recordInitOfferedFn,
} from "../../cmd/init/init-state.js";
import { SessionHost } from "../../shared/session/session-host.js";
import { SessionRuntime, SessionTurnInProgressError } from "../../shared/session/session-runtime.js";
import { applyPendingRootSwap, setActiveAgent } from "../../shared/session/agent-switching.js";
import { resolveTemplateModel } from "../../shared/models/model-validation.js";
import { createRootSessionManager } from "../../shared/session/root-session.js";
import { createGenerationGuard } from "./generation-guard.js";
import { restorePersistedMessagesToUi } from "./message-hydration.js";
import { installUiApiOverrides } from "./ui-api-overrides.js";
import { renderBootBanner } from "./boot-banner.js";
import { getSelectedDefaultModelAvailability, maybeShowModelWelcome } from "./model-welcome.js";
import { handleBashCommand } from "./bash-interceptor.js";
import { handleSlashCommand } from "./slash-dispatch.js";
import { installKeybindings } from "./keybindings.js";
import { cancelActivePlanReview } from "../../shared/workflow/submit-plan.js";
import {
    formatImageAttachmentMarker,
    modelSupportsImageInput,
    persistImageAttachment,
    preflightImageAttachments,
    resolveVisionFallbackModel,
} from "../../shared/session/image-attachments.js";

const CHAT_PROMPT_AGENT_NAME = AGENTS.OPERATOR;

/** @type {(projectRoot?: string) => ReturnType<typeof getSettingsManager>} */
let getSettingsManagerForPersistence = getSettingsManager;

/**
 * Test-only hook for code paths that persist model/thinking selections.
 *
 * @param {((projectRoot?: string) => ReturnType<typeof getSettingsManager>) | null} provider
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

const FOOTER_WORKFLOW_EXCLUDED_AGENT_NAMES = new Set([AGENTS.IDEATOR, AGENTS.OPERATOR, AGENTS.GUIDE]);
const FOOTER_WORKFLOW_EXCLUDED_DISPLAY_NAMES = new Set(["ideator", "operator", "guide"]);

const FOOTER_ROUTING_META = new Map([
    ["QUICK_FIX", { label: "Quick Fix", token: "routingQuickFix" }],
    ["FEATURE", { label: "Feature", token: "routingFeature" }],
    ["PROJECT", { label: "Epic", token: "routingEpic" }],
]);

const FOOTER_COMPLEXITY_META = new Map([
    ["LOW", { label: "Low", token: "complexityLow" }],
    ["MEDIUM", { label: "Medium", token: "complexityMedium" }],
    ["HIGH", { label: "High", token: "complexityHigh" }],
]);

/**
 * @typedef {Object} FooterWorkflowPart
 * @property {string} text
 * @property {string} token
 */

/**
 * @param {{ displayName?: string, agentName?: string } | null | undefined} agentInfo
 * @returns {boolean}
 */
export function shouldShowFooterWorkflowContext(agentInfo) {
    const agentName = typeof agentInfo?.agentName === "string" ? agentInfo.agentName.trim().toLowerCase() : "";
    if (agentName) return !FOOTER_WORKFLOW_EXCLUDED_AGENT_NAMES.has(agentName);
    const displayName = typeof agentInfo?.displayName === "string" ? agentInfo.displayName.trim().toLowerCase() : "";
    return !FOOTER_WORKFLOW_EXCLUDED_DISPLAY_NAMES.has(displayName);
}

/**
 * @param {FooterWorkflowPart[]} parts
 * @returns {string}
 */
export function getFooterWorkflowLabelText(parts) {
    return parts.map((part) => part.text).join("");
}

/**
 * @param {{ displayName?: string, agentName?: string } | null | undefined} agentInfo
 * @param {{ routingIntent?: string, complexity?: string, planName?: string } | null | undefined} workflowContext
 * @param {number} maxWidth
 * @returns {FooterWorkflowPart[]}
 */
export function buildFooterWorkflowLabelParts(agentInfo, workflowContext, maxWidth = Infinity) {
    const agentName = typeof agentInfo?.displayName === "string" && agentInfo.displayName.trim()
        ? agentInfo.displayName.trim()
        : "";
    const width = Number.isFinite(maxWidth) ? Math.max(0, Math.floor(maxWidth)) : Infinity;
    if (!agentName || width <= 0) return [];

    const routeMeta = FOOTER_ROUTING_META.get(String(workflowContext?.routingIntent || ""));
    const complexityMeta = FOOTER_COMPLEXITY_META.get(String(workflowContext?.complexity || ""));
    const planName = typeof workflowContext?.planName === "string" ? workflowContext.planName.trim() : "";
    const showContext = shouldShowFooterWorkflowContext(agentInfo);
    const showRouting = Boolean(showContext && routeMeta && complexityMeta);
    const showPlan = showContext && Boolean(planName);

    if (!showRouting && !showPlan) {
        return [{ text: truncateToWidth(agentName, width), token: "accent" }];
    }

    /**
     * @param {{ includeComplexity: boolean, includePlan: boolean, planText?: string }} options
     * @returns {FooterWorkflowPart[]}
     */
    function compose(options) {
        /** @type {FooterWorkflowPart[]} */
        const parts = [{ text: agentName, token: "accent" }];
        if (showRouting) {
            parts.push({ text: " - ", token: "dim" });
            if (options.includeComplexity) {
                parts.push({
                    text: /** @type {{ label: string }} */ (complexityMeta).label,
                    token: /** @type {{ token: string }} */ (complexityMeta).token,
                });
                parts.push({ text: " ", token: "dim" });
            }
            parts.push({
                text: /** @type {{ label: string }} */ (routeMeta).label,
                token: /** @type {{ token: string }} */ (routeMeta).token,
            });
        }
        if (options.includePlan) {
            parts.push({ text: " - ", token: "dim" });
            parts.push({ text: options.planText || planName, token: "dim" });
        }
        return parts;
    }

    let parts = compose({ includeComplexity: true, includePlan: showPlan });
    if (visibleWidth(getFooterWorkflowLabelText(parts)) <= width) return parts;

    if (showPlan) {
        const withoutPlan = compose({ includeComplexity: true, includePlan: false });
        const prefixWidth = visibleWidth(getFooterWorkflowLabelText(withoutPlan)) + visibleWidth(" - ");
        const planMax = width - prefixWidth;
        if (planMax > 0) {
            parts = compose({
                includeComplexity: true,
                includePlan: true,
                planText: truncateToWidth(planName, planMax),
            });
            if (visibleWidth(getFooterWorkflowLabelText(parts)) <= width) return parts;
        }
        parts = withoutPlan;
        if (visibleWidth(getFooterWorkflowLabelText(parts)) <= width) return parts;
    }

    if (showRouting) {
        parts = compose({ includeComplexity: false, includePlan: false });
        if (visibleWidth(getFooterWorkflowLabelText(parts)) <= width) return parts;
    }

    return [{ text: truncateToWidth(getFooterWorkflowLabelText(parts), width), token: "accent" }];
}

/**
 * @param {FooterWorkflowPart[]} parts
 * @param {{ fg?: (token: import('@earendil-works/pi-coding-agent').ThemeColor, text: string) => string }} [themeImpl]
 * @returns {string}
 */
export function renderFooterWorkflowLabelParts(parts, themeImpl = theme) {
    return parts.map((part) => {
        const token = /** @type {import('@earendil-works/pi-coding-agent').ThemeColor} */ (part.token);
        return themeImpl.fg ? themeImpl.fg(token, part.text) : part.text;
    }).join("");
}

/**
 * @param {{ displayName?: string, agentName?: string } | null | undefined} agentInfo
 * @param {{ routingIntent?: string, complexity?: string, planName?: string } | null | undefined} workflowContext
 * @param {string} leftRaw
 * @param {number} width
 * @returns {{ left: string, rightParts: FooterWorkflowPart[] }}
 */
export function buildFooterLine1Parts(agentInfo, workflowContext, leftRaw, width) {
    const priorityRightParts = buildFooterWorkflowLabelParts(
        agentInfo,
        workflowContext ? { ...workflowContext, planName: "" } : workflowContext,
        Infinity,
    );
    const priorityRightWidth = visibleWidth(getFooterWorkflowLabelText(priorityRightParts));
    const leftMax = Math.max(0, width - priorityRightWidth - 1);
    const left = truncateToWidth(leftRaw, leftMax);
    const rightMax = Math.max(0, width - visibleWidth(left) - 1);
    return {
        left,
        rightParts: buildFooterWorkflowLabelParts(agentInfo, workflowContext, rightMax),
    };
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
 * @property {import('../../shared/session/types.js').ImageAttachment[]} images
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
 * @property {import('./types.js').UiAPI | undefined} uiAPI
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
 * @param {string} text
 * @param {import('../../shared/session/types.js').ImageAttachment[]} images
 * @returns {string}
 */
export function formatSteeringBlockText(text, images) {
    if (images.length === 0) return text;
    const markers = images.map(formatImageAttachmentMarker).join("\n");
    if (!text.trim()) return markers;
    return `${text}\n\n${markers}`;
}

/**
 * @param {import('../../shared/session/types.js').ImageAttachment} image
 * @returns {Image}
 */
function createPastedImagePreview(image) {
    return new Image(image.base64, image.mimeType, imageTheme, {
        filename: image.ref || image.path || image.mimeType,
        maxWidthCells: 30,
        maxHeightCells: 10,
    });
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
 * @param {import('../../shared/session/types.js').ImageAttachment[]} images
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
 * @param {import('./types.js').UiAPI} uiAPI
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

export { applyPendingRootSwap, setActiveAgent };

/**
 * @param {import('../../shared/session/hosted-session.js').HostedSession} hostedSession
 * @param {string} model
 * @param {string} [provider]
 * @param {SessionRuntime} [runtime]
 */
export async function setActiveModel(hostedSession, model, provider, runtime) {
    if (runtime) runtime.setSessionModel(hostedSession, model, provider || "", true);
    else hostedSession.setActiveModelState(model, provider || "", true);

    try {
        const settingsManager = getSettingsManagerForPersistence(hostedSession.cwd);
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

    if (!runtime) (/** @type {any} */ (hostedSession.getActiveUiAPIState()))?.requestRender();
}

/**
 * @param {"off" | "minimal" | "low" | "medium" | "high" | "xhigh"} level
 * @param {string} [projectRoot]
 */
export async function persistThinkingLevel(level, projectRoot) {
    try {
        const settingsManager = getSettingsManagerForPersistence(projectRoot);
        await settingsManager.setDefaultThinkingLevel(level);
    } catch (e) {
        console.error(`Failed to persist thinking level: ${e}`);
    }
}

/**
 * Get the active UI API reference.
 * @returns {import('../../shared/types.js').SessionUiPort | null}
 */
/**
 * @param {import('../../shared/session/hosted-session.js').HostedSession} [hostedSession]
 * @returns {any}
 */
export function getActiveUiAPI(hostedSession = undefined) {
    return hostedSession?.getActiveUiAPIState?.() || null;
}

/**
 * Get the active model identifier (may include provider prefix).
 * @param {import('../../shared/session/hosted-session.js').HostedSession} hostedSession
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
 * @param {import('../../shared/session/hosted-session.js').HostedSession} args.hostedSession
 * @param {import('./types.js').UiAPI} args.uiAPI
 * @param {string} args.initialRequest
 * @param {import('../../shared/session/types.js').ImageAttachment[]} args.initialImages
 * @param {(uiAPI: import('../../shared/types.js').SessionUiPort) => Promise<void>} args.applyPendingRootSwapImpl
 */
export async function runScopedSubmitHandoffLoop(
    { hostedSession, uiAPI, initialRequest, initialImages, applyPendingRootSwapImpl },
) {
    const runtime = new SessionRuntime({
        applyPendingRootSwap: (
            /** @type {import('../../shared/session/hosted-session.js').HostedSession} */ _hostedSession,
            /** @type {import('../../shared/types.js').SessionUiPort | undefined} */ targetUiAPI,
        ) => applyPendingRootSwapImpl(/** @type {import('../../shared/types.js').SessionUiPort} */ (targetUiAPI)),
    });
    const adapter = attachTuiRuntimeAdapter({ runtime, hostedSession, uiAPI });
    try {
        await runtime.promptSession(hostedSession, { initialRequest, initialImages });
    } finally {
        adapter.dispose();
    }
}

/**
 * Starts the interactive TUI loop.
 * @param {string | null} initialUserRequest
 * @param {import('../../shared/session/types.js').AgentMessageHandler | null} onMessage - Handler for user submissions
 * @param {{ sessionStartMode?: "new" | "continue", initialAgentName?: string, initialAgentModel?: string }} [options]
 */
export async function startInteractiveSession(initialUserRequest, onMessage, options = {}) {
    CHAT_BUILTIN_SLASH_NAMES = new Set(
        getSlashCommandDefinitions().map((command) => command.name),
    );

    const sessionHost = new SessionHost();
    const sessionRuntime = new SessionRuntime({ sessionHost });
    const rootSessionManager = await createRootSessionManager(options.sessionStartMode || "new", Deno.cwd());
    let hostedSession = sessionRuntime.createSession({ sessionManager: rootSessionManager, cwd: Deno.cwd() });
    let runtimeUiAPI = sessionRuntime.getSessionUiPort(hostedSession);
    sessionRuntime.attachRuntimeEventSink(hostedSession);
    hostedSession.setActiveUiAPI(runtimeUiAPI);
    initSettings(hostedSession.cwd);
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
    await listAvailableAgents(hostedSession.cwd);

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

    /** @type {import('../../shared/session/types.js').ImageAttachment[]} */
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
        const settingsManager = getSettingsManager(hostedSession.cwd);
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
            const activeAgentInfo = hostedSession.getActiveAgentInfo?.() || {
                displayName: hostedSession.getActiveAgentName() ||
                    (hostedSession.getRootAgentName()
                        ? getAgentDisplayName(
                            /** @type {string} */ (hostedSession.getRootAgentName()),
                            hostedSession.cwd,
                        )
                        : ""),
                agentName: hostedSession.getRootAgentName() || "",
            };

            // Right block (agent/workflow label) is always pinned flush to the
            // right edge. The left block (cwd/branch) is truncated when it would
            // collide, so the right segment never gets pushed inward on long
            // content.
            const line1LeftRaw = `${cwd} (${branch})`;
            const { left: line1Left, rightParts: line1RightParts } = buildFooterLine1Parts(
                activeAgentInfo,
                hostedSession.getWorkflowContext?.(),
                line1LeftRaw,
                w,
            );
            const line1RightText = getFooterWorkflowLabelText(line1RightParts);
            const line1RightWidth = visibleWidth(line1RightText);
            const line1Pad = Math.max(1, w - visibleWidth(line1Left) - line1RightWidth);
            const line1 = theme.fg("dim", line1Left) +
                " ".repeat(line1Pad) +
                renderFooterWorkflowLabelParts(line1RightParts);

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
    const promptTemplates = await listPromptTemplates({ cwd: hostedSession.cwd });

    // Load skills metadata once per interactive session.
    const skills = await listSkills({ cwd: hostedSession.cwd });

    // Expose a UI API for agents to append to the message list
    const uiAPI = createUiApi(tui, messageList, runningTasksComponent);
    const steeringState = createSteeringState();
    steeringState.messageList = messageList;
    steeringState.tui = tui;
    steeringState.uiAPI = uiAPI;

    let tuiRuntimeAdapter = attachTuiRuntimeAdapter({ runtime: sessionRuntime, hostedSession, uiAPI });

    /**
     * @param {import('../../shared/session/hosted-session.js').HostedSession | string | undefined} hostedSessionOrAgentName
     * @param {string | import('../../shared/session/types.js').AgentMessageHandler} agentNameOrHandler
     * @param {import('../../shared/session/types.js').AgentMessageHandler | import('./types.js').UiAPI} [handlerOrUiAPI]
     * @param {import('./types.js').UiAPI | string} [uiAPIOrAgentModel]
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
            ? /** @type {import('../../shared/session/hosted-session.js').HostedSession} */ (hostedSessionOrAgentName)
            : hostedSession;
        const agentName = hasExplicitSession ? agentNameOrHandler : hostedSessionOrAgentName;
        const handler = hasExplicitSession ? handlerOrUiAPI : agentNameOrHandler;
        const agentModel = hasExplicitSession ? agentModelOrOptions : uiAPIOrAgentModel;
        const nextAgentOptions = hasExplicitSession ? agentOptions : agentModelOrOptions;
        setActiveAgent(
            targetHostedSession,
            /** @type {string} */ (agentName),
            handler,
            sessionRuntime.getSessionUiPort(targetHostedSession),
            typeof agentModel === "string" ? agentModel : undefined,
            typeof nextAgentOptions === "object" ? nextAgentOptions : undefined,
        );
    };
    /**
     * @param {import('../../shared/session/hosted-session.js').HostedSession | import('./types.js').UiAPI | undefined} hostedSessionOrUiAPI
     * @param {import('./types.js').UiAPI} [_uiAPIArg]
     */
    const applyCurrentPendingRootSwap = (hostedSessionOrUiAPI, _uiAPIArg) => {
        const hasExplicitSession = hostedSessionOrUiAPI && typeof hostedSessionOrUiAPI === "object" &&
            typeof /** @type {any} */ (hostedSessionOrUiAPI).getPendingRootSwap === "function";
        const targetHostedSession = hasExplicitSession
            ? /** @type {import('../../shared/session/hosted-session.js').HostedSession} */ (hostedSessionOrUiAPI)
            : hostedSession;
        return applyPendingRootSwap(targetHostedSession, sessionRuntime.getSessionUiPort(targetHostedSession));
    };
    /** @param {string} model @param {string} [provider] */
    const setCurrentActiveModel = (model, provider) => setActiveModel(hostedSession, model, provider, sessionRuntime);

    /**
     * @param {import('../../shared/session/hosted-session.js').HostedSession} nextSession
     */
    function replaceHostedSession(nextSession) {
        const previousHostedSession = hostedSession;
        if (previousHostedSession !== nextSession) {
            tuiRuntimeAdapter.dispose();
            if (!sessionRuntime.closeSession(previousHostedSession.id).closed) {
                previousHostedSession.dispose();
            }
        }
        if (!sessionRuntime.getSession(nextSession.id)) sessionRuntime.adoptSession(nextSession);
        hostedSession = nextSession;
        runtimeUiAPI = sessionRuntime.getSessionUiPort(hostedSession);
        hostedSession.setActiveUiAPI(runtimeUiAPI);
        tuiRuntimeAdapter = attachTuiRuntimeAdapter({ runtime: sessionRuntime, hostedSession, uiAPI });
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
        __deps: { getSettingsManager: () => getSettingsManager(hostedSession.cwd) },
    });

    const modelWelcomeResult = await maybeShowModelWelcome({
        uiAPI,
        editor,
        tui,
        hostedSession,
        sessionManager: rootSessionManager,
        ensureRootAgentSession: (opts) => ensureRootAgentSession({ ...opts, uiAPI: runtimeUiAPI }),
        initialAgentInternalName,
        initialAgentModel: options.initialAgentModel,
        commandRegistry,
        getModelRegistry,
        getSettingsManager: () => getSettingsManager(hostedSession.cwd),
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
                uiAPI: runtimeUiAPI,
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
        const availability = getSelectedDefaultModelAvailability(
            getModelRegistry,
            () => getSettingsManager(hostedSession.cwd),
        );
        if (availability.available) {
            modelSetupRequired = false;
            editor.disableSubmit = false;
            return false;
        }
        return true;
    }

    /** @type {Set<string>} */
    const warnedImageRefs = new Set();

    /** @param {import('../../shared/session/types.js').ImageAttachment} image */
    function imageWarningKey(image) {
        return image.ref || image.path || `${image.mimeType}:${image.base64.slice(0, 24)}`;
    }

    /**
     * @param {import('../../shared/session/types.js').ImageAttachment[]} images
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
     * @param {import('../../shared/session/types.js').ImageAttachment} image
     * @returns {Promise<import('../../shared/session/types.js').ImageAttachment | null>}
     */
    async function handleImagePaste(image) {
        const persisted = await persistImageAttachment(
            image,
            /** @type {any} */ (hostedSession.getRootSessionManager()),
            hostedSession.cwd,
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
        hostedSession.cwd,
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
    /** @type {Array<{text: string, images: import('../../shared/session/types.js').ImageAttachment[], block?: SystemMessageBlock, spacer?: Spacer}>} */
    const submissionQueue = [];
    let isProcessingSubmission = false;

    /**
     * Restore a queued item into the editor.
     *
     * @param {{ text: string, images: import('../../shared/session/types.js').ImageAttachment[] }} item
     */
    function restoreQueuedItemToEditor(item) {
        editor.setText(item.text);
        if (item.images && item.images.length > 0) {
            for (const img of item.images) {
                pastedImages.push(img);
                previewImages.addChild(createPastedImagePreview(img));
            }
        }
    }

    /**
     * Remove a pending steering entry's visual block.
     *
     * @param {PendingSteeringEntry} entry
     */
    function removePendingSteeringVisual(entry) {
        messageList.removeChild(entry.systemBlock);
        messageList.removeChild(entry.spacer);
    }

    /**
     * Pop the most recent queued submission or pending steering message and
     * restore it into the editor. Returns true if a message was dequeued.
     */
    function dequeueLastSubmission() {
        if (submissionQueue.length > 0) {
            const item = submissionQueue.pop();
            if (!item) return false;
            if (item.block) messageList.removeChild(item.block);
            if (item.spacer) messageList.removeChild(item.spacer);
            restoreQueuedItemToEditor(item);
            tui.requestRender();
            return true;
        }

        const pendingEntries = Array.from(steeringState.pendingMessages.entries());
        const selected = pendingEntries[pendingEntries.length - 1];
        if (!selected) return false;

        const [selectedId, selectedEntry] = selected;
        try {
            selectedEntry.session.clearQueue?.();
        } catch (_e) { /* ignore */ }

        for (const [id, entry] of pendingEntries) {
            if (entry.session !== selectedEntry.session) continue;
            removePendingSteeringVisual(entry);
            steeringState.pendingMessages.delete(id);
            if (id === selectedId) continue;

            const block = new SystemMessageBlock(
                formatSteeringBlockText(entry.text, entry.images),
                false,
                "Queued message:",
            );
            const spacer = new Spacer(1);
            messageList.addChild(block);
            messageList.addChild(spacer);
            submissionQueue.push({ text: entry.text, images: entry.images, block, spacer });
        }
        cleanupSteeringSubscriptionIfIdle(steeringState, selectedEntry.session);
        restoreQueuedItemToEditor(selectedEntry);
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
     * @param {import('../../shared/session/types.js').ImageAttachment[]} savedImages
     */
    async function submitToActiveRoot(userRequest, savedImages) {
        // Generation gating
        const thisGen = generationGuard.bump();

        savedImages.forEach((/** @type {import('../../shared/session/types.js').ImageAttachment} */ img) => {
            if (uiAPI.appendImage) uiAPI.appendImage(img.base64, img.mimeType);
        });
        try {
            await sessionRuntime.promptSession(hostedSession, {
                initialRequest: userRequest,
                initialImages: savedImages,
            });
        } catch (err) {
            if (generationStillCurrent(thisGen) && err instanceof SessionTurnInProgressError) {
                uiAPI.appendSystemMessage(
                    `Error: ${err instanceof Error ? err.message : String(err)}`,
                );
            }
        }
    }

    /**
     * @param {string} text
     * @param {import('../../shared/session/types.js').ImageAttachment[]} savedImages
     */
    async function executeUserRequest(text, savedImages) {
        const userRequest = text.trim();
        if (!userRequest && savedImages.length === 0) return;

        if (userRequest) editor.addToHistory?.(userRequest);

        // Slash commands (`/builtin` or `/template`)
        const handledSlash = userRequest
            ? await handleSlashCommand({
                userRequest,
                savedImages,
                hostedSession,
                sessionHost,
                sessionRuntime,
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
            })
            : false;
        if (handledSlash) return;

        await submitToActiveRoot(userRequest, savedImages);
    }

    editor.onSubmit = async (text) => {
        // end the logo blink and make it static
        endBlink();

        const userRequest = text.trim();
        const images = [...pastedImages];
        if (!userRequest && images.length === 0) return;

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

        if (userRequest) editor.addToHistory?.(userRequest);

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
                cwd: hostedSession.cwd,
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
                    const block = new SystemMessageBlock(
                        formatSteeringBlockText(userRequest, images),
                        false,
                        "Steering:",
                    );
                    const spacer = new Spacer(1);
                    messageList.addChild(block);
                    messageList.addChild(spacer);
                    // Track for phase 2 transition when consumed by LLM
                    trackPendingSteeringMessage(steeringState, steeredSession, userRequest, images, block, spacer);
                } else {
                    // Add the visual block manually (bypassing appendSystemMessage's coalescing)
                    // so we can remove this exact block if the user dequeues with up-arrow.
                    const block = new SystemMessageBlock(
                        formatSteeringBlockText(userRequest, images),
                        false,
                        "Queued message:",
                    );
                    const spacer = new Spacer(1);
                    messageList.addChild(block);
                    messageList.addChild(spacer);
                    submissionQueue.push({ text: userRequest, images, block, spacer });
                }
                tui.requestRender();
            }).catch((_err) => {
                // On error (e.g. extension command rejected by session.steer()),
                // fall back to queuing for next submission
                const block = new SystemMessageBlock(
                    formatSteeringBlockText(userRequest, images),
                    false,
                    "Queued message (steer failed):",
                );
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
    const settingsManager = getSettingsManager(hostedSession.cwd);
    const savedThinkingLevel = settingsManager.getDefaultThinkingLevel();
    if (savedThinkingLevel) {
        sessionRuntime.setSessionThinkingLevel(hostedSession, savedThinkingLevel);
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
            sessionRuntime.setSessionThinkingLevel(hostedSession, newLevel);
            await persistThinkingLevel(newLevel, hostedSession.cwd);
            tui.requestRender();
            return;
        }
        // No active session: cycle through levels directly and persist
        const current = hostedSession.getThinkingLevel();
        const currentIdx = THINKING_LEVELS.indexOf(current);
        const nextIdx = (currentIdx + 1) % THINKING_LEVELS.length;
        const nextLevel = THINKING_LEVELS[nextIdx];
        sessionRuntime.setSessionThinkingLevel(hostedSession, nextLevel);
        await persistThinkingLevel(nextLevel, hostedSession.cwd);
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
        abortActiveSession: () => sessionRuntime.cancelSession(hostedSession).aborted,
        cancelActivePlanReview: () => cancelActivePlanReview(hostedSession),
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
            projectRoot: hostedSession.cwd,
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
