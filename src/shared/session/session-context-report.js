/**
 * @module shared/session/session-context-report
 * Pure helpers for estimating and reporting active Agent Session context-window usage.
 */

/**
 * @typedef {"agent_instructions" | "tools" | "instruction_files" | "core_memories" | "skill_catalog" | "project_state" | "conversation_overhead"} ContextCategoryId
 */

/**
 * @typedef {Object} ContextProjectionItem
 * @property {string} label
 * @property {number} tokens
 * @property {string} [source]
 * @property {string} [path]
 * @property {string} [name]
 */

/**
 * @typedef {Object} ContextProjectionCategory
 * @property {ContextCategoryId} id
 * @property {string} label
 * @property {number} tokens
 * @property {ContextProjectionItem[]} [items]
 */

/**
 * @typedef {Object} SessionContextProjection
 * @property {ContextProjectionCategory[]} categories
 * @property {ContextProjectionItem[]} instructionFiles
 * @property {ContextProjectionItem[]} skills
 * @property {number} staticTokens
 */

/**
 * @typedef {Object} ContextUsageState
 * @property {number | null} [tokens]
 * @property {number | null} [contextWindow]
 * @property {number | null} [percent]
 */

/**
 * @typedef {Object} RuntimeContextReportInput
 * @property {string} [agentName]
 * @property {string} [agentDisplayName]
 * @property {{ provider?: string, model?: string }} [model]
 * @property {SessionContextProjection | null | undefined} projection
 * @property {ContextUsageState | null | undefined} contextUsage
 * @property {number} [activeMessageTokens]
 * @property {number | null} [contextWindow]
 */

/**
 * @typedef {ContextProjectionCategory & { percent: number | null }} ContextReportCategory
 */

/**
 * @typedef {Object} SessionContextReport
 * @property {string} agentName
 * @property {string} agentDisplayName
 * @property {string} provider
 * @property {string} model
 * @property {"last_known" | "estimated" | "unknown_after_compaction"} usageState
 * @property {number | null} usedTokens
 * @property {number | null} contextWindow
 * @property {number | null} percent
 * @property {number | null} freeTokens
 * @property {number} staticTokens
 * @property {number} activeMessageTokens
 * @property {ContextReportCategory[]} categories
 * @property {ContextProjectionItem[]} instructionFiles
 * @property {ContextProjectionItem[]} skills
 */

const TOKEN_CHARS = 4;

/**
 * Estimate tokens with Pi's simple chars/4 convention for local attribution.
 * @param {string | undefined | null} text
 * @returns {number}
 */
export function estimateContextTextTokens(text) {
    if (!text) return 0;
    return Math.ceil(String(text).length / TOKEN_CHARS);
}

/**
 * @param {ContextProjectionCategory[]} categories
 * @returns {number}
 */
export function sumContextCategoryTokens(categories) {
    return categories.reduce((sum, category) => sum + Math.max(0, Number(category.tokens) || 0), 0);
}

/**
 * @param {ContextProjectionCategory[]} categories
 * @returns {SessionContextProjection}
 */
export function createSessionContextProjection(categories) {
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
 * @param {RuntimeContextReportInput} input
 * @returns {SessionContextReport | null}
 */
export function buildSessionContextReport(input) {
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

    let usageState = /** @type {SessionContextReport['usageState']} */ ("estimated");
    /** @type {number | null} */
    let usedTokens = localEstimate;
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
    const categories = [
        ...projection.categories,
        ...(conversationTokens > 0
            ? [{
                id: /** @type {ContextCategoryId} */ ("conversation_overhead"),
                label: "Conversation & provider overhead",
                tokens: conversationTokens,
                items: [],
            }]
            : []),
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

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function normalizePositiveNumber(value) {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}
