/**
 * @module shared/agents
 * Agent discovery — scans agent definitions (bundled + overrides) and returns merged metadata.
 */

import { listAgentDefNames, loadAgentDef } from "./session.js";

/**
 * @typedef {Object} AgentInfo
 * @property {string} name - Agent filename (without .md)
 * @property {string} displayName - Human-readable name from frontmatter
 * @property {string} description - One-line description from frontmatter
 * @property {string} model - Model identifier from frontmatter
 */

/**
 * List all available merged agent definitions.
 *
 * @returns {Promise<AgentInfo[]>}
 */
export async function listAvailableAgents() {
    const names = await listAgentDefNames();
    /** @type {AgentInfo[]} */
    const agents = [];

    for (const name of names) {
        try {
            const def = await loadAgentDef(name);
            agents.push({
                name,
                displayName: def.name || name,
                description: def.description || "",
                model: def.model || "unknown",
            });
        } catch {
            // Skip unreadable or invalid files
        }
    }

    agents.sort((a, b) => a.name.localeCompare(b.name));
    return agents;
}
