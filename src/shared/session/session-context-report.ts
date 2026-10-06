/**
 * @module shared/session/session-context-report
 * Pure helpers for estimating and reporting active Agent Session context-window usage.
 */

export type ContextCategoryId =
    | "agent_instructions"
    | "tools"
    | "instruction_files"
    | "core_memories"
    | "skill_catalog"
    | "project_state"
    | "conversation_overhead";

export interface ContextProjectionItem {
    label: string;
    tokens: number;
    source?: string;
    path?: string;
    name?: string;
}

export interface ContextProjectionCategory {
    id: ContextCategoryId;
    label: string;
    tokens: number;
    items?: ContextProjectionItem[];
}

export interface SessionContextProjection {
    categories: ContextProjectionCategory[];
    instructionFiles: ContextProjectionItem[];
    skills: ContextProjectionItem[];
    staticTokens: number;
}

export interface ContextUsageState {
    tokens?: number | null;
    contextWindow?: number | null;
    percent?: number | null;
}

export interface ContextReportModel {
    provider?: string;
    model?: string;
}

export interface RuntimeContextReportInput {
    agentName?: string;
    agentDisplayName?: string;
    model?: ContextReportModel;
    projection: SessionContextProjection | null | undefined;
    contextUsage: ContextUsageState | null | undefined;
    activeMessageTokens?: number;
    contextWindow?: number | null;
}

export interface ContextReportCategory extends ContextProjectionCategory {
    percent: number | null;
}

export type ContextReportUsageState = "last_known" | "estimated" | "unknown_after_compaction";

export interface SessionContextReport {
    agentName: string;
    agentDisplayName: string;
    provider: string;
    model: string;
    usageState: ContextReportUsageState;
    usedTokens: number | null;
    contextWindow: number | null;
    percent: number | null;
    freeTokens: number | null;
    staticTokens: number;
    activeMessageTokens: number;
    categories: ContextReportCategory[];
    instructionFiles: ContextProjectionItem[];
    skills: ContextProjectionItem[];
}

const TOKEN_CHARS = 4;

/**
 * Estimate tokens with Pi's simple chars/4 convention for local attribution.
 */
export function estimateContextTextTokens(text: string | undefined | null): number {
    if (!text) return 0;
    return Math.ceil(String(text).length / TOKEN_CHARS);
}

export function sumContextCategoryTokens(categories: ContextProjectionCategory[]): number {
    return categories.reduce((sum, category) => sum + Math.max(0, Number(category.tokens) || 0), 0);
}

export function createSessionContextProjection(categories: ContextProjectionCategory[]): SessionContextProjection {
    const normalized = categories
        .map((category) => ({
            ...category,
            tokens: Math.max(0, Number(category.tokens) || 0),
            items: (category.items || []).map((item) => ({
                ...item,
                tokens: Math.max(0, Number(item.tokens) || 0),
            })),
        }))
        .filter((category) => category.tokens > 0 || (category.items || []).length > 0);
    return {
        categories: normalized,
        instructionFiles: normalized.find((category) => category.id === "instruction_files")?.items || [],
        skills: normalized.find((category) => category.id === "skill_catalog")?.items || [],
        staticTokens: sumContextCategoryTokens(normalized),
    };
}

/**
 * Build a semantic report from stored static projection and current Runtime usage.
 */
export function buildSessionContextReport(input: RuntimeContextReportInput): SessionContextReport | null {
    const projection = input.projection;
    if (!projection) return null;

    const activeMessageTokens = Math.max(0, Number(input.activeMessageTokens) || 0);
    const staticTokens = Math.max(
        0,
        Number(projection.staticTokens) || sumContextCategoryTokens(projection.categories),
    );
    const localEstimate = staticTokens + activeMessageTokens;

    const usageTokens = typeof input.contextUsage?.tokens === "number" ? Math.max(0, input.contextUsage.tokens) : null;
    const usageExplicitlyUnknown = input.contextUsage && input.contextUsage.tokens === null;
    const contextWindow = normalizePositiveNumber(input.contextUsage?.contextWindow) ??
        normalizePositiveNumber(input.contextWindow) ?? null;

    let usageState: ContextReportUsageState = "estimated";
    let usedTokens: number | null = localEstimate;
    if (usageExplicitlyUnknown) {
        usageState = "unknown_after_compaction";
        usedTokens = null;
    } else if (usageTokens !== null) {
        if (usageTokens >= localEstimate) {
            usageState = "last_known";
            usedTokens = usageTokens;
        } else {
            usageState = "estimated";
            usedTokens = localEstimate;
        }
    }

    const overheadTokens = usedTokens === null ? 0 : Math.max(0, usedTokens - staticTokens - activeMessageTokens);
    const conversationTokens = activeMessageTokens + overheadTokens;
    const overheadCategories: ContextProjectionCategory[] = conversationTokens > 0
        ? [{
            id: "conversation_overhead",
            label: "Conversation & provider overhead",
            tokens: conversationTokens,
            items: [],
        }]
        : [];
    const categories: ContextReportCategory[] = [
        ...projection.categories,
        ...overheadCategories,
    ].map((category) => ({
        ...category,
        percent: usedTokens && usedTokens > 0 ? (category.tokens / usedTokens) * 100 : null,
    }));

    const percent = usedTokens === null || !contextWindow
        ? null
        : typeof input.contextUsage?.percent === "number" && usageState === "last_known" && usageTokens === usedTokens
        ? input.contextUsage.percent
        : (usedTokens / contextWindow) * 100;
    const freeTokens = usedTokens === null || !contextWindow ? null : Math.max(0, contextWindow - usedTokens);

    const provider = input.model?.provider || "";
    const rawModel = input.model?.model || "";
    const model = provider && rawModel.startsWith(`${provider}/`) ? rawModel.slice(provider.length + 1) : rawModel;

    return {
        agentName: input.agentName || "",
        agentDisplayName: input.agentDisplayName || input.agentName || "Agent",
        provider,
        model,
        usageState,
        usedTokens,
        contextWindow,
        percent,
        freeTokens,
        staticTokens,
        activeMessageTokens,
        categories,
        instructionFiles: projection.instructionFiles || [],
        skills: projection.skills || [],
    };
}

function normalizePositiveNumber(value: number | null | undefined): number | null {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}
