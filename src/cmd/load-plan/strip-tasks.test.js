import { assertEquals, assertStringIncludes } from "@std/assert";
import { stripTasksSection } from "./index.js";

Deno.test("stripTasksSection removes ## Tasks block before next ## heading", () => {
    const input = [
        "## Reuse Opportunities",
        "",
        "- Stuff",
        "",
        "## Tasks",
        "",
        "| Task | Assignee | Dependencies | Description |",
        "| ---- | -------- | ------------ | ----------- |",
        "| 1 | engineer | none | Do thing |",
        "",
        "## Verification Plan",
        "",
        "- Run CI",
    ].join("\n");

    const result = stripTasksSection(input);
    assertStringIncludes(result, "## Reuse Opportunities");
    assertStringIncludes(result, "## Verification Plan");
    assertEquals(result.includes("## Tasks"), false);
    assertEquals(result.includes("engineer"), false);
});

Deno.test("stripTasksSection removes Tasks + Slice Details together", () => {
    const input = [
        "## Reuse Opportunities",
        "",
        "- Stuff",
        "",
        "## Tasks",
        "",
        "| Task | Assignee | Dependencies | Description |",
        "| ---- | -------- | ------------ | ----------- |",
        "| 1 | engineer | none | Do thing |",
        "",
        "### Slice Details",
        "",
        "#### Task 1 — Build feature",
        "",
        "**What to build**",
        "",
        "Lorem ipsum.",
        "",
        "## Verification Plan",
        "",
        "- Run CI",
    ].join("\n");

    const result = stripTasksSection(input);
    assertStringIncludes(result, "## Reuse Opportunities");
    assertStringIncludes(result, "## Verification Plan");
    assertEquals(result.includes("## Tasks"), false);
    assertEquals(result.includes("### Slice Details"), false);
    assertEquals(result.includes("#### Task 1"), false);
    assertEquals(result.includes("Lorem ipsum"), false);
});

Deno.test("stripTasksSection returns input unchanged when no Tasks heading", () => {
    const input = [
        "## Reuse Opportunities",
        "",
        "- Stuff",
        "",
        "## Verification Plan",
        "",
        "- Run CI",
    ].join("\n");

    const result = stripTasksSection(input);
    assertEquals(result, input);
});

Deno.test("stripTasksSection handles Tasks at end of file with no trailing ## heading", () => {
    const input = [
        "## Reuse Opportunities",
        "",
        "- Stuff",
        "",
        "## Tasks",
        "",
        "| Task | Assignee | Dependencies | Description |",
        "| ---- | -------- | ------------ | ----------- |",
        "| 1 | engineer | none | Do thing |",
    ].join("\n");

    const result = stripTasksSection(input);
    assertStringIncludes(result, "## Reuse Opportunities");
    assertEquals(result.includes("## Tasks"), false);
    assertEquals(result.includes("engineer"), false);
});

Deno.test("stripTasksSection collapses excess blank lines after strip", () => {
    const input = [
        "## A",
        "",
        "body",
        "",
        "## Tasks",
        "",
        "task table",
        "",
        "## B",
    ].join("\n");

    const result = stripTasksSection(input);
    // Should not have 3+ consecutive newlines.
    assertEquals(/\n{3,}/.test(result), false);
});
