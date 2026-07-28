import { assertEquals } from "@std/assert";

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

Deno.test("runValidationLoop pauses with Engineer when CI repair does not call task_completed", async () => {
    const { uiAPI } = makeValidationUi();
    const repairHostedSession = makeRecordedSession("ci-repair-pause-test", uiAPI);
    let repairCalls = 0;
    let repairAgentName = "";
    await runValidationLoop({
        hostedSession: repairHostedSession,
        planName: "p",
        planContent: "",
        triageMeta: { classification: "FEATURE" },
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            ...noOpWorktreePlanHandoffDeps(),
            runLocalCI: () => Promise.resolve({ exitCode: 1, output: "boom" }),
            runActiveAgentTurn: (/** @type {any} */ opts) => {
                repairCalls++;
                repairAgentName = opts.agentName;
                assertEquals(opts.allowReturnToRouter, false);
                assertEquals(opts.cwd, Deno.cwd());
                return Promise.resolve([]);
            },
            readLatestTaskCompletedOutcome: () => false,
            recordPlanEvent: noOpRecordPlanEvent,
        }),
    });

    assertEquals(repairCalls, 1);
    assertEquals(repairAgentName, "engineer");
    assertEquals(repairHostedSession.getActiveExecutionWorkflow(), {
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        executionAgent: "engineer",
        executionCwd: Deno.cwd(),
        validationContinuation: true,
        // Round state rides on the workflow record so a nudge resumes this attempt.
        semanticRound: 1,
        reviewLedger: { items: [], sequence: 0 },
        repairBaselineTree: "",
        lastRepairReport: "",
        humanReviewCycle: 0,
    });
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ m) =>
            m.includes("Engineer stopped without task_completed during CI repair.") &&
            m.includes("Validation will resume after task_completed")
        ),
        true,
    );
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ m) => m.includes("Mechanical validation failed 3 times")),
        false,
    );
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ m) => m.includes("during validation repair")),
        false,
    );
    const paused = uiAPI.systemCalls.find((/** @type {typeof uiAPI.systemCalls[number]} */ call) =>
        call.message.includes("Validation will resume after task_completed")
    )?.validationProgress;
    assertEquals(paused?.outcome, "paused");
    assertEquals(paused?.stage, "engineer_repair");
    assertEquals(paused?.checks.ci, "failed");
});

Deno.test("runValidationLoop pauses when the Reviewer-Feedback Engineer stalls", async () => {
    const { uiAPI } = makeValidationUi();
    const repairHostedSession = makeRecordedSession("semantic-repair-pause-test", uiAPI);
    await runValidationLoop({
        hostedSession: repairHostedSession,
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            ...noOpWorktreePlanHandoffDeps(),
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve("diff"),
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
                // The repair agent returns without task_completed.
                if (opts.agentName === "reviewer-feedback-engineer") return Promise.resolve(/** @type {any} */ ([]));
                return Promise.resolve(
                    /** @type {any} */ ([{
                        role: "toolResult",
                        toolName: "review_diff",
                        details: { command: "list", scope: "full", fileCount: 1 },
                    }, {
                        role: "toolResult",
                        toolName: "review_complete",
                        details: {
                            outcome: "feedback",
                            approved: false,
                            feedback: "missing requirement",
                            findings: [{ title: "missing requirement" }],
                        },
                    }]),
                );
            },
            recordPlanEvent: noOpRecordPlanEvent,
        }),
    });

    const paused = repairHostedSession.getActiveExecutionWorkflow();
    assertEquals(paused?.validationContinuation, true);
    assertEquals(paused?.semanticRound, 1);
    // The ledger survives the pause so continuing resumes this attempt rather than
    // restarting discovery with no memory of what was already found.
    assertEquals(paused?.reviewLedger?.items.length, 1);
    assertEquals(paused?.reviewLedger?.items[0].id, "R1-1");
    assertEquals(paused?.repairBaselineTree, "tree-before-repair");
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ m) =>
            m.includes("Reviewer-Feedback Engineer stopped without task_completed during semantic repair.") &&
            m.includes("Validation will resume after task_completed")
        ),
        true,
    );
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ m) => m.includes("Maximum validation cycles")),
        false,
    );
});

