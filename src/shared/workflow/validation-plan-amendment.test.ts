import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { loadPlan, savePlan } from "../../plan-store.js";
import { stageValidationPassedInExecutionWorktree } from "./plan-lifecycle.js";
import { applyValidationPlanAmendment, detectValidationPlanAmendment } from "./validation-plan-amendment.ts";

Deno.test("approved Plan definition amendment changes only the execution Plan", async () => {
    const projectRoot = await Deno.makeTempDir();
    const executionCwd = await Deno.makeTempDir();
    try {
        await savePlan(projectRoot, "feature", "# Primary body", {
            planId: "plan-1",
            classification: "PLANNED_CHANGE",
            status: "implemented",
            summary: "Primary",
            worktreeId: "runwield-owned",
        });
        await savePlan(executionCwd, "feature", "# Accepted body", {
            planId: "plan-1",
            classification: "PLANNED_CHANGE",
            status: "implemented",
            summary: "Worktree",
            worktreeId: "tampered",
        });
        const proposal = await detectValidationPlanAmendment(projectRoot, executionCwd, "feature");
        assertStringIncludes(proposal?.summary || "", "Plan amendment");
        if (!proposal) throw new Error("expected amendment proposal");
        await applyValidationPlanAmendment(projectRoot, executionCwd, "feature", proposal);
        const primary = await loadPlan(projectRoot, "feature");
        const execution = await loadPlan(executionCwd, "feature");
        assertEquals(primary?.body, "# Primary body");
        assertEquals(primary?.attrs.summary, "Primary");
        assertEquals(primary?.attrs.worktreeId, "runwield-owned");
        assertEquals(execution?.body, "# Accepted body");
        assertEquals(execution?.attrs.summary, "Worktree");
        assertEquals(execution?.attrs.worktreeId, "tampered");
    } finally {
        await Deno.remove(projectRoot, { recursive: true }).catch(() => undefined);
        await Deno.remove(executionCwd, { recursive: true }).catch(() => undefined);
    }
});

Deno.test("missing execution Plan fails closed instead of being ignored", async () => {
    const projectRoot = await Deno.makeTempDir();
    const executionCwd = await Deno.makeTempDir();
    try {
        await savePlan(projectRoot, "feature", "# Primary body", {
            planId: "plan-1",
            classification: "PLANNED_CHANGE",
            status: "implemented",
            summary: "Primary",
        });
        await assertRejects(
            () => detectValidationPlanAmendment(projectRoot, executionCwd, "feature"),
            Error,
            "Execution-worktree Plan is missing and validation cannot safely continue",
        );
    } finally {
        await Deno.remove(projectRoot, { recursive: true }).catch(() => undefined);
        await Deno.remove(executionCwd, { recursive: true }).catch(() => undefined);
    }
});

Deno.test("execution Plan without matching identity fails closed", async () => {
    const projectRoot = await Deno.makeTempDir();
    const executionCwd = await Deno.makeTempDir();
    try {
        await savePlan(projectRoot, "feature", "# Primary body", {
            planId: "plan-1",
            classification: "PLANNED_CHANGE",
            status: "implemented",
            summary: "Primary",
        });
        await savePlan(executionCwd, "feature", "# Changed body", {
            classification: "PLANNED_CHANGE",
            status: "implemented",
            summary: "Worktree",
        });
        await assertRejects(
            () => detectValidationPlanAmendment(projectRoot, executionCwd, "feature"),
            Error,
            "Execution-worktree Plan identity is missing for feature",
        );
    } finally {
        await Deno.remove(projectRoot, { recursive: true }).catch(() => undefined);
        await Deno.remove(executionCwd, { recursive: true }).catch(() => undefined);
    }
});

Deno.test("publication preserves an accepted execution Plan definition amendment", async () => {
    const projectRoot = await Deno.makeTempDir();
    const executionCwd = await Deno.makeTempDir();
    try {
        await savePlan(projectRoot, "feature", "# Old", {
            planId: "plan-1",
            classification: "PLANNED_CHANGE",
            status: "validated_reviewer",
            summary: "Old",
        });
        await savePlan(executionCwd, "feature", "# New", {
            planId: "plan-1",
            classification: "PLANNED_CHANGE",
            status: "validated_reviewer",
            summary: "New",
        });
        const proposal = await detectValidationPlanAmendment(projectRoot, executionCwd, "feature");
        if (!proposal) throw new Error("expected proposal");
        await applyValidationPlanAmendment(projectRoot, executionCwd, "feature", proposal);
        await stageValidationPassedInExecutionWorktree({
            projectRoot,
            executionCwd,
            planName: "feature",
            details: { executionMode: "non_git_in_place", deliveryEvidence: { version: 1, mode: "non_git_in_place" } },
        });
        const staged = await loadPlan(executionCwd, "feature");
        assertEquals(staged?.body, "# New");
        assertEquals(staged?.attrs.summary, "New");
        assertEquals(staged?.attrs.status, "validated");
    } finally {
        await Deno.remove(projectRoot, { recursive: true }).catch(() => undefined);
        await Deno.remove(executionCwd, { recursive: true }).catch(() => undefined);
    }
});
