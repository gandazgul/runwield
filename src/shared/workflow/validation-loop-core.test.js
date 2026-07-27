import { assertEquals } from "@std/assert";

import { runValidationLoop, shouldContinueParentEpicAfterValidation } from "./validation.js";

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

Deno.test("shouldContinueParentEpicAfterValidation ignores standalone FEATURE plans", () => {
    assertEquals(shouldContinueParentEpicAfterValidation({ classification: "FEATURE" }), false);
    assertEquals(
        shouldContinueParentEpicAfterValidation(/** @type {any} */ ({ classification: "FEATURE", parentPlan: "" })),
        false,
    );
    assertEquals(
        shouldContinueParentEpicAfterValidation(/** @type {any} */ ({ classification: "FEATURE", parentPlan: "epic" })),
        true,
    );
});

Deno.test("runValidationLoop skips semantic review and merge-back for non-Git in-place execution", async () => {
    const { uiAPI } = makeValidationUi();
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
    assertEquals(manualQaArgs.classification, "PLANNED_CHANGE");
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
    const { uiAPI } = makeValidationUi();
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
    const { uiAPI, hostedSession } = makeValidationUi();
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
    const { uiAPI, hostedSession } = makeValidationUi();
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
    const { uiAPI } = makeValidationUi();
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
                /** @type {import("../session/hosted-session.js").HostedSession} */ _hostedSession,
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
    const hostedSession = makeRecordedSession("validation-test", makeUi());
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
    const { uiAPI, hostedSession } = makeValidationUi();
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
    const { uiAPI, hostedSession } = makeValidationUi();
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
