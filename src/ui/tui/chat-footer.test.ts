import { assertEquals, assertStringIncludes } from "@std/assert";
import { initRunWieldTheme } from "../theme/theme.js";
import {
    buildFooterContextStat,
    buildFooterLine1Parts,
    buildFooterLocationText,
    buildFooterWorkflowLabelParts,
    createChatFooterController,
    type FooterRuntimeEvent,
    type FooterRuntimeSnapshot,
    getFooterWorkflowLabelText,
    renderFooterWorkflowLabelParts,
    shouldShowFooterThinkingLevel,
} from "./chat-footer.ts";

interface FooterTestRuntime {
    snapshots: Map<string, FooterRuntimeSnapshot>;
    listeners: Map<string, (event: FooterRuntimeEvent) => void>;
    unsubscribed: string[];
}

initRunWieldTheme();

function makeFooterSnapshot(cwd: string): FooterRuntimeSnapshot {
    return {
        cwd,
        activeModel: { model: "test/model", provider: "test" },
        thinkingLevel: "medium",
        activeAgentInfo: { displayName: "Engineer", agentName: "engineer" },
        workflowContext: { routingIntent: "QUICK_FIX", complexity: "LOW" },
        contextUsage: { contextWindow: 100_000, percent: 25 },
        autoCompactionEnabled: true,
    };
}

function makeFooterRuntime(initialSessionId: string): FooterTestRuntime {
    const runtime: FooterTestRuntime = {
        snapshots: new Map([[initialSessionId, makeFooterSnapshot("/tmp/runwield-footer-one")]]),
        listeners: new Map(),
        unsubscribed: [],
    };
    return runtime;
}

Deno.test("footer thinking level is hidden until a model is configured", () => {
    assertEquals(shouldShowFooterThinkingLevel("", "medium"), false);
    assertEquals(shouldShowFooterThinkingLevel("test/model", "off"), false);
    assertEquals(shouldShowFooterThinkingLevel("test/model", "medium"), true);
});

Deno.test("footer context stat shows percentage, capacity, and auto-compaction", () => {
    assertEquals(buildFooterContextStat({ contextWindow: 1_000_000, percent: 48.65 }, true), {
        text: "48.6%/1.0M (Auto-compact)",
        token: "dim",
    });
    assertEquals(buildFooterContextStat({ contextWindow: 128_000, percent: 75 }, false), {
        text: "75.0%/128k",
        token: "warning",
    });
    assertEquals(buildFooterContextStat({ contextWindow: 200_000, percent: 95 }, true), {
        text: "95.0%/200k (Auto-compact)",
        token: "error",
    });
    assertEquals(buildFooterContextStat(null, true), null);
});

Deno.test("footer workflow label formats eligible routing context", () => {
    const parts = buildFooterWorkflowLabelParts({ displayName: "Planner", agentName: "planner" }, {
        routingIntent: "FEATURE",
        complexity: "MEDIUM",
        planName: "my-awesome-plan",
    }, 80);
    assertEquals(getFooterWorkflowLabelText(parts), "Planner - Medium Planned Change - my-awesome-plan");
    assertEquals(parts.map((part) => part.token), [
        "accent",
        "dim",
        "complexityMedium",
        "dim",
        "routingFeature",
        "dim",
        "dim",
    ]);
});

Deno.test("footer location follows active worktree execution context", () => {
    const text = buildFooterLocationText({
        cwd: "/repo",
        activeExecutionWorkflow: { executionCwd: "/repo-demo", worktreeBranch: "worktree/demo" },
    }, { home: "/repo", resolveBranch: () => "main" });
    assertEquals(text, "/repo-demo (worktree/demo)");
});

Deno.test("footer location shortens RunWield-managed worktree paths", () => {
    const text = buildFooterLocationText({
        cwd: "/Users/gandazgul/Documents/web/runwield",
        activeExecutionWorkflow: {
            executionCwd:
                "/Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-frontend-framework-design-skill-51003995",
            worktreeBranch: "worktree/frontend-framework-design-skill-51003995",
        },
    }, { home: "/Users/gandazgul", resolveBranch: () => "main" });
    assertEquals(
        text,
        "runwield/runwield-frontend-framework-design-skill-51003995 (worktree/frontend-framework-design-skill-51003995)",
    );
});

