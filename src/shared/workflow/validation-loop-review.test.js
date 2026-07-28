import { assertEquals, assertNotEquals, assertStringIncludes } from "@std/assert";

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

/**
 * A Reviewer transcript that inspected the diff before deciding.
 *
 * The diff is never inlined into the prompt, so a review_complete call with no
 * review_diff call ahead of it is treated as a verdict reached without reading
 * the code — every mock that expects to be believed must include both.
 *
 * @param {{ approved?: boolean, feedback?: string, findings?: any[], advisories?: any[] }} [result]
 */
function reviewerMessages(result = {}) {
    const approved = result.approved !== false;
    return /** @type {any} */ ([{
        role: "toolResult",
        toolName: "review_diff",
        details: { command: "list", scope: "full", fileCount: 1 },
    }, {
        role: "toolResult",
        toolName: "review_complete",
        details: {
            outcome: approved ? "approved" : "feedback",
            approved,
            feedback: result.feedback || "",
            findings: result.findings || [],
            advisories: result.advisories || [],
        },
    }]);
}

/** A repair agent transcript that finished and reported per-item dispositions. */
function repairMessages(message = "R1-1 — fixed: added the missing guard.") {
    return /** @type {any} */ ([{
        role: "toolResult",
        toolName: "task_completed",
        details: { outcome: "task_completed", message },
    }]);
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
                return Promise.resolve(reviewerMessages());
            },
            recordPlanEvent: noOpRecordPlanEvent,
        }),
    });

    assertEquals(baselineArgs, ["baseline-tree"]);
    assertEquals(reviewPrompts.length, 1);
    // The changed file is named so the Reviewer knows what to open; the diff body
    // itself only reaches it through review_diff.
    assertStringIncludes(reviewPrompts[0], "workflow.js");
    assertEquals(reviewPrompts[0].includes("+scoped workflow change"), false);
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
                return Promise.resolve(reviewerMessages());
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
    assertEquals(sessionOpts[0]._agentDefOverride.tools, [
        "read",
        "grep",
        "find",
        "ls",
        "review_diff",
        "review_complete",
    ]);
    assertEquals(sessionOpts[0]._agentDefOverride.systemPrompt.includes("{{SKILLS}}"), false);
    assertEquals(sessionOpts[0].includeEditFallback, false);
    assertEquals(Object.hasOwn(sessionOpts[0], "useRootSession"), false);
    assertNotEquals(
        sessionOpts[0].sessionManager,
        rootSessionManager,
        "Reviewer must not receive the shared workflow SessionManager",
    );
});

Deno.test("runValidationLoop never inlines the diff regardless of size", async () => {
    const hostedSession = makeRecordedSession("validation-test", makeUi());
    /** @type {string[]} */
    const reviewPrompts = [];

    // Well past the old 60KB inline threshold, which no longer exists.
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
                const hasReviewDiff = (opts.customTools || []).some(
                    (/** @type {{ name: string }} */ t) => t.name === "review_diff",
                );
                assertEquals(hasReviewDiff, true, "every review gets the review_diff tool");
                assertEquals(opts._agentDefOverride.tools.includes("read"), true);
                assertEquals(opts._agentDefOverride.tools.includes("grep"), true);
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
                return Promise.resolve(reviewerMessages());
            },
            getCodeReviewMode: () => "none",
            mergeExecutionWorktree: () => Promise.resolve(),
            updateWorktreeRegistryEntry: () => Promise.resolve({}),
            recordPlanEvent: () => Promise.resolve({}),
        }),
    });

    assertEquals(reviewPrompts[0].includes("line 1999"), false, "diff must never be inlined");
    assertStringIncludes(reviewPrompts[0], "src/big.js");
    assertStringIncludes(reviewPrompts[0], "review_diff");
});

