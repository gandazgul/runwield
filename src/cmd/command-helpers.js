/**
 * @module shared/command-helpers
 */

/**
 * @param {import('../shared/ui/types.js').EditorAPI | undefined} editor
 * @param {import('../shared/ui/types.js').UiAPI | undefined} uiAPI
 * @param {import('../shared/ui/types.js').TuiAPI | undefined} tui
 */
export function resetTuiState(editor, uiAPI, tui) {
    if (editor) editor.disableSubmit = false;
    if (uiAPI?.setBusy) uiAPI.setBusy(false);
    if (uiAPI?.enableInput) uiAPI.enableInput();
    if (editor && tui) {
        tui.setFocus(/** @type {import('@mariozechner/pi-tui').Component} */ (/** @type {unknown} */ (editor)));
    }
}
