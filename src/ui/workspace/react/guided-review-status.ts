export type GuidedReviewUsageState = "pending" | "available" | "unavailable";

export interface GuidedReviewTokenUsage {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    costUsd?: number;
}

export interface GuidedReviewCostUsage {
    usd?: number;
    costUsd?: number;
    total?: number;
}

export interface GuidedReviewJobStatus {
    usageState?: GuidedReviewUsageState;
    tokens?: GuidedReviewTokenUsage | null;
    cost?: GuidedReviewCostUsage | null;
}

export interface GuidedReviewUsageStatusText {
    tokens: string;
    cost: string;
}

function formatCompactTokens(count: number): string {
    if (count < 1000) return String(count);
    if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
    if (count < 1000000) return `${Math.round(count / 1000)}k`;
    if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
    return `${Math.round(count / 1000000)}M`;
}

function readNumber(value: number | undefined): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readCostUsd(job: GuidedReviewJobStatus): number {
    return readNumber(job.cost?.usd ?? job.cost?.costUsd ?? job.cost?.total ?? job.tokens?.costUsd);
}

export function formatGuidedReviewUsageStatus(job: GuidedReviewJobStatus): GuidedReviewUsageStatusText {
    const state = job.usageState || (job.tokens ? "available" : "unavailable");
    if (state === "pending") return { tokens: "tokens pending", cost: "cost pending" };
    if (state !== "available" || !job.tokens) return { tokens: "tokens unavailable", cost: "cost unavailable" };

    const tokens = [
        `${formatCompactTokens(readNumber(job.tokens.inputTokens))} in`,
        `${formatCompactTokens(readNumber(job.tokens.outputTokens))} out`,
        `${formatCompactTokens(readNumber(job.tokens.cacheReadTokens))} read`,
        `${formatCompactTokens(readNumber(job.tokens.cacheWriteTokens))} write`,
    ].join(" / ");
    return { tokens: `tokens ${tokens}`, cost: `cost $${readCostUsd(job).toFixed(3)}` };
}
