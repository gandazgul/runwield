import { assertEquals, assertMatch } from "@std/assert";
import { triageReportTool } from "./triage-report.js";

/**
 * @param {{ execute: unknown }} tool
 * @param {{ classification: string, complexity: string, summary: string, affectedPaths: string[] }} params
 */
async function executeTool(tool, params) {
    const execute =
        /** @type {(id: string, params: { classification: string, complexity: string, summary: string, affectedPaths: string[] }, signal: AbortSignal, onUpdate: () => void, context: object) => Promise<{ content: Array<{ type: string, text?: string }>, details: unknown }>} */ (tool
            .execute);
    return await execute("tool-call-1", params, new AbortController().signal, () => {}, {});
}

/**
 * @param {{ content: Array<{ type: string, text?: string }> }} result
 */
function firstText(result) {
    const first = result.content[0];
    assertEquals(first?.type, "text");
    if (!first || first.type !== "text") throw new Error("Expected text content.");
    return first.text ?? "";
}

Deno.test("triageReportTool exposes expected metadata", () => {
    assertEquals(triageReportTool.name, "triage_report");
    assertEquals(triageReportTool.label, "Triage Report");
    assertMatch(triageReportTool.description, /MUST call this tool exactly once/i);
    assertEquals(typeof triageReportTool.execute, "function");
    assertEquals(typeof triageReportTool.parameters, "object");
});

Deno.test("triageReportTool execute returns summary content and details", async () => {
    const params = {
        classification: "FEATURE",
        complexity: "MEDIUM",
        summary: "Add plan review retry behavior",
        affectedPaths: [
            "src/cmd/router/index.js",
            "src/shared/workflow.js",
            "src/tools/triage-report.js",
        ],
    };

    const result = await executeTool(triageReportTool, params);

    assertEquals(result.details, params);
    assertEquals(
        firstText(result),
        "Triage complete: FEATURE (MEDIUM complexity). Summary: Add plan review retry behavior",
    );
});
