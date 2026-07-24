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
import { openOwnerCoordinationStore } from "../../shared/owner-coordination/index.js";
import { loadBoard, loadWorkspaceDetail } from "./server/plan-adapter.js";
import { PlanBoard } from "./components/Board.jsx";
import { PlanBoardToolbar } from "./components/PlanBoardToolbar.jsx";
import { PlanDetail } from "./components/PlanDetail.jsx";
import { loadRunWieldThemeCss } from "../design-system/theme-bridge.js";
import { reviewImageApi, reviewImageUploadApi } from "./routes/api/review-image-handlers.js";
import { cleanupReviewAgentState, createReviewAgentState, reviewAgentApi } from "./routes/api/review-agent-handlers.js";
import { reviewFileContentApi, reviewLocalConfigApi, reviewOpenInAppsApi } from "./routes/api/review-file-handlers.js";
import { reviewWidgetApi } from "./routes/api/review-widget-handlers.js";
import {
    devicesApi,
    ownerErrorJson,
    ownerProjectBoardApi,
    ownerProjectPlanDetailApi,
    pairingClaimApi,
    pairingRequestApi,
    pairingStatusApi,
    projectActionApi,
    projectsApi,
    registerProjectApi,
    revokeDeviceApi,
} from "./routes/owner-api.js";
import { authenticateOwnerRequest, authorizeOwnerUpgradeRequest, isOwnerUpgradeRequest } from "./server/owner-auth.js";
import {
    assertOwnerHost,
    assertOwnerOrigin,
    isStateChangingRequest,
    withOwnerSecurityHeaders,
} from "./server/owner-origin.js";
import { listOwnerProjects, requireOwnerProjectRoot } from "./server/owner-projects.js";
import { createOwnerConnectionRegistry } from "./server/owner-connections.js";
import { setAstroOwnerWorkspaceStore } from "./server/astro-owner-data.js";

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
 * @typedef {Object} OwnerWorkspaceAppOptions
 * @property {"owner"} mode
 * @property {string} publicOrigin
 * @property {string} [dbPath]
 * @property {ReturnType<typeof openOwnerCoordinationStore>} [store]
 */

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
 * @property {import("./server/plan-adapter.js").WorkspaceLifecycleActionDeps["autoGenerateWorkRecordForCompletedPlan"]} [autoGenerateWorkRecordForCompletedPlan]
 */

/**
 * @typedef {Object} RemoteWorkspaceAppOptions
 * @property {"remote"} mode
 * @property {string} [dbPath]
 * @property {import("./server/remote-adapter.js").RemoteWorkspaceAdapter} [adapter]
 * @property {number} [maxRequestBytes]
 * @property {number} [retentionDays]
 */

/** @param {LocalWorkspaceAppOptions | RemoteWorkspaceAppOptions | OwnerWorkspaceAppOptions} options */
export function createWorkspaceApp(options) {
    if (options.mode === "remote") return createRemoteWorkspaceApp(options);
    if (options.mode === "owner") return createOwnerWorkspaceApp(options);
    return createLocalWorkspaceApp(options);
}

/** @param {RemoteWorkspaceAppOptions} options */
export function createRemoteWorkspaceApp(options = { mode: "remote" }) {
    const app = createWorkspaceRouter();
    const adapter = options.adapter ??
        createRemoteWorkspaceAdapter({ dbPath: options.dbPath, retention: { days: options.retentionDays } });
    registerStaticRoutes(app);
    app.use(async (ctx) => {
        ctx.state.collaboration = adapter;
        ctx.state.maxRequestBytes = options.maxRequestBytes;
        return await ctx.next();
    });
    registerRemoteApiRoutes(app);
    app.get("/healthz", () => remoteJson({ ok: true, mode: "remote" }));
    app.get("/readyz", () => {
        try {
            return remoteJson(adapter.ready());
        } catch {
            return remoteJson({ ok: false, mode: "remote" }, 503);
        }
    });
    app.get("/p/:spaceId", async (ctx) => {
        const astroResponse = await renderAstroPage(ctx.req, Deno.cwd());
        if (astroResponse) return astroResponse;
        return workspaceBuildUnavailable();
    });
    app.notFound(() => jsonNotFound());
    app.adapter = adapter;
    return app;
}