Deno.test("runValidationLoop preserves Frontend Engineer owner when CI repair pauses", async () => {
    const { uiAPI } = makeValidationUi();
    const repairHostedSession = makeRecordedSession("frontend-ci-repair-pause-test", uiAPI);
    repairHostedSession.setActiveExecutionWorkflow({
        planName: "visual-plan",
        triageMeta: { classification: "FEATURE", executionAgent: "frontend-engineer" },
        executionAgent: "frontend-engineer",
        executionStarted: true,
        executionAttemptStartedAtMs: 777,
        collaborationStyle: "pair",
        pairCheckpointCount: 2,
        executionCwd: Deno.cwd(),
    });
    let repairAgentName = "";
    /** @type {any[]} */
    const metrics = [];

    await runValidationLoop({
        hostedSession: repairHostedSession,
        planName: "visual-plan",
        planContent: "",
        triageMeta: { classification: "FEATURE", executionAgent: "frontend-engineer" },
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            ...noOpWorktreePlanHandoffDeps(),
            resolveValidationExecutionContext: () =>
                Promise.resolve({
                    kind: "ok",
                    context: {
                        executionMode: "worktree",
                        planName: "visual-plan",
                        projectRoot: Deno.cwd(),
                        executionCwd: Deno.cwd(),
                        source: "active_session",
                    },
                }),
            runLocalCI: () => Promise.resolve({ exitCode: 1, output: "boom" }),
            runActiveAgentTurn: (/** @type {any} */ opts) => {
                repairAgentName = opts.agentName;
                const currentWorkflow = repairHostedSession.getActiveExecutionWorkflow();
                if (!currentWorkflow) throw new Error("expected active Frontend Engineer repair workflow");
                repairHostedSession.setActiveExecutionWorkflow({
                    ...currentWorkflow,
                    collaborationStyle: "autonomous",
                    pairCheckpointCount: 3,
                    pairPauseReason: "stop",
                    pairSwitchedToAutonomous: true,
                    pairCapabilityLost: true,
                });
                return Promise.resolve([]);
            },
            readLatestTaskCompletedOutcome: () => false,
            recordPlanEvent: noOpRecordPlanEvent,
            recordWorkflowMetric: (/** @type {any} */ metric) => {
                metrics.push(metric);
                return Promise.resolve(null);
            },
        }),
    });

    assertEquals(repairAgentName, "frontend-engineer");
    assertEquals(
        metrics
            .filter((metric) => metric.event === "repair_dispatched" || metric.event === "repair_completed")
            .every((metric) => metric.agentName === "frontend-engineer"),
        true,
    );
    assertEquals(repairHostedSession.getActiveExecutionWorkflow()?.executionAgent, "frontend-engineer");
    assertEquals(repairHostedSession.getActiveExecutionWorkflow()?.validationContinuation, true);
    assertEquals(repairHostedSession.getActiveExecutionWorkflow()?.executionAttemptStartedAtMs, 777);
    assertEquals(repairHostedSession.getActiveExecutionWorkflow()?.collaborationStyle, "autonomous");
    assertEquals(repairHostedSession.getActiveExecutionWorkflow()?.pairCheckpointCount, 3);
    assertEquals(repairHostedSession.getActiveExecutionWorkflow()?.pairPauseReason, "stop");
    assertEquals(repairHostedSession.getActiveExecutionWorkflow()?.pairSwitchedToAutonomous, true);
    assertEquals(repairHostedSession.getActiveExecutionWorkflow()?.pairCapabilityLost, true);
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ m) =>
            m.includes("Frontend Engineer stopped without task_completed during CI repair.") &&
            m.includes("Validation will resume after task_completed")
        ),
        true,
    );
});

