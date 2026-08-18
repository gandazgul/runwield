// @ts-nocheck: Deno test imports are checked by scripts/run-tests.js, not Astro check.
import { assert, assertFalse, assertStringIncludes } from "@std/assert";

const ROUTE_PATH = "src/ui/workspace/pages/projects/[projectId]/plans/[planId].astro";
const SESSION_CONTINUATION_PATH = "src/ui/workspace/server/session-continuation.js";
const PLAN_REVIEW_SURFACE_PATH = "src/ui/workspace/react/PlanReviewSurface.tsx";

Deno.test("stable Plan page switches from live review to settled detail", async () => {
    const route = await Deno.readTextFile(ROUTE_PATH);

    assertStringIncludes(route, "PlanReviewSurface");
    assertStringIncludes(route, "PlanDetail");
    assertStringIncludes(route, "getLivePlanReview");
    assertFalse(route.includes("const liveReview = Boolean(runwieldSessionId && operationId && interactionId)"));
});

Deno.test("Workspace Plan review returns Feedback to the same live Core interaction", async () => {
    const route = await Deno.readTextFile(ROUTE_PATH);
    const surface = await Deno.readTextFile(PLAN_REVIEW_SURFACE_PATH);
    const continuation = await Deno.readTextFile(SESSION_CONTINUATION_PATH);

    assertStringIncludes(route, "interactionAnswerUrl");
    assertStringIncludes(route, "/session-operations/${");
    assertStringIncludes(surface, 'response: { outcome: "accepted", _meta: body }');
    assertStringIncludes(continuation, "operation.answer.resolve(runtimeResponse)");
});

Deno.test("lost review interaction prepares but does not send Agent resubmission", async () => {
    const route = await Deno.readTextFile(ROUTE_PATH);
    const continuation = await Deno.readTextFile(SESSION_CONTINUATION_PATH);

    assertStringIncludes(continuation, 'request.type === "plan_review"');
    assertStringIncludes(continuation, "operation=${");
    assert(!route.includes("startContinuation"));
});
