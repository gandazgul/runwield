/**
 * @module ui/tui/runtime-adapter
 * Renders one SessionRuntime event stream into the terminal UI.
 */

import { RuntimeEventTypes } from "../../shared/session/session-runtime-events.js";
import { formatImageAttachmentMarker } from "../../shared/session/image-attachments.js";
import { createTuiInteractionAdapter } from "./runtime-interaction-adapter.js";
import { setTerminalTitleForName } from "./terminal-title.js";
import { notifyRunWieldEventQuietly } from "./system-notifications.js";

const HIDDEN_TOOL_BLOCK_NAMES = new Set(["task_completed", "review_complete", "user_interview"]);

/**
 * @typedef {Object} TuiRuntimeAdapterRegistration
 * @property {() => void} dispose
 */

/** @type {WeakMap<import('../../shared/session/session-runtime.js').SessionRuntime, Map<string, TuiRuntimeAdapterRegistration>>} */
const activeAdapters = new WeakMap();

/**
 * @typedef {Object} TuiRuntimeAdapterOptions
 * @property {import('../../shared/session/session-runtime.js').SessionRuntime} runtime
 * @property {string} sessionId
 * @property {import('./types.js').UiAPI} uiAPI
 * @property {typeof notifyRunWieldEventQuietly} [notifyRunWieldEvent]
 * @property {(replacement: { oldSessionId: string, newSessionId: string }) => void} [onSessionReplaced]
 */

/**
 * @param {import('../../shared/session/session-runtime-events.js').RuntimeQueuedMessage} message
 * @returns {string}
 */
export function formatQueuedMessageText(message) {
    if (message.images.length === 0) return message.text;
    const markers = message.images.map(formatImageAttachmentMarker).join("\n");
    if (!message.text.trim()) return markers;
    return `${message.text}\n\n${markers}`;
}

/**
 * @param {TuiRuntimeAdapterOptions} options
 * @returns {{ dispose: () => void }}
 */
