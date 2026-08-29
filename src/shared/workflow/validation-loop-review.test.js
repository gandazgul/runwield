import { assertEquals, assertNotEquals, assertStringIncludes } from "@std/assert";

import { loadPlan } from "../../plan-store.js";
import { captureWorktreeTree } from "./git-snapshot.js";
import {
    git,
    makeRecordedSession,
    makeUi,
    makeValidationProjectRoot,
    runValidationPhase,
} from "./validation-test-helpers.js";

function makeValidationUi() {
    const uiAPI = makeUi();
    return { uiAPI, hostedSession: makeRecordedSession("validation-review-test", uiAPI) };
}

/**
 * @typedef {Record<string, string | number> & { executionAgent?: "engineer" | "frontend-engineer" }} ValidatedCiRunAttrs
 */

/**
 * @param {ValidatedCiRunAttrs} [attrs]
 */
async function makeValidatedCiRun(attrs = {}) {
    const projectRoot = await makeValidationProjectRoot("p", {
        classification: "QUICK_FIX",
        status: "validated_ci",
        ...attrs,
    });
    const { uiAPI, hostedSession } = makeValidationUi();
    await git(projectRoot, ["init", "-b", "main"]);
    await git(projectRoot, ["config", "user.email", "runwield@example.com"]);
    await git(projectRoot, ["config", "user.name", "RunWield Test"]);
    await git(projectRoot, ["add", "."]);
    await git(projectRoot, ["commit", "-m", "validation baseline"]);
    const baselineTree = await git(projectRoot, ["rev-parse", "HEAD^{tree}"]);
    await Deno.writeTextFile(`${projectRoot}/workflow.js`, "export const scopedWorkflowChange = true;\n");
    /** @type {import('../../tools/plan-written.ts').TriageMeta} */
    const triageMeta = { classification: "QUICK_FIX", status: "validated_ci", ...attrs };
    hostedSession.setWorkflowExecutionContext({
        planName: "p",
        triageMeta,
    });
    const executionAgent = attrs.executionAgent === "frontend-engineer" ? "frontend-engineer" : "engineer";
    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta,
        executionAgent,
        projectRoot,
        executionCwd: projectRoot,
        baselineTree,
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
        runIsolatedAgentSession: () => Promise.reject(new Error("Unexpected isolated Agent session")),
        ...overrides,
    });
}

/**
 * One isolated-session stand-in for both roles at the round limit: the Reviewer
 * reports findings, the Reviewer-Feedback Engineer reports the repair done. Only the
 * model is faked; the round loop, the repair dispatch and the lifecycle writes are real.
 *
 * @param {{ approved?: boolean }} [reviewer]
 */
function roundLimitPort(reviewer = {}) {
    return reviewPort({
        runIsolatedAgentSession: (/** @type {any} */ options) =>
            Promise.resolve(
                options?.agentName === "reviewer-feedback-engineer"
                    ? /** @type {any[]} */ ([{
                        role: "toolResult",
                        toolName: "task_completed",
                        toolCallId: "repair-1",
                        content: [],
                        isError: false,
                        timestamp: new Date().toISOString(),
                        details: { outcome: "task_completed", message: "- Addressed the finding." },
                    }])
                    : reviewerMessages({
                        approved: reviewer.approved === true,
                        findings: [{ title: "Issue from round 1" }],
                    }),
            ),
    });
}

Deno.test("runValidationPhase resumes at validated_ci and skips CI before recording semantic approval for non-Git validation", async () => {
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

    const result = await runValidationPhase({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "QUICK_FIX", status: "validated_ci", validationCiAttempts: 2 },
        semanticReviewPort: reviewPort(),
        localCI: {
            run: () => {
                ciCalls += 1;
                return Promise.resolve({ kind: "completed", exitCode: 1, output: "should not run" });
            },
        },
    });

    const plan = await loadPlan(projectRoot, "p");
    assertEquals(ciCalls, 0);
    assertEquals(result.kind, "paused");
    assertEquals(plan?.attrs.status, "validated_reviewer");
});

