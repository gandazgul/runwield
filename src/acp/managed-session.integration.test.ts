import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { withRuntimeCommandFixture } from "../cmd/testing/runtime-command-fixture.ts";
import { makeManagedSessionFixture, readTranscriptEvidence } from "../testing/managed-session-fixture.ts";
import { startRunWieldAcpServer } from "./server.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function startTestServer() {
    const input = new TransformStream();
    const output = new TransformStream();
    const diagnostics: string[] = [];
    const connection = startRunWieldAcpServer(input.readable, output.writable, {
        diagnostic: (message: string) => {
            diagnostics.push(message);
        },
    });
    return {
        inputWriter: input.writable.getWriter(),
        outputReader: output.readable.getReader(),
        connection,
        diagnostics,
    };
}

async function sendMessage(handle: ReturnType<typeof startTestServer>, message: Record<string, unknown>) {
    await handle.inputWriter.write(encoder.encode(`${JSON.stringify(message)}\n`));
}

async function readMessage(handle: ReturnType<typeof startTestServer>) {
    const chunk = await handle.outputReader.read();
    assert(!chunk.done, "server should write a message");
    return JSON.parse(decoder.decode(chunk.value).trim().split("\n")[0]) as Record<
        string,
        { runwield?: Record<string, string | number> } | string | number | Record<string, string>
    >;
}

async function readThroughResponse(handle: ReturnType<typeof startTestServer>, requestId: string) {
    const messages: Array<Record<string, unknown>> = [];
    for (let index = 0; index < 80; index++) {
        const message = await readMessage(handle);
        messages.push(message);
        if (message.id === requestId) return { response: message, messages };
    }
    throw new Error(`ACP response ${requestId} was not received`);
}

async function closeTestServer(handle: ReturnType<typeof startTestServer>) {
    await handle.inputWriter.close();
    handle.connection.close();
    await handle.connection.closed;
    handle.outputReader.releaseLock();
}

async function writeAcpSuccessorTranscript(
    projectRoot: string,
    piSessionId: string,
    sessionDir: string,
): Promise<string> {
    const timestamp = "2026-01-01T00:03:00.000Z";
    const path = join(sessionDir, `${timestamp.replace(/[:.]/g, "-")}_${piSessionId}.jsonl`);
    const header = { type: "session", id: piSessionId, timestamp, cwd: projectRoot, name: "ACP successor" };
    await Deno.writeTextFile(path, `${JSON.stringify(header)}\n`);
    return path;
}