export function attachTuiRuntimeAdapter({
    runtime,
    sessionId,
    uiAPI,
    notifyRunWieldEvent = notifyRunWieldEventQuietly,
    onSessionReplaced,
}) {
    let registrations = activeAdapters.get(runtime);
    if (!registrations) {
        registrations = new Map();
        activeAdapters.set(runtime, registrations);
    }
    if (registrations.has(sessionId)) {
        throw new Error(`A TUI Runtime adapter is already attached to session ${sessionId}`);
    }

    /** @type {Map<string, import('./types.js').AgentMessageAppender>} */
    const assistantMessages = new Map();
    /** @type {Map<string, ReturnType<NonNullable<import('./types.js').UiAPI['appendThinkingStart']>>>} */
    const thinkingMessages = new Map();
    const interactionAdapter = createTuiInteractionAdapter(uiAPI);
    runtime.setInteractionAdapter(sessionId, interactionAdapter);

    const initialSnapshot = runtime.getSessionSnapshot(sessionId);
    let currentRoutingIntent = initialSnapshot?.workflowContext?.routingIntent || null;
    let validationSessionActive = false;
    let terminalValidationPanelVisible = false;
    let hiddenValidationReportCached = false;
    const shouldCacheValidationReport = () => {
        if (validationSessionActive) return true;
        return currentRoutingIntent === "FEATURE" || currentRoutingIntent === "PROJECT" ||
            currentRoutingIntent === "QUICK_FIX";
    };
    const unsubscribe = runtime.subscribeSessionEvents(sessionId, (event) => {
        const value = /** @type {any} */ (event);
        switch (event.type) {
            case RuntimeEventTypes.SESSION_REPLACED:
                onSessionReplaced?.({ oldSessionId: value.oldSessionId, newSessionId: value.newSessionId });
                break;
            case RuntimeEventTypes.USER_MESSAGE:
                if (terminalValidationPanelVisible) {
                    uiAPI.clearValidationPanel?.();
                    terminalValidationPanelVisible = false;
                    validationSessionActive = false;
                    hiddenValidationReportCached = false;
                } else if (!validationSessionActive && hiddenValidationReportCached) {
                    uiAPI.clearValidationPanel?.();
                    hiddenValidationReportCached = false;
                }
                uiAPI.appendUserMessage?.(value.text);
                for (const image of value.images) uiAPI.appendImage?.(image.base64, image.mimeType);
                break;
            case RuntimeEventTypes.QUEUED_MESSAGE_CHANGED: {
                const message =
                    /** @type {import('../../shared/session/session-runtime-events.js').RuntimeQueuedMessage} */ (
                        value.message
                    );
                if (value.status === "queued") {
                    uiAPI.appendQueuedMessage?.(message.id, formatQueuedMessageText(message));
                    break;
                }
                uiAPI.removeQueuedMessage?.(message.id);
                break;
            }
            case RuntimeEventTypes.ASSISTANT_TEXT_DELTA: {
                if (value.workflowMessage === "task_completed" && shouldCacheValidationReport()) {
                    uiAPI.updateValidationReport?.("engineer", {
                        agentName: value.agentName,
                        markdown: value.delta,
                    });
                    hiddenValidationReportCached ||= !validationSessionActive;
                }
                if (value.workflowMessage === "review_complete" && shouldCacheValidationReport()) {
                    uiAPI.updateValidationReport?.("reviewer", {
                        agentName: value.agentName,
                        markdown: value.delta,
                        approved: value.approved,
                    });
                    hiddenValidationReportCached ||= !validationSessionActive;
                }
                if (value.messageKind === "review_result" && uiAPI.appendReviewResult) {
                    uiAPI.appendReviewResult(
                        value.agentName,
                        value.delta,
                        value.approved,
                    );
                    break;
                }
                const messageId = value.messageId;
                let appender = assistantMessages.get(messageId);
                if (!appender) {
                    appender = uiAPI.appendAgentMessageStart(value.agentName);
                    assistantMessages.set(messageId, appender);
                }
                appender.appendText(value.delta);
                break;
            }
            case RuntimeEventTypes.ASSISTANT_THINKING_DELTA: {
                if (!uiAPI.appendThinkingStart) break;
                const messageId = value.messageId;
                let appender = thinkingMessages.get(messageId);
                if (!appender) {
                    appender = uiAPI.appendThinkingStart();
                    thinkingMessages.set(messageId, appender);
                }
                appender.appendDelta(value.delta);
                break;
            }
            case RuntimeEventTypes.ASSISTANT_THINKING_END: {
                const messageId = value.messageId;
                thinkingMessages.get(messageId)?.end();
                thinkingMessages.delete(messageId);
                break;
            }
            case RuntimeEventTypes.TOOL_START: {
                if (!uiAPI.startToolExecution || HIDDEN_TOOL_BLOCK_NAMES.has(value.toolName)) break;
                uiAPI.startToolExecution(value.toolCallId, value.toolName, value.title);
                break;
            }
            case RuntimeEventTypes.TOOL_UPDATE: {
                const block = uiAPI.getActiveToolBlock?.(value.toolCallId);
                block?.setOutput(value.output);
                break;
            }
            case RuntimeEventTypes.TOOL_END: {
                const block = uiAPI.getActiveToolBlock?.(value.toolCallId);
                if (block) {
                    block.setOutput(value.output);
                    block.endExecution(value.isError, value.durationMs);
                }
                break;
            }
            case RuntimeEventTypes.SYSTEM_STATUS:
                if (value.validationProgress) {
                    validationSessionActive = true;
                    hiddenValidationReportCached = false;
                    uiAPI.updateValidationProgress?.(value.validationProgress);
                    terminalValidationPanelVisible = ["verified", "failed"].includes(value.validationProgress.outcome);
                }
                uiAPI.appendSystemMessage(
                    value.message,
                    value.level === "error",
                    value.header,
                );
                break;
            case RuntimeEventTypes.TERMINAL_ERROR:
                if (validationSessionActive || terminalValidationPanelVisible || hiddenValidationReportCached) {
                    uiAPI.clearValidationPanel?.();
                    validationSessionActive = false;
                    terminalValidationPanelVisible = false;
                    hiddenValidationReportCached = false;
                }
                uiAPI.appendSystemMessage(value.message, true);
                break;
            case RuntimeEventTypes.CANCELLATION:
                if (value.message) uiAPI.appendSystemMessage(value.message, false, "RunWield");
                break;
            case RuntimeEventTypes.BUSY_CHANGED:
                uiAPI.setBusy?.(value.busy);
                break;
            case RuntimeEventTypes.AGENT_CHANGED:
                uiAPI.requestRender();
                break;
            case RuntimeEventTypes.KEYBOARD_HELP:
                uiAPI.showKeyboardHelp?.({
                    title: value.title,
                    items: value.items,
                });
                break;
            case RuntimeEventTypes.INPUT_STATE_CHANGED:
                if (value.enabled) uiAPI.enableInput?.();
                else uiAPI.disableInput?.();
                break;
            case RuntimeEventTypes.MESSAGES_CLEARED:
                terminalValidationPanelVisible = false;
                validationSessionActive = false;
                hiddenValidationReportCached = false;
                uiAPI.clearMessages?.();
                break;
            case RuntimeEventTypes.TURN_END:
                assistantMessages.clear();
                for (const appender of thinkingMessages.values()) appender.end();
                thinkingMessages.clear();
                break;
            case RuntimeEventTypes.MODEL_CHANGED:
            case RuntimeEventTypes.THINKING_LEVEL_CHANGED:
                uiAPI.requestRender();
                break;
            case RuntimeEventTypes.WORKFLOW_CONTEXT_CHANGED:
                currentRoutingIntent = value.workflowContext?.routingIntent || null;
                uiAPI.requestRender();
                break;
            case RuntimeEventTypes.USAGE:
                uiAPI.requestRender();
                break;
            case RuntimeEventTypes.SESSION_RENAMED:
                setTerminalTitleForName(value.name);
                uiAPI.requestRender();
                break;
            case RuntimeEventTypes.ATTENTION_REQUESTED: {
                notifyRunWieldEvent(value.reason, {
                    sessionName: value.sessionName,
                    agentName: value.agentName,
                });
                break;
            }
        }
    });

    for (const message of initialSnapshot?.queuedMessages || []) {
        uiAPI.appendQueuedMessage?.(message.id, formatQueuedMessageText(message));
    }

    let disposed = false;
    const registration = {
        dispose() {
            if (disposed) return;
            disposed = true;
            unsubscribe();
            for (const appender of thinkingMessages.values()) appender.end();
            thinkingMessages.clear();
            assistantMessages.clear();
            if (registrations.get(sessionId) !== registration) return;
            registrations.delete(sessionId);
            interactionAdapter.cancelAll?.();
            runtime.setInteractionAdapter(sessionId, null);
        },
    };
    registrations.set(sessionId, registration);
    return registration;
}
