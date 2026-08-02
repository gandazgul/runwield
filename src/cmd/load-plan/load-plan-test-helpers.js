import { AGENTS, getCwd } from "../../constants.js";
import { savePlan } from "../../plan-store.js";

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
 * @property {string} [cwd] Project root the session reports. Defaults to a throwaway directory.
 * @property {string} [sessionId]
 * @property {string} [activeAgent]
 * @property {(request: any) => any} [requestInteraction]
 */

/** @param {RuntimeFixtureOptions} [options] */
export function makeRuntimeFixture(options = {}) {
    const sessionId = options.sessionId || "load-plan-test";
    // Lifecycle operations lock and journal under the session cwd, so a test whose
    // cwd is the developer's checkout writes Plan locks and recovery journals into
    // it. Every test that drives a lifecycle write now passes a `cwd` from
    // `makePlanProject`. The process-cwd default is left for the handful of tests
    // that only read a faked Plan and never write, and it should not gain new users.
    const cwd = options.cwd || getCwd();
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
                        cwd,
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

export function makeRuntimeContext(options = {}) {
    return makeRuntimeFixture(options).context;
}

/**
 * Build a throwaway project that owns a real Plan file.
 *
 * Lifecycle transitions read the canonical Plan bytes under the Plan lock and
 * refuse a caller whose `currentStatus` disagrees with what is on disk, so a
 * test that drives one needs a real file at a real status — a stand-in writer
 * needed neither, which is why so many of these fixtures had no project at all.
 *
 * @param {string} planName
 * @param {import('../../plan-store.js').PlanFrontMatterInput} attrs
 * @param {{ body?: string, prefix?: string }} [options]
 * @returns {Promise<{ projectRoot: string, planPath: string }>}
 */
export async function makePlanProject(planName, attrs, options = {}) {
    const projectRoot = await Deno.realPath(
        await Deno.makeTempDir({ prefix: options.prefix || "runwield-load-plan-" }),
    );
    const planPath = await savePlan(projectRoot, planName, options.body || `# ${planName}`, attrs);
    return { projectRoot, planPath };
}
