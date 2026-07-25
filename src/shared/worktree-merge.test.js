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

Deno.test("mergeExecutionWorktree targets recorded branch without changing primary checkout", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir();
    /** @type {Awaited<ReturnType<typeof createExecutionWorktree>> | undefined} */
    let worktree;
    try {
        await git(projectRoot, ["checkout", "-b", "feature-base"]);
        worktree = await createExecutionWorktree({ projectRoot, planName: "Target Branch Merge", worktreeRoot });
        assertEquals(worktree.baseBranch, "feature-base");
        await git(projectRoot, ["checkout", "main"]);
        await Deno.writeTextFile(`${worktree.path}/feature.txt`, "feature\n");

        const mergeResult = await mergeExecutionWorktree({
            projectRoot,
            branch: worktree.branch,
            targetBranch: worktree.baseBranch,
            worktreePath: worktree.path,
        });

        assertEquals(mergeResult?.updatedPrimaryCheckout, false);
        assertEquals(await git(projectRoot, ["branch", "--show-current"]), "main");
        assertEquals(await git(projectRoot, ["show", "feature-base:feature.txt"]), "feature");
        await assertRejects(() => git(projectRoot, ["show", "main:feature.txt"]), Error);
    } finally {
        if (worktree) {
            await removeExecutionWorktree({
                projectRoot,
                path: worktree.path,
                branch: worktree.branch,
                force: true,
            });
        }
        await Deno.remove(projectRoot, { recursive: true });
        await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
    }
});

Deno.test("mergeExecutionWorktree refuses to update target branch checked out in another worktree", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir();
    const targetCheckout = await Deno.makeTempDir();
    /** @type {Awaited<ReturnType<typeof createExecutionWorktree>> | undefined} */
    let worktree;
    try {
        await git(projectRoot, ["checkout", "-b", "feature-base"]);
        worktree = await createExecutionWorktree({ projectRoot, planName: "Checked Out Target", worktreeRoot });
        await git(projectRoot, ["checkout", "main"]);
        await git(projectRoot, ["worktree", "add", targetCheckout, "feature-base"]);
        const worktreePath = worktree.path;
        const worktreeBranch = worktree.branch;
        await Deno.writeTextFile(`${worktreePath}/feature.txt`, "feature\n");

        await assertRejects(
            () =>
                mergeExecutionWorktree({
                    projectRoot,
                    branch: worktreeBranch,
                    targetBranch: "feature-base",
                    worktreePath,
                }),
            Error,
            "Target branch feature-base is checked out",
        );
        await assertRejects(() => git(projectRoot, ["show", "feature-base:feature.txt"]), Error);
    } finally {
        await git(projectRoot, ["worktree", "remove", "--force", targetCheckout]).catch(() => {});
        if (worktree) {
            await removeExecutionWorktree({
                projectRoot,
                path: worktree.path,
                branch: worktree.branch,
                force: true,
            });
        }
        await Deno.remove(projectRoot, { recursive: true });
        await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
        await Deno.remove(targetCheckout, { recursive: true }).catch(() => {});
    }
});

