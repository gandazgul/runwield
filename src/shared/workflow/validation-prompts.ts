/**
 * @module shared/workflow/validation-prompts
 *
 * Loading the bundled prompts Workflow Validation runs on: the Reviewer,
 * the Reviewer-Feedback Engineer, and the manual QA checklist.
 */

import { SUBAGENTS } from "../../constants.js";
import { loadSubAgentDefinition } from "../session/subagent-definitions.ts";
import type { AgentDefinition } from "../session/types.js";

interface AgentPathLoadOptions {
    agentName?: string;
}

type PromptFileResolver = (relativePath: string) => Promise<string>;
type AgentDefinitionPathLoader = (filePath: string, options?: AgentPathLoadOptions) => Promise<AgentDefinition>;

/**
 * Load reviewer as a bare workflow prompt instead of a normal agent definition.
 * Normal agent definitions are wrapped with RunWield' shared system prompt, which
 * advertises skills, memory, and exploration tools. Semantic review is a
 * mechanical plan-vs-diff check, so it intentionally receives none of that by default.
 *
 * Every review gets the plan, read-only repository exploration tools (`read`,
 * `grep`, `find`, `ls`), and the `review_diff` tool. The diff is never inlined —
 * there is one delivery path for every round regardless of size. Reviewer has no
 * memory tools so its judgment remains grounded in the supplied evidence.
 *
 * `mode` selects the round contract: `"discovery"` sweeps the whole Plan (rounds
 * one and two), `"verify"` only checks the open ledger and the repair delta
 * (rounds three and above).
 *
 * @param {"discovery" | "verify"} [mode]
 * @param {(path: string) => Promise<string>} [readTextFile]
 * @param {PromptFileResolver} [ensurePromptFile]
 * @returns {Promise<import('../session/types.js').AgentDefinition>}
 */
export async function loadReviewerPrompt(
    mode: "discovery" | "verify" = "discovery",
    readTextFile: (path: string) => Promise<string> = Deno.readTextFile,
    ensurePromptFile?: PromptFileResolver,
) {
    return await loadSubAgentDefinition(SUBAGENTS.REVIEWER, {
        reviewerMode: mode,
        readTextFile,
        ensurePromptFile,
    });
}

/**
 * Load the Reviewer-Feedback Engineer definition.
 *
 * Unlike the Reviewer, this is a real execution agent and receives the full
 * shared system prompt via the subagent definition registry. Workflow Validation
 * dispatches it — a user never selects it, so it must stay out of `/agent`
 * listings and `return_to_router` targets.
 *
 * @param {PromptFileResolver} [ensurePromptFile]
 * @param {AgentDefinitionPathLoader} [loadFromPath]
 * @returns {Promise<import('../session/types.js').AgentDefinition>}
 */
export async function loadReviewerFeedbackEngineerDef(
    ensurePromptFile?: PromptFileResolver,
    loadFromPath?: AgentDefinitionPathLoader,
) {
    return await loadSubAgentDefinition(SUBAGENTS.REVIEWER_FEEDBACK_ENGINEER, {
        ensurePromptFile,
        loadFromPath,
    });
}

/**
 * Load the post-verification Manual QA generator as a bare, tool-free prompt.
 *
 * @param {(path: string) => Promise<string>} [readTextFile]
 * @param {PromptFileResolver} [ensurePromptFile]
 * @returns {Promise<import('../session/types.js').AgentDefinition>}
 */
export async function loadManualQaPrompt(
    readTextFile: (path: string) => Promise<string> = Deno.readTextFile,
    ensurePromptFile?: PromptFileResolver,
) {
    return await loadSubAgentDefinition(SUBAGENTS.MANUAL_QA, {
        readTextFile,
        ensurePromptFile,
    });
}
