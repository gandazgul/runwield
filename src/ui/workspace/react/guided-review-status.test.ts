import { assertEquals } from "@std/assert";
import { formatGuidedReviewUsageStatus } from "./guided-review-status.ts";

Deno.test("Guided Review usage status distinguishes pending from unavailable", () => {
    assertEquals(formatGuidedReviewUsageStatus({ usageState: "pending", tokens: null, cost: null }), {
        tokens: "tokens pending",
        cost: "cost pending",
    });
    assertEquals(formatGuidedReviewUsageStatus({ usageState: "unavailable", tokens: null, cost: null }), {
        tokens: "tokens unavailable",
        cost: "cost unavailable",
    });
});

Deno.test("Guided Review usage status renders compact reported totals", () => {
    assertEquals(
        formatGuidedReviewUsageStatus({
            usageState: "available",
            tokens: {
                inputTokens: 1240,
                outputTokens: 250,
                cacheReadTokens: 800,
                cacheWriteTokens: 0,
                costUsd: 0.125,
            },
            cost: { usd: 0.125 },
        }),
        {
            tokens: "tokens 1.2k in / 250 out / 800 read / 0 write",
            cost: "cost $0.125",
        },
    );
});

Deno.test("Guided Review usage status keeps reported zero usage available", () => {
    assertEquals(
        formatGuidedReviewUsageStatus({
            usageState: "available",
            tokens: {
                inputTokens: 0,
                outputTokens: 0,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
                costUsd: 0,
            },
            cost: { usd: 0 },
        }),
        {
            tokens: "tokens 0 in / 0 out / 0 read / 0 write",
            cost: "cost $0.000",
        },
    );
});
