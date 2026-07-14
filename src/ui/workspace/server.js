// @ts-nocheck: local wrapper includes a tiny Fresh-free router and production Astro bridge with dynamic handler shapes.
/**
 * Programmatic Workspace server composition.
 *
 * Local Workspace serving is RunWield-owned: token checks, cwd state,
 * static/theme routes, and JSON APIs stay in this wrapper while page SSR can
 * delegate to the Astro Deno adapter output when it is available.
 */

import { extname, join, toFileUrl } from "@std/path";
import { RUNWIELD_ROOT, RUNWIELD_SOURCE_ROOT } from "../../../runtime-root.js";
import { PLAN_UI_TOKEN_HEADER, PLAN_UI_TOKEN_QUERY } from "../../constants.js";
import {
    boardApi,
    lifecycleActionApi,
    planBodyApi,
    planDetailApi,
    plansApi,
    workspaceApi,
} from "./routes/api/handlers.js";
import { registerRemoteApiRoutes } from "./routes/remote-api.js";
import {
    registerReviewDecisionPromise,
    resolveReviewDecision,
    reviewDecisionApi,
    reviewDenyApi,
    reviewExitApi,
    reviewFeedbackApi,
} from "./routes/api/review-handlers.js";
import { createRemoteWorkspaceAdapter } from "./server/remote-adapter.js";
import { loadRunWieldThemeCss } from "../design-system/theme-bridge.js";
import { reviewImageApi, reviewImageUploadApi } from "./routes/api/review-image-handlers.js";
import { reviewFileContentApi, reviewLocalConfigApi, reviewOpenInAppsApi } from "./routes/api/review-file-handlers.js";

const WORKSPACE_DIR = join(RUNWIELD_SOURCE_ROOT, "ui", "workspace");
const ROOT_DIR = RUNWIELD_ROOT;
const DESIGN_SYSTEM_DIR = join(WORKSPACE_DIR, "..", "design-system");
const STYLES_PATH = join(WORKSPACE_DIR, "static", "styles.css");
const TOKENS_CSS_PATH = join(DESIGN_SYSTEM_DIR, "tokens.css");
const COMPONENTS_CSS_PATH = join(DESIGN_SYSTEM_DIR, "components.css");
const WORKSPACE_CSS_PATH = join(WORKSPACE_DIR, "static", "workspace.css");
const LOGO_PATH = join(ROOT_DIR, "logo.svg");
const ASTRO_SOURCE_DIST_DIR = join(ROOT_DIR, "dist", "workspace");
const ASTRO_RUNTIME_DIR = join(ROOT_DIR, "dist", "workspace-runtime");
const ASTRO_SOURCE_ENTRY_PATH = join(ASTRO_SOURCE_DIST_DIR, "server", "entry.mjs");
const ASTRO_RUNTIME_ENTRY_PATH = join(ASTRO_RUNTIME_DIR, "server.mjs");
const ASTRO_SOURCE_CLIENT_ASSET_DIR = join(ASTRO_SOURCE_DIST_DIR, "client", "_astro");
const ASTRO_RUNTIME_CLIENT_ASSET_DIR = join(ASTRO_RUNTIME_DIR, "client", "_astro");
const WORKSPACE_CWD_HEADER = "x-runwield-workspace-cwd";
const WORKSPACE_PLAN_ADAPTER_URL_KEY = Symbol.for("runwield.workspace.plan-adapter-url");

/** @type {any} */ (globalThis)[WORKSPACE_PLAN_ADAPTER_URL_KEY] = toFileUrl(
    join(WORKSPACE_DIR, "server", "plan-adapter.js"),
).href;

/** @typedef {{ handler: () => (request: Request) => Promise<Response> }} WorkspaceApp */
const REVIEW_PAYLOAD_HEADER = "x-runwield-review-payload";

/**
 * @typedef {Object} ReviewServerOutput
 * @property {"stdout" | "stderr"} stream
 * @property {string} text
 */

/** @typedef {(output: ReviewServerOutput) => void} ReviewServerOutputListener */

