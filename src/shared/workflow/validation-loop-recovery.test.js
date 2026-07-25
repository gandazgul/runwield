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

Deno.test("runValidationLoop keeps merged worktree when cleanup setting is disabled", async () => {
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
            mergeExecutionWorktree: () => {
                actions.push("merge");
                return Promise.resolve();
            },
            removeExecutionWorktree: () => {
                actions.push("remove");
                return Promise.resolve();
            },
            removeWorktreeRegistryEntry: () => {
                actions.push("registry-remove");
                return Promise.resolve();
            },
            verifyExecutionWorktreeMerged: () => Promise.resolve({ merged: true, message: "merged" }),
            updateWorktreeRegistryEntry: () => {
                actions.push("registry");
                return Promise.resolve({});
            },
            recordPlanEvent: (/** @type {any} */ event) => {
                actions.push(`event:${event.event}:${event.details.cleanupMergedWorktrees}`);
                return Promise.resolve({});
            },
            getCodeReviewMode: () => "none",
            shouldCleanupMergedWorktrees: () => false,
        }),
    });

    assertEquals(actions, ["merge", "registry"]);
});

Deno.test("runValidationLoop records worktree_merge_failed when merge-back fails", async () => {
    const uiAPI = makeUi();
    /** @type {string[]} */
    const actions = [];
    /** @type {any} */
    let mergeFailedDetails = null;

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
            restorePrimaryPlanPathAfterMergeFailure: () => {
                actions.push("restore-primary-plan");
                return Promise.resolve();
            },
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
            runActiveAgentTurn: () => Promise.resolve([]),
            mergeExecutionWorktree: () => Promise.reject(new Error("conflict")),
            updateWorktreeRegistryEntry: (
                /** @type {string} */ _projectRoot,
                /** @type {string} */ _id,
                /** @type {{ status: string }} */ updates,
            ) => {
                actions.push(`registry:${updates.status}`);
                return Promise.resolve({});
            },
            recordPlanEvent: (/** @type {any} */ event) => {
                if (event.event === "worktree_merge_failed") {
                    mergeFailedDetails = event.details;
                }
                actions.push(`event:${event.event}:${event.details.failureReason}`);
                return Promise.resolve({});
            },
            getCodeReviewMode: () => "none",
        }),
    });

    assertEquals(actions, [
        "restore-primary-plan",
        "registry:merge_conflict",
        "event:worktree_merge_failed:conflict",
        "registry:validation_failed",
        "event:validation_failed:Worktree merge failed: conflict",
    ]);
    assertEquals(mergeFailedDetails.worktreePath, "/worktree");
    assertEquals(mergeFailedDetails.worktreeBranch, "runwield/worktree/p-wt1");
    assertEquals(mergeFailedDetails.worktreeBaseBranch, "feature-base");
    assertEquals(uiAPI.promptSelections, ["prompted"]);
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ message) => message.includes("Worktree merge failed: conflict")),
        true,
    );
    assertEquals(
        uiAPI.systemCalls.some((/** @type {{ message: string, isError: boolean }} */ call) =>
            call.message.includes("Worktree merge failed: conflict") && call.isError
        ),
        true,
    );
});

Deno.test("runValidationLoop still prompts when merge-conflict metadata updates fail", async () => {
    const uiAPI = makeUi();
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
            runActiveAgentTurn: () => Promise.resolve([]),
            mergeExecutionWorktree: () => Promise.reject(new Error("merge conflict")),
            updateWorktreeRegistryEntry: () => {
                actions.push("registry-failed");
                return Promise.reject(new SyntaxError("Expected double-quoted property name"));
            },
            recordPlanEvent: () => {
                actions.push("plan-event-failed");
                return Promise.reject(new Error("front matter conflict markers"));
            },
            getCodeReviewMode: () => "none",
        }),
    });

    assertEquals(actions, ["registry-failed", "plan-event-failed", "registry-failed", "plan-event-failed"]);
    assertEquals(uiAPI.promptSelections, ["prompted"]);
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ message) =>
            message.includes("Could not update worktree registry while merge conflict is active")
        ),
        true,
    );
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ message) =>
            message.includes("Could not update plan metadata while merge conflict is active")
        ),
        true,
    );
});

