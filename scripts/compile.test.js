import { assertStringIncludes } from "@std/assert";

Deno.test("compile script includes workflow-only prompt assets", async () => {
    const script = await Deno.readTextFile("scripts/compile.js");

    assertStringIncludes(script, '"src/agent-definitions/workflow-prompts"');
    assertStringIncludes(script, '"src/agent-definitions/workflow-prompts/init-agent-prompt.md"');
    assertStringIncludes(script, '"src/agent-definitions/workflow-prompts/slicer-prompt.md"');
    assertStringIncludes(script, '"src/agent-definitions/workflow-prompts/reviewer-prompt.md"');
    assertStringIncludes(script, '"src/snip-filters"');
});
