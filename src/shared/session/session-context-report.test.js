import { assertEquals } from "@std/assert";
import {
    buildSessionContextReport,
    createSessionContextProjection,
    estimateContextTextTokens,
} from "./session-context-report.js";

function makeProjection() {
    return createSessionContextProjection([
        { id: "agent_instructions", label: "Agent instructions", tokens: 10, items: [] },
        { id: "tools", label: "Tools", tokens: 20, items: [] },
        { id: "instruction_files", label: "Instruction files", tokens: 5, items: [] },
    ]);
}

Deno.test("estimateContextTextTokens follows chars over four convention", () => {
    assertEquals(estimateContextTextTokens("12345"), 2);
    assertEquals(estimateContextTextTokens(""), 0);
});

Deno.test("buildSessionContextReport uses local estimates before provider usage exists", () => {
    const report = buildSessionContextReport({
        agentName: "engineer",
        agentDisplayName: "Engineer",
        model: { provider: "test", model: "small" },
        projection: makeProjection(),
        contextUsage: null,
        activeMessageTokens: 15,
        contextWindow: 100,
    });

    assertEquals(report?.usageState, "estimated");
    assertEquals(report?.usedTokens, 50);
    assertEquals(report?.freeTokens, 50);
    assertEquals(report?.categories.at(-1)?.label, "Conversation & provider overhead");
    assertEquals(report?.categories.at(-1)?.tokens, 15);
});

Deno.test("buildSessionContextReport reconciles provider remainder into conversation overhead", () => {
    const report = buildSessionContextReport({
        projection: makeProjection(),
        contextUsage: { tokens: 80, contextWindow: 100, percent: 80 },
        activeMessageTokens: 15,
    });

    assertEquals(report?.usageState, "last_known");
    assertEquals(report?.usedTokens, 80);
    assertEquals(report?.freeTokens, 20);
    assertEquals(report?.percent, 80);
    assertEquals(report?.categories.find((category) => category.id === "conversation_overhead")?.tokens, 45);
});

Deno.test("buildSessionContextReport marks local total as estimated when provider total is lower", () => {
    const report = buildSessionContextReport({
        projection: makeProjection(),
        contextUsage: { tokens: 10, contextWindow: 40, percent: 25 },
        activeMessageTokens: 10,
    });

    assertEquals(report?.usageState, "estimated");
    assertEquals(report?.usedTokens, 45);
    assertEquals(report?.freeTokens, 0);
    assertEquals(report?.percent, 112.5);
});

Deno.test("buildSessionContextReport preserves post-compaction unknown usage", () => {
    const report = buildSessionContextReport({
        projection: makeProjection(),
        contextUsage: { tokens: null, contextWindow: 100, percent: null },
        activeMessageTokens: 15,
    });

    assertEquals(report?.usageState, "unknown_after_compaction");
    assertEquals(report?.usedTokens, null);
    assertEquals(report?.freeTokens, null);
    assertEquals(report?.percent, null);
});

Deno.test("buildSessionContextReport handles missing context window", () => {
    const report = buildSessionContextReport({
        projection: makeProjection(),
        contextUsage: null,
        activeMessageTokens: 5,
    });

    assertEquals(report?.usedTokens, 40);
    assertEquals(report?.contextWindow, null);
    assertEquals(report?.percent, null);
    assertEquals(report?.freeTokens, null);
});

Deno.test("buildSessionContextReport returns null without an active projection", () => {
    assertEquals(buildSessionContextReport({ projection: null, contextUsage: null }), null);
});
