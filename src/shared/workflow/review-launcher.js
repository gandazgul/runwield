/**
 * @module shared/workflow/review-launcher
 * Adapter seam for human Plan and code review browser surfaces.
 */

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
 * @param {ReviewSurfaceServer} server
 * @returns {ReviewSurfaceServer}
 */
function registerReviewSurface(server) {
    installProcessExitCleanup();
    activeReviewSurfaces.add(server);

    const stop = server.stop.bind(server);
    return {
        ...server,
        stop: async () => {
            activeReviewSurfaces.delete(server);
            await stop();
        },
    };
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
 * @returns {Promise<{ startPlanReviewServer: (options: object) => Promise<any>, startReviewServer: (options: object) => Promise<any> }>}
 */
async function loadPlannotatorServerModule() {
    const serverModule = PLANNOTATOR_SERVER_MODULE;
    const server = await import(serverModule);
    return {
        startPlanReviewServer: server.startPlanReviewServer,
        startReviewServer: server.startReviewServer,
    };
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
 * Start the current Plan Review surface. This adapter intentionally keeps the
 * compiled Plannotator bridge as the default while Workspace-hosted review
 * routes are developed behind the same interface.
 *
 * @param {Object} opts
 * @param {string} opts.plan
 * @param {string} [opts.htmlContent]
 * @param {(options: object) => Promise<any>} [opts.startPlanReviewServer]
 * @param {typeof openInDefaultBrowser} [opts.openInDefaultBrowser]
 * @returns {Promise<PlanReviewSurface>}
 */
export async function startPlanReviewSurface({
    plan,
    htmlContent,
    startPlanReviewServer,
    openInDefaultBrowser: openInDefaultBrowserImpl = openInDefaultBrowser,
}) {
    const serverModule = startPlanReviewServer ? null : await loadPlannotatorServerModule();
    const startPlanReviewServerImpl = startPlanReviewServer || serverModule?.startPlanReviewServer;
    if (!startPlanReviewServerImpl) throw new Error("startPlanReviewSurface: Plannotator server failed to load");
    const server = registerReviewSurface(
        await startPlanReviewServerImpl({
            plan,
            htmlContent: htmlContent || await loadPlanReviewHtml(),
            origin: "runwield",
        }),
    );
    const opened = await openInDefaultBrowserImpl(server.url);
    return { ...server, opened };
}

/**
 * Start the current code review surface. This adapter intentionally keeps the
 * compiled Plannotator bridge as the default while Workspace-hosted review
 * routes are developed behind the same interface.
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
    const serverModule = startReviewServer ? null : await loadPlannotatorServerModule();
    const startReviewServerImpl = startReviewServer || serverModule?.startReviewServer;
    if (!startReviewServerImpl) throw new Error("startCodeReviewSurface: Plannotator server failed to load");
    const resolvedHtmlContent = htmlContent || await loadReviewEditorHtmlImpl();
    const server = registerReviewSurface(
        await startReviewServerImpl({
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
