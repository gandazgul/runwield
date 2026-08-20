import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { loadPlan, savePlan } from "../../plan-store.js";
import { executePlanAction, loadPlanActionEvidence } from "./plan-actions.ts";

async function makeProject(): Promise<{ root: string; revision: string }> {
    const root = await Deno.makeTempDir({ prefix: "runwield-plan-action-" });
    await savePlan(root, "demo", "# Demo\n\nBody\n", {
        planId: "plan-demo",
        status: "draft",
        classification: "FEATURE",
    });
    const plan = await loadPlan(root, "demo");
    if (!plan?.revision) throw new Error("fixture Plan was not saved");
    return { root, revision: plan.revision };
}

async function writeRegistry(root: string, entries: Array<Record<string, string>>): Promise<void> {
    await Deno.mkdir(join(root, ".wld"), { recursive: true });
    await Deno.writeTextFile(join(root, ".wld", "worktrees.json"), JSON.stringify({ version: 2, entries }));
}

Deno.test("rejects stale Plan revision before lifecycle mutation", async () => {
    const { root, revision } = await makeProject();
    await savePlan(root, "demo", "# Demo\n\nBody changed\n", {
        planId: "plan-demo",
        status: "draft",
        classification: "FEATURE",
    }, { expectedRevision: revision });

    const result = await executePlanAction(root, {
        planId: "plan-demo",
        expectedRevision: revision,
        expectedStatus: "draft",
        expectedWorktree: { kind: "none" },
        action: "put_on_hold",
    });

    assertEquals(result.kind, "refresh_required");
    const current = await loadPlan(root, "demo");
    assertEquals(current?.attrs.status, "draft");
});

Deno.test("rejects replaced worktree evidence before lifecycle mutation", async () => {
    const { root, revision } = await makeProject();
    await savePlan(root, "demo", "# Demo\n\nBody\n", {
        planId: "plan-demo",
        status: "on_hold",
        heldFromStatus: "in_progress",
        classification: "FEATURE",
    }, { expectedRevision: revision });
    const loaded = await loadPlan(root, "demo");
    if (!loaded?.revision) throw new Error("fixture Plan was not reloaded");
    await writeRegistry(root, [{
        id: "attempt-two",
        planName: "demo",
        planId: "plan-demo",
        baseBranch: "main",
        baseRef: "main",
        baseCommit: "222",
        branch: "rw/demo-2",
        path: "redacted",
        status: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
    }]);

    const result = await executePlanAction(root, {
        planId: "plan-demo",
        expectedRevision: loaded.revision,
        expectedStatus: "on_hold",
        expectedWorktree: {
            kind: "attempt",
            id: "attempt-one",
            planId: "plan-demo",
            status: "active",
            branch: "rw/demo-1",
            baseBranch: "main",
            baseRef: "main",
            baseCommit: "111",
        },
        action: "resume_from_hold",
    });

    assertEquals(result.kind, "recovery_required");
    const current = await loadPlan(root, "demo");
    assertEquals(current?.attrs.status, "on_hold");
});

Deno.test("applies a valid lifecycle action and returns new evidence", async () => {
    const { root } = await makeProject();
    const evidence = await loadPlanActionEvidence(root, "plan-demo");
    if (evidence.kind !== "success") throw new Error(evidence.message);

    const result = await executePlanAction(root, {
        planId: "plan-demo",
        expectedRevision: evidence.evidence.revision,
        expectedStatus: evidence.evidence.status,
        expectedWorktree: evidence.evidence.worktree,
        action: "put_on_hold",
        holdReason: "pause",
    });

    assertEquals(result.kind, "success");
    const current = await loadPlan(root, "demo");
    assertEquals(current?.attrs.status, "on_hold");
});

Deno.test("rejects Plan and registry worktree identity mismatches before returning evidence", async () => {
    const { root, revision } = await makeProject();
    await savePlan(root, "demo", "# Demo\n\nBody\n", {
        planId: "plan-demo",
        status: "in_progress",
        classification: "FEATURE",
        worktreeId: "attempt-one",
        worktreeStatus: "active",
        worktreeBranch: "rw/demo-1",
        worktreeBaseBranch: "main",
    }, { expectedRevision: revision });
    await writeRegistry(root, [{
        id: "attempt-one",
        planName: "demo",
        planId: "plan-demo",
        baseBranch: "main",
        baseRef: "main",
        baseCommit: "111",
        branch: "rw/demo-1",
        path: "redacted",
        status: "completed",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
    }]);

    const evidence = await loadPlanActionEvidence(root, "plan-demo");

    assertEquals(evidence.kind, "recovery_required");
});

Deno.test("live execution Plan owns action evidence when the primary copy is stale", async () => {
    const { root } = await makeProject();
    const executionRoot = await Deno.makeTempDir({ prefix: "runwield-plan-action-execution-" });
    await savePlan(executionRoot, "demo", "# Demo\n\nImplemented\n", {
        planId: "plan-demo",
        status: "implemented",
        classification: "FEATURE",
        executionMode: "worktree",
        worktreeId: "attempt-one",
        worktreePath: executionRoot,
        worktreeBranch: "rw/demo-1",
        worktreeBaseBranch: "main",
        worktreeStatus: "completed",
    });
    await writeRegistry(root, [{
        id: "attempt-one",
        planName: "demo",
        planId: "plan-demo",
        baseBranch: "main",
        baseRef: "refs/heads/main",
        baseCommit: "111",
        branch: "rw/demo-1",
        path: executionRoot,
        status: "completed",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
    }]);

    const evidence = await loadPlanActionEvidence(root, "plan-demo");

    assertEquals(evidence.kind, "success");
    if (evidence.kind === "success") {
        assertEquals(evidence.evidence.status, "implemented");
        assertEquals(evidence.evidence.worktree.kind, "attempt");
        const action = await executePlanAction(root, {
            planId: "plan-demo",
            expectedRevision: evidence.evidence.revision,
            expectedStatus: evidence.evidence.status,
            expectedWorktree: evidence.evidence.worktree,
            action: "put_on_hold",
            holdReason: "pause the execution attempt",
        });
        assertEquals(action.kind, "success");
        assertEquals((await loadPlan(executionRoot, "demo"))?.attrs.status, "on_hold");
        assertEquals((await loadPlan(root, "demo"))?.attrs.status, "draft");
    }
});

Deno.test("rejects ambiguous registry integrity issues before lifecycle mutation", async () => {
    const { root } = await makeProject();
    const evidence = await loadPlanActionEvidence(root, "plan-demo");
    if (evidence.kind !== "success") throw new Error(evidence.message);
    await writeRegistry(root, [
        {
            id: "duplicate",
            planName: "demo",
            planId: "plan-demo",
            baseBranch: "main",
            baseRef: "main",
            baseCommit: "111",
            branch: "rw/demo-1",
            path: "redacted",
            status: "merged",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
        },
        {
            id: "duplicate",
            planName: "other",
            planId: "plan-other",
            baseBranch: "main",
            baseRef: "main",
            baseCommit: "222",
            branch: "rw/other",
            path: "redacted",
            status: "merged",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
        },
    ]);

    const result = await executePlanAction(root, {
        planId: "plan-demo",
        expectedRevision: evidence.evidence.revision,
        expectedStatus: evidence.evidence.status,
        expectedWorktree: evidence.evidence.worktree,
        action: "put_on_hold",
    });

    assertEquals(result.kind, "recovery_required");
    const current = await loadPlan(root, "demo");
    assertEquals(current?.attrs.status, "draft");
});
