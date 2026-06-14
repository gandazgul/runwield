import { assertEquals } from "@std/assert";
import { runLoadPlanCommand } from "./index.js";
import { AGENTS } from "../../constants.js";
import { clearActiveExecutionWorkflow, getActiveExecutionWorkflow } from "../../shared/session/session-state.js";

function makeUi() {
    /** @type {string[]} */
    const messages = [];
    /** @type {Array<unknown>} */
    const selections = [];

    return {
        messages,
        selections,
        uiAPI: /** @type {import('../../shared/ui/types.js').UiAPI} */ ({
            appendSystemMessage: (msg) => messages.push(String(msg)),
            appendAgentMessageStart: () => ({ appendText: () => {} }),
            requestRender: () => {},
            promptSelect: () => Promise.resolve(selections.shift() ?? null),
            promptText: () => Promise.resolve(null),
            showModelSelector: () => {},
        }),
    };
}

function noOpRecordPlanEvent() {
    return Promise.resolve(/** @type {any} */ ({}));
}

Deno.test("runLoadPlanCommand prints help", async () => {
    let helped = "";

    await runLoadPlanCommand(["--help"], {
        __testDeps: /** @type {any} */ ({
            printCommandHelp: (/** @type {string} */ name) => {
                helped = name;
            },
            parseArgs: () => ({ help: true, _: [] }),
        }),
    });

    assertEquals(helped, "load-plan");
});

Deno.test("runLoadPlanCommand empty plan list in TUI mode", async () => {
    const { uiAPI, messages } = makeUi();
    const editor = /** @type {import('../../shared/ui/types.js').EditorAPI} */ ({
        disableSubmit: true,
        setText: () => {},
        setAutocompleteProvider: () => {},
        handleInput: () => {},
    });

    await runLoadPlanCommand([], {
        uiAPI,
        editor,
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: [] }),
            listPlans: () => Promise.resolve([]),
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(messages.includes("No plans available, start one by entering a new request"), true);
});

Deno.test("runLoadPlanCommand approved plan proceed path", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("proceed");
    let executed = false;

    await runLoadPlanCommand(["plan-a"], {
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-a"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-a",
                    path: "plans/plan-a.md",
                    body: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "approved",
                    },
                }),
            executePlan: () => {
                executed = true;
                return Promise.resolve(undefined);
            },
            recordPlanEvent: noOpRecordPlanEvent,
            createDirectAgentHandler: () => () => Promise.resolve(),
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(executed, true);
});

Deno.test("runLoadPlanCommand validates completed execution against freshly loaded plan content", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("proceed");
    /** @type {string | undefined} */
    let validatedPlanContent;

    await runLoadPlanCommand(["plan-fresh"], {
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-fresh"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-fresh",
                    path: "plans/plan-fresh.md",
                    body: "stale body",
                    markdown: "stale markdown",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "approved",
                    },
                }),
            executePlan: () => Promise.resolve({ repairRequired: false, executionComplete: true }),
            loadPlan: () => Promise.resolve({ markdown: "fresh markdown", body: "fresh body", attrs: {} }),
            runValidationLoop: (/** @type {{ planContent: string }} */ args) => {
                validatedPlanContent = args.planContent;
                return Promise.resolve();
            },
            recordPlanEvent: noOpRecordPlanEvent,
            createDirectAgentHandler: () => async () => {},
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(validatedPlanContent, "fresh markdown");
});

Deno.test("runLoadPlanCommand non-approved plan kicks off planning agent", async () => {
    const { uiAPI } = makeUi();
    let lifecycleCalled = false;

    await runLoadPlanCommand(["plan-b"], {
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-b"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-b",
                    path: "plans/plan-b.md",
                    body: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "draft",
                    },
                }),
            runPlanningAgent: () => {
                lifecycleCalled = true;
                return Promise.resolve({ outcome: "saved", planName: "plan-b" });
            },
            createDirectAgentHandler: () => async () => {},
            setActiveAgent: () => {},
            resetTuiState: () => {},
        }),
    });

    assertEquals(lifecycleCalled, true);
});

