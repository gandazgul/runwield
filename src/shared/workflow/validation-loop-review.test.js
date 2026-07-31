import { assertEquals, assertNotEquals, assertStringIncludes } from "@std/assert";

import { loadPlan } from "../../plan-store.js";
import { runValidationLoop } from "./validation.ts";
import { makeRecordedSession, makeUi, makeValidationProjectRoot } from "./validation-test-helpers.js";

function makeValidationUi() {
    const uiAPI = makeUi();
    return { uiAPI, hostedSession: makeRecordedSession("validation-review-test", uiAPI) };
}

async function makeValidatedCiRun(attrs = {}) {
    const projectRoot = await makeValidationProjectRoot("p", {
        classification: "QUICK_FIX",
        status: "validated_ci",
        ...attrs,
    });
    const { uiAPI, hostedSession } = makeValidationUi();
    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "QUICK_FIX", status: "validated_ci", ...attrs },
        executionAgent: "engineer",
        projectRoot,
        executionCwd: projectRoot,
        baselineTree: "baseline-tree",
        executionMode: "worktree",
        worktreeId: "wt1",
        worktreeBranch: "runwield/worktree/p-wt1",
        worktreeBaseBranch: "main",
    });
    return { projectRoot, hostedSession, uiAPI };
}

/**
 * @param {{ approved?: boolean, feedback?: string, findings?: Array<Record<string, unknown>>, advisories?: Array<Record<string, unknown>> }} [result]
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

function repairMessages(message = "R1-1 — fixed: added the missing guard.") {
    return /** @type {any} */ ([{
        role: "toolResult",
        toolName: "task_completed",
        details: { outcome: "task_completed", message },
    }]);
}

/**
 * @param {Record<string, unknown>} [overrides]
 */
function reviewPort(overrides = {}) {
    return /** @type {any} */ ({
        getCodeReviewMode: () => "none",
        loadReviewerPrompt: (/** @type {"discovery" | "verify"} */ mode) =>
            Promise.resolve({
                name: "reviewer",
                displayName: "Reviewer",
                model: "",
                description: "",
                tools: [],
                systemPrompt: `${mode} prompt`,
            }),
        loadReviewerFeedbackEngineerDef: () =>
            Promise.resolve({
                name: "reviewer-feedback-engineer",
                displayName: "Reviewer-Feedback Engineer",
                model: "",
                description: "",
                tools: ["read", "edit", "task_completed"],
                systemPrompt: "repair prompt",
            }),
        getDiffText: () => Promise.resolve("diff --git a/file.js b/file.js\n+change\n"),
        ...overrides,
    });
}

Deno.test("runValidationLoop resumes at validated_ci and skips CI before recording semantic approval for non-Git validation", async () => {
    const projectRoot = await makeValidationProjectRoot("p", {
        classification: "QUICK_FIX",
        status: "validated_ci",
        validationCiAttempts: 2,
    });
    const { hostedSession } = makeValidationUi();
    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "QUICK_FIX", status: "validated_ci", validationCiAttempts: 2 },
        executionAgent: "engineer",
        projectRoot,
        executionCwd: projectRoot,
        nonGitInPlace: true,
    });
    let ciCalls = 0;

    const result = await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "QUICK_FIX", status: "validated_ci", validationCiAttempts: 2 },
        semanticReviewPort: reviewPort({
            getDiffText: () => Promise.resolve(""),
        }),
        __deps: /** @type {any} */ ({
            runLocalCI: () => {
                ciCalls += 1;
                return Promise.resolve({ exitCode: 1, output: "should not run", canceled: false });
            },
        }),
    });

    const plan = await loadPlan(projectRoot, "p");
    assertEquals(ciCalls, 0);
    assertEquals(result.kind, "paused");
    assertEquals(plan?.attrs.status, "validated_reviewer");
});

Deno.test("runValidationLoop reviews the diff scoped to the active workflow baseline from validated_ci", async () => {
    const { projectRoot, hostedSession } = await makeValidatedCiRun();
    const reviewPrompts = /** @type {string[]} */ ([]);
    const baselineArgs = /** @type {Array<string | undefined>} */ ([]);

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "QUICK_FIX", status: "validated_ci" },
        semanticReviewPort: reviewPort({
            getDiffText: (/** @type {string | undefined} */ baselineTree) => {
                baselineArgs.push(baselineTree);
                return Promise.resolve("diff --git a/workflow.js b/workflow.js\n+scoped workflow change\n");
            },
            runIsolatedAgentSession: (/** @type {any} */ opts) => {
                reviewPrompts.push(opts.userRequest);
                return Promise.resolve(reviewerMessages());
            },
        }),
    });

    const plan = await loadPlan(projectRoot, "p");
    assertEquals(baselineArgs, ["baseline-tree"]);
    assertEquals(reviewPrompts.length, 1);
    assertStringIncludes(reviewPrompts[0], "workflow.js");
    assertEquals(reviewPrompts[0].includes("+scoped workflow change"), false);
    assertEquals(plan?.attrs.status, "validated_reviewer");
});

