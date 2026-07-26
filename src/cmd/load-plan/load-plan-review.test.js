import { assertEquals } from "@std/assert";
import { runLoadPlanCommand } from "./index.js";

import { AGENTS } from "../../constants.js";
import { SESSION_COMPLETE_GUIDANCE } from "../../shared/workflow/plan-review-recovery.js";

import { makeRuntimeContext, makeRuntimeFixture, makeUi, noOpRecordPlanEvent } from "./load-plan-test-helpers.js";

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
    /** @type {import("./load-plan-test-helpers.js").SlicerRunArgs[]} */
    const slicerCalls = [];
    let executed = false;
    /** @type {import("./load-plan-test-helpers.js").RecordedPlanEvent[]} */
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
            runSlicerAgent: (/** @type {import("./load-plan-test-helpers.js").SlicerRunArgs} */ args) => {
                slicerOpened = true;
                slicerCalls.push(args);
                return Promise.resolve({ ok: true });
            },
            submitPlanForReview: () => Promise.resolve({ approved: true }),
            executePlan: () => {
                executed = true;
                return Promise.resolve({ repairRequired: false, executionComplete: true });
            },
            recordPlanEvent: (/** @type {import("./load-plan-test-helpers.js").RecordedPlanEvent} */ args) => {
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
    /** @type {import("./load-plan-test-helpers.js").RecordedPlanEvent[]} */
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
            recordPlanEvent: (/** @type {import("./load-plan-test-helpers.js").RecordedPlanEvent} */ args) => {
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
    /** @type {import("./load-plan-test-helpers.js").RecordedPlanEvent[]} */
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
            recordPlanEvent: (/** @type {import("./load-plan-test-helpers.js").RecordedPlanEvent} */ args) => {
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
    assertEquals(epicPrompt?.options.map((option) => option.value), [
        "slicer",
        "user_verify",
        "hold",
        "view",
        "cancel",
    ]);
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

Deno.test("runLoadPlanCommand planning approval forwards feedback images to execution", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("resume");
    const reviewImages = [{ base64: "planning-approved", mimeType: "image/png" }];
    /** @type {any} */
    let executeRequest = null;

    await runLoadPlanCommand(["plan-planning-approved"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-planning-approved"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-planning-approved",
                    path: "plans/plan-planning-approved.md",
                    body: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "draft",
                    },
                }),
            runPlanningAgent: () =>
                Promise.resolve({
                    outcome: "approved_execute",
                    planName: "plan-planning-approved",
                    triageMeta: { classification: "FEATURE", affectedPaths: [] },
                    feedback: "Carry these approved notes into execution.",
                    images: reviewImages,
                }),
            executePlan: (/** @type {any} */ request) => {
                executeRequest = request;
                return Promise.resolve({ repairRequired: false, executionComplete: false });
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(executeRequest.reviewFeedback, "Carry these approved notes into execution.");
    assertEquals(executeRequest.reviewImages, reviewImages);
});

Deno.test("runLoadPlanCommand planning PROJECT approval forwards feedback images to Slicer", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("review");
    const reviewImages = [{ base64: "planning-project", mimeType: "image/png" }];
    /** @type {any} */
    let slicerRequest = null;

    await runLoadPlanCommand(["project-planning-approved"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["project-planning-approved"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "project-planning-approved",
                    path: "plans/project-planning-approved.md",
                    body: "body",
                    markdown: "markdown",
                    attrs: {
                        classification: "PROJECT",
                        complexity: "HIGH",
                        summary: "s",
                        affectedPaths: [],
                        status: "draft",
                    },
                }),
            runPlanningAgent: () =>
                Promise.resolve({
                    outcome: "approved_decompose",
                    planName: "project-planning-approved",
                    triageMeta: { classification: "PROJECT", affectedPaths: [] },
                    feedback: "Carry these approved notes into slicing.",
                    images: reviewImages,
                }),
            runSlicerAgent: (/** @type {any} */ request) => {
                slicerRequest = request;
                return Promise.resolve({ ok: true });
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(slicerRequest.reviewFeedback, "Carry these approved notes into slicing.");
    assertEquals(slicerRequest.reviewImages, reviewImages);
});

Deno.test("runLoadPlanCommand ready review decline preserves pre-attempt status", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("review", "no");
    const fixture = makeRuntimeFixture({
        requestInteraction: () => ({
            outcome: "canceled",
            _meta: { canceled: true, feedback: "Cancelled by user (Esc)" },
        }),
    });
    fixture.state.workflow = { planName: "ready-review-cancel", worktreeId: "wt-1", ownerAgent: AGENTS.ENGINEER };
    const preReviewWorkflow = fixture.state.workflow;
    const registryStatuses = /** @type {string[]} */ ([]);
    let lifecycleCalled = false;

    await runLoadPlanCommand(["ready-review-cancel"], {
        ...fixture.context,
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["ready-review-cancel"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "ready-review-cancel",
                    path: "plans/ready-review-cancel.md",
                    body: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "ready_for_work",
                        worktreeId: "wt-1",
                        worktreePath: "/tmp/ready-review-cancel",
                        worktreeBranch: "runwield/worktree/ready-review-cancel",
                        worktreeStatus: "active",
                    },
                }),
            findWorktreeById: () =>
                Promise.resolve({
                    id: "wt-1",
                    planName: "ready-review-cancel",
                    path: "/tmp/ready-review-cancel",
                    branch: "runwield/worktree/ready-review-cancel",
                    status: "active",
                }),
            updateWorktreeRegistryEntry: (
                /** @type {string} */ _cwd,
                /** @type {string} */ _id,
                /** @type {{ status?: string }} */ updates,
            ) => {
                registryStatuses.push(String(updates.status));
                return Promise.resolve(/** @type {any} */ ({ id: "wt-1", status: updates.status }));
            },
            recordPlanEvent: () => {
                lifecycleCalled = true;
                return Promise.resolve(/** @type {any} */ ({}));
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(lifecycleCalled, false);
    assertEquals(registryStatuses, ["abandoned", "active"]);
    assertEquals(fixture.state.workflow, preReviewWorkflow);
});

Deno.test("runLoadPlanCommand approved review preserves remote review outcome", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("review");
    let planningCalled = false;
    const fixture = makeRuntimeFixture({
        requestInteraction: () => ({
            outcome: "accepted",
            message: "Plan saved for remote review.",
            _meta: { remoteReview: true, reviewerUrl: "https://review.example/plan", approved: false },
        }),
    });

    await runLoadPlanCommand(["remote-review-plan"], {
        ...fixture.context,
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["remote-review-plan"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "remote-review-plan",
                    path: "plans/remote-review-plan.md",
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
                planningCalled = true;
                return Promise.resolve({ outcome: "no_call" });
            },
            recordPlanEvent: noOpRecordPlanEvent,
            resetTuiState: () => {},
        }),
    });

    assertEquals(planningCalled, false);
    assertEquals(messages.some((message) => message.includes("remote review")), true);
    assertEquals(messages.some((message) => message.includes(SESSION_COMPLETE_GUIDANCE)), false);
});

