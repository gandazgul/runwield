import { Spacer } from "@earendil-works/pi-tui";
import { getSettingsManager } from "../settings.js";
import {
    AgentMessageBlock,
    PromptSelectBlock,
    PromptTextBlock,
    SystemMessageBlock,
    ThinkingBlock,
    ToolExecutionBlock,
    UserPromptBlock,
} from "./blocks.js";

/**
 * Returns a fully-stubbed UiAPI whose methods all no-op. Use to suppress
 * output for parallel subagents that share the parent UI but should not
 * stream their own thinking/text blocks. Implements every method on the
 * UiAPI surface so adding a new method to api.js doesn't silently fall
 * through to stdout in subagent contexts.
 *
 * @returns {import('./types.js').UiAPI}
 */
export function createSilentUiApi() {
    return {
        appendThinkingStart: () => ({ appendDelta: () => {}, end: () => {} }),
        appendUserMessage: () => {},
        appendAgentMessageStart: () => ({ appendText: () => {} }),
        appendImage: () => {},
        appendSystemMessage: () => {},
        startToolExecution: () => ({
            appendOutput: () => {},
            endExecution: () => {},
            bodyText: "",
            startTime: Date.now(),
        }),
        toggleToolOutputsExpanded: () => {},
        getActiveToolBlock: () => undefined,
        requestRender: () => {},
        advanceSpinner: () => {},
        setBusy: () => {},
        setRunningTasks: () => {},
        clearMessages: () => {},
        promptSelect: () => Promise.resolve(null),
        promptText: () => Promise.resolve(null),
        showModelSelector: () => {},
        setAgentInfo: () => {},
        disableInput: () => {},
        enableInput: () => {},
        isOutputSuppressed: () => true,
        suppressOutput: () => {},
        abortActivePrompt: () => {},
    };
}

/**
 * Like createSilentUiApi(), but keeps footer-facing session state live by
 * allowing runAgentSession to push agent/model info and by forwarding renders.
 *
 * @param {Pick<import('./types.js').UiAPI, 'requestRender'> | undefined} parentUiAPI
 * @returns {import('./types.js').UiAPI}
 */
export function createFooterOnlyUiApi(parentUiAPI) {
    const uiAPI = createSilentUiApi();
    return {
        ...uiAPI,
        requestRender: () => parentUiAPI?.requestRender?.(),
        isOutputSuppressed: () => false,
    };
}

/**
 * Creates a UiAPI object for RunWield TUI.
 *
 * @param {import('@earendil-works/pi-tui').TUI} tui
 * @param {import('@earendil-works/pi-tui').Container} messageList
 * @param {import('./blocks.js').SpinnerBlock} spinner
 * @returns {import('./types.js').UiAPI}
 */
