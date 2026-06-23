/**
 * @module shared/workflow/code-review
 * Launches the Plannotator human code review UI for a completed workflow diff.
 */

import { startReviewServer } from "@gandazgul/plannotator-pi-extension-compiled/server";

/**
 * @typedef {Object} CodeReviewAnnotation
 * @property {string} [file]
 * @property {string} [path]
 * @property {number} [line]
 * @property {string} [text]
 * @property {string} [comment]
 */

/**
 * @typedef {Object} CodeReviewDecision
 * @property {boolean} approved
 * @property {string} feedback
 * @property {CodeReviewAnnotation[]} annotations
 * @property {boolean} exit
 */

/**
 * Open a URL in the system default browser.
 * Non-fatal: returns false if opening fails.
 *
 * @param {string} url
 * @returns {Promise<boolean>}
 */
async function openInDefaultBrowser(url) {
    /** @type {{ command: string; args: string[] }} */
    let launcher;

    switch (Deno.build.os) {
        case "darwin":
            launcher = { command: "open", args: [url] };
            break;
        case "windows":
            launcher = { command: "cmd", args: ["/c", "start", "", url] };
            break;
        default:
            launcher = { command: "xdg-open", args: [url] };
            break;
    }

    try {
        const proc = new Deno.Command(launcher.command, {
            args: launcher.args,
            stdout: "null",
            stderr: "null",
        }).spawn();
        await proc.status.catch(() => {});
        return true;
    } catch {
        return false;
    }
}

/**
 * @returns {Promise<string>}
 */
async function loadReviewEditorHtml() {
    const resolvedServerUrl = import.meta.resolve("@gandazgul/plannotator-pi-extension-compiled/server");
    return await Deno.readTextFile(new URL("../review-editor.html", resolvedServerUrl));
}

/**
 * @param {unknown} value
 * @returns {CodeReviewAnnotation[]}
 */
function normalizeAnnotations(value) {
    if (!Array.isArray(value)) return [];
    return value.filter((item) => item && typeof item === "object");
}

/**
 * @param {unknown} decision
 * @returns {CodeReviewDecision}
 */
export function normalizeCodeReviewDecision(decision) {
    if (!decision || typeof decision !== "object") {
        return { approved: false, feedback: "", annotations: [], exit: true };
    }

    const record = /** @type {Record<string, unknown>} */ (decision);
    const feedback = typeof record.feedback === "string" ? record.feedback : "";
    return {
        approved: record.approved === true,
        feedback,
        annotations: normalizeAnnotations(record.annotations),
        exit: record.exit === true || record.canceled === true || record.cancelled === true,
    };
}

/**
 * @param {CodeReviewAnnotation[]} annotations
 * @returns {string}
 */
export function formatCodeReviewAnnotations(annotations) {
    if (annotations.length === 0) return "";

    return annotations.map((annotation, index) => {
        const file = annotation.file || annotation.path || "unknown file";
        const line = typeof annotation.line === "number" ? `:${annotation.line}` : "";
        const text = annotation.text || annotation.comment || "";
        return `${index + 1}. ${file}${line}${text ? `\n${text}` : ""}`;
    }).join("\n\n");
}

/**
 * Launch Plannotator code review for the supplied diff.
 *
 * @param {Object} opts
 * @param {string} opts.planName
 * @param {string} opts.diffText
 * @param {string} opts.executionCwd
 * @param {import('./workflow.js').UiAPI} opts.uiAPI
 * @param {{
 *   startReviewServer?: typeof startReviewServer,
 *   loadReviewEditorHtml?: typeof loadReviewEditorHtml,
 *   openInDefaultBrowser?: typeof openInDefaultBrowser,
 * }} [opts.__deps]
 * @returns {Promise<CodeReviewDecision>}
 */
export async function runPlannotatorCodeReview({
    planName,
    diffText,
    executionCwd,
    uiAPI,
    __deps,
}) {
    const startReviewServerImpl = __deps?.startReviewServer || startReviewServer;
    const loadReviewEditorHtmlImpl = __deps?.loadReviewEditorHtml || loadReviewEditorHtml;
    const openInDefaultBrowserImpl = __deps?.openInDefaultBrowser || openInDefaultBrowser;

    const htmlContent = await loadReviewEditorHtmlImpl();
    const server = await startReviewServerImpl({
        rawPatch: diffText,
        gitRef: `RunWeild workflow diff: ${planName}`,
        htmlContent,
        origin: "runweild",
        agentCwd: executionCwd,
    });

    uiAPI.appendSystemMessage(`Code review UI available at: ${server.url}`, false, "RunWeild");

    const opened = await openInDefaultBrowserImpl(server.url);
    if (!opened) {
        uiAPI.appendSystemMessage(`Could not auto-open browser. Open manually: ${server.url}`, false, "RunWeild");
    }

    try {
        return normalizeCodeReviewDecision(await server.waitForDecision());
    } finally {
        server.stop();
    }
}