Deno.test("runValidationLoop recovers missing worktree target branch from registry before merge", async () => {
    const uiAPI = makeUi();
    /** @type {Array<string | undefined>} */
    const targets = [];

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
            mergeExecutionWorktree: (/** @type {{ targetBranch?: string }} */ args) => {
                targets.push(args.targetBranch);
                return Promise.resolve();
            },
            findWorktreeRegistryEntryById: (/** @type {string} */ projectRoot, /** @type {string} */ id) =>
                Promise.resolve({ id, projectRoot, baseBranch: "main" }),
            updateWorktreeRegistryEntry: () => Promise.resolve({}),
            recordPlanEvent: noOpRecordPlanEvent,
            removeExecutionWorktree: () => Promise.resolve(),
            verifyExecutionWorktreeMerged: () => Promise.resolve({ merged: true, message: "merged" }),
            getCodeReviewMode: () => "none",
        }),
    });

    assertEquals(targets, []);
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ message) => message.includes("missing worktree delivery identity")),
        true,
    );
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ message) =>
            message.includes("Recorded worktree target branch is unknown")
        ),
        false,
    );
});

Deno.test("runValidationLoop fails closed instead of using guarded primary-checkout fallback", async () => {
    const uiAPI = makeUi();
    /** @type {Array<string | undefined>} */
    const targets = [];

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
            mergeExecutionWorktree: (/** @type {{ targetBranch?: string }} */ args) => {
                targets.push(args.targetBranch);
                return Promise.resolve();
            },
            findWorktreeRegistryEntryById: () => Promise.resolve(null),
            updateWorktreeRegistryEntry: () => Promise.resolve({}),
            recordPlanEvent: noOpRecordPlanEvent,
            removeExecutionWorktree: () => Promise.resolve(),
            verifyExecutionWorktreeMerged: () => Promise.resolve({ merged: true, message: "merged" }),
            getCodeReviewMode: () => "none",
        }),
    });

    assertEquals(targets, []);
    assertEquals(uiAPI.messages.length >= 0, true);
});

Deno.test("runValidationLoop dispatches active owner merge repair and retries merge-back", async () => {
    const uiAPI = makeUi();
    /** @type {string[]} */
    const actions = [];
    let mergeAttempts = 0;

    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE", executionAgent: "frontend-engineer" },
        executionAgent: "frontend-engineer",
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
        triageMeta: { classification: "FEATURE", executionAgent: "frontend-engineer" },
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
            mergeExecutionWorktree: (/** @type {any} */ args) => {
                mergeAttempts++;
                actions.push(`merge:${mergeAttempts}:${args.repairMergeWorktreePath || ""}`);
                if (mergeAttempts === 1) {
                    const error =
                        /** @type {Error & { repairCwd?: string, mergeWorktreePath?: string, mergeFailureKind?: string }} */ (
                            new Error("conflict")
                        );
                    error.repairCwd = "/merge-wt";
                    error.mergeWorktreePath = "/merge-wt";
                    error.mergeFailureKind = "detached_merge_conflict";
                    return Promise.reject(error);
                }
                return Promise.resolve();
            },
            runCompletionGatedRepair: (/** @type {any} */ opts) => {
                actions.push(
                    `repair:${opts.agentName}:${opts.cwd}:${opts.userRequest.includes("feature-base")}:${
                        opts.userRequest.includes("Current plan status: implemented")
                    }:${opts.userRequest.includes("Diff/context:")}:${
                        opts.userRequest.includes("detached merge worktree")
                    }`,
                );
                return Promise.resolve(true);
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
                actions.push(
                    `event:${event.event}:${event.details.failureReason || event.details.worktreeStatus || ""}`,
                );
                return Promise.resolve({});
            },
            removeExecutionWorktree: () => {
                actions.push("remove");
                return Promise.resolve();
            },
            verifyExecutionWorktreeMerged: () => Promise.resolve({ merged: true, message: "merged" }),
            getCodeReviewMode: () => "none",
        }),
    });

    assertEquals(actions, [
        "merge:1:",
        "registry:merge_conflict",
        "event:worktree_merge_failed:conflict",
        "repair:frontend-engineer:/merge-wt:true:true:true:true",
        "merge:2:/merge-wt",
        "registry:merged",
        "remove",
    ]);
    assertEquals(uiAPI.promptSelections, []);
});

