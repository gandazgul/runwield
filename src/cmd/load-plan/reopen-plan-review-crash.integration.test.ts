import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import { ensurePlanIdentity, loadPlan, savePlan } from "../../plan-store.js";
import { createSessionRuntime } from "../../shared/session/session-runtime.ts";
import { openOwnerCoordinationStore } from "../../shared/owner-coordination/index.js";
import { RuntimeInteractionTypes } from "../../shared/session/session-runtime-interactions.js";
import { withRuntimeCommandFixture } from "../testing/runtime-command-fixture.ts";
import { createOwnerWorkspaceApp } from "../../ui/workspace/server.js";

type OwnerApp = ReturnType<typeof createOwnerWorkspaceApp> & { close(): Promise<void> };

Deno.test("a Session reopens the current saved Plan after its pending review process is killed", async () => {
    await withRuntimeCommandFixture(
        "reopen-review-crash-",
        async ({ homeDir, projectRoot, setModelResponseFactory }) => {
            await savePlan(projectRoot, "target", "# Target\n\n## Context\n\nOriginal content.\n", {
                classification: "PLANNED_CHANGE",
                status: "approved",
                affectedPaths: [],
                executionAgent: "engineer",
                collaborationRecommendation: "autonomous",
            });
            const plan = await ensurePlanIdentity(projectRoot, "target");
            const readyPath = join(homeDir, "review-pending.json");
            // This process creates the real Session and leaves its review unresolved. It
            // never closes the runtime or settles the operation before SIGKILL.
            const script = `
            import { createSessionRuntime } from ${
                JSON.stringify(import.meta.resolve("../../shared/session/session-runtime.ts"))
            };
            import { openOwnerCoordinationStore } from ${
                JSON.stringify(import.meta.resolve("../../shared/owner-coordination/index.js"))
            };
            import { RuntimeInteractionTypes } from ${
                JSON.stringify(import.meta.resolve("../../shared/session/session-runtime-interactions.js"))
            };
            const ownerStore = openOwnerCoordinationStore({ dbPath: ${
                JSON.stringify(join(homeDir, "owner.sqlite3"))
            } });
            const runtime = createSessionRuntime({ sessionStore: ownerStore, ownerProcessKind: "test" });
            const { sessionId } = await runtime.createInteractiveSession({ cwd: ${
                JSON.stringify(projectRoot)
            }, mode: "new" });
            runtime.setInteractionAdapter(sessionId, {
                requestInteraction(request) {
                    if (request.type !== RuntimeInteractionTypes.PLAN_REVIEW) throw new Error("Unexpected interaction");
                    const persistentId = runtime.getSessionSnapshot(sessionId).managed.runwieldSessionId;
                    Deno.writeTextFileSync(${JSON.stringify(readyPath)}, JSON.stringify({ persistentId }));
                    return new Promise(() => {});
                },
            });
            void runtime.requestInteraction(sessionId, {
                type: RuntimeInteractionTypes.PLAN_REVIEW,
                prompt: "Review target",
                _meta: { planId: ${
                JSON.stringify(plan.attrs.planId)
            }, planName: "target", planningAgentName: "planner" },
            });
            setInterval(() => {}, 1000);
        `;
            const worker = new Deno.Command(Deno.execPath(), {
                args: ["eval", "-A", "--config", fromFileUrl(new URL("../../../deno.json", import.meta.url)), script],
                stdout: "null",
                stderr: "piped",
            }).spawn();
            try {
                const deadline = Date.now() + 15_000;
                let persistentId = "";
                while (Date.now() < deadline) {
                    try {
                        persistentId = JSON.parse(await Deno.readTextFile(readyPath)).persistentId;
                        if (persistentId) break;
                    } catch (error) {
                        if (!(error instanceof Deno.errors.NotFound)) throw error;
                    }
                    await new Promise((resolve) => setTimeout(resolve, 25));
                }
                if (!persistentId) {
                    try {
                        worker.kill("SIGKILL");
                    } catch { /* Already stopped. */ }
                    const output = await worker.output();
                    throw new Error(`Review did not become pending: ${new TextDecoder().decode(output.stderr)}`);
                }
                worker.kill("SIGKILL");
                const killed = await worker.status;
                assertEquals(killed.success, false);

                // A newer saved version, not the pending request's original text, must be reviewed.
                const savedBeforeEdit = await loadPlan(projectRoot, "target");
                assert(savedBeforeEdit);
                await savePlan(projectRoot, "target", "# Target\n\n## Context\n\nUpdated after crash.\n", {
                    ...savedBeforeEdit.attrs,
                    status: "approved",
                }, { expectedRevision: savedBeforeEdit.revision });
                let modelTurns = 0;
                setModelResponseFactory(() => {
                    modelTurns++;
                    return fauxAssistantMessage(fauxText("Unexpected model turn"));
                });
                const ownerStore = openOwnerCoordinationStore({ dbPath: join(homeDir, "owner.sqlite3") });
                const runtime = createSessionRuntime({ sessionStore: ownerStore, ownerProcessKind: "test" });
                try {
                    const resumed = await runtime.createInteractiveSession({
                        cwd: projectRoot,
                        mode: "continue",
                        resumeSessionId: persistentId,
                    });
                    let reviewedContent = "";
                    runtime.setInteractionAdapter(resumed.sessionId, {
                        async requestInteraction(request) {
                            if (request.type === RuntimeInteractionTypes.PLAN_REVIEW) {
                                assertEquals(request._meta?.planName, "target");
                                assertEquals(request._meta?.planningAgentName, "planner");
                                reviewedContent = await Deno.readTextFile(String(request._meta?.planPath));
                                return { outcome: "accepted", _meta: { approved: true, approvalAction: "later" } };
                            }
                            return { outcome: "canceled" };
                        },
                    });
                    const result = await runtime.reopenPlanReview(resumed.sessionId);
                    assertEquals(result.kind, "complete", result.message);
                    assertStringIncludes(reviewedContent, "Updated after crash.");
                    assertEquals(modelTurns, 0);
                    assertEquals((await loadPlan(projectRoot, "target"))?.attrs.status, "ready_for_work");
                } finally {
                    await runtime.closeAllSessionsWhenIdle();
                    ownerStore.close();
                }
            } finally {
                try {
                    worker.kill("SIGKILL");
                } catch { /* Already stopped. */ }
                await worker.status;
            }
        },
    );
});

