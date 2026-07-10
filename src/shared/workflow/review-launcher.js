/**
 * @module shared/workflow/review-launcher
 * Adapter seam for human Plan and code review browser surfaces.
 */

import { startReviewWorkspaceServer } from "../../review-workspace-server.js";

const PLANNOTATOR_SERVER_MODULE = "@gandazgul/plannotator-pi-extension-compiled/server";
const PLANNOTATOR_ASSETS_MODULE = "@gandazgul/plannotator-pi-extension-compiled/assets";

/**
 * @typedef {Object} ReviewSurfaceServer
 * @property {string} url
 * @property {() => Promise<any>} waitForDecision
 * @property {() => void | Promise<void>} stop
 */

/** @type {Set<ReviewSurfaceServer>} */
const activeReviewSurfaces = new Set();

let processExitCleanupInstalled = false;
let stoppingActiveReviewSurfaces = false;

/**
 * Stop all active Plannotator review servers. This is exported for lifecycle
 * owners and tests; callers should still prefer per-surface stop in normal flow.
 *
 * @returns {Promise<void>}
 */
export async function stopActiveReviewSurfaces() {
    if (stoppingActiveReviewSurfaces) return;
    stoppingActiveReviewSurfaces = true;
    const surfaces = Array.from(activeReviewSurfaces);
    activeReviewSurfaces.clear();

    try {
        await Promise.all(surfaces.map(async (surface) => {
            try {
                await surface.stop();
            } catch {
                // Exit cleanup is best-effort. Normal per-review cleanup still
                // reports failures through the caller's await server.stop().
            }
        }));
    } finally {
        stoppingActiveReviewSurfaces = false;
    }
}

function stopActiveReviewSurfacesBestEffort() {
    void stopActiveReviewSurfaces();
}

function installProcessExitCleanup() {
    if (processExitCleanupInstalled) return;
    processExitCleanupInstalled = true;

    globalThis.addEventListener?.("unload", stopActiveReviewSurfacesBestEffort);

    for (const [signal, exitCode] of /** @type {const} */ ([["SIGINT", 130], ["SIGTERM", 143]])) {
        try {
            Deno.addSignalListener(signal, () => {
                void (async () => {
                    await stopActiveReviewSurfaces();
                    Deno.exit(exitCode);
                })();
            });
        } catch {
            // Some platforms or test environments do not support all signals.
        }
    }
}

/**
 * @template {ReviewSurfaceServer} T
 * @param {T} server
 * @returns {T}
 */
function registerReviewSurface(server) {
    installProcessExitCleanup();
    activeReviewSurfaces.add(server);

    const stop = server.stop.bind(server);
    return /** @type {T} */ ({
        ...server,
        stop: async () => {
            activeReviewSurfaces.delete(server);
            await stop();
        },
    });
}

/**
 * Open a URL in the system default browser.
 * Non-fatal: returns false if opening fails.
 *
 * @param {string} url
 * @returns {Promise<boolean>}
 */
