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

Deno.test("runLoadPlanCommand approved plan proceed path", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("proceed");
    let executed = false;

    await runLoadPlanCommand(["plan-a"], {
        ...makeRuntimeContext(),
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
            resetTuiState: () => {},
        }),
    });

    assertEquals(executed, true);
});

Deno.test("runLoadPlanCommand child FEATURE with verified dependencies executes without warning", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("proceed");
    let executed = false;

    await runLoadPlanCommand(["epic-e/02-second"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: (/** @type {string[]} */ argv) => ({ help: false, _: argv }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "epic-e/02-second",
                    path: "plans/epic-e/02-second.md",
                    body: "child body",
                    markdown: "child body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "Second child",
                        affectedPaths: [],
                        status: "ready_for_work",
                        parentPlan: "epic-e",
                        dependencies: ["01-first"],
                    },
                }),
            resolveSiblingChildPlanDependencies: () =>
                Promise.resolve([
                    {
                        dependency: "01-first",
                        planName: "epic-e/01-first",
                        status: "verified",
                        state: "verified",
                    },
                ]),
            executePlan: () => {
                executed = true;
                return Promise.resolve(undefined);
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(messages.some((message) => message.includes("dependencies that are not verified")), false);
    assertEquals(executed, true);
});

Deno.test("runLoadPlanCommand child FEATURE warns for unverified dependencies and can proceed", async () => {
    const { uiAPI, selections, messages, prompts } = makeUi();
    selections.push("proceed", "proceed");
    let executed = false;

    await runLoadPlanCommand(["epic-f/02-second"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: (/** @type {string[]} */ argv) => ({ help: false, _: argv }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "epic-f/02-second",
                    path: "plans/epic-f/02-second.md",
                    body: "child body",
                    markdown: "child body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "Second child",
                        affectedPaths: [],
                        status: "ready_for_work",
                        parentPlan: "epic-f",
                        dependencies: ["01-first"],
                    },
                }),
            resolveSiblingChildPlanDependencies: () =>
                Promise.resolve([
                    {
                        dependency: "01-first",
                        planName: "epic-f/01-first",
                        status: "implemented",
                        state: "unverified",
                    },
                ]),
            executePlan: () => {
                executed = true;
                return Promise.resolve(undefined);
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(messages.some((message) => message.includes("epic-f/01-first: implemented")), true);
    assertEquals(prompts[0].prompt, 'Proceed with "epic-f/02-second" anyway?');
    assertEquals(executed, true);
});

Deno.test("runLoadPlanCommand child FEATURE warns for missing dependencies", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("proceed", "proceed");
    let executed = false;

    await runLoadPlanCommand(["epic-g/02-second"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: (/** @type {string[]} */ argv) => ({ help: false, _: argv }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "epic-g/02-second",
                    path: "plans/epic-g/02-second.md",
                    body: "child body",
                    markdown: "child body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "Second child",
                        affectedPaths: [],
                        status: "ready_for_work",
                        parentPlan: "epic-g",
                        dependencies: ["01-first"],
                    },
                }),
            resolveSiblingChildPlanDependencies: () =>
                Promise.resolve([
                    {
                        dependency: "01-first",
                        state: "missing",
                    },
                ]),
            executePlan: () => {
                executed = true;
                return Promise.resolve(undefined);
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(messages.some((message) => message.includes("01-first: missing")), true);
    assertEquals(executed, true);
});

Deno.test("runLoadPlanCommand child FEATURE dependency warning can be canceled", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("cancel");
    let executed = false;

    await runLoadPlanCommand(["epic-h/02-second"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: (/** @type {string[]} */ argv) => ({ help: false, _: argv }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "epic-h/02-second",
                    path: "plans/epic-h/02-second.md",
                    body: "child body",
                    markdown: "child body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "Second child",
                        affectedPaths: [],
                        status: "ready_for_work",
                        parentPlan: "epic-h",
                        dependencies: ["01-first"],
                    },
                }),
            resolveSiblingChildPlanDependencies: () =>
                Promise.resolve([
                    {
                        dependency: "01-first",
                        planName: "epic-h/01-first",
                        status: "ready_for_work",
                        state: "unverified",
                    },
                ]),
            executePlan: () => {
                executed = true;
                return Promise.resolve(undefined);
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(messages.includes("Plan load canceled."), true);
    assertEquals(executed, false);
});

Deno.test("runLoadPlanCommand warns and cancels execution when affected paths changed since updatedAt", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("proceed", "cancel");
    let executed = false;
    /** @type {string | undefined} */
    let checkedTimestamp;
    /** @type {string[] | undefined} */
    let checkedPaths;

    await runLoadPlanCommand(["plan-stale"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-stale"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-stale",
                    path: "plans/plan-stale.md",
                    body: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: ["src/a.js"],
                        createdAt: "2026-01-01T00:00:00.000Z",
                        updatedAt: "2026-01-02T00:00:00.000Z",
                        status: "ready_for_work",
                    },
                }),
            listCommitsTouchingPathsSince: (
                /** @type {string} */ _cwd,
                /** @type {string} */ since,
                /** @type {string[]} */ paths,
            ) => {
                checkedTimestamp = since;
                checkedPaths = paths;
                return Promise.resolve([
                    {
                        hash: "abc1234",
                        date: "2026-01-03T00:00:00-05:00",
                        subject: "change affected file",
                    },
                ]);
            },
            executePlan: () => {
                executed = true;
                return Promise.resolve(undefined);
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(checkedTimestamp, "2026-01-02T00:00:00.000Z");
    assertEquals(checkedPaths, ["src/a.js"]);
    assertEquals(messages.some((m) => m.includes("change affected file")), true);
    assertEquals(messages.some((m) => m.includes("src/a.js")), true);
    assertEquals(messages.some((m) => m.includes("Execution canceled.")), true);
    assertEquals(executed, false);
});

