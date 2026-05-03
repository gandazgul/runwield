/**
 * @module cmd/export
 * Export current interactive session to HTML (default) or JSONL.
 */

import { createAgentSession } from "@mariozechner/pi-coding-agent";
import { join } from "@std/path";

/**
 * @param {string} value
 * @returns {string}
 */
function sanitizeFilenameSegment(value) {
    return value.replace(/[\\/:*?"<>|]/g, "-");
}

/**
 * @param {string} sessionStartIso
 * @returns {string}
 */
function buildDefaultExportPath(sessionStartIso) {
    const safeIso = sanitizeFilenameSegment(sessionStartIso).replace(/\.\d{3}Z$/, "");
    return join(Deno.cwd(), `session-${safeIso}.html`);
}

/**
 * @param {string} text
 * @returns {string | undefined}
 */
function parseOptionalPathArg(text) {
    if (text === "/export") return undefined;
    if (!text.startsWith("/export ")) return undefined;

    const argsString = text.slice("/export".length + 1).trimStart();
    if (!argsString) return undefined;

    const firstChar = argsString[0];
    if (firstChar === '"' || firstChar === "'") {
        const closingQuoteIndex = argsString.indexOf(firstChar, 1);
        if (closingQuoteIndex < 0) return undefined;
        return argsString.slice(1, closingQuoteIndex);
    }

    const firstWhitespaceIndex = argsString.search(/\s/);
    if (firstWhitespaceIndex < 0) return argsString;
    return argsString.slice(0, firstWhitespaceIndex);
}

/**
 * Handle `/export` command (slash-only).
 *
 * @param {string[]} argv
 * @param {import('../registry.js').CommandContext} [options]
 */
export async function runExportCommand(argv, options = {}) {
    const { uiAPI, editor, sessionManager, text, sessionStartedAt } = options;
    if (!uiAPI || !editor || !sessionManager) {
        return;
    }

    const inlinePath = typeof text === "string" ? parseOptionalPathArg(text.trim()) : undefined;
    const cliPath = argv.join(" ").trim() || undefined;
    const requestedPath = inlinePath || cliPath;

    const fallbackIso = sessionStartedAt || new Date().toISOString();
    const outputPath = requestedPath || buildDefaultExportPath(fallbackIso);

    try {
        const { session } = await createAgentSession({
            cwd: Deno.cwd(),
            tools: [],
            sessionManager,
        });

        if (outputPath.toLowerCase().endsWith(".jsonl")) {
            const filePath = session.exportToJsonl(outputPath);
            uiAPI.appendSystemMessage(`Session exported to: ${filePath}`);
        } else {
            const filePath = await session.exportToHtml(outputPath);
            uiAPI.appendSystemMessage(`Session exported to: ${filePath}`);
        }
    } catch (error) {
        uiAPI.appendSystemMessage(
            `Failed to export session: ${error instanceof Error ? error.message : "Unknown error"}`,
            true,
        );
    } finally {
        editor.setText("");
        editor.disableSubmit = false;
    }
}
