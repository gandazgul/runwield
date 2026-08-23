export interface PlanReviewVersionInput {
    plan: string;
    timestamp?: string;
}

export interface PlanReviewVersion {
    version: number;
    plan: string;
    timestamp: string;
}

export function normalizePlanReviewVersions(
    currentPlan: string,
    previousPlan: string | null,
    suppliedVersions: PlanReviewVersionInput[] | null,
): PlanReviewVersion[] {
    const plans: PlanReviewVersionInput[] = [];
    for (const candidate of Array.isArray(suppliedVersions) ? suppliedVersions : []) {
        if (!candidate || typeof candidate.plan !== "string") continue;
        if (plans.at(-1)?.plan === candidate.plan) continue;
        plans.push({
            plan: candidate.plan,
            timestamp: typeof candidate.timestamp === "string" ? candidate.timestamp : "",
        });
    }

    if (plans.length === 0 && previousPlan && previousPlan !== currentPlan) {
        plans.push({ plan: previousPlan, timestamp: "" });
    }
    if (plans.at(-1)?.plan !== currentPlan) plans.push({ plan: currentPlan, timestamp: "" });

    return plans.map((entry, index) => ({
        version: index + 1,
        plan: entry.plan,
        timestamp: entry.timestamp || "",
    }));
}
