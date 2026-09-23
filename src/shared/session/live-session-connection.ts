/** Temporary access to the running agent from another surface on the same machine. */
import { createHash } from "node:crypto";
import { createServer, request as httpRequest, type ServerResponse } from "node:http";
import { getHomeDir } from "../../constants.js";

import type { ImageAttachment } from "./types.js";
import type { RuntimeInteractionRequest, RuntimeInteractionResponse } from "./session-runtime-interactions.js";
import type {
    NotificationSurface,
    RuntimeAttentionRequestedEvent,
    RuntimeQueuedMessage,
    SessionRuntimeEvent,
} from "./session-runtime-events.js";
import type { SessionRuntime, SteerSessionResult } from "./session-runtime.ts";
import type { HostedSession } from "./hosted-session.js";

type LiveSessionCommand = {
    action: "answer" | "cancel" | "steer";
    inputSurface?: NotificationSurface;
    requestId?: string;
    text?: string;
    images?: ImageAttachment[];
    interactionId?: string;
    response?: RuntimeInteractionResponse;
};
type SteeringReceipt = { input: string; result: Promise<SteerSessionResult> };
type LiveSessionCommandResult = { ok: boolean; queued?: boolean; error?: string };
export type LiveSessionInfo = Pick<
    NonNullable<ReturnType<SessionRuntime["getSessionSnapshot"]>>,
    | "name"
    | "sessionStats"
    | "contextUsage"
    | "systemContextTokens"
    | "activeAgent"
    | "activeModel"
    | "thinkingLevel"
    | "workflowContext"
    | "activeExecutionWorkflow"
    | "planAssociations"
>;
/** Only user-facing Session state crosses the live observation boundary. */
export function projectLiveSessionInfo(
    snapshot: ReturnType<SessionRuntime["getSessionSnapshot"]>,
): LiveSessionInfo | null {
    if (!snapshot) return null;
    return {
        name: snapshot.name,
        sessionStats: snapshot.sessionStats,
        contextUsage: snapshot.contextUsage,
        systemContextTokens: snapshot.systemContextTokens,
        activeAgent: snapshot.activeAgent,
        activeModel: snapshot.activeModel,
        thinkingLevel: snapshot.thinkingLevel,
        workflowContext: snapshot.workflowContext,
        activeExecutionWorkflow: snapshot.activeExecutionWorkflow,
        planAssociations: snapshot.planAssociations,
    };
}

type LiveSessionSnapshot = {
    operationId: string;
    events: SessionRuntimeEvent[];
    interaction: RuntimeInteractionRequest | null;
    queuedMessages: RuntimeQueuedMessage[];
    sessionInfo?: LiveSessionInfo | null;
};

function socketPath(sessionId: string, operationId: string) {
    const key = createHash("sha256").update(`${getHomeDir()}:${sessionId}:${operationId}`).digest("hex").slice(0, 40);
    return Deno.build.os === "windows" ? `\\\\.\\pipe\\runwield-${key}` : `/tmp/runwield-${key}.sock`;
}

export interface LiveSessionRuntime {
    getSessionSnapshot(sessionId: string): ReturnType<SessionRuntime["getSessionSnapshot"]>;
    getQueuedMessages(sessionId: string): ReturnType<SessionRuntime["getQueuedMessages"]>;
    steerSession(
        sessionId: string,
        text: string,
        images: ImageAttachment[],
        inputSurface?: NotificationSurface,
    ): Promise<SteerSessionResult>;
    cancelSession(sessionId: string): ReturnType<SessionRuntime["cancelSession"]>;
    subscribeSessionEvents(
        sessionId: string,
        listener: (event: SessionRuntimeEvent) => void | Promise<void>,
    ): () => void;
}