/**
 * @param {Request} request
 * @param {string} expectedToken
 */
export function hasWorkspaceToken(request, expectedToken) {
    const url = new URL(request.url);
    return url.searchParams.get(PLAN_UI_TOKEN_QUERY) === expectedToken ||
        request.headers.get(PLAN_UI_TOKEN_HEADER) === expectedToken;
}

/**
 * @typedef {Object} LocalWorkspaceAppOptions
 * @property {"local"} [mode]
 * @property {string} cwd
 * @property {string} token
 * @property {boolean} [skipTokenCheck]
 */

/**
 * @typedef {Object} RemoteWorkspaceAppOptions
 * @property {"remote"} mode
 * @property {string} [dbPath]
 * @property {import("./server/remote-adapter.js").RemoteWorkspaceAdapter} [adapter]
 */

/** @param {LocalWorkspaceAppOptions | RemoteWorkspaceAppOptions} options */
export function createWorkspaceApp(options) {
    if (options.mode === "remote") return createRemoteWorkspaceApp(options);
    return createLocalWorkspaceApp(options);
}

/** @param {RemoteWorkspaceAppOptions} options */
export function createRemoteWorkspaceApp(options = { mode: "remote" }) {
    const app = createWorkspaceRouter();
    const adapter = options.adapter ?? createRemoteWorkspaceAdapter({ dbPath: options.dbPath });
    registerStaticRoutes(app);
    app.use(async (ctx) => {
        ctx.state.collaboration = adapter;
        return await ctx.next();
    });
    registerRemoteApiRoutes(app);
    app.notFound(() => jsonNotFound());
    return app;
}

/** @param {LocalWorkspaceAppOptions} options */
function createLocalWorkspaceApp({ cwd, token, skipTokenCheck = false }) {
    return {
        handler() {
            /** @param {Request} request */
            return async (request) => {
                const url = new URL(request.url);
                if (isPublicWorkspaceAsset(url.pathname)) return await handleStaticRoute(url.pathname);
                if (!skipTokenCheck && !hasWorkspaceToken(request, token)) {
                    return new Response("Workspace token required.", { status: 401 });
                }
                return await handleLocalWorkspaceRequest(request, { cwd });
            };
        },
    };
}

/**
 * @param {{ cwd: string, token: string, reviewPayload: Record<string, unknown>, reviewType: "plan" | "code" }} options
 */
export function createReviewWorkspaceApp({ cwd, token, reviewPayload, reviewType }) {
    return {
        handler() {
            /** @param {Request} request */
            return async (request) => {
                const url = new URL(request.url);
                if (isPublicWorkspaceAsset(url.pathname)) return await handleStaticRoute(url.pathname);
                if (request.method === "POST" && url.pathname === "/api/upload") {
                    if (!hasReviewAssetToken(request, token)) {
                        return new Response("Review token required.", { status: 401 });
                    }
                    return await reviewImageUploadApi(request);
                }
                if (request.method === "GET" && url.pathname === "/api/image") {
                    if (!hasReviewAssetToken(request, token)) {
                        return new Response("Review token required.", { status: 401 });
                    }
                    return await reviewImageApi(request, { cwd });
                }
                if (request.method === "GET" && url.pathname === "/api/file-content") {
                    if (!hasReviewAssetToken(request, token)) {
                        return new Response("Review token required.", { status: 401 });
                    }
                    return await reviewFileContentApi(request, { cwd });
                }
                if (request.method === "GET" && url.pathname === "/api/open-in/apps") {
                    if (!hasReviewAssetToken(request, token)) {
                        return new Response("Review token required.", { status: 401 });
                    }
                    return reviewOpenInAppsApi();
                }
                if (request.method === "POST" && url.pathname === "/api/config") {
                    if (!hasReviewAssetToken(request, token)) {
                        return new Response("Review token required.", { status: 401 });
                    }
                    return reviewLocalConfigApi();
                }
                if (url.pathname.startsWith("/api/review/") || isLegacyReviewApiPath(url.pathname)) {
                    return await handleReviewApiRequest(request, { cwd, reviewToken: token }, url.pathname);
                }
                if (!hasWorkspaceToken(request, token)) return new Response("Review token required.", { status: 401 });
                const expectedPath = reviewType === "plan" ? "/review/plan" : "/review/code";
                if (url.pathname === expectedPath) {
                    const payload = { ...reviewPayload, token, mode: "workflow" };
                    const astroResponse = await renderAstroReviewPage(request, cwd, payload);
                    if (astroResponse) return astroResponse;
                    return workspaceBuildUnavailable();
                }
                return new Response("Not found", { status: 404 });
            };
        },
    };
}

