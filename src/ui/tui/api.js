import { isFocusable, Spacer } from "@earendil-works/pi-tui";
import { getSettingsManager } from "../../shared/settings.js";
import {
    AgentMessageBlock,
    KeyboardHelpBlock,
    ManagedSyncStatusBlock,
    PromptSelectBlock,
    PromptTextBlock,
    ReviewResultBlock,
    SystemMessageBlock,
    ThinkingBlock,
    ToolExecutionBlock,
    UserPromptBlock,
    ValidationHandoffBlock,
} from "./blocks.js";

/**
 * @typedef {Object} ToolElapsedTimerState
 * @property {ReturnType<typeof setTimeout> | null} renderTimer
 */

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
        appendQueuedMessage: () => {},
        removeQueuedMessage: () => {},
        appendReviewResult: () => {},
        updateValidationProgress: () => {},
        updateValidationReport: () => {},
        clearValidationPanel: () => {},
        setManagedSyncStatus: () => {},
        appendSystemMessage: () => {},
        startToolExecution: () => ({
            setOutput: () => {},
            endExecution: () => {},
            bodyText: "",
            startTime: Date.now(),
        }),
        toggleToolOutputsExpanded: () => {},
        showKeyboardHelp: () => {},
        hideKeyboardHelp: () => {},
        getActiveToolBlock: () => undefined,
        requestRender: () => {},
        advanceSpinner: () => {},
        setBusy: () => {},
        setRunningTasks: () => {},
        clearMessages: () => {},
        promptSelect: () => Promise.resolve(null),
        promptText: () => Promise.resolve(null),
        showModelSelector: () => ({ selected: false }),
        disableInput: () => {},
        enableInput: () => {},
        isOutputSuppressed: () => true,
        suppressOutput: () => {},
        abortActivePrompt: () => {},
    };
}

/**
 * Like createSilentUiApi(), but keeps footer-facing session state live by
 * allowing isolated Agent sessions to push agent/model info and by forwarding renders.
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
 * @param {{ requestRender: () => void, setFocus: (component: any) => void }} tui
 * @param {{ addChild: (child: any) => void, removeChild: (child: any) => void, clear: () => void, children: any[] }} messageList
 * @param {import('./blocks.js').SpinnerBlock} spinner
 * @param {{ addChild: (child: any) => void, removeChild: (child: any) => void, children: any[] }} [inputAccessoryContainer]
 * @param {{ addChild: (child: any) => void, removeChild: (child: any) => void, clear?: () => void, children: any[] }} [validationPanelContainer]
 * @param {{ addChild: (child: any) => void, removeChild: (child: any) => void, clear?: () => void, children: any[] }} [activeInteractionContainer]
 * @param {{ addChild: (child: any) => void, removeChild: (child: any) => void, clear?: () => void, children: any[] }} [queuedInputContainer]
 * @returns {import('./types.js').UiAPI}
 */
