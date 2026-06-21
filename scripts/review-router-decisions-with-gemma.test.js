import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import {
    annotateDecision,
    buildDecisionFromJudgementCsvRow,
    buildGemmaPrompt,
    parseGemmaReview,
    parseJudgementCsvRows,
    reviewDecisionWithGemma,
} from "./review-router-decisions-with-gemma.js";

Deno.test("parseGemmaReview accepts strict agreement JSON", () => {
    assertEquals(parseGemmaReview('{"agrees":true,"routingIntent":null,"reason":null}'), {
        agrees: true,
        routingIntent: null,
        reason: null,
    });
});

Deno.test("parseGemmaReview accepts fenced disagreement JSON", () => {
    assertEquals(
        parseGemmaReview(
            '```json\n{"agrees":false,"routingIntent":"IDEATION","reason":"This asks to think through evaluation, so IDEATION fits better than QUICK_FIX."}\n```',
        ),
        {
            agrees: false,
            routingIntent: "IDEATION",
            reason: "This asks to think through evaluation, so IDEATION fits better than QUICK_FIX.",
        },
    );
});

Deno.test("parseGemmaReview rejects invalid disagreement intent", () => {
    assertThrows(
        () => parseGemmaReview('{"agrees":false,"routingIntent":"OTHER","reason":"No."}'),
        Error,
        "valid routingIntent",
    );
});

Deno.test("buildGemmaPrompt includes decision and strict output contract", () => {
    const prompt = buildGemmaPrompt({
        requestText: "Should we evaluate Router?",
        routingIntent: "INQUIRY",
        complexity: "LOW",
        summary: "Question",
        affectedPaths: [],
    });

    assertStringIncludes(prompt, "Return ONLY strict JSON");
    assertStringIncludes(prompt, "Should we evaluate Router?");
    assertStringIncludes(prompt, "commit/status-style git operations");
    assertStringIncludes(prompt, "run CI and fix failures");
    assertStringIncludes(prompt, "are QUICK_FIX, not INQUIRY");
    assertStringIncludes(prompt, "INQUIRY|IDEATION|QUICK_FIX|FEATURE|PROJECT");
});

Deno.test("annotateDecision adds compact agreement review", () => {
    assertEquals(
        annotateDecision({ decisionId: "d1" }, "ollama-cloud/gemma4:31b-cloud", {
            agrees: true,
            routingIntent: null,
            reason: null,
        }),
        {
            decisionId: "d1",
            gemmaReview: {
                model: "ollama-cloud/gemma4:31b-cloud",
                agrees: true,
            },
        },
    );
});

Deno.test("buildDecisionFromJudgementCsvRow uses routerDecision as Gemma review target", () => {
    assertEquals(
        buildDecisionFromJudgementCsvRow({
            decisionId: "d1",
            timestamp: "now",
            attribution: "active_agent_router",
            requestText: "commit the changes",
            routerDecision: "QUICK_FIX",
        }),
        {
            decisionId: "d1",
            timestamp: "now",
            attribution: "active_agent_router",
            requestText: "commit the changes",
            routingIntent: "QUICK_FIX",
            complexity: "",
            summary: "",
            affectedPaths: [],
        },
    );
});

Deno.test("parseJudgementCsvRows reads router judgement CSV rows", () => {
    const rows = parseJudgementCsvRows([
        "decisionId,timestamp,attribution,requestText,routerDecision",
        "d1,now,active_agent_router,hi,INQUIRY",
        "",
    ].join("\n"));

    assertEquals(rows.map((row) => row.routingIntent), ["INQUIRY"]);
});

Deno.test("reviewDecisionWithGemma annotates parsed model response", async () => {
    const model = { provider: "ollama-cloud", id: "gemma4:31b-cloud" };
    const modelRegistry = {
        getApiKeyAndHeaders: () => Promise.resolve({ ok: true, apiKey: "key" }),
    };
    const reviewed = await reviewDecisionWithGemma(
        { decisionId: "d1", requestText: "Think about router eval", routingIntent: "INQUIRY" },
        {
            model,
            modelRegistry: /** @type {any} */ (modelRegistry),
            completeSimpleFn: /** @type {any} */ (() =>
                Promise.resolve({
                    content: [{
                        type: "text",
                        text:
                            '{"agrees":false,"routingIntent":"IDEATION","reason":"The request asks to think through an evaluation approach, so IDEATION fits better than INQUIRY."}',
                    }],
                })),
        },
    );

    assertEquals(reviewed.gemmaReview, {
        model: "ollama-cloud/gemma4:31b-cloud",
        agrees: false,
        routingIntent: "IDEATION",
        reason: "The request asks to think through an evaluation approach, so IDEATION fits better than INQUIRY.",
    });
});
