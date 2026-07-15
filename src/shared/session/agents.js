/**
 * @module shared/session/agents
 * Agent discovery — scans agent definitions (bundled + overrides) and returns merged metadata.
 */

import { basename, dirname, fromFileUrl, join } from "@std/path";
import { extractYaml, test as hasFrontMatter } from "@std/front-matter";
import { AGENT_DEFS_DIR, AGENTS, HOME_DIR, SYSTEM_PROMPT_TEMPLATE_PATH } from "../../constants.js";
import { directoryExists, fileExists } from "../helpers.js";
import { PROTECTED_TOOL_NAMES } from "../../tools/registry.js";

const HOME_AGENT_DEFS_DIR = HOME_DIR ? join(HOME_DIR, ".wld", "agents") : null;

export const __dirname = dirname(fromFileUrl(import.meta.url));

export const ATTENTION_NUDGE_TURN_INTERVAL = 6;

export const _AGENT_ATTENTION_NUDGES = {
    [AGENTS.GUIDE]:
        "You are still the Guide. Stay read-only, answer direct questions concisely, and return to Router if the user asks for edits, plans, execution, or deeper ideation.",
    [AGENTS.IDEATOR]:
        "You are still the Ideator. Stay at problem and product altitude: investigate feasibility, surface overlooked consequences, prioritize consequential divergent decisions, infer low-risk solution details, batch minor preferences when input is truly needed, and use `return_to_router` for actionable implementation or planning requests.",
    [AGENTS.PLANNER]:
        "You are still the Planner. Keep refining the plan file iteratively, ask only blocking questions, and call `plan_written` with the plan name without `.md` when the plan is ready.",
    [AGENTS.ARCHITECT]:
        "You are still the Architect. Stress-test assumptions, resolve architectural decisions, write ADRs only when justified, and leave task slicing to the Slicer.",
    [AGENTS.SLICER]:
        "You are still the Slicer. Keep the conversation scoped to this Epic decomposition: propose child FEATURE boundaries, use Slicer workflow tools only when explicitly asked, and finalize only after explicit user confirmation.",
};

/**
 * @param {string | undefined} projectRoot
 * @returns {string[]}
 */
function getAgentDefLayerDirs(projectRoot) {
    return [
        AGENT_DEFS_DIR,
        ...(HOME_AGENT_DEFS_DIR ? [HOME_AGENT_DEFS_DIR] : []),
        ...(projectRoot ? [join(projectRoot, ".wld", "agents")] : []),
    ];
}

/**
 * @param {string | undefined} projectRoot
 * @returns {string[]}
 */
function getAgentDefDirsByPriority(projectRoot) {
    return [
        ...(projectRoot ? [join(projectRoot, ".wld", "agents")] : []),
        ...(HOME_AGENT_DEFS_DIR ? [HOME_AGENT_DEFS_DIR] : []),
        AGENT_DEFS_DIR,
    ];
}

/**
 * Resolve an existing agent definitions directory for pi-coding-agent resource loading.
 * Priority: local (`.wld/agents`) > home (`~/.wld/agents`) > bundled defaults.
 *
 * @param {string} [projectRoot]
 * @returns {Promise<string>}
 */
export async function resolveAgentDefsDir(projectRoot) {
    const localAgentDefsDir = projectRoot ? join(projectRoot, ".wld", "agents") : null;
    for (const dir of getAgentDefDirsByPriority(projectRoot)) {
        if (await directoryExists(dir)) return dir;
    }

    throw new Error(
        [
            "Could not find any agent defs directory.",
            ...(localAgentDefsDir ? [`Tried local: ${localAgentDefsDir}`] : []),
            ...(HOME_AGENT_DEFS_DIR ? [`Tried home: ${HOME_AGENT_DEFS_DIR}`] : []),
            `Tried bundled: ${AGENT_DEFS_DIR}`,
        ].join(" "),
    );
}

/**
 * Sync cache of display names keyed by internal agent name (filename without .md).
 * Populated as a side-effect of every `loadAgentDef*` call so callers that need a
 * display name without awaiting (for example footer rendering) can resolve one cheaply.
 *
 * @type {Map<string, string>}
 */
const displayNameCache = new Map();

/**
 * @param {string | undefined} projectRoot
 * @param {string} internalName
 * @returns {string}
 */
function displayNameCacheKey(projectRoot, internalName) {
    return `${projectRoot}\0${internalName}`;
}

/**
 * Synchronously read an agent file's frontmatter `name:` field. Used by
 * `getAgentDisplayName` when the cache is cold. The frontmatter is the only
 * source of truth — we never synthesize a display name from the internal name.
 *
 * @param {string} internalName
 * @param {string | undefined} projectRoot
 * @returns {string | null}
 */
function readDisplayNameFromFrontMatterSync(internalName, projectRoot) {
    const candidatePaths = getAgentDefDirsByPriority(projectRoot).map((dir) => join(dir, `${internalName}.md`));

    for (const filePath of candidatePaths) {
        let raw;
        try {
            raw = Deno.readTextFileSync(filePath);
        } catch {
            continue;
        }
        if (!hasFrontMatter(raw)) continue;
        const { attrs } = extractYaml(raw);
        const name = /** @type {{ name?: unknown }} */ (attrs).name;
        if (typeof name === "string" && name.trim()) {
            return name.trim();
        }
    }

    return null;
}

