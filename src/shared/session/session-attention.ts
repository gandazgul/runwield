export const SESSION_ATTENTION_CUSTOM_TYPE = "runwield.attention";

export type SessionAttentionReason = "agentStopped";
export type SessionAttentionResolutionKind = "user_message" | "interaction_result";

export type SessionAttentionRequest = {
    version: 1;
    state: "requested";
    attentionId: string;
    reason: SessionAttentionReason;
    runwieldSessionId: string;
    agentName: string;
    sessionName: string;
    recordedAt: string;
    generation: number;
};

export type SessionAttentionResolution = {
    version: 1;
    state: "resolved";
    attentionId: string;
    resolution: SessionAttentionResolutionKind;
    recordedAt: string;
    generation: number;
};

export type SessionAttentionRecord = SessionAttentionRequest | SessionAttentionResolution;

export type AgentStoppedAttentionIntent = {
    reason: SessionAttentionReason;
    agentName: string;
};

export type AppendableSessionManager = {
    appendCustomEntry?: (customType: string, data: SessionAttentionRecord) => string | void;
};

type TranscriptEntry = {
    type?: unknown;
    customType?: unknown;
    data?: unknown;
};

function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

function isValidTimestamp(value: unknown): value is string {
    return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

function isGeneration(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

function recordData(entryOrData: unknown): unknown {
    const entry = entryOrData && typeof entryOrData === "object" ? entryOrData as TranscriptEntry : null;
    if (entry?.type === "custom" && entry.customType === SESSION_ATTENTION_CUSTOM_TYPE) return entry.data;
    return entryOrData;
}

export function normalizeSessionAttentionRequest(entryOrData: unknown): SessionAttentionRequest | null {
    const data = recordData(entryOrData);
    if (!data || typeof data !== "object") return null;
    const value = data as Record<string, unknown>;
    if (value.version !== 1 || value.state !== "requested") return null;
    if (!isNonEmptyString(value.attentionId)) return null;
    if (value.reason !== "agentStopped") return null;
    if (!isNonEmptyString(value.runwieldSessionId)) return null;
    if (!isNonEmptyString(value.agentName)) return null;
    if (!isNonEmptyString(value.sessionName)) return null;
    if (!isValidTimestamp(value.recordedAt)) return null;
    if (!isGeneration(value.generation)) return null;
    return {
        version: 1,
        state: "requested",
        attentionId: value.attentionId,
        reason: "agentStopped",
        runwieldSessionId: value.runwieldSessionId,
        agentName: value.agentName,
        sessionName: value.sessionName,
        recordedAt: value.recordedAt,
        generation: value.generation,
    };
}

export function normalizeSessionAttentionResolution(entryOrData: unknown): SessionAttentionResolution | null {
    const data = recordData(entryOrData);
    if (!data || typeof data !== "object") return null;
    const value = data as Record<string, unknown>;
    if (value.version !== 1 || value.state !== "resolved") return null;
    if (!isNonEmptyString(value.attentionId)) return null;
    if (value.resolution !== "user_message" && value.resolution !== "interaction_result") return null;
    if (!isValidTimestamp(value.recordedAt)) return null;
    if (!isGeneration(value.generation)) return null;
    return {
        version: 1,
        state: "resolved",
        attentionId: value.attentionId,
        resolution: value.resolution,
        recordedAt: value.recordedAt,
        generation: value.generation,
    };
}

export function normalizeSessionAttentionRecord(entryOrData: unknown): SessionAttentionRecord | null {
    return normalizeSessionAttentionRequest(entryOrData) || normalizeSessionAttentionResolution(entryOrData);
}

export function buildSessionAttentionRequest(options: {
    attentionId?: string;
    runwieldSessionId: string;
    agentName: string;
    sessionName: string;
    generation: number;
    recordedAt?: string;
}): SessionAttentionRequest {
    const request: SessionAttentionRequest = {
        version: 1,
        state: "requested",
        attentionId: options.attentionId || crypto.randomUUID(),
        reason: "agentStopped",
        runwieldSessionId: options.runwieldSessionId,
        agentName: options.agentName,
        sessionName: options.sessionName,
        recordedAt: options.recordedAt || new Date().toISOString(),
        generation: options.generation,
    };
    const normalized = normalizeSessionAttentionRequest(request);
    if (!normalized) throw new Error("Invalid Session Attention request.");
    return normalized;
}

export function buildSessionAttentionResolution(options: {
    attentionId: string;
    resolution: SessionAttentionResolutionKind;
    generation: number;
    recordedAt?: string;
}): SessionAttentionResolution {
    const resolution: SessionAttentionResolution = {
        version: 1,
        state: "resolved",
        attentionId: options.attentionId,
        resolution: options.resolution,
        recordedAt: options.recordedAt || new Date().toISOString(),
        generation: options.generation,
    };
    const normalized = normalizeSessionAttentionResolution(resolution);
    if (!normalized) throw new Error("Invalid Session Attention resolution.");
    return normalized;
}

export function appendSessionAttentionRequest(
    sessionManager: AppendableSessionManager | null | undefined,
    options: Parameters<typeof buildSessionAttentionRequest>[0],
): SessionAttentionRequest {
    const request = buildSessionAttentionRequest(options);
    sessionManager?.appendCustomEntry?.(SESSION_ATTENTION_CUSTOM_TYPE, request);
    return request;
}

export function appendSessionAttentionResolution(
    sessionManager: AppendableSessionManager | null | undefined,
    options: Parameters<typeof buildSessionAttentionResolution>[0],
): SessionAttentionResolution {
    const resolution = buildSessionAttentionResolution(options);
    sessionManager?.appendCustomEntry?.(SESSION_ATTENTION_CUSTOM_TYPE, resolution);
    return resolution;
}

export function readUnresolvedSessionAttention(entries: unknown[]): SessionAttentionRequest[] {
    const unresolved = new Map<string, SessionAttentionRequest>();
    for (const entry of entries) {
        const request = normalizeSessionAttentionRequest(entry);
        if (request) {
            unresolved.set(request.attentionId, request);
            continue;
        }
        const resolution = normalizeSessionAttentionResolution(entry);
        if (resolution) unresolved.delete(resolution.attentionId);
    }
    return Array.from(unresolved.values());
}
