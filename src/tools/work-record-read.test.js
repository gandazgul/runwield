import { assertEquals, assertStringIncludes } from "@std/assert";
import { createWorkRecordReadTool } from "./work-record-read.js";

Deno.test("work_record_read returns canonical body text and structured details", async () => {
    const tool = /** @type {any} */ (createWorkRecordReadTool(
        /** @type {any} */ ({
            cwd: "/repo",
            accessMode: "all",
            readWorkRecordById: (
                /** @type {string} */ _cwd,
                /** @type {string} */ recordId,
                /** @type {any} */ options,
            ) => Promise.resolve({
                accessMode: options.accessMode,
                recordId,
                title: "Canonical outcome",
                summary: "Summary",
                status: "superseded",
                scope: "feature",
                origin: "internal",
                completionMode: "closed_without_verification",
                sourcePlans: ["plan-1"],
                path: "docs/work-records/canonical.md",
                notices: ["WARNING: superseded by next."],
                body: "# Canonical outcome\n\n## Summary\n\nSummary\n\n## Details\n\nBody",
                markdown: "---\n---\n# Canonical outcome",
                record: {},
            }),
        }),
    ));

    const result = await tool.execute("call", { recordId: "rid-1" }, undefined, undefined, {});

    assertEquals(result.details.accessMode, "all");
    assertEquals(result.details.record.recordId, "rid-1");
    assertStringIncludes(result.content[0].text, "WARNING: superseded by next.");
    assertStringIncludes(result.content[0].text, "## Details");
});

Deno.test("work_record_read reports current-only rejection as tool error", async () => {
    const tool = /** @type {any} */ (createWorkRecordReadTool(
        /** @type {any} */ ({
            cwd: "/repo",
            accessMode: "current",
            readWorkRecordById: () => Promise.reject(new Error("not current")),
        }),
    ));

    const result = await tool.execute("call", { recordId: "rid-2" }, undefined, undefined, {});

    assertEquals(result.isError, true);
    assertEquals(result.details.accessMode, "current");
    assertStringIncludes(result.content[0].text, "not current");
});