Deno.test("ACP load uses the committed current segment and rejects prompt while Workspace owns activation", async () => {
    await withRuntimeCommandFixture(
        "acp-managed-session-",
        async ({ homeDir, projectRoot, setModelResponseFactory }) => {
            const fixture = await makeManagedSessionFixture({ home: homeDir, projectRoot });
            const workspace = fixture.openStore();
            const server = startTestServer();
            try {
                setModelResponseFactory(fixture.recordedModelResponse("ACP accepted turn."));
                const initial = workspace.inspectSessionActivation(fixture.session.runwieldSessionId).generation;
                const predecessorId = initial?.currentSegmentId ?? "";
                let rolloverProof = workspace.acquireSessionActivation({
                    runwieldSessionId: fixture.session.runwieldSessionId,
                    projectId: fixture.project.projectId,
                    ownerInstanceId: "workspace-rollover-owner",
                    ownerProcessKind: "workspace",
                    operationId: "workspace-rollover-before-acp-load",
                    expectedGeneration: 0,
                    expectedCurrentSegmentId: predecessorId,
                    phase: "preparing",
                });
                rolloverProof = workspace.changeSessionActivationPhase(rolloverProof, "hydrated");
                rolloverProof = workspace.changeSessionActivationPhase(rolloverProof, "turning");
                rolloverProof = workspace.changeSessionActivationPhase(rolloverProof, "checkpointing");
                const successorPath = await writeAcpSuccessorTranscript(
                    fixture.projectRoot,
                    "pi-acp-successor",
                    fixture.sessionDir,
                );
                const successorSafeLocator = await workspace.validateSuccessorSegmentLocator({
                    projectId: fixture.project.projectId,
                    piSessionId: "pi-acp-successor",
                    transcriptPath: successorPath,
                    transcriptCwd: fixture.projectRoot,
                });
                workspace.commitSegmentRolloverAndPublish(rolloverProof, {
                    predecessorSegmentId: predecessorId,
                    predecessorEvidence: await readTranscriptEvidence(fixture.transcriptPath),
                    successor: {
                        runwieldSessionId: fixture.session.runwieldSessionId,
                        projectId: fixture.project.projectId,
                        piSessionId: "pi-acp-successor",
                        transcriptPath: successorPath,
                        transcriptCwd: fixture.projectRoot,
                        kind: "execution",
                        idFactory: () => "acp-successor-segment",
                    },
                    successorSafeLocator,
                    generationEvidence: {
                        generation: 1,
                        currentSegmentId: "acp-successor-segment",
                        ...(await readTranscriptEvidence(successorPath)),
                    },
                });

                const loadId = fixture.session.piSessionId;
                await sendMessage(server, {
                    jsonrpc: "2.0",
                    id: "load",
                    method: "session/load",
                    params: {
                        sessionId: loadId,
                        cwd: fixture.projectRoot,
                        mcpServers: [],
                        _meta: { runwield: { sessionPath: fixture.transcriptPath } },
                    },
                });
                const loaded = await readThroughResponse(server, "load");
                const loadResponse = loaded.response;
                assert(loadResponse.result, JSON.stringify(loadResponse));
                const loadMeta = loadResponse.result as { _meta?: { runwield?: Record<string, string | number> } };
                assertEquals(loadMeta._meta?.runwield?.persistedSessionId, fixture.session.runwieldSessionId);

                const currentSegmentId =
                    workspace.inspectSessionActivation(fixture.session.runwieldSessionId).generation
                        ?.currentSegmentId ?? null;
                assertEquals(currentSegmentId, "acp-successor-segment");
                const proof = workspace.acquireSessionActivation({
                    runwieldSessionId: fixture.session.runwieldSessionId,
                    projectId: fixture.project.projectId,
                    ownerInstanceId: "workspace-owner",
                    ownerProcessKind: "workspace",
                    operationId: "workspace-active",
                    expectedGeneration: 1,
                    expectedCurrentSegmentId: currentSegmentId,
                    phase: "preparing",
                });
                await sendMessage(server, {
                    jsonrpc: "2.0",
                    id: "blocked-prompt",
                    method: "session/prompt",
                    params: { sessionId: loadId, prompt: [{ type: "text", text: "blocked" }] },
                });
                const blocked = await readThroughResponse(server, "blocked-prompt");
                assert(blocked.response.error, JSON.stringify(blocked.response));
                assertEquals(fixture.modelRequests.length, 0);
                workspace.releaseUnchangedActivation(proof);

                await sendMessage(server, {
                    jsonrpc: "2.0",
                    id: "accepted-prompt",
                    method: "session/prompt",
                    params: { sessionId: loadId, prompt: [{ type: "text", text: "accepted" }] },
                });
                const accepted = await readThroughResponse(server, "accepted-prompt");
                assert(accepted.response.result, JSON.stringify(accepted.response));
                assertEquals(fixture.modelRequests.length, 1);
                const acceptedGeneration =
                    workspace.inspectSessionActivation(fixture.session.runwieldSessionId).generation;
                assertEquals(acceptedGeneration?.generation, 2);
                assertEquals(acceptedGeneration?.currentSegmentId, "acp-successor-segment");
                assertEquals(server.diagnostics.every((message) => !message.trim().startsWith("{")), true);
            } finally {
                await closeTestServer(server).catch(() => {});
                workspace.close();
                await fixture.cleanup();
            }
        },
    );
});