Deno.test("runValidationLoop clears transient Frontend Engineer repair context after observed CI repair completion", async () => {
    const { uiAPI } = makeValidationUi();
    const repairHostedSession = makeRecordedSession("frontend-ci-repair-complete-test", uiAPI);
    repairHostedSession.setActiveExecutionWorkflow({
        planName: "visual-plan",
        triageMeta: { classification: "FEATURE", executionAgent: "frontend-engineer" },
        executionAgent: "frontend-engineer",
        executionStarted: true,
        executionAttemptStartedAtMs: 321,
        collaborationStyle: "autonomous",
        executionCwd: Deno.cwd(),
        nonGitInPlace: true,
    });
    /** @type {Array<import('../session/hosted-session.js').ActiveExecutionWorkflow | null>} */
    const repairStates = [];

    await runValidationLoop({
        hostedSession: repairHostedSession,
        planName: "visual-plan",
        planContent: "",
        triageMeta: { classification: "FEATURE", executionAgent: "frontend-engineer" },
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            ...noOpWorktreePlanHandoffDeps(),
            runLocalCI: (() => {
                let count = 0;
                return () =>
                    Promise.resolve(count++ === 0 ? { exitCode: 1, output: "boom" } : { exitCode: 0, output: "" });
            })(),
            runActiveAgentTurn: () => {
                repairStates.push(repairHostedSession.getActiveExecutionWorkflow());
                return Promise.resolve(
                    /** @type {any} */ ([{
                        role: "toolResult",
                        toolName: "task_completed",
                        details: { outcome: "task_completed" },
                    }]),
                );
            },
            readLatestTaskCompletedOutcome: () => true,
            recordPlanEvent: noOpRecordPlanEvent,
            recordWorkflowMetric: () => Promise.resolve(null),
        }),
    });

    assertEquals(repairStates[0]?.validationContinuation, true);
    assertEquals(repairStates[0]?.executionAttemptStartedAtMs, 321);
    assertEquals(repairHostedSession.getActiveExecutionWorkflow(), null);
});

Deno.test("runValidationLoop routes frontend semantic repair to the Reviewer-Feedback Engineer", async () => {
    const { uiAPI } = makeValidationUi();
    const repairHostedSession = makeRecordedSession("frontend-semantic-repair-pause-test", uiAPI);
    repairHostedSession.setActiveExecutionWorkflow({
        planName: "visual-plan",
        triageMeta: { classification: "FEATURE", executionAgent: "frontend-engineer" },
        executionAgent: "frontend-engineer",
        executionCwd: Deno.cwd(),
    });
    let repairAgentName = "";

    await runValidationLoop({
        hostedSession: repairHostedSession,
        planName: "visual-plan",
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
                        planName: "visual-plan",
                        projectRoot: Deno.cwd(),
                        executionCwd: Deno.cwd(),
                        source: "active_session",
                    },
                }),
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve("diff"),
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
                if (opts.agentName === "reviewer-feedback-engineer") {
                    repairAgentName = opts.agentName;
                    return Promise.resolve(/** @type {any} */ ([]));
                }
                return Promise.resolve(
                    /** @type {any} */ ([{
                        role: "toolResult",
                        toolName: "review_diff",
                        details: { command: "list", scope: "full", fileCount: 1 },
                    }, {
                        role: "toolResult",
                        toolName: "review_complete",
                        details: {
                            outcome: "feedback",
                            approved: false,
                            feedback: "missing requirement",
                            findings: [{ title: "missing requirement" }],
                        },
                    }]),
                );
            },
            recordPlanEvent: noOpRecordPlanEvent,
        }),
    });

    // Semantic repair is about correctness and plan completeness, so it goes to the
    // focused repair agent regardless of who executed the Plan. Pair-execution
    // affordances are deliberately not carried into it.
    assertEquals(repairAgentName, "reviewer-feedback-engineer");
    // The Plan's owner is unchanged: a pause still returns the user to it.
    assertEquals(repairHostedSession.getActiveExecutionWorkflow()?.executionAgent, "frontend-engineer");
    assertEquals(repairHostedSession.getActiveExecutionWorkflow()?.validationContinuation, true);
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ m) =>
            m.includes("Reviewer-Feedback Engineer stopped without task_completed during semantic repair.") &&
            m.includes("Validation will resume after task_completed")
        ),
        true,
    );
});

