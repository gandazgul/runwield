/**
 * @module shared/session/session-runtime-ui
 * Compatibility presentation port that translates legacy workflow UI calls
 * into adapter-neutral SessionRuntime events and interactions.
 */

import { RuntimeEventTypes } from "./session-runtime-events.js";
import { RuntimeInteractionTypes } from "./session-runtime-interactions.js";

/**
 * @typedef {Object} RuntimeUiBridgeOptions
 * @property {{ emitSessionEvent: Function, requestInteraction: Function }} runtime
 * @property {import('./hosted-session.js').HostedSession} hostedSession
 */

/**
 * @param {RuntimeUiBridgeOptions} options
 * @returns {import('../types.js').SessionUiPort & { _runtimeEventBridge: true }}
 */
export function createRuntimeSessionUi({ runtime, hostedSession }) {
    /** @type {Map<string, import('../types.js').RuntimeToolExecutionPort>} */
    const toolBlocks = new Map();
    let outputSuppressed = false;

    /** @param {Partial<import('./session-runtime-events.js').SessionRuntimeEvent> & { type: string }} event */
    const emit = (event) => runtime.emitSessionEvent(hostedSession, event);

    return {
        _runtimeEventBridge: true,
        appendSystemMessage(text, isError = false, header = "", style = undefined) {
            if (outputSuppressed) return;
            emit({
                type: RuntimeEventTypes.SYSTEM_STATUS,
                level: isError ? "error" : "info",
                message: String(text),
                _meta: {
                    ...(header ? { header } : {}),
                    ...(style ? { style } : {}),
                },
            });
        },
        appendAgentMessageStart(agentName) {
            const messageId = crypto.randomUUID();
            return {
                appendText(delta) {
                    if (outputSuppressed) return;
                    emit({
                        type: RuntimeEventTypes.ASSISTANT_TEXT_DELTA,
                        messageId,
                        delta,
                        _meta: agentName ? { agentName } : {},
                    });
                },
            };
        },
        appendThinkingStart() {
            const messageId = crypto.randomUUID();
            return {
                appendDelta(delta) {
                    if (outputSuppressed) return;
                    emit({ type: RuntimeEventTypes.ASSISTANT_THINKING_DELTA, messageId, delta });
                },
                end() {
                    emit({ type: RuntimeEventTypes.ASSISTANT_THINKING_END, messageId });
                },
            };
        },
        appendUserMessage(text) {
            if (!outputSuppressed) emit({ type: RuntimeEventTypes.USER_MESSAGE, text });
        },
        appendImage(_base64, mimeType) {
            if (!outputSuppressed) {
                emit({
                    type: RuntimeEventTypes.SYSTEM_STATUS,
                    message: `[Image attached: ${mimeType}]`,
                    _meta: { imageAttachment: true, mimeType },
                });
            }
        },
        requestRender() {},
        advanceSpinner() {},
        setBusy(busy) {
            if (hostedSession.isTurnActive()) return;
            emit({ type: RuntimeEventTypes.BUSY_CHANGED, busy });
        },
        setRunningTasks(tasks) {
            emit({ type: RuntimeEventTypes.RUNNING_TASKS_CHANGED, tasks });
        },
        clearMessages() {
            emit({ type: RuntimeEventTypes.MESSAGES_CLEARED });
        },
        async promptSelect(title, options) {
            const response = await runtime.requestInteraction(hostedSession, {
                type: RuntimeInteractionTypes.SELECT,
                prompt: title,
                options,
            });
            return response.outcome === "selected" ? String(response.value ?? "") : null;
        },
        async promptText(title, options = {}) {
            const response = await runtime.requestInteraction(hostedSession, {
                type: RuntimeInteractionTypes.TEXT,
                prompt: title,
                defaultValue: options.defaultValue,
                placeholder: options.placeholder,
                allowEmpty: options.allowEmpty,
            });
            return response.outcome === "text" ? String(response.value ?? "") : null;
        },
        showModelSelector() {
            emit({
                type: RuntimeEventTypes.SYSTEM_STATUS,
                level: "warning",
                message: "Model selection is controlled by the connected client.",
                _meta: { actionRequired: "model_selection" },
            });
        },
        setAgentInfo(agentName, agentModel = "") {
            emit({ type: RuntimeEventTypes.AGENT_CHANGED, agentName, model: agentModel });
        },
        disableInput() {
            emit({ type: RuntimeEventTypes.INPUT_STATE_CHANGED, enabled: false });
        },
        enableInput() {
            emit({ type: RuntimeEventTypes.INPUT_STATE_CHANGED, enabled: true });
        },
        startToolExecution(id, name, args) {
            const block = {
                bodyText: "",
                startTime: Date.now(),
                /** @param {string} text */
                appendOutput(text) {
                    const delta = String(text || "");
                    this.bodyText = `${this.bodyText || ""}${delta}`;
                    emit({
                        type: RuntimeEventTypes.TOOL_UPDATE,
                        toolCallId: id,
                        toolName: name,
                        text: delta,
                    });
                },
                /** @param {boolean} isError @param {number} _durationMs */
                endExecution(isError, _durationMs) {
                    emit({
                        type: RuntimeEventTypes.TOOL_END,
                        toolCallId: id,
                        toolName: name,
                        isError,
                        text: this.bodyText,
                    });
                    toolBlocks.delete(id);
                },
            };
            toolBlocks.set(id, block);
            emit({
                type: RuntimeEventTypes.TOOL_START,
                toolCallId: id,
                toolName: name,
                title: `${name} ${args}`.trim(),
            });
            return block;
        },
        appendReviewResult(agentName, markdown, approved) {
            const messageId = crypto.randomUUID();
            emit({
                type: RuntimeEventTypes.ASSISTANT_TEXT_DELTA,
                messageId,
                delta: markdown,
                _meta: { agentName, reviewResult: true, approved },
            });
        },
        getActiveToolBlock(id) {
            return toolBlocks.get(id);
        },
        toggleToolOutputsExpanded() {},
        addToolInvoked() {},
        addToolResult() {},
        isOutputSuppressed() {
            return outputSuppressed;
        },
        suppressOutput() {
            outputSuppressed = true;
        },
        abortActivePrompt() {
            hostedSession.cancelActiveInteractions();
        },
    };
}