Deno.test("runValidationLoop configures Semantic Reviewer with diff tools and isolated session", async () => {
    const { hostedSession } = await makeValidatedCiRun();
    const rootSessionManager = /** @type {any} */ ({ id: "shared-root-history" });
    const sessionOpts = /** @type {any[]} */ ([]);

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "QUICK_FIX", status: "validated_ci" },
        sessionManager: rootSessionManager,
        semanticReviewPort: reviewPort({
            runIsolatedAgentSession: (/** @type {any} */ opts) => {
                sessionOpts.push(opts);
                return Promise.resolve(reviewerMessages());
            },
        }),
    });

    assertEquals(Object.hasOwn(sessionOpts[0], "uiAPI"), false);
    assertEquals(sessionOpts[0]._agentDefOverride.tools, [
        "read",
        "grep",
        "find",
        "ls",
        "review_diff",
        "review_complete",
    ]);
    assertEquals(sessionOpts[0].includeEditFallback, false);
    assertNotEquals(sessionOpts[0].sessionManager, rootSessionManager);
    assertEquals(
        (sessionOpts[0].customTools || []).some((/** @type {{ name: string }} */ tool) => tool.name === "review_diff"),
        true,
    );
});

Deno.test("runValidationLoop rejects an approved verdict reached without inspecting the diff", async () => {
    const { projectRoot, hostedSession } = await makeValidatedCiRun();
    const reviewPrompts = /** @type {string[]} */ ([]);
    let reviewCalls = 0;

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "QUICK_FIX", status: "validated_ci" },
        semanticReviewPort: reviewPort({
            runIsolatedAgentSession: (/** @type {any} */ opts) => {
                reviewPrompts.push(opts.userRequest);
                reviewCalls += 1;
                if (reviewCalls === 1) {
                    return Promise.resolve(
                        /** @type {any} */ ([{
                            role: "toolResult",
                            toolName: "review_complete",
                            details: { outcome: "approved", approved: true, feedback: "", findings: [] },
                        }]),
                    );
                }
                return Promise.resolve(reviewerMessages());
            },
        }),
    });

    const plan = await loadPlan(projectRoot, "p");
    assertEquals(reviewCalls, 2);
    assertStringIncludes(reviewPrompts[1], "without inspecting the diff");
    assertEquals(plan?.attrs.status, "validated_reviewer");
});

Deno.test("runValidationLoop does not count a failed review_diff call as inspecting the diff", async () => {
    const { hostedSession } = await makeValidatedCiRun();
    const reviewPrompts = /** @type {string[]} */ ([]);
    let reviewCalls = 0;

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "QUICK_FIX", status: "validated_ci" },
        semanticReviewPort: reviewPort({
            runIsolatedAgentSession: (/** @type {any} */ opts) => {
                reviewPrompts.push(opts.userRequest);
                reviewCalls += 1;
                if (reviewCalls === 1) {
                    return Promise.resolve(
                        /** @type {any} */ ([{
                            role: "toolResult",
                            toolName: "review_diff",
                            isError: true,
                            details: { command: "show", scope: "full", found: false },
                        }, {
                            role: "toolResult",
                            toolName: "review_complete",
                            details: { outcome: "approved", approved: true, feedback: "", findings: [] },
                        }]),
                    );
                }
                return Promise.resolve(reviewerMessages());
            },
        }),
    });

    assertEquals(reviewCalls, 2);
    assertStringIncludes(reviewPrompts[1], "without inspecting the diff");
});

Deno.test("runValidationLoop nudges the same reviewer session when review_complete is omitted", async () => {
    const { uiAPI, hostedSession } = await makeValidatedCiRun();
    const reviewOpts = /** @type {any[]} */ ([]);
    let reviewCalls = 0;

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "QUICK_FIX", status: "validated_ci" },
        semanticReviewPort: reviewPort({
            runIsolatedAgentSession: (/** @type {any} */ opts) => {
                reviewOpts.push(opts);
                reviewCalls += 1;
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
        }),
    });

    assertEquals(reviewCalls, 2);
    assertStringIncludes(reviewOpts[1].userRequest, "have not called review_complete");
    assertEquals(reviewOpts[1].userRequest.includes("Approved Plan"), false);
    assertEquals(reviewOpts[0].sessionManager, reviewOpts[1].sessionManager);
    assertStringIncludes(uiAPI.messages.join(" "), "Nudging Semantic Reviewer");
});

