/**
 * @module ui/tui/runtime-adapter
 * Renders one Hosted Session's semantic runtime events into the terminal UI.
 */

import { RuntimeEventTypes } from "../../shared/session/session-runtime-events.js";
import { createTuiInteractionAdapter } from "./runtime-interaction-adapter.js";
import { setTerminalTitleForName } from "./terminal-title.js";
import { notifyRunWieldEventQuietly } from "./system-notifications.js";

const HIDDEN_TOOL_BLOCK_NAMES = new Set(["task_completed", "review_complete", "user_interview"]);

/**
 * @typedef {Object} TuiRuntimeAdapterRegistration
 * @property {() => void} dispose
 */

/** @type {WeakMap<import('../../shared/session/hosted-session.js').HostedSession, TuiRuntimeAdapterRegistration>} */
const activeAdapters = new WeakMap();

/**
 * @typedef {Object} TuiRuntimeAdapterOptions
 * @property {import('../../shared/session/session-runtime.js').SessionRuntime} runtime
 * @property {import('../../shared/session/hosted-session.js').HostedSession} hostedSession
 * @property {import('./types.js').UiAPI} uiAPI
 * @property {typeof notifyRunWieldEventQuietly} [notifyRunWieldEvent]
 */

/** @param {unknown} value @returns {string} */
function textValue(value) {
    return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
}

/**
 * @param {import('./types.js').ToolExecutionBlockApi} block
 * @param {string} text
 */
function appendToolText(block, text) {
    if (!text) return;
    const current = block.bodyText || "";
    if (text.startsWith(current)) {
        block.appendOutput(text.slice(current.length));
        return;
    }
    block.appendOutput(text);
}

/**
 * @param {TuiRuntimeAdapterOptions} options
 * @returns {{ dispose: () => void }}
 */
