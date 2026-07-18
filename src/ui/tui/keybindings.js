/**
 * @module ui/tui/keybindings
 *
 * Wraps the editor's input handler with chat-session keybindings:
 *   Esc          cancel whatever is in flight (bash, agent, plan review, prompts)
 *   Ctrl+C       cancel like Esc + clear input; press again within 1s to exit
 *   Ctrl+V       paste image from system clipboard
 *   Ctrl+O       toggle tool-output expand/collapse
 *   ?            when the input field is empty, show keyboard help
 *   Shift+Enter  insert literal newline (also Alt+Enter)
 *   Backspace    when editor is empty, drop the last pasted image
 *   default      forward to the editor's original handler
 *
 * All shared state (pasted-image list, generation guard, cancel callbacks) is
 * passed in by the caller — this module owns no state.
 */

import { Image, Key, matchesKey } from "@earendil-works/pi-tui";
import { stopTUI } from "./tui.js";
import { readClipboardImage } from "./clipboard.js";
import { imageTheme } from "../theme/theme.js";

/**
 * @param {import('@earendil-works/pi-tui').Editor} editor
 * @returns {boolean}
 */
function isEditorEmpty(editor) {
    const readableEditor = /** @type {{ getText?: () => string, isEditorEmpty?: () => boolean }} */ (
        /** @type {any} */ (editor)
    );
    if (typeof readableEditor.getText === "function") {
        return readableEditor.getText() === "";
    }
    if (typeof readableEditor.isEditorEmpty === "function") {
        // Older pi-tui builds exposed this private helper at runtime.
        return readableEditor.isEditorEmpty();
    }
    return false;
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
 * @typedef {Object} KeybindingsContext
 * @property {import('@earendil-works/pi-tui').Editor} editor
 * @property {import('@earendil-works/pi-tui').TUI} tui
 * @property {import('./types.js').UiAPI} uiAPI
 * @property {import('../../shared/session/types.js').ImageAttachment[]} pastedImages
 * @property {import('@earendil-works/pi-tui').Container} previewImages
 * @property {import('./generation-guard.js').GenerationGuard} generationGuard
 * @property {() => void} dismissActivePrompt
 * @property {() => boolean | Promise<boolean>} dequeueLastSubmission
 * @property {() => void} forceResetUI
 * @property {() => void} markCtrlCPendingExit
 * @property {() => boolean} isCtrlCPendingExit
 * @property {() => unknown | Promise<unknown>} [requestKeyboardHelp]
 * @property {() => void} [hideKeyboardHelp]
 * @property {() => void} cycleThinkingLevel
 * @property {(image: import('../../shared/session/types.js').ImageAttachment) => Promise<import('../../shared/session/types.js').ImageAttachment | null>} [handleImagePaste]
 * @property {() => boolean} cancelRuntimeSession
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
        generationGuard,
        dismissActivePrompt,
        dequeueLastSubmission,
        forceResetUI,
        markCtrlCPendingExit,
        isCtrlCPendingExit,
        requestKeyboardHelp,
        hideKeyboardHelp,
        cycleThinkingLevel,
        handleImagePaste,
    } = ctx;
    function cancelEverything() {
        generationGuard.invalidateAll();
        dismissActivePrompt();
        ctx.cancelRuntimeSession();
        forceResetUI();
    }

    const originalHandleInput = editor.handleInput.bind(editor);

    /** @param {string} data */
    editor.handleInput = async (data) => {
        // Esc: ALWAYS cancels whatever is going on
        if (matchesKey(data, Key.escape)) {
            if (hideKeyboardHelp) hideKeyboardHelp();
            cancelEverything();
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
                const attachment = /** @type {import('../../shared/session/types.js').ImageAttachment | null} */ (
                    handleImagePaste ? await handleImagePaste(img) : img
                );
                if (attachment) {
                    pastedImages.push(attachment);
                    previewImages.addChild(createPastedImagePreview(attachment));
                    tui.requestRender();
                }
            }
            return;
        }

        // Ctrl+O: toggle expand/collapse for tool output blocks
        if (matchesKey(data, Key.ctrl("o"))) {
            if (uiAPI.toggleToolOutputsExpanded) {
                uiAPI.toggleToolOutputsExpanded();
                tui.requestRender();
                return;
            }
            tui.requestRender();
            return;
        }

        if (data === "?" && isEditorEmpty(editor) && pastedImages.length === 0) {
            if (requestKeyboardHelp) await requestKeyboardHelp();
            tui.requestRender();
            return;
        }

        // Shift+Enter / Alt+Enter: insert newline
        if (matchesKey(data, Key.shift("enter")) || matchesKey(data, Key.alt("enter"))) {
            if (hideKeyboardHelp) hideKeyboardHelp();
            // @ts-ignore: private pi-tui internals used intentionally
            editor.addNewLine();
            tui.requestRender();
            return;
        }

        // Backspace on empty editor: drop the last pasted image preview
        if (
            matchesKey(data, Key.backspace) &&
            isEditorEmpty(editor) && pastedImages.length > 0
        ) {
            pastedImages.pop();
            const lastChild = previewImages.children[previewImages.children.length - 1];
            if (lastChild) previewImages.removeChild(lastChild);
            tui.requestRender();
            return;
        }

        // Shift+Tab: cycle thinking level
        if (matchesKey(data, Key.shift("tab"))) {
            if (hideKeyboardHelp) hideKeyboardHelp();
            cycleThinkingLevel();
            tui.requestRender();
            return;
        }

        // Up arrow on empty editor with a queued message: dequeue it back into the
        // editor for editing or deletion. Core owns queued-message state, so ask
        // the dequeue callback before falling through to history navigation.
        if (matchesKey(data, Key.up) && isEditorEmpty(editor)) {
            if (await dequeueLastSubmission()) {
                if (hideKeyboardHelp) hideKeyboardHelp();
                return;
            }
        }

        if (hideKeyboardHelp) hideKeyboardHelp();
        originalHandleInput(data);
    };

    return originalHandleInput;
}