Deno.test("mergeExecutionWorktree refuses checked-out target before mutating execution branch", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir();
    const targetCheckout = await Deno.makeTempDir();
    /** @type {Awaited<ReturnType<typeof createExecutionWorktree>> | undefined} */
    let worktree;
    try {
        await git(projectRoot, ["checkout", "-b", "feature-base"]);
        worktree = await createExecutionWorktree({
            projectRoot,
            planName: "Checked Out Target No Side Effects",
            worktreeRoot,
        });
        await Deno.mkdir(`${projectRoot}/plans`, { recursive: true });
        await Deno.writeTextFile(`${projectRoot}/plans/demo.md`, "target\n");
        await git(projectRoot, ["add", "plans/demo.md"]);
        await git(projectRoot, ["commit", "-m", "target plan metadata"]);
        await git(projectRoot, ["checkout", "main"]);
        await git(projectRoot, ["worktree", "add", targetCheckout, "feature-base"]);

        await Deno.mkdir(`${worktree.path}/plans`, { recursive: true });
        await Deno.writeTextFile(`${worktree.path}/plans/demo.md`, "execution\n");
        await git(worktree.path, ["add", "plans/demo.md"]);
        await git(worktree.path, ["commit", "-m", "execution plan metadata"]);
        const beforeExecutionHead = await git(projectRoot, ["rev-parse", worktree.branch]);

        await assertRejects(
            () =>
                mergeExecutionWorktree({
                    projectRoot,
                    branch: worktree?.branch || "",
                    targetBranch: "feature-base",
                    worktreePath: worktree?.path,
                }),
            Error,
            "Target branch feature-base is checked out",
        );

        assertEquals(await git(projectRoot, ["rev-parse", worktree.branch]), beforeExecutionHead);
        assertEquals(await git(projectRoot, ["show", `${worktree.branch}:plans/demo.md`]), "execution");
    } finally {
        await git(projectRoot, ["worktree", "remove", "--force", targetCheckout]).catch(() => {});
        if (worktree) {
            await removeExecutionWorktree({
                projectRoot,
                path: worktree.path,
                branch: worktree.branch,
                force: true,
            });
        }
        await Deno.remove(projectRoot, { recursive: true });
        await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
        await Deno.remove(targetCheckout, { recursive: true }).catch(() => {});
    }
});

Deno.test("mergeExecutionWorktree requires targetBranch to be a local branch, not a tag", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir();
    /** @type {Awaited<ReturnType<typeof createExecutionWorktree>> | undefined} */
    let worktree;
    try {
        worktree = await createExecutionWorktree({ projectRoot, planName: "Tag Is Not Target", worktreeRoot });
        await git(projectRoot, ["tag", "release-target"]);
        await Deno.writeTextFile(`${worktree.path}/feature.txt`, "feature\n");

        await assertRejects(
            () =>
                mergeExecutionWorktree({
                    projectRoot,
                    branch: worktree?.branch || "",
                    targetBranch: "release-target",
                    worktreePath: worktree?.path,
                }),
            Error,
            "refs/heads/release-target",
        );
        await assertRejects(() => git(projectRoot, ["show", "HEAD:feature.txt"]), Error);
    } finally {
        if (worktree) {
            await removeExecutionWorktree({
                projectRoot,
                path: worktree.path,
                branch: worktree.branch,
                force: true,
            });
        }
        await Deno.remove(projectRoot, { recursive: true });
        await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
    }
});

Deno.test("mergeExecutionWorktree publishes and cleans up a repaired detached merge worktree", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir();
    /** @type {Awaited<ReturnType<typeof createExecutionWorktree>> | undefined} */
    let worktree;
    /** @type {string | undefined} */
    let mergeWorktreePath;
    try {
        await git(projectRoot, ["checkout", "-b", "feature-base"]);
        worktree = await createExecutionWorktree({ projectRoot, planName: "Repaired Detached Merge", worktreeRoot });
        await Deno.writeTextFile(`${projectRoot}/README.md`, "base\ntarget\n");
        await git(projectRoot, ["add", "README.md"]);
        await git(projectRoot, ["commit", "-m", "target change"]);
        await git(projectRoot, ["checkout", "main"]);
        await Deno.writeTextFile(`${worktree.path}/README.md`, "base\nexecution\n");

        try {
            await mergeExecutionWorktree({
                projectRoot,
                branch: worktree.branch,
                targetBranch: "feature-base",
                worktreePath: worktree.path,
            });
        } catch (error) {
            mergeWorktreePath = /** @type {{ mergeWorktreePath?: string }} */ (error).mergeWorktreePath;
        }
        if (!mergeWorktreePath) throw new Error("Expected detached merge repair worktree path");
        assertEquals(dirname(mergeWorktreePath), worktreeRoot);

        await Deno.writeTextFile(`${mergeWorktreePath}/README.md`, "base\ntarget\nexecution\n");
        await git(mergeWorktreePath, ["add", "README.md"]);
        await mergeExecutionWorktree({
            projectRoot,
            branch: worktree.branch,
            targetBranch: "feature-base",
            worktreePath: worktree.path,
            repairMergeWorktreePath: mergeWorktreePath,
        });

        assertEquals(await git(projectRoot, ["show", "feature-base:README.md"]), "base\ntarget\nexecution");
        await assertRejects(() => Deno.stat(mergeWorktreePath || ""), Deno.errors.NotFound);
    } finally {
        if (mergeWorktreePath) {
            await git(projectRoot, ["worktree", "remove", "--force", mergeWorktreePath]).catch(() => {});
        }
        if (worktree) {
            await removeExecutionWorktree({
                projectRoot,
                path: worktree.path,
                branch: worktree.branch,
                force: true,
            });
        }
        await Deno.remove(projectRoot, { recursive: true });
        await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
    }
});

