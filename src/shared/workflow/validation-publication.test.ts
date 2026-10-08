import { advancePublicationAttempt, createPublicationAttempt } from "./publication-attempt.ts";
import { createTestWorktreeAttempt, git, makeRepo } from "../worktree-test-helpers.ts";
import { removeWorktreeGitArtifacts } from "../worktree.js";
import { withRuntimeCommandFixture } from "../../cmd/testing/runtime-command-fixture.ts";
import { HostedSession } from "../session/hosted-session.js";
import type { RuntimeSystemStatusEvent, SessionRuntimeEvent } from "../session/session-runtime-events.js";
import { createValidationSessionPort } from "./validation-session-adapter.ts";
import { createProgressRecord } from "./validation-emit.ts";
import { createGitPort } from "../git-port.ts";
import { createWorkRecordMnemotecaFixture } from "../work-records/test-fixtures/mnemoteca-port.ts";
import { buildVerifiedResult } from "./validation-publication.ts";
import { assertEquals, assertStringIncludes } from "@std/assert";
import { loadPlan, PlanLockTimeoutError, savePlan } from "../../plan-store.js";

import { classifyValidationOperationalError, type GitPublicationErrorKind } from "./validation-operational-errors.ts";
import { decideValidationRecovery, DEFAULT_VALIDATION_RETRY_POLICY } from "./validation-recovery.ts";
import {
    annotatePublicationStage,
    normalizePublicationFailure,
    publicationFailureNeedsUserAction,
} from "./validation-merge-repair.ts";
import { publicationFailureKindFromMergeKind } from "./validation-publication.ts";
import { buildValidationUserMessage } from "./validation-user-messages.ts";

function decidePublicationFailure(kind: GitPublicationErrorKind) {
    return decideValidationRecovery({
        failure: classifyValidationOperationalError({
            source: "git_publication",
            kind,
            operation: "publication",
            message: `${kind} during publication`,
        }),
        attempt: 1,
        correctionAttempt: 1,
        nextPhase: "delivery",
        policy: DEFAULT_VALIDATION_RETRY_POLICY,
        randomUnit: 0,
    });
}

Deno.test("publication dispatches merge repair only for a content conflict", () => {
    const cases: Array<{ kind: GitPublicationErrorKind; action: "retry" | "correct" | "pause" | "halt" }> = [
        { kind: "target_reference_race", action: "retry" },
        { kind: "remote_unavailable", action: "retry" },
        { kind: "content_conflict", action: "correct" },
        { kind: "primary_checkout_dirty", action: "pause" },
        { kind: "post_publication_bookkeeping", action: "pause" },
        { kind: "permission_denied", action: "halt" },
        { kind: "policy_violation", action: "halt" },
    ];

    for (const scenario of cases) {
        const decision = decidePublicationFailure(scenario.kind);
        assertEquals(decision.action, scenario.action, scenario.kind);
    }
});

Deno.test("permission and branch-policy failures halt publication", () => {
    const permissionDenied = decidePublicationFailure("permission_denied");
    assertEquals(permissionDenied.action, "halt");
    assertEquals(permissionDenied.result.kind, "terminal");

    const policyViolation = decidePublicationFailure("policy_violation");
    assertEquals(policyViolation.action, "halt");
    assertEquals(policyViolation.result.kind, "terminal");
});

Deno.test("publication maps local merge conflicts to correction and protected-branch rejection to fatal", () => {
    assertEquals(publicationFailureKindFromMergeKind("local_publication_conflict"), "content_conflict");
    assertEquals(
        decidePublicationFailure(publicationFailureKindFromMergeKind("local_publication_conflict")).action,
        "correct",
    );

    assertEquals(publicationFailureKindFromMergeKind("policy_violation"), "policy_violation");
    assertEquals(decidePublicationFailure(publicationFailureKindFromMergeKind("policy_violation")).action, "halt");
});

Deno.test("publication offers Retry only when the user can change the outcome", () => {
    assertEquals(
        publicationFailureNeedsUserAction(normalizePublicationFailure(new Error("internal publication failure"))),
        false,
    );
    assertEquals(
        publicationFailureNeedsUserAction(
            normalizePublicationFailure(
                Object.assign(new Error("conflict"), { mergeFailureKind: "isolated_publication_conflict" }),
            ),
        ),
        true,
    );
    assertEquals(
        publicationFailureNeedsUserAction(
            normalizePublicationFailure(
                Object.assign(new Error("push failed"), { mergeFailureKind: "publication_push_failed" }),
            ),
        ),
        true,
    );
});

Deno.test("publication failures retain the stage that actually failed", () => {
    const error = annotatePublicationStage(new Error("pre-commit hook failed"), "candidate_checkpoint");
    const failure = normalizePublicationFailure(error);
    assertEquals(failure.reason, "pre-commit hook failed");
    assertEquals(failure.publicationStage, "candidate_checkpoint");
});