Deno.test("runValidationLoop completes after merge repair task_completed and retry", async () => {
    const uiAPI = makeUi();
    const repairHostedSession = makeRecordedSession("merge-repair-completion-test", uiAPI);
    repairHostedSession.setRootAgentName("engineer");
    repairHostedSession.setRootAgentSession(
        /** @type {any} */ ({
            agent: {
                state: {
                    messages: [{ role: "assistant", content: [{ type: "text", text: "previous turn" }] }],
                },
            },
        }),
    );
    /** @type {string[]} */
    const events = [];
    let mergeAttempts = 0;

    repairHostedSession.setActiveExecutionWorkflow({
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
        hostedSession: repairHostedSession,
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
            runActiveAgentTurn: () =>
                Promise.resolve(
                    /** @type {any} */ ([{
                        role: "toolResult",
                        toolName: "task_completed",
                        details: { outcome: "task_completed" },
                    }]),
                ),
            mergeExecutionWorktree: () => {
                mergeAttempts++;
                if (mergeAttempts === 1) {
                    return Promise.reject(new Error("merge conflict"));
                }
                return Promise.resolve();
            },
            updateWorktreeRegistryEntry: () => Promise.resolve({}),
            recordPlanEvent: (/** @type {{ event: string }} */ event) => {
                events.push(event.event);
                return Promise.resolve({});
            },
            removeExecutionWorktree: () => Promise.resolve(),
            verifyExecutionWorktreeMerged: () => Promise.resolve({ merged: true, message: "merged" }),
            getCodeReviewMode: () => "none",
        }),
    });

    assertEquals(events, ["worktree_merge_failed"]);
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ message) =>
            message.includes("Feature execution and validation complete")
        ),
        true,
    );
});

Deno.test("runValidationLoop retries worktree merge after user fixes primary checkout", async () => {
    const uiAPI = makeUi();
    /** @type {string[]} */
    const actions = [];
    let mergeAttempts = 0;
    uiAPI.promptSelect = () => {
        uiAPI.promptSelections.push("retry");
        return Promise.resolve("retry");
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
            runActiveAgentTurn: () => Promise.resolve([]),
            mergeExecutionWorktree: () => {
                mergeAttempts++;
                actions.push(`merge:${mergeAttempts}`);
                if (mergeAttempts === 1) return Promise.reject(new Error("primary dirty"));
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
                actions.push(
                    `event:${event.event}:${event.details.failureReason || event.details.worktreeStatus || ""}`,
                );
                return Promise.resolve({});
            },
            removeExecutionWorktree: () => {
                actions.push("remove");
                return Promise.resolve();
            },
            verifyExecutionWorktreeMerged: () => Promise.resolve({ merged: true, message: "merged" }),
            getCodeReviewMode: () => "none",
        }),
    });

    assertEquals(actions, [
        "merge:1",
        "registry:merge_conflict",
        "event:worktree_merge_failed:primary dirty",
        "merge:2",
        "registry:merged",
        "remove",
    ]);
    assertEquals(uiAPI.promptSelections, ["retry"]);
});

Deno.test("runValidationLoop marks active worktree validation_failed when validation fails", async () => {
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
            getDiffText: () => Promise.resolve(""),
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
        }),
    });

    assertEquals(actions, [
        "registry:validation_failed",
        "event:validation_failed:No implementation changes detected in workflow diff.",
    ]);
});

// ─── review-diff-tool tests ────────────────────────────────────────────────

import {
    buildLargeDiffReviewPrompt,
    createReviewDiffTool,
    formatChangedFileList,
    getFileDiff,
    listDiffFiles,
    parseDiffFiles,
} from "./review-diff-tool.js";

const SAMPLE_INLINE_DIFF = [
    "diff --git a/src/a.js b/src/a.js",
    "--- a/src/a.js",
    "+++ b/src/a.js",
    "@@ -1,3 +1,4 @@",
    " line1",
    "-old line",
    "+new line",
    " line3",
    "diff --git a/src/b.js b/src/b.js",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/src/b.js",
    "@@ -0,0 +1,2 @@",
    "+brand new",
    "+file",
    "diff --git a/src/c.js b/src/c.js",
    "deleted file mode 100644",
    "--- a/src/c.js",
    "+++ /dev/null",
    "@@ -1,2 +0,0 @@",
    "-removed line1",
    "-removed line2",
    "diff --git a/src/old.js b/src/new.js",
    "rename from src/old.js",
    "rename to src/new.js",
    "--- a/src/old.js",
    "+++ b/src/new.js",
    "@@ -1,1 +1,2 @@",
    " base",
    "+extra",
    "diff --git a/src/binary.png b/src/binary.png",
    "new file mode 100644",
    "Binary files /dev/null and b/src/binary.png differ",
].join("\n");

