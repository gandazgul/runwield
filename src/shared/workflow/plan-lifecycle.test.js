import { assertEquals, assertRejects, assertStringIncludes, assertThrows } from "@std/assert";
import {
    buildPlanEventUpdates,
    getAllowedManualPlanStatuses,
    getPlanLifecycleActionMetadata,
    isEpicPlan,
    isExecutablePlanStatus,
    isManualBoardStatusChangeAllowed,
    recordPlanEvent,
} from "./plan-lifecycle.js";
import { loadPlan, savePlan } from "../../plan-store.js";
import { COLLABORATION_STATE_REMOTE_CANONICAL, SharedPlanLockError } from "../collaboration/lock.js";

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

Deno.test("buildPlanEventUpdates omits worktree metadata for non-Git in-place execution", () => {
    const updates = buildPlanEventUpdates("execution_started", "ready_for_work", {
        nonGitInPlace: true,
        executionBaselineTree: "abc123",
        worktreeId: "wt-1",
        worktreeStatus: "active",
    });

    assertEquals(updates.status, "in_progress");
    assertEquals(updates.executionBaselineTree, null);
    assertEquals(updates.worktreeId, null);
    assertEquals(updates.worktreeStatus, null);
});

Deno.test("buildPlanEventUpdates records worktree metadata when execution starts", () => {
    const updates = buildPlanEventUpdates("execution_started", "ready_for_work", {
        executionBaselineTree: "abc123",
        worktreeId: "wt-1",
        worktreePath: "/tmp/repo-runwield-plan-wt-1",
        worktreeBranch: "runwield/worktree/plan-wt-1",
        worktreeBaseBranch: "feature-base",
    });

    assertEquals(updates.worktreeId, "wt-1");
    assertEquals(updates.worktreePath, "/tmp/repo-runwield-plan-wt-1");
    assertEquals(updates.worktreeBranch, "runwield/worktree/plan-wt-1");
    assertEquals(updates.worktreeBaseBranch, "feature-base");
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

Deno.test("buildPlanEventUpdates retains recovered worktree branches when merge-back fails", () => {
    const updates = buildPlanEventUpdates("worktree_merge_failed", "implemented", {
        triageMeta: { worktreeId: "wt-1" },
        failureReason: "conflict",
        worktreePath: "/tmp/repo-runwield-plan-wt-1",
        worktreeBranch: "runwield/worktree/plan-wt-1",
        worktreeBaseBranch: "feature-base",
    });

    assertEquals(updates.worktreePath, "/tmp/repo-runwield-plan-wt-1");
    assertEquals(updates.worktreeBranch, "runwield/worktree/plan-wt-1");
    assertEquals(updates.worktreeBaseBranch, "feature-base");
    assertEquals(updates.worktreeStatus, "merge_conflict");
    assertEquals(updates.failureReason, "conflict");
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
    assertEquals(passed.worktreeBaseBranch, null);
    assertEquals(passed.worktreeStatus, null);

    const retained = buildPlanEventUpdates("validation_passed", "implemented", {
        cleanupMergedWorktrees: false,
    });
    assertEquals(retained.executionBaselineTree, undefined);
    assertEquals(retained.worktreeId, undefined);
    assertEquals(retained.worktreePath, undefined);
    assertEquals(retained.worktreeBranch, undefined);
    assertEquals(retained.worktreeBaseBranch, undefined);
    assertEquals(retained.worktreeStatus, "merged");
});

Deno.test("buildPlanEventUpdates records and clears human review metadata", () => {
    const passed = buildPlanEventUpdates("validation_passed", "implemented", {
        humanReviewMode: "always",
        humanReviewDecision: "approved",
        humanReviewedAt: "2026-06-23T12:00:00.000Z",
    });
    assertEquals(passed.humanReviewMode, "always");
    assertEquals(passed.humanReviewDecision, "approved");
    assertEquals(passed.humanReviewedAt, "2026-06-23T12:00:00.000Z");

    const started = buildPlanEventUpdates("execution_started", "ready_for_work");
    assertEquals(started.humanReviewMode, null);
    assertEquals(started.humanReviewDecision, null);
    assertEquals(started.humanReviewedAt, null);

    const reset = buildPlanEventUpdates("recovery_reset", "implemented");
    assertEquals(reset.humanReviewMode, null);
    assertEquals(reset.humanReviewDecision, null);
    assertEquals(reset.humanReviewedAt, null);

    const reopened = buildPlanEventUpdates("review_reopened", "verified");
    assertEquals(reopened.humanReviewMode, null);
    assertEquals(reopened.humanReviewDecision, null);
    assertEquals(reopened.humanReviewedAt, null);
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

Deno.test("buildPlanEventUpdates allows manual board movement only within safe statuses", () => {
    const updates = buildPlanEventUpdates("manual_status_change", "implemented", {
        manualTargetStatus: "ready_for_work",
        now: () => new Date("2026-01-02T03:04:05.000Z"),
    });

    assertEquals(updates.status, "ready_for_work");
    assertEquals(updates.updatedAt, "2026-01-02T03:04:05.000Z");
    assertEquals(updates.implementedAt, null);
    assertEquals(updates.verifiedAt, null);
    assertEquals(updates.failureReason, undefined);
    assertEquals(updates.worktreeId, undefined);
});

Deno.test("manual board movement preserves implemented validation and review context", () => {
    const updates = buildPlanEventUpdates("manual_status_change", "implemented", {
        manualTargetStatus: "implemented",
        triageMeta: {
            failureReason: "Workflow Validation failed.",
            worktreeStatus: "validation_failed",
            humanReviewMode: "ask",
            humanReviewDecision: "skipped",
            humanReviewedAt: "2026-01-02T03:04:05.000Z",
        },
    });

    assertEquals(updates.status, "implemented");
    assertEquals(updates.failureReason, "Workflow Validation failed.");
    assertEquals(updates.worktreeStatus, "validation_failed");
    assertEquals(updates.humanReviewMode, "ask");
    assertEquals(updates.humanReviewDecision, "skipped");
    assertEquals(updates.humanReviewedAt, "2026-01-02T03:04:05.000Z");
    assertEquals(updates.verifiedAt, undefined);
});

Deno.test("manual board movement clears stale completion metadata when moving before implemented", () => {
    const updates = buildPlanEventUpdates("manual_status_change", "implemented", {
        manualTargetStatus: "approved",
        triageMeta: {
            implementedAt: "2026-01-02T03:04:05.000Z",
            verifiedAt: "2026-01-03T03:04:05.000Z",
            humanReviewMode: "ask",
            humanReviewDecision: "approved",
            humanReviewedAt: "2026-01-03T03:04:05.000Z",
            failureReason: "Stale failure reason.",
            failedAt: "2026-01-01T03:04:05.000Z",
        },
    });

    assertEquals(updates.status, "approved");
    assertEquals(updates.implementedAt, null);
    assertEquals(updates.verifiedAt, null);
    assertEquals(updates.humanReviewMode, null);
    assertEquals(updates.humanReviewDecision, null);
    assertEquals(updates.humanReviewedAt, null);
    assertEquals(updates.failureReason, null);
    assertEquals(updates.failedAt, null);
});

Deno.test("manual board movement preserves recovery context for retry statuses", () => {
    const updates = buildPlanEventUpdates("manual_status_change", "implemented", {
        manualTargetStatus: "ready_for_work",
        triageMeta: {
            failureReason: "Workflow Validation failed.",
            worktreeStatus: "validation_failed",
            worktreeId: "wt-1",
            worktreePath: "/tmp/wt-1",
            worktreeBranch: "runwield/wt-1",
        },
    });

    assertEquals(updates.status, "ready_for_work");
    assertEquals(updates.failureReason, "Workflow Validation failed.");
    assertEquals(updates.worktreeStatus, "validation_failed");
    assertEquals(updates.worktreeId, "wt-1");
    assertEquals(updates.worktreePath, "/tmp/wt-1");
    assertEquals(updates.worktreeBranch, "runwield/wt-1");
});

Deno.test("manual board movement allows ready_for_decomposition only for Epic plans", () => {
    assertEquals(
        buildPlanEventUpdates("manual_status_change", "approved", {
            manualTargetStatus: "ready_for_decomposition",
            triageMeta: { classification: "PROJECT", type: "epic" },
        }).status,
        "ready_for_decomposition",
    );

    assertThrows(
        () =>
            buildPlanEventUpdates("manual_status_change", "approved", {
                manualTargetStatus: "ready_for_decomposition",
                triageMeta: { classification: "FEATURE" },
            }),
        Error,
        'manual_status_change cannot move from "approved" to "ready_for_decomposition"',
    );
});

Deno.test("manual board movement blocks protected and terminal shortcuts", () => {
    assertThrows(
        () => buildPlanEventUpdates("manual_status_change", "approved", {}),
        Error,
        "manual_status_change requires manualTargetStatus",
    );
    assertThrows(
        () => buildPlanEventUpdates("manual_status_change", "implemented", { manualTargetStatus: "verified" }),
        Error,
        'manual_status_change cannot move from "implemented" to "verified"',
    );
    assertThrows(
        () => buildPlanEventUpdates("manual_status_change", "ready_for_work", { manualTargetStatus: "failed" }),
        Error,
        'manual_status_change cannot move from "ready_for_work" to "failed"',
    );
    assertThrows(
        () => buildPlanEventUpdates("manual_status_change", "failed", { manualTargetStatus: "ready_for_work" }),
        Error,
        'manual_status_change cannot move from "failed" to "ready_for_work"',
    );
    assertThrows(
        () => buildPlanEventUpdates("manual_status_change", "on_hold", { manualTargetStatus: "approved" }),
        Error,
        'manual_status_change cannot move from "on_hold" to "approved"',
    );
    assertThrows(
        () =>
            buildPlanEventUpdates("manual_status_change", "ready_for_work", {
                manualTargetStatus: "closed_without_verification",
            }),
        Error,
        'manual_status_change cannot move from "ready_for_work" to "closed_without_verification"',
    );
});

Deno.test("manual closure is terminal and does not pretend validation passed", () => {
    const updates = buildPlanEventUpdates("manual_closed_without_verification", "implemented", {
        now: () => new Date("2026-01-02T03:04:05.000Z"),
    });

    assertEquals(updates.status, "closed_without_verification");
    assertEquals(updates.updatedAt, "2026-01-02T03:04:05.000Z");
    assertEquals(updates.verifiedAt, undefined);
    assertEquals(updates.humanReviewDecision, undefined);
    assertEquals(updates.epicCompletionMode, undefined);

    assertThrows(
        () => buildPlanEventUpdates("manual_closed_without_verification", "verified"),
        Error,
        'manual_closed_without_verification cannot apply to status "verified"',
    );
});

Deno.test("hold events create, resume, and reset hold metadata", () => {
    const held = buildPlanEventUpdates("plan_held", "failed", {
        now: () => new Date("2026-01-02T03:04:05.000Z"),
        holdReason: "priority shifted",
        holdStalenessBaseline: "2026-01-01T00:00:00.000Z",
    });
    assertEquals(held.status, "on_hold");
    assertEquals(held.heldFromStatus, "failed");
    assertEquals(held.heldAt, "2026-01-02T03:04:05.000Z");
    assertEquals(held.holdReason, "priority shifted");
    assertEquals(held.holdStalenessBaseline, "2026-01-01T00:00:00.000Z");

    const resumed = buildPlanEventUpdates("hold_resumed", "on_hold", { heldFromStatus: "failed" });
    assertEquals(resumed.status, "failed");
    assertEquals(resumed.heldFromStatus, null);
    assertEquals(resumed.heldAt, null);
    assertEquals(resumed.holdReason, null);
    assertEquals(resumed.holdStalenessBaseline, null);

    const reset = buildPlanEventUpdates("hold_reset_to_draft", "on_hold");
    assertEquals(reset.status, "draft");
    assertEquals(reset.worktreeId, null);
    assertEquals(reset.worktreePath, null);
    assertEquals(reset.worktreeBranch, null);
    assertEquals(reset.worktreeStatus, null);
    assertEquals(reset.executionBaselineTree, null);
    assertEquals(reset.failureReason, null);
    assertEquals(reset.failedAt, null);
    assertEquals(reset.implementedAt, null);
    assertEquals(reset.verifiedAt, null);
    assertEquals(reset.humanReviewMode, null);
    assertEquals(reset.humanReviewDecision, null);
    assertEquals(reset.humanReviewedAt, null);
});

Deno.test("hold blocks terminal statuses and resume requires held-from status", () => {
    assertThrows(
        () => buildPlanEventUpdates("plan_held", "verified"),
        Error,
        'plan_held cannot apply to status "verified"',
    );
    assertThrows(
        () => buildPlanEventUpdates("plan_held", "closed_without_verification"),
        Error,
        'plan_held cannot apply to status "closed_without_verification"',
    );
    assertThrows(
        () => buildPlanEventUpdates("hold_resumed", "on_hold"),
        Error,
        "hold_resumed requires heldFromStatus",
    );
    assertThrows(
        () => buildPlanEventUpdates("hold_resumed", "on_hold", { heldFromStatus: "verified" }),
        Error,
        'hold_resumed cannot restore terminal/protected status "verified"',
    );
});

Deno.test("manual board helper exports expose lifecycle-owned rules", () => {
    assertEquals(getAllowedManualPlanStatuses("approved"), [
        "draft",
        "feedback",
        "approved",
        "ready_for_work",
        "in_progress",
        "implemented",
    ]);
    assertEquals(getAllowedManualPlanStatuses("approved", { classification: "PROJECT", type: "epic" }), [
        "draft",
        "feedback",
        "approved",
        "ready_for_work",
        "in_progress",
        "implemented",
        "ready_for_decomposition",
    ]);
    assertEquals(getAllowedManualPlanStatuses("failed"), []);
    assertEquals(isManualBoardStatusChangeAllowed("approved", "implemented"), true);
    assertEquals(isManualBoardStatusChangeAllowed("approved", "verified"), false);
    assertEquals(
        isManualBoardStatusChangeAllowed("approved", "ready_for_decomposition", {
            classification: "PROJECT",
            type: "epic",
        }),
        true,
    );
});

Deno.test("recordPlanEvent mutates only the selected held plan file", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await Deno.mkdir(`${cwd}/plans/epic`, { recursive: true });
        await Deno.writeTextFile(
            `${cwd}/plans/epic.md`,
            [
                "---",
                'classification: "PROJECT"',
                'complexity: "HIGH"',
                'summary: "Epic"',
                "affectedPaths:",
                "  []",
                'createdAt: "2026-01-01T00:00:00.000Z"',
                'status: "ready_for_work"',
                'type: "epic"',
                "---",
                "# Epic",
            ].join("\n"),
        );
        await Deno.writeTextFile(
            `${cwd}/plans/epic/child.md`,
            [
                "---",
                'classification: "FEATURE"',
                'complexity: "MEDIUM"',
                'summary: "Child"',
                "affectedPaths:",
                "  []",
                'createdAt: "2026-01-01T00:00:00.000Z"',
                'status: "ready_for_work"',
                'parentPlan: "epic"',
                "---",
                "# Child",
            ].join("\n"),
        );

        await recordPlanEvent({ cwd, planName: "epic", event: "plan_held", currentStatus: "ready_for_work" });
        assertEquals((await Deno.readTextFile(`${cwd}/plans/epic.md`)).includes('status: "on_hold"'), true);
        assertEquals(
            (await Deno.readTextFile(`${cwd}/plans/epic/child.md`)).includes('status: "ready_for_work"'),
            true,
        );

        await recordPlanEvent({ cwd, planName: "epic/child", event: "plan_held", currentStatus: "ready_for_work" });
        assertEquals((await Deno.readTextFile(`${cwd}/plans/epic.md`)).includes('status: "on_hold"'), true);
        assertEquals((await Deno.readTextFile(`${cwd}/plans/epic/child.md`)).includes('status: "on_hold"'), true);
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("recordPlanEvent verifies parent Epic when the final child feature is verified", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "epic", "# Epic", {
            classification: "PROJECT",
            complexity: "HIGH",
            summary: "Epic",
            affectedPaths: [],
            status: "ready_for_work",
            type: "epic",
        });
        await savePlan(cwd, "epic/01-first", "# First", {
            classification: "FEATURE",
            complexity: "MEDIUM",
            summary: "First",
            affectedPaths: [],
            status: "verified",
            parentPlan: "epic",
            order: 1,
        });
        await savePlan(cwd, "epic/02-last", "# Last", {
            classification: "FEATURE",
            complexity: "MEDIUM",
            summary: "Last",
            affectedPaths: [],
            status: "implemented",
            parentPlan: "epic",
            order: 2,
        });

        await recordPlanEvent({
            cwd,
            planName: "epic/02-last",
            event: "validation_passed",
            currentStatus: "implemented",
            details: {
                triageMeta: { classification: "FEATURE", parentPlan: "epic" },
                now: () => new Date("2026-01-02T03:04:05.000Z"),
            },
        });

        const parent = await loadPlan(cwd, "epic");
        const child = await loadPlan(cwd, "epic/02-last");
        assertEquals(child?.attrs.status, "verified");
        assertEquals(parent?.attrs.status, "verified");
        assertEquals(parent?.attrs.verifiedAt, "2026-01-02T03:04:05.000Z");
        assertEquals(parent?.attrs.epicCompletionMode, "done_enough");
        assertEquals(parent?.attrs.epicDoneEnoughSummary, "All 2 child FEATURE plans are verified after epic/02-last.");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("recordPlanEvent keeps parent Epic open while child features remain unverified", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "epic", "# Epic", {
            classification: "PROJECT",
            complexity: "HIGH",
            summary: "Epic",
            affectedPaths: [],
            status: "ready_for_work",
            type: "epic",
        });
        await savePlan(cwd, "epic/01-first", "# First", {
            classification: "FEATURE",
            complexity: "MEDIUM",
            summary: "First",
            affectedPaths: [],
            status: "implemented",
            parentPlan: "epic",
            order: 1,
        });
        await savePlan(cwd, "epic/02-last", "# Last", {
            classification: "FEATURE",
            complexity: "MEDIUM",
            summary: "Last",
            affectedPaths: [],
            status: "implemented",
            parentPlan: "epic",
            order: 2,
        });

        await recordPlanEvent({
            cwd,
            planName: "epic/02-last",
            event: "validation_passed",
            currentStatus: "implemented",
            details: { triageMeta: { classification: "FEATURE", parentPlan: "epic" } },
        });

        const parent = await loadPlan(cwd, "epic");
        assertEquals(parent?.attrs.status, "ready_for_work");
        assertEquals(parent?.attrs.epicCompletionMode, undefined);
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
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

Deno.test("getPlanLifecycleActionMetadata keeps protected states behind dedicated actions", () => {
    const draft = getPlanLifecycleActionMetadata("draft", { classification: "FEATURE" });
    assertEquals(draft.allowedManualTargetStatuses.includes("verified"), false);
    assertEquals(draft.allowedManualTargetStatuses.includes("failed"), false);
    assertEquals(draft.allowedManualTargetStatuses.includes("on_hold"), false);
    assertEquals(draft.canPutOnHold, true);
    assertEquals(draft.canCloseWithoutVerification, true);

    const failed = getPlanLifecycleActionMetadata("failed", { classification: "FEATURE" });
    assertEquals(failed.allowedManualTargetStatuses, []);
    assertEquals(failed.canPutOnHold, true);

    const verified = getPlanLifecycleActionMetadata("verified", { classification: "FEATURE" });
    assertEquals(verified.canPutOnHold, false);
    assertEquals(verified.canCloseWithoutVerification, false);

    const held = getPlanLifecycleActionMetadata("on_hold", {
        classification: "FEATURE",
        heldFromStatus: "ready_for_work",
    });
    assertEquals(held.canResumeFromHold, true);
    assertEquals(held.canResetToDraft, true);
});

Deno.test({
    name: "recordPlanEvent blocks shared Plan lifecycle writes without mutating siblings",
    permissions: { read: true, write: true },
    fn: async () => {
        const cwd = await Deno.makeTempDir();
        try {
            const lockedPath = await savePlan(cwd, "locked", "# Locked", {
                status: "approved",
                collaborationState: COLLABORATION_STATE_REMOTE_CANONICAL,
                collaborationServerUrl: "https://plans.example.test",
                collaborationSpaceId: "space-1",
            });
            const siblingPath = await savePlan(cwd, "sibling", "# Sibling", { status: "approved" });
            const lockedBefore = await Deno.readTextFile(lockedPath);
            const siblingBefore = await Deno.readTextFile(siblingPath);

            const error = await assertRejects(
                () =>
                    recordPlanEvent({
                        cwd,
                        planName: "locked",
                        event: "readiness_passed",
                        currentStatus: "approved",
                    }),
                SharedPlanLockError,
            );
            assertStringIncludes(error.repair, "wld plans pull");
            assertEquals(await Deno.readTextFile(lockedPath), lockedBefore);
            assertEquals(await Deno.readTextFile(siblingPath), siblingBefore);
            assertEquals((await loadPlan(cwd, "sibling"))?.attrs.status, "approved");
        } finally {
            await Deno.remove(cwd, { recursive: true });
        }
    },
});
