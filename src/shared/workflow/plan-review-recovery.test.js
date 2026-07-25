import { assertEquals } from "@std/assert";
import {
    appendSessionCompleteGuidance,
    isAnsweredPlanReview,
    requestRecoverablePlanReview,
    SESSION_COMPLETE_GUIDANCE,
} from "./plan-review-recovery.js";

Deno.test("Plan Review recovery treats approval and substantive feedback as answered", () => {
    assertEquals(isAnsweredPlanReview({ _meta: { approved: true } }), true);
    assertEquals(isAnsweredPlanReview({ approved: false, feedback: "change it" }), true);
    assertEquals(isAnsweredPlanReview({ approved: false, images: [{ base64: "a", mimeType: "image/png" }] }), true);
});

Deno.test("Plan Review recovery treats empty cancellation as unanswered", () => {
    assertEquals(isAnsweredPlanReview({ outcome: "canceled" }), false);
    assertEquals(isAnsweredPlanReview({ approved: false, feedback: "" }), false);
});

Deno.test("Plan Review recovery retries after unanswered review when user accepts", async () => {
    const reviews = [{ outcome: "canceled" }, { _meta: { approved: true, approvalAction: "run" } }];
    /** @type {string[]} */
    /** @type {string[]} */
    const prompts = [];
    const result = await requestRecoverablePlanReview({
        requestReview: () => Promise.resolve(reviews.shift()),
        requestRetry: (details) => {
            prompts.push(details.reason);
            return Promise.resolve({ outcome: "accepted", value: true });
        },
    });

    assertEquals(result.kind, "answered");
    assertEquals(result.response._meta.approved, true);
    assertEquals(prompts, ["review_canceled"]);
});

Deno.test("Plan Review recovery completes session when retry is declined", async () => {
    const result = await requestRecoverablePlanReview({
        requestReview: () => Promise.resolve({ outcome: "unsupported", message: "server failed" }),
        requestRetry: () => Promise.resolve({ outcome: "canceled", value: false }),
    });

    assertEquals(result.kind, "complete");
    assertEquals(result.reason, "review_error");
    assertEquals(result.message, SESSION_COMPLETE_GUIDANCE);
});

Deno.test("appendSessionCompleteGuidance appends the canonical message once", () => {
    const first = appendSessionCompleteGuidance("Plan saved.");
    assertEquals(first, `Plan saved.\n\n${SESSION_COMPLETE_GUIDANCE}`);
    assertEquals(appendSessionCompleteGuidance(first), first);
});