/**
 * Resolve an agent's display name from its definition's frontmatter `name:`
 * field. The cache is populated by `loadAgentDef*`; on miss, the file is read
 * synchronously so the frontmatter remains the single source of truth.
 *
 * Throws when the agent definition cannot be located or has no `name:` field —
 * silently inventing a display name would hide misconfiguration.
 *
 * @param {string} internalName
 * @param {string} [projectRoot]
 * @returns {string}
 */
export function getAgentDisplayName(internalName, projectRoot) {
    if (!internalName) {
        throw new Error("getAgentDisplayName: internalName is required");
    }
    const cacheKey = displayNameCacheKey(projectRoot, internalName);
    const cached = displayNameCache.get(cacheKey);
    if (cached) return cached;

    const fromFile = readDisplayNameFromFrontMatterSync(internalName, projectRoot);
    if (fromFile) {
        displayNameCache.set(cacheKey, fromFile);
        return fromFile;
    }

    if (internalName === AGENTS.SLICER) {
        displayNameCache.set(cacheKey, "Slicer");
        return "Slicer";
    }

    throw new Error(
        `getAgentDisplayName: no agent definition with a frontmatter "name:" field was found for "${internalName}". ` +
            `Searched: ${
                getAgentDefDirsByPriority(projectRoot).map((dir) => join(dir, `${internalName}.md`)).join(", ")
            }.`,
    );
}

/**
 * List all known agent definition names across bundled + home + local layers.
 *
 * @param {string} [projectRoot]
 * @returns {Promise<string[]>}
 */
export async function listAgentDefNames(projectRoot) {
    const names = new Set();

    for (const dir of getAgentDefLayerDirs(projectRoot)) {
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
 * @param {unknown} value
 * @returns {number | undefined}
 */
function normalizeTemperature(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
    if (value < 0 || value > 2) return undefined;
    return value;
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
 * @param {string} [projectRoot]
 * @returns {Promise<import('./types.js').AgentDefinition[]>}
 */
export async function listAvailableAgents(projectRoot) {
    const names = await listAgentDefNames(projectRoot);
    /** @type {import('./types.js').AgentDefinition[]} */
    const agents = [];

    for (const name of names) {
        try {
            const def = await loadAgentDef(name, projectRoot);
            agents.push(def);
        } catch (err) {
            // Surface malformed agent definitions instead of silently dropping them.
            console.error(
                `[RunWield] Skipping agent "${name}": ${err instanceof Error ? err.message : String(err)}`,
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
 * @param {string | undefined} projectRoot
 * @returns {Promise<import('./types.js').AgentDefinition>}
 */
async function loadAgentDefFromPaths(agentName, filePaths, projectRoot) {
    /** @type {{ name?: string, model?: string, description?: string, promptOverride?: boolean, thinkingLevel?: string, temperature?: unknown, tools?: unknown[], [key: string]: unknown }} */
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
    const thinkingLevel = typeof mergedAttrs.thinkingLevel === "string" &&
            ["off", "minimal", "low", "medium", "high", "xhigh"].includes(mergedAttrs.thinkingLevel)
        ? mergedAttrs.thinkingLevel
        : undefined;
    const temperature = normalizeTemperature(mergedAttrs.temperature);

    const mergedPromptBody = promptSegments.join("\n\n").trim();
    const CORE_SYSTEM_PROMPT = await Deno.readTextFile(SYSTEM_PROMPT_TEMPLATE_PATH);
    const systemPrompt = CORE_SYSTEM_PROMPT.replace("{{AGENT_PROMPT}}", mergedPromptBody);

    const protectedToolsForAgent = bundledTools.filter((toolName) => PROTECTED_TOOL_NAMES.includes(toolName));
    const tools = [...mergedTools];
    for (const toolName of protectedToolsForAgent) {
        if (!tools.includes(toolName)) tools.push(toolName);
    }

    displayNameCache.set(displayNameCacheKey(projectRoot, agentName), displayName);

    return {
        name: agentName,
        displayName,
        model,
        description,
        thinkingLevel,
        temperature,
        tools,
        systemPrompt,
    };
}

/**
 * Load and merge an agent definition by name from layered files:
 * 1) bundled: `src/agent-definitions/<name>.md`
 * 2) home override: `~/.wld/agents/<name>.md`
 * 3) local override: `<cwd>/.wld/agents/<name>.md`
 *
 * @param {string} agentName
 * @param {string} [projectRoot]
 * @returns {Promise<import('./types.js').AgentDefinition>}
 */
export function loadAgentDef(agentName, projectRoot) {
    const filePaths = getAgentDefLayerDirs(projectRoot).map((dir) => join(dir, `${agentName}.md`));

    return loadAgentDefFromPaths(agentName, filePaths, projectRoot);
}

/**
 * Load an agent definition from an arbitrary file path.
 * Used for special agents (like init) that live outside the standard
 * agent-defs directories and should not be discoverable via /agent listings.
 *
 * @param {string} filePath - Absolute path to the agent .md file
 * @param {{ agentName?: string }} [options] - Override the internal name used as the cache key
 *   (defaults to the file's basename without `.md`).
 * @returns {Promise<import('./types.js').AgentDefinition>}
 */
export function loadAgentDefFromPath(filePath, options) {
    const agentName = options?.agentName || basename(filePath, ".md");
    return loadAgentDefFromPaths(agentName, [filePath], dirname(filePath));
}
