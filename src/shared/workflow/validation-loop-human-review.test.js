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
        planContent: "# Plan",
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
                        toolName: "review_diff",
                        details: { command: "list", scope: "full", fileCount: 1 },
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
        planContent: "# Plan",
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
                        toolName: "review_diff",
                        details: { command: "list", scope: "full", fileCount: 1 },
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
        planContent: "# Plan",
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
                        toolName: "review_diff",
                        details: { command: "list", scope: "full", fileCount: 1 },
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
        planContent: "# Plan",
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
            captureWorktreeTree: () => Promise.resolve("tree-before-repair"),
            loadReviewerFeedbackEngineerDef: () =>
                Promise.resolve({
                    name: "reviewer-feedback-engineer",
                    displayName: "Reviewer-Feedback Engineer",
                    model: "",
                    description: "",
                    tools: [],
                    systemPrompt: "repair prompt",
                }),
            runIsolatedAgentSession: (/** @type {any} */ opts) => {
                // Human feedback repair uses the same fresh-context agent as semantic
                // findings, and must carry the annotations and images verbatim.
                if (opts.agentName === "reviewer-feedback-engineer") {
                    actions.push(
                        `repair:${opts.agentName}:${opts.userRequest.includes("Needs test.")}:${
                            opts.images === reviewImages
                        }`,
                    );
                    return Promise.resolve(
                        /** @type {any} */ ([{
                            role: "toolResult",
                            toolName: "task_completed",
                            details: { outcome: "task_completed", message: "Tightened it." },
                        }]),
                    );
                }
                return Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "The implementation matches the plan." }],
                    }, {
                        role: "toolResult",
                        toolName: "review_diff",
                        details: { command: "list", scope: "full", fileCount: 1 },
                    }, {
                        role: "toolResult",
                        toolName: "review_complete",
                        details: { outcome: "approved", approved: true, feedback: "" },
                    }]),
                );
            },
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
        "repair:reviewer-feedback-engineer:true:true",
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
        planContent: "# Plan",
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
                        toolName: "review_diff",
                        details: { command: "list", scope: "full", fileCount: 1 },
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

Deno.test("runValidationLoop keeps reopening code review for as many feedback rounds as the human gives", async () => {
    const { uiAPI, hostedSession } = makeValidationUi();
    /** @type {string[]} */
    const actions = [];
    /** @type {any[]} */
    const repairSessions = [];
    let humanReviewCalls = 0;
    let semanticReviews = 0;

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
            captureWorktreeTree: () => Promise.resolve("tree-before-repair"),
            diffTrees: () => Promise.resolve("diff --git a/file.js b/file.js\n+repair\n"),
            loadReviewerFeedbackEngineerDef: () =>
                Promise.resolve({
                    name: "reviewer-feedback-engineer",
                    displayName: "Reviewer-Feedback Engineer",
                    model: "",
                    description: "",
                    tools: [],
                    systemPrompt: "repair prompt",
                }),
            runIsolatedAgentSession: (/** @type {any} */ opts) => {
                if (opts.agentName === "reviewer-feedback-engineer") {
                    repairSessions.push(opts);
                    actions.push("repair");
                    return Promise.resolve(
                        /** @type {any} */ ([{
                            role: "toolResult",
                            toolName: "task_completed",
                            details: { outcome: "task_completed", message: "Addressed the feedback." },
                        }]),
                    );
                }
                semanticReviews++;
                actions.push("semantic-review");
                return Promise.resolve(
                    /** @type {any} */ ([{
                        role: "toolResult",
                        toolName: "review_diff",
                        details: { command: "list", scope: "full", fileCount: 1 },
                    }, {
                        role: "toolResult",
                        toolName: "review_complete",
                        details: { outcome: "approved", approved: true, feedback: "", findings: [] },
                    }]),
                );
            },
            getCodeReviewMode: () => "always",
            requestInteraction: (/** @type {any} */ _session, /** @type {any} */ _request) => {
                humanReviewCalls++;
                actions.push(`human-review:${humanReviewCalls}`);
                // Five rounds of feedback — well past any semantic-round cap — then approval.
                if (humanReviewCalls <= 5) {
                    return Promise.resolve({
                        outcome: "accepted",
                        _meta: {
                            approved: false,
                            feedback: `Round ${humanReviewCalls}: not quite.`,
                            annotations: [],
                            images: [],
                            exit: false,
                        },
                    });
                }
                return Promise.resolve({
                    outcome: "accepted",
                    _meta: { approved: true, feedback: "", annotations: [], images: [], exit: false },
                });
            },
            mergeExecutionWorktree: () => Promise.resolve(),
            updateWorktreeRegistryEntry: () => Promise.resolve({}),
            recordPlanEvent: () => Promise.resolve({}),
            recordWorkflowMetric: () => Promise.resolve(null),
        }),
    });

    assertEquals(humanReviewCalls, 6, "the loop must run as long as the human keeps giving feedback");
    assertEquals(repairSessions.length, 5);
    // Semantic review runs once, before the first human review. Once the change is
    // in the human's hands the automatic rounds are over — five feedback cycles
    // must not trip the three-round semantic cap.
    assertEquals(semanticReviews, 1);
    assertEquals(actions.filter((entry) => entry === "semantic-review").length, 1);
    assertEquals(uiAPI.promptSelections, [], "no round-limit prompt should appear during human feedback cycles");
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ m) => m.includes("feedback round 5")),
        true,
    );
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ m) =>
            m.includes("Planned change execution and validation complete")
        ),
        true,
    );
});