Deno.test("runLoadPlanCommand approved plan view then cancel", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("view", null);

    await runLoadPlanCommand(["plan-c"], {
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-c"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-c",
                    path: "plans/plan-c.md",
                    body: "## Context\nThe quick brown fox.\n\n## Objective\nJump over.\n",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "approved",
                    },
                }),
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(messages.some((m) => m.includes("The quick brown fox")), true);
    assertEquals(messages.some((m) => m.includes("Jump over")), true);
    assertEquals(messages.some((m) => m.includes("Load canceled")), false);
});

Deno.test("runLoadPlanCommand approved review approves directly via submitPlanForReview", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("review");
    let submitCalled = false;
    let executed = false;

    await runLoadPlanCommand(["plan-d"], {
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-d"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-d",
                    path: "plans/plan-d.md",
                    body: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "approved",
                    },
                }),
            submitPlanForReview: () => {
                submitCalled = true;
                return Promise.resolve({ approved: true });
            },
            askPostApproval: () => Promise.resolve("save"),
            executePlan: () => {
                executed = true;
                return Promise.resolve(undefined);
            },
            recordPlanEvent: noOpRecordPlanEvent,
            createDirectAgentHandler: () => async () => {},
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(submitCalled, true);
    assertEquals(executed, false);
});

Deno.test("runLoadPlanCommand approved PROJECT review runs slicer before proceed", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("review");
    let sliced = false;
    let askedWithTasks = false;
    let executed = false;
    let validated = false;

    await runLoadPlanCommand(["plan-project-review"], {
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-project-review"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-project-review",
                    path: "plans/plan-project-review.md",
                    body: "body",
                    markdown: "markdown",
                    attrs: {
                        classification: "PROJECT",
                        complexity: "HIGH",
                        summary: "s",
                        affectedPaths: [],
                        status: "approved",
                    },
                }),
            submitPlanForReview: () => Promise.resolve({ approved: true }),
            ensureSlicerTasks: () => {
                sliced = true;
                return Promise.resolve({ ok: true, slicerInvoked: true });
            },
            askApprovalWithTasks: () => {
                askedWithTasks = true;
                return Promise.resolve("proceed");
            },
            executePlan: () => {
                executed = true;
                return Promise.resolve({ repairRequired: false, executionComplete: true });
            },
            runValidationLoop: () => {
                validated = true;
                return Promise.resolve();
            },
            recordPlanEvent: noOpRecordPlanEvent,
            createDirectAgentHandler: () => async () => {},
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(sliced, true);
    assertEquals(askedWithTasks, true);
    assertEquals(executed, true);
    assertEquals(validated, true);
});

Deno.test("runLoadPlanCommand approved review proceed restores initial agent without transient operator switch", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("review");
    /** @type {string[]} */
    const activeAgents = [];

    await runLoadPlanCommand(["plan-project-review"], {
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-project-review"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-project-review",
                    path: "plans/plan-project-review.md",
                    body: "body",
                    markdown: "markdown",
                    attrs: {
                        classification: "PROJECT",
                        complexity: "HIGH",
                        summary: "s",
                        affectedPaths: [],
                        status: "approved",
                    },
                }),
            submitPlanForReview: () => Promise.resolve({ approved: true }),
            ensureSlicerTasks: () => Promise.resolve({ ok: true, slicerInvoked: true }),
            askApprovalWithTasks: () => Promise.resolve("proceed"),
            executePlan: () => Promise.resolve({ repairRequired: false, executionComplete: true }),
            runValidationLoop: () => Promise.resolve(),
            recordPlanEvent: noOpRecordPlanEvent,
            createDirectAgentHandler: () => async () => {},
            resetTuiState: () => {},
            setActiveAgent: (/** @type {string} */ name) => activeAgents.push(name),
        }),
    });

    assertEquals(activeAgents, [AGENTS.ARCHITECT, AGENTS.ROUTER]);
});