Deno.test("mergeExecutionWorktree abandons repaired worktree when Engineer made branch retryable", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir();
    /** @type {Awaited<ReturnType<typeof createExecutionWorktree>> | undefined} */
    let worktree;
    /** @type {string | undefined} */
    let mergeWorktreePath;
    try {
        await git(projectRoot, ["checkout", "-b", "feature-base"]);
        worktree = await createExecutionWorktree({ projectRoot, planName: "Retryable Branch Repair", worktreeRoot });
        await Deno.writeTextFile(`${projectRoot}/README.md`, "base\ntarget\n");
        await git(projectRoot, ["add", "README.md"]);
        await git(projectRoot, ["commit", "-m", "target change"]);
        await git(projectRoot, ["checkout", "main"]);
        await Deno.writeTextFile(`${worktree.path}/README.md`, "base\nexecution\n");

        try {
            await mergeExecutionWorktree({
                projectRoot,
                branch: worktree.branch,
                targetBranch: "feature-base",
                worktreePath: worktree.path,
            });
        } catch (error) {
            mergeWorktreePath = /** @type {{ mergeWorktreePath?: string }} */ (error).mergeWorktreePath;
        }
        if (!mergeWorktreePath) throw new Error("Expected detached merge repair worktree path");

        await git(mergeWorktreePath, ["merge", "--abort"]);
        await git(worktree.path, ["merge", "feature-base"]).catch(() => Promise.resolve());
        await Deno.writeTextFile(`${worktree.path}/README.md`, "base\ntarget\nexecution\n");
        await git(worktree.path, ["add", "README.md"]);
        await git(worktree.path, ["commit", "-m", "make execution branch retryable"]);

        await mergeExecutionWorktree({
            projectRoot,
            branch: worktree.branch,
            targetBranch: "feature-base",
            worktreePath: worktree.path,
            repairMergeWorktreePath: mergeWorktreePath,
        });

        assertEquals(await git(projectRoot, ["show", "feature-base:README.md"]), "base\ntarget\nexecution");
        await assertRejects(() => Deno.stat(mergeWorktreePath || ""), Deno.errors.NotFound);
    } finally {
        if (mergeWorktreePath) {
            await git(projectRoot, ["worktree", "remove", "--force", mergeWorktreePath]).catch(() => {});
        }
        if (worktree) {
            await removeExecutionWorktree({
                projectRoot,
                path: worktree.path,
                branch: worktree.branch,
                force: true,
            });
        }
        await Deno.remove(projectRoot, { recursive: true });
        await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
    }
});

