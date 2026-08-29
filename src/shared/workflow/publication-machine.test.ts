import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { addEntry } from "../worktree-registry.js";
import {
    advanceStoredPublication,
    loadPublicationAttempt,
    publicationRootForAttempt,
    startPublicationAttempt,
} from "./publication-machine.ts";

async function fixture() {
    const projectRoot = await Deno.makeTempDir({ prefix: "publication-machine-" });
    await addEntry(projectRoot, {
        id: "attempt-1",
        planId: "plan-1",
        planName: "demo",
        baseBranch: "main",
        baseRef: "refs/heads/main",
        baseCommit: "a".repeat(40),
        branch: "worktree/demo",
        path: join(projectRoot, "execution"),
        status: "completed",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
    });
    return projectRoot;
}

Deno.test("publication machine persists one compare-and-swap attempt in the worktree registry", async () => {
    const projectRoot = await fixture();
    try {
        const started = await startPublicationAttempt({
            projectRoot,
            attemptId: "attempt-1",
            planName: "demo",
            targetBranch: "main",
            executionBranch: "worktree/demo",
            executionCwd: join(projectRoot, "execution"),
            validatedCommit: "b".repeat(40),
            targetHeadAtSeal: "a".repeat(40),
        });
        assertEquals(started.publicationRoot, publicationRootForAttempt(projectRoot, "attempt-1"));
        const artifacts = await advanceStoredPublication(projectRoot, started, "artifacts_committed", {
            artifactCommit: "c".repeat(40),
            planPaths: ["docs/plans/demo.md"],
        });
        assertEquals((await loadPublicationAttempt(projectRoot, "attempt-1"))?.phase, "artifacts_committed");
        const repeated = await advanceStoredPublication(projectRoot, started, "artifacts_committed", {
            artifactCommit: "c".repeat(40),
            planPaths: ["docs/plans/demo.md"],
        });
        assertEquals(repeated, artifacts);
        await assertRejects(
            () =>
                advanceStoredPublication(projectRoot, started, "artifacts_committed", {
                    artifactCommit: "d".repeat(40),
                    planPaths: ["docs/plans/demo.md"],
                }),
            Error,
            "conflicting artifactCommit",
        );
        assertEquals(artifacts.artifactCommit, "c".repeat(40));
    } finally {
        await Deno.remove(projectRoot, { recursive: true });
    }
});

Deno.test("publication machine resumes the existing attempt instead of replacing its sealed commit", async () => {
    const projectRoot = await fixture();
    try {
        const started = await startPublicationAttempt({
            projectRoot,
            attemptId: "attempt-1",
            planName: "demo",
            targetBranch: "main",
            executionBranch: "worktree/demo",
            executionCwd: join(projectRoot, "execution"),
            validatedCommit: "b".repeat(40),
            targetHeadAtSeal: "a".repeat(40),
        });
        const resumed = await startPublicationAttempt({
            projectRoot,
            attemptId: "attempt-1",
            planName: "demo",
            targetBranch: "main",
            executionBranch: "worktree/demo",
            executionCwd: join(projectRoot, "execution"),
            validatedCommit: "e".repeat(40),
            targetHeadAtSeal: "a".repeat(40),
        });
        assertEquals(resumed.validatedCommit, started.validatedCommit);
        assertEquals(resumed.revision, started.revision);
    } finally {
        await Deno.remove(projectRoot, { recursive: true });
    }
});

Deno.test("publication machine can replace a stale integration before the target is published", async () => {
    const projectRoot = await fixture();
    try {
        const started = await startPublicationAttempt({
            projectRoot,
            attemptId: "attempt-1",
            planName: "demo",
            targetBranch: "main",
            executionBranch: "worktree/demo",
            executionCwd: join(projectRoot, "execution"),
            validatedCommit: "b".repeat(40),
            targetHeadAtSeal: "a".repeat(40),
        });
        const artifacts = await advanceStoredPublication(projectRoot, started, "artifacts_committed", {
            artifactCommit: "c".repeat(40),
            planPaths: ["docs/plans/demo.md"],
        });
        const firstIntegration = await advanceStoredPublication(projectRoot, artifacts, "target_integrated", {
            targetBaseCommit: "d".repeat(40),
            integrationCommit: "e".repeat(40),
        });
        const refreshedIntegration = await advanceStoredPublication(
            projectRoot,
            firstIntegration,
            "target_integrated",
            {
                targetBaseCommit: "f".repeat(40),
                integrationCommit: "1".repeat(40),
            },
        );

        assertEquals(refreshedIntegration.phase, "target_integrated");
        assertEquals(refreshedIntegration.targetBaseCommit, "f".repeat(40));
        assertEquals(refreshedIntegration.integrationCommit, "1".repeat(40));
        assertEquals(refreshedIntegration.revision, firstIntegration.revision + 1);
    } finally {
        await Deno.remove(projectRoot, { recursive: true });
    }
});