/** @param {Request} request @param {string} token */
function hasReviewAssetToken(request, token) {
    if (hasWorkspaceToken(request, token)) return true;
    const referer = request.headers.get("referer");
    if (!referer) return false;
    try {
        return new URL(referer).searchParams.get(PLAN_UI_TOKEN_QUERY) === token;
    } catch {
        return false;
    }
}

/** @param {Request} request @param {{ cwd: string }} state */
async function handleLocalWorkspaceRequest(request, state) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const apiResponse = await handleLocalApiRequest(request, state, pathname);
    if (apiResponse) return apiResponse;

    if (isAstroPageRoute(pathname)) {
        const astroResponse = await renderAstroPage(request, state.cwd);
        if (astroResponse) return astroResponse;
        return workspaceBuildUnavailable();
    }

    return new Response("Not found", { status: 404 });
}

/** @param {string} pathname */
function isAstroPageRoute(pathname) {
    return pathname === "/" || pathname === "/closed" || pathname === "/on-hold" || pathname.startsWith("/plans/");
}

/** @param {Request} request @param {{ cwd: string }} state @param {string} pathname */
async function handleLocalApiRequest(request, state, pathname) {
    if (request.method === "GET" && pathname === "/api/workspace") return await workspaceApi(ctx(request, state));
    if (request.method === "GET" && pathname === "/api/plans") return await plansApi(ctx(request, state));
    if (request.method === "GET" && pathname === "/api/board") return await boardApi(ctx(request, state));

    const planDetailMatch = /^\/api\/plans\/([^/]+)$/.exec(pathname);
    if (request.method === "GET" && planDetailMatch) {
        return await planDetailApi(ctx(request, state, { planId: decodeURIComponent(planDetailMatch[1]) }));
    }

    const lifecycleMatch = /^\/api\/plans\/([^/]+)\/lifecycle-action$/.exec(pathname);
    if (request.method === "POST" && lifecycleMatch) {
        return await lifecycleActionApi(ctx(request, state, { planId: decodeURIComponent(lifecycleMatch[1]) }));
    }

    const bodyMatch = /^\/api\/plans\/([^/]+)\/body$/.exec(pathname);
    if (request.method === "POST" && bodyMatch) {
        return await planBodyApi(ctx(request, state, { planId: decodeURIComponent(bodyMatch[1]) }));
    }

    if (pathname.startsWith("/api/")) return jsonNotFound();
    return null;
}

/** @param {Request} request @param {{ cwd: string }} state @param {string} pathname */
async function handleReviewApiRequest(request, state, pathname) {
    if (request.method === "POST" && (pathname === "/api/review/decision" || pathname === "/api/decision")) {
        return await reviewDecisionApi(ctx(request, state));
    }
    if (request.method === "POST" && (pathname === "/api/review/deny" || pathname === "/api/deny")) {
        return await reviewDenyApi(ctx(request, state));
    }
    if (request.method === "POST" && (pathname === "/api/review/feedback" || pathname === "/api/feedback")) {
        return await reviewFeedbackApi(ctx(request, state));
    }
    if (request.method === "POST" && (pathname === "/api/review/exit" || pathname === "/api/exit")) {
        return await reviewExitApi(ctx(request, state));
    }
    return jsonNotFound();
}

/** @param {Request} req @param {{ cwd: string }} state @param {Record<string, string>} [params] */
function ctx(req, state, params = {}) {
    return { req, request: req, url: new URL(req.url), state, params };
}