Deno.test("mergeExecutionWorktree abandons stale repaired worktree and retries current target", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir();
    /** @type {Awaited<ReturnType<typeof createExecutionWorktree>> | undefined} */
    let worktree;
    /** @type {string | undefined} */
    let mergeWorktreePath;
    try {
        await git(projectRoot, ["checkout", "-b", "feature-base"]);
        worktree = await createExecutionWorktree({ projectRoot, planName: "Stale Repaired Merge", worktreeRoot });
        await Deno.writeTextFile(`${projectRoot}/README.md`, "base\ntarget\n");
        await git(projectRoot, ["add", "README.md"]);
        await git(projectRoot, ["commit", "-m", "target change"]);
        await git(projectRoot, ["checkout", "main"]);
        await Deno.writeTextFile(`${worktree.path}/README.md`, "base\nexecution\n");

        try {
            await mergeExecutionWorktree({
                projectRoot,
                branch: worktree.branch,
                targetBranch: "feature-base",
                worktreePath: worktree.path,
            });
        } catch (error) {
            mergeWorktreePath = /** @type {{ mergeWorktreePath?: string }} */ (error).mergeWorktreePath;
        }
        if (!mergeWorktreePath) throw new Error("Expected detached merge repair worktree path");

        await Deno.writeTextFile(`${mergeWorktreePath}/README.md`, "base\ntarget\nexecution\n");
        await git(mergeWorktreePath, ["add", "README.md"]);
        await git(mergeWorktreePath, ["-c", "core.editor=true", "merge", "--continue"]);
        await git(worktree.path, ["merge", "feature-base"]).catch(() => Promise.resolve());
        await Deno.writeTextFile(`${worktree.path}/README.md`, "base\ntarget\nexecution\n");
        await git(worktree.path, ["add", "README.md"]);
        await git(worktree.path, ["commit", "-m", "make execution branch retryable"]);

        await git(projectRoot, ["checkout", "feature-base"]);
        await Deno.writeTextFile(`${projectRoot}/advanced.txt`, "advanced\n");
        await git(projectRoot, ["add", "advanced.txt"]);
        await git(projectRoot, ["commit", "-m", "advance target during repair"]);
        await git(projectRoot, ["checkout", "main"]);

        await mergeExecutionWorktree({
            projectRoot,
            branch: worktree.branch,
            targetBranch: "feature-base",
            worktreePath: worktree.path,
            repairMergeWorktreePath: mergeWorktreePath,
        });

        assertEquals(await git(projectRoot, ["show", "feature-base:README.md"]), "base\ntarget\nexecution");
        assertEquals(await git(projectRoot, ["show", "feature-base:advanced.txt"]), "advanced");
        await assertRejects(() => Deno.stat(mergeWorktreePath || ""), Deno.errors.NotFound);
    } finally {
        if (mergeWorktreePath) {
            await git(projectRoot, ["worktree", "remove", "--force", mergeWorktreePath]).catch(() => {});
        }
        if (worktree) {
            await removeExecutionWorktree({
                projectRoot,
                path: worktree.path,
                branch: worktree.branch,
                force: true,
            });
        }
        await Deno.remove(projectRoot, { recursive: true });
        await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
    }
});

Deno.test("mergeExecutionWorktree abandons repaired worktree for current-root checked-out target fallback", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir();
    /** @type {Awaited<ReturnType<typeof createExecutionWorktree>> | undefined} */
    let worktree;
    /** @type {string | undefined} */
    let mergeWorktreePath;
    try {
        await git(projectRoot, ["checkout", "-b", "feature-base"]);
        worktree = await createExecutionWorktree({
            projectRoot,
            planName: "Checked Out Repair Fallback",
            worktreeRoot,
        });
        await Deno.writeTextFile(`${projectRoot}/README.md`, "base\ntarget\n");
        await git(projectRoot, ["add", "README.md"]);
        await git(projectRoot, ["commit", "-m", "target change"]);
        await git(projectRoot, ["checkout", "main"]);
        await Deno.writeTextFile(`${worktree.path}/README.md`, "base\nexecution\n");

        try {
            await mergeExecutionWorktree({
                projectRoot,
                branch: worktree.branch,
                targetBranch: "feature-base",
                worktreePath: worktree.path,
            });
        } catch (error) {
            mergeWorktreePath = /** @type {{ mergeWorktreePath?: string }} */ (error).mergeWorktreePath;
        }
        if (!mergeWorktreePath) throw new Error("Expected detached merge repair worktree path");

        await Deno.writeTextFile(`${mergeWorktreePath}/README.md`, "base\ntarget\nexecution\n");
        await git(mergeWorktreePath, ["add", "README.md"]);
        await git(mergeWorktreePath, ["-c", "core.editor=true", "merge", "--continue"]);
        await git(worktree.path, ["merge", "feature-base"]).catch(() => Promise.resolve());
        await Deno.writeTextFile(`${worktree.path}/README.md`, "base\ntarget\nexecution\n");
        await git(worktree.path, ["add", "README.md"]);
        await git(worktree.path, ["commit", "-m", "make execution branch retryable"]);

        await git(projectRoot, ["checkout", "feature-base"]);
        await mergeExecutionWorktree({
            projectRoot,
            branch: worktree.branch,
            targetBranch: "feature-base",
            worktreePath: worktree.path,
            repairMergeWorktreePath: mergeWorktreePath,
        });

        assertEquals(await git(projectRoot, ["branch", "--show-current"]), "feature-base");
        assertEquals(await git(projectRoot, ["show", "feature-base:README.md"]), "base\ntarget\nexecution");
        await assertRejects(() => Deno.stat(mergeWorktreePath || ""), Deno.errors.NotFound);
    } finally {
        if (mergeWorktreePath) {
            await git(projectRoot, ["worktree", "remove", "--force", mergeWorktreePath]).catch(() => {});
        }
        if (worktree) {
            await removeExecutionWorktree({
                projectRoot,
                path: worktree.path,
                branch: worktree.branch,
                force: true,
            });
        }
        await Deno.remove(projectRoot, { recursive: true });
        await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
    }
});

