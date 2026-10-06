export interface PlanSearchEntry {
    planId: string;
    title: string;
    planName: string;
    summary: string;
}

export type SearchablePlan = Partial<PlanSearchEntry>;

type SearchablePlanList = ReadonlyArray<SearchablePlan | null | undefined>;

export interface PlanSearchColumn {
    cards?: SearchablePlanList | null;
    orphanChildren?: SearchablePlanList | null;
}

export interface PlanSearchScreen {
    columns?: readonly PlanSearchColumn[] | null;
    orphanChildren?: SearchablePlanList | null;
}

function addPlansToSearchIndex(
    plans: SearchablePlanList | null | undefined,
    byId: Map<string, PlanSearchEntry>,
) {
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

export function buildPlanBoardSearchIndex(screen: PlanSearchScreen): PlanSearchEntry[] {
    const byId = new Map<string, PlanSearchEntry>();
    for (const column of screen.columns || []) {
        addPlansToSearchIndex(column.cards, byId);
        addPlansToSearchIndex(column.orphanChildren, byId);
    }
    addPlansToSearchIndex(screen.orphanChildren, byId);
    return [...byId.values()];
}
