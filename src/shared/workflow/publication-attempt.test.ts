import { assertEquals, assertThrows } from "@std/assert";
import {
    advancePublicationAttempt,
    assertPublicationAttempt,
    createPublicationAttempt,
    publicationPhaseAtLeast,
    recordPublicationFailure,
} from "./publication-attempt.ts";

function candidate() {
    return createPublicationAttempt({
        attemptId: "attempt-1",
        planId: "plan-1",
        planName: "demo",
        targetBranch: "main",
        executionBranch: "worktree/demo",
        executionCwd: "/tmp/execution",
        publicationRoot: "/tmp/publication",
        validatedCommit: "a".repeat(40),
        targetHeadAtSeal: "f".repeat(40),
        now: "2026-01-01T00:00:00.000Z",
    });
}

Deno.test("publication phases advance only with the Git evidence required by that phase", () => {
    const sealed = candidate();
    const artifacts = advancePublicationAttempt(
        sealed,
        "artifacts_committed",
        { artifactCommit: "b".repeat(40), planPaths: ["docs/plans/demo.md"] },
        "2026-01-01T00:01:00.000Z",
    );
    const integrated = advancePublicationAttempt(artifacts, "target_integrated", {
        targetBaseCommit: "c".repeat(40),
        integrationCommit: "d".repeat(40),
    });
    const published = advancePublicationAttempt(integrated, "target_published", {
        publicationMode: "remote",
        publishedCommit: "d".repeat(40),
        upstreamRemote: "origin",
        upstreamBranch: "main",
    });
    const verified = advancePublicationAttempt(published, "publication_verified", {
        verifiedAt: "2026-01-01T00:02:00.000Z",
    });
    const complete = advancePublicationAttempt(verified, "cleanup_complete", {
        cleanedAt: "2026-01-01T00:03:00.000Z",
    });

    assertPublicationAttempt(complete);
    assertEquals(complete.phase, "cleanup_complete");
    assertEquals(complete.revision, 6);
    assertEquals(publicationPhaseAtLeast(complete.phase, "target_published"), true);
});

Deno.test("publication phases reject missing evidence, skipped phases, and backward movement", () => {
    const sealed = candidate();
    assertThrows(
        () => advancePublicationAttempt(sealed, "artifacts_committed", {}),
        Error,
        "requires artifactCommit",
    );
    assertThrows(
        () => advancePublicationAttempt(sealed, "target_integrated", {}),
        Error,
        "cannot skip",
    );
    const artifacts = advancePublicationAttempt(sealed, "artifacts_committed", {
        artifactCommit: "b".repeat(40),
        planPaths: ["docs/plans/demo.md"],
    });
    assertThrows(
        () => advancePublicationAttempt(artifacts, "candidate_sealed", {}),
        Error,
        "cannot move backward",
    );
});

Deno.test("publication failures annotate the current phase without changing proven progress", () => {
    const sealed = candidate();
    const failed = recordPublicationFailure(sealed, {
        kind: "remote_unavailable",
        message: "offline",
        repairRoot: "/tmp/publication",
    }, "2026-01-01T00:01:00.000Z");
    assertEquals(failed.phase, "candidate_sealed");
    assertEquals(failed.failure, {
        phase: "candidate_sealed",
        kind: "remote_unavailable",
        message: "offline",
        repairRoot: "/tmp/publication",
        recordedAt: "2026-01-01T00:01:00.000Z",
    });
});