Deno.test("mergeExecutionWorktree annotates current-root target fallback conflicts for repair", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir();
    /** @type {Awaited<ReturnType<typeof createExecutionWorktree>> | undefined} */
    let worktree;
    try {
        await git(projectRoot, ["checkout", "-b", "feature-base"]);
        worktree = await createExecutionWorktree({
            projectRoot,
            planName: "Checked Out Target Conflict Metadata",
            worktreeRoot,
        });
        await Deno.writeTextFile(`${projectRoot}/README.md`, "base\ntarget\n");
        await git(projectRoot, ["add", "README.md"]);
        await git(projectRoot, ["commit", "-m", "target change"]);
        await Deno.writeTextFile(`${worktree.path}/README.md`, "base\nexecution\n");

        try {
            await mergeExecutionWorktree({
                projectRoot,
                branch: worktree.branch,
                targetBranch: "feature-base",
                worktreePath: worktree.path,
            });
            throw new Error("Expected merge conflict");
        } catch (error) {
            assertEquals(/** @type {{ repairCwd?: string }} */ (error).repairCwd, projectRoot);
            assertEquals(
                /** @type {{ mergeFailureKind?: string }} */ (error).mergeFailureKind,
                "current_checkout_merge_conflict",
            );
            assertEquals(/** @type {{ mergeWorktreePath?: string }} */ (error).mergeWorktreePath, undefined);
        }
    } finally {
        await git(projectRoot, ["merge", "--abort"]).catch(() => {});
        if (worktree) {
            await removeExecutionWorktree({
                projectRoot,
                path: worktree.path,
                branch: worktree.branch,
                force: true,
            });
        }
        await Deno.remove(projectRoot, { recursive: true });
        await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
    }
});

Deno.test("mergeExecutionWorktree annotates legacy current-checkout conflicts for repair", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir();
    /** @type {Awaited<ReturnType<typeof createExecutionWorktree>> | undefined} */
    let worktree;
    try {
        worktree = await createExecutionWorktree({
            projectRoot,
            planName: "Legacy Checkout Conflict Metadata",
            worktreeRoot,
        });
        await Deno.writeTextFile(`${projectRoot}/README.md`, "base\ncurrent\n");
        await git(projectRoot, ["add", "README.md"]);
        await git(projectRoot, ["commit", "-m", "current change"]);
        await Deno.writeTextFile(`${worktree.path}/README.md`, "base\nexecution\n");

        try {
            await mergeExecutionWorktree({
                projectRoot,
                branch: worktree.branch,
                worktreePath: worktree.path,
            });
            throw new Error("Expected merge conflict");
        } catch (error) {
            assertEquals(/** @type {{ repairCwd?: string }} */ (error).repairCwd, projectRoot);
            assertEquals(
                /** @type {{ mergeFailureKind?: string }} */ (error).mergeFailureKind,
                "current_checkout_merge_conflict",
            );
            assertEquals(/** @type {{ mergeWorktreePath?: string }} */ (error).mergeWorktreePath, undefined);
        }
    } finally {
        await git(projectRoot, ["merge", "--abort"]).catch(() => {});
        if (worktree) {
            await removeExecutionWorktree({
                projectRoot,
                path: worktree.path,
                branch: worktree.branch,
                force: true,
            });
        }
        await Deno.remove(projectRoot, { recursive: true });
        await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
    }
});

