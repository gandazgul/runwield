import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { buildPlanEventUpdates, isEpicPlan, isExecutablePlanStatus, recordPlanEvent } from "./plan-lifecycle.js";

Deno.test("buildPlanEventUpdates promotes approved plans to ready_for_work", () => {
    const updates = buildPlanEventUpdates("readiness_passed", "approved", {
        now: () => new Date("2026-01-02T03:04:05.000Z"),
    });

    assertEquals(updates.status, "ready_for_work");
    assertEquals(updates.updatedAt, "2026-01-02T03:04:05.000Z");
    assertEquals(updates.failureReason, null);
});

Deno.test("buildPlanEventUpdates marks approved Epics ready for decomposition", () => {
    const updates = buildPlanEventUpdates("epic_readiness_passed", "approved", {
        now: () => new Date("2026-01-02T03:04:05.000Z"),
    });

    assertEquals(updates.status, "ready_for_decomposition");
    assertEquals(updates.updatedAt, "2026-01-02T03:04:05.000Z");
    assertEquals(updates.failureReason, null);
});

Deno.test("buildPlanEventUpdates captures execution baseline when work starts", () => {
    const updates = buildPlanEventUpdates("execution_started", "ready_for_work", {
        executionBaselineTree: "abc123",
        now: () => new Date("2026-01-02T03:04:05.000Z"),
    });

    assertEquals(updates.status, "in_progress");
    assertEquals(updates.executionBaselineTree, "abc123");
    assertEquals(updates.worktreeStatus, "active");
    assertEquals(updates.implementedAt, null);
});

Deno.test("buildPlanEventUpdates records worktree metadata when execution starts", () => {
    const updates = buildPlanEventUpdates("execution_started", "ready_for_work", {
        executionBaselineTree: "abc123",
        worktreeId: "wt-1",
        worktreePath: "/tmp/repo-harns-plan-wt-1",
        worktreeBranch: "harns/worktree/plan-wt-1",
    });

    assertEquals(updates.worktreeId, "wt-1");
    assertEquals(updates.worktreePath, "/tmp/repo-harns-plan-wt-1");
    assertEquals(updates.worktreeBranch, "harns/worktree/plan-wt-1");
    assertEquals(updates.worktreeStatus, "active");
});

Deno.test("buildPlanEventUpdates keeps implemented status when validation fails", () => {
    const updates = buildPlanEventUpdates("validation_failed", "implemented", {
        failureReason: "CI failed",
    });

    assertEquals(updates.status, "implemented");
    assertEquals(updates.worktreeStatus, "validation_failed");
    assertEquals(updates.failureReason, "CI failed");
});

Deno.test("buildPlanEventUpdates tracks implementation and merge worktree statuses", () => {
    assertEquals(
        buildPlanEventUpdates("implementation_finished", "in_progress").worktreeStatus,
        "completed",
    );
    assertEquals(
        buildPlanEventUpdates("execution_failed", "in_progress").worktreeStatus,
        "execution_failed",
    );
    assertEquals(
        buildPlanEventUpdates("worktree_merge_failed", "implemented").worktreeStatus,
        "merge_conflict",
    );
    assertEquals(
        buildPlanEventUpdates("validation_passed", "implemented", { cleanupMergedWorktrees: false }).worktreeStatus,
        "merged",
    );
    const passed = buildPlanEventUpdates("validation_passed", "implemented");
    assertEquals(passed.executionBaselineTree, null);
    assertEquals(passed.worktreeId, null);
    assertEquals(passed.worktreePath, null);
    assertEquals(passed.worktreeBranch, null);
    assertEquals(passed.worktreeStatus, null);

    const retained = buildPlanEventUpdates("validation_passed", "implemented", {
        cleanupMergedWorktrees: false,
    });
    assertEquals(retained.executionBaselineTree, undefined);
    assertEquals(retained.worktreeId, undefined);
    assertEquals(retained.worktreePath, undefined);
    assertEquals(retained.worktreeBranch, undefined);
    assertEquals(retained.worktreeStatus, "merged");
});

Deno.test("buildPlanEventUpdates records continue recovery as ready_for_work", () => {
    const updates = buildPlanEventUpdates("recovery_continue", "failed", {
        now: () => new Date("2026-01-02T03:04:05.000Z"),
    });

    assertEquals(updates.status, "ready_for_work");
    assertEquals(updates.failureReason, null);
    assertEquals(updates.failedAt, null);
});

Deno.test("buildPlanEventUpdates marks Epics done enough as verified with metadata", () => {
    const updates = buildPlanEventUpdates("epic_done_enough", "ready_for_work", {
        triageMeta: { classification: "PROJECT", type: "epic" },
        now: () => new Date("2026-06-17T00:00:00.000Z"),
        epicDoneEnoughSummary: "Done enough: 1/2 verified.",
    });

    assertEquals(updates.status, "verified");
    assertEquals(updates.verifiedAt, "2026-06-17T00:00:00.000Z");
    assertEquals(updates.epicCompletionMode, "done_enough");
    assertEquals(updates.epicDoneEnoughAt, "2026-06-17T00:00:00.000Z");
    assertEquals(updates.epicDoneEnoughSummary, "Done enough: 1/2 verified.");
    assertEquals(updates.failureReason, null);
    assertEquals(updates.failedAt, null);
});

Deno.test("buildPlanEventUpdates only allows documented transitions", () => {
    assertThrows(
        () => buildPlanEventUpdates("execution_started", "approved"),
        Error,
        'execution_started cannot apply to status "approved"',
    );
    assertThrows(
        () => buildPlanEventUpdates("epic_done_enough", "approved"),
        Error,
        'epic_done_enough cannot apply to status "approved"',
    );
});

Deno.test("buildPlanEventUpdates only marks PROJECT Epic plans done enough", () => {
    assertThrows(
        () =>
            buildPlanEventUpdates("epic_done_enough", "ready_for_work", {
                triageMeta: { classification: "FEATURE" },
            }),
        Error,
        "epic_done_enough can only apply to PROJECT Epic plans",
    );
});

Deno.test("isExecutablePlanStatus only accepts ready_for_work", () => {
    assertEquals(isExecutablePlanStatus("ready_for_work"), true);
    assertEquals(isExecutablePlanStatus("ready_for_decomposition"), false);
    assertEquals(isExecutablePlanStatus("approved"), false);
    assertEquals(isExecutablePlanStatus("implemented"), false);
});

Deno.test("isEpicPlan detects PROJECT plans with epic type", () => {
    assertEquals(isEpicPlan({ classification: "PROJECT", type: "epic" }), true);
    assertEquals(isEpicPlan({ classification: "PROJECT" }), false);
    assertEquals(isEpicPlan({ classification: "FEATURE", type: "epic" }), false);
    assertEquals(isEpicPlan(undefined), false);
});

Deno.test("recordPlanEvent rejects invalid transitions before writing", async () => {
    await assertRejects(
        () =>
            recordPlanEvent({
                cwd: "/tmp",
                planName: "missing",
                event: "validation_passed",
                currentStatus: "approved",
            }),
        Error,
        'validation_passed cannot apply to status "approved"',
    );
});
