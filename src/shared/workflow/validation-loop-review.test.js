// deno-lint-ignore-file no-unused-vars
import { assertEquals, assertStringIncludes } from "@std/assert";
import { loadPlan, savePlan } from "../../plan-store.js";
import { createExecutionWorktree } from "../worktree.js";
import {
    loadManualQaPrompt,
    loadReviewerPrompt,
    runLocalCI,
    runManualQaChecklistPrompt,
    runMechanicalValidation,
    runValidationLoop,
} from "./validation.js";
import { HostedSession } from "../session/hosted-session.js";
import { createSessionRuntimeEvent } from "../session/session-runtime-events.js";
import { __resetSettingsForTests } from "../settings.js";

const hostedSession = new HostedSession({ id: "validation-test", cwd: Deno.cwd() });

/**
 * @param {string} cwd
 * @param {string[]} args
 * @returns {Promise<string>}
 */
async function git(cwd, args) {
    const output = await new Deno.Command("git", { cwd, args, stdout: "piped", stderr: "piped" }).output();
    const text = new TextDecoder().decode(output.stdout);
    if (!output.success) throw new Error(new TextDecoder().decode(output.stderr));
    return text.trim();
}

/**
 * @returns {any & { messages: string[], systemCalls: Array<{ message: string, isError: boolean, header: string, level: string, validationProgress?: import('../session/session-runtime-events.js').RuntimeValidationProgress }>, promptSelections: string[], busyStates: boolean[], toolCalls: Array<{ id: string, name: string, args: string }>, toolOutputs: string[], toolResults: Array<{ id: string, name: string, result: string, isError: boolean, durationMs: number }> }}
 */
function makeUi() {
    /** @type {string[]} */
    const messages = [];
    /** @type {Array<{ message: string, isError: boolean, header: string, level: string, validationProgress?: import('../session/session-runtime-events.js').RuntimeValidationProgress }>} */
    const systemCalls = [];
    /** @type {string[]} */
    const promptSelections = [];
    /** @type {boolean[]} */
    const busyStates = [];
    /** @type {Array<{ id: string, name: string, args: string }>} */
    const toolCalls = [];
    /** @type {string[]} */
    const toolOutputs = [];
    /** @type {Array<{ id: string, name: string, result: string, isError: boolean, durationMs: number }>} */
    const toolResults = [];
    const recorder = /** @type {any} */ ({
        messages,
        systemCalls,
        promptSelections,
        busyStates,
        toolCalls,
        toolOutputs,
        toolResults,
        appendSystemMessage: (
            /** @type {string} */ msg,
            /** @type {boolean} */ isError = false,
            /** @type {string} */ header = "",
        ) => {
            messages.push(String(msg));
            systemCalls.push({ message: String(msg), isError, header, level: isError ? "error" : "info" });
        },
        promptSelect: () => {
            promptSelections.push("prompted");
            return Promise.resolve("stop");
        },
        promptText: () => Promise.resolve("deno task test"),
        setBusy: (/** @type {boolean} */ busy) => busyStates.push(busy),
        startToolExecution: (/** @type {string} */ id, /** @type {string} */ name, /** @type {string} */ args) => {
            toolCalls.push({ id, name, args });
            return {
                setOutput: (/** @type {string} */ text) => toolOutputs.push(text),
                endExecution: (/** @type {boolean} */ isError, /** @type {number} */ durationMs) => {
                    toolResults.push({ id, name, result: "", isError, durationMs });
                },
                bodyText: "",
                startTime: Date.now(),
            };
        },
        addToolInvoked: (/** @type {{ id: string, name: string, input: { command?: string } }} */ event) => {
            toolCalls.push({ id: event.id, name: event.name, args: event.input.command || "" });
        },
        addToolResult: (
            /** @type {{ id: string, name: string, result: string, isError: boolean, durationMs: number }} */ event,
        ) => {
            toolResults.push(event);
        },
    });
    attachRecorder(hostedSession, recorder);
    return recorder;
}

/**
 * @param {HostedSession} session
 * @param {ReturnType<typeof makeUi>} recorder
 * @returns {HostedSession}
 */
