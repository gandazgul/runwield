// @ts-nocheck: Astro workspace check uses browser tsconfig without Deno/JSR test globals.
import { assertEquals } from "@std/assert";
import { loadPlan, savePlan } from "../../plan-store.js";
import {
    loadPlanActionEvidence,
    type PlanActionRequest,
    type PlanActionResult,
} from "../../shared/workflow/plan-actions.ts";
import { runOwnerPlanAction } from "./server/owner-plan-actions.ts";

type Receipt = {
    operationId: string;
    status: string;
    requestHash: string;
    resultHttpStatus: number | null;
    resultBody: { result?: PlanActionResult } | null;
    resultGeneration: number | null;
};

function makeStore(root: string) {
    const receipts = new Map<string, Receipt>();
    let acquireCount = 0;
    return {
        get acquireCount() {
            return acquireCount;
        },
        requireEnabledProjectRoot(projectId: string) {
            if (projectId !== "project-1") throw new Error("Project not found");
            return root;
        },
        requireActivationProtocolEnabled() {},
        getSessionById(runwieldSessionId: string) {
            return runwieldSessionId === "session-1" ? { projectId: "project-1" } : null;
        },
        inspectSessionActivation() {
            return {
                activation: { currentSegmentId: "segment-1" },
                generation: { generation: 0, currentSegmentId: "segment-1" },
            };
        },
        createOrGetOperationReceipt(options: { requestId: string; requestHash: string }) {
            const existing = receipts.get(options.requestId);
            if (existing) {
                if (existing.requestHash !== options.requestHash) {
                    throw new Error("Operation request id was reused with different input");
                }
                return existing;
            }
            const receipt: Receipt = {
                operationId: `op-${options.requestId}`,
                status: "accepted",
                requestHash: options.requestHash,
                resultHttpStatus: null,
                resultBody: null,
                resultGeneration: null,
            };
            receipts.set(options.requestId, receipt);
            return receipt;
        },
        updateOperationReceipt(
            operationId: string,
            updates: {
                status: string;
                resultHttpStatus?: number | null;
                resultBody?: { result?: PlanActionResult };
                resultGeneration?: number | null;
            },
        ) {
            const receipt = [...receipts.values()].find((candidate) => candidate.operationId === operationId);
            if (!receipt) throw new Error("missing receipt");
            receipt.status = updates.status;
            if (updates.resultHttpStatus !== undefined) receipt.resultHttpStatus = updates.resultHttpStatus;
            if (updates.resultBody !== undefined) receipt.resultBody = updates.resultBody;
            if (updates.resultGeneration !== undefined) receipt.resultGeneration = updates.resultGeneration;
            return receipt;
        },
        acquireSessionActivation() {
            acquireCount += 1;
            return { operationId: `activation-${acquireCount}` };
        },
        releaseUnchangedActivation() {},
        markSessionUncertain() {},
    };
}

async function makeAction(
    root: string,
    action: PlanActionRequest["action"] = "put_on_hold",
): Promise<PlanActionRequest> {
    const evidence = await loadPlanActionEvidence(root, "plan-demo");
    if (evidence.kind !== "success") throw new Error(evidence.message);
    return {
        planId: "plan-demo",
        expectedRevision: evidence.evidence.revision,
        expectedStatus: evidence.evidence.status,
        expectedWorktree: evidence.evidence.worktree,
        action,
    };
}

Deno.test("returns the stored result for an exact duplicate request", async () => {
    const root = await Deno.makeTempDir({ prefix: "runwield-owner-plan-action-" });
    await savePlan(root, "demo", "# Demo\n", { planId: "plan-demo", status: "draft", classification: "FEATURE" });
    const store = makeStore(root);
    const action = await makeAction(root);

    const first = await runOwnerPlanAction(store, {
        projectId: "project-1",
        runwieldSessionId: "session-1",
        deviceId: "device-1",
        requestId: "req-1",
        requestHash: "hash-1",
        expectedGeneration: 0,
        action,
    });
    const duplicate = await runOwnerPlanAction(store, {
        projectId: "project-1",
        runwieldSessionId: "session-1",
        deviceId: "device-1",
        requestId: "req-1",
        requestHash: "hash-1",
        expectedGeneration: 0,
        action,
    });

    assertEquals(first.status, 200);
    assertEquals(duplicate, first);
    assertEquals(store.acquireCount, 1);
    const current = await loadPlan(root, "demo");
    assertEquals(current?.attrs.status, "on_hold");
});

Deno.test("revalidates canonical evidence for a new request id", async () => {
    const root = await Deno.makeTempDir({ prefix: "runwield-owner-plan-action-" });
    await savePlan(root, "demo", "# Demo\n", { planId: "plan-demo", status: "draft", classification: "FEATURE" });
    const store = makeStore(root);
    const action = await makeAction(root);
    const before = await loadPlan(root, "demo");
    if (!before?.revision) throw new Error("fixture Plan missing revision");
    await savePlan(root, "demo", "# Demo changed\n", {
        planId: "plan-demo",
        status: "draft",
        classification: "FEATURE",
    }, { expectedRevision: before.revision });

    const result = await runOwnerPlanAction(store, {
        projectId: "project-1",
        runwieldSessionId: "session-1",
        deviceId: "device-1",
        requestId: "req-2",
        requestHash: "hash-2",
        expectedGeneration: 0,
        action,
    });

    assertEquals(result.status, 409);
    assertEquals(result.body.result.kind, "refresh_required");
    assertEquals(store.acquireCount, 1);
    const current = await loadPlan(root, "demo");
    assertEquals(current?.attrs.status, "draft");
});

Deno.test("conflicts when a request id is reused with different input", async () => {
    const root = await Deno.makeTempDir({ prefix: "runwield-owner-plan-action-" });
    await savePlan(root, "demo", "# Demo\n", { planId: "plan-demo", status: "draft", classification: "FEATURE" });
    const store = makeStore(root);
    const action = await makeAction(root);
    await runOwnerPlanAction(store, {
        projectId: "project-1",
        runwieldSessionId: "session-1",
        deviceId: "device-1",
        requestId: "req-3",
        requestHash: "hash-3",
        expectedGeneration: 0,
        action,
    });

    let message = "";
    try {
        await runOwnerPlanAction(store, {
            projectId: "project-1",
            runwieldSessionId: "session-1",
            deviceId: "device-1",
            requestId: "req-3",
            requestHash: "changed",
            expectedGeneration: 0,
            action,
        });
    } catch (error) {
        message = error instanceof Error ? error.message : String(error);
    }
    assertEquals(message, "Operation request id was reused with different input");
});