async function loadAstroHandle() {
    const entryPaths = Deno.build.standalone
        ? [ASTRO_RUNTIME_ENTRY_PATH, ASTRO_SOURCE_ENTRY_PATH]
        : [ASTRO_SOURCE_ENTRY_PATH, ASTRO_RUNTIME_ENTRY_PATH];
    for (const entryPath of entryPaths) {
        try {
            const entryUrl = toFileUrl(entryPath).href;
            const entry = await import(`${entryUrl}?mtime=${Date.now()}`);
            if (typeof entry.handle === "function") return entry.handle;
        } catch {
            // Try the source build after the opaque runtime build, or vice versa.
        }
    }
    return null;
}

/** @param {Request} request @param {string} cwd */
async function renderAstroPage(request, cwd) {
    const handle = await loadAstroHandle();
    if (!handle) return null;
    const response = await handle(withWorkspaceCwdHeader(request, cwd));
    return response.status === 404 ? null : response;
}

/** @param {Request} request @param {string} cwd @param {Record<string, unknown>} payload */
async function renderAstroReviewPage(request, cwd, payload) {
    const handle = await loadAstroHandle();
    if (!handle) return null;
    const headers = new Headers(request.headers);
    headers.set(WORKSPACE_CWD_HEADER, cwd);
    headers.set(REVIEW_PAYLOAD_HEADER, encodeURIComponent(JSON.stringify(payload)));
    const response = await handle(rebuildRequestWithHeaders(request, headers));
    return response.status === 404 ? null : response;
}

/** @param {string} pathname */
function isLegacyReviewApiPath(pathname) {
    return pathname === "/api/decision" ||
        pathname === "/api/deny" ||
        pathname === "/api/feedback" ||
        pathname === "/api/exit";
}

function workspaceBuildUnavailable() {
    return new Response(
        "Workspace Astro build unavailable. Run `deno task workspace:build` before serving page routes.",
        {
            status: 503,
            headers: { "content-type": "text/plain; charset=utf-8" },
        },
    );
}

/** @param {Request} request @param {string} cwd */
function withWorkspaceCwdHeader(request, cwd) {
    const headers = new Headers(request.headers);
    headers.set(WORKSPACE_CWD_HEADER, cwd);
    return rebuildRequestWithHeaders(request, headers);
}

/**
 * Rebuild a server request with replacement headers without inheriting its
 * signal. Cloning a Deno.serve request also clones the runtime's legacy abort
 * signal, which emits a native stderr warning after every successful response
 * unless the parent process was started with an unstable flag.
 *
 * @param {Request} request
 * @param {Headers} headers
 * @returns {Request}
 */
export function rebuildRequestWithHeaders(request, headers) {
    /** @type {RequestInit} */
    const init = {
        method: request.method,
        headers,
        redirect: request.redirect,
    };
    if (request.method !== "GET" && request.method !== "HEAD") {
        init.body = request.body;
    }
    return new Request(request.url, init);
}

function createWorkspaceRouter() {
    const routes = [];
    const middleware = [];
    let notFoundHandler = () => jsonNotFound();
    const add = (method, pattern, handler) => routes.push({ method, pattern, handler });
    return {
        get: (pattern, handler) => add("GET", pattern, handler),
        post: (pattern, handler) => add("POST", pattern, handler),
        use: (handler) => middleware.push(handler),
        notFound: (handler) => {
            notFoundHandler = handler;
        },
        handler: () => async (request) => {
            const url = new URL(request.url);
            const route = routes.find((candidate) =>
                candidate.method === request.method && matchRoute(candidate.pattern, url.pathname)
            );
            const params = route ? matchRoute(route.pattern, url.pathname) : {};
            const state = {};
            const context = {
                req: request,
                request,
                url,
                params,
                state,
                next: async () => await runMiddleware(0),
            };
            const runMiddleware = async (index) => {
                const item = middleware[index];
                if (!item) return route ? await route.handler(context) : await notFoundHandler(context);
                context.next = async () => await runMiddleware(index + 1);
                return await item(context);
            };
            return await runMiddleware(0);
        },
    };
}

