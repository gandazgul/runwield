/**
 * @module shared/session/agents
 * Agent discovery — scans agent definitions (bundled + overrides) and returns merged metadata.
 */

import { basename, dirname, fromFileUrl, join } from "@std/path";
import { extractYaml, test as hasFrontMatter } from "@std/front-matter";
import { AGENT_DEFS_DIR, CWD, HOME_DIR } from "../../constants.js";
import { directoryExists, fileExists } from "../helpers.js";
import { PROTECTED_TOOL_NAMES } from "../../tools/registry.js";

const HOME_AGENT_DEFS_DIR = HOME_DIR ? join(HOME_DIR, ".hns", "agents") : null;
const LOCAL_AGENT_DEFS_DIR = join(CWD, ".hns", "agents");

export const __dirname = dirname(fromFileUrl(import.meta.url));

// TODO: insert these reminders after the user request when calling agents. This will remind smaller models or models without a system prompt field of their core role and make them <hopefully> pay attention.
// @ts-ignore
const AGENT_REMINDERS = {
    router:
        "\n\n[CRITICAL REMINDER: You are the Router. You must evaluate the request and immediately call the `triage_report` tool. Do not converse with the user or write code.]",
    operator:
        "\n\n[CRITICAL REMINDER: You are the Operator. Your job is to execute this QUICK_FIX directly. Modify the code, verify your changes using the project's test command, and keep your text output brief.]",
    planner:
        "\n\n[CRITICAL REMINDER: You are the Planner. Write a standard Markdown plan in the `plans/` directory. Once the file is saved, you MUST end your turn by calling the `plan_written` tool.]",
    architect:
        "\n\n[CRITICAL REMINDER: You are the Architect. You must either ask EXACTLY ONE clarification question, OR write a strict PROJECT plan with a DAG task table. Do not write implementation code. Call `plan_written` when done.]",
    engineer:
        "\n\n[CRITICAL REMINDER: You are the Engineer. Use the Zero-Trust Protocol: verify all exports and APIs with your AST tools before using them. After writing the code, you MUST run the verification command to prove it compiles before finishing.]",
    reviewer:
        "\n\n[CRITICAL REMINDER: You are the Semantic Reviewer. Compare the git diff against the plan. Output exactly the word 'APPROVED' if all requirements are met, otherwise output ONLY a bulleted list of missing requirements.]",
    init:
        "\n\n[CRITICAL REMINDER: You are the Init Agent. Do NOT modify source code. Your only job is to explore, write the `CONTEXT.md` file, store core memories, and save the CI command to settings.]",
    slicer:
        "\n\n[CRITICAL REMINDER: You are the Slicer. Read the plan and use the edit tool to insert the Tasks and Slice Details sections. Ensure all tasks are vertical slices (tracer bullets). End your turn immediately after editing.]",
    doc_writer:
        "\n\n[CRITICAL REMINDER: You are the Doc Writer. You are STRICTLY LIMITED to writing and editing `.md` files. Do not modify implementation code or write tests. Execute only your specific assigned task, ensure accuracy against the codebase, and then halt.]",
    tester:
        "\n\n[CRITICAL REMINDER: You are the Tester. Execute ONLY your assigned task. You MUST run the tests using `bash` to prove they pass—narrations are not allowed. If the feature implementation is fundamentally broken, DO NOT rewrite it; report the exact failure and halt. Use the Zero-Trust Protocol for all imports.]",
};

/**
 * @returns {string[]}
 */
function getAgentDefLayerDirs() {
    return [
        AGENT_DEFS_DIR,
        ...(HOME_AGENT_DEFS_DIR ? [HOME_AGENT_DEFS_DIR] : []),
        LOCAL_AGENT_DEFS_DIR,
    ];
}

/**
 * @returns {string[]}
 */
function getAgentDefDirsByPriority() {
    return [
        LOCAL_AGENT_DEFS_DIR,
        ...(HOME_AGENT_DEFS_DIR ? [HOME_AGENT_DEFS_DIR] : []),
        AGENT_DEFS_DIR,
    ];
}

