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

Deno.test("runValidationLoop pauses with Engineer when CI repair does not call task_completed", async () => {
    const uiAPI = makeUi();
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

Deno.test("runValidationLoop pauses with Engineer on interrupted semantic repair", async () => {
    const uiAPI = makeUi();
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
            runIsolatedAgentSession: () =>
                Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "missing requirement" }],
                    }, {
                        role: "toolResult",
                        toolName: "review_complete",
                        details: { outcome: "feedback", approved: false, feedback: "missing requirement" },
                    }]),
                ),
            runCompletionGatedRepair: () => Promise.resolve(false),
            recordPlanEvent: noOpRecordPlanEvent,
        }),
    });

    assertEquals(repairHostedSession.getActiveExecutionWorkflow(), {
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        executionAgent: "engineer",
        executionCwd: Deno.cwd(),
        validationContinuation: true,
    });
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ m) =>
            m.includes("Engineer stopped without task_completed during semantic repair.") &&
            m.includes("Validation will resume after task_completed")
        ),
        true,
    );
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ m) => m === "Review failed. Sending feedback back to Engineer..."),
        true,
    );
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ m) => m.includes("Reviewer Feedback:\nmissing requirement")),
        false,
    );
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ m) => m.includes("Maximum validation cycles")),
        false,
    );
});

Deno.test("runValidationLoop preserves Frontend Engineer owner when CI repair pauses", async () => {
    const uiAPI = makeUi();
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
    const uiAPI = makeUi();
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

Deno.test("runValidationLoop preserves Frontend Engineer owner when semantic repair pauses", async () => {
    const uiAPI = makeUi();
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
            runIsolatedAgentSession: () =>
                Promise.resolve(
                    /** @type {any} */ ([{
                        role: "toolResult",
                        toolName: "review_complete",
                        details: { outcome: "feedback", approved: false, feedback: "missing requirement" },
                    }]),
                ),
            runCompletionGatedRepair: (/** @type {any} */ opts) => {
                repairAgentName = opts.agentName;
                return Promise.resolve(false);
            },
            recordPlanEvent: noOpRecordPlanEvent,
        }),
    });

    assertEquals(repairAgentName, "frontend-engineer");
    assertEquals(repairHostedSession.getActiveExecutionWorkflow()?.executionAgent, "frontend-engineer");
    assertEquals(repairHostedSession.getActiveExecutionWorkflow()?.validationContinuation, true);
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ m) =>
            m.includes("Frontend Engineer stopped without task_completed during semantic repair.") &&
            m.includes("Validation will resume after task_completed")
        ),
        true,
    );
});

Deno.test("runValidationLoop asks before stopping after three unapproved semantic cycles", async () => {
    const uiAPI = makeUi();
    const session = makeRecordedSession("semantic-cycle-stop-prompt-test", uiAPI);
    /** @type {string[]} */
    const events = [];
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
            runIsolatedAgentSession: () => {
                reviewCalls++;
                return Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "missing requirement" }],
                    }, {
                        role: "toolResult",
                        toolName: "review_complete",
                        details: { outcome: "feedback", approved: false, feedback: "missing requirement" },
                    }]),
                );
            },
            runCompletionGatedRepair: () => Promise.resolve(true),
            recordPlanEvent: (/** @type {any} */ event) => {
                events.push(`${event.event}:${event.details.failureReason || ""}`);
                return Promise.resolve({});
            },
            recordWorkflowMetric: () => Promise.resolve(null),
        }),
    });

    assertEquals(reviewCalls, 3);
    assertEquals(uiAPI.promptSelections, ["prompted"]);
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ message) =>
            message.includes("Workflow halted: Semantic validation did not approve after 3 cycles.")
        ),
        true,
    );
    assertEquals(events, ["validation_failed:Semantic validation did not approve after 3 cycles."]);
});

Deno.test("runValidationLoop retries another three semantic cycles when requested", async () => {
    const uiAPI = makeUi();
    const session = makeRecordedSession("semantic-cycle-retry-prompt-test", uiAPI);
    /** @type {string[]} */
    const selections = [];
    let reviewCalls = 0;
    uiAPI.promptSelect = () => {
        const value = selections.length === 0 ? "retry" : "stop";
        selections.push(value);
        return Promise.resolve(value);
    };

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
            runIsolatedAgentSession: () => {
                reviewCalls++;
                const approved = reviewCalls === 4;
                return Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: approved ? "approved" : "missing requirement" }],
                    }, {
                        role: "toolResult",
                        toolName: "review_complete",
                        details: {
                            outcome: approved ? "approved" : "feedback",
                            approved,
                            feedback: approved ? "" : "missing requirement",
                        },
                    }]),
                );
            },
            runCompletionGatedRepair: () => Promise.resolve(true),
            getCodeReviewMode: () => "none",
            mergeExecutionWorktree: () => Promise.resolve(),
            updateWorktreeRegistryEntry: () => Promise.resolve({}),
            recordPlanEvent: () => Promise.resolve({}),
            recordWorkflowMetric: () => Promise.resolve(null),
        }),
    });

    assertEquals(reviewCalls, 4);
    assertEquals(selections, ["retry"]);
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ message) =>
            message.includes("Retrying Semantic Validation for another 3 cycles")
        ),
        true,
    );
    const retryProgress = uiAPI.systemCalls.find((/** @type {typeof uiAPI.systemCalls[number]} */ call) =>
        call.message.includes("Retrying Semantic Validation for another 3 cycles")
    )?.validationProgress;
    assertEquals(retryProgress?.stage, "cycle");
    assertEquals(retryProgress?.cycle, 1);
    assertEquals(retryProgress?.maxCycles, 3);
    assertEquals(retryProgress?.totalCycle, 4);
    assertEquals(retryProgress?.checks, {
        ci: "pending",
        semanticReview: "pending",
        humanReview: "pending",
        merge: "pending",
    });
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ message) =>
            message.includes("Feature execution and validation complete")
        ),
        true,
    );
});
