// @ts-nocheck: tiny Astro-dev-only router mirrors the server wrapper route shape.
import { registerRemoteApiRoutes } from "../routes/remote-api.js";
import { createRemoteWorkspaceAdapter } from "./remote-adapter.js";

const REMOTE_DEV_APP_KEY = Symbol.for("runwield.workspace.remote-dev-app");
const REMOTE_DEV_DB_PATH_KEY = Symbol.for("runwield.workspace.remote-dev-db-path");

/** @type {import("astro").APIRoute} */
export async function handleRemoteSpaceApi(context) {
    if (!import.meta.env.DEV || Deno.env.get("RUNWIELD_WORKSPACE_MODE") !== "remote") {
        return Response.json({ error: "Not found" }, { status: 404 });
    }
    const app = getRemoteDevApp();
    return await app(context.request);
}

function getRemoteDevApp() {
    const runtime = /** @type {any} */ (globalThis);
    const dbPath = Deno.env.get("RUNWIELD_REMOTE_DB_PATH") || Deno.env.get("RUNWIELD_WORKSPACE_REMOTE_DB_PATH") ||
        undefined;
    if (!runtime[REMOTE_DEV_APP_KEY] || runtime[REMOTE_DEV_DB_PATH_KEY] !== dbPath) {
        runtime[REMOTE_DEV_APP_KEY]?.adapter?.close?.();
        const adapter = createRemoteWorkspaceAdapter({ dbPath });
        const router = createRemoteDevRouter(adapter);
        runtime[REMOTE_DEV_APP_KEY] = { handler: router.handler(), adapter };
        runtime[REMOTE_DEV_DB_PATH_KEY] = dbPath;
    }
    return runtime[REMOTE_DEV_APP_KEY].handler;
}

/** @param {import("./remote-adapter.js").RemoteWorkspaceAdapter} adapter */
function createRemoteDevRouter(adapter) {
    const routes = [];
    const add = (method, pattern, handler) => routes.push({ method, pattern, handler });
    const app = {
        get: (pattern, handler) => add("GET", pattern, handler),
        post: (pattern, handler) => add("POST", pattern, handler),
        handler: () => async (request) => {
            const url = new URL(request.url);
            const route = routes.find((candidate) =>
                candidate.method === request.method && matchRoute(candidate.pattern, url.pathname)
            );
            if (!route) return Response.json({ error: "Not found" }, { status: 404 });
            return await route.handler({
                req: request,
                request,
                url,
                params: matchRoute(route.pattern, url.pathname),
                state: { collaboration: adapter },
            });
        },
    };
    registerRemoteApiRoutes(app);
    return app;
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