Deno.test("mergeExecutionWorktree handles target branch advancing before a later merge", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir();
    /** @type {Awaited<ReturnType<typeof createExecutionWorktree>> | undefined} */
    let first;
    /** @type {Awaited<ReturnType<typeof createExecutionWorktree>> | undefined} */
    let second;
    try {
        await git(projectRoot, ["checkout", "-b", "feature-base"]);
        first = await createExecutionWorktree({ projectRoot, planName: "First Merge", worktreeRoot });
        second = await createExecutionWorktree({ projectRoot, planName: "Second Merge", worktreeRoot });
        await git(projectRoot, ["checkout", "main"]);
        await Deno.writeTextFile(`${first.path}/first.txt`, "first\n");
        await Deno.writeTextFile(`${second.path}/second.txt`, "second\n");

        await mergeExecutionWorktree({
            projectRoot,
            branch: first.branch,
            targetBranch: "feature-base",
            worktreePath: first.path,
        });
        await mergeExecutionWorktree({
            projectRoot,
            branch: second.branch,
            targetBranch: "feature-base",
            worktreePath: second.path,
        });

        assertEquals(await git(projectRoot, ["show", "feature-base:first.txt"]), "first");
        assertEquals(await git(projectRoot, ["show", "feature-base:second.txt"]), "second");
        assertEquals(await git(projectRoot, ["branch", "--show-current"]), "main");
    } finally {
        for (const worktree of [first, second]) {
            if (worktree) {
                await removeExecutionWorktree({
                    projectRoot,
                    path: worktree.path,
                    branch: worktree.branch,
                    force: true,
                });
            }
        }
        await Deno.remove(projectRoot, { recursive: true });
        await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
    }
});

Deno.test("mergeExecutionWorktree marks target branch advancement as non-repairable", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir();
    /** @type {Awaited<ReturnType<typeof createExecutionWorktree>> | undefined} */
    let worktree;
    try {
        await git(projectRoot, ["checkout", "-b", "feature-base"]);
        const expectedTargetHead = await git(projectRoot, ["rev-parse", "feature-base"]);
        worktree = await createExecutionWorktree({ projectRoot, planName: "Target Advance", worktreeRoot });
        await git(projectRoot, ["checkout", "main"]);
        await git(projectRoot, ["checkout", "feature-base"]);
        await Deno.writeTextFile(`${projectRoot}/target.txt`, "target advanced\n");
        await git(projectRoot, ["add", "target.txt"]);
        await git(projectRoot, ["commit", "-m", "advance target"]);
        await git(projectRoot, ["checkout", "main"]);
        await Deno.writeTextFile(`${worktree.path}/work.txt`, "work\n");

        const error = await assertRejects(
            () =>
                mergeExecutionWorktree({
                    projectRoot,
                    branch: worktree?.branch || "",
                    targetBranch: "feature-base",
                    worktreePath: worktree?.path,
                    expectedTargetHead,
                }),
            Error,
            "Target branch feature-base advanced before publication; rerun Workflow Validation.",
        );
        assertEquals(/** @type {any} */ (error).mergeFailureKind, "target_branch_advanced");
    } finally {
        if (worktree) {
            await removeExecutionWorktree({ projectRoot, path: worktree.path, branch: worktree.branch, force: true });
        }
        await Deno.remove(projectRoot, { recursive: true });
        await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
    }
});

Deno.test("mergeExecutionWorktree reports missing target branch without merging into current checkout", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir();
    /** @type {Awaited<ReturnType<typeof createExecutionWorktree>> | undefined} */
    let worktree;
    try {
        worktree = await createExecutionWorktree({ projectRoot, planName: "Missing Target", worktreeRoot });
        const worktreePath = worktree.path;
        const worktreeBranch = worktree.branch;
        await Deno.writeTextFile(`${worktreePath}/feature.txt`, "feature\n");

        await assertRejects(
            () =>
                mergeExecutionWorktree({
                    projectRoot,
                    branch: worktreeBranch,
                    targetBranch: "missing-target",
                    worktreePath,
                }),
            Error,
            "missing-target",
        );
        await assertRejects(() => git(projectRoot, ["show", "HEAD:feature.txt"]), Error);
    } finally {
        if (worktree) {
            await removeExecutionWorktree({
                projectRoot,
                path: worktree.path,
                branch: worktree.branch,
                force: true,
            });
        }
        await Deno.remove(projectRoot, { recursive: true });
        await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
    }
});