export async function openInDefaultBrowser(url) {
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
async function loadPlanReviewHtml() {
    const assetsModule = PLANNOTATOR_ASSETS_MODULE;
    const assets = await import(assetsModule);
    return assets.plannotatorHtml;
}

/**
 * @returns {Promise<string>}
 */
export async function loadReviewEditorHtml() {
    const resolvedServerUrl = import.meta.resolve(PLANNOTATOR_SERVER_MODULE);
    return await Deno.readTextFile(new URL("../review-editor.html", resolvedServerUrl));
}

/**
 * @param {string} cwd
 * @returns {Promise<{ stagedFiles: string[], unstagedFiles: string[], untrackedFiles: string[] }>}
 */
async function loadCodeReviewStatus(cwd) {
    const empty = { stagedFiles: [], unstagedFiles: [], untrackedFiles: [] };
    try {
        const output = await new Deno.Command("git", {
            args: ["status", "--porcelain=v1", "-z"],
            cwd,
            stdout: "piped",
            stderr: "null",
        }).output();
        if (!output.success) return empty;
        return parseGitPorcelainStatus(new TextDecoder().decode(output.stdout));
    } catch {
        return empty;
    }
}

/**
 * @param {string} text
 * @returns {{ stagedFiles: string[], unstagedFiles: string[], untrackedFiles: string[] }}
 */
function parseGitPorcelainStatus(text) {
    const stagedFiles = new Set();
    const unstagedFiles = new Set();
    const untrackedFiles = new Set();
    const parts = text.split("\0").filter(Boolean);
    for (let index = 0; index < parts.length; index += 1) {
        const entry = parts[index];
        if (entry.length < 4) continue;
        const x = entry[0];
        const y = entry[1];
        const path = entry.slice(3);
        if (x === "?" && y === "?") {
            untrackedFiles.add(path);
            continue;
        }
        if (x === "R" || x === "C") index += 1;
        if (x !== " " && x !== "?") stagedFiles.add(path);
        if (y !== " " && y !== "?") unstagedFiles.add(path);
    }
    return {
        stagedFiles: [...stagedFiles],
        unstagedFiles: [...unstagedFiles],
        untrackedFiles: [...untrackedFiles],
    };
}

/**
 * @typedef {Object} PlanReviewSurface
 * @property {string} url
 * @property {() => Promise<any>} waitForDecision
 * @property {() => void | Promise<void>} stop
 * @property {boolean} opened
 */

/**
 * @typedef {Object} CodeReviewSurface
 * @property {string} url
 * @property {() => Promise<any>} waitForDecision
 * @property {() => void | Promise<void>} stop
 * @property {boolean} opened
 */

/**
 * @param {{ plan: string, planPath?: string, token?: string, openInDefaultBrowser?: typeof openInDefaultBrowser }} opts
 * @returns {Promise<PlanReviewSurface>}
 */
async function startWorkspaceHostedPlanReview({
    plan,
    planPath,
    token = crypto.randomUUID(),
    openInDefaultBrowser: openInDefaultBrowserImpl = openInDefaultBrowser,
}) {
    const server = startReviewWorkspaceServer({
        cwd: Deno.cwd(),
        token,
        reviewPayload: { plan, planPath },
        reviewType: "plan",
    });
    const url = `${server.url}/review/plan?token=${encodeURIComponent(token)}`;
    const opened = await openInDefaultBrowserImpl(url);
    return { ...server, url, opened };
}

/**
 * Start the current Plan Review surface. Workspace-hosted review routes are the
 * default, while the compiled Plannotator server remains injectable for tests
 * and fallback verification.
 *
 * @param {Object} opts
 * @param {string} opts.plan
 * @param {string} [opts.planPath]
 * @param {string} [opts.htmlContent]
 * @param {(options: object) => Promise<any>} [opts.startPlanReviewServer]
 * @param {typeof openInDefaultBrowser} [opts.openInDefaultBrowser]
 * @returns {Promise<PlanReviewSurface>}
 */
export async function startPlanReviewSurface({
    plan,
    planPath,
    htmlContent,
    startPlanReviewServer,
    openInDefaultBrowser: openInDefaultBrowserImpl = openInDefaultBrowser,
}) {
    if (!startPlanReviewServer) {
        return registerReviewSurface(
            await startWorkspaceHostedPlanReview({
                plan,
                planPath,
                openInDefaultBrowser: openInDefaultBrowserImpl,
            }),
        );
    }
    const server = registerReviewSurface(
        await startPlanReviewServer({
            plan,
            planPath,
            htmlContent: htmlContent || await loadPlanReviewHtml(),
            origin: "runwield",
        }),
    );
    const opened = await openInDefaultBrowserImpl(server.url);
    return { ...server, opened };
}

/**
 * @param {{ rawPatch: string, gitRef: string, agentCwd: string, token?: string, openInDefaultBrowser?: typeof openInDefaultBrowser }} opts
 * @returns {Promise<CodeReviewSurface>}
 */
async function startWorkspaceHostedCodeReview({
    rawPatch,
    gitRef,
    agentCwd,
    token = crypto.randomUUID(),
    openInDefaultBrowser: openInDefaultBrowserImpl = openInDefaultBrowser,
}) {
    const cwd = agentCwd || Deno.cwd();
    const reviewStatus = await loadCodeReviewStatus(cwd);
    const server = startReviewWorkspaceServer({
        cwd,
        token,
        reviewPayload: { rawPatch, gitRef, agentCwd: cwd, reviewStatus },
        reviewType: "code",
    });
    const url = `${server.url}/review/code?token=${encodeURIComponent(token)}`;
    const opened = await openInDefaultBrowserImpl(url);
    return { ...server, url, opened };
}

/**
 * Start the current code review surface. Workspace-hosted review routes are the
 * default, while the compiled Plannotator server remains injectable for tests
 * and fallback verification.
 *
 * @param {Object} opts
 * @param {string} opts.rawPatch
 * @param {string} opts.gitRef
 * @param {string} opts.agentCwd
 * @param {string} [opts.htmlContent]
 * @param {(options: object) => Promise<any>} [opts.startReviewServer]
 * @param {typeof loadReviewEditorHtml} [opts.loadReviewEditorHtml]
 * @param {typeof openInDefaultBrowser} [opts.openInDefaultBrowser]
 * @returns {Promise<CodeReviewSurface>}
 */
export async function startCodeReviewSurface({
    rawPatch,
    gitRef,
    agentCwd,
    htmlContent,
    startReviewServer,
    loadReviewEditorHtml: loadReviewEditorHtmlImpl = loadReviewEditorHtml,
    openInDefaultBrowser: openInDefaultBrowserImpl = openInDefaultBrowser,
}) {
    if (!startReviewServer) {
        return registerReviewSurface(
            await startWorkspaceHostedCodeReview({
                rawPatch,
                gitRef,
                agentCwd,
                openInDefaultBrowser: openInDefaultBrowserImpl,
            }),
        );
    }
    const resolvedHtmlContent = htmlContent || await loadReviewEditorHtmlImpl();
    const server = registerReviewSurface(
        await startReviewServer({
            rawPatch,
            gitRef,
            htmlContent: resolvedHtmlContent,
            origin: "runwield",
            agentCwd,
        }),
    );
    const opened = await openInDefaultBrowserImpl(server.url);
    return { ...server, opened };
}