Deno.test("runValidationLoop rejects a verdict reached without inspecting the diff", async () => {
    const { uiAPI, hostedSession } = makeValidationUi();
    /** @type {string[]} */
    const reviewPrompts = [];
    let reviewCalls = 0;

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
            runIsolatedAgentSession: (/** @type {any} */ opts) => {
                reviewPrompts.push(opts.userRequest);
                reviewCalls++;
                if (reviewCalls === 1) {
                    // Approves without ever calling review_diff.
                    return Promise.resolve(
                        /** @type {any} */ ([{
                            role: "toolResult",
                            toolName: "review_complete",
                            details: { outcome: "approved", approved: true, feedback: "" },
                        }]),
                    );
                }
                return Promise.resolve(reviewerMessages());
            },
            getCodeReviewMode: () => "none",
            mergeExecutionWorktree: () => Promise.resolve(),
            updateWorktreeRegistryEntry: () => Promise.resolve({}),
            recordPlanEvent: () => Promise.resolve({}),
        }),
    });

    assertEquals(reviewCalls, 2, "an uninspected verdict must cost a continuation attempt");
    assertStringIncludes(reviewPrompts[1], "without inspecting the diff");
    assertStringIncludes(uiAPI.messages.join(" "), "Semantic Code Review Approved");
});

Deno.test("runValidationLoop nudges the same reviewer session when review_complete is omitted", async () => {
    const { uiAPI, hostedSession } = makeValidationUi();
    /** @type {any[]} */
    const reviewOpts = [];
    let reviewCalls = 0;

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
            runIsolatedAgentSession: (/** @type {any} */ opts) => {
                reviewOpts.push(opts);
                reviewCalls++;
                if (reviewCalls === 1) {
                    return Promise.resolve(
                        /** @type {any} */ ([{
                            role: "toolResult",
                            toolName: "review_diff",
                            details: { command: "list", scope: "full", fileCount: 1 },
                        }, {
                            role: "assistant",
                            content: [{ type: "text", text: "The implementation matches the plan." }],
                        }]),
                    );
                }
                return Promise.resolve(reviewerMessages());
            },
            getCodeReviewMode: () => "none",
            mergeExecutionWorktree: () => Promise.resolve(),
            updateWorktreeRegistryEntry: () => Promise.resolve({}),
            recordPlanEvent: () => Promise.resolve({}),
        }),
    });

    assertEquals(reviewCalls, 2);
    assertEquals(uiAPI.promptSelections, []);
    // The nudge is short and reuses the Reviewer's own session: restarting the
    // review would discard analysis it has already done.
    assertStringIncludes(reviewOpts[1].userRequest, "have not called review_complete");
    assertEquals(reviewOpts[1].userRequest.includes("Approved Plan"), false);
    assertEquals(
        reviewOpts[0].sessionManager,
        reviewOpts[1].sessionManager,
        "the nudge must reach the same reviewer session",
    );
    assertStringIncludes(uiAPI.messages.join(" "), "Nudging Semantic Reviewer");
    assertStringIncludes(uiAPI.messages.join(" "), "Semantic Code Review Approved");
});

Deno.test("runValidationLoop pauses instead of halting when the reviewer never finishes", async () => {
    const { uiAPI, hostedSession } = makeValidationUi();
    let reviewCalls = 0;

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
            runIsolatedAgentSession: () => {
                reviewCalls++;
                throw new Error("Context window exceeded");
            },
            recordPlanEvent: () => Promise.resolve({}),
        }),
    });

    assertEquals(reviewCalls, 3);
    assertEquals(uiAPI.promptSelections, []);
    assertEquals(result.kind, "paused", "an exhausted reviewer must leave the user able to nudge, not halt");
    assertStringIncludes(uiAPI.messages.join(" "), "Semantic Reviewer execution failed");
    // The round is stepped back so continuing re-runs it rather than skipping it.
    assertEquals(hostedSession.getActiveExecutionWorkflow()?.semanticRound, 0);
});

Deno.test("runValidationLoop retries the reviewer after invocation errors", async () => {
    const { uiAPI, hostedSession } = makeValidationUi();
    const rootSessionManager = /** @type {any} */ ({ id: "shared-root-history" });
    let reviewCalls = 0;
    /** @type {any[]} */
    const reviewOpts = [];

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
                if (reviewCalls === 1) throw new Error("Context window exceeded");
                return Promise.resolve(reviewerMessages());
            },
            getCodeReviewMode: () => "none",
            mergeExecutionWorktree: () => Promise.resolve(),
            updateWorktreeRegistryEntry: () => Promise.resolve({}),
            recordPlanEvent: () => Promise.resolve({}),
        }),
    });

    assertEquals(reviewCalls, 2, "should retry reviewer session");
    for (const opts of reviewOpts) {
        assertNotEquals(
            opts.sessionManager,
            rootSessionManager,
            "Reviewer must never receive the shared workflow SessionManager",
        );
    }
    assertStringIncludes(uiAPI.messages.join(" "), "Nudging Semantic Reviewer");
    assertStringIncludes(uiAPI.messages.join(" "), "Semantic Code Review Approved");
});