/** @param {OwnerWorkspaceAppOptions} options */
export function createOwnerWorkspaceApp(options) {
    const app = createWorkspaceRouter();
    const store = options.store || openOwnerCoordinationStore({ dbPath: options.dbPath });
    setAstroOwnerWorkspaceStore(store);
    const connections = createOwnerConnectionRegistry();
    const pairingRateLimit = createInProcessRateLimit({ limit: 4, windowMs: 60_000 });
    registerStaticRoutes(app);
    app.use(async (ctx) => {
        try {
            assertOwnerHost(ctx.req, { publicOrigin: options.publicOrigin });
            if (isStateChangingRequest(ctx.req)) assertOwnerOrigin(ctx.req, { publicOrigin: options.publicOrigin });
            ctx.state.store = store;
            ctx.state.publicOrigin = options.publicOrigin;
            ctx.state.ownerConnections = connections;
            ctx.state.pairingRateLimit = pairingRateLimit;
            ctx.state.bootstrapProofCookieHeader = (proof) =>
                `rw_pairing_proof=${encodeURIComponent(proof)}; Max-Age=300; Path=/; SameSite=Strict${
                    options.publicOrigin.startsWith("https:") ? "; Secure" : ""
                }; HttpOnly`;
            const path = ctx.url.pathname;
            if (isOwnerUpgradeRequest(ctx.req)) {
                ctx.state.ownerDevice = authorizeOwnerUpgradeRequest(ctx.req, ctx.state);
                return withOwnerSecurityHeaders(await ctx.next());
            }
            const pairingPath = path === "/pair" || path.startsWith("/api/owner/pairing");
            const publicAssetPath = isPublicWorkspaceAsset(path);
            if (!pairingPath && !publicAssetPath) {
                const ownerDevice = authenticateOwnerRequest(ctx.req, ctx.state);
                if (!ownerDevice) {
                    if (path.startsWith("/api/")) {
                        return ownerJsonResponse({ error: "Owner Workspace device pairing required." }, 401);
                    }
                    return redirectResponse("/pair");
                }
                ctx.state.ownerDevice = ownerDevice;
            }
            return withOwnerSecurityHeaders(await ctx.next());
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (ctx.url.pathname.startsWith("/api/")) return ownerJsonResponse({ error: message }, 403);
            return ownerHtmlResponse(
                "RunWield Owner Workspace",
                `<section class=\"error-panel\"><h2>Workspace request blocked</h2><p>${
                    escapeHtml(message)
                }</p></section>`,
                403,
            );
        }
    });
    app.get("/", (ctx) => ownerHtmlResponse("RunWield Owner Workspace", renderOwnerHome(ctx)));
    app.get("/pair", (ctx) => ownerHtmlResponse("Pair RunWield Workspace", renderPairingPage(ctx)));
    app.get("/devices", (ctx) => ownerHtmlResponse("Paired devices", renderDevicesPage(ctx)));
    app.get(
        "/projects/:projectId/plans",
        async (ctx) => ownerHtmlResponse("Project Plans", await renderOwnerProjectBoard(ctx, "active")),
    );
    app.get(
        "/projects/:projectId/plans/closed",
        async (ctx) => ownerHtmlResponse("Closed Project Plans", await renderOwnerProjectBoard(ctx, "closed")),
    );
    app.get(
        "/projects/:projectId/plans/on-hold",
        async (ctx) => ownerHtmlResponse("On-hold Project Plans", await renderOwnerProjectBoard(ctx, "on-hold")),
    );
    app.get(
        "/projects/:projectId/plans/:planId",
        async (ctx) => ownerHtmlResponse("Project Plan", await renderOwnerPlanDetail(ctx)),
    );
    app.post("/api/owner/pairing/request", pairingRequestApi);
    app.get("/api/owner/pairing/status", pairingStatusApi);
    app.post("/api/owner/pairing/claim", pairingClaimApi);
    app.get("/api/owner/projects", projectsApi);
    app.post("/api/owner/projects", registerProjectApi);
    app.post("/api/owner/projects/:projectId/action", projectActionApi);
    app.get("/api/owner/projects/:projectId/plans", ownerProjectBoardApi);
    app.get("/api/owner/projects/:projectId/plans/view/:view", ownerProjectBoardApi);
    app.get("/api/owner/projects/:projectId/plans/:planId", ownerProjectPlanDetailApi);
    app.get("/api/owner/devices", devicesApi);
    app.post("/api/owner/devices/:deviceId/revoke", revokeDeviceApi);
    app.notFound((ctx) => {
        if (ctx.url.pathname.startsWith("/api/owner/")) {
            return ownerErrorJson(new Error("Owner API route not found."), 404);
        }
        return ownerHtmlResponse("Not found", `<section class=\"error-panel\"><h2>Not found</h2></section>`, 404);
    });
    app.store = store;
    app.ownerConnections = connections;
    return app;
}

