import { assertEquals } from "@std/assert";

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
