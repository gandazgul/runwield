export const GUIDED_REVIEW_EVENT_PREFIX = "RUNWIELD_GUIDED_REVIEW_EVENT ";

export interface GuidedReviewUsage {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    costUsd: number;
    contextWindow?: number;
}

export interface GuidedReviewUsageEvent {
    version: 1;
    type: "usage";
    usage: GuidedReviewUsage;
}

function requireNumber(value: number | undefined, name: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`Malformed Guided Review usage frame: ${name} must be a finite number.`);
    }
    return value;
}

export function encodeGuidedReviewUsageEvent(usage: GuidedReviewUsage): string {
    return `${GUIDED_REVIEW_EVENT_PREFIX}${JSON.stringify({ version: 1, type: "usage", usage })}\n`;
}

export function parseGuidedReviewUsageEventLine(line: string): GuidedReviewUsageEvent | null {
    if (!line.startsWith(GUIDED_REVIEW_EVENT_PREFIX)) return null;
    const payload = line.slice(GUIDED_REVIEW_EVENT_PREFIX.length);
    let parsed: Partial<GuidedReviewUsageEvent> & { usage?: Partial<GuidedReviewUsage> };
    try {
        parsed = JSON.parse(payload) as Partial<GuidedReviewUsageEvent> & { usage?: Partial<GuidedReviewUsage> };
    } catch (error) {
        throw new Error(
            `Malformed Guided Review usage frame: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
    if (parsed.version !== 1 || parsed.type !== "usage" || !parsed.usage) {
        throw new Error("Malformed Guided Review usage frame: expected version 1 usage event.");
    }
    const usage: GuidedReviewUsage = {
        inputTokens: requireNumber(parsed.usage.inputTokens, "inputTokens"),
        outputTokens: requireNumber(parsed.usage.outputTokens, "outputTokens"),
        cacheReadTokens: requireNumber(parsed.usage.cacheReadTokens, "cacheReadTokens"),
        cacheWriteTokens: requireNumber(parsed.usage.cacheWriteTokens, "cacheWriteTokens"),
        costUsd: requireNumber(parsed.usage.costUsd, "costUsd"),
    };
    if (parsed.usage.contextWindow !== undefined) {
        usage.contextWindow = requireNumber(parsed.usage.contextWindow, "contextWindow");
    }
    return { version: 1, type: "usage", usage };
}

export const GUIDED_REVIEW_METADATA_PREFIX = "RUNWIELD_GUIDED_REVIEW_METADATA ";

export interface GuidedReviewMetadata {
    provider: string;
    model: string;
    thinkingLevel?: string;
}

export function encodeGuidedReviewMetadata(metadata: GuidedReviewMetadata): string {
    return `${GUIDED_REVIEW_METADATA_PREFIX}${JSON.stringify(metadata)}\n`;
}

export function parseGuidedReviewMetadataLine(line: string): GuidedReviewMetadata | null {
    if (!line.startsWith(GUIDED_REVIEW_METADATA_PREFIX)) return null;
    const metadata: Partial<GuidedReviewMetadata> = JSON.parse(line.slice(GUIDED_REVIEW_METADATA_PREFIX.length));
    if (
        !metadata || typeof metadata.provider !== "string" || !metadata.provider ||
        typeof metadata.model !== "string" || !metadata.model ||
        (metadata.thinkingLevel !== undefined && typeof metadata.thinkingLevel !== "string")
    ) {
        throw new Error("Malformed Guided Review metadata: expected provider, model, and optional thinkingLevel.");
    }
    return {
        provider: metadata.provider,
        model: metadata.model,
        ...(metadata.thinkingLevel ? { thinkingLevel: metadata.thinkingLevel } : {}),
    };
}
