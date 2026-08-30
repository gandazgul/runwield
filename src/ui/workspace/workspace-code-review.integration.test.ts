// @ts-nocheck: Deno test imports are checked by scripts/run-tests.js, not Astro check.
import { assertFalse, assertStringIncludes } from "@std/assert";

const ROUTE_PATH = "src/ui/workspace/pages/projects/[projectId]/sessions/[runwieldSessionId]/review/code.astro";
const SESSION_CONTINUATION_PATH = "src/ui/workspace/server/session-continuation.js";
const SESSION_SURFACE_PATH = "src/ui/workspace/islands/SessionSurface.jsx";
const TIMELINE_PATH = "src/ui/workspace/components/SessionTimeline.jsx";
const CODE_REVIEW_SURFACE_PATH = "src/ui/workspace/react/CodeReviewSurface.tsx";
const SERVER_PATH = "src/ui/workspace/server.js";

Deno.test("live Session Code Review uses the shared review surface inside Workspace", async () => {
    const route = await Deno.readTextFile(ROUTE_PATH);

    assertStringIncludes(route, "WorkspaceLayout");
    assertStringIncludes(route, "CodeReviewSurface");
    assertStringIncludes(route, 'presentation="workspace"');
    assertStringIncludes(route, "getLiveCodeReview");
    assertFalse(route.includes("ReviewLayout"));
});

Deno.test("Workspace Session projects code-review interactions to one stable in-situ URL", async () => {
    const continuation = await Deno.readTextFile(SESSION_CONTINUATION_PATH);
    const sessionSurface = await Deno.readTextFile(SESSION_SURFACE_PATH);
    const timeline = await Deno.readTextFile(TIMELINE_PATH);
    const server = await Deno.readTextFile(SERVER_PATH);

    assertStringIncludes(continuation, 'request.type === "code_review"');
    assertStringIncludes(continuation, "/review/code?operation=${encodeURIComponent(options.operationId)}");
    assertStringIncludes(continuation, "getLiveCodeReview(options)");
    assertStringIncludes(sessionSurface, 'isCodeReview ? "code-review"');
    assertStringIncludes(timeline, 'item.kind === "code-review"');
    assertStringIncludes(timeline, "Review Code");
    assertStringIncludes(server, '"/projects/:projectId/sessions/:runwieldSessionId/review/code"');
});

Deno.test("Workspace Code Review returns decisions to its live Session interaction", async () => {
    const route = await Deno.readTextFile(ROUTE_PATH);
    const surface = await Deno.readTextFile(CODE_REVIEW_SURFACE_PATH);
    const continuation = await Deno.readTextFile(SESSION_CONTINUATION_PATH);

    assertStringIncludes(route, "interactionAnswerUrl");
    assertStringIncludes(surface, "initialPayload.interactionAnswerUrl");
    assertStringIncludes(surface, 'outcome: body.approved ? "accepted" : "selected"');
    assertStringIncludes(continuation, "operation.answer.resolve(runtimeResponse)");
});

Deno.test("TUI review routes keep the same shared bodies in the standalone shell", async () => {
    const planRoute = await Deno.readTextFile("src/ui/workspace/pages/review/plan.astro");
    const codeRoute = await Deno.readTextFile("src/ui/workspace/pages/review/code.astro");

    assertStringIncludes(planRoute, "ReviewLayout");
    assertStringIncludes(planRoute, "PlanReviewSurface");
    assertStringIncludes(codeRoute, "ReviewLayout");
    assertStringIncludes(codeRoute, "CodeReviewSurface");
});
