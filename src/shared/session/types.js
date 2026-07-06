/**
 * @module shared/session/types
 */

/**
 * @typedef {{
 *   type?: string,
 *   text?: string,
 *   [key: string]: unknown,
 * }} SessionContentBlock
 */

/**
 * @typedef {{ base64: string, mimeType: string, ref?: string, path?: string }} ImageAttachment
 */

/**
 * @typedef {Object} AgentDefinition
 * @property {string} name - Agent name (from frontmatter or filename)
 * @property {string} displayName - Agent display name (from frontmatter or filename)
 * @property {string} model - Model identifier
 * @property {string} description - One-line description from merged frontmatter
 * @property {string[]} tools - Allowed tool names from merged frontmatter
 * @property {string} [thinkingLevel] - Thinking/reasoning level from frontmatter ("off" | "minimal" | "low" | "medium" | "high" | "xhigh")
 * @property {number} [temperature] - Provider temperature from frontmatter, between 0 and 2
 * @property {string} systemPrompt - Core system prompt + merged agent prompt
 */

/**
 * @typedef {{
 *   role: string,
 *   content: SessionContentBlock[],
 *   stopReason?: string,
 *   errorMessage?: string,
 * }} SessionMessageLike
 */

/**
 * @typedef {import('@earendil-works/pi-coding-agent').SessionManager & {
 *   addMessage?: (message: SessionMessageLike) => void,
 *   appendCustomMessageEntry?: (role: string, text: string, visible: boolean, persisted?: string) => void,
 *   getHeader?: () => ({ timestamp?: string } | null),
 * }} SessionManagerLike
 */

/**
 * @typedef {(userRequest: string, images: ImageAttachment[], uiAPI: import('../../ui/tui/types.js').UiAPI, sessionManager: SessionManagerLike) => Promise<void>} AgentMessageHandler
 */
