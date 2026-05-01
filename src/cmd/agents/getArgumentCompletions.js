import { listAvailableAgents } from "../../shared/agents.js";

/**
 * @param {string} argumentPrefix
 * @returns {Promise<any[]>}
 */
export async function getAgentCompletions(argumentPrefix) {
    const agents = await listAvailableAgents();
    return [
        {
            value: "router",
            label: "router",
            description: "Reset to default router (triage) flow",
        },
        ...agents.map((a) => ({
            value: a.name,
            label: a.name,
            description: a.description,
        })),
    ].filter((item) => item.value.startsWith(argumentPrefix));
}