/** @param {LocalWorkspaceAppOptions} options */
function createLocalWorkspaceApp({ cwd, token, skipTokenCheck = false, autoGenerateWorkRecordForCompletedPlan }) {
    return {
        handler() {
            /** @param {Request} request */
            return async (request) => {
                const url = new URL(request.url);
                if (isPublicWorkspaceAsset(url.pathname)) return await handleStaticRoute(url.pathname);
                if (!skipTokenCheck && !hasWorkspaceToken(request, token)) {
                    return new Response("Workspace token required.", { status: 401 });
                }
                return await handleLocalWorkspaceRequest(request, { cwd, autoGenerateWorkRecordForCompletedPlan });
            };
        },
    };
}

/**
 * @param {{ cwd: string, token: string, reviewPayload: Record<string, unknown>, reviewType: "plan" | "code" }} options
 */
export function createReviewWorkspaceApp({ cwd, token, reviewPayload, reviewType }) {
    const reviewAgentState = reviewType === "code" ? createReviewAgentState({ cwd, token, reviewPayload }) : null;
    return {
        cleanup: () => reviewAgentState ? cleanupReviewAgentState(reviewAgentState) : Promise.resolve(),
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
                if (
                    reviewType === "code" &&
                    (url.pathname.startsWith("/api/agents/") || url.pathname.startsWith("/api/guide/"))
                ) {
                    if (
                        !hasReviewAssetToken(request, token) && request.headers.get("x-runwield-review-token") !== token
                    ) {
                        return new Response("Review token required.", { status: 401 });
                    }
                    const response = await reviewAgentApi(request, url, reviewAgentState);
                    if (response) return response;
                }
                if (reviewType === "code" && url.pathname.startsWith("/api/review/widgets/")) {
                    if (
                        !hasReviewAssetToken(request, token) && request.headers.get("x-runwield-review-token") !== token
                    ) {
                        return new Response("Review token required.", { status: 401 });
                    }
                    const response = reviewWidgetApi(request, url, {
                        token,
                        reviewPayload,
                        widgets: reviewAgentState.widgets,
                    });
                    if (response) return response;
                }
                if (url.pathname.startsWith("/api/review/") || isLegacyReviewApiPath(url.pathname)) {
                    return await handleReviewApiRequest(
                        request,
                        { cwd, reviewToken: token, reviewPayload },
                        url.pathname,
                    );
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

/** @param {Request} request @param {{ cwd: string, autoGenerateWorkRecordForCompletedPlan?: import("./server/plan-adapter.js").WorkspaceLifecycleActionDeps["autoGenerateWorkRecordForCompletedPlan"] }} state */
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

/** @param {Request} request @param {{ cwd: string, autoGenerateWorkRecordForCompletedPlan?: import("./server/plan-adapter.js").WorkspaceLifecycleActionDeps["autoGenerateWorkRecordForCompletedPlan"] }} state @param {string} pathname */
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

/** @param {string} value */
function escapeHtml(value) {
    return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll(
        '"',
        "&quot;",
    );
}

/** @param {unknown} body @param {number} [status] */
function ownerJsonResponse(body, status = 200) {
    const response = new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json; charset=utf-8" },
    });
    return withOwnerSecurityHeaders(response);
}

/** @param {string} location */
function redirectResponse(location) {
    return withOwnerSecurityHeaders(new Response(null, { status: 302, headers: { location } }));
}

/** @param {string} title @param {string} body @param {number} [status] */
function ownerHtmlResponse(title, body, status = 200) {
    const html =
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${
            escapeHtml(title)
        }</title><link rel="icon" href="/logo.svg" type="image/svg+xml"><link rel="stylesheet" href="/tokens.css"><link rel="stylesheet" href="/components.css"><link rel="stylesheet" href="/workspace.css"><link rel="stylesheet" href="/theme.css"></head><body class="theme-runwield"><div class="workspace-shell owner-workspace-shell"><header class="topbar"><a class="brand" href="/" aria-label="RunWield Workspace home"><img class="brand-logo" src="/logo.svg" alt="" aria-hidden="true"><span>RunWield Workspace</span></a></header><nav class="tabs" aria-label="Workspace views"><a data-tab="projects" href="/" class="active">Projects</a><a data-tab="devices" href="/devices">Devices</a></nav><main>${body}</main></div></body></html>`;
    return withOwnerSecurityHeaders(
        new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8" } }),
    );
}

function createInProcessRateLimit({ limit, windowMs }) {
    const buckets = new Map();
    return {
        /** @param {Request} request */
        check(request) {
            const now = Date.now();
            const url = new URL(request.url);
            const key = `${url.protocol}//${url.host}:${request.headers.get("user-agent") || "unknown"}`;
            const bucket = buckets.get(key) || { count: 0, resetAt: now + windowMs };
            if (bucket.resetAt <= now) {
                bucket.count = 0;
                bucket.resetAt = now + windowMs;
            }
            bucket.count += 1;
            buckets.set(key, bucket);
            if (bucket.count > limit) throw new Error("Too many pairing requests. Wait briefly before retrying.");
        },
    };
}

