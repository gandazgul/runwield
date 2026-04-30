import { Container, Input, SelectList, Spacer, Text } from "@mariozechner/pi-tui";
import { AgentMessageBlock, SystemMessageBlock, ToolExecutionBlock, UserPromptBlock } from "./blocks.js";
import { selectListTheme, theme } from "../theme.js";

/**
 * Creates a UiAPI object for Harns TUI.
 *
 * @param {import('@mariozechner/pi-tui').TUI} tui
 * @param {import('@mariozechner/pi-tui').Container} messageList
 * @param {import('./blocks.js').SpinnerBlock} spinner
 * @returns {import('../workflow.js').UiAPI & { appendUserMessage: (text: string) => void, setBusy: (busy: boolean) => void, getActiveToolBlock: (id: string) => import('./blocks.js').ToolExecutionBlock | undefined, startToolExecution: (id: string, name: string, args: string) => import('./blocks.js').ToolExecutionBlock, toggleToolOutputsExpanded: () => void }}
 */
export function createUiApi(tui, messageList, spinner) {
    const activeToolBlocks = new Map();

    /** @type {number | null} */
    let spinnerInterval = null;

    let toolsExpanded = false;

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
                const container = new Container();
                container.addChild(new Text("─".repeat(40), 0, 0));
                container.addChild(new Text(theme.fg("accent", theme.bold(title)), 0, 0));
                container.addChild(new Text("─".repeat(40), 0, 0));

                const selectList = new SelectList(
                    options,
                    Math.min(options.length, 10),
                    selectListTheme,
                );

                container.addChild(selectList);
                container.addChild(new Text("─".repeat(40), 0, 0));
                container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter select • esc cancel"), 0, 0));

                let settled = false;
                /** @type {import('@mariozechner/pi-tui').OverlayHandle | null} */
                let handle = null;

                /** @param {string | null} value */
                const settle = (value) => {
                    if (settled) return;
                    settled = true;
                    if (handle) handle.hide();
                    resolve(value);
                };

                selectList.onSelect = (item) => settle(item.value);
                selectList.onCancel = () => settle(null);

                const component = {
                    /** @param {number} w */
                    render: (w) => container.render(w),
                    invalidate: () => container.invalidate(),
                    /** @param {string} data */
                    handleInput: (data) => {
                        selectList.handleInput(data);
                        tui.requestRender();
                    },
                };

                handle = tui.showOverlay(component, {
                    width: "80%",
                    minWidth: 40,
                    anchor: "center",
                    margin: 2,
                });

                tui.requestRender();
            });
        },

        /**
         * @param {string} title
         * @param {{ defaultValue?: string, placeholder?: string, allowEmpty?: boolean }} [opts]
         */
        promptText: (title, opts = {}) => {
            const { defaultValue, placeholder, allowEmpty = true } = opts;

            return new Promise((resolve) => {
                const container = new Container();
                const input = new Input();
                input.setValue(defaultValue || "");

                container.addChild(new Text("─".repeat(40), 0, 0));
                container.addChild(new Text(theme.fg("accent", theme.bold(title)), 0, 0));
                if (placeholder) {
                    container.addChild(new Text(theme.fg("dim", placeholder), 0, 0));
                }
                container.addChild(new Text("─".repeat(40), 0, 0));
                container.addChild(input);
                container.addChild(new Text("─".repeat(40), 0, 0));

                const hints = ["enter submit", "esc cancel"];
                if (!allowEmpty) hints.unshift("non-empty required");
                container.addChild(new Text(theme.fg("dim", hints.join(" • ")), 0, 0));

                let settled = false;
                /** @type {import('@mariozechner/pi-tui').OverlayHandle | null} */
                let handle = null;

                /** @param {string | null} value */
                const settle = (value) => {
                    if (settled) return;
                    settled = true;
                    if (handle) handle.hide();
                    resolve(value);
                };

                input.onSubmit = (value) => {
                    const finalValue = value || defaultValue || "";
                    if (!allowEmpty && !finalValue.trim()) return;
                    settle(finalValue);
                };

                input.onEscape = () => settle(null);

                const component = {
                    get focused() {
                        return input.focused;
                    },
                    /** @param {boolean} value */
                    set focused(value) {
                        input.focused = value;
                    },
                    /** @param {number} w */
                    render: (w) => container.render(w),
                    invalidate: () => container.invalidate(),
                    /** @param {string} data */
                    handleInput: (data) => {
                        input.handleInput(data);
                        tui.requestRender();
                    },
                };

                handle = tui.showOverlay(component, {
                    width: "80%",
                    minWidth: 50,
                    anchor: "center",
                    margin: 2,
                });

                tui.requestRender();
            });
        },

        // Stubs that chat-session sets dynamically
        setAgentInfo: () => {},
        disableInput: () => {},
        enableInput: () => {},
        appendImage: () => {}, // chat-session implements this currently
    };
}
