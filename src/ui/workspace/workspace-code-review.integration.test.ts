// @ts-nocheck: Deno test imports are checked by scripts/run-tests.js, not Astro check.
import { assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import { WorkspaceSessionContinuationService } from "./server/session-continuation.js";

const ROUTE_PATH = "src/ui/workspace/pages/projects/[projectId]/sessions/[runwieldSessionId]/review/code.astro";
const SESSION_CONTINUATION_PATH = "src/ui/workspace/server/session-continuation.js";
const SESSION_SURFACE_PATH = "src/ui/workspace/islands/SessionSurface.jsx";
const TIMELINE_PATH = "src/ui/workspace/components/SessionTimeline.jsx";
const CODE_REVIEW_SURFACE_PATH = "src/ui/workspace/react/CodeReviewSurface.tsx";
const SERVER_PATH = "src/ui/workspace/server.js";

async function runGit(cwd: string, args: string[]): Promise<string> {
    const result = await new Deno.Command("git", { cwd, args, stdout: "piped", stderr: "piped" }).output();
    if (!result.success) throw new Error(new TextDecoder().decode(result.stderr));
    return new TextDecoder().decode(result.stdout).trim();
}

Deno.test("live Session Code Review uses the shared review surface inside Workspace", async () => {
    const route = await Deno.readTextFile(ROUTE_PATH);

    assertStringIncludes(route, "WorkspaceLayout");
    assertStringIncludes(route, "CodeReviewSurface");
    assertStringIncludes(route, 'presentation="workspace"');
    assertStringIncludes(route, "getLiveCodeReview");
    assertStringIncludes(route, 'artifactLabel: codeReview.planTitle || codeReview.planName || "Code changes"');
    assertFalse(route.includes("ReviewLayout"));
});

Deno.test("Workspace Session projects code-review interactions to one stable in-situ URL", async () => {
    const continuation = await Deno.readTextFile(SESSION_CONTINUATION_PATH);
    const sessionSurface = await Deno.readTextFile(SESSION_SURFACE_PATH);
    const timeline = await Deno.readTextFile(TIMELINE_PATH);
    const server = await Deno.readTextFile(SERVER_PATH);

    assertStringIncludes(continuation, 'request.type === "code_review"');
    assertStringIncludes(continuation, 'const planTitle = typeof meta.planTitle === "string" && meta.planTitle.trim()');
    assertStringIncludes(continuation, "/review/code?operation=${encodeURIComponent(options.operationId)}");
    assertStringIncludes(continuation, "getLiveCodeReview(options)");
    assertStringIncludes(sessionSurface, 'isCodeReview ? "code-review"');
    assertStringIncludes(timeline, 'item.kind === "code-review"');
    assertStringIncludes(timeline, "Review Code");
    assertStringIncludes(server, '"/projects/:projectId/sessions/:runwieldSessionId/review/code"');
});

Deno.test("Workspace Code Review live interaction keeps planTitle in its payload", async () => {
    const service = new WorkspaceSessionContinuationService({ store: {} });
    try {
        service.operations.set("operation-1", {
            status: "running",
            projectId: "project-1",
            runwieldSessionId: "session-1",
            events: [],
        });
        const interaction = service.createInteractionAdapter({ operationId: "operation-1" }).requestInteraction({
            id: "interaction-1",
            type: "code_review",
            prompt: "Review the code changes.",
            _meta: {
                diffText: "diff --git a/change.ts b/change.ts\n+change",
                planName: "show-plan-title",
                planTitle: "Readable Plan Title",
            },
        });
        const liveReview = await service.getLiveCodeReview({
            projectId: "project-1",
            runwieldSessionId: "session-1",
            operationId: "operation-1",
            interactionId: "interaction-1",
        });

        assertEquals(liveReview?.request?.codeReview?.planTitle, "Readable Plan Title");
        assertEquals(liveReview?.request?.codeReview?.planName, "show-plan-title");
        service.operations.get("operation-1")?.answer?.resolve({ outcome: "canceled" });
        await interaction;
    } finally {
        service.close();
    }
});

Deno.test("Workspace Code Review reload reads the latest files against the original baseline", async () => {
    const projectRoot = await Deno.makeTempDir({ prefix: "runwield-workspace-code-reload-" });
    const service = new WorkspaceSessionContinuationService({ store: {} });
    try {
        await runGit(projectRoot, ["init", "-b", "main"]);
        await runGit(projectRoot, ["config", "user.email", "runwield@example.com"]);
        await runGit(projectRoot, ["config", "user.name", "RunWield Test"]);
        await Deno.writeTextFile(`${projectRoot}/review.ts`, "export const label = 'base';\n");
        await runGit(projectRoot, ["add", "review.ts"]);
        await runGit(projectRoot, ["commit", "-m", "fixture base"]);
        const baselineTree = await runGit(projectRoot, ["rev-parse", "HEAD"]);
        await Deno.writeTextFile(`${projectRoot}/review.ts`, "export const label = 'first';\n");
        service.operations.set("operation-reload", {
            status: "running",
            projectId: "project-1",
            runwieldSessionId: "session-1",
            events: [],
        });
        const interaction = service.createInteractionAdapter({ operationId: "operation-reload" }).requestInteraction({
            id: "interaction-reload",
            type: "code_review",
            prompt: "Review the code changes.",
            _meta: {
                diffText: "stale patch",
                planName: "reload-code-review",
                executionCwd: projectRoot,
                baselineTree,
            },
        });

        await Deno.writeTextFile(`${projectRoot}/review.ts`, "export const label = 'second';\n");
        const liveReview = await service.getLiveCodeReview({
            projectId: "project-1",
            runwieldSessionId: "session-1",
            operationId: "operation-reload",
            interactionId: "interaction-reload",
        });

        assertStringIncludes(String(liveReview?.request?.codeReview?.rawPatch), "+export const label = 'second';");
        assertFalse(JSON.stringify(liveReview).includes(projectRoot));
        service.operations.get("operation-reload")?.answer?.resolve({ outcome: "canceled" });
        await interaction;
    } finally {
        service.close();
        await Deno.remove(projectRoot, { recursive: true }).catch(() => {});
    }
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
