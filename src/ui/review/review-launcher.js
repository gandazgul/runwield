/**
 * @module ui/review/review-launcher
 * Adapter seam for human Plan and code review browser surfaces.
 */

import { startReviewWorkspaceServer } from "../../review-workspace-server.js";
import { parsePlanFrontMatter, resolvePlanExecutionPolicy } from "../../plan-store.js";

/**
 * @typedef {Object} ReviewSurfaceServer
 * @property {string} url
 * @property {() => Promise<any>} waitForDecision
 * @property {() => void | Promise<void>} stop
 */

/**
 * @typedef {Object} ReviewServerOutput
 * @property {"stdout" | "stderr"} stream
 * @property {string} text
 */

/** @typedef {(output: ReviewServerOutput) => void} ReviewServerOutputListener */

/** @type {Set<ReviewSurfaceServer>} */
const activeReviewSurfaces = new Set();

let processExitCleanupInstalled = false;
/** @type {Array<{ signal: "SIGINT" | "SIGTERM", handler: () => void }>} */
let processExitCleanupSignalHandlers = [];
let stoppingActiveReviewSurfaces = false;

/**
 * Stop all active browser review servers. This is exported for lifecycle
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
        uninstallProcessExitCleanup();
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
            const handler = () => {
                void (async () => {
                    await stopActiveReviewSurfaces();
                    Deno.exit(exitCode);
                })();
            };
            Deno.addSignalListener(signal, handler);
            processExitCleanupSignalHandlers.push({ signal, handler });
        } catch {
            // Some platforms or test environments do not support all signals.
        }
    }
}

function uninstallProcessExitCleanup() {
    if (!processExitCleanupInstalled) return;
    globalThis.removeEventListener?.("unload", stopActiveReviewSurfacesBestEffort);
    for (const { signal, handler } of processExitCleanupSignalHandlers) {
        try {
            Deno.removeSignalListener(signal, handler);
        } catch {
            // Best-effort cleanup for platforms or tests without signal support.
        }
    }
    processExitCleanupSignalHandlers = [];
    processExitCleanupInstalled = false;
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
            try {
                await stop();
            } finally {
                if (activeReviewSurfaces.size === 0) uninstallProcessExitCleanup();
            }
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
 * @typedef {Object} ArtifactReadSurface
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
 * @param {{ cwd: string, plan: string, planPath?: string, token?: string, openInDefaultBrowser?: typeof openInDefaultBrowser, onOutput?: ReviewServerOutputListener }} opts
 * @returns {Promise<PlanReviewSurface>}
 */
async function startWorkspaceHostedPlanReview({
    cwd,
    plan,
    planPath,
    token = crypto.randomUUID(),
    openInDefaultBrowser: openInDefaultBrowserImpl = openInDefaultBrowser,
    onOutput,
}) {
    if (!cwd) throw new Error("startWorkspaceHostedPlanReview: cwd is required");
    const { attrs } = parsePlanFrontMatter(plan);
    const policy = resolvePlanExecutionPolicy(attrs);
    const executionPolicy = policy.ok ? policy.policy : undefined;
    const server = startReviewWorkspaceServer({
        cwd,
        token,
        reviewPayload: {
            plan,
            planPath,
            classification: attrs.classification,
            frontmatter: attrs,
            ...(executionPolicy && { executionPolicy }),
        },
        reviewType: "plan",
        onOutput,
    });
    const url = `${server.url}/review/plan?token=${encodeURIComponent(token)}`;
    const opened = await openInDefaultBrowserImpl(url);
    return { ...server, url, opened };
}

/**
 * @param {{ cwd: string, markdown: string, artifactKind: "plan" | "work-record", title: string, path?: string, notices?: string[], token?: string, openInDefaultBrowser?: typeof openInDefaultBrowser, onOutput?: ReviewServerOutputListener }} opts
 * @returns {Promise<ArtifactReadSurface>}
 */
async function startWorkspaceHostedArtifactRead({
    cwd,
    markdown,
    artifactKind,
    title,
    path,
    notices = [],
    token = crypto.randomUUID(),
    openInDefaultBrowser: openInDefaultBrowserImpl = openInDefaultBrowser,
    onOutput,
}) {
    if (!cwd) throw new Error("startWorkspaceHostedArtifactRead: cwd is required");
    const server = startReviewWorkspaceServer({
        cwd,
        token,
        reviewPayload: {
            surface: "artifact-read",
            markdown,
            plan: markdown,
            artifactKind,
            title,
            artifactPath: path,
            notices,
        },
        reviewType: "plan",
        onOutput,
    });
    const url = `${server.url}/review/plan?token=${encodeURIComponent(token)}`;
    const opened = await openInDefaultBrowserImpl(url);
    return { ...server, url, opened };
}

/**
 * Start the current Plan Review surface. Workspace-hosted review routes are the
 * default, while callers may inject a legacy server with explicit HTML.
 *
 * @param {Object} opts
 * @param {string} opts.cwd
 * @param {string} opts.plan
 * @param {string} [opts.planPath]
 * @param {string} [opts.htmlContent]
 * @param {(options: object) => Promise<any>} [opts.startPlanReviewServer]
 * @param {typeof openInDefaultBrowser} [opts.openInDefaultBrowser]
 * @param {ReviewServerOutputListener} [opts.onOutput]
 * @returns {Promise<PlanReviewSurface>}
 */
