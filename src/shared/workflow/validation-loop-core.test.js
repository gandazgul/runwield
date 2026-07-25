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

Deno.test("runValidationLoop skips semantic review and merge-back for non-Git in-place execution", async () => {
    const uiAPI = makeUi();
    const session = makeRecordedSession("non-git-validation-test", uiAPI);
    const projectRoot = Deno.cwd();
    session.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        executionAgent: "engineer",
        projectRoot,
        executionCwd: "/feature-execution",
        nonGitInPlace: true,
    });
    /** @type {any[]} */
    const events = [];
    let reviewCalls = 0;
    let mergeCalls = 0;
    /** @type {any} */
    let manualQaArgs;

    await runValidationLoop({
        hostedSession: session,
        planName: "p",
        planContent: "# Plan",
        triageMeta: { classification: "FEATURE" },
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            ...noOpWorktreePlanHandoffDeps(),
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "ok" }),
            getDiffText: () => {
                throw new Error("should not compute git diff");
            },
            runIsolatedAgentSession: () => {
                reviewCalls++;
                return Promise.resolve([]);
            },
            runManualQaChecklistPrompt: (/** @type {any} */ args) => {
                manualQaArgs = args;
                return Promise.resolve([]);
            },
            mergeExecutionWorktree: () => {
                mergeCalls++;
                return Promise.resolve();
            },
            recordPlanEvent: (/** @type {any} */ event) => {
                events.push(event);
                return Promise.resolve(/** @type {any} */ ({}));
            },
            recordWorkflowMetric: () => Promise.resolve(null),
        }),
    });

    assertEquals(reviewCalls, 0);
    assertEquals(mergeCalls, 0);
    assertEquals(manualQaArgs.name, "p");
    assertEquals(manualQaArgs.classification, "FEATURE");
    assertEquals(manualQaArgs.context, "# Plan");
    assertEquals(manualQaArgs.cwd, projectRoot);
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ message) =>
            message.includes("Semantic Code Review") && message.includes("skipped")
        ),
        true,
    );
    assertEquals(events.some((event) => event.event === "validation_passed"), true);
    assertEquals(
        uiAPI.systemCalls
            .map((/** @type {typeof uiAPI.systemCalls[number]} */ call) => call.validationProgress?.stage)
            .filter(Boolean)
            .includes("manual_qa"),
        true,
    );
});

Deno.test("runValidationLoop starts Manual QA and Work Record generation concurrently after FEATURE validation", async () => {
    const uiAPI = makeUi();
    const session = makeRecordedSession("post-verification-concurrency", uiAPI);
    session.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        executionAgent: "engineer",
        executionMode: "non_git_in_place",
        projectRoot: Deno.cwd(),
        executionCwd: Deno.cwd(),
    });
    /** @type {string[]} */
    const actions = [];
    /** @type {() => void} */
    let resolveQa = () => {};
    /** @type {() => void} */
    let resolveWr = () => {};
    const qaStarted = new Promise((resolve) => {
        resolveQa = /** @type {() => void} */ (resolve);
    });
    const wrStarted = new Promise((resolve) => {
        resolveWr = /** @type {() => void} */ (resolve);
    });
    /** @type {() => void} */
    let releaseQa = () => {};
    /** @type {() => void} */
    let releaseWr = () => {};
    const qaRelease = new Promise((resolve) => {
        releaseQa = /** @type {() => void} */ (resolve);
    });
    const wrRelease = new Promise((resolve) => {
        releaseWr = /** @type {() => void} */ (resolve);
    });

    const running = runValidationLoop({
        hostedSession: session,
        planName: "p",
        planContent: "# Plan",
        triageMeta: { classification: "FEATURE" },
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            ...noOpWorktreePlanHandoffDeps(),
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "ok" }),
            getDiffText: () => Promise.resolve("diff --git a/x.js b/x.js\n+change\n"),
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
            runManualQaChecklistPrompt: async () => {
                actions.push("qa-start");
                resolveQa();
                await qaRelease;
                actions.push("qa-end");
                return [];
            },
            autoGenerateWorkRecordForCompletedPlan: async () => {
                actions.push("wr-start");
                resolveWr();
                await wrRelease;
                actions.push("wr-end");
                return {
                    status: "generated",
                    planName: "p",
                    path: "docs/work-records/p.md",
                    message: "Work Record generated: docs/work-records/p.md.",
                };
            },
            getCodeReviewMode: () => "none",
            recordPlanEvent: noOpRecordPlanEvent,
            recordWorkflowMetric: () => Promise.resolve(null),
        }),
    });

    await Promise.all([qaStarted, wrStarted]);
    assertEquals(actions, ["qa-start", "wr-start"]);
    releaseQa();
    releaseWr();
    await running;
    assertEquals(actions, ["qa-start", "wr-start", "qa-end", "wr-end"]);
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ message) => message.includes("Work Record generated")),
        true,
    );
});

Deno.test("runValidationLoop does not switch active agent unless finalAgentName is provided", async () => {
    const uiAPI = makeUi();
    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "",
        triageMeta: { classification: "QUICK_FIX" },
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            ...noOpWorktreePlanHandoffDeps(),
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve(""),
            recordPlanEvent: noOpRecordPlanEvent,
        }),
    });

    assertEquals(
        uiAPI.messages.some((/** @type {string} */ m) => m.includes("execution and validation complete")),
        true,
    );
});