export function attachTuiRuntimeAdapter({
    runtime,
    hostedSession,
    uiAPI,
    notifyRunWieldEvent = notifyRunWieldEventQuietly,
}) {
    activeAdapters.get(hostedSession)?.dispose();

    /** @type {Map<string, import('./types.js').AgentMessageAppender>} */
    const assistantMessages = new Map();
    /** @type {Map<string, ReturnType<NonNullable<import('./types.js').UiAPI['appendThinkingStart']>>>} */
    const thinkingMessages = new Map();

    runtime.attachRuntimeEventSink(hostedSession);
    runtime.setInteractionAdapter(hostedSession, createTuiInteractionAdapter(uiAPI), { kind: "tui" });

    const unsubscribe = runtime.subscribeSessionEvents(hostedSession, (event) => {
        const value = /** @type {any} */ (event);
        switch (event.type) {
            case RuntimeEventTypes.USER_MESSAGE:
                uiAPI.appendUserMessage?.(textValue(value.text));
                break;
            case RuntimeEventTypes.ASSISTANT_TEXT_DELTA: {
                if (value._meta?.reviewResult && uiAPI.appendReviewResult) {
                    uiAPI.appendReviewResult(
                        textValue(value._meta.agentName),
                        textValue(value.delta),
                        Boolean(value._meta.approved),
                    );
                    break;
                }
                const messageId = value.messageId || event.turnId || `${event.sessionId}:assistant`;
                let appender = assistantMessages.get(messageId);
                if (!appender) {
                    appender = uiAPI.appendAgentMessageStart(textValue(value._meta?.agentName));
                    assistantMessages.set(messageId, appender);
                }
                appender.appendText(textValue(value.delta));
                break;
            }
            case RuntimeEventTypes.ASSISTANT_THINKING_DELTA: {
                if (!uiAPI.appendThinkingStart) break;
                const messageId = value.messageId || event.turnId || `${event.sessionId}:thinking`;
                let appender = thinkingMessages.get(messageId);
                if (!appender) {
                    appender = uiAPI.appendThinkingStart();
                    thinkingMessages.set(messageId, appender);
                }
                appender.appendDelta(textValue(value.delta));
                break;
            }
            case RuntimeEventTypes.ASSISTANT_THINKING_END: {
                const messageId = value.messageId || event.turnId || `${event.sessionId}:thinking`;
                thinkingMessages.get(messageId)?.end();
                thinkingMessages.delete(messageId);
                break;
            }
            case RuntimeEventTypes.TOOL_START: {
                if (!uiAPI.startToolExecution || HIDDEN_TOOL_BLOCK_NAMES.has(value.toolName)) break;
                const displayName = value.toolName === "bash" ? "$" : textValue(value.toolName);
                const title = textValue(value.title);
                const prefix = displayName ? `${displayName} ` : "";
                const args = title === displayName ? "" : title.startsWith(prefix) ? title.slice(prefix.length) : title;
                uiAPI.startToolExecution(value.toolCallId, displayName, args);
                break;
            }
            case RuntimeEventTypes.TOOL_UPDATE: {
                const block = uiAPI.getActiveToolBlock?.(value.toolCallId);
                if (block) appendToolText(block, textValue(value.text));
                break;
            }
            case RuntimeEventTypes.TOOL_END: {
                const block = uiAPI.getActiveToolBlock?.(value.toolCallId);
                if (block) {
                    appendToolText(block, textValue(value.text));
                    block.endExecution(Boolean(value.isError), Date.now() - block.startTime);
                }
                break;
            }
            case RuntimeEventTypes.SYSTEM_STATUS:
                uiAPI.appendSystemMessage(
                    textValue(value.message),
                    value.level === "error",
                    textValue(value._meta?.header),
                    value._meta?.style,
                );
                break;
            case RuntimeEventTypes.TERMINAL_ERROR:
                uiAPI.appendSystemMessage(textValue(value.message || value.error), true);
                break;
            case RuntimeEventTypes.CANCELLATION:
                if (value.reason && value.reason !== "session_cancel") {
                    uiAPI.appendSystemMessage(textValue(value.reason));
                }
                break;
            case RuntimeEventTypes.BUSY_CHANGED:
                uiAPI.setBusy?.(Boolean(value.busy));
                break;
            case RuntimeEventTypes.AGENT_CHANGED:
                uiAPI.setAgentInfo?.(textValue(value.agentName), textValue(value.model));
                break;
            case RuntimeEventTypes.INPUT_STATE_CHANGED:
                if (value.enabled) uiAPI.enableInput?.();
                else uiAPI.disableInput?.();
                break;
            case RuntimeEventTypes.RUNNING_TASKS_CHANGED:
                uiAPI.setRunningTasks?.(value.tasks || []);
                break;
            case RuntimeEventTypes.MESSAGES_CLEARED:
                uiAPI.clearMessages?.();
                break;
            case RuntimeEventTypes.TURN_END:
                assistantMessages.clear();
                for (const appender of thinkingMessages.values()) appender.end();
                thinkingMessages.clear();
                break;
            case RuntimeEventTypes.MODEL_CHANGED:
            case RuntimeEventTypes.THINKING_LEVEL_CHANGED:
            case RuntimeEventTypes.USAGE:
                uiAPI.requestRender();
                break;
            case RuntimeEventTypes.SESSION_RENAMED:
                setTerminalTitleForName(value.name);
                uiAPI.requestRender();
                break;
            case RuntimeEventTypes.ATTENTION_REQUESTED: {
                const sessionManager = hostedSession.getRootSessionManager?.();
                notifyRunWieldEvent(value.reason, {
                    sessionName: sessionManager?.getSessionName?.(),
                    agentName: value.agentName,
                });
                break;
            }
        }
    });

    let disposed = false;
    const registration = {
        dispose() {
            if (disposed) return;
            disposed = true;
            unsubscribe();
            for (const appender of thinkingMessages.values()) appender.end();
            thinkingMessages.clear();
            assistantMessages.clear();
            if (activeAdapters.get(hostedSession) !== registration) return;
            activeAdapters.delete(hostedSession);
            runtime.setInteractionAdapter(hostedSession, null, null);
        },
    };
    activeAdapters.set(hostedSession, registration);
    return registration;
}
