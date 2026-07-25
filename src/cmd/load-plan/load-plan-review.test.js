// deno-lint-ignore-file no-unused-vars
import { assertEquals, assertStringIncludes } from "@std/assert";
import { runLoadPlanCommand } from "./index.js";
import { loadPlan, resolveSiblingChildPlanDependencies, savePlan, updatePlanFrontMatter } from "../../plan-store.js";
import { AGENTS } from "../../constants.js";
import { recordPlanEvent, stageValidationPassedInExecutionWorktree } from "../../shared/workflow/plan-lifecycle.js";
import {
    createExecutionWorktree,
    mergeExecutionWorktree,
    preparePrimaryPlanPathForMerge,
    restorePrimaryPlanPathAfterMergeFailure,
} from "../../shared/worktree.js";

/**
 * @typedef {Object} SlicerTriageMeta
 * @property {string} [status]
 */

/**
 * @typedef {Object} SlicerRunArgs
 * @property {string} planName
 * @property {SlicerTriageMeta} triageMeta
 */

/**
 * @typedef {Object} RecordedPlanEvent
 * @property {string} event
 * @property {string} currentStatus
 */

/**
 * @param {string} cwd
 * @param {string[]} args
 * @returns {Promise<string>}
 */
async function git(cwd, args) {
    const output = await new Deno.Command("git", { cwd, args, stdout: "piped", stderr: "piped" }).output();
    if (!output.success) throw new Error(new TextDecoder().decode(output.stderr));
    return new TextDecoder().decode(output.stdout).trim();
}

function makeUi() {
    /** @type {string[]} */
    const messages = [];
    /** @type {Array<unknown>} */
    const selections = [];
    /** @type {Array<{ prompt: string, options: Array<{ value: string, label: string, description?: string }>, config?: unknown }>} */
    const prompts = [];

    return {
        messages,
        selections,
        prompts,
        uiAPI: /** @type {import('../../ui/tui/types.js').UiAPI} */ ({
            appendSystemMessage: (msg) => messages.push(String(msg)),
            appendAgentMessageStart: () => ({ appendText: () => {} }),
            requestRender: () => {},
            promptSelect: (prompt, options = [], config) => {
                prompts.push({
                    prompt: String(prompt),
                    options: /** @type {Array<{ value: string, label: string, description?: string }>} */ (options),
                    config,
                });
                return Promise.resolve(selections.shift() ?? null);
            },
            promptText: () => Promise.resolve(null),
            showModelSelector: () => {},
        }),
    };
}

/**
 * @typedef {Object} RuntimeFixtureOptions
 * @property {string} [sessionId]
 * @property {string} [activeAgent]
 * @property {(request: any) => any} [requestInteraction]
 */

/** @param {RuntimeFixtureOptions} [options] */
function makeRuntimeFixture(options = {}) {
    const sessionId = options.sessionId || "load-plan-test";
    const state = {
        activeAgent: options.activeAgent || AGENTS.ROUTER,
        agentHistory: /** @type {string[]} */ ([]),
        workflow: /** @type {Record<string, any> | null} */ (null),
        renamed: /** @type {string | null} */ (null),
    };
    const runtime = /** @type {import('../../shared/session/session-runtime.js').SessionRuntime} */ (
        /** @type {unknown} */ ({
            /** @param {string} id */
            getSessionSnapshot: (id) =>
                id === sessionId
                    ? {
                        id,
                        cwd: Deno.cwd(),
                        activeAgent: state.activeAgent,
                        activeExecutionWorkflow: state.workflow,
                    }
                    : null,
            /** @param {string} _id @param {{ agentName: string }} request */
            switchAgent: (_id, request) => {
                state.activeAgent = request.agentName;
                state.agentHistory.push(request.agentName);
                return Promise.resolve({ ok: true, changed: true, agentName: request.agentName });
            },
            executePlan: () => Promise.resolve(undefined),
            runPlanningAgent: () => Promise.resolve({ outcome: "canceled" }),
            runValidation: () => Promise.resolve(undefined),
            runSlicerAgent: () => Promise.resolve(undefined),
            /** @param {string} _id @param {Record<string, any>} workflow */
            setActiveExecutionWorkflow: (_id, workflow) => {
                state.workflow = workflow;
                return { ok: true };
            },
            clearActiveExecutionWorkflow: () => {
                state.workflow = null;
                return { ok: true };
            },
            /** @param {string} _id @param {any} request */
            requestInteraction: (_id, request) =>
                Promise.resolve(
                    options.requestInteraction?.(request) || {
                        outcome: "canceled",
                    },
                ),
            /** @param {string} _id @param {string} name */
            renameSession: (_id, name) => {
                state.renamed = name;
                return { ok: true };
            },
        })
    );
    return {
        context: { sessionId, sessionRuntime: runtime },
        runtime,
        state,
    };
}

