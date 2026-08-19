import { assertEquals, assertLessOrEqual } from "@std/assert";

import {
    calculateValidationRetryDelayMs,
    decideValidationRecovery,
    DEFAULT_VALIDATION_RETRY_POLICY,
    waitForValidationRetry,
} from "./validation-recovery.ts";
import { classifyValidationOperationalError } from "./validation-operational-errors.ts";

Deno.test("calculates capped exponential full jitter and honors bounded Retry-After", () => {
    assertEquals(
        calculateValidationRetryDelayMs({ retryIndex: 0, baseDelayMs: 100, maxDelayMs: 1000, randomUnit: 1 }),
        100,
    );
    assertEquals(
        calculateValidationRetryDelayMs({ retryIndex: 4, baseDelayMs: 100, maxDelayMs: 1000, randomUnit: 1 }),
        1000,
    );
    assertEquals(
        calculateValidationRetryDelayMs({ retryIndex: 2, baseDelayMs: 100, maxDelayMs: 1000, randomUnit: 0.5 }),
        200,
    );
    assertEquals(
        calculateValidationRetryDelayMs({
            retryIndex: 2,
            baseDelayMs: 100,
            maxDelayMs: 1000,
            randomUnit: 0.5,
            retryAfterMs: 250,
        }),
        250,
    );
});

Deno.test("maps transient failures to retry and pauses after the retry budget", () => {
    const failure = classifyValidationOperationalError({
        source: "provider",
        kind: "timeout",
        operation: "semantic_review",
        message: "timeout",
    });
    const retry = decideValidationRecovery({
        failure,
        attempt: 1,
        policy: DEFAULT_VALIDATION_RETRY_POLICY,
        randomUnit: 0,
    });
    assertEquals(retry.action, "retry");
    if (retry.action === "retry") assertLessOrEqual(retry.delayMs, DEFAULT_VALIDATION_RETRY_POLICY.maxDelayMs);

    const spent = decideValidationRecovery({
        failure,
        attempt: 4,
        policy: DEFAULT_VALIDATION_RETRY_POLICY,
        randomUnit: 0,
    });
    assertEquals(spent.action, "pause");
    assertEquals(spent.result.kind, "retry_later");
});

Deno.test("maps correctable, missing-information, and fatal failures to separate actions", () => {
    const correctable = decideValidationRecovery({
        failure: classifyValidationOperationalError({
            source: "reviewer_protocol",
            kind: "missing_review_complete",
            operation: "semantic_review",
            message: "missing",
            required: "call review_complete",
        }),
        attempt: 1,
        policy: DEFAULT_VALIDATION_RETRY_POLICY,
    });
    assertEquals(correctable.action, "correct");
    assertEquals(correctable.result.delayMs, undefined);

    const missing = decideValidationRecovery({
        failure: classifyValidationOperationalError({
            source: "validation_state",
            kind: "plan_missing",
            operation: "validation_state",
            message: "missing",
        }),
        attempt: 1,
        policy: DEFAULT_VALIDATION_RETRY_POLICY,
    });
    assertEquals(missing.action, "pause");

    const fatal = decideValidationRecovery({
        failure: classifyValidationOperationalError({
            source: "policy",
            kind: "prohibited",
            operation: "publication",
            message: "no",
        }),
        attempt: 1,
        policy: DEFAULT_VALIDATION_RETRY_POLICY,
    });
    assertEquals(fatal.action, "halt");
});

Deno.test("stops retry waits on cancellation", async () => {
    const controller = new AbortController();
    const result = waitForValidationRetry(1000, controller.signal);
    controller.abort();
    assertEquals(await result, "canceled");
});
