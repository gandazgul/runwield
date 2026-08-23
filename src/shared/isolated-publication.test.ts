import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import {
    isExecutionCommitPublishedUpstream,
    IsolatedPublicationError,
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

Deno.test("a remote policy rejection is typed as fatal and leaves the execution branch recoverable", async () => {
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
        await Deno.writeTextFile(
            hookPath,
            "#!/bin/sh\necho 'protected branch policy: pre-receive hook declined' >&2\nexit 1\n",
        );
        await Deno.chmod(hookPath, 0o755);

        const failure = await assertRejects(() =>
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
        assert(failure instanceof IsolatedPublicationError);
        assertEquals(failure.mergeFailureKind, "policy_violation");

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

Deno.test("force-with-lease rejection is typed as a target race", async () => {
    const projectRoot = await makeRepo();
    const remoteRoot = await Deno.makeTempDir({ prefix: "runwield-publication-lease-race-" });
    const worktreeRoot = await Deno.makeTempDir({ prefix: "runwield-publication-lease-worktree-" });
    let worktree: Awaited<ReturnType<typeof createTestWorktreeAttempt>> | undefined;
    try {
        await git(remoteRoot, ["init", "--bare"]);
        await git(projectRoot, ["remote", "add", "origin", remoteRoot]);
        await git(projectRoot, ["push", "-u", "origin", "main"]);
        worktree = await createTestWorktreeAttempt({ projectRoot, planName: "lease-race", worktreeRoot });
        await Deno.writeTextFile(`${worktree.path}/implementation.txt`, "safe candidate\n");
        await git(worktree.path, ["add", "implementation.txt"]);
        await git(worktree.path, ["commit", "-m", "Validated candidate"]);
        const sealedCommit = await git(worktree.path, ["rev-parse", "HEAD"]);
        const hookPath = `${remoteRoot}/hooks/pre-receive`;
        await Deno.writeTextFile(hookPath, "#!/bin/sh\necho 'stale info: target moved' >&2\nexit 1\n");
        await Deno.chmod(hookPath, 0o755);

        const failure = await assertRejects(() =>
            publishExecutionWorktreeIsolated({
                projectRoot,
                executionCwd: worktree!.path,
                executionBranch: worktree!.branch,
                targetBranch: "main",
                planName: "lease-race",
                sealedExecutionCommit: sealedCommit,
                allowedPlanPaths: [],
            })
        );

        assert(failure instanceof IsolatedPublicationError);
        assertEquals(failure.mergeFailureKind, "target_reference_race");
        assertStringIncludes(failure.message, "force-with-lease");
    } finally {
        if (worktree) {
            await removeWorktreeGitArtifacts({ projectRoot, path: worktree.path, force: true }).catch(() => {});
        }
        await Deno.remove(projectRoot, { recursive: true }).catch(() => {});
        await Deno.remove(remoteRoot, { recursive: true }).catch(() => {});
        await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
    }
});

Deno.test("unreachable upstream is typed as transient without changing the primary checkout", async () => {
    const projectRoot = await makeRepo();
    const remoteRoot = await Deno.makeTempDir({ prefix: "runwield-publication-unavailable-remote-" });
    const worktreeRoot = await Deno.makeTempDir({ prefix: "runwield-publication-unavailable-worktree-" });
    let worktree: Awaited<ReturnType<typeof createTestWorktreeAttempt>> | undefined;
    try {
        await git(remoteRoot, ["init", "--bare"]);
        await git(projectRoot, ["remote", "add", "origin", remoteRoot]);
        await git(projectRoot, ["push", "-u", "origin", "main"]);
        worktree = await createTestWorktreeAttempt({ projectRoot, planName: "remote-down", worktreeRoot });
        await Deno.writeTextFile(`${worktree.path}/implementation.txt`, "safe candidate\n");
        await git(worktree.path, ["add", "implementation.txt"]);
        await git(worktree.path, ["commit", "-m", "Validated candidate"]);
        const sealedCommit = await git(worktree.path, ["rev-parse", "HEAD"]);
        const primaryHead = await git(projectRoot, ["rev-parse", "HEAD"]);
        await git(projectRoot, ["remote", "set-url", "origin", `${remoteRoot}-missing`]);

        const failure = await assertRejects(() =>
            publishExecutionWorktreeIsolated({
                projectRoot,
                executionCwd: worktree!.path,
                executionBranch: worktree!.branch,
                targetBranch: "main",
                planName: "remote-down",
                sealedExecutionCommit: sealedCommit,
                allowedPlanPaths: [],
            })
        );

        assert(failure instanceof IsolatedPublicationError);
        assertEquals(failure.mergeFailureKind, "remote_unavailable");
        assertEquals(await git(projectRoot, ["rev-parse", "HEAD"]), primaryHead);
    } finally {
        if (worktree) {
            await removeWorktreeGitArtifacts({ projectRoot, path: worktree.path, force: true }).catch(() => {});
        }
        await Deno.remove(projectRoot, { recursive: true }).catch(() => {});
        await Deno.remove(remoteRoot, { recursive: true }).catch(() => {});
        await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
    }
});

Deno.test("completed publication repair imports a newer execution commit before retrying", async () => {
    const projectRoot = await makeRepo();
    const remoteRoot = await Deno.makeTempDir({ prefix: "runwield-repaired-publication-remote-" });
    const worktreeRoot = await Deno.makeTempDir({ prefix: "runwield-repaired-publication-worktree-" });
    let worktree: Awaited<ReturnType<typeof createTestWorktreeAttempt>> | undefined;
    let repairRoot: string | undefined;
    try {
        await Deno.writeTextFile(`${projectRoot}/conflict.txt`, "base\n");
        await git(projectRoot, ["add", "conflict.txt"]);
        await git(projectRoot, ["commit", "-m", "Add conflict fixture"]);
        await git(remoteRoot, ["init", "--bare"]);
        await git(projectRoot, ["remote", "add", "origin", remoteRoot]);
        await git(projectRoot, ["push", "-u", "origin", "main"]);

        worktree = await createTestWorktreeAttempt({ projectRoot, planName: "repaired-delivery", worktreeRoot });
        await Deno.writeTextFile(`${worktree.path}/conflict.txt`, "execution\n");
        await git(worktree.path, ["add", "conflict.txt"]);
        await git(worktree.path, ["commit", "-m", "Validated conflicting candidate"]);
        const firstSealedCommit = await git(worktree.path, ["rev-parse", "HEAD"]);

        await Deno.writeTextFile(`${projectRoot}/conflict.txt`, "target\n");
        await git(projectRoot, ["add", "conflict.txt"]);
        await git(projectRoot, ["commit", "-m", "Advance target with conflict"]);
        await git(projectRoot, ["push", "origin", "main"]);

        try {
            await publishExecutionWorktreeIsolated({
                projectRoot,
                executionCwd: worktree.path,
                executionBranch: worktree.branch,
                targetBranch: "main",
                planName: "repaired-delivery",
                sealedExecutionCommit: firstSealedCommit,
                allowedPlanPaths: [],
            });
            throw new Error("Expected the first publication attempt to conflict.");
        } catch (error) {
            if (!(error instanceof IsolatedPublicationError) || !error.mergeWorktreePath) throw error;
            repairRoot = error.mergeWorktreePath;
        }

        assert(repairRoot);
        await Deno.writeTextFile(`${repairRoot}/conflict.txt`, "resolved\n");
        await git(repairRoot, ["add", "conflict.txt"]);
        await git(repairRoot, ["commit", "--no-edit"]);

        await Deno.writeTextFile(`${projectRoot}/arrived-during-repair.txt`, "must survive publication retry\n");
        await git(projectRoot, ["add", "arrived-during-repair.txt"]);
        await git(projectRoot, ["commit", "-m", "Advance target while publication repair is pending"]);
        await git(projectRoot, ["push", "origin", "main"]);
        const targetHeadAfterRepairStarted = await git(projectRoot, ["rev-parse", "HEAD"]);

        await Deno.writeTextFile(`${worktree.path}/final-lifecycle.txt`, "recorded after repair\n");
        await git(worktree.path, ["add", "final-lifecycle.txt"]);
        await git(worktree.path, ["commit", "-m", "Record final lifecycle state"]);
        const finalSealedCommit = await git(worktree.path, ["rev-parse", "HEAD"]);

        const published = await publishExecutionWorktreeIsolated({
            projectRoot,
            executionCwd: worktree.path,
            executionBranch: worktree.branch,
            targetBranch: "main",
            planName: "repaired-delivery",
            sealedExecutionCommit: finalSealedCommit,
            allowedPlanPaths: [],
            repairedPublicationRoot: repairRoot,
        });

        const remoteHead = (await git(projectRoot, ["ls-remote", "origin", "refs/heads/main"])).split(/\s+/)[0];
        assertEquals(remoteHead, published.publicationCommit);
        await git(projectRoot, ["fetch", "origin", "main"]);
        await git(projectRoot, ["merge-base", "--is-ancestor", finalSealedCommit, "origin/main"]);
        await git(projectRoot, ["merge-base", "--is-ancestor", targetHeadAfterRepairStarted, "origin/main"]);
        assertEquals(await git(projectRoot, ["show", "origin/main:conflict.txt"]), "resolved");
        assertEquals(await git(projectRoot, ["show", "origin/main:final-lifecycle.txt"]), "recorded after repair");
        assertEquals(
            await git(projectRoot, ["show", "origin/main:arrived-during-repair.txt"]),
            "must survive publication retry",
        );
        repairRoot = undefined;
    } finally {
        if (worktree) {
            await removeWorktreeGitArtifacts({ projectRoot, path: worktree.path, force: true }).catch(() => {});
        }
        if (repairRoot) await Deno.remove(repairRoot, { recursive: true }).catch(() => {});
        await Deno.remove(projectRoot, { recursive: true }).catch(() => {});
        await Deno.remove(remoteRoot, { recursive: true }).catch(() => {});
        await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
    }
});
