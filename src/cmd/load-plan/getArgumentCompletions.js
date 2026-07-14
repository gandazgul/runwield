import { listPlans } from "../../plan-store.js";

const LOAD_PLAN_STATUS_ORDER = new Map([
    ["ready_for_decomposition", 0],
    ["ready_for_work", 1],
    ["draft", 2],
    ["feedback", 3],
    ["approved", 4],
    ["in_progress", 5],
    ["failed", 6],
    ["implemented", 7],
    ["closed_without_verification", 8],
    ["verified", 9],
    ["on_hold", 10],
]);

/**
 * @param {Awaited<ReturnType<typeof listPlans>>[number]} plan
 * @returns {number}
 */
function getLoadPlanCompletionRank(plan) {
    const classification = plan.attrs.classification;
    const status = plan.attrs.status;
    if (classification === "PROJECT" && status === "ready_for_decomposition") return 0;
    if (classification === "PROJECT" && status === "ready_for_work") return 1;
    if (classification === "FEATURE" && status === "ready_for_work") return 2;
    return 3 + (LOAD_PLAN_STATUS_ORDER.get(status) ?? LOAD_PLAN_STATUS_ORDER.size);
}

/**
 * @param {Awaited<ReturnType<typeof listPlans>>[number]} a
 * @param {Awaited<ReturnType<typeof listPlans>>[number]} b
 * @returns {number}
 */
function compareLoadPlanCompletions(a, b) {
    return getLoadPlanCompletionRank(a) - getLoadPlanCompletionRank(b) || a.name.localeCompare(b.name);
}

/**
 * @param {string} argumentPrefix
 * @returns {Promise<import('../registry.js').CommandCompletionItem[]>}
 */
export async function getLoadPlanCompletions(argumentPrefix) {
    const plans = await listPlans(Deno.cwd());
    return plans
        .filter((plan) => plan.name.startsWith(argumentPrefix))
        .sort(compareLoadPlanCompletions)
        .map((plan) => ({
            value: plan.name,
            label: plan.name,
            description: `${plan.attrs.classification} - ${plan.attrs.status}`,
        }));
}
