import { assertStringIncludes } from "@std/assert";
import { buildDeniedFeedbackRequest } from "./workflow.js";

Deno.test("buildDeniedFeedbackRequest includes feedback and plan path", () => {
    const prompt = buildDeniedFeedbackRequest({
        round: 2,
        planName: "my-plan",
        feedback: "Please add verification details",
    });

    assertStringIncludes(prompt, "Round 2");
    assertStringIncludes(prompt, "Please add verification details");
    assertStringIncludes(prompt, "plans/my-plan.md");
});
