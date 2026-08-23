import { assertStringIncludes } from "@std/assert";

Deno.test("complete Plan feedback includes direct edits and referenced-file comments", async () => {
    const source = await Deno.readTextFile("src/ui/workspace/react/plan-review-feedback.ts");

    assertStringIncludes(source, "exportAnnotations");
    assertStringIncludes(source, "composeRunWieldPlanFeedback");
    assertStringIncludes(source, "exportCodeFileAnnotations");
    assertStringIncludes(source, "if (planFeedback === NO_CHANGES) return codeFeedback");
});
