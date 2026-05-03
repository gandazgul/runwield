import { listAvailableAgents } from "../../shared/agents.js";

/**
 * @param {string} argumentPrefix
 * @returns {Promise<import('../registry.js').CommandCompletionItem[]>}
 */
export async function getAgentCompletions(argumentPrefix) {
    const agents = await listAvailableAgents();
    return [
        {
            value: "router",
            label: "router",
            description: "Reset to default router (triage) flow",
        },
        ...agents.map((agent) => ({
            value: agent.name,
            label: agent.name,
            description: agent.description,
        })),
    ].filter((item) => item.value.startsWith(argumentPrefix));
}
