import { assert, assertEquals, assertRejects } from "@std/assert";
import {
    isExecutionCommitPublishedUpstream,
    type IsolatedPublicationProgress,
    publishExecutionWorktreeIsolated,
} from "./isolated-publication.ts";
import { createTestWorktreeAttempt, git, makeRepo } from "./worktree-test-helpers.js";
import { removeWorktreeGitArtifacts } from "./worktree.js";
import { RUNWIELD_GITIGNORE_BLOCK } from "./runwield-owned-paths.ts";

Deno.test("publication without a remote safely advances the local target branch", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir({ prefix: "runwield-local-publication-worktree-" });
    let worktree: Awaited<ReturnType<typeof createTestWorktreeAttempt>> | undefined;
    try {
        worktree = await createTestWorktreeAttempt({ projectRoot, planName: "local-delivery", worktreeRoot });
        await Deno.writeTextFile(`${projectRoot}/.gitignore`, RUNWIELD_GITIGNORE_BLOCK);
        await Deno.writeTextFile(`${projectRoot}/untracked-user-note.txt`, "preserve me\n");
        await Deno.writeTextFile(
            `${worktree.path}/.gitignore`,
            `node_modules\n${RUNWIELD_GITIGNORE_BLOCK}`,
        );
        await Deno.writeTextFile(`${worktree.path}/implementation.txt`, "local validated implementation\n");
        await git(worktree.path, ["add", ".gitignore", "implementation.txt"]);
        await git(worktree.path, ["commit", "-m", "Validated local candidate"]);
        const sealedCommit = await git(worktree.path, ["rev-parse", "HEAD"]);
        const oldMain = await git(projectRoot, ["rev-parse", "main"]);
        const progress: IsolatedPublicationProgress[] = [];

        const published = await publishExecutionWorktreeIsolated({
            projectRoot,
            executionCwd: worktree.path,
            executionBranch: worktree.branch,
            targetBranch: "main",
            planName: "local-delivery",
            sealedExecutionCommit: sealedCommit,
            allowedPlanPaths: [],
            onProgress: (step) => progress.push(step),
        });

        assertEquals(published.publicationMode, "local");
        assertEquals(progress, ["preparing", "reading_target", "using_local_target", "combining_work", "verifying"]);
        assert((await git(projectRoot, ["rev-parse", "main"])) !== oldMain);
        await git(projectRoot, ["merge-base", "--is-ancestor", sealedCommit, "main"]);
        assertEquals(await Deno.readTextFile(`${projectRoot}/implementation.txt`), "local validated implementation\n");
        assertEquals(await Deno.readTextFile(`${projectRoot}/untracked-user-note.txt`), "preserve me\n");
        assertEquals(await Deno.readTextFile(`${projectRoot}/.gitignore`), `node_modules\n${RUNWIELD_GITIGNORE_BLOCK}`);
        assertEquals(
            await isExecutionCommitPublishedUpstream({
                projectRoot,
                executionBranch: worktree.branch,
                targetBranch: "main",
                executionCommit: sealedCommit,
            }),
            true,
        );
    } finally {
        if (worktree) {
            await removeWorktreeGitArtifacts({ projectRoot, path: worktree.path, force: true }).catch(() => {});
        }
        await Deno.remove(projectRoot, { recursive: true }).catch(() => {});
        await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
    }
});

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
        assertEquals(
            await isExecutionCommitPublishedUpstream({
                projectRoot,
                executionBranch: worktree.branch,
                targetBranch: "main",
                executionCommit: sealedCommit,
            }),
            false,
        );

        const progress: IsolatedPublicationProgress[] = [];
        const published = await publishExecutionWorktreeIsolated({
            projectRoot,
            executionCwd: worktree.path,
            executionBranch: worktree.branch,
            targetBranch: "main",
            planName: "isolated-delivery",
            sealedExecutionCommit: sealedCommit,
            allowedPlanPaths: [],
            onProgress: (step) => progress.push(step),
        });

        assertEquals(progress, ["preparing", "reading_target", "combining_work", "publishing", "verifying"]);

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
        assertEquals(
            await isExecutionCommitPublishedUpstream({
                projectRoot,
                executionBranch: worktree.branch,
                targetBranch: "main",
                executionCommit: sealedCommit,
            }),
            true,
        );
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
