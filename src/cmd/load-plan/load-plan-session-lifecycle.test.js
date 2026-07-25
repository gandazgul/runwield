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

Deno.test("runLoadPlanCommand verified plan review path records review_reopened", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("review", "resume");
    let lifecycleCalled = false;
    /** @type {string | null} */
    let lifecycleEvent = null;

    await runLoadPlanCommand(["plan-verified-review"], {
        ...makeRuntimeContext(),
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
            resetTuiState: () => {},
        }),
    });

    assertEquals(lifecycleEvent, "review_reopened");
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
    let lifecycleEvents = 0;

    await runLoadPlanCommand(["plan-verified-cancel"], {
        ...makeRuntimeContext(),
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
            resetTuiState: () => {},
        }),
    });

    assertEquals(lifecycleEvents, 0);
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
