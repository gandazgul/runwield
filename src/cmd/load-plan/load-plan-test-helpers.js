import { AGENTS } from "../../constants.js";

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
export async function git(cwd, args) {
    const output = await new Deno.Command("git", { cwd, args, stdout: "piped", stderr: "piped" }).output();
    if (!output.success) throw new Error(new TextDecoder().decode(output.stderr));
    return new TextDecoder().decode(output.stdout).trim();
}

export function makeUi() {
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
export function makeRuntimeFixture(options = {}) {
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
            /** @param {string} id */
            getRuntimeActiveAgentName: (id) => id === sessionId ? state.activeAgent : null,
            /** @param {string} id */
            getRuntimeActiveExecutionWorkflow: (id) => id === sessionId ? state.workflow : null,
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

export function makeRuntimeContext() {
    return makeRuntimeFixture().context;
}

export function noOpRecordPlanEvent() {
    return Promise.resolve(/** @type {any} */ ({}));
}
