import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";

import { loadPlan, savePlan } from "../plan-store.js";

/**
 * @param {string} cwd
 * @param {string} planName
 * @param {string} content
 * @param {import('../plan-store.js').PlanFrontMatterInput} attrs
 */
async function savePlanForTest(cwd, planName, content, attrs) {
    const existing = await loadPlan(cwd, planName).catch(() => null);
    return await savePlan(cwd, planName, content, attrs, existing ? { expectedRevision: existing.revision } : {});
}
import { GitRepositoryRequiredError } from "./git.js";

import {
    checkpointExecutionWorktree,
    deleteMergedWorktreeBranch,
    mergeExecutionWorktree,
    prepareTargetBranchRef,
    removeWorktreeGitArtifacts,
} from "./worktree.js";

import { createTestWorktreeAttempt, git, makeRepo } from "./worktree-test-helpers.js";

Deno.test("worktree helpers report Git requirement outside Git", async () => {
    const projectRoot = await Deno.makeTempDir({ prefix: "runwield-non-git-worktree-" });
    try {
        await assertRejects(
            () =>
                createTestWorktreeAttempt({
                    projectRoot,
                    planName: "Non Git Plan",
                }),
            GitRepositoryRequiredError,
            "Creating an execution worktree requires a Git repository",
        );
        await assertRejects(
            () => prepareTargetBranchRef(projectRoot, "main"),
            GitRepositoryRequiredError,
            "Preparing an execution target branch requires a Git repository",
        );
        await assertRejects(
            () => mergeExecutionWorktree({ projectRoot, branch: "runwield/worktree/non-git" }),
            GitRepositoryRequiredError,
            "Merging an execution worktree requires a Git repository",
        );
        await assertRejects(
            () =>
                removeWorktreeGitArtifacts({
                    projectRoot,
                    path: `${projectRoot}/missing`,
                }),
            GitRepositoryRequiredError,
            "Removing an execution worktree requires a Git repository",
        );
    } finally {
        await Deno.remove(projectRoot, { recursive: true });
    }
});

Deno.test("mergeExecutionWorktree rejects post-seal implementation edits outside finalized Plan paths", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir();
    /** @type {Awaited<ReturnType<typeof createTestWorktreeAttempt>> | undefined} */
    let worktree;
    try {
        await savePlanForTest(projectRoot, "feature", "# Feature", { status: "ready_for_work" });
        await git(projectRoot, ["add", "docs/plans/feature.md"]);
        await git(projectRoot, ["commit", "-m", "add feature plan"]);
        worktree = await createTestWorktreeAttempt({
            projectRoot,
            planName: "Feature",
            worktreeRoot,
        });
        const activeWorktree = worktree;
        await Deno.writeTextFile(`${activeWorktree.path}/feature.txt`, "validated\n");
        const sealed = await checkpointExecutionWorktree({
            worktreePath: activeWorktree.path,
            branch: activeWorktree.branch,
            planName: "feature",
        });
        await savePlanForTest(activeWorktree.path, "feature", "# Feature", { status: "verified" });
        await Deno.writeTextFile(`${activeWorktree.path}/post-seal.txt`, "late edit\n");

        await assertRejects(
            () =>
                mergeExecutionWorktree({
                    projectRoot,
                    branch: activeWorktree.branch,
                    targetBranch: "main",
                    worktreePath: activeWorktree.path,
                    preservePlanPaths: ["docs/plans/feature.md"],
                    sealedExecutionCommit: sealed.executionCommit,
                    planName: "feature",
                }),
            Error,
            "changed after candidate sealing outside finalized Plan paths",
        );
    } finally {
        if (worktree) {
            await removeWorktreeGitArtifacts({
                projectRoot,
                path: worktree.path,
                force: true,
            }).catch(() => {});
        }
        await Deno.remove(projectRoot, { recursive: true }).catch(() => {});
        await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
    }
});

