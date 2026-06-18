/**
 * @module shared/session/root-session
 * Root interactive session lifecycle helpers (persisted in ~/.hns/sessions).
 */

import { dirname, join, resolve } from "@std/path";

/**
 * Encode cwd into a filesystem-safe directory segment (Pi-style).
 *
 * @param {string} cwd
 * @returns {string}
 */
export function encodeCwdForSessionDir(cwd) {
    return `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

/**
 * Resolve the root Harns sessions base directory.
 *
 * @returns {string}
 */
export function getHarnsSessionsBaseDir() {
    const home = Deno.env.get("HOME") || "~";
    return join(home, ".hns", "sessions");
}

/**
 * Resolve Harns root session directory for a cwd.
 *
 * @param {string} cwd
 * @returns {string}
 */
export function getHarnsSessionDir(cwd) {
    return join(getHarnsSessionsBaseDir(), encodeCwdForSessionDir(cwd));
}

/**
 * Ensure a directory exists.
 *
 * @param {string} dir
 */
function ensureDir(dir) {
    Deno.mkdirSync(dir, { recursive: true });
}

/**
 * @typedef {"new" | "continue"} RootSessionStartMode
 */

/**
 * Create or continue the persisted root session manager.
 *
 * @param {RootSessionStartMode} mode
 * @param {string} cwd
 * @returns {Promise<import('@earendil-works/pi-coding-agent').SessionManager>}
 */
export async function createRootSessionManager(mode, cwd) {
    const { SessionManager } = await import("@earendil-works/pi-coding-agent");
    const sessionDir = getHarnsSessionDir(cwd);
    ensureDir(sessionDir);

    if (mode === "continue") {
        return SessionManager.continueRecent(cwd, sessionDir);
    }
    return SessionManager.create(cwd, sessionDir);
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeHtml(value) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function toDisplayText(value) {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) {
        return value.map((block) => {
            if (!block || typeof block !== "object") return "";
            const typedBlock =
                /** @type {{ type?: string, text?: string, name?: string, input?: unknown, content?: unknown }} */ (
                    block
                );

            if (typedBlock.type === "text") return typedBlock.text || "";
            if (typedBlock.type === "tool_use") {
                return `[tool_use:${typedBlock.name || "unknown"}] ${JSON.stringify(typedBlock.input || {})}`;
            }
            if (typedBlock.type === "tool_result") {
                const contentText = toDisplayText(typedBlock.content || "");
                return `[tool_result] ${contentText}`;
            }
            return JSON.stringify(block);
        }).join("\n");
    }

    if (value === null || value === undefined) return "";
    return String(value);
}

/**
 * Export current session branch as linear JSONL (Pi-like behavior).
 *
 * @param {import('@earendil-works/pi-coding-agent').SessionManager} sessionManager
 * @param {string} [outputPath]
 * @returns {string}
 */
export function exportRootSessionToJsonl(sessionManager, outputPath) {
    const filePath = resolve(outputPath || `session-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
    ensureDir(dirname(filePath));

    const header = {
        type: "session",
        id: sessionManager.getSessionId(),
        timestamp: new Date().toISOString(),
        cwd: sessionManager.getCwd(),
    };

    const branchEntries = sessionManager.getBranch();
    const lines = [JSON.stringify(header)];

    let prevId = null;
    for (const entry of branchEntries) {
        const linearEntry = { ...entry, parentId: prevId };
        lines.push(JSON.stringify(linearEntry));
        prevId = entry.id;
    }

    Deno.writeTextFileSync(filePath, `${lines.join("\n")}\n`);
    return filePath;
}

/**
 * Export current session branch to a simple HTML transcript.
 *
 * @param {import('@earendil-works/pi-coding-agent').SessionManager} sessionManager
 * @param {string} [outputPath]
 * @returns {Promise<string>}
 */
export async function exportRootSessionToHtml(sessionManager, outputPath) {
    const filePath = resolve(outputPath || `session-${new Date().toISOString().replace(/[:.]/g, "-")}.html`);
    ensureDir(dirname(filePath));

    const entries = sessionManager.getBranch();
    const rows = entries.map((entry) => {
        const timestamp = entry.timestamp || "";

        if (entry.type === "message") {
            const role = entry.message?.role || "unknown";
            const message = /** @type {{ content?: unknown }} */ (entry.message);
            const text = escapeHtml(toDisplayText(message.content || ""));
            return `<section class=\"entry message ${escapeHtml(role)}\"><header>${escapeHtml(timestamp)} — ${
                escapeHtml(role)
            }</header><pre>${text}</pre></section>`;
        }

        if (entry.type === "custom_message") {
            const text = escapeHtml(toDisplayText(entry.content || ""));
            return `<section class=\"entry custom\"><header>${escapeHtml(timestamp)} — custom_message:${
                escapeHtml(entry.customType || "")
            }</header><pre>${text}</pre></section>`;
        }

        if (entry.type === "compaction") {
            return `<section class=\"entry system\"><header>${escapeHtml(timestamp)} — compaction</header><pre>${
                escapeHtml(entry.summary || "")
            }</pre></section>`;
        }

        if (entry.type === "branch_summary") {
            return `<section class=\"entry system\"><header>${escapeHtml(timestamp)} — branch_summary</header><pre>${
                escapeHtml(entry.summary || "")
            }</pre></section>`;
        }

        if (entry.type === "model_change") {
            const text = `${entry.provider || ""}/${entry.modelId || ""}`;
            return `<section class=\"entry meta\"><header>${escapeHtml(timestamp)} — model_change</header><pre>${
                escapeHtml(text)
            }</pre></section>`;
        }

        if (entry.type === "thinking_level_change") {
            return `<section class=\"entry meta\"><header>${
                escapeHtml(timestamp)
            } — thinking_level_change</header><pre>${escapeHtml(entry.thinkingLevel || "")}</pre></section>`;
        }

        return `<section class=\"entry meta\"><header>${escapeHtml(timestamp)} — ${
            escapeHtml(entry.type || "entry")
        }</header><pre>${escapeHtml(JSON.stringify(entry, null, 2))}</pre></section>`;
    }).join("\n");

    const title = `Harns Session Export — ${sessionManager.getSessionId()}`;
    const html = [
        "<!doctype html>",
        "<html lang='en'>",
        "<head>",
        '  <meta charset="utf-8" />',
        `  <title>${escapeHtml(title)}</title>`,
        "  <style>",
        "    body{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#111;color:#eee;padding:24px;line-height:1.4}",
        "    h1{font-size:18px;margin:0 0 16px}",
        "    .meta{color:#aaa;margin-bottom:16px}",
        "    .entry{border:1px solid #333;border-radius:8px;padding:12px;margin:0 0 12px;background:#1a1a1a}",
        "    .entry header{font-size:12px;color:#9ca3af;margin-bottom:8px}",
        "    .entry.message.user{border-color:#2563eb}",
        "    .entry.message.assistant{border-color:#16a34a}",
        "    .entry.custom,.entry.system{border-color:#7c3aed}",
        "    pre{white-space:pre-wrap;word-break:break-word;margin:0}",
        "  </style>",
        "</head>",
        "<body>",
        `  <h1>${escapeHtml(title)}</h1>`,
        `  <div class=\"meta\">cwd: ${escapeHtml(sessionManager.getCwd())}</div>`,
        rows,
        "</body>",
        "</html>",
        "",
    ].join("\n");

    await Deno.writeTextFile(filePath, html);
    return filePath;
}
