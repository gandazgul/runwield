import { assertEquals } from "@std/assert";
import { readLatestTriageOutcome } from "./orchestrator.js";

Deno.test("readLatestTriageOutcome returns the latest triage_report details", () => {
    const messages = [
        /** @type {any} */ ({
            role: "toolResult",
            toolName: "triage_report",
            details: {
                classification: "QUICK_FIX",
                complexity: "LOW",
                summary: "first",
                affectedPaths: ["a.js"],
            },
        }),
        /** @type {any} */ ({
            role: "toolResult",
            toolName: "triage_report",
            details: {
                classification: "FEATURE",
                complexity: "MEDIUM",
                summary: "second",
                affectedPaths: ["b.js"],
            },
        }),
    ];
    assertEquals(readLatestTriageOutcome(messages), {
        classification: "FEATURE",
        complexity: "MEDIUM",
        summary: "second",
        affectedPaths: ["b.js"],
    });
});

Deno.test("readLatestTriageOutcome returns null when no triage_report tool result", () => {
    assertEquals(readLatestTriageOutcome([]), null);
});

Deno.test("readLatestTriageOutcome ignores tool results without classification", () => {
    const messages = [
        /** @type {any} */ ({
            role: "toolResult",
            toolName: "triage_report",
            details: { something: "else" },
        }),
    ];
    assertEquals(readLatestTriageOutcome(messages), null);
});
