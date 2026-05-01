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
 * @typedef {{ base64: string, mimeType: string }} ImageAttachment
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
 * @typedef {import('@mariozechner/pi-coding-agent').SessionManager & {
 *   addMessage?: (message: SessionMessageLike) => void,
 *   appendCustomMessageEntry?: (role: string, text: string, visible: boolean, persisted?: string) => void,
 * }} SessionManagerLike
 */

/**
 * @typedef {(userRequest: string, images: ImageAttachment[], uiAPI: import('../ui/types.js').UiAPI, sessionManager: SessionManagerLike) => Promise<void>} AgentMessageHandler
 */
