import { listPlanDocuments } from "../../plan-store.js";
import { getCwd } from "../../constants.js";

/**
 * @param {string} argumentPrefix
 * @returns {Promise<import('../registry.js').CommandCompletionItem[]>}
 */
export async function getLoadPlanCompletions(argumentPrefix) {
    const plans = await listPlanDocuments(getCwd());
    // A complete Plan name is ready to submit. Offering it again makes the
    // editor consume Enter as argument completion, depending on lookup timing.
    if (plans.some((plan) => plan.name === argumentPrefix)) return [];
    return plans
        .filter((plan) => plan.name.startsWith(argumentPrefix))
        .map((plan) => ({
            value: plan.name,
            label: plan.name,
            description: `${plan.attrs.classification} - ${plan.attrs.status}`,
        }));
}
