import { assertEquals } from "@std/assert";

import { createExecutionWorktree, inspectExecutionWorktreeMergeRisk, removeExecutionWorktree } from "./worktree.js";

import { git, makeRepo } from "./worktree-test-helpers.js";

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