Deno.test("runValidationPhase reviews the diff scoped to the active workflow baseline from validated_ci", async () => {
    const expectedWorkflowContext = { routingIntent: "QUICK_FIX", complexity: "MEDIUM", planName: "p" };
    const { projectRoot, hostedSession } = await makeValidatedCiRun({ complexity: "MEDIUM" });
    const reviewPrompts = /** @type {string[]} */ ([]);
    assertEquals(hostedSession.getWorkflowContext(), expectedWorkflowContext);

    await runValidationPhase({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "QUICK_FIX", status: "validated_ci", complexity: "MEDIUM" },
        semanticReviewPort: reviewPort({
            runIsolatedAgentSession: (/** @type {any} */ opts) => {
                reviewPrompts.push(opts.userRequest);
                return Promise.resolve(reviewerMessages());
            },
        }),
    });

    const plan = await loadPlan(projectRoot, "p");
    assertEquals(reviewPrompts.length, 1);
    assertStringIncludes(reviewPrompts[0], "workflow.js");
    assertEquals(reviewPrompts[0].includes("+scoped workflow change"), false);
    assertEquals(hostedSession.getWorkflowContext(), expectedWorkflowContext);
    assertEquals(plan?.attrs.status, "validated_reviewer");
});

Deno.test("runValidationPhase configures Semantic Reviewer with diff tools and isolated session", async () => {
    const { hostedSession } = await makeValidatedCiRun();
    const rootSessionManager = /** @type {any} */ ({ id: "shared-root-history" });
    const sessionOpts = /** @type {any[]} */ ([]);

    await runValidationPhase({
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
    assertEquals(sessionOpts[0].subAgentDefinition, {
        id: "reviewer",
        options: { reviewerMode: "discovery" },
    });
    assertEquals(sessionOpts[0].toolNames, [
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

Deno.test("runValidationPhase rejects an approved verdict reached without inspecting the diff", async () => {
    const { projectRoot, hostedSession } = await makeValidatedCiRun();
    const reviewPrompts = /** @type {string[]} */ ([]);
    let reviewCalls = 0;

    await runValidationPhase({
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

Deno.test("runValidationPhase does not count a failed review_diff call as inspecting the diff", async () => {
    const { hostedSession } = await makeValidatedCiRun();
    const reviewPrompts = /** @type {string[]} */ ([]);
    let reviewCalls = 0;

    await runValidationPhase({
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

Deno.test("runValidationPhase nudges the same reviewer session when review_complete is omitted", async () => {
    const { uiAPI, hostedSession } = await makeValidatedCiRun();
    const reviewOpts = /** @type {any[]} */ ([]);
    let reviewCalls = 0;

    await runValidationPhase({
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
    assertStringIncludes(uiAPI.messages.join(" "), "AI code review needs more time");
});

Deno.test("runValidationPhase returns invalid review_complete arguments to the same Reviewer session", async () => {
    const { hostedSession } = await makeValidatedCiRun();
    const reviewOpts = /** @type {any[]} */ ([]);

    await runValidationPhase({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "QUICK_FIX", status: "validated_ci" },
        semanticReviewPort: reviewPort({
            runIsolatedAgentSession: (/** @type {any} */ opts) => {
                reviewOpts.push(opts);
                if (reviewOpts.length === 1) {
                    return Promise.resolve(
                        /** @type {any} */ ([{
                            role: "toolResult",
                            toolName: "review_complete",
                            isError: true,
                            content: [{ type: "text", text: "findings must be an array" }],
                        }]),
                    );
                }
                return Promise.resolve(reviewerMessages());
            },
        }),
    });

    assertEquals(reviewOpts.length, 2);
    assertStringIncludes(reviewOpts[1].userRequest, "Correct the review_complete arguments");
    assertEquals(reviewOpts[0].sessionManager, reviewOpts[1].sessionManager);
});

Deno.test("runValidationPhase replans after a missing review_diff item without retrying it", async () => {
    const { hostedSession } = await makeValidatedCiRun();
    const reviewOpts = /** @type {any[]} */ ([]);

    await runValidationPhase({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "QUICK_FIX", status: "validated_ci" },
        semanticReviewPort: reviewPort({
            runIsolatedAgentSession: (/** @type {any} */ opts) => {
                reviewOpts.push(opts);
                if (reviewOpts.length === 1) {
                    return Promise.resolve(
                        /** @type {any} */ ([{
                            role: "toolResult",
                            toolName: "review_diff",
                            isError: true,
                            content: [{ type: "text", text: "file does not exist" }],
                        }]),
                    );
                }
                return Promise.resolve(reviewerMessages());
            },
        }),
    });

    assertEquals(reviewOpts.length, 2);
    assertStringIncludes(reviewOpts[1].userRequest, "Do not request the missing item again");
    assertEquals(reviewOpts[0].sessionManager, reviewOpts[1].sessionManager);
});

Deno.test("runValidationPhase stops after one unknown Reviewer failure", async () => {
    const { projectRoot, hostedSession, uiAPI } = await makeValidatedCiRun({ validationSemanticRounds: 1 });
    let reviewCalls = 0;

    const result = await runValidationPhase({
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
    assertEquals(reviewCalls, 1);
    assertEquals(result.kind, "failed");
    assertEquals(plan?.attrs.status, "validated_ci");
    assertStringIncludes(uiAPI.messages.join(" "), "AI code review for p stopped.");
    assertStringIncludes(uiAPI.messages.join(" "), "Context window exceeded");
});

Deno.test("runValidationPhase dispatches semantic review feedback to Reviewer-Feedback Engineer and records feedback event", async () => {
    const expectedWorkflowContext = { routingIntent: "QUICK_FIX", complexity: "MEDIUM", planName: "p" };
    const { projectRoot, hostedSession, uiAPI } = await makeValidatedCiRun({
        complexity: "MEDIUM",
        executionAgent: "frontend-engineer",
    });
    const sessions = /** @type {any[]} */ ([]);
    const reviewerWorkflowContexts = /** @type {Array<Record<string, string> | null>} */ ([]);
    const repairWorkflowContexts = /** @type {Array<Record<string, string> | null>} */ ([]);
    const repairActiveOwners = /** @type {Array<string | undefined>} */ ([]);
    const repairActivePlanNames = /** @type {Array<string | null>} */ ([]);

    const result = await runValidationPhase({
        hostedSession,
        planName: "p",
        planContent: "# p\n\nApproved Plan body",
        triageMeta: {
            classification: "QUICK_FIX",
            status: "validated_ci",
            complexity: "MEDIUM",
            executionAgent: "frontend-engineer",
        },
        supportsSemanticRepairHandoff: true,
        semanticReviewPort: reviewPort({
            runIsolatedAgentSession: (/** @type {any} */ opts) => {
                sessions.push(opts);
                if (opts.agentName === "reviewer-feedback-engineer") {
                    repairWorkflowContexts.push(hostedSession.getWorkflowContext());
                    repairActiveOwners.push(hostedSession.getActiveExecutionWorkflow()?.executionAgent);
                    repairActivePlanNames.push(hostedSession.getActiveExecutionWorkflow()?.planName || null);
                    return Promise.resolve(repairMessages());
                }
                reviewerWorkflowContexts.push(hostedSession.getWorkflowContext());
                return Promise.resolve(reviewerMessages({
                    approved: false,
                    feedback: "Missing guard",
                    findings: [{ title: "Missing guard", requirement: "Step 2", evidence: "file.js" }],
                }));
            },
        }),
    });

    const plan = await loadPlan(projectRoot, "p");
    assertEquals(result.kind, "semantic_repair_handoff");
    assertStringIncludes(result.semanticRepairHandoff?.findingsSection || "", "Missing guard");
    assertEquals(sessions.map((opts) => opts.agentName), ["reviewer"]);
    assertEquals(reviewerWorkflowContexts, [expectedWorkflowContext]);
    assertEquals(repairWorkflowContexts, []);
    assertEquals(repairActiveOwners, []);
    assertEquals(repairActivePlanNames, []);
    assertEquals(hostedSession.getWorkflowContext(), expectedWorkflowContext);
    assertEquals(hostedSession.getActiveExecutionWorkflow()?.executionAgent, "frontend-engineer");
    assertEquals(plan?.attrs.status, "implemented");
    assertEquals(plan?.attrs.validationSemanticRounds, 1);
    assertStringIncludes(uiAPI.messages.join(" "), "AI code review 1 of 3 has begun");
});

Deno.test("runValidationPhase carries existing ledger identities and repair report into the next semantic round", async () => {
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
    const reviewModes = /** @type {string[]} */ ([]);

    await runValidationPhase({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "QUICK_FIX", status: "validated_ci", validationSemanticRounds: 1 },
        semanticReviewPort: reviewPort({
            runIsolatedAgentSession: (/** @type {any} */ opts) => {
                reviewPrompts.push(opts.userRequest);
                reviewModes.push(opts.subAgentDefinition?.options?.reviewerMode);
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
    assertEquals(reviewModes, ["verify"]);
    assertEquals(plan?.attrs.status, "validated_reviewer");
});

Deno.test("a resumed review without persisted findings performs one broad recovery review", async () => {
    const { hostedSession } = await makeValidatedCiRun({ validationSemanticRounds: 1 });
    const reviewModes = /** @type {string[]} */ ([]);

    await runValidationPhase({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "QUICK_FIX", status: "validated_ci", validationSemanticRounds: 1 },
        semanticReviewPort: reviewPort({
            runIsolatedAgentSession: (/** @type {any} */ opts) => {
                reviewModes.push(opts.subAgentDefinition?.options?.reviewerMode);
                return Promise.resolve(reviewerMessages());
            },
        }),
    });

    assertEquals(reviewModes, ["discovery"]);
});

Deno.test("an interrupted semantic repair pauses without recording validation failure", async () => {
    const { projectRoot, hostedSession } = await makeValidatedCiRun();
    const result = await runValidationPhase({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "QUICK_FIX", status: "validated_ci" },
        supportsSemanticRepairHandoff: false,
        semanticReviewPort: reviewPort({
            runIsolatedAgentSession: (/** @type {any} */ opts) =>
                Promise.resolve(
                    opts.agentName === "reviewer-feedback-engineer" ? [] : reviewerMessages({
                        approved: false,
                        feedback: "Missing guard",
                        findings: [{ title: "Missing guard" }],
                    }),
                ),
        }),
    });

    assertEquals(result.kind, "paused");
    const plan = await loadPlan(projectRoot, "p");
    assertEquals(plan?.attrs.status, "implemented");
    assertEquals(plan?.attrs.worktreeStatus, undefined);
});

Deno.test("runValidationPhase gives later semantic rounds a repair-scoped review_diff", async () => {
    const ledger = {
        sequence: 1,
        items: [{
            id: "R1-1",
            openedInRound: 1,
            resolvedInRound: null,
            title: "Missing guard",
            requirement: "Step 2",
            evidence: "workflow.js",
        }],
    };
    const { projectRoot, hostedSession } = await makeValidatedCiRun({ validationSemanticRounds: 1 });
    const repairBaselineTree = await captureWorktreeTree(projectRoot);
    await Deno.writeTextFile(`${projectRoot}/workflow.js`, "export const repairedWorkflowChange = true;\n");
    hostedSession.setActiveExecutionWorkflow(
        /** @type {any} */ ({
            ...hostedSession.getActiveExecutionWorkflow(),
            reviewLedger: ledger,
            repairBaselineTree,
            lastRepairReport: "R1-1 — fixed: updated workflow.js.",
        }),
    );
    const repairDiffTexts = /** @type {string[]} */ ([]);

    await runValidationPhase({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "QUICK_FIX", status: "validated_ci", validationSemanticRounds: 1 },
        semanticReviewPort: reviewPort({
            runIsolatedAgentSession: async (/** @type {any} */ opts) => {
                assertStringIncludes(opts.userRequest, 'scope: "repair"');
                const repairList = await opts.customTools[0].execute("repair-list", {
                    command: "list",
                    scope: "repair",
                });
                const repairShow = await opts.customTools[0].execute("repair-show", {
                    command: "show",
                    scope: "repair",
                    path: "workflow.js",
                });
                assertEquals(repairList.details.scope, "repair");
                assertEquals(repairList.details.fileCount, 1);
                repairDiffTexts.push(repairShow.content[0].text);
                return reviewerMessages({
                    findings: [{ id: "R1-1", resolved: true, title: "Missing guard" }],
                });
            },
        }),
    });

    assertStringIncludes(repairDiffTexts[0], "-export const scopedWorkflowChange = true;");
    assertStringIncludes(repairDiffTexts[0], "+export const repairedWorkflowChange = true;");
    assertEquals((await loadPlan(projectRoot, "p"))?.attrs.status, "validated_reviewer");
});

Deno.test("runValidationPhase refuses semantic approval while a prior finding is unmentioned", async () => {
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

    await runValidationPhase({
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

Deno.test("runValidationPhase narrows semantic review to verification mode after discovery rounds", async () => {
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
    const reviewPrompts = /** @type {string[]} */ ([]);

    await runValidationPhase({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "QUICK_FIX", status: "validated_ci", validationSemanticRounds: 2 },
        semanticReviewPort: reviewPort({
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

    assertStringIncludes(reviewPrompts[0], "This is review round 3");
    assertStringIncludes(reviewPrompts[0], "Do not sweep the Plan again");
    assertStringIncludes(reviewPrompts[0], "R1-1");
    assertStringIncludes(reviewPrompts[0], "R2-2");
});

Deno.test("runValidationPhase offers Local Human Code Review after automatic semantic rounds", async () => {
    const { projectRoot, hostedSession } = await makeValidatedCiRun({ validationSemanticRounds: 2 });
    const interactions = /** @type {any[]} */ ([]);

    hostedSession.setInteractionAdapter({
        requestInteraction: (/** @type {any} */ request) => {
            interactions.push(request);
            return Promise.resolve({ outcome: "selected", value: "code_review" });
        },
    });

    const result = await runValidationPhase({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "QUICK_FIX", status: "validated_ci", validationSemanticRounds: 2 },
        supportsSemanticRepairHandoff: true,
        semanticReviewPort: roundLimitPort(),
        localCI: {
            run: () => Promise.resolve({ kind: "completed", exitCode: 0, output: "" }),
        },
    });

    const plan = await loadPlan(projectRoot, "p");
    assertEquals(interactions.length, 0);
    assertEquals(result.kind, "semantic_repair_handoff");
    assertEquals(result.semanticRepairHandoff?.semanticRound, 3);
    assertEquals(plan?.attrs.status, "implemented");
    assertEquals(plan?.attrs.humanReviewMode, undefined);
    assertEquals(plan?.attrs.humanReviewDecision, undefined);
});

Deno.test("Stop at the review round limit keeps the passing tests and the open findings", async () => {
    const { projectRoot, hostedSession } = await makeValidatedCiRun({ validationSemanticRounds: 2 });

    hostedSession.setInteractionAdapter({
        requestInteraction: (/** @type {any} */ request) =>
            Promise.resolve(
                request.type === "select" ? { outcome: "selected", value: "stop" } : { outcome: "canceled" },
            ),
    });

    const result = await runValidationPhase({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "QUICK_FIX", status: "validated_ci", validationSemanticRounds: 2 },
        supportsSemanticRepairHandoff: true,
        semanticReviewPort: roundLimitPort(),
        localCI: {
            run: () => Promise.resolve({ kind: "completed", exitCode: 0, output: "" }),
        },
    });

    assertEquals(result.kind, "semantic_repair_handoff");
    assertStringIncludes(result.reason || "", "Dispatching repair");
    assertEquals(result.semanticRepairHandoff?.semanticRound, 3);
    // Semantic feedback reopens implementation; Runtime rolls to a repair segment and resumes validation after repair.
    assertEquals((await loadPlan(projectRoot, "p"))?.attrs.status, "implemented");
});

Deno.test("look again re-enters at the focused reviewer, after the repair and its tests", async () => {
    const { projectRoot, hostedSession } = await makeValidatedCiRun({ validationSemanticRounds: 2 });
    /** @type {Array<"discovery" | "verify">} */
    const modes = [];
    let ciRuns = 0;
    let asks = 0;
    let round = 0;

    hostedSession.setInteractionAdapter({
        requestInteraction: (/** @type {any} */ request) => {
            if (request.type === "select") asks += 1;
            return Promise.resolve({ outcome: "selected", value: "continue" });
        },
    });

    const result = await runValidationPhase({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "QUICK_FIX", status: "validated_ci", validationSemanticRounds: 2 },
        supportsSemanticRepairHandoff: true,
        semanticReviewPort: {
            ...roundLimitPort(),
            runIsolatedAgentSession: () => {
                modes.push("verify");
                round += 1;
                return Promise.resolve(
                    reviewerMessages({ approved: false, findings: [{ title: "Issue from round 1" }] }),
                );
            },
        },
        localCI: {
            run: () => {
                ciRuns += 1;
                return Promise.resolve({ kind: "completed", exitCode: 0, output: "" });
            },
        },
    });

    assertEquals(modes, ["verify"]);
    assertEquals(asks, 0);
    assertEquals(ciRuns, 0);
    assertEquals(round, 1);
    assertEquals(result.kind, "semantic_repair_handoff");
    assertEquals(result.semanticRepairHandoff?.semanticRound, 3);
    assertEquals((await loadPlan(projectRoot, "p"))?.attrs.status, "implemented");
});

Deno.test("^Claude MCP review completion waives only review_diff inspection$", async () => {
    // Accepted bridge-stamped review_complete: no review_diff transcript event
    // is needed, and no inspection nudge is issued.
    const { projectRoot, hostedSession } = await makeValidatedCiRun();
    const reviewPrompts = /** @type {string[]} */ ([]);
    let reviewCalls = 0;

    await runValidationPhase({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "QUICK_FIX", status: "validated_ci" },
        semanticReviewPort: reviewPort({
            runIsolatedAgentSession: (/** @type {any} */ opts) => {
                reviewPrompts.push(opts.userRequest);
                reviewCalls += 1;
                return Promise.resolve(
                    /** @type {any} */ ([{
                        role: "toolResult",
                        toolName: "review_complete",
                        details: {
                            outcome: "approved",
                            approved: true,
                            feedback: "",
                            findings: [],
                            advisories: [],
                            provenance: "claude-cli-mcp",
                        },
                    }]),
                );
            },
        }),
    });

    assertEquals(reviewCalls, 1);
    assertEquals(reviewPrompts[0].includes("without inspecting the diff"), false);
    assertEquals((await loadPlan(projectRoot, "p"))?.attrs.status, "validated_reviewer");

    // An otherwise identical result WITHOUT the trusted provenance is still
    // nudged: the waiver belongs to the Claude opaque-inspection policy only.
    const second = await makeValidatedCiRun();
    let untrustedCalls = 0;
    await runValidationPhase({
        hostedSession: second.hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "QUICK_FIX", status: "validated_ci" },
        semanticReviewPort: reviewPort({
            runIsolatedAgentSession: (/** @type {any} */ _opts) => {
                untrustedCalls += 1;
                if (untrustedCalls === 1) {
                    return Promise.resolve(
                        /** @type {any} */ ([{
                            role: "toolResult",
                            toolName: "review_complete",
                            details: {
                                outcome: "approved",
                                approved: true,
                                feedback: "",
                                findings: [],
                                advisories: [],
                            },
                        }]),
                    );
                }
                return Promise.resolve(reviewerMessages());
            },
        }),
    });
    assertEquals(untrustedCalls, 2);
    assertEquals((await loadPlan(second.projectRoot, "p"))?.attrs.status, "validated_reviewer");

    // The ledger rules remain authoritative for bridge-stamped results too: an
    // accepted verdict that leaves an open ledger identity unmentioned is nudged.
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
    const third = await makeValidatedCiRun({ validationSemanticRounds: 1 });
    third.hostedSession.setActiveExecutionWorkflow(
        /** @type {any} */ ({ ...third.hostedSession.getActiveExecutionWorkflow(), reviewLedger: ledger }),
    );
    const ledgerPrompts = /** @type {string[]} */ ([]);
    let ledgerCalls = 0;
    await runValidationPhase({
        hostedSession: third.hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "QUICK_FIX", status: "validated_ci", validationSemanticRounds: 1 },
        semanticReviewPort: reviewPort({
            runIsolatedAgentSession: (/** @type {any} */ opts) => {
                ledgerPrompts.push(opts.userRequest);
                ledgerCalls += 1;
                if (ledgerCalls === 1) {
                    return Promise.resolve(
                        /** @type {any} */ ([{
                            role: "toolResult",
                            toolName: "review_complete",
                            details: {
                                outcome: "approved",
                                approved: true,
                                feedback: "",
                                findings: [],
                                advisories: [],
                                provenance: "claude-cli-mcp",
                            },
                        }]),
                    );
                }
                return Promise.resolve(reviewerMessages({
                    findings: [{ id: "R1-1", resolved: true, title: "Missing guard" }],
                }));
            },
        }),
    });
    assertEquals(ledgerCalls, 2);
    assertStringIncludes(ledgerPrompts[1], "does not mention this open finding: R1-1");
    assertEquals((await loadPlan(third.projectRoot, "p"))?.attrs.status, "validated_reviewer");
});
