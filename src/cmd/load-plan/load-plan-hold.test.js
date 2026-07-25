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

Deno.test("runLoadPlanCommand draft FEATURE can be put on hold", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("hold");
    let recorded = null;

    await runLoadPlanCommand(["hold-me"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["hold-me"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "hold-me",
                    path: "plans/hold-me.md",
                    body: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "draft",
                        updatedAt: "2026-01-01T00:00:00.000Z",
                    },
                }),
            recordPlanEvent: (/** @type {any} */ args) => {
                recorded = args;
                return Promise.resolve({ status: "on_hold", heldFromStatus: "draft" });
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(/** @type {any} */ (recorded).event, "plan_held");
    assertEquals(/** @type {any} */ (recorded).details.holdStalenessBaseline, "2026-01-01T00:00:00.000Z");
    assertEquals(messages.some((message) => message.includes("Plan put on hold")), true);
});

Deno.test("runLoadPlanCommand on-hold plan resumes after passing Resume Check", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("resume", "cancel");
    let recorded = null;

    await runLoadPlanCommand(["held-plan"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["held-plan"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "held-plan",
                    path: "plans/held-plan.md",
                    body: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "on_hold",
                        heldFromStatus: "draft",
                    },
                }),
            listCommitsTouchingPathsSince: () => Promise.resolve([]),
            recordPlanEvent: (/** @type {any} */ args) => {
                recorded = args;
                return Promise.resolve({
                    status: "draft",
                    heldFromStatus: null,
                    heldAt: null,
                    holdReason: null,
                    holdStalenessBaseline: null,
                });
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(/** @type {any} */ (recorded).event, "hold_resumed");
    assertEquals(messages.some((message) => message.includes("Resume Check")), true);
});

Deno.test("runLoadPlanCommand on-hold plan can reset status to draft", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("reset", "confirm");
    let recorded = null;

    await runLoadPlanCommand(["held-reset"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["held-reset"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "held-reset",
                    path: "plans/held-reset.md",
                    body: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "on_hold",
                        heldFromStatus: "implemented",
                    },
                }),
            findWorktreeByPlanName: () => Promise.resolve(null),
            recordPlanEvent: (/** @type {any} */ args) => {
                recorded = args;
                return Promise.resolve({ status: "draft", heldFromStatus: null });
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(/** @type {any} */ (recorded).event, "hold_reset_to_draft");
});

Deno.test("runLoadPlanCommand blocks child FEATURE when parent Epic is on hold", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("cancel");

    await runLoadPlanCommand(["epic/child"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["epic/child"] }),
            /** @param {string} _cwd @param {string} name */
            resolvePlan: (_cwd, name) =>
                Promise.resolve(
                    name === "epic"
                        ? {
                            planName: "epic",
                            path: "plans/epic.md",
                            body: "epic body",
                            attrs: {
                                classification: "PROJECT",
                                complexity: "HIGH",
                                summary: "epic",
                                affectedPaths: [],
                                status: "on_hold",
                                heldFromStatus: "ready_for_work",
                            },
                        }
                        : {
                            planName: "epic/child",
                            path: "plans/epic/child.md",
                            body: "child body",
                            attrs: {
                                classification: "FEATURE",
                                complexity: "LOW",
                                summary: "child",
                                affectedPaths: [],
                                status: "ready_for_work",
                                parentPlan: "epic",
                            },
                        },
                ),
            resetTuiState: () => {},
        }),
    });

    assertEquals(messages.some((message) => message.includes("Parent Epic") && message.includes("on hold")), true);
});

