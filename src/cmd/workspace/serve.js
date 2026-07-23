/**
 * @module cmd/workspace/serve
 * Persistent owner Workspace launcher.
 */

import { parseArgs } from "@std/cli/parse-args";
import { CLI_BIN } from "../../constants.js";
import { getOwnerCoordinationDatabasePath, openOwnerCoordinationStore } from "../../shared/owner-coordination/index.js";
import { isLoopbackHost, openBrowser, parsePort } from "../plans/ui.js";

export const WORKSPACE_DEFAULT_HOST = "127.0.0.1";
export const WORKSPACE_DEFAULT_PORT = 8787;

/** @typedef {{ host: string, port: number, publicOrigin: string, trustTlsTerminator: boolean, noOpen: boolean, help: boolean }} WorkspaceServeOptions */

/** @param {string} value */
export function normalizePublicOrigin(value) {
    const url = new URL(value);
    if (url.pathname !== "/" || url.search || url.hash) {
        throw new Error("--public-origin must be an origin only, with no path, query, or fragment.");
    }
    return url.origin;
}

/** @param {string[]} argv */
export function parseWorkspaceServeArgs(argv) {
    const parsed = parseArgs(argv, {
        boolean: ["help", "no-open", "trust-tls-terminator"],
        string: ["bind", "host", "port", "public-origin"],
        alias: { h: "help" },
    });
    const explicitHost = parsed.bind || parsed.host;
    const host = String(explicitHost || WORKSPACE_DEFAULT_HOST);
    const port = parsed.port === undefined ? WORKSPACE_DEFAULT_PORT : parsePort(String(parsed.port));
    const trustTlsTerminator = Boolean(parsed["trust-tls-terminator"]);
    const defaultOrigin = `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}`;
    const publicOrigin = normalizePublicOrigin(String(parsed["public-origin"] || defaultOrigin));
    if (!isLoopbackHost(host)) {
        if (!trustTlsTerminator) {
            throw new Error(
                "Non-loopback owner Workspace bind requires --trust-tls-terminator and --public-origin https://...",
            );
        }
        if (!publicOrigin.startsWith("https://")) {
            throw new Error("Non-loopback owner Workspace public origin must use https://.");
        }
    }
    return {
        host,
        port,
        publicOrigin,
        trustTlsTerminator,
        noOpen: Boolean(parsed["no-open"]),
        help: Boolean(parsed.help),
    };
}

export function printWorkspaceServeHelp() {
    console.log(
        `Usage: ${CLI_BIN} workspace serve [--bind <host>|--host <host>] [--port <port>] [--public-origin <origin>] [--trust-tls-terminator] [--no-open]`,
    );
    console.log("Starts the persistent owner Workspace using the owner coordination database.");
    console.log("Defaults: --bind 127.0.0.1 --port 8787.");
}

/** @param {AbortController} controller */
function installShutdownHandlers(controller) {
    const handler = () => controller.abort();
    const signals = ["SIGINT", "SIGTERM"];
    for (const signal of signals) Deno.addSignalListener(/** @type {Deno.Signal} */ (signal), handler);
    return () => {
        for (const signal of signals) Deno.removeSignalListener(/** @type {Deno.Signal} */ (signal), handler);
    };
}

/**
 * @param {string[]} argv
 * @param {{ __testDeps?: any }} [options]
 */
export async function runWorkspaceServeCommand(argv, options = {}) {
    const deps = options.__testDeps || {};
    let parsed;
    try {
        parsed = (deps.parseWorkspaceServeArgs || parseWorkspaceServeArgs)(argv);
    } catch (error) {
        console.error(`[RunWield] ${error instanceof Error ? error.message : String(error)}`);
        console.error(`Run '${CLI_BIN} workspace serve --help' for usage.`);
        return;
    }
    if (parsed.help) return (deps.printWorkspaceServeHelp || printWorkspaceServeHelp)();

    const controller = new AbortController();
    const removeShutdownHandlers = deps.installShutdownHandlers
        ? deps.installShutdownHandlers(controller)
        : installShutdownHandlers(controller);
    const store = deps.store || openOwnerCoordinationStore({ dbPath: deps.dbPath });
    try {
        const startWorkspaceServer = deps.startWorkspaceServer ||
            (await import("../../ui/workspace/server.js")).startWorkspaceServer;
        const server = await startWorkspaceServer({
            mode: "owner",
            host: parsed.host,
            port: parsed.port,
            publicOrigin: parsed.publicOrigin,
            trustTlsTerminator: parsed.trustTlsTerminator,
            store,
            signal: controller.signal,
        });
        const url = parsed.publicOrigin;
        console.log(`[RunWield] Owner Workspace: ${url}`);
        console.log(`[RunWield] Owner database: ${store.path || getOwnerCoordinationDatabasePath()}`);
        if (!parsed.noOpen) await (deps.openBrowser || openBrowser)(url);
        if (server?.finished) await server.finished;
    } finally {
        removeShutdownHandlers?.();
        if (!deps.store) store.close?.();
    }
}
