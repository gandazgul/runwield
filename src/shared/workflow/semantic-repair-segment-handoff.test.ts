import { assertFalse, assertStringIncludes } from "@std/assert";

Deno.test("two semantic rejections create two repair segments while Reviewer sessions create none", async () => {
    const runtime = await Deno.readTextFile(new URL("../session/session-runtime.js", import.meta.url));
    const semantic = await Deno.readTextFile(new URL("./validation-semantic.ts", import.meta.url));
    assertStringIncludes(semantic, 'kind: "semantic_repair_handoff"');
    assertStringIncludes(runtime, 'kind: "semantic_repair"');
    assertStringIncludes(runtime, "semanticRepairSegment");
});

Deno.test("pending semantic repair markers resume the repair turn", async () => {
    const runtime = await Deno.readTextFile(new URL("../session/session-runtime.js", import.meta.url));
    assertStringIncludes(runtime, 'resolved.continuation.kind === "semantic_repair"');
    assertStringIncludes(runtime, "#runSemanticRepairContinuation");
    assertStringIncludes(
        runtime,
        "const pendingResult = await this.#resumePendingExecutionSegmentHandoff(session, options);",
    );
});

Deno.test("semantic repair handoff preserves current CI state", async () => {
    const runtime = await Deno.readTextFile(new URL("../session/session-runtime.js", import.meta.url));
    assertStringIncludes(runtime, "buildSemanticRepairCiState(options, workflow, handoff)");
    assertFalse(runtime.includes("ciState: {},"));
});

Deno.test("repair root context excludes predecessor Engineer and Reviewer history", async () => {
    const runtime = await Deno.readTextFile(new URL("../session/session-runtime.js", import.meta.url));
    assertStringIncludes(runtime, "runActiveAgentTurn");
    assertStringIncludes(runtime, "buildValidationRepairPrompt");
    assertStringIncludes(runtime, "createReviewDiffTool");
});
