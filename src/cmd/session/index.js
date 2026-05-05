/**
 * @module cmd/session
 * Command to show current session information.
 */

import { getRootSessionManager } from "../../shared/session/session-state.js";
import { theme } from "../../shared/ui/theme.js";

/**
 * Handle session info command.
 *
 * @param {string[]} _argv
 * @param {import('../registry.js').CommandContext} [options]
 */
// deno-lint-ignore require-await
export async function runSessionCommand(_argv, options = {}) {
    if (!options?.uiAPI) {
        console.error("The /session command is only available inside an interactive session.");
        return;
    }

    const { uiAPI } = options;
    const sessionManager = getRootSessionManager();
    if (!sessionManager) {
        uiAPI.appendSystemMessage("Error: No active session.");
        return;
    }

    const entries = sessionManager.getEntries() || [];
    let compactionCount = 0;

    let userMessages = 0;
    let assistantMessages = 0;
    let toolCalls = 0;
    let toolResults = 0;

    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheWriteTokens = 0;

    for (const entry of entries) {
        if (entry.type === "compaction") {
            compactionCount++;
        } else if (entry.type === "message") {
            const msg = entry.message;
            if (!msg) continue;

            if (msg.role === "user") {
                userMessages++;
                if (Array.isArray(msg.content)) {
                    for (const block of msg.content) {
                        if (block.type === "tool_result") {
                            toolResults++;
                        }
                    }
                }
            } else if (msg.role === "assistant") {
                assistantMessages++;
                if (Array.isArray(msg.content)) {
                    for (const block of msg.content) {
                        if (block.type === "tool_use") {
                            toolCalls++;
                        }
                    }
                }

                if (msg.usage) {
                    inputTokens += msg.usage.inputTokens || 0;
                    outputTokens += msg.usage.outputTokens || 0;
                    cacheReadTokens += msg.usage.cacheReadTokens || 0;
                    cacheWriteTokens += msg.usage.cacheWriteTokens || 0;
                }
            }
        }
    }

    const totalMessages = userMessages + assistantMessages;
    const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;

    const sessionName = sessionManager.getSessionName?.() || "";
    const sessionFile = sessionManager.getSessionFile?.() || "In-memory";
    const sessionId = sessionManager.getSessionId?.() || "";

    const lines = [];

    if (compactionCount > 0) {
        const times = compactionCount === 1 ? "1 time" : `${compactionCount} times`;
        lines.push(`Session compacted ${times}`);
        lines.push("");
    }

    lines.push(theme.bold("Session Info"));
    lines.push("");
    if (sessionName) {
        lines.push(`${theme.fg("dim", "Name:")} ${sessionName}`);
    }
    lines.push(`${theme.fg("dim", "File:")} ${sessionFile}`);
    lines.push(`${theme.fg("dim", "ID:")} ${sessionId}`);
    lines.push("");

    lines.push(theme.bold("Messages"));
    lines.push(`${theme.fg("dim", "User:")} ${userMessages}`);
    lines.push(`${theme.fg("dim", "Assistant:")} ${assistantMessages}`);
    lines.push(`${theme.fg("dim", "Tool Calls:")} ${toolCalls}`);
    lines.push(`${theme.fg("dim", "Tool Results:")} ${toolResults}`);
    lines.push(`${theme.fg("dim", "Total:")} ${totalMessages}`);
    lines.push("");

    lines.push(theme.bold("Tokens"));
    lines.push(`${theme.fg("dim", "Input:")} ${inputTokens.toLocaleString()}`);
    lines.push(`${theme.fg("dim", "Output:")} ${outputTokens.toLocaleString()}`);
    if (cacheReadTokens > 0) {
        lines.push(`${theme.fg("dim", "Cache Read:")} ${cacheReadTokens.toLocaleString()}`);
    }
    if (cacheWriteTokens > 0) {
        lines.push(`${theme.fg("dim", "Cache Write:")} ${cacheWriteTokens.toLocaleString()}`);
    }
    lines.push(`${theme.fg("dim", "Total:")} ${totalTokens.toLocaleString()}`);

    uiAPI.appendSystemMessage(lines.join("\n"));
}
