// @ts-nocheck: local wrapper includes a tiny Fresh-free router and production Astro bridge with dynamic handler shapes.
/**
 * Programmatic Workspace server composition.
 *
 * Local Workspace serving is RunWield-owned: token checks, cwd state,
 * static/theme routes, and JSON APIs stay in this wrapper while page SSR can
 * delegate to the Astro Deno adapter output when it is available.
 */

import { dirname, extname, fromFileUrl, join, toFileUrl } from "@std/path";
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
import { createRemoteWorkspaceAdapter } from "./server/remote-adapter.js";
import { loadRunWieldThemeCss } from "../design-system/theme-bridge.js";

const WORKSPACE_DIR = dirname(fromFileUrl(import.meta.url));
const ROOT_DIR = join(WORKSPACE_DIR, "..", "..", "..");
const DESIGN_SYSTEM_DIR = join(WORKSPACE_DIR, "..", "design-system");
const STYLES_PATH = join(WORKSPACE_DIR, "static", "styles.css");
const TOKENS_CSS_PATH = join(DESIGN_SYSTEM_DIR, "tokens.css");
const COMPONENTS_CSS_PATH = join(DESIGN_SYSTEM_DIR, "components.css");
const WORKSPACE_CSS_PATH = join(WORKSPACE_DIR, "static", "workspace.css");
const LOGO_PATH = join(ROOT_DIR, "logo.svg");
const ASTRO_DIST_DIR = join(ROOT_DIR, "dist", "workspace");
const ASTRO_ENTRY_PATH = join(ASTRO_DIST_DIR, "server", "entry.mjs");
const ASTRO_CLIENT_ASSET_DIR = join(ASTRO_DIST_DIR, "client", "_astro");
const WORKSPACE_CWD_HEADER = "x-runwield-workspace-cwd";

/** @typedef {{ handler: () => (request: Request) => Promise<Response> }} WorkspaceApp */

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

/** @param {Request} req @param {{ cwd: string }} state @param {Record<string, string>} [params] */
function ctx(req, state, params = {}) {
    return { req, request: req, url: new URL(req.url), state, params };
}

async function loadAstroHandle() {
    try {
        const entryUrl = toFileUrl(ASTRO_ENTRY_PATH).href;
        const entry = await import(`${entryUrl}?mtime=${Date.now()}`);
        return typeof entry.handle === "function" ? entry.handle : null;
    } catch {
        return null;
    }
}

/** @param {Request} request @param {string} cwd */
async function renderAstroPage(request, cwd) {
    const handle = await loadAstroHandle();
    if (!handle) return null;
    const response = await handle(withWorkspaceCwdHeader(request, cwd));
    return response.status === 404 ? null : response;
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
    return new Request(request, { headers });
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

    const assetPath = join(ASTRO_CLIENT_ASSET_DIR, assetName);
    try {
        const body = await Deno.readFile(assetPath);
        return new Response(body, {
            headers: {
                "content-type": contentTypeForAsset(assetPath),
                "cache-control": "public, max-age=31536000, immutable",
            },
        });
    } catch {
        return new Response("Not found", { status: 404 });
    }
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
    const body = await Deno.readTextFile(path);
    return new Response(body, { headers: { "content-type": contentType } });
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
