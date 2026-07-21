/**
 * Self-hosted remote Workspace Plan Server entry point.
 *
 * This process starts only remote Shared Space mode. It has no local checkout
 * Plan Board authority and stores remote Shared Space state in SQLite.
 */

import { dirname } from "@std/path";
import { DEFAULT_REMOTE_MAX_REQUEST_BYTES } from "./routes/remote-api.js";
import { createRemoteWorkspaceAdapter } from "./server/remote-adapter.js";
import { startWorkspaceServer } from "./server.js";

export const DEFAULT_REMOTE_HOST = "0.0.0.0";
export const DEFAULT_REMOTE_PORT = 8080;
export const DEFAULT_REMOTE_DB_PATH = "/data/runwield-shared-spaces.sqlite";
export const REMOTE_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * @typedef {Object} RemoteServerConfig
 * @property {string} host
 * @property {number} port
 * @property {string} dbPath
 * @property {number} maxRequestBytes
 * @property {number | undefined} retentionDays
 */

/** @typedef {ReturnType<typeof setInterval>} RemoteCleanupTimer */

/**
 * @typedef {Object} RemoteServerMainOptions
 * @property {Deno.Env} [env]
 * @property {typeof startWorkspaceServer} [startWorkspaceServer]
 * @property {typeof createRemoteWorkspaceAdapter} [createRemoteWorkspaceAdapter]
 * @property {(...args: unknown[]) => void} [log]
 * @property {typeof setInterval} [setInterval]
 * @property {typeof clearInterval} [clearInterval]
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
 * @param {string | undefined} value
 * @param {number} [fallback]
 * @returns {number}
 */
export function parseMaxRequestBytes(value, fallback = DEFAULT_REMOTE_MAX_REQUEST_BYTES) {
    if (value === undefined || value.trim() === "") return fallback;
    const bytes = Number(value);
    if (!Number.isSafeInteger(bytes) || bytes < 1024 || bytes > 100 * 1024 * 1024) {
        throw new Error("RUNWIELD_REMOTE_MAX_REQUEST_BYTES must be an integer from 1024 to 104857600.");
    }
    return bytes;
}

/**
 * @param {string | undefined} value
 * @returns {number | undefined}
 */
export function parseRetentionDays(value) {
    if (value === undefined || value.trim() === "" || value.trim() === "0") return undefined;
    const days = Number(value);
    if (!Number.isSafeInteger(days) || days < 1 || days > 3650) {
        throw new Error("RUNWIELD_REMOTE_RETENTION_DAYS must be a positive integer number of days, or 0/unset.");
    }
    return days;
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
        maxRequestBytes: parseMaxRequestBytes(env.get("RUNWIELD_REMOTE_MAX_REQUEST_BYTES")),
        retentionDays: parseRetentionDays(env.get("RUNWIELD_REMOTE_RETENTION_DAYS")),
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

/** @param {RemoteServerMainOptions} [options] */
export async function main(options = {}) {
    const config = readRemoteServerConfig(options.env || Deno.env);
    const controller = new AbortController();
    const removeShutdownHandlers = installShutdownHandlers(controller);
    const start = options.startWorkspaceServer || startWorkspaceServer;
    const createAdapter = options.createRemoteWorkspaceAdapter || createRemoteWorkspaceAdapter;
    const log = options.log || console.log;
    const setCleanupInterval = options.setInterval || setInterval;
    const clearCleanupInterval = options.clearInterval || clearInterval;
    /** @type {RemoteCleanupTimer | undefined} */
    let cleanupTimer;
    /** @type {import("./server/remote-adapter.js").RemoteWorkspaceAdapter | undefined} */
    let adapter;

    try {
        await Deno.mkdir(dirname(config.dbPath), { recursive: true });
        adapter = createAdapter({ dbPath: config.dbPath, retention: { days: config.retentionDays } });
        adapter.reconcileRetentionPolicy();
        const deleted = adapter.cleanupExpiredSharedSpaces();
        if (deleted > 0) log(`[RunWield] Removed ${deleted} expired Shared Space(s) at startup.`);
        if (config.retentionDays) {
            cleanupTimer = setCleanupInterval(() => {
                try {
                    const count = adapter?.cleanupExpiredSharedSpaces?.() ?? 0;
                    if (count > 0) log(`[RunWield] Removed ${count} expired Shared Space(s).`);
                } catch (error) {
                    console.error(
                        `[RunWield] Expired Shared Space cleanup failed: ${
                            error instanceof Error ? error.message : error
                        }`,
                    );
                }
            }, REMOTE_CLEANUP_INTERVAL_MS);
        }
        const server = await start({
            mode: "remote",
            host: config.host,
            port: config.port,
            dbPath: config.dbPath,
            signal: controller.signal,
            adapter,
            maxRequestBytes: config.maxRequestBytes,
        });
        const actualPort = server?.addr?.port || config.port;
        log(`[RunWield] Remote Workspace Plan Server listening on http://${config.host}:${actualPort}`);
        log(`[RunWield] SQLite database: ${config.dbPath}`);
        log(`[RunWield] Request body limit: ${config.maxRequestBytes} bytes`);
        log(`[RunWield] Inactivity retention: ${config.retentionDays ? `${config.retentionDays} day(s)` : "disabled"}`);
        log(`[RunWield] Configure planServerUrl or pass --plan-server with the externally reachable Plan Server URL.`);
        if (server?.finished) await server.finished;
    } finally {
        if (cleanupTimer) clearCleanupInterval(cleanupTimer);
        adapter?.close?.();
        removeShutdownHandlers();
    }
}

if (import.meta.main) await main();
