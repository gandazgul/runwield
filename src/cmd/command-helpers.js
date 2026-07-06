/**
 * @module shared/command-helpers
 */

/**
 * @param {import('../ui/tui/types.js').EditorAPI | undefined} editor
 * @param {import('../ui/tui/types.js').UiAPI | undefined} uiAPI
 * @param {import('../ui/tui/types.js').TuiAPI | undefined} tui
 */
export function resetTuiState(editor, uiAPI, tui) {
    if (editor) editor.disableSubmit = false;
    if (uiAPI?.setBusy) uiAPI.setBusy(false);
    if (uiAPI?.enableInput) uiAPI.enableInput();
    if (editor && tui) {
        tui.setFocus(/** @type {import('@earendil-works/pi-tui').Component} */ (/** @type {unknown} */ (editor)));
    }
}