Deno.test("runLoadPlanCommand proceeds after affected path warning confirmation", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("proceed", "proceed");
    let executed = false;
    /** @type {string | undefined} */
    let checkedTimestamp;

    await runLoadPlanCommand(["plan-stale-confirmed"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-stale-confirmed"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-stale-confirmed",
                    path: "plans/plan-stale-confirmed.md",
                    body: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: ["src/a.js"],
                        createdAt: "2026-01-01T00:00:00.000Z",
                        status: "ready_for_work",
                    },
                }),
            listCommitsTouchingPathsSince: (
                /** @type {string} */ _cwd,
                /** @type {string} */ since,
                /** @type {string[]} */ _paths,
            ) => {
                checkedTimestamp = since;
                return Promise.resolve([
                    {
                        hash: "def5678",
                        date: "2026-01-03T00:00:00-05:00",
                        subject: "change affected file",
                    },
                ]);
            },
            executePlan: () => {
                executed = true;
                return Promise.resolve(undefined);
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(checkedTimestamp, "2026-01-01T00:00:00.000Z");
    assertEquals(executed, true);
});

Deno.test("runLoadPlanCommand validates completed execution against freshly loaded plan content", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("proceed");
    const runtimeFixture = makeRuntimeFixture();
    /** @type {string | undefined} */
    let validatedPlanContent;

    await runLoadPlanCommand(["plan-fresh"], {
        ...runtimeFixture.context,
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
            loadPlan: () =>
                Promise.resolve({
                    markdown: "fresh markdown",
                    body: "fresh body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "fresh summary",
                        affectedPaths: [],
                        status: "implemented",
                        executionMode: "non_git_in_place",
                        worktreeId: "wt1",
                        worktreePath: "/worktree",
                        worktreeBranch: "runwield/worktree/plan-fresh-wt1",
                        worktreeBaseBranch: "feature-base",
                    },
                }),
            runValidationLoop: (/** @type {{ planContent: string }} */ args) => {
                validatedPlanContent = args.planContent;
                return Promise.resolve();
            },
            recordPlanEvent: noOpRecordPlanEvent,
            resetTuiState: () => {},
        }),
    });

    assertEquals(validatedPlanContent, "fresh markdown");
    assertEquals(runtimeFixture.state.workflow?.executionMode, "non_git_in_place");
});

Deno.test("runLoadPlanCommand ready_for_work plan proceed path executes", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("proceed");
    let executed = false;

    await runLoadPlanCommand(["plan-ready-exec"], {
        ...makeRuntimeContext(),
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
            resetTuiState: () => {},
        }),
    });

    assertEquals(executed, true);
});

Deno.test("runLoadPlanCommand skips affected path history in non-Git projects", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("proceed");
    let executed = false;

    await runLoadPlanCommand(["plan-non-git-history"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-non-git-history"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-non-git-history",
                    path: "plans/plan-non-git-history.md",
                    body: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: ["src/a.js"],
                        status: "ready_for_work",
                        updatedAt: "2026-01-01T00:00:00.000Z",
                    },
                }),
            listCommitsTouchingPathsSince: () =>
                Promise.reject({
                    name: "GitRepositoryRequiredError",
                    message: "Checking affected path commit history requires a Git repository.",
                }),
            executePlan: () => {
                executed = true;
                return Promise.resolve(undefined);
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(executed, true);
    assertEquals(
        messages.some((message) =>
            message.includes("Skipping affected path history check because this project is not a Git repository")
        ),
        true,
    );
});
