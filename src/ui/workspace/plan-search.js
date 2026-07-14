/**
 * @param {any[]} plans
 * @param {Map<string, { planId: string, title: string, planName: string, summary: string }>} byId
 */
function addPlansToSearchIndex(plans, byId) {
    for (const plan of plans || []) {
        if (!plan?.planId || byId.has(plan.planId)) continue;
        const planName = String(plan.planName || "");
        byId.set(plan.planId, {
            planId: String(plan.planId),
            title: String(plan.title || planName),
            planName,
            summary: String(plan.summary || ""),
        });
    }
}

/**
 * @param {any} screen
 * @returns {Array<{ planId: string, title: string, planName: string, summary: string }>}
 */
export function buildPlanBoardSearchIndex(screen) {
    const byId = new Map();
    for (const column of screen.columns || []) {
        addPlansToSearchIndex(column.cards, byId);
        addPlansToSearchIndex(column.orphanChildren, byId);
    }
    addPlansToSearchIndex(screen.orphanChildren, byId);
    return [...byId.values()];
}