Deno.test("runLoadPlanCommand approved review kicks off planner on denial", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("review");
    let plannerCalled = false;

    await runLoadPlanCommand(["plan-d2"], {
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-d2"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-d2",
                    path: "plans/plan-d2.md",
                    body: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "approved",
                    },
                }),
            submitPlanForReview: () => Promise.resolve({ approved: false, feedback: "missing tests" }),
            runPlanningAgent: () => {
                plannerCalled = true;
                return Promise.resolve({ outcome: "saved", planName: "plan-d2" });
            },
            createDirectAgentHandler: () => async () => {},
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(plannerCalled, true);
});

Deno.test("runLoadPlanCommand approved proceed with repair reroutes to planner", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("proceed");
    let plannerCalled = false;

    await runLoadPlanCommand(["plan-e"], {
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-e"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-e",
                    path: "plans/plan-e.md",
                    body: "body",
                    attrs: {
                        classification: "PROJECT",
                        complexity: "HIGH",
                        summary: "s",
                        affectedPaths: [],
                        status: "approved",
                    },
                }),
            ensureSlicerTasks: () => Promise.resolve({ ok: true, slicerInvoked: false }),
            executePlan: () => Promise.resolve({ repairRequired: true, error: "bad tasks" }),
            recordPlanEvent: noOpRecordPlanEvent,
            runPlanningAgent: () => {
                plannerCalled = true;
                return Promise.resolve({ outcome: "executed", planName: "plan-e" });
            },
            createDirectAgentHandler: () => async () => {},
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(plannerCalled, true);
    assertEquals(
        messages.some((m) =>
            m.includes("Rerouting to architect for repair") || m.includes("Rerouting to planner for repair")
        ),
        true,
    );
});

Deno.test("runLoadPlanCommand ready_for_work plan proceed path executes", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("proceed");
    let executed = false;

    await runLoadPlanCommand(["plan-ready-exec"], {
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-ready-exec"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-ready-exec",
                    path: "plans/plan-ready-exec.md",
                    body: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "ready_for_work",
                    },
                }),
            executePlan: () => {
                executed = true;
                return Promise.resolve(undefined);
            },
            createDirectAgentHandler: () => async () => {},
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(executed, true);
});

Deno.test("runLoadPlanCommand in_progress plan can continue from current worktree", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("continue");
    let executed = false;
    /** @type {string | null} */
    let lifecycleEvent = null;

    await runLoadPlanCommand(["plan-progress"], {
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-progress"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-progress",
                    path: "plans/plan-progress.md",
                    body: "body",
                    markdown: "markdown",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "in_progress",
                        executionBaselineTree: "baseline-tree",
                    },
                }),
            recordPlanEvent: (/** @type {{ event: string }} */ args) => {
                lifecycleEvent = args.event;
                return Promise.resolve(/** @type {any} */ ({}));
            },
            executePlan: () => {
                executed = true;
                return Promise.resolve(undefined);
            },
            createDirectAgentHandler: () => async () => {},
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(lifecycleEvent, "recovery_continue");
    assertEquals(executed, true);
});

Deno.test("runLoadPlanCommand failed plan can reset baseline and start over", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("reset", "reset");
    let restoredTree = "";
    let executed = false;
    /** @type {string | null} */
    let lifecycleEvent = null;

    await runLoadPlanCommand(["plan-failed"], {
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-failed"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-failed",
                    path: "plans/plan-failed.md",
                    body: "body",
                    markdown: "markdown",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "failed",
                        failureReason: "engineer stopped",
                        executionBaselineTree: "baseline-tree",
                    },
                }),
            restoreWorktreeTree: (/** @type {string} */ _cwd, /** @type {string} */ tree) => {
                restoredTree = tree;
                return Promise.resolve();
            },
            recordPlanEvent: (/** @type {{ event: string }} */ args) => {
                lifecycleEvent = args.event;
                return Promise.resolve(/** @type {any} */ ({}));
            },
            executePlan: () => {
                executed = true;
                return Promise.resolve(undefined);
            },
            createDirectAgentHandler: () => async () => {},
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(restoredTree, "baseline-tree");
    assertEquals(lifecycleEvent, "recovery_reset");
    assertEquals(executed, true);
});

