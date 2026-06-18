/**
 * @module shared/workflow/workflow-slicer
 * Slicer pseudo-agent orchestration for PROJECT plans.
 */

import { dirname, fromFileUrl, join } from "@std/path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { AGENTS, CWD } from "../../constants.js";
import { findPlansByParent, loadPlan, parsePlanFrontMatter, saveChildFeaturePlans } from "../../plan-store.js";
import { ensureBundledAgentDefFile, runAgentSession } from "../session/session.js";
import { createAgentHandler } from "../session/agent-handler.js";
import { loadAgentDefFromPath } from "../session/agents.js";
import { extractTasks, validateProjectTasks } from "./task-scheduling.js";
import { buildSlicerRequest } from "./workflow-prompts.js";
import { isEpicPlan, recordPlanEvent } from "./plan-lifecycle.js";

export const __dirname = dirname(fromFileUrl(import.meta.url));
const WORKFLOW_PROMPTS_DIR = "workflow-prompts";
const SLICER_PROMPT_FILE = "slicer-prompt.md";
const LEGACY_SLICER_PROMPT_FILE = "legacy-task-slicer-prompt.md";

const CHILD_DESCRIPTOR_SCHEMA = Type.Object({
    title: Type.String({ description: "Child FEATURE title." }),
    summary: Type.String({ description: "Brief child FEATURE summary." }),
    dependencies: Type.Array(Type.String(), { description: "Child plan dependencies, if any." }),
    affectedPaths: Type.Array(Type.String(), { description: "Expected affected paths." }),
    content: Type.String({ description: "Complete child FEATURE plan markdown body without YAML front matter." }),
});

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
export async function materializeSlicerDraft({ cwd, epicPlanName, children, __deps }) {
    const saveChildren = __deps?.saveChildFeaturePlans || saveChildFeaturePlans;
    return await saveChildren(cwd, epicPlanName, children);
}

/**
 * @param {string} text
 * @returns {string}
 */
function formatToolError(text) {
    return `Slicer tool failed: ${text}`;
}

/**
 * @param {Object} opts
 * @param {string} opts.planName
 * @param {string} [opts.cwd]
 * @param {{ materializeSlicerDraft?: typeof materializeSlicerDraft }} [opts.__deps]
 * @returns {import('@earendil-works/pi-coding-agent').ToolDefinition}
 */
export function createSlicerDraftTool({ planName, cwd = CWD, __deps }) {
    const materialize = __deps?.materializeSlicerDraft || materializeSlicerDraft;
    return defineTool({
        name: "slicer_write_feature_drafts",
        label: "Write FEATURE Drafts",
        description:
            "Materialize draft child FEATURE plans for the current Epic. Use only after explicit user request.",
        parameters: Type.Object({
            children: Type.Array(CHILD_DESCRIPTOR_SCHEMA, {
                description: "Child FEATURE plan descriptors to create or update.",
            }),
        }),
        async execute(_toolCallId, params) {
            try {
                const children = /** @type {import('../../plan-store.js').ChildFeaturePlanDescriptor[]} */
                    (params.children || []);
                const results = await materialize({ cwd, epicPlanName: planName, children });
                const summary = results.length === 0
                    ? "No child FEATURE drafts were written."
                    : results.map((result) => `${result.action}: ${result.name}`).join("\n");
                return {
                    content: [{ type: "text", text: summary }],
                    details: { results, error: "" },
                };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return {
                    content: [{ type: "text", text: formatToolError(message) }],
                    details: { results: [], error: message },
                };
            }
        },
    });
}

/**
 * @param {Object} opts
 * @param {string} opts.planName
 * @param {string} [opts.cwd]
 * @param {{ loadPlan?: typeof loadPlan, findPlansByParent?: typeof findPlansByParent, recordPlanEvent?: typeof recordPlanEvent }} [opts.__deps]
 * @returns {import('@earendil-works/pi-coding-agent').ToolDefinition}
 */
