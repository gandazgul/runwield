import { Spacer } from "@mariozechner/pi-tui";
import {
    AgentMessageBlock,
    PromptSelectBlock,
    PromptTextBlock,
    SystemMessageBlock,
    ToolExecutionBlock,
    UserPromptBlock,
} from "./blocks.js";

/**
 * Creates a UiAPI object for Harns TUI.
 *
 * @param {import('@mariozechner/pi-tui').TUI} tui
 * @param {import('@mariozechner/pi-tui').Container} messageList
 * @param {import('./blocks.js').SpinnerBlock} spinner
 * @returns {import('./types.js').UiAPI}
 */
export function createUiApi(tui, messageList, spinner) {
    const activeToolBlocks = new Map();

    /** @type {number | null} */
    let spinnerInterval = null;

    let toolsExpanded = false;
    let outputSuppressed = false;

    return {
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
         */
        appendSystemMessage: (text, isError = false) => {
            if (outputSuppressed) return;
            const children = messageList.children;
            let lastBlockIndex = children.length - 1;
            if (lastBlockIndex >= 0 && children[lastBlockIndex] instanceof Spacer) {
                lastBlockIndex--;
            }

            const lastBlock = lastBlockIndex >= 0 ? children[lastBlockIndex] : null;

            if (lastBlock instanceof SystemMessageBlock && lastBlock.isError === isError) {
                lastBlock.appendText(text);
                tui.requestRender();
                return;
            }

            const block = new SystemMessageBlock(text, isError);
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
            spinner.setBusy(busy, spinner.tasks);
            if (busy && !spinnerInterval) {
                if (typeof setInterval !== "undefined") {
                    spinnerInterval = setInterval(() => {
                        spinner.advance();
                        tui.requestRender();
                    }, 80);
                }
            } else if (!busy && spinnerInterval) {
                clearInterval(spinnerInterval);
                spinnerInterval = null;
            }
            tui.requestRender();
        },

        /** @param {Array<{task: number, assignee: string, description: string}>} tasks */
        setRunningTasks: (tasks) => {
            spinner.tasks = tasks;
            if (!outputSuppressed) tui.requestRender();
        },

        /**
         * @param {string} title
         * @param {Array<{value: string, label: string}>} options
         */
        promptSelect: (title, options) => {
            return new Promise((resolve) => {
                const block = new PromptSelectBlock(title, options);
                messageList.addChild(block);

                tui.setFocus(block);
                tui.requestRender();

                // Override settle in block to handle promise resolution and focus
                const originalSettle = block.settle.bind(block);
                block.settle = (value) => {
                    originalSettle(value);
                    resolve(value);
                    tui.requestRender();
                };

                // Forward list events to block's settle method
                block.list.onSelect = (item) => block.settle(item.value);
                block.list.onCancel = () => block.settle(null);
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

                tui.setFocus(block);
                tui.requestRender();

                const originalSettle = block.settle.bind(block);
                block.settle = (value) => {
                    originalSettle(value);
                    resolve(value);
                    tui.requestRender();
                };

                block.input.onSubmit = (value) => {
                    const finalValue = value || defaultValue || "";
                    if (!allowEmpty && !finalValue.trim()) return;
                    block.settle(finalValue);
                };

                block.input.onEscape = () => block.settle(null);
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
        appendImage: () => {}, // chat-session implements this currently
    };
}