/**
 * Suppresses sub-session output while preserving harmless render invalidation.
 * This is a core presentation port, not a TUI implementation.
 *
 * @param {Pick<import('../types.js').SessionUiPort, 'requestRender'> | undefined} [parent]
 * @returns {import('../types.js').SessionUiPort}
 */
export function createSilentSessionUi(parent) {
    return {
        appendSystemMessage() {},
        appendAgentMessageStart() {
            return { appendText() {} };
        },
        appendThinkingStart() {
            return { appendDelta() {}, end() {} };
        },
        appendUserMessage() {},
        appendImage() {},
        requestRender() {
            parent?.requestRender?.();
        },
        advanceSpinner() {},
        setBusy() {},
        setRunningTasks() {},
        clearMessages() {},
        promptSelect() {
            return Promise.resolve(null);
        },
        promptText() {
            return Promise.resolve(null);
        },
        showModelSelector() {},
        setAgentInfo() {},
        disableInput() {},
        enableInput() {},
        startToolExecution() {
            return { appendOutput() {}, endExecution() {}, bodyText: "", startTime: Date.now() };
        },
        appendReviewResult() {},
        getActiveToolBlock() {
            return undefined;
        },
        toggleToolOutputsExpanded() {},
        addToolInvoked() {},
        addToolResult() {},
        isOutputSuppressed() {
            return false;
        },
        suppressOutput() {},
        abortActivePrompt() {},
    };
}
