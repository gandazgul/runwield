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

const CHILD_DESCRIPTOR_SCHEMA = Type.Object({
    title: Type.String({ description: "Child FEATURE title." }),
    order: Type.Number({ description: "1-based integer execution order from the agreed slice sequence." }),
    summary: Type.String({ description: "Brief child FEATURE summary." }),
    dependencies: Type.Array(Type.String(), { description: "Child plan dependencies, if any." }),
    affectedPaths: Type.Array(Type.String(), { description: "Expected affected paths." }),
    frontend: Type.Optional(
        Type.Boolean({ description: "True when this child FEATURE includes frontend UI/UX work." }),
    ),
    devServerCommand: Type.Optional(Type.String({
        description: "Dev or preview command to run for browser verification, if known.",
    })),
    devServerUrl: Type.Optional(Type.String({
        description: "Local URL to open for browser verification, if known.",
    })),
    devServerHmr: Type.Optional(Type.Boolean({
        description: "Whether the dev server is expected to support hot module reload.",
    })),
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
 * @param {{ loadPlan?: typeof loadPlan, findPlansByParent?: typeof findPlansByParent, recordPlanEvent?: typeof recordPlanEvent, materializeSlicerDraft?: typeof materializeSlicerDraft }} [opts.__deps]
 * @returns {import('@earendil-works/pi-coding-agent').ToolDefinition}
 */
export function createSlicerFinalizeTool({ planName, cwd = CWD, __deps }) {
    const loadPlanImpl = __deps?.loadPlan || loadPlan;
    const findChildren = __deps?.findPlansByParent || findPlansByParent;
    const recordEvent = __deps?.recordPlanEvent || recordPlanEvent;
    const materialize = __deps?.materializeSlicerDraft || materializeSlicerDraft;
    return defineTool({
        name: "slicer_finalize_decomposition",
        label: "Finalize Epic Decomposition",
        description:
            "Materialize child FEATURE draft plans and finalize the current Epic decomposition after explicit user confirmation.",
        parameters: Type.Object({
            children: Type.Optional(Type.Array(CHILD_DESCRIPTOR_SCHEMA, {
                description: "Child FEATURE plan descriptors to create or update before finalizing.",
            })),
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
                if (
                    epic.attrs.status !== "approved" && epic.attrs.status !== "ready_for_decomposition" &&
                    epic.attrs.status !== "ready_for_work"
                ) {
                    throw new Error(
                        `Cannot finalize Epic from status "${epic.attrs.status}". Expected approved or ready_for_decomposition.`,
                    );
                }

                const childDescriptors = /** @type {import('../../plan-store.js').ChildFeaturePlanDescriptor[]} */
                    (params.children || []);
                const writeResults = childDescriptors.length === 0
                    ? []
                    : await materialize({ cwd, epicPlanName: planName, children: childDescriptors });

                const children = (await findChildren(cwd, planName)).filter((child) =>
                    child.attrs.classification === "FEATURE"
                );
                if (children.length === 0) {
                    throw new Error("At least one child FEATURE plan is required to finalize decomposition.");
                }

                const childNames = children.map((child) => child.name);
                const writeSummary = writeResults.length === 0
                    ? "No child FEATURE drafts were written."
                    : writeResults.map((result) => `${result.action}: ${result.name}`).join("\n");

                if (epic.attrs.status === "ready_for_work") {
                    return {
                        content: [{
                            type: "text",
                            text:
                                `${writeSummary}\nEpic already ready_for_work with ${children.length} child FEATURE plan(s).`,
                        }],
                        details: { status: "ready_for_work", children: childNames, writeResults, error: "" },
                    };
                }

                const updated = await recordEvent({
                    cwd,
                    planName,
                    event: "decomposition_finalized",
                    currentStatus: /** @type {import('./plan-lifecycle.js').PlanStatus} */ (epic.attrs.status),
                    details: { triageMeta: epic.attrs },
                });
                return {
                    content: [{
                        type: "text",
                        text: `${writeSummary}\nFinalized Epic decomposition: ${planName} is ready_for_work.`,
                    }],
                    details: { status: updated.status, children: childNames, writeResults, error: "" },
                };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return {
                    content: [{ type: "text", text: formatToolError(message) }],
                    details: { status: "error", children: [], writeResults: [], error: message },
                };
            }
        },
    });
}

/**
 * @param {{ name: string, attrs: import('../../plan-store.js').PlanFrontMatter }} child
 * @returns {{ name: string, order: number | undefined, status: string | undefined, summary: string | undefined, dependencies: string[], affectedPaths: string[] }}
 */
function summarizeChild(child) {
    return {
        name: child.name,
        order: child.attrs.order,
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
 *   createSlicerFinalizeTool?: typeof createSlicerFinalizeTool,
 * }} [deps]
 * @returns {import('@earendil-works/pi-coding-agent').ToolDefinition[]}
 */
function createSlicerCustomTools(planName, deps) {
    const makeFinalizeTool = deps?.createSlicerFinalizeTool || createSlicerFinalizeTool;
    return [makeFinalizeTool({ planName })];
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
        uiAPI.appendSystemMessage(`${slicerDisplay} failed: ${error}`, true, "RunWield");
        return { ok: false, error };
    }
}

/**
 * Ensure a PROJECT plan is ready after approval.
 *
 * PROJECT Epic plans use interactive decomposition. Non-Epic PROJECT plans
 * with valid inline task tables are accepted without slicing. All other
 * PROJECT plans are invalid — the architect must add `type: "epic"` to the
 * front matter or embed valid Tasks sections.
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
 *   parsePlanFrontMatter?: typeof parsePlanFrontMatter,
 *   extractTasks?: typeof extractTasks,
 *   validateProjectTasks?: typeof validateProjectTasks,
 * }} [opts.__deps] - Test-only injection point.
 * @returns {Promise<{ ok: true, slicerInvoked: boolean } | { ok: false, error: string, stage: "slicer" | "validation" }>}
 */
export async function ensureSlicerTasks({ planName, planPath, triageMeta, uiAPI, sessionManager, __deps }) {
    if (!uiAPI) throw new Error("ensureSlicerTasks: uiAPI is required");
    const slicer = __deps?.runSlicerAgent || runSlicerAgent;
    const readTextFile = __deps?.readTextFile || Deno.readTextFile.bind(Deno);
    const parsePlan = __deps?.parsePlanFrontMatter || parsePlanFrontMatter;
    const parseTasks = __deps?.extractTasks || extractTasks;
    const validateTasks = __deps?.validateProjectTasks || validateProjectTasks;

    /**
     * @param {import('../../tools/plan-written.js').TriageMeta | undefined} meta
     * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
     */
    async function invokeSlicer(meta) {
        try {
            const result = await slicer({ planName, triageMeta: meta, uiAPI, sessionManager });
            if (!result.ok) return { ok: false, error: result.error || "slicer failed" };
            return { ok: true };
        } catch (e) {
            const error = e instanceof Error ? e.message : String(e);
            return { ok: false, error };
        }
    }

    // Epic — invoke interactive slicer
    if (triageMeta && isEpicPlan(triageMeta)) {
        const result = await invokeSlicer(triageMeta);
        if (!result.ok) return { ok: false, error: result.error, stage: "slicer" };
        return { ok: true, slicerInvoked: true };
    }

    // Read and parse plan file
    let currentMd = "";
    let currentPlan;
    try {
        currentMd = await readTextFile(planPath);
        currentPlan = parsePlan(currentMd);
    } catch {
        // fall through to validation / error below
    }

    // Epic — invoke interactive slicer
    if (currentPlan && isEpicPlan(currentPlan.attrs)) {
        const result = await invokeSlicer(currentPlan.attrs);
        if (!result.ok) return { ok: false, error: result.error, stage: "slicer" };
        return { ok: true, slicerInvoked: true };
    }

    // Non-Epic PROJECT plan — valid inline task tables accepted, otherwise error
    try {
        validateTasks(parseTasks(currentMd));
        return { ok: true, slicerInvoked: false };
    } catch {
        return {
            ok: false,
            error:
                `Plan "${planName}" has classification PROJECT but is not an Epic (missing type: "epic") and has no valid inline Tasks section. ` +
                "Add `type: epic` to the front matter to use interactive decomposition, or embed a valid Tasks section.",
            stage: "validation",
        };
    }
}
