import { assertEquals, assertMatch, assertRejects, assertStringIncludes } from "@std/assert";
import { basename, dirname } from "@std/path";
import { HOME_DIR } from "../constants.js";
import { findByPlanName } from "./worktree-registry.js";
import {
    createExecutionWorktree,
    getWorktreeStatus,
    inspectExecutionWorktreeMergeRisk,
    mergeExecutionWorktree,
    prepareTargetBranchRef,
    removeExecutionWorktree,
    resolveWorktreeParent,
} from "./worktree.js";

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

Deno.test("resolveWorktreeParent uses session-style full cwd encoding by default", () => {
    const projectRoot = "/Users/alice/Documents/web/runwield";

    if (HOME_DIR) {
        assertEquals(
            resolveWorktreeParent(projectRoot, undefined),
            `${HOME_DIR}/.wld/worktrees/--Users-alice-Documents-web-runwield--`,
        );
    } else {
        assertEquals(resolveWorktreeParent(projectRoot, undefined), `${projectRoot}/.wld/worktrees`);
    }

    assertEquals(resolveWorktreeParent(projectRoot, "/tmp/worktrees"), "/tmp/worktrees");
});

Deno.test("createExecutionWorktree creates a unique branch/path and registry entry", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir();
    let worktree;
    try {
        worktree = await createExecutionWorktree({ projectRoot, planName: "Demo Plan", worktreeRoot });
        assertMatch(worktree.branch, /^runwield\/worktree\/demo-plan-[a-f0-9]{8}$/);
        assertEquals(dirname(worktree.path), worktreeRoot);
        assertMatch(basename(worktree.path), /runwield-demo-plan-[a-f0-9]{8}$/);
        assertEquals(await git(worktree.path, ["branch", "--show-current"]), worktree.branch);
        const registryEntry = await findByPlanName(projectRoot, "Demo Plan");
        assertEquals(registryEntry?.id, worktree.id);
        assertEquals(registryEntry?.baseTree, await git(projectRoot, ["rev-parse", "HEAD^{tree}"]));

        const status = await getWorktreeStatus({ projectRoot, path: worktree.path, branch: worktree.branch });
        assertEquals(status.exists, true);
        assertEquals(status.clean, true);
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

Deno.test("prepareTargetBranchRef returns existing local branch ref", async () => {
    const projectRoot = await makeRepo();
    try {
        await git(projectRoot, ["checkout", "-b", "feature-base"]);
        await git(projectRoot, ["checkout", "main"]);

        assertEquals(await prepareTargetBranchRef(projectRoot, " feature-base "), "refs/heads/feature-base");
    } finally {
        await Deno.remove(projectRoot, { recursive: true });
    }
});

Deno.test("prepareTargetBranchRef creates local tracking branch from existing remote-tracking ref", async () => {
    const seed = await makeRepo();
    const remote = await Deno.makeTempDir();
    const projectRoot = await Deno.makeTempDir();
    try {
        await git(remote, ["init", "--bare"]);
        await git(seed, ["remote", "add", "origin", remote]);
        await git(seed, ["checkout", "-b", "remote-target"]);
        await Deno.writeTextFile(`${seed}/remote.txt`, "remote\n");
        await git(seed, ["add", "."]);
        await git(seed, ["commit", "-m", "remote target"]);
        await git(seed, ["push", "origin", "main", "remote-target"]);
        await git(remote, ["symbolic-ref", "HEAD", "refs/heads/main"]);
        await git(projectRoot, ["clone", remote, "."]);
        await git(projectRoot, ["checkout", "main"]);
        await git(projectRoot, ["branch", "-D", "remote-target"]).catch(() => "");
        await Deno.remove(remote, { recursive: true });

        assertEquals(await prepareTargetBranchRef(projectRoot, "remote-target"), "refs/heads/remote-target");
        assertEquals(
            await git(projectRoot, ["rev-parse", "--abbrev-ref", "remote-target@{upstream}"]),
            "origin/remote-target",
        );
    } finally {
        await Deno.remove(seed, { recursive: true }).catch(() => {});
        await Deno.remove(remote, { recursive: true }).catch(() => {});
        await Deno.remove(projectRoot, { recursive: true }).catch(() => {});
    }
});

Deno.test("prepareTargetBranchRef creates local tracking branch for remote-only target", async () => {
    const seed = await makeRepo();
    const remote = await Deno.makeTempDir();
    const projectRoot = await Deno.makeTempDir();
    try {
        await git(remote, ["init", "--bare"]);
        await git(seed, ["remote", "add", "origin", remote]);
        await git(seed, ["checkout", "-b", "remote-target"]);
        await Deno.writeTextFile(`${seed}/remote.txt`, "remote\n");
        await git(seed, ["add", "."]);
        await git(seed, ["commit", "-m", "remote target"]);
        await git(seed, ["push", "origin", "main", "remote-target"]);
        await git(remote, ["symbolic-ref", "HEAD", "refs/heads/main"]);
        await git(projectRoot, ["clone", remote, "."]);
        await git(projectRoot, ["checkout", "main"]);
        await git(projectRoot, ["branch", "-D", "remote-target"]).catch(() => "");

        assertEquals(await prepareTargetBranchRef(projectRoot, "remote-target"), "refs/heads/remote-target");
        assertEquals(
            await git(projectRoot, ["rev-parse", "--abbrev-ref", "remote-target@{upstream}"]),
            "origin/remote-target",
        );
    } finally {
        await Deno.remove(seed, { recursive: true }).catch(() => {});
        await Deno.remove(remote, { recursive: true }).catch(() => {});
        await Deno.remove(projectRoot, { recursive: true }).catch(() => {});
    }
});

Deno.test("prepareTargetBranchRef creates new local target from main", async () => {
    const projectRoot = await makeRepo();
    try {
        await git(projectRoot, ["checkout", "-b", "other"]);
        await Deno.writeTextFile(`${projectRoot}/other.txt`, "other\n");
        await git(projectRoot, ["add", "."]);
        await git(projectRoot, ["commit", "-m", "other"]);

        assertEquals(await prepareTargetBranchRef(projectRoot, "new-target"), "refs/heads/new-target");
        assertEquals(await git(projectRoot, ["show", "new-target:README.md"]), "base");
        await assertRejects(() => git(projectRoot, ["show", "new-target:other.txt"]), Error);
    } finally {
        await Deno.remove(projectRoot, { recursive: true });
    }
});

Deno.test("prepareTargetBranchRef rejects invalid target branch names", async () => {
    const projectRoot = await makeRepo();
    try {
        await assertRejects(() => prepareTargetBranchRef(projectRoot, "HEAD"), Error, "must not be empty or HEAD");
        await assertRejects(
            () => prepareTargetBranchRef(projectRoot, "bad branch"),
            Error,
            "Invalid target branch name",
        );
    } finally {
        await Deno.remove(projectRoot, { recursive: true });
    }
});

Deno.test("createExecutionWorktree can start from explicit non-current target branch", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir();
    /** @type {Awaited<ReturnType<typeof createExecutionWorktree>> | undefined} */
    let worktree;
    try {
        await git(projectRoot, ["checkout", "-b", "feature-base"]);
        await Deno.writeTextFile(`${projectRoot}/feature-base.txt`, "target\n");
        await git(projectRoot, ["add", "."]);
        await git(projectRoot, ["commit", "-m", "target base"]);
        await git(projectRoot, ["checkout", "main"]);
        const baseRef = await prepareTargetBranchRef(projectRoot, "feature-base");

        worktree = await createExecutionWorktree({
            projectRoot,
            planName: "Explicit Target",
            worktreeRoot,
            baseRef,
            baseBranch: "feature-base",
        });

        const worktreePath = worktree.path;
        assertEquals(worktree.baseBranch, "feature-base");
        assertEquals(await git(worktreePath, ["show", "HEAD:feature-base.txt"]), "target");
    } finally {
        if (worktree) {
            await removeExecutionWorktree({ projectRoot, path: worktree.path, branch: worktree.branch, force: true });
        }
        await Deno.remove(projectRoot, { recursive: true });
        await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
    }
});

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

        await mergeExecutionWorktree({
            projectRoot,
            branch: worktree.branch,
            targetBranch: worktree.baseBranch,
            worktreePath: worktree.path,
        });

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

        await mergeExecutionWorktree({
            projectRoot,
            branch: worktree.branch,
            worktreePath: worktree.path,
            allowedDirtyPaths: [".wld/"],
            planName: "Useful Commit Messages",
            planDescription: "Reference the plan description in dirty worktree commits.",
        });

        assertEquals(await Deno.readTextFile(`${projectRoot}/README.md`), "base\nchanged\n");
        assertEquals(await Deno.readTextFile(`${projectRoot}/feature.txt`), "feature\n");
        const commitMessage = await git(worktree.path, ["log", "-1", "--format=%B"]);
        assertStringIncludes(commitMessage, "Complete Useful Commit Messages");
        assertStringIncludes(commitMessage, "- Plan: Useful Commit Messages");
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

Deno.test("inspectExecutionWorktreeMergeRisk reports clean target branch as safe without mutating", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir();
    /** @type {Awaited<ReturnType<typeof createExecutionWorktree>> | undefined} */
    let worktree;
    try {
        await git(projectRoot, ["checkout", "-b", "feature-base"]);
        worktree = await createExecutionWorktree({ projectRoot, planName: "Clean Risk", worktreeRoot });
        await git(projectRoot, ["checkout", "main"]);
        await Deno.writeTextFile(`${worktree.path}/feature.txt`, "feature\n");
        await git(worktree.path, ["add", "."]);
        await git(worktree.path, ["commit", "-m", "feature"]);

        const beforeHead = await git(projectRoot, ["rev-parse", "HEAD"]);
        const beforeStatus = await git(projectRoot, ["status", "--porcelain"]);
        const result = await inspectExecutionWorktreeMergeRisk({
            projectRoot,
            branch: worktree.branch,
            targetBranch: "feature-base",
        });

        assertEquals(result, { ok: true, warnings: [], failures: [] });
        assertEquals(await git(projectRoot, ["rev-parse", "HEAD"]), beforeHead);
        assertEquals(await git(projectRoot, ["status", "--porcelain"]), beforeStatus);
        assertEquals(await git(projectRoot, ["branch", "--show-current"]), "main");
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

Deno.test("inspectExecutionWorktreeMergeRisk fails when target branch is checked out elsewhere", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir();
    const targetCheckout = await Deno.makeTempDir();
    /** @type {Awaited<ReturnType<typeof createExecutionWorktree>> | undefined} */
    let worktree;
    try {
        await git(projectRoot, ["checkout", "-b", "feature-base"]);
        worktree = await createExecutionWorktree({ projectRoot, planName: "Checked Out Target Risk", worktreeRoot });
        await git(projectRoot, ["checkout", "main"]);
        await git(projectRoot, ["worktree", "add", targetCheckout, "feature-base"]);
        await Deno.writeTextFile(`${worktree.path}/feature.txt`, "feature\n");
        await git(worktree.path, ["add", "."]);
        await git(worktree.path, ["commit", "-m", "feature"]);

        const result = await inspectExecutionWorktreeMergeRisk({
            projectRoot,
            branch: worktree.branch,
            targetBranch: "feature-base",
        });

        assertEquals(result.ok, false);
        assertEquals(
            result.failures.some((failure) =>
                failure.includes("Target branch feature-base is checked out") && failure.includes(targetCheckout)
            ),
            true,
        );
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

Deno.test("inspectExecutionWorktreeMergeRisk requires targetBranch to be a local branch, not a tag", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir();
    /** @type {Awaited<ReturnType<typeof createExecutionWorktree>> | undefined} */
    let worktree;
    try {
        worktree = await createExecutionWorktree({ projectRoot, planName: "Tag Risk", worktreeRoot });
        await git(projectRoot, ["tag", "release-target"]);

        const result = await inspectExecutionWorktreeMergeRisk({
            projectRoot,
            branch: worktree.branch,
            targetBranch: "release-target",
        });

        assertEquals(result.ok, false);
        assertEquals(
            result.failures.some((failure) =>
                failure.includes("Recorded worktree target branch is not available") &&
                failure.includes("refs/heads/release-target")
            ),
            true,
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

Deno.test("inspectExecutionWorktreeMergeRisk warns on overlapping dirty primary changes", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir();
    /** @type {Awaited<ReturnType<typeof createExecutionWorktree>> | undefined} */
    let worktree;
    try {
        worktree = await createExecutionWorktree({ projectRoot, planName: "Dirty Risk", worktreeRoot });
        await Deno.writeTextFile(`${worktree.path}/README.md`, "base\nfeature\n");
        await git(worktree.path, ["add", "."]);
        await git(worktree.path, ["commit", "-m", "feature"]);
        await Deno.writeTextFile(`${projectRoot}/README.md`, "base\nprimary scratch\n");

        const result = await inspectExecutionWorktreeMergeRisk({ projectRoot, branch: worktree.branch });

        assertEquals(result.ok, true);
        assertEquals(
            result.warnings.some((warning) =>
                warning.includes("overlap execution worktree changes") && warning.includes("README.md")
            ),
            true,
        );
        assertEquals(await Deno.readTextFile(`${projectRoot}/README.md`), "base\nprimary scratch\n");
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

Deno.test("inspectExecutionWorktreeMergeRisk fails on missing branch", async () => {
    const projectRoot = await makeRepo();
    try {
        const result = await inspectExecutionWorktreeMergeRisk({ projectRoot, branch: "missing-branch" });

        assertEquals(result.ok, false);
        assertEquals(result.warnings, []);
        assertEquals(
            result.failures.some((failure) => failure.includes("Recorded worktree branch is not available")),
            true,
        );
    } finally {
        await Deno.remove(projectRoot, { recursive: true });
    }
});
