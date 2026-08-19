import { assert, assertEquals, assertRejects } from "@std/assert";
import { publishExecutionWorktreeIsolated } from "./isolated-publication.ts";
import { createTestWorktreeAttempt, git, makeRepo } from "./worktree-test-helpers.js";
import { removeWorktreeGitArtifacts } from "./worktree.js";

Deno.test("isolated publication pushes the target upstream without touching the primary checkout", async () => {
    const projectRoot = await makeRepo();
    const remoteRoot = await Deno.makeTempDir({ prefix: "runwield-publication-remote-" });
    const worktreeRoot = await Deno.makeTempDir({ prefix: "runwield-publication-worktree-" });
    let worktree: Awaited<ReturnType<typeof createTestWorktreeAttempt>> | undefined;
    try {
        await git(remoteRoot, ["init", "--bare"]);
        await git(projectRoot, ["remote", "add", "origin", remoteRoot]);
        await git(projectRoot, ["push", "-u", "origin", "main"]);
        worktree = await createTestWorktreeAttempt({ projectRoot, planName: "isolated-delivery", worktreeRoot });
        await Deno.writeTextFile(`${worktree.path}/implementation.txt`, "validated implementation\n");
        await Deno.mkdir(`${worktree.path}/docs/work-records`, { recursive: true });
        await Deno.writeTextFile(`${worktree.path}/docs/work-records/isolated.md`, "work record\n");
        await git(worktree.path, ["add", "implementation.txt", "docs/work-records/isolated.md"]);
        await git(worktree.path, ["commit", "-m", "Validated execution candidate"]);
        const sealedCommit = await git(worktree.path, ["rev-parse", "HEAD"]);

        await Deno.writeTextFile(`${projectRoot}/README.md`, "user's uncommitted primary work\n");
        await Deno.writeTextFile(`${projectRoot}/untracked.txt`, "leave me alone\n");
        const primaryHead = await git(projectRoot, ["rev-parse", "main"]);
        const primaryStatus = await git(projectRoot, ["status", "--porcelain", "--untracked-files=all"]);

        const published = await publishExecutionWorktreeIsolated({
            projectRoot,
            executionCwd: worktree.path,
            executionBranch: worktree.branch,
            targetBranch: "main",
            planName: "isolated-delivery",
            sealedExecutionCommit: sealedCommit,
            allowedPlanPaths: [],
        });

        assertEquals(await git(projectRoot, ["rev-parse", "main"]), primaryHead);
        assertEquals(await git(projectRoot, ["status", "--porcelain", "--untracked-files=all"]), primaryStatus);
        assertEquals(await Deno.readTextFile(`${projectRoot}/README.md`), "user's uncommitted primary work\n");
        assertEquals(await Deno.readTextFile(`${projectRoot}/untracked.txt`), "leave me alone\n");
        const remoteHead = await git(projectRoot, ["ls-remote", "origin", "refs/heads/main"]);
        assertEquals(remoteHead.split(/\s+/)[0], published.publicationCommit);
        await git(projectRoot, ["fetch", "origin", "main"]);
        await git(projectRoot, ["merge-base", "--is-ancestor", sealedCommit, "origin/main"]);
        assertEquals(await git(projectRoot, ["show", "origin/main:implementation.txt"]), "validated implementation");
        assertEquals(await git(projectRoot, ["show", "origin/main:docs/work-records/isolated.md"]), "work record");
    } finally {
        if (worktree) {
            await removeWorktreeGitArtifacts({ projectRoot, path: worktree.path, force: true }).catch(() => {});
        }
        await Deno.remove(projectRoot, { recursive: true }).catch(() => {});
        await Deno.remove(remoteRoot, { recursive: true }).catch(() => {});
        await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
    }
});

Deno.test("failed upstream publication leaves the validated execution branch recoverable", async () => {
    const projectRoot = await makeRepo();
    const remoteRoot = await Deno.makeTempDir({ prefix: "runwield-publication-rejecting-remote-" });
    const worktreeRoot = await Deno.makeTempDir({ prefix: "runwield-publication-retry-worktree-" });
    let worktree: Awaited<ReturnType<typeof createTestWorktreeAttempt>> | undefined;
    try {
        await git(remoteRoot, ["init", "--bare"]);
        await git(projectRoot, ["remote", "add", "origin", remoteRoot]);
        await git(projectRoot, ["push", "-u", "origin", "main"]);
        worktree = await createTestWorktreeAttempt({ projectRoot, planName: "retryable-delivery", worktreeRoot });
        await Deno.writeTextFile(`${worktree.path}/implementation.txt`, "safe candidate\n");
        await git(worktree.path, ["add", "implementation.txt"]);
        await git(worktree.path, ["commit", "-m", "Validated retryable candidate"]);
        const sealedCommit = await git(worktree.path, ["rev-parse", "HEAD"]);
        const remoteHeadBefore = (await git(projectRoot, ["ls-remote", "origin", "refs/heads/main"]))
            .split(/\s+/)[0];
        const hookPath = `${remoteRoot}/hooks/pre-receive`;
        await Deno.writeTextFile(hookPath, "#!/bin/sh\nexit 1\n");
        await Deno.chmod(hookPath, 0o755);

        await assertRejects(() =>
            publishExecutionWorktreeIsolated({
                projectRoot,
                executionCwd: worktree!.path,
                executionBranch: worktree!.branch,
                targetBranch: "main",
                planName: "retryable-delivery",
                sealedExecutionCommit: sealedCommit,
                allowedPlanPaths: [],
            })
        );

        assert((await Deno.stat(worktree.path)).isDirectory);
        assertEquals(await git(worktree.path, ["rev-parse", "HEAD"]), sealedCommit);
        assertEquals(await git(projectRoot, ["rev-parse", worktree.branch]), sealedCommit);
        const remoteHeadAfter = (await git(projectRoot, ["ls-remote", "origin", "refs/heads/main"]))
            .split(/\s+/)[0];
        assertEquals(remoteHeadAfter, remoteHeadBefore);
    } finally {
        if (worktree) {
            await removeWorktreeGitArtifacts({ projectRoot, path: worktree.path, force: true }).catch(() => {});
        }
        await Deno.remove(projectRoot, { recursive: true }).catch(() => {});
        await Deno.remove(remoteRoot, { recursive: true }).catch(() => {});
        await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
    }
});
