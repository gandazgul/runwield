import { listAvailableAgents } from "../../shared/session/agents.js";
import { AGENTS } from "../../constants.js";

/**
 * @param {string} argumentPrefix
 * @returns {Promise<import('../registry.js').CommandCompletionItem[]>}
 */
export async function getAgentCompletions(argumentPrefix) {
    const agents = await listAvailableAgents(Deno.cwd());
    return agents
        .map((agent) => ({
            value: agent.name,
            label: agent.name,
            description: agent.name === AGENTS.ROUTER ? "Reset to default router (triage) flow" : agent.description,
        }))
        .filter((item) => item.value.startsWith(argumentPrefix));
}
