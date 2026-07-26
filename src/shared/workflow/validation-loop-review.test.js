import { assertEquals, assertStringIncludes } from "@std/assert";

import { runValidationLoop } from "./validation.js";

import { __resetSettingsForTests } from "../settings.js";

import {
    makeRecordedSession,
    makeUi,
    noOpRecordPlanEvent,
    noOpWorktreePlanHandoffDeps,
} from "./validation-test-helpers.js";

function makeValidationUi() {
    const uiAPI = makeUi();
    return { uiAPI, hostedSession: makeRecordedSession("validation-test", uiAPI) };
}

Deno.test("runValidationLoop reviews the diff scoped to the active workflow baseline", async () => {
    const hostedSession = makeRecordedSession("validation-test", makeUi());
    /** @type {string[]} */
    const reviewPrompts = [];
    /** @type {Array<string | undefined>} */
    const baselineArgs = [];

    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        executionAgent: "engineer",
        baselineTree: "baseline-tree",
    });

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            ...noOpWorktreePlanHandoffDeps(),
            resolveValidationExecutionContext: () =>
                Promise.resolve({
                    kind: "ok",
                    context: {
                        executionMode: "worktree",
                        planName: "p",
                        projectRoot: Deno.cwd(),
                        executionCwd: Deno.cwd(),
                        baselineTree: "baseline-tree",
                        source: "active_session",
                    },
                }),
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: (/** @type {string | undefined} */ baselineTree) => {
                baselineArgs.push(baselineTree);
                return Promise.resolve("diff --git a/workflow.js b/workflow.js\n+scoped workflow change\n");
            },
            runIsolatedAgentSession: (/** @type {any} */ opts) => {
                reviewPrompts.push(opts.userRequest);
                return Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "The implementation matches the plan." }],
                    }, {
                        role: "toolResult",
                        toolName: "review_complete",
                        details: { outcome: "approved", approved: true, feedback: "" },
                    }]),
                );
            },
            recordPlanEvent: noOpRecordPlanEvent,
        }),
    });

    assertEquals(baselineArgs, ["baseline-tree"]);
    assertEquals(reviewPrompts.length, 1);
    assertEquals(reviewPrompts[0].includes("scoped workflow change"), true);
    assertEquals(reviewPrompts[0].includes("pre-existing dirty change"), false);
    assertEquals(hostedSession.getActiveExecutionWorkflow(), null);
});

Deno.test("runValidationLoop runs validation and reviewer in active execution cwd", async () => {
    const hostedSession = makeRecordedSession("validation-test", makeUi());
    const rootSessionManager = /** @type {any} */ ({ id: "shared-root-history" });
    /** @type {Array<string | undefined>} */
    const ciCwds = [];
    /** @type {Array<string | undefined>} */
    const diffCwds = [];
    /** @type {Array<string | undefined>} */
    const sessionCwds = [];
    /** @type {Array<any>} */
    const sessionOpts = [];

    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        executionAgent: "engineer",
        executionMode: "worktree",
        baselineTree: "baseline-tree",
        projectRoot: "/primary",
        executionCwd: "/worktree",
        worktreeId: "wt1",
        worktreeBranch: "runwield/worktree/p-wt1",
        worktreeBaseBranch: "feature-base",
    });

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        sessionManager: rootSessionManager,
        __deps: /** @type {any} */ ({
            ...noOpWorktreePlanHandoffDeps(),
            runLocalCI: (/** @type {{ cwd?: string }} */ { cwd }) => {
                ciCwds.push(cwd);
                return Promise.resolve({ exitCode: 0, output: "" });
            },
            getDiffText: (/** @type {string | undefined} */ _baselineTree, /** @type {string | undefined} */ cwd) => {
                diffCwds.push(cwd);
                return Promise.resolve("diff --git a/file.js b/file.js\n+change\n");
            },
            runIsolatedAgentSession: (/** @type {any} */ opts) => {
                sessionCwds.push(opts.cwd);
                sessionOpts.push(opts);
                return Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "The implementation matches the plan." }],
                    }, {
                        role: "toolResult",
                        toolName: "review_complete",
                        details: { outcome: "approved", approved: true, feedback: "" },
                    }]),
                );
            },
            mergeExecutionWorktree: () => Promise.resolve(),
            updateWorktreeRegistryEntry: () => Promise.resolve({}),
            recordPlanEvent: noOpRecordPlanEvent,
        }),
    });

    assertEquals(ciCwds, ["/worktree"]);
    assertEquals(diffCwds, ["/worktree"]);
    assertEquals(sessionCwds, ["/worktree"]);
    assertEquals(Object.hasOwn(sessionOpts[0], "uiAPI"), false);
    assertEquals(sessionOpts[0]._agentDefOverride.tools, ["read", "grep", "find", "ls", "review_complete"]);
    assertEquals(sessionOpts[0]._agentDefOverride.systemPrompt.includes("{{SKILLS}}"), false);
    assertEquals(sessionOpts[0].includeEditFallback, false);
    assertEquals(Object.hasOwn(sessionOpts[0], "useRootSession"), false);
    assertEquals(
        Object.hasOwn(sessionOpts[0], "sessionManager"),
        false,
        "Reviewer must not receive the shared workflow SessionManager",
    );
});

