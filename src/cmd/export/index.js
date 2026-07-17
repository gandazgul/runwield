/**
 * @module cmd/export
 * Export current interactive session to HTML (default) or JSONL.
 */

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
 * Handle `/export` command (slash-only).
 *
 * @param {string[]} argv
 * @param {import('../registry.js').CommandContext} [options]
 */
export async function runExportCommand(argv, options = {}) {
    const { uiAPI, editor, sessionRuntime, sessionId, sessionStartedAt } = options;
    if (!uiAPI || !editor || !sessionRuntime || !sessionId) {
        return;
    }

    uiAPI.appendSystemMessage("");

    const requestedPath = argv.join(" ").trim();

    const fallbackIso = sessionStartedAt || new Date().toISOString();
    const outputPath = requestedPath || buildDefaultExportPath(fallbackIso);

    try {
        const filePath = await sessionRuntime.exportSession(sessionId, outputPath);
        uiAPI.appendSystemMessage(`Session exported to: ${filePath}`);
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
