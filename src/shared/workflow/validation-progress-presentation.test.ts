import { assertEquals } from "@std/assert";
import {
    validationCheckLabel,
    validationProgressCheckSummary,
    validationProgressHeading,
    validationStageLabel,
} from "./validation-progress-presentation.ts";
import type { RuntimeValidationProgress } from "../session/session-runtime-events.js";

const BASE_CHECKS: RuntimeValidationProgress["checks"] = {
    ci: "pending",
    semanticReview: "pending",
    humanReview: "pending",
    merge: "pending",
};

function progress(
    patch:
        & Pick<RuntimeValidationProgress, "kind" | "outcome" | "stage">
        & Partial<Omit<RuntimeValidationProgress, "kind" | "outcome" | "stage">>,
): RuntimeValidationProgress {
    return {
        checks: BASE_CHECKS,
        cycle: 1,
        maxCycles: 3,
        totalCycle: 4,
        ...patch,
    };
}

Deno.test("validation progress labels use owner terms", () => {
    assertEquals(validationStageLabel("ci"), "Tests and CI");
    assertEquals(validationStageLabel("semantic_review"), "AI code review");
    assertEquals(validationStageLabel("human_review"), "Human review");
    assertEquals(validationStageLabel("engineer_repair"), "Repair");
    assertEquals(validationStageLabel("merge"), "Combining commits");
    assertEquals(validationStageLabel("terminal"), "Validation result");
    assertEquals(validationCheckLabel("ci"), "Tests and CI");
    assertEquals(validationCheckLabel("semanticReview"), "AI code review");
    assertEquals(validationCheckLabel("humanReview"), "Human review");
    assertEquals(validationCheckLabel("merge"), "Combining commits");
});

Deno.test("validation progress headings hide raw stages and counters", () => {
    const cases: RuntimeValidationProgress[] = [
        progress({ kind: "mechanical", outcome: "running", stage: "ci" }),
        progress({ kind: "workflow", outcome: "running", stage: "semantic_review" }),
        progress({ kind: "workflow", outcome: "paused", stage: "human_review" }),
        progress({ kind: "workflow", outcome: "failed", stage: "terminal" }),
        progress({ kind: "workflow", outcome: "verified", stage: "terminal" }),
        progress({
            kind: "mechanical",
            outcome: "failed",
            stage: "terminal",
            checks: { ...BASE_CHECKS, ci: "failed" },
        }),
        progress({
            kind: "mechanical",
            outcome: "verified",
            stage: "terminal",
            checks: { ...BASE_CHECKS, ci: "passed" },
        }),
    ];
    const headings = cases.map(validationProgressHeading);

    assertEquals(headings, [
        "Tests and CI running",
        "AI code review running",
        "Human review paused",
        "Validation failed",
        "Validation passed",
        "Tests and CI failed",
        "Tests and CI passed",
    ]);
    for (const heading of headings) {
        assertEquals(heading.includes("semantic_review"), false, heading);
        assertEquals(heading.includes("Mechanical"), false, heading);
        assertEquals(heading.includes("Semantic Code Review"), false, heading);
        assertEquals(heading.includes("4"), false, heading);
    }
});

Deno.test("validation check summary uses shared labels without raw check names", () => {
    const summary = validationProgressCheckSummary(progress({
        kind: "workflow",
        outcome: "running",
        stage: "merge",
        checks: {
            ci: "passed",
            semanticReview: "passed",
            humanReview: "skipped",
            merge: "running",
        },
    }));

    assertEquals(
        summary,
        "Tests and CI passed, AI code review passed, Human review skipped, Combining commits running",
    );
    assertEquals(summary.includes("semanticReview"), false);
});
