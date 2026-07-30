/**
 * @module cmd/plans/ui
 * Secure local Workspace launcher for read-only Plan UI.
 */

import {
    getCwd,
    PLAN_UI_COMMAND_LABEL,
    PLAN_UI_DEFAULT_HOST,
    PLAN_UI_DEFAULT_PORT,
    PLAN_UI_TOKEN_QUERY,
} from "../../constants.js";

/** @typedef {{ host: string, port: number, noOpen: boolean, help: boolean, explicitBind: boolean }} PlansUiOptions */

/**
 * @param {string} value
 * @returns {boolean}
 */
export function isLoopbackHost(value) {
    const host = String(value || "").trim().toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

/**
 * @param {string | number} value
 * @returns {number}
 */
export function parsePort(value) {
    const port = Number(value);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error(`Invalid --port value "${value}". Expected an integer from 0 to 65535.`);
    }
    return port;
}

/**
 * @param {string[]} argv
 * @returns {PlansUiOptions}
 */
export function parsePlansUiArgs(argv) {
    /** @type {PlansUiOptions} */
    const options = {
        host: PLAN_UI_DEFAULT_HOST,
        port: PLAN_UI_DEFAULT_PORT,
        noOpen: false,
        help: false,
        explicitBind: false,
    };
    /** @type {string | undefined} */
    let bindValue;
    /** @type {string | undefined} */
    let hostValue;

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === "--help" || arg === "-h") {
            options.help = true;
            continue;
        }
        if (arg === "--no-open") {
            options.noOpen = true;
            continue;
        }
        if (arg === "--bind" || arg === "--host") {
            const value = argv[i + 1];
            if (!value || value.startsWith("--")) throw new Error(`${arg} requires a host value.`);
            if (arg === "--bind") bindValue = value;
            else hostValue = value;
            i += 1;
            continue;
        }
        if (arg.startsWith("--bind=")) {
            bindValue = arg.slice("--bind=".length);
            continue;
        }
        if (arg.startsWith("--host=")) {
            hostValue = arg.slice("--host=".length);
            continue;
        }
        if (arg === "--port") {
            const value = argv[i + 1];
            if (!value || value.startsWith("--")) throw new Error("--port requires a numeric value.");
            options.port = parsePort(value);
            i += 1;
            continue;
        }
        if (arg.startsWith("--port=")) {
            options.port = parsePort(arg.slice("--port=".length));
            continue;
        }
        throw new Error(`Unknown ${PLAN_UI_COMMAND_LABEL} option: ${arg}`);
    }

    if (bindValue && hostValue && bindValue !== hostValue) {
        throw new Error(`Conflicting --bind and --host values: "${bindValue}" and "${hostValue}".`);
    }

    const explicitHost = bindValue || hostValue;
    if (explicitHost) {
        options.host = explicitHost;
        options.explicitBind = true;
    }
    if (!options.explicitBind && !isLoopbackHost(options.host)) {
        throw new Error("Non-loopback bind requires an explicit --bind or --host value.");
    }
    return options;
}

/**
 * @returns {string}
 */
export function generateWorkspaceToken() {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * @param {{ host: string, port: number, token: string, path?: string }} options
 * @returns {string}
 */
export function buildPlansUiUrl({ host, port, token, path = "/" }) {
    const urlHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
    const bracketedHost = urlHost.includes(":") && !urlHost.startsWith("[") ? `[${urlHost}]` : urlHost;
    const url = new URL(`http://${bracketedHost}:${port}${path}`);
    url.searchParams.set(PLAN_UI_TOKEN_QUERY, token);
    return url.href;
}

/**
 * @param {string} url
 * @param {{ command?: typeof Deno.Command }} [deps]
 */
export async function openBrowser(url, deps = {}) {
    const Command = deps.command || Deno.Command;
    const os = Deno.build.os;
    const command = os === "darwin" ? "open" : os === "windows" ? "cmd" : "xdg-open";
    const args = os === "windows" ? ["/c", "start", "", url] : [url];
    try {
        const child = new Command(command, { args, stdout: "null", stderr: "null" }).spawn();
        await child.status;
    } catch {
        // Best effort only.
    }
}

export function printPlansUiHelp() {
    console.log(`Usage: wld plans ui [--bind <host>|--host <host>] [--port <port>] [--no-open] [--help]`);
    console.log("Starts the local read-only Workspace board for Plans in the current checkout.");
    console.log("Defaults: --bind 127.0.0.1 --port 0 (random available port).");
}

/**
 * @param {AbortController} controller
 * @returns {() => void}
 */
function installShutdownHandler(controller) {
    const handler = () => controller.abort();
    Deno.addSignalListener("SIGINT", handler);
    return () => Deno.removeSignalListener("SIGINT", handler);
}

/**
 * @param {string[]} argv
 * @param {{ __testDeps?: any }} [options]
 */
export async function runPlansUiCommand(argv, options = {}) {
    const deps = options.__testDeps || {};
    let parsed;
    try {
        parsed = (deps.parsePlansUiArgs || parsePlansUiArgs)(argv);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[RunWield] ${message}`);
        console.error(`Run 'wld plans ui --help' for usage.`);
        return;
    }

    if (parsed.help) {
        (deps.printPlansUiHelp || printPlansUiHelp)();
        return;
    }

    if (!isLoopbackHost(parsed.host)) {
        console.warn(
            `[RunWield] Warning: binding Workspace to ${parsed.host}. Plan markdown may contain sensitive local plaintext; only expose this server on trusted networks.`,
        );
    }

    const token = (deps.generateWorkspaceToken || generateWorkspaceToken)();
    const controller = new AbortController();
    const removeShutdownHandler = deps.installShutdownHandler
        ? deps.installShutdownHandler(controller)
        : installShutdownHandler(controller);

    try {
        const startWorkspaceServer = deps.startWorkspaceServer ||
            (await import("../../ui/workspace/server.js")).startWorkspaceServer;
        const server = await startWorkspaceServer({
            cwd: deps.cwd || getCwd(),
            host: parsed.host,
            port: parsed.port,
            token,
            signal: controller.signal,
        });
        const actualPort = server?.addr?.port || parsed.port;
        const url = buildPlansUiUrl({ host: parsed.host, port: actualPort, token });
        console.log(`[RunWield] Workspace: ${url}`);
        if (!parsed.noOpen) await (deps.openBrowser || openBrowser)(url);
        if (server?.finished) await server.finished;
    } finally {
        removeShutdownHandler?.();
    }
}
