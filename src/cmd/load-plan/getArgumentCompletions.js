import { listPlanDocuments } from "../../plan-store.js";
import { getCwd } from "../../constants.js";

/**
 * @param {string} argumentPrefix
 * @returns {Promise<import('../registry.js').CommandCompletionItem[]>}
 */
export async function getLoadPlanCompletions(argumentPrefix) {
    const plans = await listPlanDocuments(getCwd());
    // Pi treats Enter on an argument suggestion as acceptance, not submission.
    // Once a complete Plan name is typed, there is nothing left to complete.
    if (plans.some((plan) => plan.name === argumentPrefix)) return [];
    return plans
        .filter((plan) => plan.name.startsWith(argumentPrefix))
        .map((plan) => ({
            value: plan.name,
            label: plan.name,
            description: `${plan.attrs.classification} - ${plan.attrs.status}`,
        }));
}
