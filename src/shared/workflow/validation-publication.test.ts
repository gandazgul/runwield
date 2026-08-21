import { assertEquals } from "@std/assert";

import { classifyValidationOperationalError, type GitPublicationErrorKind } from "./validation-operational-errors.ts";
import { decideValidationRecovery, DEFAULT_VALIDATION_RETRY_POLICY } from "./validation-recovery.ts";
import { publicationFailureNeedsUserAction } from "./validation-merge-repair.ts";

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
        { kind: "permission_denied", action: "pause" },
        { kind: "policy_violation", action: "pause" },
    ];

    for (const scenario of cases) {
        const decision = decidePublicationFailure(scenario.kind);
        assertEquals(decision.action, scenario.action, scenario.kind);
    }
});

Deno.test("permission and branch-policy failures pause with a concrete user action", () => {
    const permissionDenied = decidePublicationFailure("permission_denied");
    assertEquals(permissionDenied.action, "pause");
    assertEquals(permissionDenied.result.kind, "user_action");
    assertEquals(permissionDenied.result.action, "choose");
    assertEquals(permissionDenied.result.nextPhase, "delivery");

    const policyViolation = decidePublicationFailure("policy_violation");
    assertEquals(policyViolation.action, "pause");
    assertEquals(policyViolation.result.kind, "user_action");
    assertEquals(policyViolation.result.action, "choose");
    assertEquals(policyViolation.result.nextPhase, "delivery");
});

Deno.test("publication offers Retry only when the user can change the outcome", () => {
    assertEquals(publicationFailureNeedsUserAction(new Error("internal publication failure")), false);
    assertEquals(
        publicationFailureNeedsUserAction({ mergeFailureKind: "isolated_publication_conflict" }),
        true,
    );
    assertEquals(
        publicationFailureNeedsUserAction({ mergeFailureKind: "publication_push_failed" }),
        true,
    );
});