Deno.test("a checkpoint failure does not claim the saved publication copy is incomplete", () => {
    const message = buildValidationUserMessage({
        kind: "publication_blocked",
        planName: "demo",
        stage: "candidate_checkpoint",
    });
    assertEquals(message.includes("saved copy"), false);
    assertEquals(message.includes("Update RunWield"), false);
    assertEquals(message.includes("Git could not save the final validation files"), true);
});

Deno.test("publication explains a busy Plan operation without prescribing a failed reload", () => {
    const failure = normalizePublicationFailure(
        annotatePublicationStage(new PlanLockTimeoutError("/private/project/catalog.lock"), "lifecycle_staging"),
    );
    const message = buildValidationUserMessage({
        kind: "publication_blocked",
        planName: "demo",
        stage: failure.publicationStage || "git_publication",
        blockedByPlanLock: failure.blockedByPlanLock,
    });
    assertEquals(message.includes("another RunWield operation"), true);
    assertEquals(message.includes("review decision are saved"), true);
    assertEquals(message.includes("Let that operation finish, then retry publication"), true);
    assertEquals(message.includes("/private/project"), false);
    assertEquals(message.includes("Load this Plan and run validation again"), false);
});

for (const remote of [false, true]) {
    Deno.test(`verified completion retains recording failure after ${remote ? "remote" : "local"} delivery`, async () => {
        await withRuntimeCommandFixture("record-completion-", async ({ projectRoot: fixtureRoot }) => {
            const projectRoot = remote ? await makeRepo() : fixtureRoot;
            const worktreeRoot = remote ? await Deno.makeTempDir({ prefix: "record-outcome-worktree-" }) : undefined;
            const worktree = worktreeRoot
                ? await createTestWorktreeAttempt({ projectRoot, planName: "completed", worktreeRoot })
                : undefined;
            const hostedSession = new HostedSession({ id: crypto.randomUUID(), cwd: projectRoot });
            const events: RuntimeSystemStatusEvent[] = [];
            hostedSession.setEventSink((event: SessionRuntimeEvent) => {
                if (event.type === "system_status") events.push(event);
            });
            const session = createValidationSessionPort(hostedSession);
            try {
                await savePlan(worktree?.path || projectRoot, "completed", "# Completed\n", {
                    planId: "completed-plan",
                    classification: "PLANNED_CHANGE",
                    status: "validated",
                    workRecord: {
                        status: "failed",
                        error: "Recorder submission missing",
                        lastAttemptAt: "2026-10-08T00:00:00Z",
                    },
                });
                let publication;
                if (worktree) {
                    await git(worktree.path, ["add", "docs/plans/completed.md"]);
                    await git(worktree.path, ["commit", "-m", "Seal failed recording outcome"]);
                    const commit = await git(worktree.path, ["rev-parse", "HEAD"]);
                    publication = advancePublicationAttempt(
                        createPublicationAttempt({
                            attemptId: worktree.id,
                            planId: "completed-plan",
                            planName: "completed",
                            targetBranch: "main",
                            executionBranch: worktree.branch,
                            executionCwd: worktree.path,
                            publicationRoot: worktree.path,
                            validatedCommit: commit,
                            targetHeadAtSeal: await git(projectRoot, ["rev-parse", "HEAD"]),
                        }),
                        "artifacts_committed",
                        { artifactCommit: commit, planPaths: ["docs/plans/completed.md"] },
                    );
                    await removeWorktreeGitArtifacts({ projectRoot, path: worktree.path, force: true });
                    assertEquals(await loadPlan(projectRoot, "completed"), null);
                }
                session.setCurrentProgress(createProgressRecord({ kind: "workflow", stage: "merge" }));
                const result = await buildVerifiedResult(
                    {
                        planName: "completed",
                        planContent: "# Completed",
                        triageMeta: { classification: "PLANNED_CHANGE", status: "validated" },
                        session,
                        git: createGitPort(),
                        localCI: {
                            run: () => {
                                throw new Error("Completion must not rerun CI");
                            },
                        },
                        workRecordMnemotecaPort: createWorkRecordMnemotecaFixture(),
                    },
                    projectRoot,
                    undefined,
                    "main",
                    publication,
                );
                assertEquals(result.kind, "verified");
                const final = events.at(-1);
                assertEquals(final?.level, "warning");
                assertEquals(final?.validationProgress?.outcome, "verified");
                assertEquals(final?.validationProgress?.checks.merge, "passed");
                assertEquals(final?.validationProgress?.workRecordFailed, true);
                assertStringIncludes(final?.message || "", "Work Record failed");
                assertStringIncludes(final?.message || "", "wld wr backfill");
            } finally {
                hostedSession.dispose();
                if (remote) await Deno.remove(projectRoot, { recursive: true });
                if (worktreeRoot) await Deno.remove(worktreeRoot, { recursive: true });
            }
        });
    });
}