Deno.test("deleteMergedWorktreeBranch deletes a merged branch and keeps an unmerged one", async () => {
    // Real Git on purpose. This is the most destructive operation in the system and it
    // has no injection seam by design, so the only honest proof is running it. A fake
    // here would assert our assumption about `branch --merged`, not Git's answer.
    const projectRoot = await Deno.makeTempDir({ prefix: "runwield-branch-delete-" });
    try {
        await git(projectRoot, ["init", "-b", "main"]);
        await git(projectRoot, ["config", "user.email", "tests@example.com"]);
        await git(projectRoot, ["config", "user.name", "RunWield Tests"]);
        await Deno.writeTextFile(`${projectRoot}/file.txt`, "base\n");
        await git(projectRoot, ["add", "."]);
        await git(projectRoot, ["commit", "-m", "base"]);

        // Merged: branched and merged back, so nothing is lost by deleting it.
        await git(projectRoot, ["checkout", "-b", "runwield/worktree/merged"]);
        await Deno.writeTextFile(`${projectRoot}/file.txt`, "merged work\n");
        await git(projectRoot, ["commit", "-am", "merged work"]);
        await git(projectRoot, ["checkout", "main"]);
        await git(projectRoot, ["merge", "--no-ff", "--no-edit", "runwield/worktree/merged"]);

        const merged = await deleteMergedWorktreeBranch({ projectRoot, branch: "runwield/worktree/merged" });
        assertEquals(merged.deleted, true);
        assertStringIncludes(merged.reason, "deleted");
        assertEquals(
            (await git(projectRoot, ["branch", "--list", "runwield/worktree/merged"])).trim(),
            "",
            "a proven-merged branch is gone",
        );

        // Unmerged: holds a commit main has never seen. Deleting it would destroy work.
        await git(projectRoot, ["checkout", "-b", "runwield/worktree/unmerged"]);
        await Deno.writeTextFile(`${projectRoot}/file.txt`, "unmerged work\n");
        await git(projectRoot, ["commit", "-am", "unmerged work"]);
        await git(projectRoot, ["checkout", "main"]);

        // A branch that never moved off its base carries no work, so rollback can clean it
        // up. This is the case that used to leave an orphan branch behind forever.
        const baseCommit = await git(projectRoot, ["rev-parse", "main"]);
        await git(projectRoot, ["branch", "runwield/worktree/untouched", baseCommit]);
        const untouched = await deleteMergedWorktreeBranch({
            projectRoot,
            branch: "runwield/worktree/untouched",
            baseCommit,
        });
        assertEquals(untouched.deleted, true);
        assertStringIncludes(untouched.reason, "carried no work");

        await git(projectRoot, ["checkout", "-b", "runwield/worktree/prepared", baseCommit]);
        await Deno.writeTextFile(`${projectRoot}/prepared-plan.md`, "RunWield preparation\n");
        await git(projectRoot, ["add", "prepared-plan.md"]);
        await git(projectRoot, ["commit", "-m", "Prepare execution"]);
        const ownedPreparationCommit = await git(projectRoot, ["rev-parse", "HEAD"]);
        await git(projectRoot, ["checkout", "main"]);
        const prepared = await deleteMergedWorktreeBranch({
            projectRoot,
            branch: "runwield/worktree/prepared",
            baseCommit,
            ownedPreparationCommit,
        });
        assertEquals(prepared.deleted, true);
        assertStringIncludes(prepared.reason, "preparation commit");

        const kept = await deleteMergedWorktreeBranch({ projectRoot, branch: "runwield/worktree/unmerged" });
        assertEquals(kept.deleted, false);
        assertStringIncludes(kept.reason, "not proven merged");
        assertStringIncludes(
            await git(projectRoot, ["branch", "--list", "runwield/worktree/unmerged"]),
            "runwield/worktree/unmerged",
            "an unproven branch survives, per PR-4",
        );

        // The origin proof must not become a loophole: a branch that moved off its base
        // holds work, even when a stale base commit is offered.
        const stillKept = await deleteMergedWorktreeBranch({
            projectRoot,
            branch: "runwield/worktree/unmerged",
            baseCommit,
        });
        assertEquals(stillKept.deleted, false, "a branch with commits beyond its base survives");
    } finally {
        await Deno.remove(projectRoot, { recursive: true }).catch(() => {});
    }
});