function ownerMutationScript() {
    return `function ownerCookie(name){return document.cookie.split('; ').find(v=>v.startsWith(name+'='))?.split('=').slice(1).join('=')||'';} async function ownerFetch(url,options={}){options.headers=Object.assign({'content-type':'application/json','x-runwield-csrf':decodeURIComponent(ownerCookie('rw_owner_csrf'))},options.headers||{});return await fetch(url,options);}`;
}

function renderPairingPage() {
    return `<section class="owner-card pairing-card"><p class="kicker">Device pairing</p><h1>Pair this browser with owner Workspace</h1><p>Private networking is not authorization. A short-lived code appears below; approve it locally with&nbsp;<code>wld workspace pair &lt;code&gt;</code>.</p><form id="pairing-form" class="owner-form"><label>Device label <input id="device-label" name="deviceLabel" value="Browser device" maxlength="80"></label></form><div id="pairing-result" class="owner-pairing-result" aria-live="polite"></div></section><script>function escapeHtml(value){return String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');}function defaultDeviceLabel(){const ua=navigator.userAgent;const browser=ua.includes('Edg/')?'Edge':(ua.includes('CriOS')||ua.includes('Chrome/'))?'Chrome':(ua.includes('Firefox/')||ua.includes('FxiOS'))?'Firefox':ua.includes('Safari/')?'Safari':'Browser';const os=/iPhone|iPad|iPod/.test(ua)?'iPhone':ua.includes('Android')?'Android':ua.includes('Mac OS X')?'macOS':ua.includes('Windows')?'Windows':ua.includes('Linux')?'Linux':'this device';return browser+' on '+os;}const form=document.getElementById('pairing-form');const label=document.getElementById('device-label');if(label instanceof HTMLInputElement)label.value=defaultDeviceLabel();const out=document.getElementById('pairing-result');let timer=null;let pollTimer=null;let pollDelay=1000;async function requestCode(){clearTimeout(pollTimer);const body={deviceLabel:new FormData(form).get('deviceLabel')};const res=await fetch('/api/owner/pairing/request',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const data=await res.json();if(!res.ok){out.innerHTML='<p class="notice danger">'+escapeHtml(data.error)+'</p>';return;}pollDelay=1000;renderCode(data);pollStatus();}async function claimApproved(){const claim=await fetch('/api/owner/pairing/claim',{method:'POST'});const claimData=await claim.json();if(claim.ok){location.href='/';return true;}if(claimData.error)out.insertAdjacentHTML('beforeend','<p class="notice danger">'+escapeHtml(claimData.error)+'</p>');return false;}async function pollStatus(){const status=await fetch('/api/owner/pairing/status');const data=await status.json().catch(()=>({state:'missing'}));if(data.state==='approved'){if(await claimApproved())return;}if(data.state==='expired'||data.state==='missing'){requestCode();return;}pollDelay=Math.min(Math.round(pollDelay*1.5),8000);pollTimer=setTimeout(pollStatus,pollDelay);}function renderCode(data){clearInterval(timer);out.innerHTML='<div class="pairing-actions-row"><div class="pairing-code" aria-label="Pairing code">'+escapeHtml(data.code)+'</div><div class="pairing-command-box"><p>Run <code id="pairing-command">wld workspace pair '+escapeHtml(data.code)+'</code>.</p><button class="copy-command-button" id="copy-pairing-command" type="button">Copy command</button><p class="pairing-poll-note">Waiting for local approval. This browser will pair automatically.</p></div></div><p class="pairing-timer" id="pairing-timer"></p>';const timerEl=document.getElementById('pairing-timer');const expiresAt=new Date(data.expiresAt).getTime();function tick(){const remaining=Math.max(0,expiresAt-Date.now());const seconds=Math.ceil(remaining/1000);const minutes=Math.floor(seconds/60);const rest=String(seconds%60).padStart(2,'0');timerEl.textContent=remaining>0?'This code expires in '+minutes+':'+rest+'. A new code appears automatically when it expires.':'Code expired. Generating a new code...';if(remaining<=0){clearInterval(timer);requestCode();}}tick();timer=setInterval(tick,1000);document.getElementById('copy-pairing-command').addEventListener('click',async(event)=>{await navigator.clipboard.writeText(document.getElementById('pairing-command').textContent||'');event.currentTarget.textContent='Copied';setTimeout(()=>event.currentTarget.textContent='Copy command',1600);});}label?.addEventListener('change',()=>requestCode());requestCode();</script>`;
}