/** @param {string} pattern @param {string} pathname */
function matchRoute(pattern, pathname) {
    const patternParts = pattern.split("/").filter(Boolean);
    const pathParts = pathname.split("/").filter(Boolean);
    if (patternParts.length !== pathParts.length) return null;
    const params = {};
    for (let index = 0; index < patternParts.length; index += 1) {
        const patternPart = patternParts[index];
        const pathPart = pathParts[index];
        if (patternPart.startsWith(":")) params[patternPart.slice(1)] = decodeURIComponent(pathPart);
        else if (patternPart !== pathPart) return null;
    }
    return params;
}

/** @param {ReturnType<typeof createWorkspaceRouter>} app */
function registerStaticRoutes(app) {
    app.get("/styles.css", async () => await handleStaticRoute("/styles.css"));
    app.get("/tokens.css", async () => await handleStaticRoute("/tokens.css"));
    app.get("/components.css", async () => await handleStaticRoute("/components.css"));
    app.get("/workspace.css", async () => await handleStaticRoute("/workspace.css"));
    app.get("/theme.css", async () => await handleStaticRoute("/theme.css"));
    app.get("/logo.svg", async () => await handleStaticRoute("/logo.svg"));
}

/** @param {string} pathname */
async function handleStaticRoute(pathname) {
    if (pathname === "/styles.css") return await textFileResponse(STYLES_PATH, "text/css; charset=utf-8");
    if (pathname === "/tokens.css") return await textFileResponse(TOKENS_CSS_PATH, "text/css; charset=utf-8");
    if (pathname === "/components.css") return await textFileResponse(COMPONENTS_CSS_PATH, "text/css; charset=utf-8");
    if (pathname === "/workspace.css") return await textFileResponse(WORKSPACE_CSS_PATH, "text/css; charset=utf-8");
    if (pathname === "/theme.css") {
        const css = await loadRunWieldThemeCss();
        return new Response(css, {
            headers: {
                "content-type": "text/css; charset=utf-8",
                "cache-control": "no-store",
            },
        });
    }
    if (pathname === "/logo.svg") return await textFileResponse(LOGO_PATH, "image/svg+xml; charset=utf-8");
    if (pathname.startsWith("/_astro/")) return await handleAstroAsset(pathname);
    return new Response("Not found", { status: 404 });
}

/** @param {string} pathname */
async function handleAstroAsset(pathname) {
    const encodedName = pathname.slice("/_astro/".length);
    let assetName = "";
    try {
        assetName = decodeURIComponent(encodedName);
    } catch {
        return new Response("Not found", { status: 404 });
    }
    if (!assetName || assetName.includes("..") || assetName.includes("/")) {
        return new Response("Not found", { status: 404 });
    }

    const runtimeAssetName = getOpaqueWorkspaceAssetName(assetName);
    const assetPaths = Deno.build.standalone
        ? [
            join(ASTRO_RUNTIME_CLIENT_ASSET_DIR, runtimeAssetName),
            join(ASTRO_SOURCE_CLIENT_ASSET_DIR, assetName),
        ]
        : [
            join(ASTRO_SOURCE_CLIENT_ASSET_DIR, assetName),
            join(ASTRO_RUNTIME_CLIENT_ASSET_DIR, runtimeAssetName),
        ];
    for (const assetPath of assetPaths) {
        try {
            const body = await Deno.readFile(assetPath);
            return new Response(body, {
                headers: {
                    "content-type": contentTypeForAsset(assetName),
                    "cache-control": "public, max-age=31536000, immutable",
                },
            });
        } catch {
            // Try the source build after the opaque runtime build, or vice versa.
        }
    }
    return new Response("Not found", { status: 404 });
}