Deno.test("runValidationLoop pauses at validated_ci when the reviewer never finishes", async () => {
    const { projectRoot, hostedSession, uiAPI } = await makeValidatedCiRun({ validationSemanticRounds: 1 });
    let reviewCalls = 0;

    const result = await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "QUICK_FIX", status: "validated_ci", validationSemanticRounds: 1 },
        semanticReviewPort: reviewPort({
            runIsolatedAgentSession: () => {
                reviewCalls += 1;
                throw new Error("Context window exceeded");
            },
        }),
    });

    const plan = await loadPlan(projectRoot, "p");
    assertEquals(reviewCalls, 3);
    assertEquals(result.kind, "paused");
    assertEquals(plan?.attrs.status, "validated_ci");
    assertEquals(hostedSession.getActiveExecutionWorkflow()?.semanticRound, 1);
    assertStringIncludes(uiAPI.messages.join(" "), "Semantic Reviewer execution failed");
});

Deno.test("runValidationLoop dispatches semantic review feedback to Reviewer-Feedback Engineer and records feedback event", async () => {
    const { projectRoot, hostedSession, uiAPI } = await makeValidatedCiRun();
    const sessions = /** @type {any[]} */ ([]);

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "# p\n\nApproved Plan body",
        triageMeta: { classification: "QUICK_FIX", status: "validated_ci" },
        semanticReviewPort: reviewPort({
            runIsolatedAgentSession: (/** @type {any} */ opts) => {
                sessions.push(opts);
                if (opts.agentName === "reviewer-feedback-engineer") return Promise.resolve(repairMessages());
                return Promise.resolve(reviewerMessages({
                    approved: false,
                    feedback: "Missing guard",
                    findings: [{ title: "Missing guard", requirement: "Step 2", evidence: "file.js" }],
                }));
            },
        }),
    });

    const plan = await loadPlan(projectRoot, "p");
    const repairSession = sessions.find((opts) => opts.agentName === "reviewer-feedback-engineer");
    assertEquals(Boolean(repairSession), true);
    assertStringIncludes(repairSession.userRequest, "Missing guard");
    assertStringIncludes(repairSession.userRequest, "R1-1");
    assertStringIncludes(repairSession.userRequest, "validation fixture");
    assertEquals(plan?.attrs.status, "implemented");
    assertEquals(plan?.attrs.validationSemanticRounds, 1);
    assertStringIncludes(uiAPI.messages.join(" "), "Dispatching repair");
});

Deno.test("runValidationLoop carries existing ledger identities and repair report into the next semantic round", async () => {
    const ledger = {
        sequence: 1,
        items: [{
            id: "R1-1",
            openedInRound: 1,
            resolvedInRound: null,
            title: "Missing guard",
            requirement: "Step 2",
            evidence: "file.js",
        }],
    };
    const { projectRoot, hostedSession } = await makeValidatedCiRun({ validationSemanticRounds: 1 });
    hostedSession.setActiveExecutionWorkflow(
        /** @type {any} */ ({
            ...hostedSession.getActiveExecutionWorkflow(),
            reviewLedger: ledger,
            lastRepairReport: "R1-1 — fixed: added the guard in file.js.",
        }),
    );
    const reviewPrompts = /** @type {string[]} */ ([]);

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "QUICK_FIX", status: "validated_ci", validationSemanticRounds: 1 },
        semanticReviewPort: reviewPort({
            runIsolatedAgentSession: (/** @type {any} */ opts) => {
                reviewPrompts.push(opts.userRequest);
                return Promise.resolve(reviewerMessages({
                    findings: [{ id: "R1-1", resolved: true, title: "Missing guard" }],
                }));
            },
        }),
    });

    const plan = await loadPlan(projectRoot, "p");
    assertStringIncludes(reviewPrompts[0], "This is review round 2");
    assertStringIncludes(reviewPrompts[0], "R1-1");
    assertStringIncludes(reviewPrompts[0], "added the guard in file.js");
    assertStringIncludes(reviewPrompts[0], "claims to verify, not proof");
    assertEquals(plan?.attrs.status, "validated_reviewer");
});