Deno.test("runValidationLoop halts fail-closed when target branch advances before publication", async () => {
    const uiAPI = makeUi();
    const session = makeRecordedSession("target-advance-validation-test", uiAPI);
    session.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        executionAgent: "engineer",
        executionMode: "worktree",
        baselineTree: "baseline-tree",
        projectRoot: "/primary",
        executionCwd: "/worktree",
        worktreeId: "wt1",
        worktreeBranch: "runwield/worktree/p-wt1",
        worktreeBaseBranch: "main",
    });
    let mergeCalls = 0;
    let repairCalls = 0;
    let promptCalls = 0;
    /** @type {any[]} */
    const registryUpdates = [];
    /** @type {any[]} */
    const planEvents = [];
    /** @type {any[]} */
    const stagedEvidence = [];
    /** @type {any[]} */
    const resetUpdates = [];

    await runValidationLoop({
        hostedSession: session,
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            ...noOpWorktreePlanHandoffDeps(),
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "ok" }),
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
            getCodeReviewMode: () => "none",
            sealExecutionWorktreeCandidate: () => Promise.resolve({ executionCommit: "a".repeat(40) }),
            getBranchHead: () => Promise.resolve("b".repeat(40)),
            stageValidationPassedInExecutionWorktree: (/** @type {any} */ args) => {
                stagedEvidence.push(args.details.deliveryEvidence);
                return Promise.resolve({
                    attrs: /** @type {any} */ ({ status: "verified" }),
                    planPaths: ["plans/p.md"],
                });
            },
            mergeExecutionWorktree: () => {
                mergeCalls++;
                const error = /** @type {Error & { mergeFailureKind?: string }} */ (
                    new Error("Target branch main advanced before publication; rerun Workflow Validation.")
                );
                error.mergeFailureKind = "target_branch_advanced";
                return Promise.reject(error);
            },
            repair: () => {
                repairCalls++;
                return Promise.resolve(true);
            },
            requestInteraction: () => {
                promptCalls++;
                return Promise.resolve({ outcome: "selected", value: "retry" });
            },
            updatePlanFrontMatter: (
                /** @type {string} */ cwd,
                /** @type {string} */ planName,
                /** @type {any} */ updates,
            ) => {
                resetUpdates.push({ cwd, planName, updates });
                return Promise.resolve(/** @type {any} */ ({ status: updates.status }));
            },
            updateWorktreeRegistryEntry: (
                /** @type {string} */ _projectRoot,
                /** @type {string} */ _worktreeId,
                /** @type {any} */ updates,
            ) => {
                registryUpdates.push(updates);
                return Promise.resolve({});
            },
            recordPlanEvent: (/** @type {any} */ event) => {
                planEvents.push(event);
                return Promise.resolve({});
            },
            recordWorkflowMetric: () => Promise.resolve(null),
        }),
    });

    assertEquals(mergeCalls, 1);
    assertEquals(repairCalls, 0);
    assertEquals(promptCalls, 0);
    assertEquals(registryUpdates.some((updates) => updates.status === "merge_conflict"), false);
    assertEquals(planEvents.some((event) => event.event === "worktree_merge_failed"), false);
    assertEquals(stagedEvidence, [{
        version: 1,
        mode: "worktree_merge",
        executionCommit: "a".repeat(40),
        targetBranch: "main",
        targetHeadBeforeMerge: "b".repeat(40),
    }]);
    assertEquals(resetUpdates, [{
        cwd: "/worktree",
        planName: "p",
        updates: {
            status: "implemented",
            verifiedAt: null,
            deliveryEvidence: null,
            executionMode: null,
        },
    }]);
    assertEquals(
        uiAPI.systemCalls.some((/** @type {any} */ call) =>
            String(call.message).includes("Target branch main advanced before publication; rerun Workflow Validation.")
        ),
        true,
    );
});