export function createSlicerFinalizeTool({ planName, cwd = CWD, __deps }) {
    const loadPlanImpl = __deps?.loadPlan || loadPlan;
    const findChildren = __deps?.findPlansByParent || findPlansByParent;
    const recordEvent = __deps?.recordPlanEvent || recordPlanEvent;
    return defineTool({
        name: "slicer_finalize_decomposition",
        label: "Finalize Epic Decomposition",
        description: "Finalize the current Epic decomposition after explicit user confirmation.",
        parameters: Type.Object({
            confirmation: Type.String({
                description: "A short statement that the user explicitly confirmed finalizing decomposition.",
            }),
        }),
        async execute(_toolCallId, params) {
            try {
                if (!String(params.confirmation || "").trim()) {
                    throw new Error("Explicit user confirmation is required to finalize decomposition.");
                }
                const epic = await loadPlanImpl(cwd, planName);
                if (!epic) throw new Error(`Epic plan not found: ${planName}`);
                if (!isEpicPlan(epic.attrs)) throw new Error(`Plan is not a PROJECT Epic: ${planName}`);
                if (epic.attrs.status === "draft") throw new Error("Draft Epics cannot be finalized.");

                const children = (await findChildren(cwd, planName)).filter((child) =>
                    child.attrs.classification === "FEATURE"
                );
                if (children.length === 0) throw new Error("At least one child FEATURE plan is required.");

                if (epic.attrs.status === "ready_for_work") {
                    return {
                        content: [{
                            type: "text",
                            text: `Epic already ready_for_work with ${children.length} child FEATURE plan(s).`,
                        }],
                        details: { status: "ready_for_work", children: children.map((child) => child.name), error: "" },
                    };
                }

                if (epic.attrs.status !== "approved" && epic.attrs.status !== "ready_for_decomposition") {
                    throw new Error(
                        `Cannot finalize Epic from status "${epic.attrs.status}". Expected approved or ready_for_decomposition.`,
                    );
                }

                const updated = await recordEvent({
                    cwd,
                    planName,
                    event: "decomposition_finalized",
                    currentStatus: /** @type {import('./plan-lifecycle.js').PlanStatus} */ (epic.attrs.status),
                    details: { triageMeta: epic.attrs },
                });
                return {
                    content: [{ type: "text", text: `Finalized Epic decomposition: ${planName} is ready_for_work.` }],
                    details: { status: updated.status, children: children.map((child) => child.name), error: "" },
                };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return {
                    content: [{ type: "text", text: formatToolError(message) }],
                    details: { status: "error", children: [], error: message },
                };
            }
        },
    });
}

/**
 * @param {{ name: string, attrs: import('../../plan-store.js').PlanFrontMatter }} child
 * @returns {{ name: string, status: string | undefined, summary: string | undefined, dependencies: string[], affectedPaths: string[] }}
 */
function summarizeChild(child) {
    return {
        name: child.name,
        status: child.attrs.status,
        summary: child.attrs.summary,
        dependencies: Array.isArray(child.attrs.dependencies) ? child.attrs.dependencies : [],
        affectedPaths: Array.isArray(child.attrs.affectedPaths) ? child.attrs.affectedPaths : [],
    };
}

/**
 * @param {{
 *   ensureBundledAgentDefFile?: typeof ensureBundledAgentDefFile,
 *   loadAgentDefFromPath?: typeof loadAgentDefFromPath,
 * }} [deps]
 * @returns {Promise<import('../session/types.js').AgentDefinition>}
 */
async function loadSlicerAgentDef(deps) {
    const ensurePromptFile = deps?.ensureBundledAgentDefFile || ensureBundledAgentDefFile;
    const loadSlicerDef = deps?.loadAgentDefFromPath || loadAgentDefFromPath;
    const slicerPromptPath = await ensurePromptFile(join(WORKFLOW_PROMPTS_DIR, SLICER_PROMPT_FILE));
    return await loadSlicerDef(slicerPromptPath, { agentName: AGENTS.SLICER });
}

/**
 * @param {string} planName
 * @param {{
 *   createSlicerDraftTool?: typeof createSlicerDraftTool,
 *   createSlicerFinalizeTool?: typeof createSlicerFinalizeTool,
 * }} [deps]
 * @returns {import('@earendil-works/pi-coding-agent').ToolDefinition[]}
 */
function createSlicerCustomTools(planName, deps) {
    const makeDraftTool = deps?.createSlicerDraftTool || createSlicerDraftTool;
    const makeFinalizeTool = deps?.createSlicerFinalizeTool || createSlicerFinalizeTool;
    return [makeDraftTool({ planName }), makeFinalizeTool({ planName })];
}

