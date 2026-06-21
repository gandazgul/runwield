import { assertEquals } from "@std/assert";
import { buildBaseline, checkThresholds, summarizeJudgements } from "./evaluate-router-judgements.js";

Deno.test("summarizeJudgements compares router and Gemma against human labels", () => {
    const summary = summarizeJudgements([
        {
            humanJudgement: "FEATURE",
            routerDecision: "QUICK_FIX",
            gemmaJudgement: "FEATURE",
        },
        {
            humanJudgement: "INQUIRY",
            routerDecision: "INQUIRY",
            gemmaJudgement: "QUICK_FIX",
        },
        {
            humanJudgement: "",
            routerDecision: "PROJECT",
            gemmaJudgement: "PROJECT",
        },
    ]);

    assertEquals(summary.labelledRows, 2);
    assertEquals(summary.unlabelledRows, 1);
    assertEquals(summary.router.agreementRate, 0.5);
    assertEquals(summary.gemma.agreementRate, 0.5);
    assertEquals(summary.router.corrections, { "QUICK_FIX->FEATURE": 1 });
    assertEquals(summary.gemma.corrections, { "QUICK_FIX->INQUIRY": 1 });
});

Deno.test("checkThresholds reports threshold failures", () => {
    const summary = /** @type {any} */ ({
        gemma: {
            agreementRate: 0.7,
            meanDistance: 0.4,
        },
    });

    assertEquals(
        checkThresholds(summary, {
            minGemmaAgreementRate: 0.75,
            maxGemmaMeanDistance: 0.3,
        }),
        [
            "Gemma agreement 0.7 < threshold 0.75",
            "Gemma mean distance 0.4 > threshold 0.3",
        ],
    );
});

Deno.test("buildBaseline creates suggested Gemma thresholds", () => {
    const baseline = buildBaseline(
        /** @type {any} */ ({
            labelledRows: 10,
            gemma: {
                agreementRate: 0.82,
                meanDistance: 0.2,
            },
        }),
        "router-judgements.csv",
    );

    assertEquals(baseline.thresholds, {
        minGemmaAgreementRate: 0.77,
        maxGemmaMeanDistance: 0.3,
    });
});
