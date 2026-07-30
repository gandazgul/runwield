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
    createExecutionWorktree,
    deleteMergedWorktreeBranch,
    mergeExecutionWorktree,
    prepareTargetBranchRef,
    removeWorktreeGitArtifacts,
} from "./worktree.js";

import { git, makeRepo } from "./worktree-test-helpers.js";

Deno.test("worktree helpers report Git requirement outside Git", async () => {
    const projectRoot = await Deno.makeTempDir({ prefix: "runwield-non-git-worktree-" });
    try {
        await assertRejects(
            () =>
                createExecutionWorktree({
                    allowRegistryMutation: "legacy-test-only",
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
    /** @type {Awaited<ReturnType<typeof createExecutionWorktree>> | undefined} */
    let worktree;
    try {
        await savePlanForTest(projectRoot, "feature", "# Feature", { status: "ready_for_work" });
        await git(projectRoot, ["add", "plans/feature.md"]);
        await git(projectRoot, ["commit", "-m", "add feature plan"]);
        worktree = await createExecutionWorktree({
            allowRegistryMutation: "legacy-test-only",
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
        await Deno.mkdir(`${activeWorktree.path}/.wld`, { recursive: true });
        await Deno.writeTextFile(`${activeWorktree.path}/.wld/worktrees.json`, "{}\n");

        await assertRejects(
            () =>
                mergeExecutionWorktree({
                    projectRoot,
                    branch: activeWorktree.branch,
                    targetBranch: "main",
                    worktreePath: activeWorktree.path,
                    preservePlanPaths: ["plans/feature.md"],
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

        const kept = await deleteMergedWorktreeBranch({ projectRoot, branch: "runwield/worktree/unmerged" });
        assertEquals(kept.deleted, false);
        assertStringIncludes(kept.reason, "not proven merged");
        assertStringIncludes(
            await git(projectRoot, ["branch", "--list", "runwield/worktree/unmerged"]),
            "runwield/worktree/unmerged",
            "an unproven branch survives, per PR-4",
        );
    } finally {
        await Deno.remove(projectRoot, { recursive: true }).catch(() => {});
    }
});