/**
 * Resolve an existing agent definitions directory for pi-coding-agent resource loading.
 * Priority: local (`.hns/agents`) > home (`~/.hns/agents`) > bundled defaults.
 *
 * @returns {Promise<string>}
 */
export async function resolveAgentDefsDir() {
    for (const dir of getAgentDefDirsByPriority()) {
        if (await directoryExists(dir)) return dir;
    }

    throw new Error(
        [
            "Could not find any agent defs directory.",
            `Tried local: ${LOCAL_AGENT_DEFS_DIR}`,
            ...(HOME_AGENT_DEFS_DIR ? [`Tried home: ${HOME_AGENT_DEFS_DIR}`] : []),
            `Tried bundled: ${AGENT_DEFS_DIR}`,
        ].join(" "),
    );
}

/**
 * List all known agent definition names across bundled + home + local layers.
 *
 * @returns {Promise<string[]>}
 */
export async function listAgentDefNames() {
    const names = new Set();

    for (const dir of getAgentDefLayerDirs()) {
        if (!(await directoryExists(dir))) continue;
        for await (const entry of Deno.readDir(dir)) {
            if (!entry.isFile || !entry.name.endsWith(".md")) continue;
            names.add(entry.name.replace(/\.md$/, ""));
        }
    }

    return [...names].sort((a, b) => a.localeCompare(b));
}

/**
 * Normalize unknown tool list input into a deduped array of non-empty strings.
 *
 * @param {unknown} tools
 * @returns {string[]}
 */
function normalizeToolNames(tools) {
    if (!Array.isArray(tools)) return [];

    /** @type {string[]} */
    const normalized = [];

    for (const tool of tools) {
        const toolName = typeof tool === "string" ? tool.trim() : "";
        if (!toolName) continue;
        if (!normalized.includes(toolName)) normalized.push(toolName);
    }

    return normalized;
}

/**
 * Resolve final requested tool names for a session while enforcing agent policy.
 *
 * - `toolNames` may narrow the agent's tool set but cannot add tools outside `agentTools`.
 * - `customToolNames` are always added (for user-provided dynamic/extension tools).
 *
 * @param {string[]} agentTools
 * @param {unknown} toolNames
 * @param {unknown} customToolNames
 * @returns {string[]}
 */
export function resolveSessionToolNames(agentTools, toolNames, customToolNames) {
    const normalizedAgentTools = normalizeToolNames(agentTools);
    const selectedToolNames = normalizeToolNames(toolNames || normalizedAgentTools);
    const normalizedCustomToolNames = normalizeToolNames(customToolNames);
    const allowedToolNames = new Set(normalizedAgentTools);

    /** @type {string[]} */
    const tools = [];
    for (const toolName of selectedToolNames) {
        if (!allowedToolNames.has(toolName)) continue;
        if (!tools.includes(toolName)) tools.push(toolName);
    }
    for (const toolName of normalizedCustomToolNames) {
        if (!tools.includes(toolName)) tools.push(toolName);
    }

    return tools;
}

/**
 * List all available merged agent definitions.
 *
 * @returns {Promise<import('./types.js').AgentDefinition[]>}
 */
