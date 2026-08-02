import { assertEquals } from "@std/assert";
import { runLoadPlanCommand } from "./index.js";

import { AGENTS } from "../../constants.js";

import { makePlanProject, makeRuntimeContext, makeRuntimeFixture, makeUi } from "./load-plan-test-helpers.js";
import { loadPlan } from "../../plan-store.js";

/** @typedef {import('../../plan-store.js').PlanFrontMatterInput} PlanFrontMatterInput */

const VERIFIED_ATTRS = /** @type {PlanFrontMatterInput} */ ({
    classification: "FEATURE",
    complexity: "LOW",
    summary: "s",
    affectedPaths: [],
    status: "verified",
});

Deno.test("runLoadPlanCommand verified plan review path records review_reopened", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("review", "resume");
    let lifecycleCalled = false;
    // The event only matters because it moves the Plan, so the assertion is on
    // the Plan. A stand-in writer recorded the name of a write it never made.
    const { projectRoot } = await makePlanProject("plan-verified-review", { ...VERIFIED_ATTRS });

    await runLoadPlanCommand(["plan-verified-review"], {
        ...makeRuntimeContext({ cwd: projectRoot }),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-verified-review"] }),
            runPlanningAgent: () => {
                lifecycleCalled = true;
                return Promise.resolve({ outcome: "saved", planName: "plan-verified-review" });
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals((await loadPlan(projectRoot, "plan-verified-review"))?.attrs.status, "feedback");
    assertEquals(lifecycleCalled, true);
});

Deno.test("runLoadPlanCommand verified plan can be archived from the action menu", async () => {
    const { uiAPI, selections, prompts, messages } = makeUi();
    selections.push("archive");
    /** @type {string | null} */
    let archivedTarget = null;

    await runLoadPlanCommand(["plan-verified-archive"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-verified-archive"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-verified-archive",
                    path: "plans/plan-verified-archive.md",
                    body: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "verified",
                    },
                }),
            archivePlan: (/** @type {string} */ _cwd, /** @type {string} */ target) => {
                archivedTarget = target;
                return Promise.resolve(
                    /** @type {any} */ ({ relativePath: "plans/archived/plan-verified-archive.md" }),
                );
            },
        }),
    });

    const actionPrompt = prompts.find((prompt) => prompt.prompt === "What would you like to do?");
    assertEquals(actionPrompt?.options.some((option) => option.value === "archive"), true);
    assertEquals(archivedTarget, "plan-verified-archive");
    assertEquals(messages.some((message) => message.includes("plans/archived/plan-verified-archive.md")), true);
});

Deno.test("runLoadPlanCommand verified plan cancel returns without changes", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("cancel");
    let executed = false;
    let lifecycleCalled = false;
    const { projectRoot } = await makePlanProject("plan-verified-cancel", { ...VERIFIED_ATTRS });
    const before = await loadPlan(projectRoot, "plan-verified-cancel");

    await runLoadPlanCommand(["plan-verified-cancel"], {
        ...makeRuntimeContext({ cwd: projectRoot }),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-verified-cancel"] }),
            executePlan: () => {
                executed = true;
                return Promise.resolve(undefined);
            },
            runPlanningAgent: () => {
                lifecycleCalled = true;
                return Promise.resolve({ outcome: "saved" });
            },
            resetTuiState: () => {},
        }),
    });

    // Canceling must not write. Counting calls to a stand-in could not tell a
    // no-op write from no write at all; an unchanged revision can.
    const after = await loadPlan(projectRoot, "plan-verified-cancel");
    assertEquals(after?.attrs.status, "verified");
    assertEquals(after?.revision, before?.revision);
    assertEquals(executed, false);
    assertEquals(lifecycleCalled, false);
});

Deno.test("runLoadPlanCommand starts interactive session and captures session when ui missing", async () => {
    let started = false;
    let callbackProvided = false;
    await runLoadPlanCommand(["plan-f"], {
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-f"] }),
            startInteractiveSession: (
                /** @type {string | null} */ _initial,
                /** @type {{ onSessionReady?: (sessionId: string, runtime: import('../../shared/session/session-runtime.js').SessionRuntime) => void }} */ options,
            ) => {
                started = true;
                callbackProvided = typeof options?.onSessionReady === "function";
                const fixture = makeRuntimeFixture();
                options?.onSessionReady?.(fixture.context.sessionId, fixture.runtime);
                return Promise.resolve(null);
            },
        }),
    });

    assertEquals(started, true);
    assertEquals(callbackProvided, true);
});

Deno.test("runLoadPlanCommand explains managed session unsupported plan actions", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("resume");
    let planningCalled = false;

    await runLoadPlanCommand(["managed-plan"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["managed-plan"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "managed-plan",
                    path: "plans/managed-plan.md",
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
                planningCalled = true;
                return Promise.reject(new Error("managed_unsupported"));
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(planningCalled, true);
    assertEquals(messages.some((message) => message.includes("managed session could not be activated")), true);
    assertEquals(messages.some((message) => message.includes("managed_unsupported")), true);
    assertEquals(messages.some((message) => message.startsWith("Error: managed_unsupported")), false);
});

Deno.test("runLoadPlanCommand keeps planner active when lifecycle canceled", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("resume");
    const fixture = makeRuntimeFixture();

    await runLoadPlanCommand(["plan-h"], {
        ...fixture.context,
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
            resetTuiState: () => {},
        }),
    });

    assertEquals(fixture.state.agentHistory.includes(AGENTS.PLANNER), true);
    assertEquals(fixture.state.agentHistory.includes(AGENTS.ROUTER), false);
});

Deno.test("runLoadPlanCommand keeps planner active when agent ends without plan_written", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("resume");
    const fixture = makeRuntimeFixture();

    await runLoadPlanCommand(["plan-i"], {
        ...fixture.context,
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
            resetTuiState: () => {},
        }),
    });

    assertEquals(fixture.state.agentHistory.includes(AGENTS.PLANNER), true);
    assertEquals(fixture.state.agentHistory.includes(AGENTS.ROUTER), false);
});

Deno.test("runLoadPlanCommand keeps planner active after lifecycle saves a plan from router flow", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("resume");
    const fixture = makeRuntimeFixture();

    await runLoadPlanCommand(["plan-g"], {
        ...fixture.context,
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
            resetTuiState: () => {},
        }),
    });

    assertEquals(fixture.state.agentHistory.includes(AGENTS.PLANNER), true);
    assertEquals(fixture.state.agentHistory.includes(AGENTS.ROUTER), false);
});

Deno.test("runLoadPlanCommand restores the initially active agent after lifecycle saves a plan", async () => {
    const { uiAPI } = makeUi();
    const fixture = makeRuntimeFixture({ activeAgent: AGENTS.IDEATOR });

    await runLoadPlanCommand(["plan-j"], {
        ...fixture.context,
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-j"] }),
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
            resetTuiState: () => {},
        }),
    });

    assertEquals(fixture.state.agentHistory.includes(AGENTS.IDEATOR), true);
    assertEquals(fixture.state.agentHistory.includes(AGENTS.ROUTER), false);
});
