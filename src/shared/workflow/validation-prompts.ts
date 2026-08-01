/**
 * @module shared/workflow/validation-prompts
 *
 * Loading the bundled prompts Workflow Validation runs on: the Reviewer,
 * the Reviewer-Feedback Engineer, and the manual QA checklist.
 *
 * Reads are retried because a bundled asset can be mid-extraction on first use;
 * only the recoverable read errors are retried, and anything else is rethrown.
 */

import { extractYaml } from "@std/front-matter";
import { join } from "@std/path";
import { AGENT_DEFS_DIR, AGENTS } from "../../constants.js";
import { loadAgentDefFromPath } from "../session/agents.js";
import { ensureBundledAgentDefFile } from "../session/agent-assets.js";

const WORKFLOW_PROMPTS_DIR = "workflow-prompts";
const REVIEWER_PROMPT_FILE = "reviewer-prompt.md";
const REVIEWER_VERIFY_PROMPT_FILE = "reviewer-verify-prompt.md";
const REVIEWER_FEEDBACK_ENGINEER_FILE = "reviewer-feedback-engineer.md";
const MANUAL_QA_PROMPT_FILE = "manual-qa-prompt.md";

interface BundledPromptFrontMatter {
    attrs: Record<string, unknown>;
    body: string;
}

/** @param {unknown} error */
function isRecoverableBundledPromptReadError(error: unknown) {
    return error instanceof Deno.errors.NotFound ||
        (error instanceof TypeError && /Unexpected end of input|Prompt file was empty/i.test(error.message)) ||
        (error instanceof Error && error.message.startsWith("Bundled agent asset is missing:"));
}

/**
 * @param {unknown} parsed
 * @returns {BundledPromptFrontMatter}
 */
function normalizeBundledPromptFrontMatter(parsed: unknown) {
    if (!parsed || typeof parsed !== "object") return { attrs: {}, body: "" };
    const attrs = "attrs" in parsed && parsed.attrs && typeof parsed.attrs === "object"
        ? Object.fromEntries(Object.entries(parsed.attrs))
        : {};
    const body = "body" in parsed && typeof parsed.body === "string" ? parsed.body : "";
    return { attrs, body };
}

/**
 * @param {string} relativePath
 * @param {(path: string) => Promise<string>} readTextFile
 * @param {typeof ensureBundledAgentDefFile} ensurePromptFile
 * @returns {Promise<BundledPromptFrontMatter>}
 */
async function readBundledPromptFrontMatter(
    relativePath: string,
    readTextFile: (path: string) => Promise<string>,
    ensurePromptFile: typeof ensureBundledAgentDefFile,
) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            const promptPath = await ensurePromptFile(relativePath);
            const raw = await readTextFile(promptPath);
            if (!raw.trim()) throw new TypeError("Prompt file was empty during bundled prompt load");
            return normalizeBundledPromptFrontMatter(extractYaml(raw));
        } catch (error) {
            lastError = error;
            if (!isRecoverableBundledPromptReadError(error)) throw error;
            if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
        }
    }
    if (!isRecoverableBundledPromptReadError(lastError)) throw lastError;
    return normalizeBundledPromptFrontMatter(
        extractYaml(await Deno.readTextFile(join(AGENT_DEFS_DIR, relativePath))),
    );
}

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
 * @param {typeof ensureBundledAgentDefFile} [ensurePromptFile]
 * @returns {Promise<import('../session/types.js').AgentDefinition>}
 */
export async function loadReviewerPrompt(
    mode: "discovery" | "verify" = "discovery",
    readTextFile: (path: string) => Promise<string> = Deno.readTextFile,
    ensurePromptFile: typeof ensureBundledAgentDefFile = ensureBundledAgentDefFile,
) {
    const { attrs, body } = await readBundledPromptFrontMatter(
        join(WORKFLOW_PROMPTS_DIR, mode === "verify" ? REVIEWER_VERIFY_PROMPT_FILE : REVIEWER_PROMPT_FILE),
        readTextFile,
        ensurePromptFile,
    );
    const displayName = typeof attrs.name === "string" && attrs.name.trim() ? attrs.name.trim() : "Reviewer";
    const description = typeof attrs.description === "string" ? attrs.description.trim() : "";

    return {
        name: AGENTS.REVIEWER,
        displayName,
        model: "",
        description,
        tools: [],
        systemPrompt: body.trim(),
    };
}

/**
 * Load the Reviewer-Feedback Engineer definition.
 *
 * Unlike the Reviewer, this is a real execution agent and receives the full
 * shared system prompt via `loadAgentDefFromPath`. It lives under
 * `workflow-prompts/` rather than the top-level agent directory because
 * Workflow Validation dispatches it — a user never selects it, so it must stay
 * out of `/agent` listings and `return_to_router` targets.
 *
 * @param {typeof ensureBundledAgentDefFile} [ensurePromptFile]
 * @param {typeof loadAgentDefFromPath} [loadFromPath]
 * @returns {Promise<import('../session/types.js').AgentDefinition>}
 */
export async function loadReviewerFeedbackEngineerDef(
    ensurePromptFile: typeof ensureBundledAgentDefFile = ensureBundledAgentDefFile,
    loadFromPath: typeof loadAgentDefFromPath = loadAgentDefFromPath,
) {
    const promptPath = await ensurePromptFile(join(WORKFLOW_PROMPTS_DIR, REVIEWER_FEEDBACK_ENGINEER_FILE));
    return await loadFromPath(promptPath, { agentName: AGENTS.REVIEWER_FEEDBACK_ENGINEER });
}

/**
 * Load the post-verification Manual QA generator as a bare, tool-free prompt.
 *
 * @param {(path: string) => Promise<string>} [readTextFile]
 * @param {typeof ensureBundledAgentDefFile} [ensurePromptFile]
 * @returns {Promise<import('../session/types.js').AgentDefinition>}
 */
export async function loadManualQaPrompt(
    readTextFile: (path: string) => Promise<string> = Deno.readTextFile,
    ensurePromptFile: typeof ensureBundledAgentDefFile = ensureBundledAgentDefFile,
) {
    const { attrs, body } = await readBundledPromptFrontMatter(
        join(WORKFLOW_PROMPTS_DIR, MANUAL_QA_PROMPT_FILE),
        readTextFile,
        ensurePromptFile,
    );
    const displayName = typeof attrs.name === "string" && attrs.name.trim() ? attrs.name.trim() : "Manual QA";
    const description = typeof attrs.description === "string" ? attrs.description.trim() : "";

    return {
        name: AGENTS.OPERATOR,
        displayName,
        model: "",
        description,
        tools: [],
        systemPrompt: body.trim(),
    };
}