Deno.test("runLoadPlanCommand Epic can be put on hold with warning", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("hold", "confirm");
    let recorded = null;

    await runLoadPlanCommand(["epic-hold"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["epic-hold"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "epic-hold",
                    path: "plans/epic-hold.md",
                    body: "epic body",
                    attrs: {
                        classification: "PROJECT",
                        complexity: "HIGH",
                        summary: "epic",
                        affectedPaths: [],
                        status: "ready_for_work",
                    },
                }),
            findPlansByParent: () =>
                Promise.resolve([
                    {
                        planName: "epic-hold/child",
                        path: "plans/epic-hold/child.md",
                        body: "child",
                        attrs: { status: "draft", classification: "FEATURE", summary: "child" },
                    },
                ]),
            recordPlanEvent: (/** @type {any} */ args) => {
                recorded = args;
                return Promise.resolve({ status: "on_hold", heldFromStatus: "ready_for_work" });
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(/** @type {any} */ (recorded).event, "plan_held");
    assertEquals(messages.some((message) => message.includes("Child FEATURE Plans will be hidden/blocked")), true);
});

Deno.test("runLoadPlanCommand child FEATURE can be put on hold with child-only warning", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("hold", "confirm");
    let recorded = null;

    await runLoadPlanCommand(["epic/child-hold"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["epic/child-hold"] }),
            /** @param {string} _cwd @param {string} name */
            resolvePlan: (_cwd, name) =>
                Promise.resolve(
                    name === "epic"
                        ? {
                            planName: "epic",
                            path: "plans/epic.md",
                            body: "epic body",
                            attrs: {
                                classification: "PROJECT",
                                complexity: "HIGH",
                                summary: "epic",
                                affectedPaths: [],
                                status: "ready_for_work",
                            },
                        }
                        : {
                            planName: "epic/child-hold",
                            path: "plans/epic/child-hold.md",
                            body: "child body",
                            attrs: {
                                classification: "FEATURE",
                                complexity: "LOW",
                                summary: "child",
                                affectedPaths: [],
                                status: "draft",
                                parentPlan: "epic",
                            },
                        },
                ),
            recordPlanEvent: (/** @type {any} */ args) => {
                recorded = args;
                return Promise.resolve({ status: "on_hold", heldFromStatus: "draft" });
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(/** @type {any} */ (recorded).event, "plan_held");
    assertEquals(messages.some((message) => message.includes("Only this child FEATURE will be held")), true);
});

Deno.test("runLoadPlanCommand on-hold resume warning can keep plan on hold", async () => {
    const { uiAPI, selections, messages, prompts } = makeUi();
    selections.push("resume", "keep", "cancel");
    let recorded = null;

    await runLoadPlanCommand(["held-warning"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["held-warning"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "held-warning",
                    path: "plans/held-warning.md",
                    body: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: ["src/a.js"],
                        status: "on_hold",
                        heldFromStatus: "ready_for_work",
                        holdStalenessBaseline: "2026-01-01T00:00:00.000Z",
                    },
                }),
            listCommitsTouchingPathsSince: () => Promise.resolve([{ hash: "abc1234", subject: "change", author: "A" }]),
            recordPlanEvent: (/** @type {any} */ args) => {
                recorded = args;
                return Promise.resolve({ status: "ready_for_work" });
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(recorded, null);
    assertEquals(messages.some((message) => message.includes("Resume Check")), true);
    assertEquals(
        prompts.some((prompt) => prompt.options.some((option) => option.label === "Keep on hold")),
        true,
    );
});

Deno.test("runLoadPlanCommand on-hold resume warning can proceed", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("resume", "proceed", "cancel");
    let recorded = null;

    await runLoadPlanCommand(["held-warning-proceed"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["held-warning-proceed"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "held-warning-proceed",
                    path: "plans/held-warning-proceed.md",
                    body: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: ["src/a.js"],
                        status: "on_hold",
                        heldFromStatus: "ready_for_work",
                        holdStalenessBaseline: "2026-01-01T00:00:00.000Z",
                    },
                }),
            listCommitsTouchingPathsSince: () => Promise.resolve([{ hash: "abc1234", subject: "change", author: "A" }]),
            recordPlanEvent: (/** @type {any} */ args) => {
                recorded = args;
                return Promise.resolve({ status: "ready_for_work" });
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(/** @type {any} */ (recorded).event, "hold_resumed");
});

Deno.test("runLoadPlanCommand failed Resume Check keeps plan on hold", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("resume", "cancel");
    let recorded = null;

    await runLoadPlanCommand(["held-fail"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["held-fail"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "held-fail",
                    path: "plans/held-fail.md",
                    body: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "on_hold",
                        heldFromStatus: "implemented",
                        worktreeId: "missing-worktree",
                        worktreeStatus: "in_progress",
                    },
                }),
            findWorktreeById: () => Promise.resolve(null),
            findWorktreeByPlanName: () => Promise.resolve(null),
            recordPlanEvent: (/** @type {any} */ args) => {
                recorded = args;
                return Promise.resolve({ status: "implemented" });
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(recorded, null);
    assertEquals(messages.some((message) => message.includes("Resume Check failed")), true);
});

Deno.test("runLoadPlanCommand on-hold reset can delete recorded worktree", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("reset", "reset_delete", "confirm");
    let recorded = null;
    let removed = null;
    let registryUpdate = null;

    await runLoadPlanCommand(["held-delete-worktree"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["held-delete-worktree"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "held-delete-worktree",
                    path: "plans/held-delete-worktree.md",
                    body: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "on_hold",
                        heldFromStatus: "implemented",
                        worktreeId: "wt-1",
                        worktreePath: "/tmp/wt-1",
                        worktreeBranch: "runwield/worktree/held-delete-worktree-12345678",
                    },
                }),
            findWorktreeById: () =>
                Promise.resolve({
                    id: "wt-1",
                    path: "/tmp/wt-1",
                    branch: "runwield/worktree/held-delete-worktree-12345678",
                    status: "in_progress",
                }),
            findWorktreeByPlanName: () => Promise.resolve(null),
            removeExecutionWorktree: (/** @type {any} */ args) => {
                removed = args;
                return Promise.resolve();
            },
            updateWorktreeRegistryEntry: (
                /** @type {string} */ _cwd,
                /** @type {string} */ id,
                /** @type {any} */ patch,
            ) => {
                registryUpdate = { id, patch };
                return Promise.resolve({ id, ...patch });
            },
            recordPlanEvent: (/** @type {any} */ args) => {
                recorded = args;
                return Promise.resolve({ status: "draft", heldFromStatus: null });
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(/** @type {any} */ (recorded).event, "hold_reset_to_draft");
    assertEquals(/** @type {any} */ (removed).force, true);
    assertEquals(/** @type {any} */ (registryUpdate).patch.status, "abandoned");
});