Deno.test("runLoadPlanCommand in_progress inspect reports failure and baseline diff", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("inspect", "cancel");

    await runLoadPlanCommand(["plan-inspect"], {
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-inspect"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-inspect",
                    path: "plans/plan-inspect.md",
                    body: "body",
                    markdown: "markdown",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "in_progress",
                        failureReason: "interrupted",
                        executionBaselineTree: "baseline-tree",
                    },
                }),
            getWorkflowDiff: (/** @type {string} */ _cwd, /** @type {string} */ baselineTree) =>
                Promise.resolve(`diff for ${baselineTree}`),
            createDirectAgentHandler: () => async () => {},
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(messages.some((m) => m.includes("Failure reason:\ninterrupted")), true);
    assertEquals(messages.some((m) => m.includes("diff for baseline-tree")), true);
});

Deno.test("runLoadPlanCommand implemented plan retries validation", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("validate");
    let validated = false;
    /** @type {unknown} */
    let workflowDuringValidation = null;

    await runLoadPlanCommand(["plan-implemented"], {
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-implemented"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-implemented",
                    path: "plans/plan-implemented.md",
                    body: "body",
                    markdown: "markdown",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "implemented",
                        failureReason: "CI failed",
                        executionBaselineTree: "baseline-tree",
                    },
                }),
            runValidationLoop: () => {
                validated = true;
                workflowDuringValidation = getActiveExecutionWorkflow();
                clearActiveExecutionWorkflow();
                return Promise.resolve();
            },
            createDirectAgentHandler: () => async () => {},
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(validated, true);
    assertEquals(workflowDuringValidation, {
        planName: "plan-implemented",
        triageMeta: {
            classification: "FEATURE",
            complexity: "LOW",
            summary: "s",
            affectedPaths: [],
            status: "implemented",
            failureReason: "CI failed",
            executionBaselineTree: "baseline-tree",
        },
        baselineTree: "baseline-tree",
    });
});

Deno.test("runLoadPlanCommand verified plan review path records review_reopened", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("review");
    let lifecycleCalled = false;
    /** @type {string | null} */
    let lifecycleEvent = null;

    await runLoadPlanCommand(["plan-verified-review"], {
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-verified-review"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-verified-review",
                    path: "plans/plan-verified-review.md",
                    body: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "verified",
                    },
                }),
            recordPlanEvent: (/** @type {{ event: string }} */ args) => {
                lifecycleEvent = args.event;
                return Promise.resolve(/** @type {any} */ ({}));
            },
            runPlanningAgent: () => {
                lifecycleCalled = true;
                return Promise.resolve({ outcome: "saved", planName: "plan-verified-review" });
            },
            createDirectAgentHandler: () => async () => {},
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(lifecycleEvent, "review_reopened");
    assertEquals(lifecycleCalled, true);
});

Deno.test("runLoadPlanCommand verified plan cancel returns without changes", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("cancel");
    let executed = false;
    let lifecycleCalled = false;
    let lifecycleEvents = 0;

    await runLoadPlanCommand(["plan-verified-cancel"], {
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-verified-cancel"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-verified-cancel",
                    path: "plans/plan-verified-cancel.md",
                    body: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "verified",
                    },
                }),
            recordPlanEvent: () => {
                lifecycleEvents += 1;
                return Promise.resolve(/** @type {any} */ ({}));
            },
            executePlan: () => {
                executed = true;
                return Promise.resolve(undefined);
            },
            runPlanningAgent: () => {
                lifecycleCalled = true;
                return Promise.resolve({ outcome: "saved" });
            },
            createDirectAgentHandler: () => async () => {},
            resetTuiState: () => {},
            setActiveAgent: () => {},
        }),
    });

    assertEquals(lifecycleEvents, 0);
    assertEquals(executed, false);
    assertEquals(lifecycleCalled, false);
});

