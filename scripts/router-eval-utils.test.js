import { assertEquals } from "@std/assert";
import {
    classifyRoutingIntentDisagreement,
    parseCsv,
    routingIntentDistance,
    scoreAgainstHuman,
    toCsv,
    withRouterJudgementMetrics,
} from "./router-eval-utils.js";

Deno.test("CSV utilities round-trip quoted cells", () => {
    const csv = toCsv(["decisionId", "requestText"], [{
        decisionId: "d1",
        requestText: 'hello, "Router"\nplease',
    }]);

    assertEquals(parseCsv(csv), [{
        decisionId: "d1",
        requestText: 'hello, "Router" please',
    }]);
});

Deno.test("routingIntentDistance follows routing-intent workflow order", () => {
    assertEquals(routingIntentDistance("OPERATION", "QUICK_FIX"), 1);
    assertEquals(routingIntentDistance("QUICK_FIX", "FEATURE"), 1);
    assertEquals(routingIntentDistance("QUICK_FIX", "INQUIRY"), 3);
    assertEquals(routingIntentDistance("INQUIRY", "PROJECT"), 5);
    assertEquals(routingIntentDistance("bad", "PROJECT"), null);
});

Deno.test("classifyRoutingIntentDisagreement names common router-eval cases", () => {
    assertEquals(classifyRoutingIntentDisagreement("QUICK_FIX", "INQUIRY"), "legacy_quick_fix_to_inquiry");
    assertEquals(classifyRoutingIntentDisagreement("OPERATION", "QUICK_FIX"), "operation_quick_fix_boundary");
    assertEquals(classifyRoutingIntentDisagreement("QUICK_FIX", "FEATURE"), "scope_underestimated");
    assertEquals(classifyRoutingIntentDisagreement("FEATURE", "QUICK_FIX"), "scope_overestimated");
    assertEquals(classifyRoutingIntentDisagreement("FEATURE", "PROJECT"), "feature_project_boundary");
});

Deno.test("scoreAgainstHuman reports agreement and correction counts", () => {
    const score = scoreAgainstHuman([
        { humanJudgement: "FEATURE", routerDecision: "QUICK_FIX" },
        { humanJudgement: "INQUIRY", routerDecision: "INQUIRY" },
        { humanJudgement: "", routerDecision: "PROJECT" },
        { humanJudgement: "IDEATION", routerDecision: "" },
    ], "routerDecision");

    assertEquals(score, {
        total: 2,
        agreementCount: 1,
        agreementRate: 0.5,
        meanDistance: 0.5,
        invalidRows: 0,
        unscoredRows: 1,
        corrections: { "QUICK_FIX->FEATURE": 1 },
    });
});

Deno.test("withRouterJudgementMetrics annotates Router agreement columns", () => {
    assertEquals(
        withRouterJudgementMetrics({
            routerDecision: "FEATURE",
            humanJudgement: "QUICK_FIX",
        }),
        {
            routerDecision: "FEATURE",
            humanJudgement: "QUICK_FIX",
            routerAgreesWithHuman: "FALSE",
            routerCorrection: "FEATURE->QUICK_FIX",
            routerDistanceFromHuman: 1,
            routerDisagreementKind: "scope_overestimated",
        },
    );
});