export async function startPlanReviewSurface({
    cwd,
    plan,
    planPath,
    htmlContent,
    startPlanReviewServer,
    openInDefaultBrowser: openInDefaultBrowserImpl = openInDefaultBrowser,
    onOutput,
}) {
    if (!startPlanReviewServer) {
        return registerReviewSurface(
            await startWorkspaceHostedPlanReview({
                cwd,
                plan,
                planPath,
                openInDefaultBrowser: openInDefaultBrowserImpl,
                onOutput,
            }),
        );
    }
    if (!htmlContent) {
        throw new Error("Injected Plan review servers require explicit htmlContent.");
    }
    const server = registerReviewSurface(
        await startPlanReviewServer({
            plan,
            planPath,
            htmlContent,
            origin: "runwield",
            onOutput,
        }),
    );
    const opened = await openInDefaultBrowserImpl(server.url);
    return { ...server, opened };
}

/**
 * Start a Workspace-hosted read-only Markdown artifact surface for Plans and Work Records.
 *
 * @param {Object} opts
 * @param {string} opts.cwd
 * @param {string} opts.markdown
 * @param {"plan" | "work-record"} opts.artifactKind
 * @param {string} opts.title
 * @param {string} [opts.path]
 * @param {string[]} [opts.notices]
 * @param {typeof openInDefaultBrowser} [opts.openInDefaultBrowser]
 * @param {ReviewServerOutputListener} [opts.onOutput]
 * @returns {Promise<ArtifactReadSurface>}
 */
export async function startArtifactReadSurface({
    cwd,
    markdown,
    artifactKind,
    title,
    path,
    notices,
    openInDefaultBrowser: openInDefaultBrowserImpl = openInDefaultBrowser,
    onOutput,
}) {
    return registerReviewSurface(
        await startWorkspaceHostedArtifactRead({
            cwd,
            markdown,
            artifactKind,
            title,
            path,
            notices,
            openInDefaultBrowser: openInDefaultBrowserImpl,
            onOutput,
        }),
    );
}

/**
 * @param {{ rawPatch: string, gitRef: string, agentCwd: string, planContent?: string, planAttrs?: Record<string, unknown>, guidedReview?: import("../../shared/workflow/guided-review.js").GuidedReviewPolicy, token?: string, openInDefaultBrowser?: typeof openInDefaultBrowser }} opts
 * @returns {Promise<CodeReviewSurface>}
 */
async function startWorkspaceHostedCodeReview({
    rawPatch,
    gitRef,
    agentCwd,
    planContent,
    planAttrs,
    guidedReview,
    token = crypto.randomUUID(),
    openInDefaultBrowser: openInDefaultBrowserImpl = openInDefaultBrowser,
}) {
    if (!agentCwd) throw new Error("startWorkspaceHostedCodeReview: agentCwd is required");
    const cwd = agentCwd;
    const reviewStatus = await loadCodeReviewStatus(cwd);
    const server = startReviewWorkspaceServer({
        cwd,
        token,
        reviewPayload: { rawPatch, gitRef, agentCwd: cwd, reviewStatus, planContent, planAttrs, guidedReview },
        reviewType: "code",
    });
    const url = `${server.url}/review/code?token=${encodeURIComponent(token)}`;
    const opened = await openInDefaultBrowserImpl(url);
    return { ...server, url, opened };
}

/**
 * Start the current code review surface. Workspace-hosted review routes are the
 * default, while callers may inject a legacy server with explicit HTML or an
 * explicit HTML loader.
 *
 * @param {Object} opts
 * @param {string} opts.rawPatch
 * @param {string} opts.gitRef
 * @param {string} opts.agentCwd
 * @param {string} [opts.planContent]
 * @param {Record<string, unknown>} [opts.planAttrs]
 * @param {import("../../shared/workflow/guided-review.js").GuidedReviewPolicy} [opts.guidedReview]
 * @param {string} [opts.htmlContent]
 * @param {(options: object) => Promise<any>} [opts.startReviewServer]
 * @param {() => Promise<string>} [opts.loadReviewEditorHtml]
 * @param {typeof openInDefaultBrowser} [opts.openInDefaultBrowser]
 * @returns {Promise<CodeReviewSurface>}
 */
export async function startCodeReviewSurface({
    rawPatch,
    gitRef,
    agentCwd,
    planContent,
    planAttrs,
    guidedReview,
    htmlContent,
    startReviewServer,
    loadReviewEditorHtml: loadReviewEditorHtmlImpl,
    openInDefaultBrowser: openInDefaultBrowserImpl = openInDefaultBrowser,
}) {
    if (!startReviewServer) {
        return registerReviewSurface(
            await startWorkspaceHostedCodeReview({
                rawPatch,
                gitRef,
                agentCwd,
                planContent,
                planAttrs,
                guidedReview,
                openInDefaultBrowser: openInDefaultBrowserImpl,
            }),
        );
    }
    const resolvedHtmlContent = htmlContent || await loadReviewEditorHtmlImpl?.();
    if (!resolvedHtmlContent) {
        throw new Error("Injected code review servers require htmlContent or loadReviewEditorHtml.");
    }
    const server = registerReviewSurface(
        await startReviewServer({
            rawPatch,
            gitRef,
            htmlContent: resolvedHtmlContent,
            origin: "runwield",
            agentCwd,
            planContent,
            planAttrs,
            guidedReview,
        }),
    );
    const opened = await openInDefaultBrowserImpl(server.url);
    return { ...server, opened };
}