export async function openLiveSessionConnection(
    runtime: LiveSessionRuntime,
    session: HostedSession,
    operationId: string,
    events: SessionRuntimeEvent[],
) {
    const managed = session.getManagedMetadata();
    if (!managed) throw new Error("A live connection requires a managed Session.");
    const path = socketPath(managed.runwieldSessionId, operationId);
    const steeringRequests = new Map<string, SteeringReceipt>();
    const streams = new Set<ServerResponse>();
    const server = createServer(async (request, response) => {
        response.setHeader("content-type", "application/json");
        try {
            session.getManagedOperationCapability()?.assertLive();
            if (!session.getManagedOperationCapability()) throw new Error("The turn has finished.");
            if (request.method === "GET" && request.url === "/attention") {
                response.setHeader("content-type", "text/event-stream");
                response.flushHeaders();
                streams.add(response);
                const unsubscribe = runtime.subscribeSessionEvents(session.id, (event) => {
                    if (event.type !== "attention_requested") return;
                    response.write(`data: ${JSON.stringify(event)}\n\n`);
                });
                response.on("close", () => {
                    streams.delete(response);
                    unsubscribe();
                });
                return;
            }
            if (request.method === "GET") {
                const snapshot = runtime.getSessionSnapshot(session.id);
                response.end(JSON.stringify({
                    operationId,
                    events,
                    queuedMessages: runtime.getQueuedMessages(session.id),
                    sessionInfo: projectLiveSessionInfo(snapshot),
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
            if (command.inputSurface && !["tui", "workspace", "acp", "test"].includes(command.inputSurface)) {
                throw new Error("Invalid input surface.");
            }
            if (command.action === "steer" && command.requestId) {
                if (!command.text?.trim() && !command.images?.length) {
                    throw new Error("A message or image is required.");
                }
                const input = JSON.stringify([command.text, command.images, command.inputSurface]);
                const previous = steeringRequests.get(command.requestId);
                if (previous && previous.input !== input) throw new Error("This message ID was already used.");
                const result = previous?.result ||
                    runtime.steerSession(session.id, command.text || "", command.images || [], command.inputSurface);
                steeringRequests.set(command.requestId, { input, result });
                try {
                    response.end(JSON.stringify(await result));
                } catch (error) {
                    if (steeringRequests.get(command.requestId)?.result === result) {
                        steeringRequests.delete(command.requestId);
                    }
                    throw error;
                }
                return;
            }
            if (command.action === "cancel") {
                runtime.cancelSession(session.id);
            } else if (command.action === "answer" && command.interactionId && command.response) {
                const interaction = session.getActiveInteractions().get(command.interactionId);
                if (!interaction?.answer) throw new Error("This question has already been answered or interrupted.");
                interaction.answer(command.response, command.inputSurface);
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
        for (const stream of streams) stream.end();
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

/** Subscribe before sending remote input, so even a fast final stop is delivered. */
export function subscribeLiveSessionAttention(
    sessionId: string,
    operationId: string,
    onEvent: (event: RuntimeAttentionRequestedEvent) => void,
): Promise<() => void> {
    return new Promise((resolve, reject) => {
        const request = httpRequest({
            socketPath: socketPath(sessionId, operationId),
            path: "/attention",
            agent: false,
        }, (response) => {
            clearTimeout(timeout);
            if (response.statusCode !== 200) {
                response.resume();
                reject(new Error("The running agent is no longer available."));
                return;
            }
            response.setEncoding("utf8");
            let pending = "";
            response.on("data", (chunk: string) => {
                pending += chunk;
                let boundary;
                while ((boundary = pending.indexOf("\n\n")) >= 0) {
                    const frame = pending.slice(0, boundary);
                    pending = pending.slice(boundary + 2);
                    if (frame.startsWith("data: ")) {
                        const event: RuntimeAttentionRequestedEvent = JSON.parse(frame.slice(6));
                        onEvent(event);
                    }
                }
            });
            response.on("error", () => {});
            resolve(() => response.destroy());
        });
        const timeout = setTimeout(() => request.destroy(new Error("The running agent did not respond.")), 3000);
        request.on("error", (error) => {
            clearTimeout(timeout);
            reject(error);
        });
        request.end();
    });
}
