import { parse as parseJsonc } from "@std/jsonc";
import { applyLaptopGlobalSettingsUpdate, readLaptopGlobalSettingsSnapshot } from "../settings.js";
import { join } from "@std/path";
import { personalGlobalRoot } from "./personal-resources.ts";

export interface RemoteSettingsConnection {
    port: number;
    credential: string;
}

export type SettingsUpdate =
    | { kind: "set"; key: string; value: JsonValue }
    | { kind: "model"; model: string; provider: string }
    | { kind: "compaction"; key: "enabled" | "reserveTokens" | "keepRecentTokens"; value: boolean | number };

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
interface UpdateRequest {
    id: string;
    update: SettingsUpdate;
}
interface UpdateReceipt {
    id: string;
    snapshot: string;
}

const MAX_BODY = 64 * 1024;
let remoteConnection: RemoteSettingsConnection | undefined;
let receiptSnapshot: { mountedBefore: string | undefined; snapshot: string } | undefined;

/** A receipt is authoritative until the mounted view changes. A fresh connection never inherits one. */
export function remoteSettingsSnapshot(mounted: string | undefined): string | undefined {
    if (receiptSnapshot && mounted === receiptSnapshot.mountedBefore) return receiptSnapshot.snapshot;
    receiptSnapshot = undefined;
    return mounted;
}

function mountedSettings(): string | undefined {
    try {
        return JSON.stringify(parseJsonc(Deno.readTextFileSync(join(personalGlobalRoot(), "settings.json"))));
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return undefined;
        throw error;
    }
}

function acceptReceipt(receipt: UpdateReceipt, id: string, mountedBefore: string | undefined): void {
    const parsed = parseJsonc(receipt.snapshot);
    if (receipt.id !== id || !parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Invalid laptop settings receipt");
    }
    receiptSnapshot = { mountedBefore, snapshot: receipt.snapshot };
}

/** Activated only after the authenticated control handshake and verified mount. */
export function configureRemoteSettingsConnection(connection: RemoteSettingsConnection): void {
    if (
        remoteConnection || !Number.isInteger(connection.port) || connection.port < 1 || connection.port > 65535 ||
        !/^[a-f0-9]{64}$/.test(connection.credential)
    ) throw new Error("Invalid remote settings connection");
    remoteConnection = { ...connection };
    receiptSnapshot = undefined;
}

function record(value: JsonValue): value is { [key: string]: JsonValue } {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validJson(value: JsonValue): boolean {
    if (value === null || typeof value === "string" || typeof value === "boolean") return true;
    if (typeof value === "number") return Number.isFinite(value);
    if (Array.isArray(value)) return value.every(validJson);
    return record(value) && Object.values(value).every(validJson);
}

function validate(request: UpdateRequest): void {
    if (
        !request || typeof request.id !== "string" || !/^[a-f0-9]{32}$/.test(request.id) ||
        !request.update || !record(request.update as JsonValue)
    ) throw new Error("Invalid settings request");
    const update = request.update;
    if (update.kind === "set") {
        if (
            Object.keys(update).sort().join(",") !== "key,kind,value" ||
            !/^[a-zA-Z][a-zA-Z0-9]*$/.test(update.key) || !validJson(update.value)
        ) {
            throw new Error("Invalid settings update");
        }
    } else if (update.kind === "model") {
        if (
            Object.keys(update).sort().join(",") !== "kind,model,provider" ||
            typeof update.model !== "string" || typeof update.provider !== "string"
        ) {
            throw new Error("Invalid model update");
        }
    } else if (update.kind === "compaction") {
        if (
            Object.keys(update).sort().join(",") !== "key,kind,value" ||
            !["enabled", "reserveTokens", "keepRecentTokens"].includes(update.key) ||
            (update.key === "enabled"
                ? typeof update.value !== "boolean"
                : !Number.isSafeInteger(update.value) || Number(update.value) < 1)
        ) {
            throw new Error("Invalid compaction update");
        }
    } else throw new Error("Invalid settings update");
}

/** Each service owns its replay history; do not reuse acknowledgements across connections. */
export function createLaptopSettingsHandler(): (request: Request, path: string) => Promise<Response> {
    const receipts = new Map<string, { payload: string; receipt: UpdateReceipt }>();
    return async (request, path) => {
        if (request.method === "GET" && path === "/settings/snapshot") {
            return Response.json({ snapshot: readLaptopGlobalSettingsSnapshot() });
        }
        if (request.method === "GET" && path.startsWith("/settings/receipt/")) {
            const receipt = receipts.get(path.slice("/settings/receipt/".length))?.receipt;
            return receipt ? Response.json(receipt) : new Response(null, { status: 404 });
        }
        if (request.method !== "POST" || path !== "/settings/update") return new Response(null, { status: 404 });
        let input: UpdateRequest;
        try {
            const reader = request.body?.getReader();
            if (!reader) throw new Error("Missing settings request");
            const parts: Uint8Array[] = [];
            let size = 0;
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                size += value.length;
                if (size > MAX_BODY) {
                    await reader.cancel();
                    throw new Error("Settings request too large");
                }
                parts.push(value);
            }
            const bytes = new Uint8Array(size);
            let offset = 0;
            for (const part of parts) {
                bytes.set(part, offset);
                offset += part.length;
            }
            input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
            validate(input);
        } catch {
            return new Response(null, { status: 400 });
        }
        const payload = JSON.stringify(input.update);
        const old = receipts.get(input.id);
        if (old) return old.payload === payload ? Response.json(old.receipt) : new Response(null, { status: 409 });
        try {
            const snapshot = applyLaptopGlobalSettingsUpdate(input.update);
            const receipt = { id: input.id, snapshot };
            receipts.set(input.id, { payload, receipt });
            return Response.json(receipt);
        } catch {
            return new Response(null, { status: 503 });
        }
    };
}

async function send(connection: RemoteSettingsConnection, path: string, body?: string): Promise<Response> {
    return await fetch(`http://127.0.0.1:${connection.port}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
            Authorization: `Bearer ${connection.credential}`,
            ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body,
        signal: AbortSignal.timeout(4_000),
    });
}

/** The receipt survives a lost acknowledgement; never issue a new id for a retry. */
export async function updateRemoteGlobalSetting(update: SettingsUpdate): Promise<void> {
    const connection = remoteConnection;
    if (!connection) throw new Error("Remote global settings writes require the laptop settings service");
    const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    const body = JSON.stringify({ id, update });
    const mountedBefore = mountedSettings();
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const response = await send(connection, "/settings/update", body);
            if (!response.ok) throw new Error(`Laptop settings update failed (${response.status})`);
            const receipt: UpdateReceipt = await response.json();
            acceptReceipt(receipt, id, mountedBefore);
            return;
        } catch (error) {
            if (attempt === 0) continue;
            try {
                const response = await send(connection, `/settings/receipt/${id}`);
                if (response.ok) {
                    const receipt: UpdateReceipt = await response.json();
                    acceptReceipt(receipt, id, mountedBefore);
                    return;
                }
            } catch { /* Keep the original failure; a later caller can read the mounted snapshot. */ }
            throw error;
        }
    }
}