Deno.test("footer line keeps location left of workflow label", () => {
    const line = buildFooterLine1Parts(
        { displayName: "Planner", agentName: "planner" },
        { routingIntent: "FEATURE", complexity: "MEDIUM", planName: "very-long-plan-name" },
        "~/project (main)",
        80,
    );
    assertEquals(line.left, "~/project (main)");
    assertEquals(getFooterWorkflowLabelText(line.rightParts), "Planner - Medium Planned Change - very-long-plan-name");
});

Deno.test("footer workflow renderer applies provided theme tokens", () => {
    const rendered = renderFooterWorkflowLabelParts(
        buildFooterWorkflowLabelParts({ displayName: "Engineer", agentName: "engineer" }, {
            routingIntent: "QUICK_FIX",
            complexity: "LOW",
        }, 80),
        { fg: (token: string, text: string) => `<${token}>${text}</${token}>` },
    );
    assertEquals(
        rendered,
        "<accent>Engineer</accent><dim> - </dim><complexityLow>Low</complexityLow><dim> </dim><routingQuickFix>Quick Fix</routingQuickFix>",
    );
});

Deno.test("live footer controller subscribes to usage and rebinds on Session replacement", () => {
    let activeSessionId = "session-one";
    const runtime = makeFooterRuntime(activeSessionId);
    runtime.snapshots.set("session-two", makeFooterSnapshot("/tmp/runwield-footer-two"));
    let renderRequests = 0;
    const controller = createChatFooterController({
        runtime: {
            getSessionSnapshot: (sessionId) => runtime.snapshots.get(sessionId) || null,
            subscribeSessionEvents: (sessionId, listener) => {
                runtime.listeners.set(sessionId, listener);
                return () => runtime.unsubscribed.push(sessionId);
            },
        },
        getSessionId: () => activeSessionId,
        requestRender: () => {
            renderRequests += 1;
        },
    });
    try {
        runtime.listeners.get("session-one")?.({
            type: "usage",
            usage: { inputTokens: 1200, outputTokens: 250, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.125 },
        });
        assertStringIncludes(controller.component.render(120).join("\n"), "↑1.2k");
        activeSessionId = "session-two";
        controller.rebindSession(activeSessionId);
        assertEquals(runtime.unsubscribed, ["session-one"]);
        assertEquals(runtime.listeners.has("session-two"), true);
        const reboundFooter = controller.component.render(120).join("\n");
        assertStringIncludes(reboundFooter, "/tmp/runwield-footer-two");
        assertEquals(reboundFooter.includes("↑1.2k"), false);
        assertEquals(renderRequests, 0);
    } finally {
        controller.dispose();
    }
});

Deno.test("live footer controller renders and clears the Ctrl+C pending exit notice", async () => {
    const activeSessionId = "session-one";
    const runtime = makeFooterRuntime(activeSessionId);
    let renderRequests = 0;
    const controller = createChatFooterController({
        runtime: {
            getSessionSnapshot: (sessionId) => runtime.snapshots.get(sessionId) || null,
            subscribeSessionEvents: (sessionId, listener) => {
                runtime.listeners.set(sessionId, listener);
                return () => runtime.unsubscribed.push(sessionId);
            },
        },
        getSessionId: () => activeSessionId,
        requestRender: () => {
            renderRequests += 1;
        },
    });
    try {
        controller.markCtrlCPendingExit();
        assertEquals(controller.isCtrlCPendingExit(), true);
        assertStringIncludes(controller.component.render(100).join("\n"), "Ctrl+C - Press again to exit");
        await new Promise((resolve) => setTimeout(resolve, 1100));
        assertEquals(controller.isCtrlCPendingExit(), false);
        assertEquals(renderRequests >= 2, true);
    } finally {
        controller.dispose();
    }
});
