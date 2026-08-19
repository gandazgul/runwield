/**
 * First half of the repaired-merge publication Golden test.
 *
 * A real detached merge conflict is staged, then this isolated Golden child
 * completes the repair merge and is killed before publication resumes. A second
 * process imports the resume scenario and must publish solely from durable Project
 * state.
 */

import { assert } from "@std/assert";
import { join } from "@std/path";
import { loadPlan, savePlan, updatePlanFrontMatter } from "../../../plan-store.js";
import { mergeExecutionWorktree } from "../../../shared/worktree.js";
import { createTestWorktreeAttempt, git } from "../../../shared/worktree-test-helpers.js";
import { stageValidationPassedInExecutionWorktree } from "../../../shared/workflow/plan-lifecycle.js";

const planName = "repaired-merge";

async function stageInterruptedMergeFixture(): Promise<void> {
    const projectRoot = Deno.cwd();
    await Deno.writeTextFile(join(projectRoot, "golden-repaired-merge.txt"), "base version\n");
    await git(projectRoot, ["add", "golden-repaired-merge.txt"]);
    await git(projectRoot, ["commit", "-m", "Golden repaired merge base"]);
    await savePlan(
        projectRoot,
        planName,
        "# Repaired merge publication\n\nGolden repaired merge restart content.\n",
        {
            classification: "PLANNED_CHANGE",
            status: "validated_reviewer",
            humanReviewMode: "none",
            humanReviewDecision: "not_required",
            summary: "Repaired merge publication",
            affectedPaths: [],
        },
    );
    const initialPlan = await loadPlan(projectRoot, planName);
    assert(initialPlan, "Expected Golden repaired-merge Plan fixture.");
    const worktree = await createTestWorktreeAttempt({
        projectRoot,
        planName,
        planId: initialPlan.attrs.planId,
    });
    const executionPlanPath = join(worktree.path, "docs", "plans", `${planName}.md`);
    await Deno.mkdir(join(worktree.path, "docs", "plans"), { recursive: true });
    await Deno.writeTextFile(executionPlanPath, initialPlan.markdown);
    const targetBranch = worktree.baseBranch || await git(projectRoot, ["branch", "--show-current"]);

    await Deno.writeTextFile(join(worktree.path, "golden-repaired-merge.txt"), "execution version\n");
    await git(worktree.path, ["add", "golden-repaired-merge.txt"]);
    await git(worktree.path, ["commit", "-m", "Golden execution changes target file"]);
    const executionCommit = await git(worktree.path, ["rev-parse", "HEAD"]);

    await Deno.writeTextFile(join(projectRoot, "golden-repaired-merge.txt"), "target version\n");
    await git(projectRoot, ["add", "golden-repaired-merge.txt"]);
    await git(projectRoot, ["commit", "-m", "Golden target advances before publication"]);
    const targetHeadBeforeMerge = await git(projectRoot, ["rev-parse", targetBranch]);
    await git(projectRoot, ["checkout", "-b", "workspace"]);

    const staging = await stageValidationPassedInExecutionWorktree({
        projectRoot,
        executionCwd: worktree.path,
        planName,
        details: {
            executionMode: "worktree",
            deliveryEvidence: {
                version: 1,
                mode: "worktree_merge",
                executionCommit,
                targetBranch,
                targetHeadBeforeMerge,
            },
            worktreeStatus: "merged",
            cleanupMergedWorktrees: true,
            humanReviewMode: "none",
            humanReviewDecision: "not_required",
            humanReviewedAt: null,
        },
    });

    let repairWorktreePath = "";
    try {
        await mergeExecutionWorktree({
            projectRoot,
            branch: worktree.branch,
            targetBranch,
            worktreePath: worktree.path,
            expectedTargetHead: targetHeadBeforeMerge,
            planName,
            planDescription: "Golden repaired merge publication",
            sealedExecutionCommit: executionCommit,
            allowedDirtyPaths: staging.planPaths,
            preservePlanPaths: staging.planPaths,
        });
    } catch (error) {
        if (error && typeof error === "object" && "mergeWorktreePath" in error) {
            const path = error.mergeWorktreePath;
            repairWorktreePath = typeof path === "string" ? path : "";
        }
    }
    assert(repairWorktreePath, "Expected a detached Direct Delivery merge conflict.");
    const planBeforeRepair = await loadPlan(worktree.path, planName);
    assert(planBeforeRepair, "Expected Plan before detached merge repair.");
    await updatePlanFrontMatter(
        worktree.path,
        planName,
        {
            executionMode: "worktree",
            worktreeId: worktree.id,
            worktreePath: worktree.path,
            worktreeBranch: worktree.branch,
            worktreeBaseBranch: targetBranch,
            worktreeStatus: "completed",
            validationMergeRepairWorktree: repairWorktreePath,
        },
        planBeforeRepair.attrs,
        { expectedRevision: planBeforeRepair.revision },
    );
}

await stageInterruptedMergeFixture();

export const repairedMergeInterruptionScenario = {
    name: "planned-change-agent-repairs-merge-before-process-exit",
    composedTui: true,
    initialAgentName: "guide",
    terminal: { columns: 100, rows: 30 },
    timeoutMs: 60000,
    actions: [{
        type: "repairStoredMergeWorktreeAndKill",
        planName,
        path: "golden-repaired-merge.txt",
        text: "repaired version\n",
    }],
};
