import { assertEquals } from "@std/assert";
import { startCodeReviewSurface, startPlanReviewSurface, stopActiveReviewSurfaces } from "./review-launcher.js";

Deno.test("stopActiveReviewSurfaces stops active plan and code review servers", async () => {
    let planStops = 0;
    let codeStops = 0;

    await startPlanReviewSurface({
        plan: "# Plan",
        htmlContent: "<html>plan</html>",
        startPlanReviewServer: /** @type {any} */ (() =>
            Promise.resolve({
                url: "http://127.0.0.1:1111/plan-review",
                waitForDecision: () => new Promise(() => {}),
                stop: () => {
                    planStops++;
                },
            })),
        openInDefaultBrowser: () => Promise.resolve(true),
    });

    await startCodeReviewSurface({
        rawPatch: "diff --git a/a.js b/a.js\n+change",
        gitRef: "test diff",
        agentCwd: Deno.cwd(),
        htmlContent: "<html>code</html>",
        startReviewServer: /** @type {any} */ (() =>
            Promise.resolve({
                url: "http://127.0.0.1:2222/code-review",
                waitForDecision: () => new Promise(() => {}),
                stop: () => {
                    codeStops++;
                },
            })),
        openInDefaultBrowser: () => Promise.resolve(true),
    });

    await stopActiveReviewSurfaces();

    assertEquals(planStops, 1);
    assertEquals(codeStops, 1);
});

Deno.test("review surface stop unregisters the server from process-exit cleanup", async () => {
    let stops = 0;
    const server = await startPlanReviewSurface({
        plan: "# Plan",
        htmlContent: "<html>plan</html>",
        startPlanReviewServer: /** @type {any} */ (() =>
            Promise.resolve({
                url: "http://127.0.0.1:3333/plan-review",
                waitForDecision: () => Promise.resolve({ approved: true }),
                stop: () => {
                    stops++;
                },
            })),
        openInDefaultBrowser: () => Promise.resolve(true),
    });

    await server.stop();
    await stopActiveReviewSurfaces();

    assertEquals(stops, 1);
});

Deno.test("stopActiveReviewSurfaces stops Workspace-hosted plan and code review servers", async () => {
    const planServer = await startPlanReviewSurface({
        plan: "# Plan",
        planPath: "plans/example.md",
        openInDefaultBrowser: () => Promise.resolve(false),
    });
    const codeServer = await startCodeReviewSurface({
        rawPatch: "diff --git a/a.js b/a.js\n+change",
        gitRef: "test diff",
        agentCwd: Deno.cwd(),
        openInDefaultBrowser: () => Promise.resolve(false),
    });

    const planDecision = planServer.waitForDecision();
    const codeDecision = codeServer.waitForDecision();
    await stopActiveReviewSurfaces();

    assertEquals(await planDecision, { approved: false, feedback: "", exit: true, canceled: true });
    assertEquals(await codeDecision, {
        approved: false,
        feedback: "",
        annotations: [],
        exit: true,
        canceled: true,
    });
});