/** @param {any} ctx */
function renderOwnerHome(ctx) {
    const projects = listOwnerProjects(ctx.state.store);
    const cards = projects.length
        ? projects.map((project) =>
            `<article class="owner-card project-card"><div class="card-header"><div><p class="kicker">${
                escapeHtml(project.lifecycle)
            } Project</p><h2>${escapeHtml(project.displayName)}</h2><p>${escapeHtml(project.rootLabel)} · ${
                escapeHtml(project.healthStatus)
            }</p></div><span class="status-badge">${
                escapeHtml(project.enabled ? "Available" : "Needs repair")
            }</span></div>${
                project.healthEvidence?.length
                    ? `<ul>${project.healthEvidence.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
                    : ""
            }<div class="card-actions">${
                project.enabled
                    ? `<a class="action-primary" href="/projects/${
                        encodeURIComponent(project.projectId)
                    }/plans">Open Plan Board</a>`
                    : ""
            }<button class="action-secondary" data-project-action="${escapeHtml(project.projectId)}" data-action="${
                project.lifecycle === "disabled" ? "enable" : "disable"
            }">${
                project.lifecycle === "disabled" ? "Enable" : "Disable"
            }</button><button class="action-secondary" data-project-action="${
                escapeHtml(project.projectId)
            }" data-action="rescan">Full Session rescan</button><button class="action-danger" data-project-action="${
                escapeHtml(project.projectId)
            }" data-action="${project.lifecycle === "removed" ? "restore" : "remove"}">${
                project.lifecycle === "removed" ? "Restore" : "Remove"
            }</button></div><form class="owner-form project-relink-form" data-project-relink="${
                escapeHtml(project.projectId)
            }"><label>Relink Project root <input name="newRoot" placeholder="New absolute path"></label><button class="action-secondary" type="submit">Relink</button></form><pre class="project-diagnostics" data-project-diagnostics="${
                escapeHtml(project.projectId)
            }" hidden></pre></article>`
        ).join("")
        : `<section class="owner-card empty-state"><h2>No registered Projects yet</h2><p>Register trusted local Projects before Workspace can browse Plans or later continue Sessions.</p></section>`;
    return `<section class="page-header"><h1>Projects</h1><p>Register and repair trusted Project roots. The later Attention Dashboard will become the default home; for now, Project setup is the bootstrap surface.</p></section><section class="owner-card"><form id="project-register" class="owner-form"><label>Project root <input name="root" placeholder="/absolute/path/to/project" required></label><label>Display name <input name="displayName" placeholder="Optional"></label><button class="action-primary" type="submit">Register Project</button></form><p id="project-message" aria-live="polite"></p></section><section class="project-grid">${cards}</section><script>${ownerMutationScript()}document.getElementById('project-register').addEventListener('submit',async(event)=>{event.preventDefault();const form=new FormData(event.currentTarget);const response=await ownerFetch('/api/owner/projects',{method:'POST',body:JSON.stringify({root:form.get('root'),displayName:form.get('displayName')})});if(response.ok) location.reload(); else document.getElementById('project-message').textContent=(await response.json()).error;});document.querySelectorAll('[data-project-action]').forEach((button)=>button.addEventListener('click',async()=>{if(button.dataset.action==='remove'&&!confirm('Remove this Project from Workspace? Repository files are not deleted.'))return;const response=await ownerFetch('/api/owner/projects/'+encodeURIComponent(button.dataset.projectAction)+'/action',{method:'POST',body:JSON.stringify({action:button.dataset.action})});const data=await response.json().catch(()=>({}));if(response.ok){if(button.dataset.action==='rescan'){const diagnostics=document.querySelector('[data-project-diagnostics="'+CSS.escape(button.dataset.projectAction)+'"]');if(diagnostics){diagnostics.hidden=false;diagnostics.textContent=(data.diagnostics||[]).length?JSON.stringify(data.diagnostics,null,2):'Full Session catalog rescan completed with no diagnostics.';}return;}location.reload();} else alert(data.error); }));document.querySelectorAll('[data-project-relink]').forEach((relinkForm)=>relinkForm.addEventListener('submit',async(event)=>{event.preventDefault();const formData=new FormData(relinkForm);const response=await ownerFetch('/api/owner/projects/'+encodeURIComponent(relinkForm.dataset.projectRelink)+'/action',{method:'POST',body:JSON.stringify({action:'relink',newRoot:formData.get('newRoot')})});if(response.ok) location.reload(); else alert((await response.json()).error);}));</script>`;
}

