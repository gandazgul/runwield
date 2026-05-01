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

/**
 * @param {string} planName
 * @param {string} error
 * @returns {string}
 */
export function buildRepairPrompt(planName, error) {
    return `The previously approved plan "${planName}" had a malformed Tasks table: ${error}.\n\nPlease fix the table to ensure it follows the required format (Task ID | Assignee | Dependencies | Description). If any requirement is unclear, use user_interview (1-3 focused questions) before finalizing, then call plan_written again.`;
}
