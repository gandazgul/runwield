/**
 * @module cmd/types
 */

/**
 * @typedef {{ value: string, label: string, description?: string, [key: string]: unknown }} CommandCompletionItem
 */

/**
 * @typedef {{
 *   uiAPI?: import('../shared/ui/types.js').UiAPI,
 *   editor?: import('../shared/ui/types.js').EditorAPI,
 *   text?: string,
 *   tui?: import('../shared/ui/types.js').TuiAPI,
 *   originalHandleInput?: (data: string) => void | Promise<void>,
 * }} CommandContext
 */
