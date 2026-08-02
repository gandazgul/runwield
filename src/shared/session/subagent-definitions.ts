/**
 * @module shared/session/subagent-definitions
 *
 * Typed loader for hidden workflow-dispatched subagent definitions.
 */

import { extractYaml } from "@std/front-matter";
import { join } from "@std/path";
import { AGENT_DEFS_DIR, AGENTS, SUBAGENTS } from "../../constants.js";
import { ensureBundledAgentDefFile } from "./agent-assets.js";
import { loadAgentDefFromPath } from "./agents.js";
import type { AgentDefinition } from "./types.js";

const SUBAGENT_DEFINITIONS_DIR = "subagent-definitions";
const DELEGATED_PROMPT_FILE = "delegated-agent-prompt.md";
const INIT_PROMPT_FILE = "init-agent-prompt.md";
const MANUAL_QA_PROMPT_FILE = "manual-qa-prompt.md";
const REVIEWER_FEEDBACK_ENGINEER_FILE = "reviewer-feedback-engineer.md";
const REVIEWER_PROMPT_FILE = "reviewer-prompt.md";
const REVIEWER_VERIFY_PROMPT_FILE = "reviewer-verify-prompt.md";
const SLICER_PROMPT_FILE = "slicer-prompt.md";

export type ReviewerSubAgentMode = "discovery" | "verify";
export type SubAgentDefinitionLoadMode = "barePrompt" | "fullAgent";
export type SubAgentDefinitionId = typeof SUBAGENTS[keyof typeof SUBAGENTS];

type PromptFrontMatterValue = string | number | boolean | string[] | null;
type PromptFrontMatterAttrs = Partial<Record<string, PromptFrontMatterValue>>;

export interface ParsedPromptFrontMatter {
    attrs: PromptFrontMatterAttrs;
    body: string;
}

export interface SubAgentDefinition {
    id: SubAgentDefinitionId;
    agentName: string;
    displayNameFallback: string;
    loadMode: SubAgentDefinitionLoadMode;
    file: string;
    verifyFile?: string;
}

export interface LoadSubAgentDefinitionOptions {
    reviewerMode?: ReviewerSubAgentMode;
    readTextFile?: (path: string) => Promise<string>;
    ensurePromptFile?: typeof ensureBundledAgentDefFile;
    loadFromPath?: typeof loadAgentDefFromPath;
}

export const SUBAGENT_DEFINITIONS: Readonly<Record<SubAgentDefinitionId, SubAgentDefinition>> = Object.freeze({
    [SUBAGENTS.DELEGATED]: Object.freeze({
        id: SUBAGENTS.DELEGATED,
        agentName: AGENTS.DELEGATED,
        displayNameFallback: "Delegated Agent",
        loadMode: "barePrompt",
        file: DELEGATED_PROMPT_FILE,
    }),
    [SUBAGENTS.INIT]: Object.freeze({
        id: SUBAGENTS.INIT,
        agentName: AGENTS.INIT,
        displayNameFallback: "Init",
        loadMode: "fullAgent",
        file: INIT_PROMPT_FILE,
    }),
    [SUBAGENTS.MANUAL_QA]: Object.freeze({
        id: SUBAGENTS.MANUAL_QA,
        agentName: AGENTS.OPERATOR,
        displayNameFallback: "Manual QA",
        loadMode: "barePrompt",
        file: MANUAL_QA_PROMPT_FILE,
    }),
    [SUBAGENTS.REVIEWER]: Object.freeze({
        id: SUBAGENTS.REVIEWER,
        agentName: AGENTS.REVIEWER,
        displayNameFallback: "Reviewer",
        loadMode: "barePrompt",
        file: REVIEWER_PROMPT_FILE,
        verifyFile: REVIEWER_VERIFY_PROMPT_FILE,
    }),
    [SUBAGENTS.REVIEWER_FEEDBACK_ENGINEER]: Object.freeze({
        id: SUBAGENTS.REVIEWER_FEEDBACK_ENGINEER,
        agentName: AGENTS.REVIEWER_FEEDBACK_ENGINEER,
        displayNameFallback: "Reviewer-Feedback Engineer",
        loadMode: "fullAgent",
        file: REVIEWER_FEEDBACK_ENGINEER_FILE,
    }),
    [SUBAGENTS.SLICER]: Object.freeze({
        id: SUBAGENTS.SLICER,
        agentName: AGENTS.SLICER,
        displayNameFallback: "Slicer",
        loadMode: "fullAgent",
        file: SLICER_PROMPT_FILE,
    }),
});

