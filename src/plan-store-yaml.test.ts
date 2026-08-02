import { assertEquals, assertStringIncludes } from "@std/assert";
import { injectFrontMatter, parsePlanFrontMatter } from "./plan-store.js";

Deno.test("Plan Front Matter safely round-trips ANSI control characters", () => {
    const failureReason = `CI failed: \u001b[31mFAILED\u001b[0m`;
    const markdown = injectFrontMatter("# Plan\n", { failureReason });

    assertEquals(markdown.includes("\u001b"), false);
    assertStringIncludes(markdown, "\\u001b[31mFAILED\\u001b[0m");
    assertEquals(parsePlanFrontMatter(markdown).attrs.failureReason, failureReason);
});