function makeRuntimeContext() {
    return makeRuntimeFixture().context;
}

function noOpRecordPlanEvent() {
    return Promise.resolve(/** @type {any} */ ({}));
}

Deno.test("runLoadPlanCommand non-approved plan kicks off planning agent", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("resume");
    let lifecycleCalled = false;

    await runLoadPlanCommand(["plan-b"], {
        ...makeRuntimeContext(),
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
            resetTuiState: () => {},
        }),
    });

    assertEquals(lifecycleCalled, true);
});

Deno.test("runLoadPlanCommand approved plan view then cancel", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("view", null);

    await runLoadPlanCommand(["plan-c"], {
        ...makeRuntimeContext(),
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
                        worktreeBaseBranch: "feature-base",
                    },
                }),
            resetTuiState: () => {},
        }),
    });

    assertEquals(messages.some((m) => m.includes("Target branch:  feature-base")), true);
    assertEquals(messages.some((m) => m.includes("The quick brown fox")), true);
    assertEquals(messages.some((m) => m.includes("Jump over")), true);
    assertEquals(messages.some((m) => m.includes("Load canceled")), false);
});

Deno.test("runLoadPlanCommand approved review uses the Runtime review interaction", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("review");
    let submitCalled = false;
    let executed = false;
    const fixture = makeRuntimeFixture({
        requestInteraction: () => {
            submitCalled = true;
            return { outcome: "accepted", _meta: { approved: true } };
        },
    });

    await runLoadPlanCommand(["plan-d"], {
        ...fixture.context,
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
            executePlan: () => {
                executed = true;
                return Promise.resolve(undefined);
            },
            recordPlanEvent: noOpRecordPlanEvent,
            resetTuiState: () => {},
        }),
    });

    assertEquals(submitCalled, true);
    assertEquals(executed, false);
});

Deno.test("runLoadPlanCommand approved review run action executes without post-approval prompt", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("review");
    let executed = false;
    const fixture = makeRuntimeFixture({
        requestInteraction: () => ({ outcome: "accepted", _meta: { approved: true, approvalAction: "run" } }),
    });

    await runLoadPlanCommand(["plan-run-now"], {
        ...fixture.context,
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-run-now"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-run-now",
                    path: "plans/plan-run-now.md",
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
                return Promise.resolve({ repairRequired: false, executionComplete: true });
            },
            loadPlan: () =>
                Promise.resolve({
                    markdown: "markdown",
                    body: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "implemented",
                        executionMode: "non_git_in_place",
                    },
                }),
            runValidationLoop: () => Promise.resolve({ ok: true }),
            recordPlanEvent: noOpRecordPlanEvent,
            resetTuiState: () => {},
        }),
    });

    assertEquals(executed, true);
});

Deno.test("runLoadPlanCommand reapproval refreshes execution policy before readiness and execution", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("review");
    /** @type {any} */
    let executedTriageMeta = null;
    const readinessEvents = /** @type {any[]} */ ([]);
    const fixture = makeRuntimeFixture({
        requestInteraction: () => ({
            outcome: "accepted",
            _meta: {
                approved: true,
                approvalAction: "run",
                planAttrs: {
                    classification: "FEATURE",
                    complexity: "LOW",
                    summary: "s",
                    affectedPaths: [],
                    status: "approved",
                    executionAgent: "frontend-engineer",
                    collaborationRecommendation: "pair",
                },
            },
        }),
    });

    await runLoadPlanCommand(["plan-policy-refresh"], {
        ...fixture.context,
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-policy-refresh"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-policy-refresh",
                    path: "plans/plan-policy-refresh.md",
                    body: "body",
                    markdown: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "approved",
                        executionAgent: "engineer",
                        collaborationRecommendation: "autonomous",
                    },
                }),
            executePlan: (/** @type {any} */ options) => {
                executedTriageMeta = options.triageMeta;
                return Promise.resolve({ repairRequired: false, executionComplete: false });
            },
            recordPlanEvent: (/** @type {any} */ event) => {
                readinessEvents.push(event);
                return noOpRecordPlanEvent();
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(readinessEvents[0].details.triageMeta.executionAgent, "frontend-engineer");
    assertEquals(readinessEvents[0].details.triageMeta.collaborationRecommendation, "pair");
    assertEquals(executedTriageMeta.executionAgent, "frontend-engineer");
    assertEquals(executedTriageMeta.collaborationRecommendation, "pair");
});

