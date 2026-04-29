import { Spacer } from "@mariozechner/pi-tui";
import { AgentMessageBlock, SystemMessageBlock, ToolExecutionBlock, UserPromptBlock } from "./blocks.js";
import { theme } from "../theme.js";

/**
 * Creates a UiAPI object for Harns TUI.
 *
 * @param {import('@mariozechner/pi-tui').TUI} tui
 * @param {import('@mariozechner/pi-tui').Container} messageList
 * @param {import('./blocks.js').SpinnerBlock} spinner
 * @returns {import('../workflow.js').UiAPI & { appendUserMessage: (text: string) => void, setBusy: (busy: boolean) => void, getActiveToolBlock: (id: string) => import('./blocks.js').ToolExecutionBlock | undefined, startToolExecution: (id: string, name: string, args: string) => import('./blocks.js').ToolExecutionBlock }}
 */
export function createUiApi(tui, messageList, spinner) {
    const activeToolBlocks = new Map();

    /** @type {number | null} */
    let spinnerInterval = null;

    return {
        /** @param {string} text */
        appendUserMessage: (text) => {
            const block = new UserPromptBlock(text);
            messageList.addChild(block);
            messageList.addChild(new Spacer(1));
            tui.requestRender();
        },

        /** @param {string} agentName */
        appendAgentMessageStart: (agentName) => {
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
            const block = new ToolExecutionBlock(name, argsStr);
            activeToolBlocks.set(id, block);
            messageList.addChild(block);
            messageList.addChild(new Spacer(1));
            tui.requestRender();
            return block;
        },

        getActiveToolBlock: (id) => {
            return activeToolBlocks.get(id);
        },

        requestRender: () => {
            tui.requestRender();
        },

        advanceSpinner: () => {
            spinner.advance();
            tui.requestRender();
        },

        /** @param {boolean} busy */
        setBusy: (busy) => {
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
            tui.requestRender();
        },

        /**
         * @param {string} title
         * @param {Array<{value: string, label: string}>} options
         */
        promptSelect: (title, options) => {
            return new Promise((resolve) => {
                // To keep this clean, we delegate to the existing SelectList logic
                // But we don't have SelectList here. Let's dynamically import or keep it in chat-session
                // Actually, wait, workflow.js needs this. Let's implement it here.
                import("@mariozechner/pi-tui").then(async ({ Container, Text, SelectList }) => {
                    const { selectListTheme } = await import("../theme.js");

                    const container = new Container();
                    container.addChild(new Text("─".repeat(40), 0, 0));
                    container.addChild(new Text(theme.fg("accent", theme.bold(title)), 0, 0));
                    container.addChild(new Text("─".repeat(40), 0, 0));

                    const selectList = new SelectList(
                        options,
                        Math.min(options.length, 10),
                        selectListTheme,
                    );

                    const cleanup = () => {
                        messageList.removeChild(container);
                        tui.requestRender();
                    };

                    selectList.onSelect = (item) => {
                        cleanup();
                        resolve(item.value);
                    };

                    selectList.onCancel = () => {
                        cleanup();
                        resolve(null);
                    };

                    container.addChild(selectList);
                    container.addChild(new Text("─".repeat(40), 0, 0));
                    container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter select • esc cancel"), 0, 0));

                    messageList.addChild(container);
                    messageList.addChild(new Spacer(1));
                    tui.setFocus(selectList);
                    tui.requestRender();
                });
            });
        },

        // Stubs that chat-session sets dynamically
        setAgentInfo: () => {},
        disableInput: () => {},
        enableInput: () => {},
        appendImage: () => {}, // chat-session implements this currently
    };
}