Deno.test("Workspace opens and approves a saved Plan review after its owner is SIGKILLed", async () => {
    await withRuntimeCommandFixture(
        "workspace-review-crash-",
        async ({ homeDir, projectRoot, setModelResponseFactory }) => {
            await savePlan(projectRoot, "target", "# Target\n\n## Context\n\nOriginal content.\n", {
                classification: "PLANNED_CHANGE",
                status: "approved",
                affectedPaths: [],
                executionAgent: "engineer",
                collaborationRecommendation: "autonomous",
            });
            const plan = await ensurePlanIdentity(projectRoot, "target");
            const readyPath = join(homeDir, "workspace-review-pending.json");
            const script = `
            import { createSessionRuntime } from ${
                JSON.stringify(import.meta.resolve("../../shared/session/session-runtime.ts"))
            };
            import { openOwnerCoordinationStore } from ${
                JSON.stringify(import.meta.resolve("../../shared/owner-coordination/index.js"))
            };
            import { RuntimeInteractionTypes } from ${
                JSON.stringify(import.meta.resolve("../../shared/session/session-runtime-interactions.js"))
            };
            const store = openOwnerCoordinationStore({ dbPath: ${JSON.stringify(join(homeDir, "owner.sqlite3"))} });
            const runtime = createSessionRuntime({ sessionStore: store, ownerProcessKind: "test" });
            const { sessionId } = await runtime.createInteractiveSession({ cwd: ${
                JSON.stringify(projectRoot)
            }, mode: "new" });
            const persistentId = runtime.getSessionSnapshot(sessionId).managed.runwieldSessionId;
            const projectId = store.getSessionById(persistentId).projectId;
            store.registerProject({ root: ${JSON.stringify(projectRoot)}, idFactory: () => projectId });
            const activation = store.inspectSessionActivation(persistentId);
            const proof = store.acquireSessionActivation({
                runwieldSessionId: persistentId, projectId: store.getSessionById(persistentId).projectId,
                ownerInstanceId: "review-setup", ownerProcessKind: "test",
                expectedGeneration: activation.generation.generation,
                expectedCurrentSegmentId: activation.generation.currentSegmentId,
            });
            store.recordLastPlanReview(proof, {
                planId: ${JSON.stringify(plan.attrs.planId)}, planName: "target", planningAgentName: "planner",
            });
            store.releaseUnchangedActivation(proof);
            runtime.setInteractionAdapter(sessionId, {
                requestInteraction(request) {
                    if (request.type !== RuntimeInteractionTypes.PLAN_REVIEW) throw new Error("Unexpected interaction");
                    Deno.writeTextFileSync(${JSON.stringify(readyPath)}, JSON.stringify({ persistentId }));
                    return new Promise(() => {});
                },
            });
            void runtime.reopenPlanReview(sessionId);
            setInterval(() => {}, 1000);
        `;
            const worker = new Deno.Command(Deno.execPath(), {
                args: ["eval", "-A", "--config", fromFileUrl(new URL("../../../deno.json", import.meta.url)), script],
                stdout: "null",
                stderr: "piped",
            }).spawn();
            try {
                let persistentId = "";
                const deadline = Date.now() + 15_000;
                while (Date.now() < deadline) {
                    try {
                        persistentId = JSON.parse(await Deno.readTextFile(readyPath)).persistentId;
                        if (persistentId) break;
                    } catch (error) {
                        if (!(error instanceof Deno.errors.NotFound)) throw error;
                    }
                    await new Promise((resolve) => setTimeout(resolve, 25));
                }
                if (!persistentId) {
                    worker.kill("SIGKILL");
                    const output = await worker.output();
                    throw new Error(`Review did not become pending: ${new TextDecoder().decode(output.stderr)}`);
                }
                worker.kill("SIGKILL");
                assertEquals((await worker.status).success, false);

                const previous = await loadPlan(projectRoot, "target");
                assert(previous);
                await savePlan(projectRoot, "target", "# Target\n\n## Context\n\nUpdated after crash.\n", {
                    ...previous.attrs,
                    status: "approved",
                }, { expectedRevision: previous.revision });
                const updated = await loadPlan(projectRoot, "target");
                assert(updated);
                let modelTurns = 0;
                setModelResponseFactory(() => {
                    modelTurns++;
                    return fauxAssistantMessage(fauxText("Unexpected model turn"));
                });
                const store = openOwnerCoordinationStore({ dbPath: join(homeDir, "owner.sqlite3") });
                let app: OwnerApp | undefined;
                try {
                    const session = store.getSessionById(persistentId);
                    assert(session);
                    const projectId = session.projectId;
                    const activation = store.inspectSessionActivation(persistentId);
                    assert(["idle", "reconcile_required"].includes(activation.activation?.state || ""));
                    assert(activation.generation);
                    const pairing = store.createPairingRequest({
                        codeFactory: () => "KIL123",
                        proofFactory: () => "killed-proof",
                    });
                    store.approvePairingRequest(pairing.code);
                    const device = store.claimPairingRequest(pairing.proof, {
                        credentialFactory: () => "killed-credential",
                        csrfFactory: () => "killed-csrf",
                    });
                    app = createOwnerWorkspaceApp({
                        mode: "owner",
                        publicOrigin: "http://127.0.0.1:8787",
                        store,
                    }) as OwnerApp;
                    const base = `http://127.0.0.1:8787/api/owner/projects/${projectId}`;
                    const sessionBase = `${base}/sessions/${persistentId}`;
                    const cookie = `rw_owner_device=${device.credential}; rw_owner_csrf=killed-csrf`;
                    const headers = { origin: "http://127.0.0.1:8787", cookie, "x-runwield-csrf": "killed-csrf" };
                    // Do not call the manual recovery route or resume the Runtime in the test.
                    const opened = await app.handler()(
                        new Request(`${sessionBase}/plan-review`, {
                            method: "POST",
                            headers,
                            body: JSON.stringify({
                                requestId: "reopen-killed-review",
                                expectedGeneration: activation.generation.generation,
                            }),
                        }),
                    );
                    assertEquals(opened.status, 202, await opened.clone().text());
                    const { operationId, kind } = await opened.json();
                    assertEquals(kind, "starting");
                    let review;
                    for (let index = 0; index < 300; index++) {
                        const response = await app.handler()(
                            new Request(`${sessionBase}/live`, { headers: { cookie } }),
                        );
                        assertEquals(response.status, 200, await response.clone().text());
                        const live = await response.json();
                        review = live.operation?.liveInteraction?.request;
                        if (review?.reviewUrl) break;
                        if (live.operation?.status === "failed") throw new Error(live.operation.error);
                        await new Promise((resolve) => setTimeout(resolve, 10));
                    }
                    assert(review?.reviewUrl, "Workspace did not reopen the killed review");
                    assertEquals(review.type, "plan_review");
                    assertStringIncludes(review.reviewUrl, `/projects/${projectId}/plans/${plan.attrs.planId}?`);
                    assertEquals(review.planReview.expectedRevision, updated.revision);
                    const answer = await app.handler()(
                        new Request(
                            `${base}/session-operations/${operationId}/interactions/${review.id}/answer`,
                            {
                                method: "POST",
                                headers,
                                body: JSON.stringify({
                                    runwieldSessionId: persistentId,
                                    requestId: "approve-killed-review",
                                    response: {
                                        approved: true,
                                        approvalAction: "later",
                                        executionAgent: "engineer",
                                        collaborationRecommendation: "autonomous",
                                    },
                                }),
                            },
                        ),
                    );
                    assertEquals(answer.status, 202, await answer.clone().text());
                    let completed = false;
                    for (let index = 0; index < 300; index++) {
                        const operation = await (await app.handler()(
                            new Request(
                                `http://127.0.0.1:8787/api/owner/session-operations/${operationId}`,
                                { headers: { cookie } },
                            ),
                        )).json();
                        if (operation.status === "completed") {
                            completed = true;
                            break;
                        }
                        if (operation.status === "failed") throw new Error(operation.error);
                        await new Promise((resolve) => setTimeout(resolve, 10));
                    }
                    assert(completed, "Workspace review did not complete");
                    assertEquals((await loadPlan(projectRoot, "target"))?.attrs.status, "ready_for_work");
                    assertEquals(modelTurns, 0);
                } finally {
                    await app?.close();
                    store.close();
                }
            } finally {
                try {
                    worker.kill("SIGKILL");
                } catch { /* Already stopped. */ }
                await worker.status;
            }
        },
    );
});
