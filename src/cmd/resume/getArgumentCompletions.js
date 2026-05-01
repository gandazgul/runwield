import { listPlans } from "../../plan-store.js";

/**
 * @param {string} argumentPrefix
 * @returns {Promise<any[]>}
 */
export async function getResumeCompletions(argumentPrefix) {
    const plans = await listPlans(Deno.cwd());
    return plans
        .filter((p) => p.name.startsWith(argumentPrefix))
        .map((p) => ({
            value: p.name,
            label: p.name,
            description: `${p.attrs.classification} - ${p.attrs.status}`,
        }));
}