/** @param {any} ctx */
function renderDevicesPage(ctx) {
    const devices = ctx.state.store.listDevices();
    const currentDeviceId = ctx.state.ownerDevice?.deviceId || "";
    const items = devices.map((device) =>
        `<article class="owner-card"><div class="card-header"><div><p class="kicker">Paired device</p><h2>${
            escapeHtml(device.label)
        }</h2><p>Paired ${escapeHtml(device.createdAt)}${
            device.lastSeenAt ? ` · Last seen ${escapeHtml(device.lastSeenAt)}` : ""
        }</p></div><span class="status-badge">${
            device.revokedAt ? "Revoked" : device.deviceId === currentDeviceId ? "Current" : "Active"
        }</span></div>${
            device.revokedAt
                ? `<p>Revoked ${escapeHtml(device.revokedAt)}</p>`
                : `<button class="action-danger" data-revoke-device="${escapeHtml(device.deviceId)}">Revoke</button>`
        }</article>`
    ).join("");
    return `<section class="page-header"><h1>Paired devices</h1><p>Revocation denies the device's next owner request and closes registered live connections without canceling unrelated workflows.</p></section><section class="project-grid">${
        items || `<article class="owner-card"><h2>No devices</h2></article>`
    }</section><script>${ownerMutationScript()}const currentDeviceId=${
        JSON.stringify(currentDeviceId)
    };document.querySelectorAll('[data-revoke-device]').forEach((button)=>button.addEventListener('click',async()=>{if(!confirm('Revoke this device?'))return;const response=await ownerFetch('/api/owner/devices/'+encodeURIComponent(button.dataset.revokeDevice)+'/revoke',{method:'POST',body:'{}'});if(response.ok){ if(button.dataset.revokeDevice===currentDeviceId) location.href='/pair'; else location.reload(); } else alert((await response.json()).error);}));</script>`;
}

/** @param {"active" | "closed" | "on-hold"} view */
function ownerBoardScreenKey(view) {
    return view === "on-hold" ? "onHold" : view;
}

/** @param {any} component @param {Record<string, unknown>} props */
async function renderOwnerReactComponent(component, props) {
    const [{ default: React }, { renderToStaticMarkup }] = await Promise.all([
        import("react"),
        import("react-dom/server"),
    ]);
    return renderToStaticMarkup(React.createElement(component, props));
}

/** @param {URL} currentUrl @param {string} pathname */
function ownerPresentationUrl(currentUrl, pathname) {
    const url = new URL(pathname, currentUrl.origin);
    const query = currentUrl.searchParams.get("q");
    if (query) url.searchParams.set("q", query);
    return String(url);
}

