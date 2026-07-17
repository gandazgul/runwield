/**
 * Self-hosted remote Workspace Plan Server entry point.
 *
 * This process starts only remote Shared Space mode. It has no local checkout
 * Plan Board authority and stores remote Shared Space state in SQLite.
 */

import { dirname } from "@std/path";
import { startWorkspaceServer } from "./server.js";

export const DEFAULT_REMOTE_HOST = "0.0.0.0";
export const DEFAULT_REMOTE_PORT = 8080;
export const DEFAULT_REMOTE_DB_PATH = "/data/runwield-shared-spaces.sqlite";

/**
 * @typedef {Object} RemoteServerConfig
 * @property {string} host
 * @property {number} port
 * @property {string} dbPath
 */

/**
 * @param {string | undefined} value
 * @param {number} fallback
 * @returns {number}
 */
export function parsePort(value, fallback = DEFAULT_REMOTE_PORT) {
    if (value === undefined || value.trim() === "") return fallback;
    const port = Number(value);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new Error(`Remote Workspace port must be an integer from 1 to 65535; received ${value}.`);
    }
    return port;
}

/**
 * @param {Deno.Env} [env]
 * @returns {RemoteServerConfig}
 */
export function readRemoteServerConfig(env = Deno.env) {
    return {
        host: env.get("RUNWIELD_REMOTE_HOST") || env.get("HOST") || DEFAULT_REMOTE_HOST,
        port: parsePort(env.get("RUNWIELD_REMOTE_PORT") || env.get("PORT"), DEFAULT_REMOTE_PORT),
        dbPath: env.get("RUNWIELD_REMOTE_DB_PATH") || env.get("RUNWIELD_WORKSPACE_REMOTE_DB_PATH") ||
            DEFAULT_REMOTE_DB_PATH,
    };
}

/**
 * @param {AbortController} controller
 * @returns {() => void}
 */
function installShutdownHandlers(controller) {
    const handler = () => controller.abort();
    /** @type {Deno.Signal[]} */
    const signals = ["SIGINT", "SIGTERM"];
    for (const signal of signals) Deno.addSignalListener(signal, handler);
    return () => {
        for (const signal of signals) Deno.removeSignalListener(signal, handler);
    };
}

/**
 * @param {{ env?: Deno.Env, startWorkspaceServer?: typeof startWorkspaceServer, log?: (...args: unknown[]) => void }} [options]
 */
export async function main(options = {}) {
    const config = readRemoteServerConfig(options.env || Deno.env);
    const controller = new AbortController();
    const removeShutdownHandlers = installShutdownHandlers(controller);
    const start = options.startWorkspaceServer || startWorkspaceServer;
    const log = options.log || console.log;

    try {
        await Deno.mkdir(dirname(config.dbPath), { recursive: true });
        const server = await start({
            mode: "remote",
            host: config.host,
            port: config.port,
            dbPath: config.dbPath,
            signal: controller.signal,
        });
        const actualPort = server?.addr?.port || config.port;
        log(`[RunWield] Remote Workspace Plan Server listening on http://${config.host}:${actualPort}`);
        log(`[RunWield] SQLite database: ${config.dbPath}`);
        log(`[RunWield] Configure planServerUrl or pass --plan-server with the externally reachable Plan Server URL.`);
        if (server?.finished) await server.finished;
    } finally {
        removeShutdownHandlers();
    }
}

if (import.meta.main) await main();
