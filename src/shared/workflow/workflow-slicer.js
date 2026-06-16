/**
 * @module shared/workflow/workflow-slicer
 * Slicer pseudo-agent orchestration for PROJECT plans.
 */

import { dirname, fromFileUrl, join } from "@std/path";
import { AGENTS } from "../../constants.js";
import { saveChildFeaturePlans } from "../../plan-store.js";
import { ensureBundledAgentDefFile, runAgentSession } from "../session/session.js";
import { loadAgentDefFromPath } from "../session/agents.js";
import { extractTasks, validateProjectTasks } from "./task-scheduling.js";
import { buildSlicerRequest } from "./workflow-prompts.js";

export const __dirname = dirname(fromFileUrl(import.meta.url));
const WORKFLOW_PROMPTS_DIR = "workflow-prompts";
const SLICER_PROMPT_FILE = "slicer-prompt.md";

/**
 * Materialize a Slicer decomposition draft into child FEATURE plan files.
 *
 * @param {Object} opts
 * @param {string} opts.cwd - Project root.
 * @param {string} opts.epicPlanName - Parent Epic plan name.
 * @param {import('../../plan-store.js').ChildFeaturePlanDescriptor[]} opts.children
 * @param {{ saveChildFeaturePlans?: typeof saveChildFeaturePlans }} [opts.__deps] - Test-only injection point.
 * @returns {ReturnType<typeof saveChildFeaturePlans>}
 */
export function materializeSlicerDraft({ cwd, epicPlanName, children, __deps }) {
    const saveChildren = __deps?.saveChildFeaturePlans || saveChildFeaturePlans;
    return saveChildren(cwd, epicPlanName, children);
}

/**
 * Run the slicer agent against an approved design-only plan.
 *
 * @param {Object} opts
 * @param {string} opts.planName
 * @param {import('../../tools/plan-written.js').TriageMeta} [opts.triageMeta]
 * @param {import('../ui/types.js').UiAPI} opts.uiAPI
 * @param {import('@earendil-works/pi-coding-agent').SessionManager} [opts.sessionManager]
 * @param {{
 *   runAgentSession?: typeof runAgentSession,
 *   loadAgentDefFromPath?: typeof loadAgentDefFromPath,
 *   ensureBundledAgentDefFile?: typeof ensureBundledAgentDefFile,
 * }} [opts.__deps] - Test-only injection point.
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function runSlicerAgent({ planName, triageMeta, uiAPI, sessionManager, __deps }) {
    if (!uiAPI) throw new Error("runSlicerAgent: uiAPI is required");
    const session = __deps?.runAgentSession || runAgentSession;
    const loadSlicerDef = __deps?.loadAgentDefFromPath || loadAgentDefFromPath;
    const ensurePromptFile = __deps?.ensureBundledAgentDefFile || ensureBundledAgentDefFile;
    const slicerPromptPath = await ensurePromptFile(join(WORKFLOW_PROMPTS_DIR, SLICER_PROMPT_FILE));
    const slicerAgentDef = await loadSlicerDef(slicerPromptPath, { agentName: AGENTS.SLICER });

    const slicerDisplay = slicerAgentDef.displayName;

    try {
        await session({
            agentName: AGENTS.SLICER,
            userRequest: buildSlicerRequest(planName, triageMeta),
            triageMeta,
            uiAPI,
            sessionManager,
            _agentDefOverride: slicerAgentDef,
        });
        return { ok: true };
    } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        uiAPI.appendSystemMessage(`${slicerDisplay} failed: ${error}`, true, "Harns");
        return { ok: false, error };
    }
}

/**
 * Ensure a PROJECT plan has a parseable Tasks table.
 *
 * @param {Object} opts
 * @param {string} opts.planName
 * @param {string} opts.planPath - Absolute path to the plan markdown file.
 * @param {import('../../tools/plan-written.js').TriageMeta} [opts.triageMeta]
 * @param {import('../ui/types.js').UiAPI} opts.uiAPI
 * @param {import('@earendil-works/pi-coding-agent').SessionManager} [opts.sessionManager]
 * @param {{
 *   runSlicerAgent?: typeof runSlicerAgent,
 *   readTextFile?: (path: string) => Promise<string>,
 *   extractTasks?: typeof extractTasks,
 *   validateProjectTasks?: typeof validateProjectTasks,
 * }} [opts.__deps] - Test-only injection point.
 * @returns {Promise<{ ok: true, slicerInvoked: boolean } | { ok: false, error: string, stage: "slicer" | "validation" }>}
 */
export async function ensureSlicerTasks({ planName, planPath, triageMeta, uiAPI, sessionManager, __deps }) {
    if (!uiAPI) throw new Error("ensureSlicerTasks: uiAPI is required");
    const slicer = __deps?.runSlicerAgent || runSlicerAgent;
    const readTextFile = __deps?.readTextFile || Deno.readTextFile.bind(Deno);
    const parseTasks = __deps?.extractTasks || extractTasks;
    const validateTasks = __deps?.validateProjectTasks || validateProjectTasks;

    try {
        const currentMd = await readTextFile(planPath);
        validateTasks(parseTasks(currentMd));
        return { ok: true, slicerInvoked: false };
    } catch {
        // Tasks missing or unparseable; slicer must run.
    }

    const slicerResult = await slicer({ planName, triageMeta, uiAPI, sessionManager });
    if (!slicerResult.ok) {
        return { ok: false, error: slicerResult.error || "slicer failed", stage: "slicer" };
    }

    try {
        const slicedMd = await readTextFile(planPath);
        validateTasks(parseTasks(slicedMd));
    } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        return { ok: false, error, stage: "validation" };
    }

    return { ok: true, slicerInvoked: true };
}