Deno.test("runValidationLoop dispatches rejections to the Reviewer-Feedback Engineer in fresh context", async () => {
    const { uiAPI, hostedSession } = makeValidationUi();
    const rootSessionManager = /** @type {any} */ ({ id: "shared-root-history" });
    /** @type {any[]} */
    const sessions = [];
    let reviewCalls = 0;

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
            captureWorktreeTree: () => Promise.resolve("tree-before-repair"),
            diffTrees: () => Promise.resolve("diff --git a/file.js b/file.js\n+repair\n"),
            loadReviewerFeedbackEngineerDef: () =>
                Promise.resolve({
                    name: "reviewer-feedback-engineer",
                    displayName: "Reviewer-Feedback Engineer",
                    model: "",
                    description: "",
                    tools: ["read", "edit", "task_completed"],
                    systemPrompt: "repair prompt",
                }),
            runIsolatedAgentSession: (/** @type {any} */ opts) => {
                sessions.push(opts);
                if (opts.agentName === "reviewer-feedback-engineer") {
                    return Promise.resolve(repairMessages());
                }
                reviewCalls++;
                if (reviewCalls === 1) {
                    return Promise.resolve(reviewerMessages({
                        approved: false,
                        findings: [{ title: "Missing guard", requirement: "Step 2", evidence: "file.js" }],
                    }));
                }
                return Promise.resolve(reviewerMessages({
                    approved: true,
                    findings: [{ id: "R1-1", resolved: true, title: "Missing guard" }],
                }));
            },
            getCodeReviewMode: () => "none",
            mergeExecutionWorktree: () => Promise.resolve(),
            updateWorktreeRegistryEntry: () => Promise.resolve({}),
            recordPlanEvent: () => Promise.resolve({}),
        }),
    });

    const repairSession = sessions.find((opts) => opts.agentName === "reviewer-feedback-engineer");
    assertEquals(Boolean(repairSession), true, "rejection must dispatch the Reviewer-Feedback Engineer");
    // Fresh context: the repair never rides on the execution transcript.
    assertNotEquals(repairSession.sessionManager, rootSessionManager);
    assertStringIncludes(repairSession.userRequest, "Missing guard");
    assertStringIncludes(repairSession.userRequest, "R1-1");
    assertStringIncludes(repairSession.userRequest, "Approved Plan");
    assertStringIncludes(uiAPI.messages.join(" "), "Semantic Code Review Approved");
});

Deno.test("runValidationLoop carries the ledger and repair report into the next round", async () => {
    const { hostedSession } = makeValidationUi();
    /** @type {string[]} */
    const reviewPrompts = [];
    let reviewCalls = 0;

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
                    return Promise.resolve(repairMessages("R1-1 — fixed: added the guard in file.js."));
                }
                reviewPrompts.push(opts.userRequest);
                reviewCalls++;
                if (reviewCalls === 1) {
                    return Promise.resolve(reviewerMessages({
                        approved: false,
                        findings: [{ title: "Missing guard", requirement: "Step 2", evidence: "file.js" }],
                    }));
                }
                return Promise.resolve(reviewerMessages({
                    approved: true,
                    findings: [{ id: "R1-1", resolved: true, title: "Missing guard" }],
                }));
            },
            getCodeReviewMode: () => "none",
            mergeExecutionWorktree: () => Promise.resolve(),
            updateWorktreeRegistryEntry: () => Promise.resolve({}),
            recordPlanEvent: () => Promise.resolve({}),
        }),
    });

    assertEquals(reviewCalls, 2);
    // Round 2 is still a discovery round, but it also receives the open ledger and
    // the repair agent's claims so it can verify rather than rediscover.
    assertStringIncludes(reviewPrompts[1], "This is review round 2");
    assertStringIncludes(reviewPrompts[1], "R1-1");
    assertStringIncludes(reviewPrompts[1], "Missing guard");
    assertStringIncludes(reviewPrompts[1], "added the guard in file.js");
    assertStringIncludes(reviewPrompts[1], "claims to verify, not proof");
});