function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecoverableBundledPromptReadError(error: Error) {
    return error instanceof Deno.errors.NotFound ||
        (error instanceof TypeError && /Unexpected end of input|Prompt file was empty/i.test(error.message)) ||
        error.message.startsWith("Bundled agent asset is missing:");
}

function normalizeBundledPromptFrontMatter(parsed: ParsedPromptFrontMatter): ParsedPromptFrontMatter {
    const sourceAttrs = parsed.attrs && typeof parsed.attrs === "object" ? parsed.attrs : {};
    const attrs: PromptFrontMatterAttrs = {};
    for (const [key, value] of Object.entries(sourceAttrs)) {
        if (
            typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null ||
            (Array.isArray(value) && value.every((item) => typeof item === "string"))
        ) {
            attrs[key] = value;
        }
    }
    return { attrs, body: typeof parsed.body === "string" ? parsed.body : "" };
}

function subagentRelativePath(definition: SubAgentDefinition, reviewerMode: ReviewerSubAgentMode) {
    const file = definition.id === SUBAGENTS.REVIEWER && reviewerMode === "verify" && definition.verifyFile
        ? definition.verifyFile
        : definition.file;
    return join(SUBAGENT_DEFINITIONS_DIR, file);
}

async function readBundledPromptFrontMatter(
    relativePath: string,
    readTextFile: (path: string) => Promise<string>,
    ensurePromptFile: typeof ensureBundledAgentDefFile,
) {
    let lastError: Error = new Error("Bundled prompt read failed.");
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            const promptPath = await ensurePromptFile(relativePath);
            const raw = await readTextFile(promptPath);
            if (!raw.trim()) throw new TypeError("Prompt file was empty during bundled prompt load");
            return normalizeBundledPromptFrontMatter(extractYaml<PromptFrontMatterAttrs>(raw));
        } catch (error) {
            if (!(error instanceof Error)) throw error;
            lastError = error;
            if (!isRecoverableBundledPromptReadError(error)) throw error;
            if (attempt < 2) await delay(10 * (attempt + 1));
        }
    }
    if (!isRecoverableBundledPromptReadError(lastError)) throw lastError;
    return normalizeBundledPromptFrontMatter(
        extractYaml<PromptFrontMatterAttrs>(await Deno.readTextFile(join(AGENT_DEFS_DIR, relativePath))),
    );
}

async function loadBarePromptDefinition(
    definition: SubAgentDefinition,
    relativePath: string,
    options: LoadSubAgentDefinitionOptions,
): Promise<AgentDefinition> {
    const readTextFile = options.readTextFile || Deno.readTextFile;
    const ensurePromptFile = options.ensurePromptFile || ensureBundledAgentDefFile;
    const { attrs, body } = await readBundledPromptFrontMatter(relativePath, readTextFile, ensurePromptFile);
    const displayName = typeof attrs.name === "string" && attrs.name.trim()
        ? attrs.name.trim()
        : definition.displayNameFallback;
    const description = typeof attrs.description === "string" ? attrs.description.trim() : "";

    return {
        name: definition.agentName,
        displayName,
        model: "",
        description,
        tools: [],
        systemPrompt: body.trim(),
    };
}

async function loadFullAgentDefinition(
    definition: SubAgentDefinition,
    relativePath: string,
    options: LoadSubAgentDefinitionOptions,
): Promise<AgentDefinition> {
    const ensurePromptFile = options.ensurePromptFile || ensureBundledAgentDefFile;
    const loadFromPath = options.loadFromPath || loadAgentDefFromPath;
    const promptPath = await ensurePromptFile(relativePath);
    return await loadFromPath(promptPath, { agentName: definition.agentName });
}

export async function loadSubAgentDefinition(
    id: SubAgentDefinitionId,
    options: LoadSubAgentDefinitionOptions = {},
): Promise<AgentDefinition> {
    const definition = SUBAGENT_DEFINITIONS[id];
    if (!definition) throw new Error(`Unknown subagent definition: ${id}`);
    const reviewerMode = options.reviewerMode || "discovery";
    const relativePath = subagentRelativePath(definition, reviewerMode);

    if (definition.loadMode === "barePrompt") {
        return await loadBarePromptDefinition(definition, relativePath, options);
    }
    return await loadFullAgentDefinition(definition, relativePath, options);
}
