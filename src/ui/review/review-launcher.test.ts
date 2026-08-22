import { assertEquals, assertStringIncludes } from "@std/assert";
import type { BrowserPort } from "../../shared/browser-port.ts";
import { defineCommittedGitFixture } from "../../shared/git-test-fixture.ts";
import { withProcessGlobalTestLock } from "../../testing/process-global-lock.js";
import {
    type ReviewDecisionValue,
    type ReviewServerOutput,
    startArtifactReadSurface,
    startCodeReviewSurface,
    startPlanReviewSurface,
    stopActiveReviewSurfaces,
} from "./review-launcher.ts";

interface PlanDecision {
    [key: string]: ReviewDecisionValue;
    approved: boolean;
    feedback: string;
    exit: boolean;
    canceled: boolean;
}

interface CodeDecision extends PlanDecision {
    annotations: ReviewDecisionValue[];
}

const codeReviewGitFixture = defineCommittedGitFixture();

function recordingBrowser(opened: boolean): BrowserPort & { urls: string[] } {
    const urls: string[] = [];
    return {
        urls,
        open(url) {
            urls.push(url);
            return Promise.resolve(opened);
        },
    };
}

function reviewLauncherTest(name: string, run: (projectRoot: string) => Promise<void>): void {
    Deno.test(name, () =>
        withProcessGlobalTestLock(async () => {
            const previous = Deno.env.get("WLD_WORKSPACE_DISABLE_BUILT_SERVER");
            const projectRoot = await Deno.makeTempDir({ prefix: "runwield-review-launcher-" });
            Deno.env.set("WLD_WORKSPACE_DISABLE_BUILT_SERVER", "1");
            try {
                await run(projectRoot);
            } finally {
                await stopActiveReviewSurfaces();
                await Deno.remove(projectRoot, { recursive: true }).catch(() => {});
                if (previous === undefined) Deno.env.delete("WLD_WORKSPACE_DISABLE_BUILT_SERVER");
                else Deno.env.set("WLD_WORKSPACE_DISABLE_BUILT_SERVER", previous);
            }
        }));
}

reviewLauncherTest("Plan Review reports its real Workspace URL before opening the browser", async (projectRoot) => {
    const surfaces: Array<{ url: string; opened: boolean }> = [];
    let browserCalls = 0;
    const browser: BrowserPort = {
        open(url) {
            browserCalls += 1;
            assertEquals(surfaces, [{ url, opened: false }]);
            return Promise.resolve(true);
        },
    };
    const server = await startPlanReviewSurface<PlanDecision>({
        cwd: projectRoot,
        plan: "# Plan",
        planPath: "docs/plans/example.md",
        browser,
        onSurfaceReady: (surface) => surfaces.push(surface),
    });
    const decision = server.waitForDecision();
    await server.stop();

    assertEquals(surfaces, [{ url: server.url, opened: false }]);
    assertEquals(browserCalls, 1);
    assertEquals(server.opened, true);
    assertEquals(await decision, { approved: false, feedback: "", exit: true, canceled: true });
});

reviewLauncherTest("artifact reads run the real Workspace server without launching a browser", async (projectRoot) => {
    const browser = recordingBrowser(false);
    const server = await startArtifactReadSurface<PlanDecision>({
        cwd: projectRoot,
        markdown: "# Read Me",
        artifactKind: "work-record",
        title: "Read Me",
        path: "docs/work-records/read-me.md",
        notices: ["NOTICE: maintenance"],
        browser,
    });

    const html = await (await fetch(server.url)).text();
    const decision = server.waitForDecision();
    await server.stop();

    assertEquals(server.opened, false);
    assertEquals(browser.urls, [server.url]);
    assertStringIncludes(html, "artifact-read");
    assertStringIncludes(html, "Read Me");
    assertEquals(await decision, { approved: false, feedback: "", exit: true, canceled: true });
});