Deno.test("runLoadPlanCommand approved FEATURE review run forwards approval feedback images", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("review");
    const reviewImages = [{ base64: "approved", mimeType: "image/png" }];
    /** @type {any} */
    let executeRequest = null;
    const fixture = makeRuntimeFixture({
        requestInteraction: () => ({
            outcome: "accepted",
            _meta: {
                approved: true,
                approvalAction: "run",
                feedback: "Use this screenshot during implementation.",
                images: reviewImages,
            },
        }),
    });

    await runLoadPlanCommand(["plan-run-with-images"], {
        ...fixture.context,
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-run-with-images"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-run-with-images",
                    path: "plans/plan-run-with-images.md",
                    body: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "approved",
                    },
                }),
            executePlan: (/** @type {any} */ request) => {
                executeRequest = request;
                return Promise.resolve({ repairRequired: false, executionComplete: false });
            },
            recordPlanEvent: noOpRecordPlanEvent,
            resetTuiState: () => {},
        }),
    });

    assertEquals(executeRequest.reviewFeedback, "Use this screenshot during implementation.");
    assertEquals(executeRequest.reviewImages, reviewImages);
});

Deno.test("runLoadPlanCommand approved FEATURE review later action shows session-complete guidance", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("review");
    let executed = false;
    const fixture = makeRuntimeFixture({
        requestInteraction: () => ({ outcome: "accepted", _meta: { approved: true, approvalAction: "later" } }),
    });

    await runLoadPlanCommand(["plan-save-later"], {
        ...fixture.context,
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-save-later"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-save-later",
                    path: "plans/plan-save-later.md",
                    body: "body",
                    markdown: "markdown",
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
            recordPlanEvent: noOpRecordPlanEvent,
            resetTuiState: () => {},
        }),
    });

    assertEquals(executed, false);
    assertEquals(messages.some((message) => message.includes("Plan saved. Resume later")), true);
    assertEquals(messages.some((message) => message.includes(SESSION_COMPLETE_GUIDANCE)), true);
});

