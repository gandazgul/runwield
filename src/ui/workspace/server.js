/**
 * Programmatic Fresh Workspace server composition.
 */

import { dirname, fromFileUrl, join } from "@std/path";
import { App } from "fresh";
import { PLAN_UI_TOKEN_HEADER, PLAN_UI_TOKEN_QUERY } from "../../constants.js";
import { AppWrapper } from "./components/AppWrapper.jsx";
import { WorkspaceLayout } from "./components/Layout.jsx";
import { boardRoute } from "./routes/board.jsx";
import { detailRoute } from "./routes/detail.jsx";
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
const DESIGN_SYSTEM_DIR = join(WORKSPACE_DIR, "..", "design-system");
const STYLES_PATH = join(WORKSPACE_DIR, "static", "styles.css");
const TOKENS_CSS_PATH = join(DESIGN_SYSTEM_DIR, "tokens.css");
const COMPONENTS_CSS_PATH = join(DESIGN_SYSTEM_DIR, "components.css");
const WORKSPACE_CSS_PATH = join(WORKSPACE_DIR, "static", "workspace.css");
const LOGO_PATH = join(WORKSPACE_DIR, "..", "..", "..", "logo.svg");

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
    const app = new App();
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
    const app = new App();
    app.use(async (ctx) => {
        ctx.state.cwd = cwd;
        if (skipTokenCheck) return await ctx.next();
        if (isPublicWorkspaceAsset(ctx.url.pathname)) return await ctx.next();
        if (!hasWorkspaceToken(ctx.req, token)) {
            return new Response("Workspace token required.", { status: 401 });
        }
        return await ctx.next();
    });
    registerStaticRoutes(app);
    app.appWrapper(AppWrapper);
    app.layout("*", WorkspaceLayout);
    app.get("/", boardRoute("active"));
    app.get("/closed", boardRoute("closed"));
    app.get("/on-hold", boardRoute("onHold"));
    app.get("/plans/:planId", detailRoute);
    app.get("/api/workspace", workspaceApi);
    app.get("/api/plans", plansApi);
    app.get("/api/board", boardApi);
    app.get("/api/plans/:planId", planDetailApi);
    app.post("/api/plans/:planId/lifecycle-action", lifecycleActionApi);
    app.post("/api/plans/:planId/body", planBodyApi);
    app.notFound(() => new Response("Not found", { status: 404 }));
    return app;
}

/** @param {App<any>} app */
function registerStaticRoutes(app) {
    app.get("/styles.css", async () => {
        const css = await Deno.readTextFile(STYLES_PATH);
        return new Response(css, { headers: { "content-type": "text/css; charset=utf-8" } });
    });
    app.get("/tokens.css", async () => {
        const css = await Deno.readTextFile(TOKENS_CSS_PATH);
        return new Response(css, { headers: { "content-type": "text/css; charset=utf-8" } });
    });
    app.get("/components.css", async () => {
        const css = await Deno.readTextFile(COMPONENTS_CSS_PATH);
        return new Response(css, { headers: { "content-type": "text/css; charset=utf-8" } });
    });
    app.get("/workspace.css", async () => {
        const css = await Deno.readTextFile(WORKSPACE_CSS_PATH);
        return new Response(css, { headers: { "content-type": "text/css; charset=utf-8" } });
    });
    app.get("/theme.css", async () => {
        const css = await loadRunWieldThemeCss();
        return new Response(css, {
            headers: {
                "content-type": "text/css; charset=utf-8",
                "cache-control": "no-store",
            },
        });
    });
    app.get("/logo.svg", async () => {
        const logo = await Deno.readTextFile(LOGO_PATH);
        return new Response(logo, { headers: { "content-type": "image/svg+xml; charset=utf-8" } });
    });
}

/** @param {string} pathname */
function isPublicWorkspaceAsset(pathname) {
    return pathname === "/styles.css" ||
        pathname === "/tokens.css" ||
        pathname === "/components.css" ||
        pathname === "/workspace.css" ||
        pathname === "/theme.css" ||
        pathname === "/logo.svg";
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
