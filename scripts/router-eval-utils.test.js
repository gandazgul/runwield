import { assertEquals } from "@std/assert";
import {
    classifyRoutingIntentDisagreement,
    parseCsv,
    routingIntentDistance,
    scoreAgainstHuman,
    toCsv,
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
    assertEquals(routingIntentDistance("QUICK_FIX", "FEATURE"), 1);
    assertEquals(routingIntentDistance("QUICK_FIX", "INQUIRY"), 2);
    assertEquals(routingIntentDistance("INQUIRY", "PROJECT"), 4);
    assertEquals(routingIntentDistance("bad", "PROJECT"), null);
});

Deno.test("classifyRoutingIntentDisagreement names common router-eval cases", () => {
    assertEquals(classifyRoutingIntentDisagreement("QUICK_FIX", "INQUIRY"), "legacy_quick_fix_to_inquiry");
    assertEquals(classifyRoutingIntentDisagreement("QUICK_FIX", "FEATURE"), "scope_underestimated");
    assertEquals(classifyRoutingIntentDisagreement("FEATURE", "QUICK_FIX"), "scope_overestimated");
    assertEquals(classifyRoutingIntentDisagreement("FEATURE", "PROJECT"), "feature_project_boundary");
});

Deno.test("scoreAgainstHuman reports agreement and correction counts", () => {
    const score = scoreAgainstHuman([
        { humanJudgement: "FEATURE", routerDecision: "QUICK_FIX" },
        { humanJudgement: "INQUIRY", routerDecision: "INQUIRY" },
        { humanJudgement: "", routerDecision: "PROJECT" },
    ], "routerDecision");

    assertEquals(score, {
        total: 2,
        agreementCount: 1,
        agreementRate: 0.5,
        meanDistance: 0.5,
        invalidRows: 0,
        corrections: { "QUICK_FIX->FEATURE": 1 },
    });
});
