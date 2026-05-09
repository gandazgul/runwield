/**
 * @module shared/interactive/keybindings
 *
 * Wraps the editor's input handler with chat-session keybindings:
 *   Esc          cancel whatever is in flight (bash, agent, plan review, prompts)
 *   Ctrl+C       cancel like Esc + clear input; press again within 1s to exit
 *   Ctrl+V       paste image from system clipboard
 *   Ctrl+O       toggle tool-output expand/collapse
 *   Shift+Enter  insert literal newline (also Alt+Enter)
 *   Backspace    when editor is empty, drop the last pasted image
 *   default      forward to the editor's original handler
 *
 * All shared state (submission queue, pasted-image list, generation guard,
 * cancel callbacks) is passed in by the caller — this module owns no state.
 */

import { Key, matchesKey, Text } from "@earendil-works/pi-tui";
import { abortActiveSession } from "../session/session.js";
import { cancelActivePlanReview } from "../workflow/submit-plan.js";
import { stopTUI } from "../ui/tui.js";
import { readClipboardImage } from "../clipboard.js";
import { theme } from "../ui/theme.js";

/**
 * @typedef {Object} KeybindingsContext
 * @property {import('@earendil-works/pi-tui').Editor} editor
 * @property {import('@earendil-works/pi-tui').TUI} tui
 * @property {import('../ui/types.js').UiAPI} uiAPI
 * @property {import('../session/types.js').ImageAttachment[]} pastedImages
 * @property {import('@earendil-works/pi-tui').Container} previewImages
 * @property {Array<unknown>} submissionQueue
 * @property {import('./generation-guard.js').GenerationGuard} generationGuard
 * @property {() => boolean} cancelActiveOperation
 * @property {() => void} dismissActivePrompt
 * @property {() => void} forceResetUI
 * @property {() => void} markCtrlCPendingExit
 * @property {() => boolean} isCtrlCPendingExit
 * @property {() => void} [toggleStartupHelp]
 * @property {() => void} cycleThinkingLevel
 */

/**
 * Install custom keybindings on the editor. Returns the un-wrapped handler so
 * callers (e.g., slash-dispatch) can re-invoke the original behavior.
 *
 * @param {KeybindingsContext} ctx
 * @returns {(data: string) => void} The original editor.handleInput, bound to editor.
 */
export function installKeybindings(ctx) {
    const {
        editor,
        tui,
        uiAPI,
        pastedImages,
        previewImages,
        submissionQueue,
        generationGuard,
        cancelActiveOperation,
        dismissActivePrompt,
        forceResetUI,
        markCtrlCPendingExit,
        isCtrlCPendingExit,
        toggleStartupHelp,
        cycleThinkingLevel,
    } = ctx;

    function cancelEverything() {
        generationGuard.invalidateAll();
        submissionQueue.length = 0;
        dismissActivePrompt();
        const opCanceled = cancelActiveOperation();
        const sessionAborted = abortActiveSession();
        const planCanceled = cancelActivePlanReview();
        forceResetUI();
        return { opCanceled, sessionAborted, planCanceled };
    }

    const originalHandleInput = editor.handleInput.bind(editor);

    /** @param {string} data */
    editor.handleInput = async (data) => {
        // Esc: ALWAYS cancels whatever is going on
        if (matchesKey(data, Key.escape)) {
            const { opCanceled, sessionAborted, planCanceled } = cancelEverything();

            if (opCanceled) {
                uiAPI.appendSystemMessage("Operation canceled.", false, "Harns");
            } else if (sessionAborted) {
                uiAPI.appendSystemMessage("Agent run canceled.", false, "Harns");
            } else if (planCanceled) {
                uiAPI.appendSystemMessage("Plan review canceled.", false, "Harns");
            }
            tui.requestRender();
            return;
        }

        // Ctrl+C: cancel like Esc + clear input; press again within 1s to exit
        if (matchesKey(data, Key.ctrl("c"))) {
            if (isCtrlCPendingExit()) {
                stopTUI();
                setTimeout(() => Deno.exit(0), 100);
                return;
            }
            cancelEverything();
            editor.setText("");
            if (pastedImages.length > 0) {
                pastedImages.length = 0;
                while (previewImages.children.length > 0) {
                    previewImages.removeChild(previewImages.children[previewImages.children.length - 1]);
                }
            }
            markCtrlCPendingExit();
            return;
        }

        // Ctrl+V: paste image from clipboard
        if (matchesKey(data, Key.ctrl("v"))) {
            const img = await readClipboardImage();
            if (img) {
                pastedImages.push(img);
                previewImages.addChild(
                    new Text(theme.fg("dim", `[Attached image: ${img.mimeType}]`)),
                );
                tui.requestRender();
            }
            return;
        }

        // Ctrl+O: toggle expand/collapse for tool output blocks and the startup help
        if (matchesKey(data, Key.ctrl("o"))) {
            if (toggleStartupHelp) toggleStartupHelp();
            if (uiAPI.toggleToolOutputsExpanded) {
                uiAPI.toggleToolOutputsExpanded();
                tui.requestRender();
                return;
            }
            tui.requestRender();
            return;
        }

        // Shift+Enter / Alt+Enter: insert newline
        if (matchesKey(data, Key.shift("enter")) || matchesKey(data, Key.alt("enter"))) {
            // @ts-ignore: private pi-tui internals used intentionally
            editor.addNewLine();
            tui.requestRender();
            return;
        }

        // Backspace on empty editor: drop the last pasted image preview
        if (
            matchesKey(data, Key.backspace) &&
            // @ts-ignore: private pi-tui internals used intentionally
            editor.isEditorEmpty() && pastedImages.length > 0
        ) {
            pastedImages.pop();
            const lastChild = previewImages.children[previewImages.children.length - 1];
            if (lastChild) previewImages.removeChild(lastChild);
            tui.requestRender();
            return;
        }

        // Shift+Tab: cycle thinking level
        if (matchesKey(data, Key.shift("tab"))) {
            cycleThinkingLevel();
            tui.requestRender();
            return;
        }

        originalHandleInput(data);
    };

    return originalHandleInput;
}
