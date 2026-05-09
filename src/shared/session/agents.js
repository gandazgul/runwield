/**
 * @module shared/session/agents
 * Agent discovery — scans agent definitions (bundled + overrides) and returns merged metadata.
 */

import { listAgentDefNames, loadAgentDef } from "./session.js";

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
            agents.push({
                name,
                displayName: def.name || name,
                description: def.description || "",
                model: def.model || "unknown",
            });
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
