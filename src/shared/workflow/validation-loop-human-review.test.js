import { assertEquals } from "@std/assert";

import { runValidationLoop } from "./validation.js";

import { __resetSettingsForTests } from "../settings.js";

import { makeRecordedSession, makeUi, noOpWorktreePlanHandoffDeps } from "./validation-test-helpers.js";

function makeValidationUi() {
    const uiAPI = makeUi();
    return { uiAPI, hostedSession: makeRecordedSession("validation-test", uiAPI) };
}

Deno.test("runValidationLoop runs always human review after semantic approval and before merge", async () => {
    const hostedSession = makeRecordedSession("validation-test", makeUi());
    /** @type {string[]} */
    const actions = [];

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
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            ...noOpWorktreePlanHandoffDeps(),
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve("diff --git a/file.js b/file.js\n+change\n"),
            runIsolatedAgentSession: () =>
                Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "The implementation matches the plan." }],
                    }, {
                        role: "toolResult",
                        toolName: "review_complete",
                        details: { outcome: "approved", approved: true, feedback: "" },
                    }]),
                ),
            getCodeReviewMode: () => "always",
            requestInteraction: (
                /** @type {import("../session/hosted-session.js").HostedSession} */ _session,
                /** @type {any} */ request,
            ) => {
                assertEquals(request.type, "code_review");
                actions.push(
                    `human-review:${request._meta.executionCwd}:${request._meta.diffText.includes("+change")}`,
                );
                return Promise.resolve({
                    outcome: "accepted",
                    _meta: { approved: true, feedback: "", annotations: [], exit: false },
                });
            },
            mergeExecutionWorktree: () => {
                actions.push("merge");
                return Promise.resolve();
            },
            removeExecutionWorktree: () => Promise.resolve(),
            removeWorktreeRegistryEntry: () => Promise.resolve(),
            verifyExecutionWorktreeMerged: () => Promise.resolve({ merged: true, message: "merged" }),
            updateWorktreeRegistryEntry: () => {
                actions.push("registry");
                return Promise.resolve({});
            },
            recordPlanEvent: (/** @type {any} */ event) => {
                actions.push(
                    `event:${event.event}:${event.details.humanReviewMode}:${event.details.humanReviewDecision}`,
                );
                return Promise.resolve({});
            },
        }),
    });

    assertEquals(actions, [
        "human-review:/worktree:true",
        "merge",
        "registry",
    ]);
});

Deno.test("runValidationLoop ask mode can skip human review and merge", async () => {
    const { uiAPI, hostedSession } = makeValidationUi();
    /** @type {string[]} */
    const actions = [];
    uiAPI.promptSelect = () => {
        actions.push("prompt");
        return Promise.resolve("skip");
    };

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
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            ...noOpWorktreePlanHandoffDeps(),
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve("diff --git a/file.js b/file.js\n+change\n"),
            runIsolatedAgentSession: () =>
                Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "The implementation matches the plan." }],
                    }, {
                        role: "toolResult",
                        toolName: "review_complete",
                        details: { outcome: "approved", approved: true, feedback: "" },
                    }]),
                ),
            getCodeReviewMode: () => "ask",
            requestInteraction: (
                /** @type {import("../session/hosted-session.js").HostedSession} */ _session,
                /** @type {any} */ request,
            ) => {
                assertEquals(request.type, "select");
                actions.push("prompt");
                return Promise.resolve({ outcome: "selected", value: "skip" });
            },
            mergeExecutionWorktree: () => {
                actions.push("merge");
                return Promise.resolve();
            },
            removeExecutionWorktree: () => Promise.resolve(),
            removeWorktreeRegistryEntry: () => Promise.resolve(),
            verifyExecutionWorktreeMerged: () => Promise.resolve({ merged: true, message: "merged" }),
            updateWorktreeRegistryEntry: () => Promise.resolve({}),
            recordPlanEvent: (/** @type {any} */ event) => {
                actions.push(
                    `event:${event.event}:${event.details.humanReviewMode}:${event.details.humanReviewDecision}`,
                );
                return Promise.resolve({});
            },
        }),
    });

    assertEquals(actions, ["prompt", "merge"]);
});

Deno.test("runValidationLoop ask mode opens human review before merge when approved", async () => {
    const { uiAPI, hostedSession } = makeValidationUi();
    /** @type {string[]} */
    const actions = [];
    uiAPI.promptSelect = () => {
        actions.push("prompt");
        return Promise.resolve("open");
    };

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
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            ...noOpWorktreePlanHandoffDeps(),
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve("diff --git a/file.js b/file.js\n+change\n"),
            runIsolatedAgentSession: () =>
                Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "The implementation matches the plan." }],
                    }, {
                        role: "toolResult",
                        toolName: "review_complete",
                        details: { outcome: "approved", approved: true, feedback: "" },
                    }]),
                ),
            getCodeReviewMode: () => "ask",
            requestInteraction: (
                /** @type {import("../session/hosted-session.js").HostedSession} */ _session,
                /** @type {any} */ request,
            ) => {
                if (request.type === "select") {
                    actions.push("prompt");
                    return Promise.resolve({ outcome: "selected", value: "open" });
                }
                actions.push(
                    `human-review:${request._meta.executionCwd}:${request._meta.diffText.includes("+change")}`,
                );
                return Promise.resolve({
                    outcome: "accepted",
                    _meta: { approved: true, feedback: "", annotations: [], exit: false },
                });
            },
            mergeExecutionWorktree: () => {
                actions.push("merge");
                return Promise.resolve();
            },
            removeExecutionWorktree: () => Promise.resolve(),
            removeWorktreeRegistryEntry: () => Promise.resolve(),
            verifyExecutionWorktreeMerged: () => Promise.resolve({ merged: true, message: "merged" }),
            updateWorktreeRegistryEntry: () => Promise.resolve({}),
            recordPlanEvent: (/** @type {any} */ event) => {
                actions.push(
                    `event:${event.event}:${event.details.humanReviewMode}:${event.details.humanReviewDecision}`,
                );
                return Promise.resolve({});
            },
        }),
    });

    assertEquals(actions, ["prompt", "human-review:/worktree:true", "merge"]);
});

