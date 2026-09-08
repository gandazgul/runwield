/** Temporary access to the running agent from another surface on the same machine. */
import { createHash } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { getHomeDir } from "../../constants.js";

import type { ImageAttachment } from "./types.js";
import type { RuntimeInteractionRequest, RuntimeInteractionResponse } from "./session-runtime-interactions.js";
import type { RuntimeQueuedMessage, SessionRuntimeEvent } from "./session-runtime-events.js";
import type { SessionRuntime, SteerSessionResult } from "./session-runtime.js";
import type { HostedSession } from "./hosted-session.js";

type LiveSessionCommand = {
    action: "answer" | "cancel" | "steer";
    requestId?: string;
    text?: string;
    images?: ImageAttachment[];
    interactionId?: string;
    response?: RuntimeInteractionResponse;
};
type SteeringReceipt = { input: string; result: Promise<SteerSessionResult> };
type LiveSessionCommandResult = { ok: boolean; queued?: boolean; error?: string };
type LiveSessionSnapshot = {
    operationId: string;
    events: SessionRuntimeEvent[];
    interaction: RuntimeInteractionRequest | null;
    queuedMessages: RuntimeQueuedMessage[];
};

function socketPath(sessionId: string, operationId: string) {
    const key = createHash("sha256").update(`${getHomeDir()}:${sessionId}:${operationId}`).digest("hex").slice(0, 40);
    return Deno.build.os === "windows" ? `\\\\.\\pipe\\runwield-${key}` : `/tmp/runwield-${key}.sock`;
}

export async function openLiveSessionConnection(
    runtime: SessionRuntime,
    session: HostedSession,
    operationId: string,
    events: SessionRuntimeEvent[],
) {
    const managed = session.getManagedMetadata();
    if (!managed) throw new Error("A live connection requires a managed Session.");
    const path = socketPath(managed.runwieldSessionId, operationId);
    const steeringRequests = new Map<string, SteeringReceipt>();
    const server = createServer(async (request, response) => {
        response.setHeader("content-type", "application/json");
        try {
            session.getManagedOperationCapability()?.assertLive();
            if (!session.getManagedOperationCapability()) throw new Error("The turn has finished.");
            if (request.method === "GET") {
                response.end(JSON.stringify({
                    operationId,
                    events,
                    queuedMessages: runtime.getQueuedMessages(session.id),
                    interaction: [...session.getActiveInteractions().values()][0]?.request || null,
                }));
                return;
            }
            if (request.method !== "POST") throw new Error("Unsupported request.");
            let body = "";
            request.setEncoding("utf8");
            for await (const chunk of request) {
                body += chunk.toString();
                if (body.length > 12 * 1024 * 1024) throw new Error("Answer is too large.");
            }
            const command: LiveSessionCommand = JSON.parse(body);
            if (command.action === "steer" && command.requestId) {
                if (!command.text?.trim() && !command.images?.length) {
                    throw new Error("A message or image is required.");
                }
                const input = JSON.stringify([command.text, command.images]);
                const previous = steeringRequests.get(command.requestId);
                if (previous && previous.input !== input) throw new Error("This message ID was already used.");
                const result = previous?.result ||
                    runtime.steerSession(session.id, command.text || "", command.images || []);
                steeringRequests.set(command.requestId, { input, result });
                response.end(JSON.stringify(await result));
                return;
            }
            if (command.action === "cancel") {
                runtime.cancelSession(session.id);
            } else if (command.action === "answer" && command.interactionId && command.response) {
                const interaction = session.getActiveInteractions().get(command.interactionId);
                if (!interaction?.answer) throw new Error("This question has already been answered or interrupted.");
                interaction.answer(command.response);
            } else {
                throw new Error("Invalid live Session command.");
            }
            response.end(JSON.stringify({ ok: true }));
        } catch (error) {
            response.statusCode = 409;
            response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        }
    });
    try {
        await new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen(path, () => resolve(undefined));
        });
        if (Deno.build.os !== "windows") await Deno.chmod(path, 0o600);
    } catch (error) {
        server.close();
        throw error;
    }
    return async () => {
        await new Promise<void>((resolve) => server.close(() => resolve(undefined)));
    };
}

export function readLiveSessionConnection(sessionId: string, operationId: string): Promise<LiveSessionSnapshot>;
export function readLiveSessionConnection(
    sessionId: string,
    operationId: string,
    command: LiveSessionCommand,
): Promise<LiveSessionCommandResult>;
export function readLiveSessionConnection(
    sessionId: string,
    operationId: string,
    command?: LiveSessionCommand,
): Promise<LiveSessionSnapshot | LiveSessionCommandResult> {
    return new Promise((resolve, reject) => {
        const request = httpRequest({
            socketPath: socketPath(sessionId, operationId),
            path: "/",
            method: command ? "POST" : "GET",
            agent: false,
        }, (response) => {
            let body = "";
            response.setEncoding("utf8");
            response.on("data", (chunk) => body += chunk);
            response.on("error", reject);
            response.on("end", () => {
                try {
                    const value = JSON.parse(body);
                    if (response.statusCode !== 200) {
                        reject(new Error(value.error || "The turn is no longer available."));
                    } else resolve(value);
                } catch (error) {
                    reject(error);
                }
            });
        });
        request.setTimeout(3000, () => request.destroy(new Error("The running agent did not respond. Try again.")));
        request.on("error", reject);
        request.end(command ? JSON.stringify(command) : undefined);
    });
}