/**
 * Run the interactive slicer agent against an Epic plan.
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
 *   loadPlan?: typeof loadPlan,
 *   findPlansByParent?: typeof findPlansByParent,
 *   setActiveAgent?: (agentName: string, handler: import('../session/types.js').AgentMessageHandler, uiAPI: import('../ui/types.js').UiAPI, agentModel?: string, options?: { allowReturnToRouter?: boolean }) => void,
 *   createSlicerDraftTool?: typeof createSlicerDraftTool,
 *   createSlicerFinalizeTool?: typeof createSlicerFinalizeTool,
 * }} [opts.__deps] - Test-only injection point.
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function runSlicerAgent({ planName, triageMeta, uiAPI, sessionManager, __deps }) {
    if (!uiAPI) throw new Error("runSlicerAgent: uiAPI is required");
    const session = __deps?.runAgentSession || runAgentSession;
    const loadEpic = __deps?.loadPlan || (__deps
        ? (() =>
            Promise.resolve({
                path: `plans/${planName}.md`,
                markdown: "# Test Epic",
                body: "# Test Epic",
                attrs: { classification: "PROJECT", type: "epic", status: "ready_for_decomposition" },
            }))
        : loadPlan);
    const findChildren = __deps?.findPlansByParent || (__deps ? (() => Promise.resolve([])) : findPlansByParent);
    const setActive = __deps
        ? (__deps.setActiveAgent || (() => {}))
        : (await import("../interactive/chat-session.js")).setActiveAgent;
    const slicerAgentDef = await loadSlicerAgentDef(__deps);

    const slicerDisplay = slicerAgentDef.displayName;

    try {
        const epic = await loadEpic(CWD, planName);
        if (!epic) throw new Error(`Epic plan not found: ${planName}`);
        if (!isEpicPlan(epic.attrs)) throw new Error(`Plan is not a PROJECT Epic: ${planName}`);
        const children = (await findChildren(CWD, planName))
            .filter((child) => child.attrs.classification === "FEATURE")
            .map(summarizeChild);

        await session({
            agentName: AGENTS.SLICER,
            userRequest: buildSlicerRequest({
                planName,
                epicMarkdown: epic.markdown,
                epicBody: epic.body,
                epicAttrs: epic.attrs,
                triageMeta,
                children,
            }),
            triageMeta,
            uiAPI,
            sessionManager,
            _agentDefOverride: slicerAgentDef,
            customTools: createSlicerCustomTools(planName, __deps),
            useRootSession: true,
            allowReturnToRouter: false,
        });
        setActive(
            AGENTS.SLICER,
            createAgentHandler(AGENTS.SLICER, {
                _agentDefOverride: slicerAgentDef,
                customTools: createSlicerCustomTools(planName, __deps),
                allowReturnToRouter: false,
            }),
            uiAPI,
            undefined,
            { allowReturnToRouter: false },
        );
        return { ok: true };
    } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        uiAPI.appendSystemMessage(`${slicerDisplay} failed: ${error}`, true, "Harns");
        return { ok: false, error };
    }
}

/**
 * Run the legacy one-shot task-table Slicer for non-Epic PROJECT plans.
 *
 * @param {Parameters<typeof runSlicerAgent>[0]} opts
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function runLegacyTaskSlicer({ planName, triageMeta, uiAPI, sessionManager, __deps }) {
    if (!uiAPI) throw new Error("runLegacyTaskSlicer: uiAPI is required");
    const session = __deps?.runAgentSession || runAgentSession;
    const loadSlicerDef = __deps?.loadAgentDefFromPath || loadAgentDefFromPath;
    const ensurePromptFile = __deps?.ensureBundledAgentDefFile || ensureBundledAgentDefFile;
    const slicerPromptPath = await ensurePromptFile(join(WORKFLOW_PROMPTS_DIR, LEGACY_SLICER_PROMPT_FILE));
    const slicerAgentDef = await loadSlicerDef(slicerPromptPath, { agentName: AGENTS.SLICER });

    try {
        await session({
            agentName: AGENTS.SLICER,
            userRequest: buildLegacySlicerRequest(planName, triageMeta),
            triageMeta,
            uiAPI,
            sessionManager,
            _agentDefOverride: slicerAgentDef,
        });
        return { ok: true };
    } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        uiAPI.appendSystemMessage(`${slicerAgentDef.displayName} failed: ${error}`, true, "Harns");
        return { ok: false, error };
    }
}

/**
 * @param {string} planName
 * @param {import('../../tools/plan-written.js').TriageMeta | undefined} triageMeta
 * @returns {string}
 */
