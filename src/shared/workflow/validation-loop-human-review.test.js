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

Deno.test("runValidationLoop runs always human review after semantic approval and before merge", async () => {
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
            requestInteraction: (/** @type {HostedSession} */ _session, /** @type {any} */ request) => {
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
    const uiAPI = makeUi();
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
            requestInteraction: (/** @type {HostedSession} */ _session, /** @type {any} */ request) => {
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
    const uiAPI = makeUi();
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
            requestInteraction: (/** @type {HostedSession} */ _session, /** @type {any} */ request) => {
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
    const uiAPI = makeUi();
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
            requestInteraction: (/** @type {HostedSession} */ _session, /** @type {any} */ request) => {
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
            requestInteraction: (/** @type {HostedSession} */ _session, /** @type {any} */ request) => {
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