Deno.test("runValidationLoop offers another round or code review after three rounds", async () => {
    const { uiAPI } = makeValidationUi();
    const session = makeRecordedSession("semantic-round-limit-test", uiAPI);
    /** @type {any[]} */
    const interactions = [];
    let reviewCalls = 0;

    await runValidationLoop({
        hostedSession: session,
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
                            details: { outcome: "task_completed", message: "R1-1 — fixed." },
                        }]),
                    );
                }
                reviewCalls++;
                return Promise.resolve(
                    /** @type {any} */ ([{
                        role: "toolResult",
                        toolName: "review_diff",
                        details: { command: "list", scope: "full", fileCount: 1 },
                    }, {
                        role: "toolResult",
                        toolName: "review_complete",
                        details: {
                            outcome: "feedback",
                            approved: false,
                            feedback: "missing requirement",
                            // The same unfixed issue each round, carried by identity so
                            // it stays one ledger item.
                            findings: reviewCalls === 1
                                ? [{ title: "Issue from round 1" }]
                                : [{ id: "R1-1", resolved: false, title: "Issue from round 1" }],
                        },
                    }]),
                );
            },
            requestInteraction: (/** @type {any} */ _session, /** @type {any} */ request) => {
                interactions.push(request);
                if (request.type === "select") return Promise.resolve({ outcome: "selected", value: "code_review" });
                return Promise.resolve({
                    outcome: "submitted",
                    _meta: { approved: true, feedback: "", annotations: [], images: [] },
                });
            },
            getCodeReviewMode: () => "none",
            mergeExecutionWorktree: () => Promise.resolve(),
            updateWorktreeRegistryEntry: () => Promise.resolve({}),
            recordPlanEvent: () => Promise.resolve({}),
            recordWorkflowMetric: () => Promise.resolve(null),
        }),
    });

    assertEquals(reviewCalls, 3);
    const choice = interactions.find((request) => request.type === "select");
    // No Stop option: stranding the work with nowhere to go is the dead end this
    // replaced.
    assertEquals(choice.options.map((/** @type {any} */ option) => option.value), ["continue", "code_review"]);
});

Deno.test("runValidationLoop continues to round four when the user asks for one", async () => {
    const { uiAPI } = makeValidationUi();
    const session = makeRecordedSession("semantic-round-continue-test", uiAPI);
    /** @type {string[]} */
    const promptModes = [];
    let reviewCalls = 0;

    await runValidationLoop({
        hostedSession: session,
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
            loadReviewerPrompt: (/** @type {string} */ mode) => {
                promptModes.push(mode);
                return Promise.resolve({
                    name: "reviewer",
                    displayName: "Reviewer",
                    model: "",
                    description: "",
                    tools: [],
                    systemPrompt: `${mode} prompt`,
                });
            },
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
                            details: { outcome: "task_completed", message: "fixed." },
                        }]),
                    );
                }
                reviewCalls++;
                const approved = reviewCalls === 4;
                return Promise.resolve(
                    /** @type {any} */ ([{
                        role: "toolResult",
                        toolName: "review_diff",
                        details: { command: "list", scope: "full", fileCount: 1 },
                    }, {
                        role: "toolResult",
                        toolName: "review_complete",
                        details: {
                            outcome: approved ? "approved" : "feedback",
                            approved,
                            feedback: approved ? "" : "missing requirement",
                            // One stubborn issue carried by identity through every
                            // round, then resolved in round four.
                            findings: approved
                                ? [{ id: "R1-1", resolved: true, title: "Issue from round 1" }]
                                : reviewCalls === 1
                                ? [{ title: "Issue from round 1" }]
                                : [{ id: "R1-1", resolved: false, title: "Issue from round 1" }],
                        },
                    }]),
                );
            },
            requestInteraction: (/** @type {any} */ _session, /** @type {any} */ request) => {
                if (request.type === "select") return Promise.resolve({ outcome: "selected", value: "continue" });
                return Promise.resolve({ outcome: "canceled" });
            },
            getCodeReviewMode: () => "none",
            mergeExecutionWorktree: () => Promise.resolve(),
            updateWorktreeRegistryEntry: () => Promise.resolve({}),
            recordPlanEvent: () => Promise.resolve({}),
            recordWorkflowMetric: () => Promise.resolve(null),
        }),
    });

    assertEquals(reviewCalls, 4);
    // Round four continues under the verification contract; it does not reset to a
    // fresh discovery sweep, and the ledger carries forward.
    assertEquals(promptModes, ["discovery", "discovery", "verify", "verify"]);
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ message) =>
            message.includes("Continuing with verification round 4")
        ),
        true,
    );
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ message) =>
            message.includes("Planned change execution and validation complete")
        ),
        true,
    );
});