Deno.test("runValidationLoop narrows to verification mode from round three", async () => {
    const { hostedSession } = makeValidationUi();
    /** @type {string[]} */
    const reviewPrompts = [];
    /** @type {string[]} */
    const promptModes = [];
    let reviewCalls = 0;

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
                if (opts.agentName === "reviewer-feedback-engineer") return Promise.resolve(repairMessages());
                reviewPrompts.push(opts.userRequest);
                reviewCalls++;
                if (reviewCalls === 1) {
                    return Promise.resolve(reviewerMessages({
                        approved: false,
                        findings: [{ title: "Issue from round 1" }],
                    }));
                }
                if (reviewCalls === 2) {
                    // Round two keeps round one's item open by identity and appends a
                    // newly discovered one.
                    return Promise.resolve(reviewerMessages({
                        approved: false,
                        findings: [
                            { id: "R1-1", resolved: false, title: "Issue from round 1" },
                            { title: "Issue from round 2" },
                        ],
                    }));
                }
                return Promise.resolve(reviewerMessages({
                    approved: true,
                    findings: [
                        { id: "R1-1", resolved: true, title: "Issue from round 1" },
                        { id: "R2-2", resolved: true, title: "Issue from round 2" },
                    ],
                }));
            },
            getCodeReviewMode: () => "none",
            mergeExecutionWorktree: () => Promise.resolve(),
            updateWorktreeRegistryEntry: () => Promise.resolve({}),
            recordPlanEvent: () => Promise.resolve({}),
        }),
    });

    assertEquals(reviewCalls, 3);
    assertEquals(promptModes, ["discovery", "discovery", "verify"]);
    assertStringIncludes(reviewPrompts[2], "This is review round 3");
    // Identities are never renumbered across rounds.
    assertStringIncludes(reviewPrompts[2], "R1-1");
    assertStringIncludes(reviewPrompts[2], "R2-2");
});

Deno.test("runValidationLoop offers code review instead of stranding after three rounds", async () => {
    const { uiAPI, hostedSession } = makeValidationUi();
    /** @type {any[]} */
    const interactions = [];
    let reviewCalls = 0;

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
                if (opts.agentName === "reviewer-feedback-engineer") return Promise.resolve(repairMessages());
                reviewCalls++;
                // The same unfixed issue, carried by identity so it stays one item.
                return Promise.resolve(reviewerMessages({
                    approved: false,
                    findings: reviewCalls === 1
                        ? [{ title: "Issue from round 1" }]
                        : [{ id: "R1-1", resolved: false, title: "Issue from round 1" }],
                }));
            },
            requestInteraction: (/** @type {any} */ _session, /** @type {any} */ request) => {
                interactions.push(request);
                if (request.type === "select") {
                    return Promise.resolve({ outcome: "selected", value: "code_review" });
                }
                return Promise.resolve({
                    outcome: "submitted",
                    _meta: { approved: true, feedback: "", annotations: [], images: [] },
                });
            },
            // "none" must not suppress the review the user explicitly asked for.
            getCodeReviewMode: () => "none",
            mergeExecutionWorktree: () => Promise.resolve(),
            updateWorktreeRegistryEntry: () => Promise.resolve({}),
            recordPlanEvent: () => Promise.resolve({}),
        }),
    });

    assertEquals(reviewCalls, 3, "automatic rounds stop after three");
    const choice = interactions.find((request) => request.type === "select");
    assertStringIncludes(choice.prompt, "has not approved after 3 rounds");
    assertStringIncludes(choice.prompt, "not been verified");
    // There is deliberately no Stop option — stranding the work is the dead end
    // this replaced.
    assertEquals(choice.options.map((/** @type {any} */ o) => o.value), ["continue", "code_review"]);
    assertEquals(interactions.some((request) => request.type === "code_review"), true);
    assertStringIncludes(uiAPI.messages.join(" "), "without semantic approval");
});

