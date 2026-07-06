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
import { abortActiveSession as abortActiveSessionFn } from "../session/session.js";
import { cancelActivePlanReview } from "../workflow/submit-plan.js";
import { stopTUI } from "../ui/tui.js";
import { readClipboardImage } from "../clipboard.js";
import { theme } from "../ui/theme.js";

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
 * @property {() => boolean} dequeueLastSubmission
 * @property {() => void} forceResetUI
 * @property {() => void} markCtrlCPendingExit
 * @property {() => boolean} isCtrlCPendingExit
 * @property {() => void} [toggleStartupHelp]
 * @property {() => void} cycleThinkingLevel
 * @property {(image: import('../session/types.js').ImageAttachment) => Promise<import('../session/types.js').ImageAttachment | null>} [handleImagePaste]
 * @property {(hostedSession?: import('../session/hosted-session.js').HostedSession) => boolean} [abortActiveSession]
 * @property {import('../session/hosted-session.js').HostedSession} [hostedSession]
 * @property {() => void} [clearPendingSteeringMessages]  Callback to clear pending steering messages on cancel
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
        dequeueLastSubmission,
        forceResetUI,
        markCtrlCPendingExit,
        isCtrlCPendingExit,
        toggleStartupHelp,
        cycleThinkingLevel,
        handleImagePaste,
        clearPendingSteeringMessages,
    } = ctx;
    const abortActiveSession = ctx.abortActiveSession || abortActiveSessionFn;

    function cancelEverything() {
        generationGuard.invalidateAll();
        submissionQueue.length = 0;
        clearPendingSteeringMessages?.();
        dismissActivePrompt();
        const opCanceled = cancelActiveOperation();
        const sessionAborted = abortActiveSession(ctx.hostedSession);
        const planCanceled = cancelActivePlanReview(ctx.hostedSession);
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
                uiAPI.appendSystemMessage("Operation canceled.", false, "RunWield");
            } else if (sessionAborted) {
                uiAPI.appendSystemMessage("Agent run canceled.", false, "RunWield");
            } else if (planCanceled) {
                uiAPI.appendSystemMessage("Plan review canceled.", false, "RunWield");
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
                const attachment = /** @type {import('../session/types.js').ImageAttachment | null} */ (
                    handleImagePaste ? await handleImagePaste(img) : img
                );
                if (attachment) {
                    pastedImages.push(attachment);
                    previewImages.addChild(
                        new Text(
                            theme.fg(
                                "dim",
                                `[Attached image: ${attachment.ref ? `${attachment.ref} ` : ""}${attachment.mimeType}]`,
                            ),
                        ),
                    );
                    tui.requestRender();
                }
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
            cycleThinkingLevel();
            tui.requestRender();
            return;
        }

        // Up arrow on empty editor with a queued message: dequeue it back into the
        // editor for editing or deletion. Otherwise fall through to the editor's
        // built-in history navigation.
        if (
            matchesKey(data, Key.up) &&
            isEditorEmpty(editor) &&
            submissionQueue.length > 0
        ) {
            if (dequeueLastSubmission()) return;
        }

        originalHandleInput(data);
    };

    return originalHandleInput;
}