export function createUiApi(tui, messageList, spinner) {
    const activeToolBlocks = new Map();

    let isBusy = false;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let spinnerTimer = null;

    /** @type {(() => void) | null} */
    let activePromptCancel = null;

    let toolsExpanded = false;
    let outputSuppressed = false;

    /** Recursive setTimeout loop — self-terminates when isBusy is cleared. */
    const runSpinner = () => {
        if (!isBusy) {
            spinnerTimer = null;
            return;
        }
        spinner.advance();
        tui.requestRender();
        spinnerTimer = setTimeout(runSpinner, 80);
    };

    return {
        /**
         * Start streaming a thinking block into the message list.
         * @returns {{ appendDelta: (delta: string) => void, end: () => void }}
         */
        appendThinkingStart: () => {
            if (outputSuppressed) {
                return { appendDelta: () => {}, end: () => {} };
            }
            const hidden = getSettingsManager().getHideThinkingBlock?.() ?? false;
            const block = new ThinkingBlock({ hidden });
            messageList.addChild(block);
            messageList.addChild(new Spacer(1));
            tui.requestRender();
            return {
                /** @param {string} delta */
                appendDelta: (delta) => {
                    block.appendText(delta);
                    tui.requestRender();
                },
                end: () => {
                    block.end();
                    tui.requestRender();
                },
            };
        },

        /** @param {string} text */
        appendUserMessage: (text) => {
            if (outputSuppressed) return;
            const block = new UserPromptBlock(text);
            messageList.addChild(block);
            messageList.addChild(new Spacer(1));
            tui.requestRender();
        },

        /** @param {string} agentName */
        appendAgentMessageStart: (agentName) => {
            if (outputSuppressed) {
                return {
                    appendText: () => {},
                };
            }
            const block = new AgentMessageBlock(agentName);
            messageList.addChild(block);
            messageList.addChild(new Spacer(1));
            tui.requestRender();
            return {
                /** @param {string} delta */
                appendText: (delta) => {
                    block.appendText(delta);
                    tui.requestRender();
                },
            };
        },

        /**
         * @param {string} text
         * @param {boolean} [isError=false]
         * @param {string} [header='']
         * @param {{ headingColor?: string, bodyColor?: string }} [style]
         */
        appendSystemMessage: (text, isError = false, header = "", style = {}) => {
            if (outputSuppressed) return;
            const children = messageList.children;
            let lastBlockIndex = children.length - 1;
            if (lastBlockIndex >= 0 && children[lastBlockIndex] instanceof Spacer) {
                lastBlockIndex--;
            }

            const lastBlock = lastBlockIndex >= 0 ? children[lastBlockIndex] : null;

            if (
                lastBlock instanceof SystemMessageBlock && lastBlock.isError === isError &&
                JSON.stringify(lastBlock.style) === JSON.stringify(style)
            ) {
                lastBlock.appendText(text, header, style);
                tui.requestRender();
                return;
            }

            const block = new SystemMessageBlock(text, isError, header, style);
            messageList.addChild(block);
            messageList.addChild(new Spacer(1));
            tui.requestRender();
        },

        /**
         * @param {string} id
         * @param {string} name
         * @param {string} argsStr
         */
        startToolExecution: (id, name, argsStr) => {
            if (outputSuppressed) {
                return {
                    appendOutput: () => {},
                    endExecution: () => {},
                    bodyText: "",
                    startTime: Date.now(),
                };
            }
            const block = new ToolExecutionBlock(name, argsStr);
            block.setExpanded(toolsExpanded);
            activeToolBlocks.set(id, block);
            messageList.addChild(block);
            messageList.addChild(new Spacer(1));
            tui.requestRender();
            return block;
        },

        toggleToolOutputsExpanded: () => {
            toolsExpanded = !toolsExpanded;
            for (const block of activeToolBlocks.values()) {
                block.setExpanded(toolsExpanded);
            }
            tui.requestRender();
        },

        getActiveToolBlock: (id) => {
            return activeToolBlocks.get(id);
        },

        requestRender: () => {
            if (outputSuppressed) return;
            tui.requestRender();
        },

        advanceSpinner: () => {
            if (outputSuppressed) return;
            spinner.advance();
            tui.requestRender();
        },

        /** @param {boolean} busy */
        setBusy: (busy) => {
            if (outputSuppressed && busy) return;

            isBusy = busy;
            spinner.setBusy(busy, spinner.tasks);

            if (busy && !spinnerTimer) {
                runSpinner();
            } else if (!busy && spinnerTimer) {
                clearTimeout(spinnerTimer);
                spinnerTimer = null;
            }
            tui.requestRender();
        },

        /** @param {Array<{task: number, assignee: string, description: string}>} tasks */
        setRunningTasks: (tasks) => {
            spinner.tasks = tasks;
            if (!outputSuppressed) tui.requestRender();
        },

        /** Forcefully cancel the active prompt, resolving its promise with null. */
        abortActivePrompt: () => {
            if (activePromptCancel) {
                activePromptCancel();
                activePromptCancel = null;
            }
        },

        /**
         * @param {string} title
         * @param {Array<{value: string, label: string}>} options
         * @param {{ onSelectionChange?: (value: string) => void, layout?: import('@earendil-works/pi-tui').SelectListLayoutOptions, hint?: string }} [hooks]
         */
        promptSelect: (title, options, hooks) => {
            return new Promise((resolve) => {
                const block = new PromptSelectBlock(title, options, hooks?.hint, hooks?.layout);
                messageList.addChild(block);
                messageList.addChild(new Spacer(1));

                tui.setFocus(block);
                tui.requestRender();

                // Single path for settling and cleanup
                const settleAndCleanup = (/** @type {string | null} */ value) => {
                    activePromptCancel = null;
                    block.settle(value);
                    resolve(value);
                    tui.requestRender();
                };

                // Expose the cancel function so abortActivePrompt can resolve this promise
                activePromptCancel = () => settleAndCleanup(null);

                block.list.onSelect = (item) => settleAndCleanup(item.value);
                block.list.onCancel = () => settleAndCleanup(null);
                if (hooks?.onSelectionChange) {
                    block.list.onSelectionChange = (item) => {
                        hooks.onSelectionChange?.(item.value);
                        tui.requestRender();
                    };
                }
            });
        },

        /**
         * @param {string} title
         * @param {{ defaultValue?: string, placeholder?: string, allowEmpty?: boolean }} [opts]
         */
        promptText: (title, opts = {}) => {
            const { defaultValue, placeholder, allowEmpty = true } = opts;

            return new Promise((resolve) => {
                const hints = ["enter submit", "esc cancel"];
                if (!allowEmpty) hints.unshift("non-empty required");
                const hintText = placeholder ? `${placeholder} • ${hints.join(" • ")}` : hints.join(" • ");

                const block = new PromptTextBlock(title, hintText);
                if (defaultValue) {
                    block.input.setValue(defaultValue);
                }

                messageList.addChild(block);
                messageList.addChild(new Spacer(1));

                tui.setFocus(block);
                tui.requestRender();

                // Single path for settling and cleanup
                const settleAndCleanup = (/** @type {string | null} */ value) => {
                    activePromptCancel = null;
                    block.settle(value);
                    resolve(value);
                    tui.requestRender();
                };

                // Expose the cancel function so abortActivePrompt can resolve this promise
                activePromptCancel = () => settleAndCleanup(null);

                block.input.onSubmit = (value) => {
                    const finalValue = value || defaultValue || "";
                    if (!allowEmpty && !finalValue.trim()) return;
                    settleAndCleanup(finalValue);
                };

                block.input.onEscape = () => settleAndCleanup(null);
            });
        },

        isOutputSuppressed: () => outputSuppressed,

        suppressOutput: () => {
            outputSuppressed = true;
        },

        clearMessages: () => {
            messageList.clear();
            tui.requestRender();
        },

        // Stubs that chat-session sets dynamically
        setAgentInfo: () => {},
        disableInput: () => {},
        enableInput: () => {},
        showModelSelector: () => {},
        appendImage: () => {}, // chat-session implements this currently
    };
}