Deno.test("runLoadPlanCommand reapproval refreshes edited Plan content before execution fallback validation", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("review");
    let executed = false;
    /** @type {string | null} */
    let validationPlanContent = null;
    const fixture = makeRuntimeFixture({
        requestInteraction: () => ({
            outcome: "accepted",
            _meta: {
                approved: true,
                approvalAction: "run",
                planAttrs: {
                    classification: "FEATURE",
                    complexity: "LOW",
                    summary: "updated",
                    affectedPaths: [],
                    status: "approved",
                    executionAgent: "frontend-engineer",
                    collaborationRecommendation: "pair",
                },
            },
        }),
    });

    await runLoadPlanCommand(["plan-content-refresh"], {
        ...fixture.context,
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-content-refresh"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-content-refresh",
                    path: "plans/plan-content-refresh.md",
                    body: "stale body",
                    markdown: "stale markdown",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "stale",
                        affectedPaths: [],
                        status: "approved",
                        executionAgent: "engineer",
                        collaborationRecommendation: "autonomous",
                    },
                }),
            loadPlan: () =>
                Promise.resolve({
                    planName: "plan-content-refresh",
                    path: "plans/plan-content-refresh.md",
                    body: "updated body",
                    markdown: "updated markdown",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "updated",
                        affectedPaths: [],
                        status: executed ? "implemented" : "approved",
                        executionMode: executed ? "non_git_in_place" : undefined,
                        executionAgent: "frontend-engineer",
                        collaborationRecommendation: "pair",
                    },
                }),
            executePlan: () => {
                executed = true;
                return Promise.resolve({ repairRequired: false, executionComplete: true });
            },
            runValidationLoop: (/** @type {any} */ options) => {
                validationPlanContent = options.planContent;
                return Promise.resolve({ ok: true });
            },
            recordPlanEvent: noOpRecordPlanEvent,
            resetTuiState: () => {},
        }),
    });

    assertEquals(validationPlanContent, "updated markdown");
});

Deno.test("runLoadPlanCommand reapproval abandons the prior worktree generation", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("review");
    const registryUpdates = /** @type {any[]} */ ([]);
    /** @type {any} */
    let reviewMeta = null;
    const fixture = makeRuntimeFixture({
        requestInteraction: (request) => {
            reviewMeta = request._meta?.triageMeta;
            return { outcome: "accepted", _meta: { approved: true } };
        },
    });

    await runLoadPlanCommand(["plan-reapproval"], {
        ...fixture.context,
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-reapproval"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-reapproval",
                    path: "plans/plan-reapproval.md",
                    body: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "ready_for_work",
                        worktreeStatus: "completed",
                    },
                }),
            findWorktreeByPlanName: () =>
                Promise.resolve({
                    id: "old-worktree",
                    planName: "plan-reapproval",
                    path: "/tmp/old-worktree",
                    branch: "runwield/worktree/plan-reapproval-old",
                    baseBranch: "main",
                    status: "completed",
                }),
            updateWorktreeRegistryEntry: (
                /** @type {string} */ projectRoot,
                /** @type {string} */ id,
                /** @type {any} */ updates,
            ) => {
                registryUpdates.push({ projectRoot, id, updates });
                return Promise.resolve({});
            },
            recordPlanEvent: (/** @type {any} */ event) => {
                if (event.event === "review_reopened") {
                    return Promise.resolve({
                        ...event.details.triageMeta,
                        status: "feedback",
                        worktreeId: null,
                        worktreePath: null,
                        worktreeBranch: null,
                        worktreeBaseBranch: null,
                        worktreeStatus: "abandoned",
                    });
                }
                return Promise.resolve({ ...event.details.triageMeta, status: "ready_for_work" });
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(registryUpdates, [{
        projectRoot: Deno.cwd(),
        id: "old-worktree",
        updates: { status: "abandoned" },
    }]);
    assertEquals(reviewMeta.worktreeStatus, "abandoned");
    assertEquals(reviewMeta.worktreeBaseBranch, null);
});

