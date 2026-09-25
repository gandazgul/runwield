/* Connection-scoped local control and authenticated laptop model bridge. */

import { createRunWieldModelRuntime } from "../models/model-registry.ts";
import { handleModelRequest, LocalModelBridge } from "./model-bridge.ts";

export interface RemoteControlStatus {
    connected: boolean;
    ready: boolean;
    shutdown: boolean;
    closed: boolean;
}

export interface RemoteControlService {
    readonly port: number;
    /** Send only in the first private SSH tty input line, after echo is disabled. */
    readonly credential: string;
    status(): RemoteControlStatus;
    requestShutdown(): void;
    close(): Promise<void>;
}

export interface RemoteControlIdentity {
    buildId: string;
    protocol: number;
}

const PERIOD_MS = 5_000;
const encoder = new TextEncoder();

function validIdentity(identity: RemoteControlIdentity): boolean {
    return /^[a-f0-9]{64}$/.test(identity.buildId) && Number.isInteger(identity.protocol) && identity.protocol >= 0;
}

function equalSecret(left: string, right: string): boolean {
    const a = encoder.encode(left);
    const b = encoder.encode(right);
    let difference = a.length ^ b.length;
    for (let index = 0; index < Math.max(a.length, b.length); index++) {
        difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
    }
    return difference === 0;
}

/** Start a fresh, loopback-only listener. The launcher must close it in its finally block. */
export function startRemoteControlService(identity: RemoteControlIdentity): RemoteControlService {
    if (!validIdentity(identity)) throw new Error("Invalid remote control identity");
    const credential = Array.from(
        crypto.getRandomValues(new Uint8Array(32)),
        (byte) => byte.toString(16).padStart(2, "0"),
    )
        .join("");
    let connected = false;
    let ready = false;
    let shutdown = false;
    let closed = false;
    let seenSinceCheck = false;
    let misses = 0;
    let timer: ReturnType<typeof setInterval> | undefined;
    let settingsHandler: Promise<(request: Request, path: string) => Promise<Response>> | undefined;
    let modelBridge: Promise<LocalModelBridge> | undefined;
    const getModelBridge = () => {
        if (!modelBridge) {
            const loading = createRunWieldModelRuntime().then((runtime) => new LocalModelBridge(runtime)).catch(
                (error) => {
                    if (modelBridge === loading) modelBridge = undefined;
                    throw error;
                },
            );
            modelBridge = loading;
        }
        return modelBridge;
    };
    const stopModels = () => {
        void modelBridge?.then((bridge) => bridge.close()).catch(() => {});
    };
    const checkHealth = () => {
        if (shutdown) return;
        misses = seenSinceCheck ? 0 : misses + 1;
        seenSinceCheck = false;
        if (misses >= 3) {
            shutdown = true;
            ready = false;
            stopModels();
        }
    };
    const abort = new AbortController();
    const server = Deno.serve(
        { hostname: "127.0.0.1", port: 0, signal: abort.signal, onListen() {} },
        async (request) => {
            if (closed || !equalSecret(request.headers.get("Authorization") ?? "", `Bearer ${credential}`)) {
                return new Response(null, { status: 401 });
            }
            const path = new URL(request.url).pathname;
            if (request.method === "POST" && path === "/handshake") {
                let received: RemoteControlIdentity;
                try {
                    const reader = request.body?.getReader();
                    if (!reader) throw new Error("Missing identity");
                    const parts: Uint8Array[] = [];
                    let size = 0;
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        size += value.length;
                        if (size > 4096) {
                            await reader.cancel();
                            throw new Error("Large identity");
                        }
                        parts.push(value);
                    }
                    const bytes = new Uint8Array(size);
                    let offset = 0;
                    for (const part of parts) {
                        bytes.set(part, offset);
                        offset += part.length;
                    }
                    received = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
                } catch {
                    return new Response(null, { status: 400 });
                }
                if (!received || received.buildId !== identity.buildId || received.protocol !== identity.protocol) {
                    return new Response(null, { status: 409 });
                }
                if (shutdown) return Response.json({ shutdown: true });
                connected = true;
                seenSinceCheck = false;
                misses = 0;
                if (timer !== undefined) clearInterval(timer);
                timer = setInterval(checkHealth, PERIOD_MS);
                return Response.json({ shutdown: false });
            }
            if (!connected) return new Response(null, { status: 403 });
            if (request.method === "POST" && path === "/readiness") {
                if (!shutdown) ready = true;
                return Response.json({ shutdown });
            }
            if (request.method === "POST" && path === "/health") {
                if (!shutdown) seenSinceCheck = true;
                return Response.json({ shutdown });
            }
            if (request.method === "POST" && path === "/shutdown") {
                shutdown = true;
                ready = false;
                stopModels();
                return Response.json({ shutdown: true });
            }
            if (path.startsWith("/settings/")) {
                if (shutdown || !ready) return new Response(null, { status: 403 });
                try {
                    settingsHandler ??= import("./settings-bridge.ts").then((module) =>
                        module.createLaptopSettingsHandler()
                    );
                    const handler = await settingsHandler;
                    if (shutdown || closed) return new Response(null, { status: 403 });
                    return await handler(request, path);
                } catch {
                    return new Response(null, { status: 503 });
                }
            }
            if (path.startsWith("/models/")) {
                if (shutdown || !ready) return new Response(null, { status: 403 });
                try {
                    const bridge = await getModelBridge();
                    if (shutdown || closed) return new Response(null, { status: 403 });
                    return await handleModelRequest(bridge, request, path);
                } catch {
                    return new Response(null, { status: 503 });
                }
            }
            return new Response(null, { status: 404 });
        },
    );
    const address = server.addr;
    if (address.transport !== "tcp" || address.hostname !== "127.0.0.1") {
        server.shutdown();
        throw new Error("Remote control is not bound to loopback");
    }
    return {
        port: address.port,
        credential,
        status: () => ({ connected, ready, shutdown, closed }),
        requestShutdown() {
            shutdown = true;
            ready = false;
            stopModels();
        },
        async close() {
            if (closed) return;
            closed = true;
            shutdown = true;
            ready = false;
            if (timer !== undefined) clearInterval(timer);
            stopModels();
            abort.abort();
            await server.finished;
        },
    };
}
