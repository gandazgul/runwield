import { assertEquals, assertStringIncludes } from "@std/assert";
import { buildJudgementCsv, buildJudgementCsvRow, parseJsonlRows } from "./write-router-judgement-csv.js";
import { parseCsv } from "./router-eval-utils.js";

Deno.test("buildJudgementCsvRow adds human columns and Gemma disagreement metrics", () => {
    const row = buildJudgementCsvRow({
        decisionId: "d1",
        timestamp: "now",
        attribution: "active_agent_router",
        requestText: "add version command",
        routingIntent: "QUICK_FIX",
        gemmaReview: {
            agrees: false,
            routingIntent: "FEATURE",
            reason: "It spans multiple files.",
        },
    }, { decisionId: "d1", humanJudgement: "FEATURE", humanNotes: "agree with Gemma" });

    assertEquals(row.humanJudgement, "FEATURE");
    assertEquals(row.gemmaJudgement, "FEATURE");
    assertEquals(row.gemmaAgreesWithRouter, "FALSE");
    assertEquals(row.gemmaCorrection, "QUICK_FIX->FEATURE");
    assertEquals(row.gemmaDistanceFromRouter, 1);
    assertEquals(row.gemmaDisagreementKind, "scope_underestimated");
});

Deno.test("buildJudgementCsv preserves existing human judgement cells", () => {
    const csv = buildJudgementCsv([
        {
            decisionId: "d1",
            timestamp: "now",
            attribution: "active_agent_router",
            requestText: "hi",
            routingIntent: "INQUIRY",
            gemmaReview: { agrees: true },
        },
    ], [{ decisionId: "d1", humanJudgement: "INQUIRY", humanNotes: "clear" }]);

    const rows = parseCsv(csv);
    assertEquals(rows[0].humanJudgement, "INQUIRY");
    assertEquals(rows[0].humanNotes, "clear");
    assertEquals(rows[0].gemmaAgreesWithRouter, "TRUE");
});

Deno.test("parseJsonlRows reads reviewed rows", () => {
    const rows = parseJsonlRows('{"decisionId":"d1"}\n{"decisionId":"d2"}\n');
    assertEquals(rows.map((row) => row.decisionId), ["d1", "d2"]);
});

Deno.test("buildJudgementCsv includes expected headers", () => {
    const csv = buildJudgementCsv([]);
    assertStringIncludes(csv, "humanJudgement");
    assertStringIncludes(csv, "gemmaDistanceFromRouter");
});
