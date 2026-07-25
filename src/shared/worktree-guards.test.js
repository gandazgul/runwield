// deno-lint-ignore-file no-unused-vars
import { assertEquals, assertMatch, assertRejects, assertStringIncludes } from "@std/assert";
import { basename, dirname } from "@std/path";
import { HOME_DIR } from "../constants.js";
import { loadPlan, savePlan } from "../plan-store.js";
import { GitRepositoryRequiredError } from "./git.js";
import { stageValidationPassedInExecutionWorktree } from "./workflow/plan-lifecycle.js";
import { findByPlanName } from "./worktree-registry.js";
import {
    checkpointExecutionWorktree,
    createExecutionWorktree,
    findReusableWorktree,
    getWorktreeStatus,
    inspectExecutionWorktreeMergeRisk,
    mergeExecutionWorktree,
    preparePrimaryPlanPathForMerge,
    prepareTargetBranchRef,
    removeExecutionWorktree,
    resolveCurrentCheckoutBranch,
    resolveWorktreeParent,
    restorePrimaryPlanPathAfterMergeFailure,
    sealExecutionWorktreeCandidate,
} from "./worktree.js";

/** @type {import('./workflow/plan-lifecycle.js').PlanEventDetails} */
const TEST_DELIVERY_DETAILS = {
    executionMode: "worktree",
    deliveryEvidence: {
        version: 1,
        mode: "worktree_merge",
        executionCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        targetBranch: "main",
        targetHeadBeforeMerge: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    },
};

/**
 * @param {string} cwd
 * @param {string[]} args
 */
async function git(cwd, args) {
    const command = new Deno.Command("git", { args, cwd, stdout: "piped", stderr: "piped" });
    const output = await command.output();
    if (!output.success) {
        throw new Error(new TextDecoder().decode(output.stderr));
    }
    return new TextDecoder().decode(output.stdout).trim();
}

async function makeRepo() {
    const cwd = await Deno.makeTempDir();
    await git(cwd, ["init", "-b", "main"]);
    await git(cwd, ["config", "user.email", "runwield@example.com"]);
    await git(cwd, ["config", "user.name", "RunWield Test"]);
    await Deno.writeTextFile(`${cwd}/README.md`, "base\n");
    await git(cwd, ["add", "."]);
    await git(cwd, ["commit", "-m", "base"]);
    return cwd;
}

Deno.test("worktree helpers report Git requirement outside Git", async () => {
    const projectRoot = await Deno.makeTempDir({ prefix: "runwield-non-git-worktree-" });
    try {
        await assertRejects(
            () => createExecutionWorktree({ projectRoot, planName: "Non Git Plan" }),
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
                removeExecutionWorktree({
                    projectRoot,
                    path: `${projectRoot}/missing`,
                    branch: "runwield/worktree/non-git",
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
        await savePlan(projectRoot, "feature", "# Feature", { status: "ready_for_work" });
        await git(projectRoot, ["add", "plans/feature.md"]);
        await git(projectRoot, ["commit", "-m", "add feature plan"]);
        worktree = await createExecutionWorktree({ projectRoot, planName: "Feature", worktreeRoot });
        const activeWorktree = worktree;
        await Deno.writeTextFile(`${activeWorktree.path}/feature.txt`, "validated\n");
        const sealed = await sealExecutionWorktreeCandidate({
            worktreePath: activeWorktree.path,
            branch: activeWorktree.branch,
            planName: "feature",
        });
        await savePlan(activeWorktree.path, "feature", "# Feature", { status: "verified" });
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
            await removeExecutionWorktree({
                projectRoot,
                path: worktree.path,
                branch: worktree.branch,
                force: true,
            }).catch(() => {});
        }
        await Deno.remove(projectRoot, { recursive: true }).catch(() => {});
        await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
    }
});