Deno.test("runValidationLoop sends human feedback to active execution owner and continues validation", async () => {
    const { uiAPI } = makeValidationUi();
    const reviewHostedSession = makeRecordedSession("human-review-feedback-owner-test", uiAPI);
    reviewHostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE", executionAgent: "frontend-engineer" },
        executionAgent: "frontend-engineer",
        executionCwd: Deno.cwd(),
    });
    /** @type {string[]} */
    const actions = [];
    /** @type {any[]} */
    const metrics = [];
    const reviewImages = [{ base64: "aW1hZ2U=", mimeType: "image/png", name: "reference" }];
    let humanReviewCalls = 0;

    await runValidationLoop({
        hostedSession: reviewHostedSession,
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE", executionAgent: "frontend-engineer" },
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
                        source: "active_session",
                    },
                }),
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve("diff --git a/file.js b/file.js\n+change\n"),
            runIsolatedAgentSession: () =>
                Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "The implementation matches the plan." }],
                    }, {
                        role: "toolResult",
                        toolName: "review_complete",
                        details: { outcome: "approved", approved: true, feedback: "" },
                    }]),
                ),
            getCodeReviewMode: () => "always",
            requestInteraction: (
                /** @type {import("../session/hosted-session.js").HostedSession} */ _session,
                /** @type {any} */ request,
            ) => {
                assertEquals(request.type, "code_review");
                humanReviewCalls++;
                actions.push(`human-review:${humanReviewCalls}`);
                if (humanReviewCalls === 1) {
                    return Promise.resolve({
                        outcome: "accepted",
                        _meta: {
                            approved: false,
                            feedback: "Please tighten this.",
                            annotations: [{ file: "src/a.js", line: 7, text: "Needs test." }],
                            images: reviewImages,
                            exit: false,
                        },
                    });
                }
                return Promise.resolve({
                    outcome: "accepted",
                    _meta: { approved: true, feedback: "", annotations: [], exit: false },
                });
            },
            recordWorkflowMetric: (/** @type {any} */ metric) => {
                metrics.push(metric);
                return Promise.resolve(null);
            },
            runCompletionGatedRepair: (/** @type {any} */ opts) => {
                actions.push(
                    `repair:${opts.agentName}:${opts.userRequest.includes("Needs test.")}:${
                        opts.images === reviewImages
                    }`,
                );
                return Promise.resolve(true);
            },
            recordPlanEvent: (/** @type {any} */ event) => {
                actions.push(
                    `event:${event.event}:${event.details.humanReviewMode}:${event.details.humanReviewDecision}`,
                );
                return Promise.resolve({});
            },
        }),
    });

    assertEquals(actions, [
        "human-review:1",
        "repair:frontend-engineer:true:true",
        "human-review:2",
        "event:validation_passed:always:approved",
    ]);
    assertEquals(
        metrics.some((metric) =>
            metric.category === "validation" && metric.event === "human_review_result" &&
            metric.details.mode === "always" && metric.details.decision === "feedback_requested" &&
            metric.details.hasFeedback === true && metric.details.annotationCount === 1 &&
            metric.details.imageCount === 1
        ),
        true,
    );
});

Deno.test("runValidationLoop treats human review exit as validation failure without merge", async () => {
    const hostedSession = makeRecordedSession("validation-test", makeUi());
    /** @type {string[]} */
    const actions = [];
    /** @type {any[]} */
    const metrics = [];

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
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            ...noOpWorktreePlanHandoffDeps(),
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve("diff --git a/file.js b/file.js\n+change\n"),
            runIsolatedAgentSession: () =>
                Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "The implementation matches the plan." }],
                    }, {
                        role: "toolResult",
                        toolName: "review_complete",
                        details: { outcome: "approved", approved: true, feedback: "" },
                    }]),
                ),
            getCodeReviewMode: () => "always",
            requestInteraction: (
                /** @type {import("../session/hosted-session.js").HostedSession} */ _session,
                /** @type {any} */ request,
            ) => {
                assertEquals(request.type, "code_review");
                return Promise.resolve({
                    outcome: "canceled",
                    _meta: { approved: false, feedback: "", annotations: [], exit: true },
                });
            },
            mergeExecutionWorktree: () => {
                actions.push("merge");
                return Promise.resolve();
            },
            updateWorktreeRegistryEntry: (
                /** @type {string} */ _projectRoot,
                /** @type {string} */ _id,
                /** @type {{ status: string }} */ updates,
            ) => {
                actions.push(`registry:${updates.status}`);
                return Promise.resolve({});
            },
            recordPlanEvent: (/** @type {any} */ event) => {
                actions.push(`event:${event.event}:${event.details.failureReason}`);
                return Promise.resolve({});
            },
            recordWorkflowMetric: (/** @type {any} */ metric) => {
                metrics.push(metric);
                return Promise.resolve(null);
            },
        }),
    });

    assertEquals(actions, [
        "registry:validation_failed",
        "event:validation_failed:User code review exited without approval or feedback.",
    ]);
    assertEquals(
        metrics.some((metric) =>
            metric.category === "validation" && metric.event === "human_review_result" &&
            metric.details.decision === "exited"
        ),
        true,
    );
});