Deno.test("mergeExecutionWorktree includes uncommitted worktree changes", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir();
    /** @type {Awaited<ReturnType<typeof createExecutionWorktree>> | undefined} */
    let worktree;
    try {
        worktree = await createExecutionWorktree({ projectRoot, planName: "Uncommitted Merge", worktreeRoot });
        await Deno.writeTextFile(`${worktree.path}/README.md`, "base\nchanged\n");
        await Deno.writeTextFile(`${worktree.path}/feature.txt`, "feature\n");

        const planName = "session-host-multi-session-refactor/05-worktree-commit-message-subject";
        await mergeExecutionWorktree({
            projectRoot,
            branch: worktree.branch,
            worktreePath: worktree.path,
            allowedDirtyPaths: [".wld/"],
            planName,
            planDescription: "Reference the plan description in dirty worktree commits.",
        });

        assertEquals(await Deno.readTextFile(`${projectRoot}/README.md`), "base\nchanged\n");
        assertEquals(await Deno.readTextFile(`${projectRoot}/feature.txt`), "feature\n");
        const commitMessage = await git(worktree.path, ["log", "-1", "--format=%B"]);
        assertStringIncludes(commitMessage, `Complete ${planName}`);
        assertStringIncludes(commitMessage, `- Plan: ${planName}`);
        assertStringIncludes(
            commitMessage,
            "- Description: Reference the plan description in dirty worktree commits.",
        );
        assertEquals(commitMessage.includes("Apply execution worktree changes"), false);
    } finally {
        if (worktree) {
            await removeExecutionWorktree({
                projectRoot,
                path: worktree.path,
                branch: worktree.branch,
                force: true,
            });
        }
        await Deno.remove(projectRoot, { recursive: true });
        await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
    }
});