/** @param {string} name */
function getOpaqueWorkspaceAssetName(name) {
    return [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"].includes(extname(name).toLowerCase())
        ? `${name}.asset`
        : name;
}

/** @param {string} path */
function contentTypeForAsset(path) {
    const extension = extname(path);
    if (extension === ".css") return "text/css; charset=utf-8";
    if (extension === ".js" || extension === ".mjs") return "text/javascript; charset=utf-8";
    if (extension === ".svg") return "image/svg+xml; charset=utf-8";
    if (extension === ".png") return "image/png";
    if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
    if (extension === ".webp") return "image/webp";
    if (extension === ".woff2") return "font/woff2";
    return "application/octet-stream";
}

/** @param {string} path @param {string} contentType */
async function textFileResponse(path, contentType) {
    try {
        const body = await Deno.readTextFile(path);
        return new Response(body, { headers: { "content-type": contentType } });
    } catch {
        return new Response("Not found", { status: 404 });
    }
}

/** @param {string} pathname */
function isPublicWorkspaceAsset(pathname) {
    return pathname === "/styles.css" ||
        pathname === "/tokens.css" ||
        pathname === "/components.css" ||
        pathname === "/workspace.css" ||
        pathname === "/theme.css" ||
        pathname === "/logo.svg" ||
        pathname.startsWith("/_astro/");
}

function jsonNotFound() {
    return Response.json({ error: "not_found", message: "Not found.", status: 404 }, {
        status: 404,
        headers: { "cache-control": "no-store" },
    });
}

/**
 * @param {{ mode?: "local" | "remote", cwd?: string, host: string, port: number, token?: string, dbPath?: string, signal?: AbortSignal }} options
 */
export function startWorkspaceServer(options) {
    const app = options.mode === "remote"
        ? createWorkspaceApp({ mode: "remote", dbPath: options.dbPath })
        : createWorkspaceApp({ cwd: options.cwd ?? Deno.cwd(), token: options.token ?? "" });
    return Deno.serve({
        hostname: options.host,
        port: options.port,
        signal: options.signal,
        automaticCompression: true,
    }, app.handler());
}

/**
 * @param {{ cwd?: string, token: string, reviewPayload: Record<string, unknown>, reviewType: "plan" | "code", host?: string, port?: number, signal?: AbortSignal, onOutput?: ReviewServerOutputListener }} options
 */
export function startReviewWorkspaceServer(options) {
    const cwd = options.cwd ?? Deno.cwd();
    const host = options.host ?? "127.0.0.1";
    const { promise } = registerReviewDecisionPromise(options.token);
    const app = createReviewWorkspaceApp({
        cwd,
        token: options.token,
        reviewPayload: options.reviewPayload,
        reviewType: options.reviewType,
    });
    let server;
    try {
        server = Deno.serve({
            hostname: host,
            port: options.port ?? 0,
            automaticCompression: true,
            onListen(address) {
                options.onOutput?.({
                    stream: "stdout",
                    text: `Listening on http://${address.hostname}:${address.port}/\n`,
                });
            },
            onError(error) {
                const text = error instanceof Error ? error.stack || error.message : String(error);
                options.onOutput?.({ stream: "stderr", text: `${text}\n` });
                return new Response("Internal Server Error", { status: 500 });
            },
        }, app.handler());
    } catch (error) {
        const text = error instanceof Error ? error.stack || error.message : String(error);
        options.onOutput?.({ stream: "stderr", text: `${text}\n` });
        throw error;
    }
    const port = server.addr.port;
    const url = `http://${host}:${port}`;
    /** @type {Promise<void> | null} */
    let stopPromise = null;

    const stop = () => {
        options.signal?.removeEventListener("abort", onAbort);
        const canceledDecision = options.reviewType === "plan"
            ? { approved: false, feedback: "", exit: true, canceled: true }
            : { approved: false, feedback: "", annotations: [], exit: true, canceled: true };
        resolveReviewDecision(options.token, canceledDecision);
        stopPromise ??= server.shutdown().catch((error) => {
            const text = error instanceof Error ? error.stack || error.message : String(error);
            options.onOutput?.({ stream: "stderr", text: `${text}\n` });
            throw error;
        });
        return stopPromise;
    };
    const onAbort = () => {
        void stop().catch(() => {});
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) onAbort();

    return {
        url,
        waitForDecision: () => promise,
        stop,
    };
}