/** @param {any} ctx @param {"active" | "closed" | "on-hold"} view */
async function renderOwnerProjectBoard(ctx, view) {
    const root = requireOwnerProjectRoot(ctx.state.store, ctx.params.projectId);
    const board = await loadBoard(root);
    const componentView = ownerBoardScreenKey(view);
    const projectId = encodeURIComponent(ctx.params.projectId);
    const url = ownerPresentationUrl(ctx.url, `/projects/${projectId}/plans${view === "active" ? "" : `/${view}`}`);
    const tabs =
        `<nav class="tabs owner-project-tabs" aria-label="Project Plan views"><a href="/projects/${projectId}/plans" class="${
            view === "active" ? "active" : ""
        }">Plan Board</a><a href="/projects/${projectId}/plans/closed" class="${
            view === "closed" ? "active" : ""
        }">Closed</a><a href="/projects/${projectId}/plans/on-hold" class="${
            view === "on-hold" ? "active" : ""
        }">On Hold</a></nav>`;
    const toolbar = await renderOwnerReactComponent(PlanBoardToolbar, { board, view: componentView, url });
    const boardHtml = await renderOwnerReactComponent(PlanBoard, {
        board,
        view: componentView,
        url,
        staticRender: true,
        staticRenderNotice:
            "Owner Workspace Plan Boards are read-only in this slice; lifecycle moves and edits are disabled until Plan Workflow Lease enforcement can authorize them safely.",
        draggableCards: false,
    });
    return `<section class="page-header"><a class="detail-back-link" href="/">← Projects</a><h1>Project Plan Board</h1><p>Owner Workspace shows registered Project Plans read-only until Plan Workflow Lease enforcement enables remote mutations safely.</p></section>${tabs}<div class="toolbar">${toolbar}</div>${boardHtml}`;
}

/** @param {any} plan */
function ownerReadOnlyPlanDetail(plan) {
    return {
        ...plan,
        capabilities: { ...(plan.capabilities || {}), bodyEditing: false },
        actions: {},
        childrenByStatus: plan.childrenByStatus
            ? Object.fromEntries(
                Object.entries(plan.childrenByStatus).map(([status, children]) => [
                    status,
                    Array.isArray(children) ? children.map(ownerReadOnlyPlanDetail) : children,
                ]),
            )
            : plan.childrenByStatus,
    };
}

/** @param {any} ctx */
async function renderOwnerPlanDetail(ctx) {
    const root = requireOwnerProjectRoot(ctx.state.store, ctx.params.projectId);
    const plan = ownerReadOnlyPlanDetail(await loadWorkspaceDetail(root, ctx.params.planId));
    const url = ownerPresentationUrl(
        ctx.url,
        `/projects/${encodeURIComponent(ctx.params.projectId)}/plans/${encodeURIComponent(ctx.params.planId)}`,
    );
    const detailHtml = await renderOwnerReactComponent(PlanDetail, {
        plan,
        url,
        editIntent: false,
        staticRender: true,
    });
    return `${detailHtml}<aside class="owner-card owner-read-only-note"><h2>Owner safety</h2><p>Lifecycle and body editing are intentionally disabled in this slice so later Plan Workflow Lease enforcement can cover consequential actions.</p></aside>`;
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
    app.get("/_astro/:asset", async (ctx) => await handleStaticRoute(ctx.url.pathname));
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

/** @param {unknown} data @param {number} [status] */
function remoteJson(data, status = 200) {
    return Response.json(data, {
        status,
        headers: { "cache-control": "no-store" },
    });
}

/**
 * @param {{ mode?: "local" | "remote" | "owner", cwd?: string, host: string, port: number, token?: string, dbPath?: string, signal?: AbortSignal, adapter?: import("./server/remote-adapter.js").RemoteWorkspaceAdapter, maxRequestBytes?: number, retentionDays?: number, publicOrigin?: string, trustTlsTerminator?: boolean, store?: ReturnType<typeof openOwnerCoordinationStore> }} options
 */
export function startWorkspaceServer(options) {
    const app = options.mode === "remote"
        ? createWorkspaceApp({
            mode: "remote",
            dbPath: options.dbPath,
            adapter: options.adapter,
            maxRequestBytes: options.maxRequestBytes,
            retentionDays: options.retentionDays,
        })
        : options.mode === "owner"
        ? createWorkspaceApp({
            mode: "owner",
            dbPath: options.dbPath,
            store: options.store,
            publicOrigin: options.publicOrigin || `http://${options.host}:${options.port}`,
        })
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
        stopPromise ??= Promise.resolve(app.cleanup()).then(() => server.shutdown()).catch((error) => {
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