export async function listAvailableAgents() {
    const names = await listAgentDefNames();
    /** @type {import('./types.js').AgentDefinition[]} */
    const agents = [];

    for (const name of names) {
        try {
            const def = await loadAgentDef(name);
            agents.push(def);
        } catch (err) {
            // Surface malformed agent definitions instead of silently dropping them.
            console.error(
                `[Harns] Skipping agent "${name}": ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }

    agents.sort((agentA, agentB) => agentA.name.localeCompare(agentB.name));

    return agents;
}

/**
 * Load and merge an agent definition from one or more layered files in priority
 * order (lowest → highest). Missing paths are skipped; if none exist, throws.
 *
 * Higher layers override scalar attrs. Prompt body appends by default; if a
 * layer sets `promptOverride: true`, lower-layer prompt content is discarded.
 * Tool lists are replaced when a higher layer defines `tools`. Tools declared
 * in the lowest existing layer are treated as "bundled" for protected-tool
 * enforcement (always re-added even if a higher layer narrows the list).
 *
 * @param {string} agentName - the file name to load (without .md)
 * @param {string[]} filePaths - Paths to attempt, ordered low → high priority
 * @returns {Promise<import('./types.js').AgentDefinition>}
 */
async function loadAgentDefFromPaths(agentName, filePaths) {
    /** @type {{ name?: string, model?: string, description?: string, promptOverride?: boolean, tools?: unknown[], [key: string]: unknown }} */
    let mergedAttrs = {};
    /** @type {string[]} */
    let mergedTools = [];
    /** @type {string[]} */
    let bundledTools = [];
    let bundledToolsSet = false;
    /** @type {string[]} */
    let promptSegments = [];
    let found = false;

    for (const filePath of filePaths) {
        if (!(await fileExists(filePath))) continue;

        const raw = await Deno.readTextFile(filePath);
        if (!hasFrontMatter(raw)) {
            throw new Error(`Agent def ${filePath} has no frontmatter`);
        }

        const { attrs, body } = extractYaml(raw);
        found = true;

        if (Object.prototype.hasOwnProperty.call(attrs, "tools")) {
            const normalized = normalizeToolNames(attrs.tools);
            if (!bundledToolsSet) {
                bundledTools = normalized;
                bundledToolsSet = true;
            }
            mergedTools = normalized;
        }

        mergedAttrs = { ...mergedAttrs, ...attrs };

        if (attrs.promptOverride === true) {
            promptSegments = [];
        }

        const trimmedBody = body.trim();
        if (trimmedBody) promptSegments.push(trimmedBody);
    }

    if (!found) {
        throw new Error(
            `Could not find agent def for "${agentName}". Checked: ${filePaths.join(", ")}`,
        );
    }

    const displayName = typeof mergedAttrs.name === "string" && mergedAttrs.name.trim()
        ? mergedAttrs.name.trim()
        : agentName;
    const model = typeof mergedAttrs.model === "string" && mergedAttrs.model.trim() ? mergedAttrs.model.trim() : "";
    const description = typeof mergedAttrs.description === "string" ? mergedAttrs.description.trim() : "";

    const mergedPromptBody = promptSegments.join("\n\n").trim();
    const CORE_SYSTEM_PROMPT = await Deno.readTextFile(join(__dirname, "SYSTEM_PROMPT_TEMPLATE.md"));
    const systemPrompt = CORE_SYSTEM_PROMPT.replace("{{AGENT_PROMPT}}", mergedPromptBody);

    const protectedToolsForAgent = bundledTools.filter((toolName) => PROTECTED_TOOL_NAMES.includes(toolName));
    const tools = [...mergedTools];
    for (const toolName of protectedToolsForAgent) {
        if (!tools.includes(toolName)) tools.push(toolName);
    }

    return {
        name: agentName,
        displayName,
        model,
        description,
        tools,
        systemPrompt,
    };
}

/**
 * Load and merge an agent definition by name from layered files:
 * 1) bundled: `src/agent-definitions/<name>.md`
 * 2) home override: `~/.hns/agents/<name>.md`
 * 3) local override: `<cwd>/.hns/agents/<name>.md`
 *
 * @param {string} agentName
 * @returns {Promise<import('./types.js').AgentDefinition>}
 */
export function loadAgentDef(agentName) {
    const filePaths = getAgentDefLayerDirs().map((dir) => join(dir, `${agentName}.md`));

    return loadAgentDefFromPaths(agentName, filePaths);
}

/**
 * Load an agent definition from an arbitrary file path.
 * Used for special agents (like init) that live outside the standard
 * agent-defs directories and should not be discoverable via /agent listings.
 *
 * @param {string} filePath - Absolute path to the agent .md file
 * @returns {Promise<import('./types.js').AgentDefinition>}
 */
export function loadAgentDefFromPath(filePath) {
    return loadAgentDefFromPaths(basename(filePath, ".md"), [filePath]);
}