function buildLegacySlicerRequest(planName, triageMeta) {
    const lines = [
        `## Slice Plan: ${planName}`,
        "",
        `The architect has finished a design-only plan at plans/${planName}.md. The user approved the design.`,
        "Your job: read the plan, then append a Tasks section and per-slice detail blocks using the edit tool.",
        "Follow the slicer tasks format file referenced in your system prompt exactly.",
        "",
    ];
    if (triageMeta) {
        lines.push("## Triage Report");
        if (triageMeta.classification) lines.push(`- Classification: ${triageMeta.classification}`);
        if (triageMeta.complexity) lines.push(`- Complexity: ${triageMeta.complexity}`);
        if (triageMeta.summary) lines.push(`- Summary: ${triageMeta.summary}`);
        if (triageMeta.affectedPaths?.length) lines.push(`- Affected paths: ${triageMeta.affectedPaths.join(", ")}`);
        lines.push("");
    }
    lines.push(
        "Apply the self-check rules in your system prompt before editing. End your turn after the edit — do not " +
            "generate further text.",
    );
    return lines.join("\n");
}

/**
 * Ensure a PROJECT plan is ready after approval.
 *
 * Epic PROJECT plans use interactive decomposition and do not need or validate
 * legacy task tables. Non-Epic PROJECT plans retain the legacy task-table
 * slicer for compatibility only.
 *
 * @param {Object} opts
 * @param {string} opts.planName
 * @param {string} opts.planPath - Absolute path to the plan markdown file.
 * @param {import('../../tools/plan-written.js').TriageMeta} [opts.triageMeta]
 * @param {import('../ui/types.js').UiAPI} opts.uiAPI
 * @param {import('@earendil-works/pi-coding-agent').SessionManager} [opts.sessionManager]
 * @param {{
 *   runSlicerAgent?: typeof runSlicerAgent | typeof runLegacyTaskSlicer,
 *   readTextFile?: (path: string) => Promise<string>,
 *   parsePlanFrontMatter?: typeof parsePlanFrontMatter,
 *   extractTasks?: typeof extractTasks,
 *   validateProjectTasks?: typeof validateProjectTasks,
 * }} [opts.__deps] - Test-only injection point.
 * @returns {Promise<{ ok: true, slicerInvoked: boolean } | { ok: false, error: string, stage: "slicer" | "validation" }>}
 */
export async function ensureSlicerTasks({ planName, planPath, triageMeta, uiAPI, sessionManager, __deps }) {
    if (!uiAPI) throw new Error("ensureSlicerTasks: uiAPI is required");
    const slicer = __deps?.runSlicerAgent || runSlicerAgent;
    const legacySlicer = __deps?.runSlicerAgent || runLegacyTaskSlicer;
    const readTextFile = __deps?.readTextFile || Deno.readTextFile.bind(Deno);
    const parsePlan = __deps?.parsePlanFrontMatter || parsePlanFrontMatter;
    const parseTasks = __deps?.extractTasks || extractTasks;
    const validateTasks = __deps?.validateProjectTasks || validateProjectTasks;

    /**
     * @param {typeof runSlicerAgent | typeof runLegacyTaskSlicer} runner
     * @param {import('../../tools/plan-written.js').TriageMeta | undefined} meta
     * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
     */
    async function invokeSlicer(runner, meta) {
        try {
            const result = await runner({ planName, triageMeta: meta, uiAPI, sessionManager });
            if (!result.ok) return { ok: false, error: result.error || "slicer failed" };
            return { ok: true };
        } catch (e) {
            const error = e instanceof Error ? e.message : String(e);
            return { ok: false, error };
        }
    }

    if (triageMeta && isEpicPlan(triageMeta)) {
        const slicerResult = await invokeSlicer(slicer, triageMeta);
        if (!slicerResult.ok) return { ok: false, error: slicerResult.error, stage: "slicer" };
        return { ok: true, slicerInvoked: true };
    }

    let currentMd = "";
    let currentPlan;
    try {
        currentMd = await readTextFile(planPath);
        currentPlan = parsePlan(currentMd);
    } catch {
        // Cannot inspect persisted plan metadata; continue through the legacy compatibility path below.
    }

    if (currentPlan && isEpicPlan(currentPlan.attrs)) {
        const slicerResult = await invokeSlicer(slicer, currentPlan.attrs);
        if (!slicerResult.ok) return { ok: false, error: slicerResult.error, stage: "slicer" };
        return { ok: true, slicerInvoked: true };
    }

    try {
        validateTasks(parseTasks(currentMd));
        return { ok: true, slicerInvoked: false };
    } catch {
        // Tasks missing or unparseable; legacy task-table slicer must run.
    }

    const slicerResult = await invokeSlicer(legacySlicer, triageMeta);
    if (!slicerResult.ok) {
        return { ok: false, error: slicerResult.error, stage: "slicer" };
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
