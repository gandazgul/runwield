/**
 * @module shared/interactive/message-hydration
 *
 * Replays persisted root-session history into the live TUI when resuming a
 * conversation (`--continue`, `/resume`, `/load-plan`, …). Pure rendering: it
 * never mutates the underlying session, only re-emits messages through the
 * provided `uiAPI`.
 */

import { appendTaskCompletedMessage, extractTaskCompletedMessage } from "../../ui/tui/task-completed-message.js";

const MAX_HYDRATED_TEXT_LINES = 24;
const MAX_HYDRATED_TEXT_CHARS = 4000;

/**
 * @param {{ type?: string, text?: string, [key: string]: unknown }} block
 * @returns {string}
 */
function blockToDisplayText(block) {
    if (!block || typeof block !== "object") return "";

    if (block.type === "text") {
        return typeof block.text === "string" ? block.text : "";
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
 * @param {string} text
 * @returns {string}
 */
function compactHydratedText(text) {
    if (!text) return text;

    const lines = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
    const tooManyLines = lines.length > MAX_HYDRATED_TEXT_LINES;
    const tooManyChars = text.length > MAX_HYDRATED_TEXT_CHARS;
    if (!tooManyLines && !tooManyChars) return text;

    /** @type {string[]} */
    const shown = [];
    let usedChars = 0;
    for (const line of lines) {
        if (shown.length >= MAX_HYDRATED_TEXT_LINES) break;
        if (usedChars + line.length > MAX_HYDRATED_TEXT_CHARS) {
            const remaining = Math.max(0, MAX_HYDRATED_TEXT_CHARS - usedChars);
            if (remaining > 0) shown.push(line.slice(0, remaining));
            break;
        }
        shown.push(line);
        usedChars += line.length + 1;
    }

    const omittedLines = Math.max(0, lines.length - shown.length);
    const omittedChars = Math.max(0, text.length - shown.join("\n").length);
    const omitted = omittedLines > 0
        ? `${omittedLines.toLocaleString()} lines`
        : `${omittedChars.toLocaleString()} chars`;

    return `${shown.join("\n")}\n\n[... ${omitted} omitted from restored transcript ...]`;
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function isSilentSemanticReviewPrompt(text) {
    return text.startsWith("Compare the current implementation diff against the original plan.");
}

/**
 * Internal workflow prompts are persisted for model continuity, but most are not
 * shown as user-facing transcript blocks during the live run.
 *
 * @param {string} text
 * @returns {boolean}
 */
function isHiddenInternalWorkflowPrompt(text) {
    return isSilentSemanticReviewPrompt(text) ||
        text.startsWith("The project failed CI validation.") ||
        text.startsWith("The code reviewer found issues with your implementation.");
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function argsToDisplayText(value) {
    if (!value || typeof value !== "object") return "";
    const args = /** @type {Record<string, unknown>} */ (value);
    if (typeof args.command === "string") return args.command;
    if (typeof args.path === "string") return args.path;
    if (typeof args.file_path === "string") return args.file_path;
    if (typeof args.target === "string") return args.target;
    if (typeof args.query === "string") return args.query;
    if (typeof args.pattern === "string") {
        return typeof args.path === "string" ? `${args.pattern} in ${args.path}` : args.pattern;
    }
    try {
        return JSON.stringify(args);
    } catch {
        return "";
    }
}

/**
 * @param {string} toolName
 * @param {unknown} args
 * @returns {{ displayName: string, argsText: string }}
 */
function toolCallDisplay(toolName, args) {
    return {
        displayName: toolName === "bash" ? "$" : toolName,
        argsText: argsToDisplayText(args),
    };
}

/**
 * `buildSessionContext()` is the right source for LLM context, but the TUI
 * transcript should replay the visible persisted branch. Otherwise long sessions
 * that Pi summarizes/truncates for the model hydrate as only a few messages.
 *
 * @param {import('@earendil-works/pi-coding-agent').SessionManager} sessionManager
 * @returns {unknown[]}
 */
function getMessagesForUiHydration(sessionManager) {
    const entries = sessionManager.getBranch?.() || sessionManager.getEntries?.() || [];
    if (Array.isArray(entries) && entries.length > 0) {
        const messages = entries
            .map(entryToHydrationMessage)
            .filter((message) => message !== null);
        if (messages.length > 0) return messages;
    }

    const context = sessionManager.buildSessionContext();
    return Array.isArray(context?.messages) ? context.messages : [];
}

/**
 * @param {unknown} entry
 * @returns {unknown | null}
 */
function entryToHydrationMessage(entry) {
    if (!entry || typeof entry !== "object") return null;

    const typedEntry =
        /** @type {{ type?: string, message?: unknown, content?: unknown, display?: unknown, timestamp?: unknown, summary?: unknown }} */ (
            entry
        );

    if (typedEntry.type === "message") {
        if (!typedEntry.message || typeof typedEntry.message !== "object") return null;
        return {
            .../** @type {Record<string, unknown>} */ (typedEntry.message),
            timestamp: /** @type {{ timestamp?: unknown }} */ (typedEntry.message).timestamp ?? typedEntry.timestamp,
        };
    }

    if (typedEntry.type === "custom_message") {
        return {
            role: "custom",
            content: typedEntry.content,
            display: typedEntry.display,
            timestamp: typedEntry.timestamp,
        };
    }

    if (typedEntry.type === "compaction" && typeof typedEntry.summary === "string" && typedEntry.summary.trim()) {
        return {
            role: "custom",
            content: `Compaction summary:\n${typedEntry.summary}`,
            display: true,
            timestamp: typedEntry.timestamp,
        };
    }

    return null;
}

/**
 * @param {import('@earendil-works/pi-coding-agent').SessionManager} sessionManager
 * @param {import('../../ui/tui/types.js').UiAPI} uiAPI
 * @param {{ hostedSession?: import('../session/hosted-session.js').HostedSession, activeAgentLabel?: string }} [options]
 */
export function restorePersistedMessagesToUi(sessionManager, uiAPI, options = {}) {
    const messages = getMessagesForUiHydration(sessionManager);
    if (messages.length === 0) return;

    const activeAgentLabel = options.activeAgentLabel || options.hostedSession?.getActiveAgentName?.() || "RunWield";
    /** @type {Map<string, { block: import('../../ui/tui/types.js').ToolExecutionBlockApi, startedAt: number }>} */
    const restoredToolBlocks = new Map();
    let skipNextAssistantMessage = false;

    for (const message of messages) {
        if (!message || typeof message !== "object") continue;

        const role = /** @type {{ role?: string }} */ (message).role;

        if (role === "user") {
            const text = messageToDisplayText(message);
            if (isHiddenInternalWorkflowPrompt(text)) {
                skipNextAssistantMessage = isSilentSemanticReviewPrompt(text);
                continue;
            }
        } else if (skipNextAssistantMessage && role === "assistant") {
            skipNextAssistantMessage = false;
            continue;
        }

        if (role === "custom") {
            const display = /** @type {{ display?: boolean }} */ (message).display;
            if (display === false) continue;
            const text = messageToDisplayText(message);
            if (text) uiAPI.appendSystemMessage(compactHydratedText(text));
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

                    if (typedBlock.type === "text") {
                        if (typeof typedBlock.text === "string" && typedBlock.text) {
                            if (!appender) {
                                appender = uiAPI.appendAgentMessageStart(activeAgentLabel);
                            }
                            appender.appendText(compactHydratedText(typedBlock.text));
                        }
                        continue;
                    }

                    if (typedBlock.type === "toolCall" || typedBlock.type === "tool_use") {
                        const toolName = typeof typedBlock.name === "string" ? typedBlock.name : "tool";
                        const args = /** @type {{ arguments?: unknown, input?: unknown }} */ (typedBlock).arguments ??
                            /** @type {{ arguments?: unknown, input?: unknown }} */ (typedBlock).input;

                        if (toolName === "task_completed") {
                            appendTaskCompletedMessage(
                                uiAPI,
                                activeAgentLabel || "RunWield",
                                extractTaskCompletedMessage(args),
                            );
                            continue;
                        }

                        const toolId = typeof typedBlock.id === "string"
                            ? typedBlock.id
                            : `restored-tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                        const display = toolCallDisplay(toolName, args);
                        const toolBlock = uiAPI.startToolExecution?.(toolId, display.displayName, display.argsText);
                        toolBlock?.endExecution(false, 0);
                        if (toolBlock) {
                            const startedAt =
                                typeof /** @type {{ timestamp?: unknown }} */ (message).timestamp === "number"
                                    ? /** @type {{ timestamp: number }} */ (message).timestamp
                                    : Date.now();
                            restoredToolBlocks.set(toolId, { block: toolBlock, startedAt });
                        }
                    }
                }
                continue;
            }

            const text = messageToDisplayText(message);
            if (text) {
                const appender = uiAPI.appendAgentMessageStart(activeAgentLabel);
                appender.appendText(compactHydratedText(text));
            }
            continue;
        }

        if (role === "user") {
            const text = messageToDisplayText(message);
            if (text) {
                uiAPI.appendUserMessage?.(compactHydratedText(text));
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

        if (role === "toolResult") {
            const toolResult =
                /** @type {{ toolCallId?: unknown, content?: unknown, isError?: unknown, timestamp?: unknown }} */ (
                    message
                );
            const toolCallId = typeof toolResult.toolCallId === "string" ? toolResult.toolCallId : "";
            const restored = toolCallId ? restoredToolBlocks.get(toolCallId) : undefined;
            const block = restored?.block || (toolCallId ? uiAPI.getActiveToolBlock?.(toolCallId) : undefined);
            const text = messageToDisplayText(message);

            if (block) {
                if (text) block.appendOutput(text);
                const endedAt = typeof toolResult.timestamp === "number" ? toolResult.timestamp : restored?.startedAt;
                const durationMs = restored && endedAt ? Math.max(0, endedAt - restored.startedAt) : 0;
                block.endExecution(Boolean(toolResult.isError), durationMs);
            } else if (text) {
                uiAPI.appendSystemMessage(text, Boolean(toolResult.isError));
            }
            continue;
        }

        const fallbackText = messageToDisplayText(message);
        if (fallbackText) {
            uiAPI.appendSystemMessage(compactHydratedText(fallbackText));
        }
    }
}
