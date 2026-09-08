import { assertEquals } from "@std/assert";
import {
    appendSessionAttentionRequest,
    appendSessionAttentionResolution,
    normalizeSessionAttentionRequest,
    readUnresolvedSessionAttention,
    SESSION_ATTENTION_CUSTOM_TYPE,
} from "./session-attention.ts";

const validRequest = {
    version: 1 as const,
    state: "requested" as const,
    attentionId: "attention-1",
    reason: "agentStopped" as const,
    runwieldSessionId: "session-1",
    agentName: "Planner",
    sessionName: "Planning Session",
    recordedAt: "2025-01-01T00:00:00.000Z",
    generation: 2,
};

Deno.test("Session Attention ignores loose legacy custom entries", () => {
    const entries = [
        { type: "custom", customType: SESSION_ATTENTION_CUSTOM_TYPE, data: { reason: "agentStopped" } },
        { type: "custom", customType: SESSION_ATTENTION_CUSTOM_TYPE, data: validRequest },
    ];

    assertEquals(readUnresolvedSessionAttention(entries), [validRequest]);
});

Deno.test("Session Attention resolves only the exact requested ID", () => {
    const secondRequest = { ...validRequest, attentionId: "attention-2", generation: 3 };
    const entries = [
        { type: "custom", customType: SESSION_ATTENTION_CUSTOM_TYPE, data: validRequest },
        { type: "custom", customType: SESSION_ATTENTION_CUSTOM_TYPE, data: secondRequest },
        {
            type: "custom",
            customType: SESSION_ATTENTION_CUSTOM_TYPE,
            data: {
                version: 1 as const,
                state: "resolved" as const,
                attentionId: "attention-1",
                resolution: "user_message" as const,
                recordedAt: "2025-01-01T00:01:00.000Z",
                generation: 4,
            },
        },
    ];

    assertEquals(readUnresolvedSessionAttention(entries), [secondRequest]);
});

Deno.test("Session Attention append helpers write strict version-one records", () => {
    const entries: Array<{ customType: string; data: unknown }> = [];
    const manager = {
        appendCustomEntry: (customType: string, data: unknown) => void entries.push({ customType, data }),
    };
    const request = appendSessionAttentionRequest(manager, {
        attentionId: "attention-3",
        runwieldSessionId: "session-1",
        agentName: "Guide",
        sessionName: "Guide Session",
        recordedAt: "2025-01-01T00:00:00.000Z",
        generation: 7,
    });
    appendSessionAttentionResolution(manager, {
        attentionId: request.attentionId,
        resolution: "interaction_result",
        recordedAt: "2025-01-01T00:02:00.000Z",
        generation: 8,
    });

    assertEquals(entries[0], { customType: SESSION_ATTENTION_CUSTOM_TYPE, data: request });
    assertEquals(normalizeSessionAttentionRequest(entries[0].data), request);
    assertEquals(readUnresolvedSessionAttention(entries.map((entry) => ({ type: "custom", ...entry }))), []);
});
