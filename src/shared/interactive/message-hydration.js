/**
 * @module shared/interactive/message-hydration
 *
 * Replays persisted root-session history into the live TUI when resuming a
 * conversation (`--continue`, `/resume`, `/load-plan`, …). Pure rendering: it
 * never mutates the underlying session, only re-emits messages through the
 * provided `uiAPI`.
 */

import { getActiveAgentName } from "../session/session-state.js";

/**
 * @param {{ type?: string, text?: string, [key: string]: unknown }} block
 * @returns {string}
 */
function blockToDisplayText(block) {
    if (!block || typeof block !== "object") return "";

    if (block.type === "text") {
        return typeof block.text === "string" ? block.text : "";
    }

    if (block.type === "thinking") {
        return typeof block.thinking === "string" ? block.thinking : "";
    }

    if (block.type === "tool_result") {
        const content = block.content;
        if (typeof content === "string") {
            return content;
        }
        if (Array.isArray(content)) {
            return content
                .map((part) => {
                    if (part && typeof part === "object" && part.type === "text" && typeof part.text === "string") {
                        return part.text;
                    }
                    return "";
                })
                .filter(Boolean)
                .join("\n");
        }
        return "";
    }

    // Non-textual blocks are rendered separately (e.g. tool blocks, images) or ignored.
    return "";
}

/**
 * @param {unknown} message
 * @returns {string}
 */
function messageToDisplayText(message) {
    if (!message || typeof message !== "object") return "";

    const content = /** @type {{ content?: unknown }} */ (message).content;
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";

    return content
        .map((block) =>
            blockToDisplayText(/** @type {{ type?: string, text?: string, [key: string]: unknown }} */ (block))
        )
        .filter(Boolean)
        .join("\n\n")
        .trim();
}

/**
 * @param {import('@earendil-works/pi-coding-agent').SessionManager} sessionManager
 * @param {import('../ui/types.js').UiAPI} uiAPI
 */
export function restorePersistedMessagesToUi(sessionManager, uiAPI) {
    const context = sessionManager.buildSessionContext();
    const messages = Array.isArray(context?.messages) ? context.messages : [];
    if (messages.length === 0) return;

    for (const message of messages) {
        if (!message || typeof message !== "object") continue;

        const role = /** @type {{ role?: string }} */ (message).role;

        if (role === "custom") {
            const display = /** @type {{ display?: boolean }} */ (message).display;
            if (display === false) continue;
            const text = messageToDisplayText(message);
            if (text) uiAPI.appendSystemMessage(text);
            continue;
        }

        if (role === "assistant") {
            const content = /** @type {{ content?: unknown }} */ (message).content;

            if (Array.isArray(content)) {
                /** @type {{ appendText: (delta: string) => void } | null} */
                let appender = null;

                for (const block of content) {
                    if (!block || typeof block !== "object") continue;

                    const typedBlock =
                        /** @type {{ type?: string, text?: unknown, thinking?: unknown, name?: unknown, id?: unknown }} */ (block);

                    if (typedBlock.type === "thinking") {
                        if (typeof typedBlock.thinking === "string" && typedBlock.thinking.trim()) {
                            const thinkingAppender = uiAPI.appendThinkingStart?.();
                            if (thinkingAppender) {
                                thinkingAppender.appendDelta(typedBlock.thinking);
                                thinkingAppender.end();
                            }
                        }
                        continue;
                    }

                    if (typedBlock.type === "text") {
                        if (typeof typedBlock.text === "string" && typedBlock.text) {
                            if (!appender) {
                                appender = uiAPI.appendAgentMessageStart(getActiveAgentName() || "assistant");
                            }
                            appender.appendText(typedBlock.text);
                        }
                        continue;
                    }

                    if (typedBlock.type === "tool_use") {
                        const toolName = typeof typedBlock.name === "string" ? typedBlock.name : "tool";
                        const toolId = typeof typedBlock.id === "string"
                            ? typedBlock.id
                            : `restored-tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                        const toolBlock = uiAPI.startToolExecution?.(toolId, toolName, "");
                        toolBlock?.endExecution(false, 0);
                    }
                }
                continue;
            }

            const text = messageToDisplayText(message);
            if (text) {
                const appender = uiAPI.appendAgentMessageStart(getActiveAgentName() || "assistant");
                appender.appendText(text);
            }
            continue;
        }

        if (role === "user") {
            const text = messageToDisplayText(message);
            if (text) {
                uiAPI.appendUserMessage?.(text);
            }

            const content = /** @type {{ content?: unknown }} */ (message).content;
            if (Array.isArray(content)) {
                for (const block of content) {
                    if (
                        block && typeof block === "object" &&
                        /** @type {{ type?: string }} */ (block).type === "image" &&
                        typeof /** @type {{ data?: unknown }} */ (block).data === "string" &&
                        typeof /** @type {{ mimeType?: unknown }} */ (block).mimeType === "string"
                    ) {
                        uiAPI.appendImage?.(
                            /** @type {{ data: string }} */ (block).data,
                            /** @type {{ mimeType: string }} */ (block).mimeType,
                        );
                    }
                }
            }
            continue;
        }

        const fallbackText = messageToDisplayText(message);
        if (fallbackText) {
            uiAPI.appendSystemMessage(fallbackText);
        }
    }
}