Deno.test("runValidationLoop ends the human review loop only when the human quits", async () => {
    const { hostedSession } = makeValidationUi();
    let humanReviewCalls = 0;

    const result = await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            ...noOpWorktreePlanHandoffDeps(),
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve("diff --git a/file.js b/file.js\n+change\n"),
            captureWorktreeTree: () => Promise.resolve("tree-before-repair"),
            diffTrees: () => Promise.resolve("diff --git a/file.js b/file.js\n+repair\n"),
            loadReviewerFeedbackEngineerDef: () =>
                Promise.resolve({
                    name: "reviewer-feedback-engineer",
                    displayName: "Reviewer-Feedback Engineer",
                    model: "",
                    description: "",
                    tools: [],
                    systemPrompt: "repair prompt",
                }),
            runIsolatedAgentSession: (/** @type {any} */ opts) => {
                if (opts.agentName === "reviewer-feedback-engineer") {
                    return Promise.resolve(
                        /** @type {any} */ ([{
                            role: "toolResult",
                            toolName: "task_completed",
                            details: { outcome: "task_completed", message: "Addressed the feedback." },
                        }]),
                    );
                }
                return Promise.resolve(
                    /** @type {any} */ ([{
                        role: "toolResult",
                        toolName: "review_diff",
                        details: { command: "list", scope: "full", fileCount: 1 },
                    }, {
                        role: "toolResult",
                        toolName: "review_complete",
                        details: { outcome: "approved", approved: true, feedback: "", findings: [] },
                    }]),
                );
            },
            getCodeReviewMode: () => "always",
            requestInteraction: () => {
                humanReviewCalls++;
                if (humanReviewCalls <= 2) {
                    return Promise.resolve({
                        outcome: "accepted",
                        _meta: {
                            approved: false,
                            feedback: "still not right",
                            annotations: [],
                            images: [],
                            exit: false,
                        },
                    });
                }
                return Promise.resolve({
                    outcome: "canceled",
                    _meta: { approved: false, feedback: "", annotations: [], images: [], exit: true, canceled: true },
                });
            },
            recordPlanEvent: () => Promise.resolve({}),
            recordWorkflowMetric: () => Promise.resolve(null),
        }),
    });

    assertEquals(humanReviewCalls, 3);
    assertEquals(result.kind, "failed");
    assertEquals(result.reason, "User code review exited without approval or feedback.");
});

Deno.test("runValidationLoop resuming mid-human-review does not restart automatic semantic rounds", async () => {
    const { hostedSession } = makeValidationUi();
    // Simulates re-entry after a pause: the human already has the change, so the
    // resumed run must reopen code review rather than starting round one again.
    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        executionAgent: "engineer",
        executionCwd: Deno.cwd(),
        validationContinuation: true,
        semanticRound: 2,
        reviewLedger: { items: [], sequence: 0 },
        repairBaselineTree: "tree-before-repair",
        lastRepairReport: "Addressed the feedback.",
        humanReviewCycle: 3,
    });
    let semanticReviews = 0;
    let humanReviewCalls = 0;

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
                semanticReviews++;
                return Promise.resolve(
                    /** @type {any} */ ([{
                        role: "toolResult",
                        toolName: "review_diff",
                        details: { command: "list", scope: "full", fileCount: 1 },
                    }, {
                        role: "toolResult",
                        toolName: "review_complete",
                        details: { outcome: "approved", approved: true, feedback: "", findings: [] },
                    }]),
                );
            },
            getCodeReviewMode: () => "always",
            requestInteraction: () => {
                humanReviewCalls++;
                return Promise.resolve({
                    outcome: "accepted",
                    _meta: { approved: true, feedback: "", annotations: [], images: [], exit: false },
                });
            },
            mergeExecutionWorktree: () => Promise.resolve(),
            updateWorktreeRegistryEntry: () => Promise.resolve({}),
            recordPlanEvent: () => Promise.resolve({}),
            recordWorkflowMetric: () => Promise.resolve(null),
        }),
    });

    assertEquals(semanticReviews, 0, "a resumed human-review cycle must not re-run semantic review");
    assertEquals(humanReviewCalls, 1);
});
