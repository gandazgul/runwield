/**
 * @module shared/session/root-session
 * Root interactive session lifecycle helpers (persisted in ~/.wld/sessions).
 */

import { dirname, isAbsolute, join, resolve } from "@std/path";

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
 * Resolve the root RunWield sessions base directory.
 *
 * @returns {string}
 */
export function getRunWieldSessionsBaseDir() {
    const home = Deno.env.get("HOME") || "~";
    return join(home, ".wld", "sessions");
}

/**
 * Resolve RunWield root session directory for a cwd.
 *
 * @param {string} cwd
 * @returns {string}
 */
export function getRunWieldSessionDir(cwd) {
    return join(getRunWieldSessionsBaseDir(), encodeCwdForSessionDir(cwd));
}

/**
 * Resolve the image-artifact directory for a persisted root session.
 *
 * @param {string} cwd
 * @param {string} sessionId
 * @returns {string}
 */
export function getRunWieldSessionImageDir(cwd, sessionId) {
    return join(getRunWieldSessionDir(cwd), `${sessionId}_images`);
}

/**
 * Resolve the memory-backup artifact directory for a persisted root session.
 *
 * @param {string} cwd
 * @param {string} sessionId
 * @returns {string}
 */
export function getRunWieldSessionMemoryBackupDir(cwd, sessionId) {
    return join(getRunWieldSessionDir(cwd), `${sessionId}_memory-backups`);
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
    const sessionDir = getRunWieldSessionDir(cwd);
    ensureDir(sessionDir);

    if (mode === "continue") {
        return SessionManager.continueRecent(cwd, sessionDir);
    }
    return SessionManager.create(cwd, sessionDir);
}

/**
 * @typedef {Object} PersistedRootSessionInfo
 * @property {string} id
 * @property {string} path
 * @property {string} cwd
 * @property {Date | string | number} [modified]
 * @property {number} [messageCount]
 * @property {string} [firstMessage]
 * @property {string} [name]
 */

/**
 * @typedef {Object} ResolvePersistedRootSessionOptions
 * @property {string} cwd
 * @property {string} sessionId
 * @property {string} [sessionPath]
 */

/**
 * @typedef {Object} ResolvedPersistedRootSession
 * @property {string} cwd
 * @property {string} sessionDir
 * @property {string} sessionId
 * @property {string} sessionPath
 * @property {PersistedRootSessionInfo | null} info
 */

/** @param {string} path @param {string} baseDir */
function isPathInside(path, baseDir) {
    const resolvedPath = resolve(path);
    const resolvedBase = resolve(baseDir);
    return resolvedPath === resolvedBase || resolvedPath.startsWith(`${resolvedBase}/`);
}

/** @param {unknown} value */
function getManagerCwd(value) {
    if (!value || typeof value !== "object" || !("getCwd" in value) || typeof value.getCwd !== "function") return "";
    const cwd = value.getCwd();
    return typeof cwd === "string" ? cwd : "";
}

/**
 * List persisted RunWield root sessions for a cwd.
 *
 * @param {string} cwd
 * @returns {Promise<PersistedRootSessionInfo[]>}
 */
export async function listPersistedRootSessions(cwd) {
    if (!cwd || !isAbsolute(cwd)) throw new Error("listPersistedRootSessions requires an absolute cwd");
    const { SessionManager } = await import("@earendil-works/pi-coding-agent");
    const sessionDir = getRunWieldSessionDir(cwd);
    const sessions = await SessionManager.list(cwd, sessionDir);
    return /** @type {PersistedRootSessionInfo[]} */ (sessions);
}

/**
 * Resolve a persisted RunWield root session by id or guarded file path.
 *
 * @param {ResolvePersistedRootSessionOptions} options
 * @returns {Promise<ResolvedPersistedRootSession>}
 */
export async function resolvePersistedRootSession(options) {
    if (!options?.cwd || !isAbsolute(options.cwd)) {
        throw new Error("resolvePersistedRootSession requires an absolute cwd");
    }
    if (!options.sessionId || typeof options.sessionId !== "string") {
        throw new Error("resolvePersistedRootSession requires a session id");
    }
    const sessionDir = getRunWieldSessionDir(options.cwd);
    const sessions = await listPersistedRootSessions(options.cwd);
    const requestedPath = options.sessionPath ? resolve(options.sessionPath) : "";
    if (requestedPath && !isPathInside(requestedPath, sessionDir)) {
        throw new Error("Persisted session path is outside the RunWield session directory for cwd");
    }

    const match = sessions.find((session) => {
        if (requestedPath) return resolve(session.path) === requestedPath && session.id === options.sessionId;
        return session.id === options.sessionId;
    });
    if (!match) throw new Error(`Persisted session not found for cwd: ${options.sessionId}`);

    return {
        cwd: options.cwd,
        sessionDir,
        sessionId: match.id,
        sessionPath: resolve(match.path),
        info: match,
    };
}

/**
 * Open a persisted RunWield root session by id or guarded file path.
 *
 * @param {ResolvePersistedRootSessionOptions} options
 * @returns {Promise<{ sessionManager: import('@earendil-works/pi-coding-agent').SessionManager, resolved: ResolvedPersistedRootSession }>}
 */
export async function openPersistedRootSession(options) {
    const { SessionManager } = await import("@earendil-works/pi-coding-agent");
    const resolved = await resolvePersistedRootSession(options);
    const sessionManager = SessionManager.open(resolved.sessionPath, resolved.sessionDir, options.cwd);
    if (resolve(getManagerCwd(sessionManager)) !== resolve(options.cwd)) {
        try {
            /** @type {{ dispose?: () => void }} */ (sessionManager).dispose?.();
        } catch {
            // Best-effort cleanup for rejected cross-cwd loads.
        }
        throw new Error("Persisted session cwd does not match requested cwd");
    }
    return { sessionManager, resolved };
}

/**
 * @param {import('@earendil-works/pi-coding-agent').SessionManager | { getBranch?: Function, getEntries?: Function }} sessionManager
 * @returns {unknown[]}
 */
export function getRootSessionBranchEntries(sessionManager) {
    const entries = sessionManager?.getBranch?.() || sessionManager?.getEntries?.() || [];
    return Array.isArray(entries) ? entries : [];
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

    const title = `RunWield Session Export — ${sessionManager.getSessionId()}`;
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