Deno.test("checkpointExecutionWorktree commits tracked and untracked implementation changes", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir();
    /** @type {Awaited<ReturnType<typeof createExecutionWorktree>> | undefined} */
    let worktree;
    try {
        worktree = await createExecutionWorktree({ projectRoot, planName: "Checkpoint", worktreeRoot });
        await Deno.writeTextFile(`${worktree.path}/README.md`, "base\ncheckpointed\n");
        await Deno.writeTextFile(`${worktree.path}/new-feature.js`, "export const ready = true;\n");

        const checkpoint = await checkpointExecutionWorktree({
            worktreePath: worktree.path,
            branch: worktree.branch,
            planName: "checkpoint-plan",
            planDescription: "Preserve implementation work before lifecycle completion.",
        });

        assertEquals(await git(worktree.path, ["status", "--porcelain"]), "");
        assertEquals(checkpoint.executionCommit, await git(worktree.path, ["rev-parse", "HEAD"]));
        assertEquals(await git(worktree.path, ["show", "HEAD:new-feature.js"]), "export const ready = true;");
        assertStringIncludes(await git(worktree.path, ["log", "-1", "--format=%B"]), "Complete checkpoint-plan");
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

Deno.test("removeExecutionWorktree preserves unexpected dirty work unless force is explicit", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir();
    /** @type {Awaited<ReturnType<typeof createExecutionWorktree>> | undefined} */
    let worktree;
    try {
        worktree = await createExecutionWorktree({ projectRoot, planName: "Preserve Dirty", worktreeRoot });
        await Deno.writeTextFile(`${worktree.path}/valuable-repair.js`, "export const repaired = true;\n");

        await assertRejects(
            () =>
                removeExecutionWorktree({
                    projectRoot,
                    path: worktree?.path || "",
                    branch: worktree?.branch,
                    force: false,
                }),
            Error,
        );

        assertEquals((await Deno.stat(`${worktree.path}/valuable-repair.js`)).isFile, true);
        assertEquals(await git(projectRoot, ["show-ref", "--verify", `refs/heads/${worktree.branch}`]) !== "", true);
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

Deno.test("mergeExecutionWorktree allows unrelated dirty primary checkout changes", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir();
    /** @type {Awaited<ReturnType<typeof createExecutionWorktree>> | undefined} */
    let worktree;
    try {
        worktree = await createExecutionWorktree({ projectRoot, planName: "Unrelated Dirty Merge", worktreeRoot });
        await Deno.writeTextFile(`${worktree.path}/feature.txt`, "feature\n");
        await git(worktree.path, ["add", "."]);
        await git(worktree.path, ["commit", "-m", "feature"]);
        await Deno.writeTextFile(`${projectRoot}/ODO.md`, "scratch note\n");

        await mergeExecutionWorktree({
            projectRoot,
            branch: worktree.branch,
            worktreePath: worktree.path,
        });

        assertEquals(await Deno.readTextFile(`${projectRoot}/feature.txt`), "feature\n");
        assertEquals(await Deno.readTextFile(`${projectRoot}/ODO.md`), "scratch note\n");
        assertMatch(await git(projectRoot, ["status", "--porcelain"]), /\?\? ODO\.md/);
    } finally {
        if (worktree) {
            await removeExecutionWorktree({
                projectRoot,
                path: worktree.path,
                branch: worktree.branch,
                force: true,
            });
        }
        await Deno.remove(projectRoot, { recursive: true });
        await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
    }
});

Deno.test("mergeExecutionWorktree refuses dirty primary changes that overlap branch changes", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir();
    /** @type {Awaited<ReturnType<typeof createExecutionWorktree>> | undefined} */
    let worktree;
    try {
        worktree = await createExecutionWorktree({ projectRoot, planName: "Dirty Merge", worktreeRoot });
        await Deno.writeTextFile(`${worktree.path}/README.md`, "base\nfeature\n");
        await git(worktree.path, ["add", "."]);
        await git(worktree.path, ["commit", "-m", "feature"]);
        await Deno.writeTextFile(`${projectRoot}/README.md`, "base\nprimary scratch\n");
        const branch = worktree.branch;

        await assertRejects(
            () => mergeExecutionWorktree({ projectRoot, branch }),
            Error,
            "Primary checkout has uncommitted changes that overlap execution worktree changes",
        );
    } finally {
        if (worktree) {
            await removeExecutionWorktree({
                projectRoot,
                path: worktree.path,
                branch: worktree.branch,
                force: true,
            });
        }
        await Deno.remove(projectRoot, { recursive: true });
        await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
    }
});

Deno.test("mergeExecutionWorktree continues an in-progress resolved merge", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir();
    /** @type {Awaited<ReturnType<typeof createExecutionWorktree>> | undefined} */
    let worktree;
    try {
        worktree = await createExecutionWorktree({ projectRoot, planName: "Continue Merge", worktreeRoot });
        const branch = worktree.branch;
        const worktreePath = worktree.path;
        await Deno.writeTextFile(`${worktree.path}/README.md`, "base\nfeature\n");
        await git(worktree.path, ["add", "."]);
        await git(worktree.path, ["commit", "-m", "feature"]);

        await Deno.writeTextFile(`${projectRoot}/README.md`, "base\nprimary\n");
        await git(projectRoot, ["add", "."]);
        await git(projectRoot, ["commit", "-m", "primary"]);

        await assertRejects(
            () =>
                mergeExecutionWorktree({
                    projectRoot,
                    branch,
                    worktreePath,
                }),
            Error,
            "CONFLICT",
        );

        await Deno.writeTextFile(`${projectRoot}/README.md`, "base\nprimary\nfeature\n");
        await git(projectRoot, ["add", "README.md"]);

        await mergeExecutionWorktree({
            projectRoot,
            branch,
            worktreePath,
        });

        assertEquals(await Deno.readTextFile(`${projectRoot}/README.md`), "base\nprimary\nfeature\n");
        assertEquals(await git(projectRoot, ["status", "--porcelain"]), "");
        assertEquals(await git(projectRoot, ["log", "-1", "--pretty=%s"]), `Merge branch '${branch}'`);
    } finally {
        if (worktree) {
            await removeExecutionWorktree({
                projectRoot,
                path: worktree.path,
                branch: worktree.branch,
                force: true,
            });
        }
        await Deno.remove(projectRoot, { recursive: true });
        await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
    }
});