Deno.test("runValidationLoop uses large-diff prompt when diff exceeds inline threshold", async () => {
    const hostedSession = makeRecordedSession("validation-test", makeUi());
    /** @type {string[]} */
    const reviewPrompts = [];

    // Build a diff larger than 60KB inline threshold (use 5000 lines to get >100KB)
    const largeDiffLines = ["diff --git a/src/big.js b/src/big.js", "--- a/src/big.js", "+++ b/src/big.js"];
    for (let i = 0; i < 5000; i++) {
        largeDiffLines.push(`+line ${i} with some extra padding to make each line bigger and bigger`);
        largeDiffLines.push(`-old line ${i} also with some extra padding for size purposes`);
    }
    const largeDiffText = largeDiffLines.join("\n");

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "Add a large feature.",
        triageMeta: { classification: "FEATURE" },
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            ...noOpWorktreePlanHandoffDeps(),
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve(largeDiffText),
            runIsolatedAgentSession: (/** @type {any} */ opts) => {
                reviewPrompts.push(opts.userRequest);
                // Verify customTools include review_diff
                const hasReviewDiff = (opts.customTools || []).some(
                    (/** @type {{ name: string }} */ t) => t.name === "review_diff",
                );
                assertEquals(hasReviewDiff, true, "large diff should get review_diff tool");
                // Verify agent definition includes exploration tools
                assertEquals(
                    opts._agentDefOverride.tools.includes("read"),
                    true,
                    "large diff reviewer should have read tool",
                );
                assertEquals(
                    opts._agentDefOverride.tools.includes("grep"),
                    true,
                    "large diff reviewer should have grep tool",
                );
                assertEquals(
                    opts._agentDefOverride.tools.includes("memory_recall"),
                    false,
                    "Reviewer must not use project memory as review evidence",
                );
                assertEquals(
                    opts._agentDefOverride.tools.includes("memory_recall_global"),
                    false,
                    "Reviewer must not use global memory as review evidence",
                );
                return Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "The implementation matches the plan." }],
                    }, {
                        role: "toolResult",
                        toolName: "review_complete",
                        details: { outcome: "approved", approved: true, feedback: "" },
                    }]),
                );
            },
            getCodeReviewMode: () => "none",
            mergeExecutionWorktree: () => Promise.resolve(),
            updateWorktreeRegistryEntry: () => Promise.resolve({}),
            recordPlanEvent: () => Promise.resolve({}),
        }),
    });

    // The large diff should NOT appear inline in the review prompt
    assertEquals(reviewPrompts[0].includes("line 1999"), false, "full large diff should not be inline");
    // But the compact summary should mention changed files
    assertStringIncludes(reviewPrompts[0], "src/big.js");
    // Should include review_diff instructions
    assertStringIncludes(reviewPrompts[0], "review_diff");
});