function attachRecorder(session, recorder) {
    session.setEventSink((/** @type {any} */ partialEvent) => {
        const event = /** @type {any} */ (createSessionRuntimeEvent(session.id, partialEvent));
        if (event.type === "system_status" || event.type === "terminal_error") {
            const message = String(event.message || "");
            recorder.messages.push(message);
            recorder.systemCalls.push({
                message,
                isError: event.level === "error" || event.type === "terminal_error",
                header: event.header || "",
                level: event.level || (event.type === "terminal_error" ? "error" : "info"),
                ...(event.validationProgress ? { validationProgress: event.validationProgress } : {}),
            });
        } else if (event.type === "busy_changed") {
            recorder.busyStates.push(Boolean(event.busy));
        } else if (event.type === "tool_start") {
            recorder.toolCalls.push({ id: event.toolCallId, name: event.toolName, args: event.args?.command || "" });
        } else if (event.type === "tool_update") {
            recorder.toolOutputs.push(event.output);
        } else if (event.type === "tool_end") {
            recorder.toolOutputs.push(event.output);
            recorder.toolResults.push({
                id: event.toolCallId,
                name: event.toolName,
                result: event.output,
                isError: Boolean(event.isError),
                durationMs: Number(event.durationMs || 0),
            });
        }
    });
    session.setInteractionAdapter({
        requestInteraction: async (request) => {
            if (request.type === "text") {
                const value = await recorder.promptText(request.prompt, request);
                return value === null ? { outcome: "canceled" } : { outcome: "text", value };
            }
            const value = await recorder.promptSelect(request.prompt, request.options || []);
            return value === null ? { outcome: "canceled" } : { outcome: "selected", value };
        },
    });
    return session;
}

/**
 * @param {string} id
 * @param {ReturnType<typeof makeUi>} recorder
 * @returns {HostedSession}
 */
function makeRecordedSession(id, recorder) {
    return attachRecorder(new HostedSession({ id, cwd: Deno.cwd() }), recorder);
}

function noOpRecordPlanEvent() {
    return Promise.resolve({});
}

function noOpWorktreePlanHandoffDeps() {
    return {
        switchActiveAgent: (
            /** @type {unknown} */ _hostedSession,
            /** @type {{ agentName: string }} */ options,
        ) => Promise.resolve({ ok: true, agentName: options.agentName, changed: true }),
        stageValidationPassedInExecutionWorktree: () =>
            Promise.resolve({ attrs: /** @type {any} */ ({ status: "verified" }), planPaths: ["plans/p.md"] }),
        preparePrimaryPlanPathForMerge: () =>
            Promise.resolve({
                projectRoot: "/primary",
                relativePath: "plans/p.md",
                absolutePath: "/primary/plans/p.md",
                existed: true,
                tracked: true,
                headTracked: true,
                indexMode: "100644",
                indexObjectId: "abc123",
                content: "implemented",
            }),
        restorePrimaryPlanPathAfterMergeFailure: () => Promise.resolve(),
        runManualQaChecklistPrompt: () => Promise.resolve([]),
        resolveValidationExecutionContext: (/** @type {any} */ opts) => {
            const context = opts.explicitContext || opts.activeWorkflow || {};
            const executionMode = context.nonGitInPlace || context.executionMode === "non_git_in_place"
                ? "non_git_in_place"
                : "worktree";
            if (
                executionMode === "worktree" && !context.worktreeBaseBranch &&
                Boolean(context.worktreeId || context.worktreeBranch)
            ) {
                return Promise.resolve({
                    kind: "blocked",
                    reason: "missing_worktree_identity",
                    message: "Workflow Validation requires explicit missing worktree delivery identity before merge.",
                });
            }
            return Promise.resolve({
                kind: "ok",
                context: {
                    executionMode,
                    planName: opts.planName,
                    projectRoot: context.projectRoot || opts.projectRoot || Deno.cwd(),
                    executionCwd: context.executionCwd || opts.projectRoot || Deno.cwd(),
                    baselineTree: context.baselineTree,
                    worktreeId: context.worktreeId,
                    worktreeBranch: context.worktreeBranch,
                    worktreeBaseBranch: context.worktreeBaseBranch,
                    source: context.planName ? "active_session" : "explicit",
                },
            });
        },
    };
}

Deno.test("runValidationLoop reviews the diff scoped to the active workflow baseline", async () => {
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
    const uiAPI = makeUi();
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
    const uiAPI = makeUi();
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
    const uiAPI = makeUi();
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