Deno.test("runValidationLoop halts without prompting when the repair baseline cannot be captured", async () => {
    const { uiAPI } = makeValidationUi();
    const session = makeRecordedSession("repair-baseline-capture-failure-test", uiAPI);
    /** @type {any[]} */
    const interactions = [];

    const result = await runValidationLoop({
        hostedSession: session,
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            ...noOpWorktreePlanHandoffDeps(),
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve("diff --git a/file.js b/file.js\n+change\n"),
            captureWorktreeTree: () => Promise.reject(new Error("worktree vanished")),
            runIsolatedAgentSession: () =>
                Promise.resolve(
                    /** @type {any} */ ([{
                        role: "toolResult",
                        toolName: "review_diff",
                        details: { command: "list", scope: "full", fileCount: 1 },
                    }, {
                        role: "toolResult",
                        toolName: "review_complete",
                        details: {
                            outcome: "feedback",
                            approved: false,
                            feedback: "missing requirement",
                            findings: [{ title: "missing requirement" }],
                        },
                    }]),
                ),
            requestInteraction: (/** @type {any} */ _session, /** @type {any} */ request) => {
                interactions.push(request);
                return Promise.resolve({ outcome: "selected", value: "continue" });
            },
            recordPlanEvent: () => Promise.resolve({}),
            recordWorkflowMetric: () => Promise.resolve(null),
        }),
    });

    assertEquals(result.kind, "failed");
    // The user must not be asked to choose a next round the loop will not run —
    // their answer would be silently discarded by the halt.
    assertEquals(interactions, []);
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ m) => m.includes("Could not capture the pre-repair tree")),
        true,
    );
});

Deno.test("runValidationLoop halts cleanly when the repair diff cannot be computed", async () => {
    const { uiAPI } = makeValidationUi();
    const session = makeRecordedSession("repair-diff-failure-test", uiAPI);
    let reviewCalls = 0;

    // A stale tree object (for example after `git gc`) must produce a clear halt
    // rather than throwing out of validation entirely.
    const result = await runValidationLoop({
        hostedSession: session,
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            ...noOpWorktreePlanHandoffDeps(),
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve("diff --git a/file.js b/file.js\n+change\n"),
            captureWorktreeTree: () => Promise.resolve("tree-before-repair"),
            diffTrees: () => Promise.reject(new Error("bad object tree-before-repair")),
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
                            details: { outcome: "task_completed", message: "fixed." },
                        }]),
                    );
                }
                reviewCalls++;
                return Promise.resolve(
                    /** @type {any} */ ([{
                        role: "toolResult",
                        toolName: "review_diff",
                        details: { command: "list", scope: "full", fileCount: 1 },
                    }, {
                        role: "toolResult",
                        toolName: "review_complete",
                        details: {
                            outcome: "feedback",
                            approved: false,
                            feedback: "missing requirement",
                            findings: [{ title: "missing requirement" }],
                        },
                    }]),
                );
            },
            recordPlanEvent: () => Promise.resolve({}),
            recordWorkflowMetric: () => Promise.resolve(null),
        }),
    });

    assertEquals(reviewCalls, 1, "round two must not run against a scope it cannot compute");
    assertEquals(result.kind, "failed");
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ m) => m.includes("Could not compute the repair diff")),
        true,
    );
});
