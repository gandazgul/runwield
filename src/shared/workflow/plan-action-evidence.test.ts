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
