import { listPlans } from "../../plan-store.js";

/**
 * @param {string} argumentPrefix
 * @returns {Promise<import('../registry.js').CommandCompletionItem[]>}
 */
export async function getLoadPlanCompletions(argumentPrefix) {
    const plans = await listPlans(Deno.cwd());
    return plans
        .filter((plan) => plan.name.startsWith(argumentPrefix))
        .map((plan) => ({
            value: plan.name,
            label: plan.name,
            description: `${plan.attrs.classification} - ${plan.attrs.status}`,
        }));
}