reviewLauncherTest(
    "Plan Review exposes trusted execution policy through the real Workspace payload",
    async (projectRoot) => {
        const server = await startPlanReviewSurface<PlanDecision>({
            cwd: projectRoot,
            plan: `---
classification: FEATURE
executionAgent: frontend-engineer
collaborationRecommendation: pair
---
# Plan
`,
            planPath: "docs/plans/policy.md",
            browser: recordingBrowser(false),
        });
        const html = await (await fetch(server.url)).text();
        const decision = server.waitForDecision();
        await server.stop();

        assertStringIncludes(html, '"classification":"PLANNED_CHANGE"');
        assertStringIncludes(html, '"executionAgent":"frontend-engineer"');
        assertStringIncludes(html, '"collaborationRecommendation":"pair"');
        assertEquals(await decision, { approved: false, feedback: "", exit: true, canceled: true });
    },
);

reviewLauncherTest("revised Plan Review exposes its initial Plan baseline", async (projectRoot) => {
    const server = await startPlanReviewSurface<PlanDecision>({
        cwd: projectRoot,
        plan: "# Revised Plan\n\nNew approach\n",
        previousPlan: "# Initial Plan\n\nOld approach\n",
        browser: recordingBrowser(false),
    });
    const html = await (await fetch(server.url)).text();
    const decision = server.waitForDecision();
    await server.stop();

    assertStringIncludes(html, '"previousPlan":"# Initial Plan\\n\\nOld approach\\n"');
    assertEquals(await decision, { approved: false, feedback: "", exit: true, canceled: true });
});

reviewLauncherTest(
    "Code Review exposes guided-review and Git status payload through the real server",
    async () => {
        const projectRoot = await codeReviewGitFixture.checkout({ prefix: "runwield-code-review-" });
        try {
            await Deno.writeTextFile(`${projectRoot}/change.ts`, "export const changed = true;\n");
            const server = await startCodeReviewSurface<CodeDecision>({
                rawPatch: "diff --git a/change.ts b/change.ts\n+change",
                gitRef: "fixture diff",
                agentCwd: projectRoot,
                guidedReview: {
                    mode: "auto",
                    autoStart: true,
                    manualAvailable: true,
                    reasons: ["fixture"],
                    stats: {
                        changedFiles: 1,
                        changedLines: 1,
                        addedLines: 1,
                        removedLines: 0,
                        meaningfulAreas: ["src"],
                        lowSignalOnly: false,
                        paths: ["change.ts"],
                    },
                    score: 4,
                },
                browser: recordingBrowser(false),
            });
            const html = await (await fetch(server.url)).text();
            const decision = server.waitForDecision();
            await server.stop();

            assertStringIncludes(html, '"autoStart":true');
            assertStringIncludes(html, '"untrackedFiles":["change.ts"]');
            assertEquals(await decision, {
                approved: false,
                feedback: "",
                annotations: [],
                exit: true,
                canceled: true,
            });
        } finally {
            await Deno.remove(projectRoot, { recursive: true }).catch(() => {});
        }
    },
);

reviewLauncherTest("review server startup output reaches the caller", async (projectRoot) => {
    const output: ReviewServerOutput[] = [];
    const server = await startPlanReviewSurface<PlanDecision>({
        cwd: projectRoot,
        plan: "# Plan",
        browser: recordingBrowser(false),
        onOutput: (entry) => output.push(entry),
    });
    await server.stop();

    assertEquals(
        output.some((entry) => entry.stream === "stdout" && entry.text.includes("Listening on http://")),
        true,
    );
});

reviewLauncherTest("global cleanup stops every real review surface", async (projectRoot) => {
    const planServer = await startPlanReviewSurface<PlanDecision>({
        cwd: projectRoot,
        plan: "# Plan",
        browser: recordingBrowser(false),
    });
    const codeServer = await startCodeReviewSurface<CodeDecision>({
        rawPatch: "diff --git a/a.ts b/a.ts\n+change",
        gitRef: "fixture diff",
        agentCwd: projectRoot,
        browser: recordingBrowser(false),
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