Deno.test("runLoadPlanCommand approved PROJECT Epic opens Slicer without executing", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("slicer");
    let slicerOpened = false;
    /** @type {SlicerRunArgs[]} */
    const slicerCalls = [];
    let executed = false;
    /** @type {RecordedPlanEvent[]} */
    const events = [];

    await runLoadPlanCommand(["epic-review"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["epic-review"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "epic-review",
                    path: "plans/epic-review.md",
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
            findPlansByParent: () => Promise.resolve([]),
            runSlicerAgent: (/** @type {SlicerRunArgs} */ args) => {
                slicerOpened = true;
                slicerCalls.push(args);
                return Promise.resolve({ ok: true });
            },
            submitPlanForReview: () => Promise.resolve({ approved: true }),
            executePlan: () => {
                executed = true;
                return Promise.resolve({ repairRequired: false, executionComplete: true });
            },
            recordPlanEvent: (/** @type {RecordedPlanEvent} */ args) => {
                events.push({ event: args.event, currentStatus: args.currentStatus });
                return Promise.resolve({ status: "ready_for_decomposition" });
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(slicerOpened, true);
    assertEquals(slicerCalls[0].planName, "epic-review");
    assertEquals(slicerCalls[0].triageMeta.status, "ready_for_decomposition");
    assertEquals(executed, false);
    assertEquals(events, [{ event: "epic_readiness_passed", currentStatus: "approved" }]);
    assertEquals(messages.some((message) => message.includes("not executable")), true);
});

Deno.test("runLoadPlanCommand approved PROJECT Epic rejects execution policy before readiness", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("slicer");
    let slicerOpened = false;
    /** @type {RecordedPlanEvent[]} */
    const events = [];

    await runLoadPlanCommand(["epic-invalid-policy"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["epic-invalid-policy"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "epic-invalid-policy",
                    path: "plans/epic-invalid-policy.md",
                    body: "body",
                    markdown: "markdown",
                    attrs: {
                        classification: "PROJECT",
                        complexity: "HIGH",
                        summary: "s",
                        affectedPaths: [],
                        status: "approved",
                        executionAgent: "frontend-engineer",
                    },
                }),
            findPlansByParent: () => Promise.resolve([]),
            runSlicerAgent: () => {
                slicerOpened = true;
                return Promise.resolve({ ok: true });
            },
            recordPlanEvent: (/** @type {RecordedPlanEvent} */ args) => {
                events.push(args);
                return Promise.resolve({ status: "ready_for_decomposition" });
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(slicerOpened, false);
    assertEquals(events, []);
    assertEquals(messages.some((message) => message.includes("PROJECT Epics are non-executable")), true);
});

Deno.test("runLoadPlanCommand post-review PROJECT Epic rejects execution policy before readiness", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("review");
    const fixture = makeRuntimeFixture({
        requestInteraction: () => ({ outcome: "accepted", _meta: { approved: true } }),
    });
    let slicerOpened = false;
    /** @type {RecordedPlanEvent[]} */
    const events = [];

    await runLoadPlanCommand(["epic-review-invalid-policy"], {
        ...fixture.context,
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["epic-review-invalid-policy"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "epic-review-invalid-policy",
                    path: "plans/epic-review-invalid-policy.md",
                    body: "body",
                    markdown: "markdown",
                    attrs: {
                        classification: "PROJECT",
                        complexity: "HIGH",
                        summary: "s",
                        affectedPaths: [],
                        status: "approved",
                        collaborationRecommendation: "pair",
                    },
                }),
            askProjectDecompositionApproval: () => Promise.resolve("proceed"),
            runSlicerAgent: () => {
                slicerOpened = true;
                return Promise.resolve({ ok: true });
            },
            recordPlanEvent: (/** @type {RecordedPlanEvent} */ args) => {
                events.push(args);
                return Promise.resolve({ status: "ready_for_decomposition" });
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(slicerOpened, false);
    assertEquals(events, []);
    assertEquals(messages.some((message) => message.includes("PROJECT Epics are non-executable")), true);
});

Deno.test("runLoadPlanCommand legacy in-progress PROJECT Epic opens Slicer instead of recovery", async () => {
    const { uiAPI, selections, prompts } = makeUi();
    selections.push("slicer");
    let slicerOpened = false;
    let executed = false;

    await runLoadPlanCommand(["epic-in-progress"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["epic-in-progress"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "epic-in-progress",
                    path: "plans/epic-in-progress.md",
                    body: "body",
                    markdown: "markdown",
                    attrs: {
                        classification: "PROJECT",
                        complexity: "HIGH",
                        summary: "s",
                        affectedPaths: [],
                        status: "in_progress",
                    },
                }),
            findPlansByParent: () => Promise.resolve([]),
            runSlicerAgent: () => {
                slicerOpened = true;
                return Promise.resolve({ ok: true });
            },
            executePlan: () => {
                executed = true;
                return Promise.resolve({ repairRequired: false, executionComplete: true });
            },
            resetTuiState: () => {},
        }),
    });

    const epicPrompt = prompts.find((prompt) => prompt.prompt === "What would you like to do with this Epic?");
    assertEquals(epicPrompt?.options.map((option) => option.value), ["slicer", "hold", "view", "cancel"]);
    assertEquals(slicerOpened, true);
    assertEquals(executed, false);
});

Deno.test("runLoadPlanCommand ready_for_decomposition PROJECT Epic does not execute", async () => {
    const { uiAPI, messages } = makeUi();
    let executed = false;

    await runLoadPlanCommand(["epic-ready"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["epic-ready"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "epic-ready",
                    path: "plans/epic-ready.md",
                    body: "body",
                    markdown: "markdown",
                    attrs: {
                        classification: "PROJECT",
                        complexity: "HIGH",
                        summary: "s",
                        affectedPaths: [],
                        status: "ready_for_decomposition",
                    },
                }),
            findPlansByParent: () => Promise.resolve([]),
            executePlan: () => {
                executed = true;
                return Promise.resolve({ repairRequired: false, executionComplete: true });
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(executed, false);
    assertEquals(messages.some((message) => message.includes("no child FEATURE plans")), true);
});

Deno.test("runLoadPlanCommand approved review proceed keeps plan owner without transient operator switch", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("review");
    const fixture = makeRuntimeFixture({
        requestInteraction: () => ({ outcome: "accepted", _meta: { approved: true } }),
    });

    await runLoadPlanCommand(["plan-project-review"], {
        ...fixture.context,
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
            executePlan: () => Promise.resolve({ repairRequired: false, executionComplete: true }),
            runValidationLoop: () => Promise.resolve(),
            recordPlanEvent: noOpRecordPlanEvent,
            resetTuiState: () => {},
        }),
    });

    assertEquals(fixture.state.agentHistory, [AGENTS.ARCHITECT]);
});

Deno.test("runLoadPlanCommand approved PROJECT review decompose action starts Slicer", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("review");
    let slicerCalled = false;
    const fixture = makeRuntimeFixture({
        requestInteraction: () => ({ outcome: "accepted", _meta: { approved: true, approvalAction: "decompose" } }),
    });

    await runLoadPlanCommand(["plan-project-decompose"], {
        ...fixture.context,
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-project-decompose"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-project-decompose",
                    path: "plans/plan-project-decompose.md",
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
            runSlicerAgent: () => {
                slicerCalled = true;
                return Promise.resolve({ ok: true });
            },
            recordPlanEvent: noOpRecordPlanEvent,
            resetTuiState: () => {},
        }),
    });

    assertEquals(slicerCalled, true);
});

Deno.test("runLoadPlanCommand approved review kicks off planner on denial", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("review");
    let plannerCalled = false;
    const fixture = makeRuntimeFixture({
        requestInteraction: () => ({
            outcome: "accepted",
            _meta: { approved: false, feedback: "missing tests" },
        }),
    });

    await runLoadPlanCommand(["plan-d2"], {
        ...fixture.context,
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
            runPlanningAgent: () => {
                plannerCalled = true;
                return Promise.resolve({ outcome: "saved", planName: "plan-d2" });
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(plannerCalled, true);
});