Deno.test("runLoadPlanCommand approved PROJECT review decompose action starts Slicer with approval images", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("review");
    let slicerCalled = false;
    /** @type {any} */
    let slicerRequest = null;
    const reviewImages = [{ base64: "approved", mimeType: "image/png" }];
    const fixture = makeRuntimeFixture({
        requestInteraction: () => ({
            outcome: "accepted",
            _meta: {
                approved: true,
                approvalAction: "decompose",
                feedback: "Use this screenshot while slicing.",
                images: reviewImages,
            },
        }),
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
            runSlicerAgent: (/** @type {any} */ request) => {
                slicerCalled = true;
                slicerRequest = request;
                return Promise.resolve({ ok: true });
            },
            recordPlanEvent: noOpRecordPlanEvent,
            resetTuiState: () => {},
        }),
    });

    assertEquals(slicerCalled, true);
    assertEquals(slicerRequest.reviewFeedback, "Use this screenshot while slicing.");
    assertEquals(slicerRequest.reviewImages, reviewImages);
});

Deno.test("runLoadPlanCommand approved PROJECT review later action shows session-complete guidance", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("review");
    let slicerCalled = false;
    const fixture = makeRuntimeFixture({
        requestInteraction: () => ({ outcome: "accepted", _meta: { approved: true, approvalAction: "later" } }),
    });

    await runLoadPlanCommand(["plan-project-save-later"], {
        ...fixture.context,
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-project-save-later"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-project-save-later",
                    path: "plans/plan-project-save-later.md",
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

    assertEquals(slicerCalled, false);
    assertEquals(messages.some((message) => message.includes("Plan saved. Resume later")), true);
    assertEquals(messages.some((message) => message.includes(SESSION_COMPLETE_GUIDANCE)), true);
});

Deno.test("runLoadPlanCommand approved review kicks off planner on denial with images", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("review");
    let plannerCalled = false;
    /** @type {any[] | undefined} */
    let plannerImages;
    const reviewImages = [{ base64: "abc", mimeType: "image/png" }];
    const fixture = makeRuntimeFixture({
        requestInteraction: () => ({
            outcome: "accepted",
            _meta: { approved: false, feedback: "missing tests", images: reviewImages },
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
            runPlanningAgent: (/** @type {any} */ request) => {
                plannerCalled = true;
                plannerImages = request.images;
                return Promise.resolve({ outcome: "saved", planName: "plan-d2" });
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(plannerCalled, true);
    assertEquals(plannerImages, reviewImages);
});

Deno.test("runLoadPlanCommand approved PROJECT review feedback returns images to Architect", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("review");
    /** @type {any} */
    let plannerRequest = null;
    const reviewImages = [{ base64: "project-feedback", mimeType: "image/png" }];
    const fixture = makeRuntimeFixture({
        requestInteraction: () => ({
            outcome: "accepted",
            _meta: { approved: false, feedback: "Revise the Epic.", images: reviewImages },
        }),
    });

    await runLoadPlanCommand(["project-feedback-images"], {
        ...fixture.context,
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["project-feedback-images"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "project-feedback-images",
                    path: "plans/project-feedback-images.md",
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
            runPlanningAgent: (/** @type {any} */ request) => {
                plannerRequest = request;
                return Promise.resolve({ outcome: "saved", planName: "project-feedback-images" });
            },
            recordPlanEvent: noOpRecordPlanEvent,
            resetTuiState: () => {},
        }),
    });

    assertEquals(plannerRequest.agentName, AGENTS.ARCHITECT);
    assertEquals(plannerRequest.images, reviewImages);
});
