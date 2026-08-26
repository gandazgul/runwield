import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { loadPlan, savePlan } from "../../plan-store.js";
import { defineCommittedGitFixture, git } from "../git-test-fixture.ts";
import { addEntry } from "../worktree-registry.js";
import { stageValidationPassedInExecutionWorktree } from "./plan-lifecycle.js";
import { applyValidationPlanAmendment, detectValidationPlanAmendment } from "./validation-plan-amendment.ts";

const amendmentRepo = defineCommittedGitFixture({ ".gitignore": ".wld/\n", "app.ts": "export {};\n" });

Deno.test("approved Plan definition amendment changes only the execution Plan", async () => {
    const projectRoot = await amendmentRepo.checkout();
    const executionCwd = await Deno.makeTempDir();
    try {
        await savePlan(projectRoot, "feature", "# Primary body\n\n## Context\n\nPrimary", {
            planId: "plan-1",
            classification: "PLANNED_CHANGE",
            status: "implemented",
            summary: "Primary",
        });
        await git(projectRoot, ["worktree", "add", "-b", "worktree/feature", executionCwd]);
        await addEntry(projectRoot, {
            id: "runwield-owned",
            planId: "plan-1",
            planName: "feature",
            branch: "worktree/feature",
            path: executionCwd,
            baseBranch: "main",
            baseRef: "refs/heads/main",
            baseCommit: await git(projectRoot, ["rev-parse", "HEAD"]),
            status: "completed",
            createdAt: "2026-08-25T00:00:00Z",
            updatedAt: "2026-08-25T00:00:00Z",
        });
        await savePlan(executionCwd, "feature", "# Accepted body\n\n## Context\n\nWorktree", {
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
        assertEquals(primary?.body, "# Primary body\n\n## Context\n\nPrimary");
        assertEquals(primary?.attrs.summary, "Primary");
        assertEquals(primary?.attrs.worktreeId, "runwield-owned");
        assertEquals(execution?.body, "# Accepted body\n\n## Context\n\nWorktree");
        assertEquals(execution?.attrs.summary, "Worktree");
        assertEquals(execution?.attrs.worktreeId, "runwield-owned", "document writes cannot retarget attempts");
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
        await savePlan(executionCwd, "feature", "# New\n\n## Context\n\nNew", {
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
        assertEquals(staged?.body, "# New\n\n## Context\n\nNew");
        assertEquals(staged?.attrs.summary, "New");
        assertEquals(staged?.attrs.status, "validated");
    } finally {
        await Deno.remove(projectRoot, { recursive: true }).catch(() => undefined);
        await Deno.remove(executionCwd, { recursive: true }).catch(() => undefined);
    }
});