Deno.test("runValidationLoop does not count a failed review_diff call as inspecting the diff", async () => {
    const { hostedSession } = makeValidationUi();
    let reviewCalls = 0;
    /** @type {string[]} */
    const reviewPrompts = [];

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
            runIsolatedAgentSession: (/** @type {any} */ opts) => {
                reviewPrompts.push(opts.userRequest);
                reviewCalls++;
                if (reviewCalls === 1) {
                    // A botched lookup plus a request for a scope that does not exist
                    // yet — the Reviewer saw no code, so approving is not a review.
                    return Promise.resolve(
                        /** @type {any} */ ([{
                            role: "toolResult",
                            toolName: "review_diff",
                            isError: true,
                            details: { command: "show", scope: "full", found: false },
                        }, {
                            role: "toolResult",
                            toolName: "review_diff",
                            details: { command: "list", scope: "repair", available: false },
                        }, {
                            role: "toolResult",
                            toolName: "review_complete",
                            details: { outcome: "approved", approved: true, feedback: "", findings: [] },
                        }]),
                    );
                }
                return Promise.resolve(reviewerMessages());
            },
            getCodeReviewMode: () => "none",
            mergeExecutionWorktree: () => Promise.resolve(),
            updateWorktreeRegistryEntry: () => Promise.resolve({}),
            recordPlanEvent: () => Promise.resolve({}),
        }),
    });

    assertEquals(reviewCalls, 2);
    assertStringIncludes(reviewPrompts[1], "without inspecting the diff");
});

Deno.test("runValidationLoop refuses to approve while a prior finding goes unmentioned", async () => {
    const { hostedSession } = makeValidationUi();
    /** @type {string[]} */
    const reviewPrompts = [];
    let reviewCalls = 0;

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
                if (opts.agentName === "reviewer-feedback-engineer") return Promise.resolve(repairMessages());
                reviewPrompts.push(opts.userRequest);
                reviewCalls++;
                if (reviewCalls === 1) {
                    return Promise.resolve(reviewerMessages({
                        approved: false,
                        findings: [{ title: "Missing guard", requirement: "Step 2", evidence: "file.js" }],
                    }));
                }
                if (reviewCalls === 2) {
                    // Approves while R1-1 is still open and unmentioned. Merging here
                    // would ship an unaddressed blocking finding.
                    return Promise.resolve(reviewerMessages({ approved: true, findings: [] }));
                }
                return Promise.resolve(reviewerMessages({
                    approved: true,
                    findings: [{ id: "R1-1", resolved: true, title: "Missing guard" }],
                }));
            },
            getCodeReviewMode: () => "none",
            mergeExecutionWorktree: () => Promise.resolve(),
            updateWorktreeRegistryEntry: () => Promise.resolve({}),
            recordPlanEvent: () => Promise.resolve({}),
        }),
    });

    assertEquals(reviewCalls, 3, "the silent approval must cost a continuation attempt");
    assertStringIncludes(reviewPrompts[2], "does not mention this open finding: R1-1");
    assertStringIncludes(reviewPrompts[2], "Reuse the existing identities exactly");
});

Deno.test("runValidationLoop rejects a re-reported finding that would duplicate the ledger", async () => {
    const { hostedSession } = makeValidationUi();
    /** @type {string[]} */
    const repairPackets = [];
    /** @type {string[]} */
    const reviewPrompts = [];
    let reviewCalls = 0;

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
                    repairPackets.push(opts.userRequest);
                    return Promise.resolve(repairMessages());
                }
                reviewPrompts.push(opts.userRequest);
                reviewCalls++;
                if (reviewCalls === 1) {
                    return Promise.resolve(reviewerMessages({
                        approved: false,
                        findings: [{ title: "Missing guard", requirement: "Step 2", evidence: "file.js" }],
                    }));
                }
                if (reviewCalls === 2) {
                    // Same defect re-reported without its identity. Accepting this
                    // would leave R1-1 open beside a new R2-2 for one real issue.
                    return Promise.resolve(reviewerMessages({
                        approved: false,
                        findings: [{ title: "Guard is still missing", requirement: "Step 2" }],
                    }));
                }
                return Promise.resolve(reviewerMessages({
                    approved: true,
                    findings: [{ id: "R1-1", resolved: true, title: "Missing guard" }],
                }));
            },
            getCodeReviewMode: () => "none",
            mergeExecutionWorktree: () => Promise.resolve(),
            updateWorktreeRegistryEntry: () => Promise.resolve({}),
            recordPlanEvent: () => Promise.resolve({}),
        }),
    });

    assertEquals(reviewCalls, 3);
    assertStringIncludes(reviewPrompts[2], "R1-1");
    // One defect stayed one ledger item, so the repair agent is never asked to fix
    // the same thing twice.
    for (const packet of repairPackets) {
        assertEquals(packet.includes("R2-2"), false, "a re-report must not become a second identity");
    }
});