export function createUiApi(
    tui,
    messageList,
    spinner,
    inputAccessoryContainer,
    validationPanelContainer,
    activeInteractionContainer,
    queuedInputContainer,
) {
    const activeToolBlocks = new Map();
    /** @type {Map<string, { block: SystemMessageBlock, spacer: Spacer }>} */
    const queuedMessageBlocks = new Map();
    /** @type {Map<string, ToolElapsedTimerState>} */
    const toolElapsedTimers = new Map();
    /** @type {{ block: KeyboardHelpBlock, spacer: Spacer } | null} */
    let keyboardHelp = null;
    /** @type {{ block: ManagedSyncStatusBlock, spacer: Spacer } | null} */
    let managedSyncStatus = null;
    /** @type {import('../../shared/session/session-runtime-events.js').RuntimeManagedSyncStateEvent | null} */
    let visibleManagedSyncState = null;

    /** @param {import('../../shared/session/session-runtime-events.js').RuntimeManagedSyncStateEvent} state */
    const isSameVisibleManagedSyncState = (state) => {
        return visibleManagedSyncState?.status === state.status &&
            visibleManagedSyncState.localGeneration === state.localGeneration &&
            visibleManagedSyncState.latestGeneration === state.latestGeneration &&
            visibleManagedSyncState.owningSurfaceKind === state.owningSurfaceKind &&
            visibleManagedSyncState.message === state.message;
    };

    /** @type {(() => void) | null} */
    let activePromptCancel = null;

    let toolsExpanded = false;
    let outputSuppressed = false;
    let runtimeBusy = false;
    let promptActive = false;
    /** @type {(import('@earendil-works/pi-tui').Component & import('@earendil-works/pi-tui').Focusable) | null} */
    let busyBlurredFocus = null;
    /** @type {import('../../shared/session/session-runtime-events.js').RuntimeValidationProgress | null} */
    let validationProgress = null;
    /** @type {{ agentName: string, markdown: string, completedOrder: number } | null} */
    let latestEngineerReport = null;
    /** @type {{ agentName: string, markdown: string, approved: boolean, completedOrder: number } | null} */
    let latestReviewerReport = null;
    let validationReportOrder = 0;
    /** @type {ValidationHandoffBlock | null} */
    let validationPanelBlock = null;

    const removeInputAccessoryResources = () => {
        if (!inputAccessoryContainer) {
            keyboardHelp = null;
            managedSyncStatus = null;
            visibleManagedSyncState = null;
            return;
        }
        if (keyboardHelp) {
            inputAccessoryContainer.removeChild(keyboardHelp.block);
            inputAccessoryContainer.removeChild(keyboardHelp.spacer);
            keyboardHelp = null;
        }
        if (managedSyncStatus) {
            inputAccessoryContainer.removeChild(managedSyncStatus.block);
            inputAccessoryContainer.removeChild(managedSyncStatus.spacer);
            managedSyncStatus = null;
        }
        visibleManagedSyncState = null;
    };

    const renderValidationPanel = () => {
        if (!validationPanelContainer || outputSuppressed) return;
        if (!validationProgress) {
            validationPanelContainer.clear?.();
            validationPanelBlock = null;
            return;
        }
        const state = {
            progress: validationProgress,
            engineer: latestEngineerReport,
            reviewer: latestReviewerReport,
        };
        if (!validationPanelBlock) {
            validationPanelContainer.clear?.();
            validationPanelBlock = new ValidationHandoffBlock(state);
            validationPanelContainer.addChild(validationPanelBlock);
            validationPanelContainer.addChild(new Spacer(1));
        } else {
            validationPanelBlock.setState(state);
        }
    };

    const activePromptContainer = activeInteractionContainer || messageList;

    const suppressFocusedCursorForBusy = () => {
        const tuiFocus = /** @type {{ focusedComponent?: import('@earendil-works/pi-tui').Component | null }} */ (
            /** @type {unknown} */ (tui)
        );
        const focused = tuiFocus.focusedComponent || null;
        if (!isFocusable(focused) || !focused.focused) return;
        busyBlurredFocus = focused;
        focused.focused = false;
    };

    const restoreFocusedCursorAfterBusy = () => {
        if (!busyBlurredFocus) return;
        const tuiFocus = /** @type {{ focusedComponent?: import('@earendil-works/pi-tui').Component | null }} */ (
            /** @type {unknown} */ (tui)
        );
        if (tuiFocus.focusedComponent === busyBlurredFocus) {
            busyBlurredFocus.focused = true;
        }
        busyBlurredFocus = null;
    };

    /** @type {ReturnType<typeof setInterval> | null} */
    let busyFrameTimer = null;

    const stopBusyFrameTimer = () => {
        if (busyFrameTimer === null) return;
        clearInterval(busyFrameTimer);
        busyFrameTimer = null;
    };

    const renderBusyFrame = () => {
        if (!spinner.isBusy || outputSuppressed) return;
        spinner.advance();
        tui.requestRender();
    };

    const startBusyFrameTimer = () => {
        if (busyFrameTimer !== null || outputSuppressed) return;
        renderBusyFrame();
        busyFrameTimer = setInterval(renderBusyFrame, 120);
    };

    const beginPromptWait = () => {
        promptActive = true;
        spinner.setBusy(false, spinner.tasks);
        stopBusyFrameTimer();
        restoreFocusedCursorAfterBusy();
    };

    const endPromptWait = () => {
        promptActive = false;
        spinner.setBusy(runtimeBusy, spinner.tasks);
        if (runtimeBusy) {
            suppressFocusedCursorForBusy();
            startBusyFrameTimer();
        }
    };

    /**
     * @param {string} id
     */
    const clearToolElapsedTimer = (id) => {
        const timer = toolElapsedTimers.get(id);
        if (!timer) return;
        if (timer.renderTimer) clearTimeout(timer.renderTimer);
        toolElapsedTimers.delete(id);
    };

    /**
     * @param {string} id
     * @param {ToolExecutionBlock} block
     */
    const startToolElapsedTimer = (id, block) => {
        clearToolElapsedTimer(id);
        const timer = /** @type {ToolElapsedTimerState} */ ({
            renderTimer: null,
        });
        const renderElapsedFrame = () => {
            if (outputSuppressed || block.ended || activeToolBlocks.get(id) !== block) {
                clearToolElapsedTimer(id);
                return;
            }
            block.enableElapsedTime();
            tui.requestRender();
            timer.renderTimer = setTimeout(renderElapsedFrame, 100);
            if (typeof timer.renderTimer.unref === "function") {
                timer.renderTimer.unref();
            }
        };
        toolElapsedTimers.set(id, timer);
        renderElapsedFrame();
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

        /** @param {string} id @param {string} text */
        appendQueuedMessage: (id, text) => {
            if (outputSuppressed || queuedMessageBlocks.has(id)) return;
            const block = new SystemMessageBlock(text, false, "Steering:");
            const spacer = new Spacer(1);
            queuedMessageBlocks.set(id, { block, spacer });
            const queueContainer = queuedInputContainer || messageList;
            queueContainer.addChild(block);
            queueContainer.addChild(spacer);
            tui.requestRender();
        },

        /** @param {string} id */
        removeQueuedMessage: (id) => {
            const queued = queuedMessageBlocks.get(id);
            if (!queued) return;
            const queueContainer = queuedInputContainer || messageList;
            queueContainer.removeChild(queued.block);
            queueContainer.removeChild(queued.spacer);
            queuedMessageBlocks.delete(id);
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
         * @param {string} agentName
         * @param {string} markdown
         * @param {boolean} approved
         */
        appendReviewResult: (agentName, markdown, approved) => {
            if (outputSuppressed) return;
            const block = new ReviewResultBlock(agentName, markdown, approved);
            messageList.addChild(block);
            messageList.addChild(new Spacer(1));
            tui.requestRender();
        },

        /** @param {import('../../shared/session/session-runtime-events.js').RuntimeValidationProgress} progress */
        updateValidationProgress: (progress) => {
            if (outputSuppressed) return;
            validationProgress = structuredClone(progress);
            renderValidationPanel();
            tui.requestRender();
        },

        /**
         * @param {"engineer" | "reviewer"} role
         * @param {{ agentName: string, markdown: string, approved?: boolean }} report
         */
        updateValidationReport: (role, report) => {
            if (outputSuppressed) return;
            const completedOrder = ++validationReportOrder;
            if (role === "engineer") {
                latestEngineerReport = { agentName: report.agentName, markdown: report.markdown, completedOrder };
            } else {
                latestReviewerReport = {
                    agentName: report.agentName,
                    markdown: report.markdown,
                    approved: report.approved === true,
                    completedOrder,
                };
            }
            if (validationProgress) {
                renderValidationPanel();
                tui.requestRender();
            }
        },

        clearValidationPanel: () => {
            validationProgress = null;
            latestEngineerReport = null;
            latestReviewerReport = null;
            validationReportOrder = 0;
            validationPanelContainer?.clear?.();
            validationPanelBlock = null;
            tui.requestRender();
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
            while (lastBlockIndex >= 0 && children[lastBlockIndex] instanceof Spacer) {
                lastBlockIndex--;
            }

            const lastBlock = lastBlockIndex >= 0 ? children[lastBlockIndex] : null;

            if (
                lastBlock instanceof SystemMessageBlock && lastBlock.isError === isError &&
                JSON.stringify(lastBlock.style) === JSON.stringify(style)
            ) {
                // Async status transitions can leave more than one trailing spacer.
                // Collapse them before extending the same visible message block so
                // publication and its immediate repair read as one continuous update.
                for (let index = children.length - 1; index > lastBlockIndex; index--) {
                    messageList.removeChild(children[index]);
                }
                lastBlock.appendText(text, header, style);
                messageList.addChild(new Spacer(1));
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
         * @param {string} toolName
         * @param {string} title
         */
        startToolExecution: (id, toolName, title) => {
            if (outputSuppressed) {
                return {
                    setOutput: () => {},
                    endExecution: () => {},
                    bodyText: "",
                    startTime: Date.now(),
                };
            }
            const block = new ToolExecutionBlock(toolName, title);
            const originalEndExecution = block.endExecution.bind(block);
            block.endExecution = (isError, durationMs) => {
                clearToolElapsedTimer(id);
                originalEndExecution(isError, durationMs);
                if (!outputSuppressed) tui.requestRender();
            };
            block.setExpanded(toolsExpanded);
            activeToolBlocks.set(id, block);
            messageList.addChild(block);
            messageList.addChild(new Spacer(1));
            startToolElapsedTimer(id, block);
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

        /** @param {import('../../shared/session/session-help.js').SessionHelpPayload} help */
        showKeyboardHelp: (help) => {
            if (!inputAccessoryContainer || outputSuppressed) return;
            if (keyboardHelp) {
                inputAccessoryContainer.removeChild(keyboardHelp.block);
                inputAccessoryContainer.removeChild(keyboardHelp.spacer);
                keyboardHelp = null;
                tui.requestRender();
                return;
            }
            const block = new KeyboardHelpBlock(help);
            const spacer = new Spacer(1);
            keyboardHelp = { block, spacer };
            inputAccessoryContainer.addChild(block);
            inputAccessoryContainer.addChild(spacer);
            tui.requestRender();
        },

        hideKeyboardHelp: () => {
            if (!inputAccessoryContainer || !keyboardHelp) return;
            inputAccessoryContainer.removeChild(keyboardHelp.block);
            inputAccessoryContainer.removeChild(keyboardHelp.spacer);
            keyboardHelp = null;
            tui.requestRender();
        },

        /** @param {import('../../shared/session/session-runtime-events.js').RuntimeManagedSyncStateEvent} state */
        setManagedSyncStatus: (state) => {
            if (!inputAccessoryContainer || outputSuppressed) return;
            if (state.status === "syncing" && !managedSyncStatus) return;
            if (state.status === "current" && !state.owningSurfaceKind) {
                if (managedSyncStatus) {
                    inputAccessoryContainer.removeChild(managedSyncStatus.block);
                    inputAccessoryContainer.removeChild(managedSyncStatus.spacer);
                    managedSyncStatus = null;
                    visibleManagedSyncState = null;
                    tui.requestRender();
                }
                return;
            }
            if (isSameVisibleManagedSyncState(state)) return;
            if (!managedSyncStatus) {
                const block = new ManagedSyncStatusBlock(state);
                const spacer = new Spacer(1);
                managedSyncStatus = { block, spacer };
                inputAccessoryContainer.addChild(block);
                inputAccessoryContainer.addChild(spacer);
            } else {
                managedSyncStatus.block.setState(state);
            }
            visibleManagedSyncState = { ...state };
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

            runtimeBusy = busy;
            const displayBusy = busy && !promptActive;
            spinner.setBusy(displayBusy, spinner.tasks);
            if (displayBusy) {
                suppressFocusedCursorForBusy();
                startBusyFrameTimer();
            } else {
                stopBusyFrameTimer();
                restoreFocusedCursorAfterBusy();
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
         * @param {{ onSelectionChange?: (value: string) => void, layout?: import('@earendil-works/pi-tui').SelectListLayoutOptions, hint?: string, persistResult?: boolean }} [hooks]
         */
        promptSelect: (title, options, hooks) => {
            return new Promise((resolve) => {
                beginPromptWait();
                const block = new PromptSelectBlock(title, options, hooks?.hint, hooks?.layout);
                const spacer = new Spacer(1);
                activePromptContainer.addChild(block);
                activePromptContainer.addChild(spacer);

                tui.setFocus(block);
                tui.requestRender();

                const shouldPersistResult = hooks?.persistResult !== false && title !== "Switch agent:";

                // Single path for settling and cleanup
                const settleAndCleanup = (/** @type {string | null} */ value) => {
                    activePromptCancel = null;
                    activePromptContainer.removeChild(block);
                    activePromptContainer.removeChild(spacer);
                    if (shouldPersistResult && !outputSuppressed) {
                        block.settle(value);
                        messageList.addChild(block);
                        messageList.addChild(spacer);
                    }
                    endPromptWait();
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
         * @param {{ defaultValue?: string, placeholder?: string, allowEmpty?: boolean, persistResult?: boolean }} [opts]
         */
        promptText: (title, opts = {}) => {
            const { defaultValue, placeholder, allowEmpty = true, persistResult = true } = opts;

            return new Promise((resolve) => {
                beginPromptWait();
                const hints = ["enter submit", "esc cancel"];
                if (!allowEmpty) hints.unshift("non-empty required");
                const hintText = placeholder ? `${placeholder} • ${hints.join(" • ")}` : hints.join(" • ");

                const block = new PromptTextBlock(title, hintText);
                if (defaultValue) {
                    block.input.setValue(defaultValue);
                }

                const spacer = new Spacer(1);
                activePromptContainer.addChild(block);
                activePromptContainer.addChild(spacer);

                tui.setFocus(block);
                tui.requestRender();

                // Single path for settling and cleanup
                const settleAndCleanup = (/** @type {string | null} */ value) => {
                    activePromptCancel = null;
                    activePromptContainer.removeChild(block);
                    activePromptContainer.removeChild(spacer);
                    if (persistResult && !outputSuppressed) {
                        block.settle(value);
                        messageList.addChild(block);
                        messageList.addChild(spacer);
                    }
                    endPromptWait();
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
            runtimeBusy = false;
            promptActive = false;
            spinner.setBusy(false, spinner.tasks);
            stopBusyFrameTimer();
            restoreFocusedCursorAfterBusy();
            if (activePromptCancel) {
                activePromptCancel();
            }
            tui.setFocus(null);
            validationPanelContainer?.clear?.();
            activeInteractionContainer?.clear?.();
            validationProgress = null;
            latestEngineerReport = null;
            latestReviewerReport = null;
            validationPanelBlock = null;
            validationReportOrder = 0;
            activePromptCancel = null;
            for (const id of toolElapsedTimers.keys()) {
                clearToolElapsedTimer(id);
            }
            removeInputAccessoryResources();
        },

        clearMessages: () => {
            if (activePromptCancel) {
                activePromptCancel();
                activePromptCancel = null;
            }
            tui.setFocus(null);
            messageList.clear();
            validationPanelContainer?.clear?.();
            activeInteractionContainer?.clear?.();
            validationProgress = null;
            latestEngineerReport = null;
            latestReviewerReport = null;
            validationPanelBlock = null;
            validationReportOrder = 0;
            queuedMessageBlocks.clear();
            activeToolBlocks.clear();
            for (const id of Array.from(toolElapsedTimers.keys())) clearToolElapsedTimer(id);
            removeInputAccessoryResources();
            tui.requestRender();
        },

        dispose: () => {
            if (activePromptCancel) {
                activePromptCancel();
                activePromptCancel = null;
            }
            stopBusyFrameTimer();
            runtimeBusy = false;
            promptActive = false;
            restoreFocusedCursorAfterBusy();
            for (const id of Array.from(toolElapsedTimers.keys())) clearToolElapsedTimer(id);
            activeToolBlocks.clear();
            queuedMessageBlocks.clear();
            removeInputAccessoryResources();
            validationProgress = null;
            latestEngineerReport = null;
            latestReviewerReport = null;
            validationPanelBlock = null;
            validationReportOrder = 0;
            validationPanelContainer?.clear?.();
            activeInteractionContainer?.clear?.();
            spinner.setBusy(false, spinner.tasks);
            tui.setFocus(null);
            tui.requestRender();
        },

        // Stubs that chat-session sets dynamically
        disableInput: () => {},
        enableInput: () => {},
        showModelSelector: () => ({ selected: false }),
        appendImage: () => {}, // chat-session implements this currently
    };
}