Deno.test("runValidationLoop shows retry/cancel menu when reviewer throws an error", async () => {
    const { uiAPI, hostedSession } = makeValidationUi();
    /** @type {string[]} */
    const promptsSeen = [];

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            ...noOpWorktreePlanHandoffDeps(),
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve("diff --git a/file.js b/file.js\n+change\n"),
            runIsolatedAgentSession: () => {
                promptsSeen.push("review-invoked");
                throw new Error("Context window exceeded");
            },
            recordWorkflowMetric: (/** @type {any} */ metric) => {
                promptsSeen.push(`metric:${metric.event}`);
                return Promise.resolve(null);
            },
            recordPlanEvent: () => Promise.resolve({}),
        }),
    });

    // Should show the retry/cancel prompt - promptSelect was called
    // The existing makeUi() stores promptSelections
    // Since promptSelect returns "stop" (default in makeUi), validation should halt
    assertStringIncludes(
        uiAPI.messages.join(" "),
        "Semantic Reviewer execution failed",
    );
    const failureProgress = uiAPI.systemCalls.find((/** @type {typeof uiAPI.systemCalls[number]} */ call) =>
        call.message.includes("Semantic Reviewer execution failed")
    )?.validationProgress;
    assertEquals(failureProgress?.stage, "semantic_review");
    assertEquals(failureProgress?.checks.semanticReview, "failed");
    assertStringIncludes(
        uiAPI.messages.join(" "),
        "User canceled validation",
    );
});

Deno.test("runValidationLoop halts when reviewer returns blank output and user cancels", async () => {
    const { uiAPI, hostedSession } = makeValidationUi();
    /** @type {string[]} */
    const events = [];

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            ...noOpWorktreePlanHandoffDeps(),
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve("diff --git a/file.js b/file.js\n+change\n"),
            runIsolatedAgentSession: () =>
                Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "" }],
                    }]),
                ),
            recordWorkflowMetric: (/** @type {any} */ metric) => {
                events.push(metric.event);
                return Promise.resolve(null);
            },
            recordPlanEvent: () => Promise.resolve({}),
        }),
    });

    // Since promptSelect returns "stop" (default in makeUi), validation should halt
    assertStringIncludes(
        uiAPI.messages.join(" "),
        "did not call review_complete",
    );
    assertStringIncludes(
        uiAPI.messages.join(" "),
        "User canceled validation",
    );
});

Deno.test("runValidationLoop retries semantic review when user chooses retry", async () => {
    const { uiAPI, hostedSession } = makeValidationUi();
    const rootSessionManager = /** @type {any} */ ({ id: "shared-root-history" });
    /** @type {number} */
    let reviewCalls = 0;
    /** @type {any[]} */
    const reviewOpts = [];

    // Override promptSelect to return "retry" so the retry path is exercised
    uiAPI.promptSelect = () => Promise.resolve("retry");

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        sessionManager: rootSessionManager,
        __deps: /** @type {any} */ ({
            ...noOpWorktreePlanHandoffDeps(),
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve("diff --git a/file.js b/file.js\n+change\n"),
            runIsolatedAgentSession: (/** @type {any} */ opts) => {
                reviewOpts.push(opts);
                reviewCalls++;
                if (reviewCalls === 1) {
                    throw new Error("Context window exceeded");
                }
                // Second call succeeds
                return Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "The implementation matches the plan." }],
                    }, {
                        role: "toolResult",
                        toolName: "review_complete",
                        details: { outcome: "approved", approved: true, feedback: "" },
                    }]),
                );
            },
            getCodeReviewMode: () => "none",
            mergeExecutionWorktree: () => Promise.resolve(),
            updateWorktreeRegistryEntry: () => Promise.resolve({}),
            recordPlanEvent: () => Promise.resolve({}),
        }),
    });

    assertEquals(reviewCalls, 2, "should retry reviewer session");
    assertEquals(
        reviewOpts.map((opts) => Object.hasOwn(opts, "sessionManager")),
        [false, false],
        "Reviewer retries must each start without the shared workflow SessionManager",
    );
    const retryProgress = uiAPI.systemCalls.find((/** @type {typeof uiAPI.systemCalls[number]} */ call) =>
        call.message.includes("Retrying Semantic Code Review")
    )?.validationProgress;
    assertEquals(retryProgress?.stage, "semantic_review");
    assertEquals(retryProgress?.message, undefined);
    assertStringIncludes(uiAPI.messages.join(" "), "retry completed");
});