Deno.test("runValidationLoop marks validation progress and success messages with status styling", async () => {
    const uiAPI = makeUi();
    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "",
        triageMeta: { classification: "QUICK_FIX" },
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            ...noOpWorktreePlanHandoffDeps(),
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve(""),
            recordPlanEvent: noOpRecordPlanEvent,
        }),
    });

    assertEquals(
        uiAPI.systemCalls.some((/** @type {{ message: string }} */ call) =>
            call.message.includes("Running CI Validation (Attempt 1/3)...")
        ),
        true,
    );
    assertEquals(
        uiAPI.systemCalls
            .filter((/** @type {{ message: string }} */ call) =>
                call.message.includes("Running CI Validation") || call.message === "Build and tests passed."
            )
            .every((/** @type {{ header: string }} */ call) => call.header === "RunWield"),
        true,
    );
    assertEquals(
        uiAPI.systemCalls.some((/** @type {{ message: string }} */ call) =>
            call.message.includes("Running Semantic Code Review...")
        ),
        true,
    );
    assertEquals(
        uiAPI.systemCalls.some((/** @type {{ message: string }} */ call) => call.message.includes("[spinner]")),
        false,
    );
    assertEquals(uiAPI.busyStates, []);
    assertEquals(
        uiAPI.systemCalls.some((/** @type {{ message: string, level: string }} */ call) =>
            call.message === "Build and tests passed." && call.level === "success"
        ),
        true,
    );
});

Deno.test("runValidationLoop cancels CI without dispatching repair and leaves Engineer active", async () => {
    const uiAPI = makeUi();
    const session = makeRecordedSession("validation-cancel-test", uiAPI);
    /** @type {string[]} */
    const switchedAgents = [];
    let repairDispatched = false;

    await runValidationLoop({
        hostedSession: session,
        planName: "p",
        planContent: "",
        triageMeta: { classification: "FEATURE" },
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            ...noOpWorktreePlanHandoffDeps(),
            runLocalCI: () => Promise.resolve({ exitCode: 130, output: "Validation canceled.", canceled: true }),
            runCompletionGatedRepair: () => {
                repairDispatched = true;
                return Promise.resolve(false);
            },
            recordPlanEvent: noOpRecordPlanEvent,
            switchActiveAgent: (
                /** @type {HostedSession} */ _hostedSession,
                /** @type {{ agentName: string }} */ options,
            ) => {
                switchedAgents.push(options.agentName);
                return Promise.resolve({ ok: true });
            },
            recordWorkflowMetric: () => Promise.resolve(),
        }),
    });

    assertEquals(repairDispatched, false);
    assertEquals(switchedAgents, ["engineer"]);
    assertEquals(session.getActiveExecutionWorkflow()?.validationContinuation, true);
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ message) => message.includes("CI validation canceled")),
        true,
    );
});

Deno.test("runValidationLoop restores requested final agent after validation", async () => {
    /** @type {string[]} */
    const switched = [];
    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "",
        triageMeta: { classification: "QUICK_FIX" },
        sessionManager: undefined,
        finalAgentName: "planner",
        __deps: /** @type {any} */ ({
            ...noOpWorktreePlanHandoffDeps(),
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve(""),
            recordPlanEvent: noOpRecordPlanEvent,
            switchActiveAgent: (
                /** @type {unknown} */ _hostedSession,
                /** @type {{ agentName: string }} */ options,
            ) => {
                switched.push(options.agentName);
                return Promise.resolve({ ok: true, agentName: options.agentName, changed: true });
            },
        }),
    });

    assertEquals(switched, ["planner"]);
});

Deno.test("runValidationLoop fails FEATURE validation when workflow diff is empty", async () => {
    const uiAPI = makeUi();
    /** @type {Array<{ event: string, details: { failureReason?: string } }>} */
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
            getDiffText: () => Promise.resolve(""),
            runIsolatedAgentSession: () => {
                throw new Error("semantic review should not run");
            },
            recordPlanEvent: (/** @type {any} */ event) => {
                events.push(event);
                return Promise.resolve({});
            },
        }),
    });

    assertEquals(events.map((event) => event.event), ["validation_failed"]);
    assertEquals(events[0].details.failureReason, "No implementation changes detected in workflow diff.");
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ m) =>
            m.includes("Workflow halted: No implementation changes detected in workflow diff.")
        ),
        true,
    );
});

Deno.test("runValidationLoop fails PROJECT validation when workflow diff only changes a plan document", async () => {
    const uiAPI = makeUi();
    /** @type {Array<{ event: string, details: { failureReason?: string } }>} */
    const events = [];

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "PROJECT" },
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            ...noOpWorktreePlanHandoffDeps(),
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () =>
                Promise.resolve([
                    "diff --git a/plans/p.md b/plans/p.md",
                    "--- a/plans/p.md",
                    "+++ b/plans/p.md",
                    "@@ -1,3 +1,3 @@",
                    "-status: implemented",
                    "+status: verified",
                ].join("\n")),
            runIsolatedAgentSession: () => {
                throw new Error("semantic review should not run");
            },
            recordPlanEvent: (/** @type {any} */ event) => {
                events.push(event);
                return Promise.resolve({});
            },
        }),
    });

    assertEquals(events.map((event) => event.event), ["validation_failed"]);
    assertEquals(
        events[0].details.failureReason,
        "No implementation changes detected in workflow diff; only plan document changes were found.",
    );
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ m) =>
            m.includes(
                "Workflow halted: No implementation changes detected in workflow diff; only plan document changes",
            )
        ),
        true,
    );
});