Deno.test("runValidationLoop refuses semantic approval while a prior finding is unmentioned", async () => {
    const ledger = {
        sequence: 1,
        items: [{
            id: "R1-1",
            openedInRound: 1,
            resolvedInRound: null,
            title: "Missing guard",
            requirement: "Step 2",
            evidence: "file.js",
        }],
    };
    const { projectRoot, hostedSession } = await makeValidatedCiRun({ validationSemanticRounds: 1 });
    hostedSession.setActiveExecutionWorkflow(
        /** @type {any} */ ({ ...hostedSession.getActiveExecutionWorkflow(), reviewLedger: ledger }),
    );
    const reviewPrompts = /** @type {string[]} */ ([]);
    let reviewCalls = 0;

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "QUICK_FIX", status: "validated_ci", validationSemanticRounds: 1 },
        semanticReviewPort: reviewPort({
            runIsolatedAgentSession: (/** @type {any} */ opts) => {
                reviewPrompts.push(opts.userRequest);
                reviewCalls += 1;
                if (reviewCalls === 1) return Promise.resolve(reviewerMessages({ approved: true, findings: [] }));
                return Promise.resolve(reviewerMessages({
                    findings: [{ id: "R1-1", resolved: true, title: "Missing guard" }],
                }));
            },
        }),
    });

    const plan = await loadPlan(projectRoot, "p");
    assertEquals(reviewCalls, 2);
    assertStringIncludes(reviewPrompts[1], "does not mention this open finding: R1-1");
    assertStringIncludes(reviewPrompts[1], "Reuse the existing identities exactly");
    assertEquals(plan?.attrs.status, "validated_reviewer");
});

Deno.test("runValidationLoop narrows semantic review to verification mode after discovery rounds", async () => {
    const ledger = {
        sequence: 2,
        items: [{
            id: "R1-1",
            openedInRound: 1,
            resolvedInRound: null,
            title: "Issue from round 1",
            requirement: "Step 1",
            evidence: "file.js",
        }, {
            id: "R2-2",
            openedInRound: 2,
            resolvedInRound: null,
            title: "Issue from round 2",
            requirement: "Step 2",
            evidence: "file.js",
        }],
    };
    const { hostedSession } = await makeValidatedCiRun({ validationSemanticRounds: 2 });
    hostedSession.setActiveExecutionWorkflow(
        /** @type {any} */ ({ ...hostedSession.getActiveExecutionWorkflow(), reviewLedger: ledger }),
    );
    const promptModes = /** @type {string[]} */ ([]);
    const reviewPrompts = /** @type {string[]} */ ([]);

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "QUICK_FIX", status: "validated_ci", validationSemanticRounds: 2 },
        semanticReviewPort: reviewPort({
            loadReviewerPrompt: (/** @type {"discovery" | "verify"} */ mode) => {
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
            runIsolatedAgentSession: (/** @type {any} */ opts) => {
                reviewPrompts.push(opts.userRequest);
                return Promise.resolve(reviewerMessages({
                    findings: [
                        { id: "R1-1", resolved: true, title: "Issue from round 1" },
                        { id: "R2-2", resolved: true, title: "Issue from round 2" },
                    ],
                }));
            },
        }),
    });

    assertEquals(promptModes, ["verify"]);
    assertStringIncludes(reviewPrompts[0], "This is review round 3");
    assertStringIncludes(reviewPrompts[0], "Do not sweep the Plan again");
    assertStringIncludes(reviewPrompts[0], "R1-1");
    assertStringIncludes(reviewPrompts[0], "R2-2");
});

Deno.test("runValidationLoop offers Local Human Code Review after automatic semantic rounds", async () => {
    const { projectRoot, hostedSession } = await makeValidatedCiRun({ validationSemanticRounds: 2 });
    const interactions = /** @type {any[]} */ ([]);

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "QUICK_FIX", status: "validated_ci", validationSemanticRounds: 2 },
        semanticReviewPort: reviewPort({
            runIsolatedAgentSession: () =>
                Promise.resolve(reviewerMessages({
                    approved: false,
                    findings: [{ title: "Issue from round 1" }],
                })),
            requestInteraction: (/** @type {unknown} */ _session, /** @type {any} */ request) => {
                interactions.push(request);
                return Promise.resolve({ outcome: "selected", value: "code_review" });
            },
        }),
    });

    const plan = await loadPlan(projectRoot, "p");
    const choice = interactions.find((request) => request.type === "select");
    assertStringIncludes(choice.prompt, "has not approved after 3 rounds");
    assertEquals(choice.options.map((/** @type {{ value: string }} */ option) => option.value), [
        "continue",
        "code_review",
    ]);
    assertEquals(plan?.attrs.status, "validated_reviewer");
    assertEquals(plan?.attrs.humanReviewMode, "always");
    assertEquals(plan?.attrs.humanReviewDecision, null);
});