Deno.test("runLoadPlanCommand starts interactive session when ui missing", async () => {
    let started = false;
    await runLoadPlanCommand(["plan-f"], {
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-f"] }),
            startInteractiveSession: () => {
                started = true;
                return Promise.resolve(null);
            },
        }),
    });

    assertEquals(started, true);
});

Deno.test("runLoadPlanCommand keeps planner active when lifecycle canceled", async () => {
    const { uiAPI } = makeUi();
    /** @type {string[]} */
    const activeAgents = [];

    await runLoadPlanCommand(["plan-h"], {
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-h"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-h",
                    path: "plans/plan-h.md",
                    body: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "draft",
                    },
                }),
            runPlanningAgent: () => Promise.resolve({ outcome: "canceled" }),
            createDirectAgentHandler: () => async () => {},
            setActiveAgent: (/** @type {string} */ name) => {
                activeAgents.push(name);
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(activeAgents.includes(AGENTS.PLANNER), true);
    assertEquals(activeAgents.includes(AGENTS.ROUTER), false);
});

Deno.test("runLoadPlanCommand keeps planner active when agent ends without plan_written", async () => {
    const { uiAPI } = makeUi();
    /** @type {string[]} */
    const activeAgents = [];

    await runLoadPlanCommand(["plan-i"], {
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-i"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-i",
                    path: "plans/plan-i.md",
                    body: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "draft",
                    },
                }),
            runPlanningAgent: () => Promise.resolve({ outcome: "no_call" }),
            createDirectAgentHandler: () => async () => {},
            setActiveAgent: (/** @type {string} */ name) => activeAgents.push(name),
            resetTuiState: () => {},
        }),
    });

    assertEquals(activeAgents.includes(AGENTS.PLANNER), true);
    assertEquals(activeAgents.includes(AGENTS.ROUTER), false);
});

Deno.test("runLoadPlanCommand restores router flow after lifecycle saves a plan", async () => {
    const { uiAPI } = makeUi();
    /** @type {string[]} */
    const restoredAgents = [];

    await runLoadPlanCommand(["plan-g"], {
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-g"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-g",
                    path: "plans/plan-g.md",
                    body: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "draft",
                    },
                }),
            runPlanningAgent: () => Promise.resolve({ outcome: "saved", planName: "plan-g" }),
            createDirectAgentHandler: () => async () => {},
            setActiveAgent: (
                /** @type {string} */ name,
                /** @type {unknown} */ _handler,
                /** @type {any} */ actualUiAPI,
            ) => {
                restoredAgents.push(name);
                assertEquals(actualUiAPI, uiAPI);
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(restoredAgents.includes(AGENTS.ROUTER), true);
});

Deno.test("runLoadPlanCommand restores the initially active agent after lifecycle saves a plan", async () => {
    const { uiAPI } = makeUi();
    /** @type {string[]} */
    const restoredAgents = [];

    await runLoadPlanCommand(["plan-j"], {
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-j"] }),
            getRootAgentName: () => AGENTS.IDEATOR,
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-j",
                    path: "plans/plan-j.md",
                    body: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "draft",
                    },
                }),
            runPlanningAgent: () => Promise.resolve({ outcome: "saved", planName: "plan-j" }),
            createDirectAgentHandler: () => async () => {},
            setActiveAgent: (
                /** @type {string} */ name,
                /** @type {unknown} */ _handler,
                /** @type {any} */ actualUiAPI,
            ) => {
                restoredAgents.push(name);
                assertEquals(actualUiAPI, uiAPI);
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(restoredAgents.includes(AGENTS.IDEATOR), true);
    assertEquals(restoredAgents.includes(AGENTS.ROUTER), false);
});
