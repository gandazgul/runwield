import { assertEquals, assertMatch, assertRejects, assertStringIncludes } from "@std/assert";
import { basename, dirname } from "@std/path";
import { HOME_DIR } from "../constants.js";
import { loadPlan, savePlan } from "../plan-store.js";
import { GitRepositoryRequiredError } from "./git.js";
import { stageValidationPassedInExecutionWorktree } from "./workflow/plan-lifecycle.js";
import { findByPlanName } from "./worktree-registry.js";
import {
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

Deno.test("resolveCurrentCheckoutBranch returns the primary checkout branch", async () => {
    const projectRoot = await makeRepo();
    try {
        assertEquals(await resolveCurrentCheckoutBranch(projectRoot), "main");
    } finally {
        await Deno.remove(projectRoot, { recursive: true });
    }
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

Deno.test("createExecutionWorktree initializes submodules", async () => {
    const projectRoot = await makeRepo();
    const submoduleRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir();
    const previousAllowedProtocols = Deno.env.get("GIT_ALLOW_PROTOCOL");
    let worktree;
    try {
        await Deno.writeTextFile(`${submoduleRoot}/module.css`, "body { color: red; }\n");
        await git(submoduleRoot, ["add", "."]);
        await git(submoduleRoot, ["commit", "-m", "add module css"]);
        Deno.env.set("GIT_ALLOW_PROTOCOL", "file");
        await git(projectRoot, ["submodule", "add", submoduleRoot, "third_party/demo"]);
        await git(projectRoot, ["commit", "-m", "add submodule"]);

        worktree = await createExecutionWorktree({ projectRoot, planName: "Submodule Plan", worktreeRoot });

        assertEquals(await Deno.readTextFile(`${worktree.path}/third_party/demo/module.css`), "body { color: red; }\n");
    } finally {
        if (previousAllowedProtocols === undefined) {
            Deno.env.delete("GIT_ALLOW_PROTOCOL");
        } else {
            Deno.env.set("GIT_ALLOW_PROTOCOL", previousAllowedProtocols);
        }
        if (worktree) {
            await removeExecutionWorktree({
                projectRoot,
                path: worktree.path,
                branch: worktree.branch,
                force: true,
            }).catch(() => {});
        }
        await Deno.remove(projectRoot, { recursive: true });
        await Deno.remove(submoduleRoot, { recursive: true });
        await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
    }
});

Deno.test("findReusableWorktree selects the recorded execution id when plan names repeat", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.realPath(await Deno.makeTempDir());
    /** @type {Awaited<ReturnType<typeof createExecutionWorktree>>[]} */
    const worktrees = [];
    try {
        worktrees.push(await createExecutionWorktree({ projectRoot, planName: "Repeated Plan", worktreeRoot }));
        worktrees.push(await createExecutionWorktree({ projectRoot, planName: "Repeated Plan", worktreeRoot }));

        const reusable = await findReusableWorktree({
            projectRoot,
            planName: "Repeated Plan",
            worktreeId: worktrees[1].id,
        });

        assertEquals(reusable?.id, worktrees[1].id);
    } finally {
        for (const worktree of worktrees.toReversed()) {
            await removeExecutionWorktree({
                projectRoot,
                path: worktree.path,
                branch: worktree.branch,
                force: true,
            }).catch(() => {});
        }
        await Deno.remove(projectRoot, { recursive: true });
        await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
    }
});

Deno.test("prepareTargetBranchRef returns an existing local branch", async () => {
    const projectRoot = await makeRepo();
    try {
        await git(projectRoot, ["checkout", "-b", "feature-base"]);
        await git(projectRoot, ["checkout", "main"]);

        const prepared = await prepareTargetBranchRef(projectRoot, " feature-base ");

        assertEquals(prepared, { baseRef: "refs/heads/feature-base", baseBranch: "feature-base" });
        assertEquals(await git(projectRoot, ["branch", "--show-current"]), "main");
    } finally {
        await Deno.remove(projectRoot, { recursive: true });
    }
});

Deno.test("prepareTargetBranchRef creates a local tracking branch for a remote-only target", async () => {
    const remoteRoot = await makeRepo();
    const projectRoot = await Deno.makeTempDir();
    try {
        await git(remoteRoot, ["checkout", "-b", "feature-base"]);
        await Deno.writeTextFile(`${remoteRoot}/remote.txt`, "remote\n");
        await git(remoteRoot, ["add", "."]);
        await git(remoteRoot, ["commit", "-m", "remote branch"]);
        await git(remoteRoot, ["checkout", "main"]);
        await git(projectRoot, ["clone", remoteRoot, "."]);
        await git(projectRoot, ["checkout", "main"]);
        await git(projectRoot, ["branch", "-D", "feature-base"]).catch(() => Promise.resolve());

        const prepared = await prepareTargetBranchRef(projectRoot, "feature-base");

        assertEquals(prepared, { baseRef: "refs/heads/feature-base", baseBranch: "feature-base" });
        assertEquals(
            await git(projectRoot, ["rev-parse", "--abbrev-ref", "feature-base@{upstream}"]),
            "origin/feature-base",
        );
        assertEquals(await git(projectRoot, ["show", "feature-base:remote.txt"]), "remote");
    } finally {
        await Deno.remove(remoteRoot, { recursive: true });
        await Deno.remove(projectRoot, { recursive: true });
    }
});

Deno.test("prepareTargetBranchRef accepts explicit origin branch input", async () => {
    const remoteRoot = await makeRepo();
    const projectRoot = await Deno.makeTempDir();
    try {
        await git(remoteRoot, ["checkout", "-b", "feature-explicit"]);
        await Deno.writeTextFile(`${remoteRoot}/explicit.txt`, "remote\n");
        await git(remoteRoot, ["add", "."]);
        await git(remoteRoot, ["commit", "-m", "explicit remote branch"]);
        await git(remoteRoot, ["checkout", "main"]);
        await git(projectRoot, ["clone", remoteRoot, "."]);
        await git(projectRoot, ["checkout", "main"]);

        const prepared = await prepareTargetBranchRef(projectRoot, "origin/feature-explicit");

        assertEquals(prepared, { baseRef: "refs/heads/feature-explicit", baseBranch: "feature-explicit" });
        assertEquals(await git(projectRoot, ["show", "feature-explicit:explicit.txt"]), "remote");
    } finally {
        await Deno.remove(remoteRoot, { recursive: true });
        await Deno.remove(projectRoot, { recursive: true });
    }
});

Deno.test("prepareTargetBranchRef creates a new target branch from main", async () => {
    const projectRoot = await makeRepo();
    try {
        const mainCommit = await git(projectRoot, ["rev-parse", "refs/heads/main"]);

        const prepared = await prepareTargetBranchRef(projectRoot, "new-target");

        assertEquals(prepared, { baseRef: "refs/heads/new-target", baseBranch: "new-target" });
        assertEquals(await git(projectRoot, ["rev-parse", "refs/heads/new-target"]), mainCommit);
    } finally {
        await Deno.remove(projectRoot, { recursive: true });
    }
});

Deno.test("prepareTargetBranchRef rejects invalid and reserved branch names", async () => {
    const projectRoot = await makeRepo();
    try {
        await assertRejects(() => prepareTargetBranchRef(projectRoot, "HEAD"), Error, "not HEAD");
        await assertRejects(
            () => prepareTargetBranchRef(projectRoot, "refs/heads/main"),
            Error,
            "must not be a full ref",
        );
        await assertRejects(
            () => prepareTargetBranchRef(projectRoot, "runwield/worktree/demo"),
            Error,
            "reserved execution prefix",
        );
        await assertRejects(() => prepareTargetBranchRef(projectRoot, "bad branch"), Error, "Invalid target branch");
    } finally {
        await Deno.remove(projectRoot, { recursive: true });
    }
});

Deno.test("createExecutionWorktree records supplied target branch independent of current checkout", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir();
    let worktree;
    try {
        await git(projectRoot, ["checkout", "-b", "feature-base"]);
        await Deno.writeTextFile(`${projectRoot}/feature.txt`, "feature-base\n");
        await git(projectRoot, ["add", "."]);
        await git(projectRoot, ["commit", "-m", "feature base"]);
        await git(projectRoot, ["checkout", "main"]);

        worktree = await createExecutionWorktree({
            projectRoot,
            planName: "Targeted Plan",
            baseRef: "refs/heads/feature-base",
            baseBranch: "feature-base",
            worktreeRoot,
        });

        assertEquals(worktree.baseBranch, "feature-base");
        assertEquals(worktree.baseRef, "refs/heads/feature-base");
        assertEquals(await Deno.readTextFile(`${worktree.path}/feature.txt`), "feature-base\n");
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

Deno.test("primary Plan path handoff restores tracked and untracked working files", async () => {
    const projectRoot = await makeRepo();
    try {
        await Deno.mkdir(`${projectRoot}/plans`, { recursive: true });
        await Deno.writeTextFile(`${projectRoot}/plans/tracked.md`, "checked in\n");
        await git(projectRoot, ["add", "plans/tracked.md"]);
        await git(projectRoot, ["commit", "-m", "add plan"]);
        await Deno.writeTextFile(`${projectRoot}/plans/tracked.md`, "staged implemented\n");
        await git(projectRoot, ["add", "plans/tracked.md"]);
        await Deno.writeTextFile(`${projectRoot}/plans/tracked.md`, "unstaged implemented\n");
        await Deno.writeTextFile(`${projectRoot}/plans/untracked.md`, "untracked implemented\n");

        const tracked = await preparePrimaryPlanPathForMerge({
            projectRoot,
            relativePath: "plans/tracked.md",
        });
        const untracked = await preparePrimaryPlanPathForMerge({
            projectRoot,
            relativePath: "plans/untracked.md",
        });
        assertEquals(await Deno.readTextFile(`${projectRoot}/plans/tracked.md`), "checked in\n");
        assertEquals(await git(projectRoot, ["diff", "--cached", "--", "plans/tracked.md"]), "");
        await assertRejects(() => Deno.stat(`${projectRoot}/plans/untracked.md`), Deno.errors.NotFound);

        await restorePrimaryPlanPathAfterMergeFailure(tracked);
        await restorePrimaryPlanPathAfterMergeFailure(untracked);
        assertEquals(await Deno.readTextFile(`${projectRoot}/plans/tracked.md`), "unstaged implemented\n");
        assertEquals(await git(projectRoot, ["show", ":plans/tracked.md"]), "staged implemented");
        assertStringIncludes(await git(projectRoot, ["status", "--short", "--", "plans/tracked.md"]), "MM");
        assertEquals(await Deno.readTextFile(`${projectRoot}/plans/untracked.md`), "untracked implemented\n");
    } finally {
        await Deno.remove(projectRoot, { recursive: true });
    }
});

Deno.test("verified Plan metadata merges with execution changes without dirtying primary checkout", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir();
    /** @type {Awaited<ReturnType<typeof createExecutionWorktree>> | undefined} */
    let worktree;
    try {
        await savePlan(projectRoot, "feature", "# Feature", { status: "ready_for_work" });
        await Deno.writeTextFile(`${projectRoot}/.gitignore`, ".wld/\n");
        await git(projectRoot, ["add", "plans/feature.md", ".gitignore"]);
        await git(projectRoot, ["commit", "-m", "add feature plan"]);
        worktree = await createExecutionWorktree({ projectRoot, planName: "Feature", worktreeRoot });
        await savePlan(projectRoot, "feature", "# Feature", {
            status: "implemented",
            implementedAt: "2026-01-01T00:00:00.000Z",
            worktreeId: worktree.id,
            worktreePath: worktree.path,
            worktreeBranch: worktree.branch,
            worktreeBaseBranch: "main",
            worktreeStatus: "completed",
        });
        await Deno.writeTextFile(`${worktree.path}/feature.txt`, "validated\n");

        await stageValidationPassedInExecutionWorktree({
            projectRoot,
            executionCwd: worktree.path,
            planName: "feature",
            details: { now: () => new Date("2026-01-02T00:00:00.000Z") },
        });
        await preparePrimaryPlanPathForMerge({ projectRoot, relativePath: "plans/feature.md" });
        await mergeExecutionWorktree({
            projectRoot,
            branch: worktree.branch,
            targetBranch: "main",
            worktreePath: worktree.path,
            preservePlanPaths: ["plans/feature.md"],
            planName: "feature",
        });

        assertEquals((await loadPlan(projectRoot, "feature"))?.attrs.status, "verified");
        assertEquals((await loadPlan(projectRoot, "feature"))?.attrs.verifiedAt, "2026-01-02T00:00:00.000Z");
        assertEquals(await Deno.readTextFile(`${projectRoot}/feature.txt`), "validated\n");
        assertEquals(await git(projectRoot, ["status", "--porcelain"]), "");
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

Deno.test("verified Plan metadata conflicts are resolved during worktree merge", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir();
    /** @type {Awaited<ReturnType<typeof createExecutionWorktree>> | undefined} */
    let worktree;
    try {
        await savePlan(projectRoot, "verified-conflict", "# Verified Conflict", { status: "ready_for_work" });
        await Deno.writeTextFile(`${projectRoot}/.gitignore`, ".wld/\n");
        await git(projectRoot, ["add", "plans/verified-conflict.md", ".gitignore"]);
        await git(projectRoot, ["commit", "-m", "add verified conflict plan"]);
        worktree = await createExecutionWorktree({ projectRoot, planName: "Verified Conflict", worktreeRoot });

        await savePlan(projectRoot, "verified-conflict", "# Verified Conflict", {
            status: "implemented",
            implementedAt: "2026-04-01T00:00:00.000Z",
            worktreeId: worktree.id,
            worktreePath: worktree.path,
            worktreeBranch: worktree.branch,
            worktreeBaseBranch: "main",
            worktreeStatus: "completed",
        });
        await git(projectRoot, ["add", "plans/verified-conflict.md"]);
        await git(projectRoot, ["commit", "-m", "record implemented plan state"]);
        await Deno.writeTextFile(`${worktree.path}/verified-conflict.txt`, "validated\n");

        const staged = await stageValidationPassedInExecutionWorktree({
            projectRoot,
            executionCwd: worktree.path,
            planName: "verified-conflict",
            details: { now: () => new Date("2026-04-02T00:00:00.000Z") },
        });
        await mergeExecutionWorktree({
            projectRoot,
            branch: worktree.branch,
            targetBranch: "main",
            worktreePath: worktree.path,
            preservePlanPaths: staged.planPaths,
            planName: "verified-conflict",
        });

        const plan = await loadPlan(projectRoot, "verified-conflict");
        assertEquals(plan?.attrs.status, "verified");
        assertEquals(plan?.attrs.verifiedAt, "2026-04-02T00:00:00.000Z");
        assertEquals(await Deno.readTextFile(`${projectRoot}/verified-conflict.txt`), "validated\n");
        assertEquals(await git(projectRoot, ["status", "--porcelain"]), "");
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

Deno.test("verified child merge ignores independently active sibling Plan metadata", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir();
    /** @type {Awaited<ReturnType<typeof createExecutionWorktree>> | undefined} */
    let worktree;
    try {
        await Deno.writeTextFile(`${projectRoot}/.gitignore`, ".wld/\n");
        await savePlan(
            projectRoot,
            "epic",
            "# Epic",
            /** @type {any} */ ({
                status: "ready_for_work",
                classification: "PROJECT",
                type: "epic",
            }),
        );
        for (const name of ["child-a", "child-b"]) {
            await savePlan(projectRoot, name, `# ${name}`, {
                status: "ready_for_work",
                classification: "FEATURE",
                parentPlan: "epic",
            });
        }
        await git(projectRoot, ["add", "plans", ".gitignore"]);
        await git(projectRoot, ["commit", "-m", "add concurrent children"]);
        worktree = await createExecutionWorktree({ projectRoot, planName: "Child A", worktreeRoot });

        await savePlan(projectRoot, "child-a", "# child-a", {
            status: "implemented",
            classification: "FEATURE",
            parentPlan: "epic",
            worktreeBranch: worktree.branch,
            worktreePath: worktree.path,
        });
        await savePlan(projectRoot, "child-b", "# child-b", {
            status: "in_progress",
            classification: "FEATURE",
            parentPlan: "epic",
            worktreeBranch: "runwield/worktree/child-b-active",
        });

        const staged = await stageValidationPassedInExecutionWorktree({
            projectRoot,
            executionCwd: worktree.path,
            planName: "child-a",
        });
        assertEquals(staged.planPaths, ["plans/child-a.md"]);
        assertEquals((await loadPlan(worktree.path, "child-b"))?.attrs.status, "ready_for_work");
        await preparePrimaryPlanPathForMerge({ projectRoot, relativePath: "plans/child-a.md" });
        await mergeExecutionWorktree({
            projectRoot,
            branch: worktree.branch,
            targetBranch: "main",
            worktreePath: worktree.path,
            preservePlanPaths: staged.planPaths,
            allowedDirtyPaths: ["plans/child-a.md"],
            planName: "child-a",
        });

        assertEquals((await loadPlan(projectRoot, "child-a"))?.attrs.status, "verified");
        assertEquals((await loadPlan(projectRoot, "child-b"))?.attrs.status, "in_progress");
        assertStringIncludes(await git(projectRoot, ["status", "--porcelain", "plans/child-b.md"]), "child-b.md");
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

Deno.test("parent Epic verification survives stale-worktree target alignment", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir();
    /** @type {Awaited<ReturnType<typeof createExecutionWorktree>> | undefined} */
    let worktree;
    try {
        const epicAttrs = /** @type {any} */ ({
            status: "ready_for_work",
            classification: "PROJECT",
            type: "epic",
        });
        await Deno.writeTextFile(`${projectRoot}/.gitignore`, ".wld/\n");
        await savePlan(projectRoot, "epic", "# Epic", epicAttrs);
        await savePlan(projectRoot, "child-a", "# A", {
            status: "ready_for_work",
            classification: "FEATURE",
            parentPlan: "epic",
        });
        await savePlan(projectRoot, "child-b", "# B", {
            status: "ready_for_work",
            classification: "FEATURE",
            parentPlan: "epic",
        });
        await git(projectRoot, ["add", "plans", ".gitignore"]);
        await git(projectRoot, ["commit", "-m", "add epic hierarchy"]);
        worktree = await createExecutionWorktree({ projectRoot, planName: "Child B", worktreeRoot });

        await savePlan(projectRoot, "child-a", "# A", {
            status: "verified",
            classification: "FEATURE",
            parentPlan: "epic",
        });
        await git(projectRoot, ["add", "plans/child-a.md"]);
        await git(projectRoot, ["commit", "-m", "verify first child"]);
        await savePlan(projectRoot, "child-b", "# B", {
            status: "implemented",
            classification: "FEATURE",
            parentPlan: "epic",
            worktreeBranch: worktree.branch,
            worktreePath: worktree.path,
        });

        const staged = await stageValidationPassedInExecutionWorktree({
            projectRoot,
            executionCwd: worktree.path,
            planName: "child-b",
        });
        for (const relativePath of staged.planPaths) {
            await preparePrimaryPlanPathForMerge({ projectRoot, relativePath });
        }
        await mergeExecutionWorktree({
            projectRoot,
            branch: worktree.branch,
            targetBranch: "main",
            worktreePath: worktree.path,
            preservePlanPaths: staged.planPaths,
            planName: "child-b",
        });

        assertEquals((await loadPlan(projectRoot, "child-b"))?.attrs.status, "verified");
        assertEquals((await loadPlan(projectRoot, "epic"))?.attrs.status, "verified");
        assertEquals(await git(projectRoot, ["status", "--porcelain"]), "");
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

Deno.test("verified Plan survives index rollback before continuing a conflicted merge", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir();
    /** @type {Awaited<ReturnType<typeof createExecutionWorktree>> | undefined} */
    let worktree;
    try {
        await savePlan(projectRoot, "conflicted-retry", "# Conflicted Retry", { status: "ready_for_work" });
        await Deno.writeTextFile(`${projectRoot}/conflict.txt`, "base\n");
        await Deno.writeTextFile(`${projectRoot}/.gitignore`, ".wld/\n");
        await git(projectRoot, ["add", "plans/conflicted-retry.md", "conflict.txt", ".gitignore"]);
        await git(projectRoot, ["commit", "-m", "add conflicted retry plan"]);
        worktree = await createExecutionWorktree({ projectRoot, planName: "Conflicted Retry", worktreeRoot });
        const activeWorktree = worktree;

        await Deno.writeTextFile(`${projectRoot}/conflict.txt`, "target\n");
        await git(projectRoot, ["add", "conflict.txt"]);
        await git(projectRoot, ["commit", "-m", "target conflict"]);
        await savePlan(projectRoot, "conflicted-retry", "# Conflicted Retry", {
            status: "implemented",
            worktreeBranch: activeWorktree.branch,
            worktreePath: activeWorktree.path,
        });
        await Deno.writeTextFile(`${activeWorktree.path}/conflict.txt`, "execution\n");
        const staged = await stageValidationPassedInExecutionWorktree({
            projectRoot,
            executionCwd: activeWorktree.path,
            planName: "conflicted-retry",
            details: { now: () => new Date("2026-03-01T00:00:00.000Z") },
        });
        const firstSnapshot = await preparePrimaryPlanPathForMerge({
            projectRoot,
            relativePath: "plans/conflicted-retry.md",
        });

        await assertRejects(() =>
            mergeExecutionWorktree({
                projectRoot,
                branch: activeWorktree.branch,
                targetBranch: "main",
                worktreePath: activeWorktree.path,
                preservePlanPaths: staged.planPaths,
                planName: "conflicted-retry",
            })
        );
        await restorePrimaryPlanPathAfterMergeFailure(firstSnapshot);
        assertEquals((await loadPlan(projectRoot, "conflicted-retry"))?.attrs.status, "implemented");

        await Deno.writeTextFile(`${projectRoot}/conflict.txt`, "resolved\n");
        await git(projectRoot, ["add", "conflict.txt"]);
        const retried = await stageValidationPassedInExecutionWorktree({
            projectRoot,
            executionCwd: activeWorktree.path,
            planName: "conflicted-retry",
            details: { now: () => new Date("2026-03-02T00:00:00.000Z") },
        });
        await preparePrimaryPlanPathForMerge({ projectRoot, relativePath: "plans/conflicted-retry.md" });
        await mergeExecutionWorktree({
            projectRoot,
            branch: activeWorktree.branch,
            targetBranch: "main",
            worktreePath: activeWorktree.path,
            preservePlanPaths: retried.planPaths,
            planName: "conflicted-retry",
        });

        assertEquals((await loadPlan(projectRoot, "conflicted-retry"))?.attrs.status, "verified");
        assertEquals((await loadPlan(projectRoot, "conflicted-retry"))?.attrs.verifiedAt, "2026-03-01T00:00:00.000Z");
        assertEquals(await Deno.readTextFile(`${projectRoot}/conflict.txt`), "resolved\n");
        assertEquals(await git(projectRoot, ["status", "--porcelain"]), "");
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

Deno.test("verified Plan handoff rolls back exactly and retries with stable metadata", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir();
    /** @type {Awaited<ReturnType<typeof createExecutionWorktree>> | undefined} */
    let worktree;
    try {
        await Deno.writeTextFile(`${projectRoot}/.gitignore`, ".wld/\n");
        await savePlan(projectRoot, "retry", "# Retry", { status: "ready_for_work" });
        await git(projectRoot, ["add", "plans/retry.md", ".gitignore"]);
        await git(projectRoot, ["commit", "-m", "add retry plan"]);
        worktree = await createExecutionWorktree({ projectRoot, planName: "Retry", worktreeRoot });
        const activeWorktree = worktree;
        await savePlan(projectRoot, "retry", "# Retry", {
            status: "implemented",
            worktreeBranch: worktree.branch,
            worktreePath: worktree.path,
        });
        const staged = await stageValidationPassedInExecutionWorktree({
            projectRoot,
            executionCwd: worktree.path,
            planName: "retry",
            details: { now: () => new Date("2026-02-01T00:00:00.000Z") },
        });
        const snapshot = await preparePrimaryPlanPathForMerge({
            projectRoot,
            relativePath: "plans/retry.md",
        });

        await assertRejects(() =>
            mergeExecutionWorktree({
                projectRoot,
                branch: activeWorktree.branch,
                targetBranch: "missing-target",
                worktreePath: activeWorktree.path,
                preservePlanPaths: staged.planPaths,
                planName: "retry",
            })
        );
        await restorePrimaryPlanPathAfterMergeFailure(snapshot);
        assertEquals((await loadPlan(projectRoot, "retry"))?.attrs.status, "implemented");
        assertEquals((await loadPlan(activeWorktree.path, "retry"))?.attrs.verifiedAt, "2026-02-01T00:00:00.000Z");

        const retried = await stageValidationPassedInExecutionWorktree({
            projectRoot,
            executionCwd: worktree.path,
            planName: "retry",
            details: { now: () => new Date("2026-02-02T00:00:00.000Z") },
        });
        await preparePrimaryPlanPathForMerge({ projectRoot, relativePath: "plans/retry.md" });
        await mergeExecutionWorktree({
            projectRoot,
            branch: worktree.branch,
            targetBranch: "main",
            worktreePath: worktree.path,
            preservePlanPaths: retried.planPaths,
            planName: "retry",
        });

        assertEquals((await loadPlan(projectRoot, "retry"))?.attrs.verifiedAt, "2026-02-01T00:00:00.000Z");
        assertEquals(await git(projectRoot, ["status", "--porcelain"]), "");
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
