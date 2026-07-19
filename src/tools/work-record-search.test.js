import { assertEquals, assertStringIncludes } from "@std/assert";
import { createWorkRecordSearchTool } from "./work-record-search.js";

Deno.test("work_record_search returns readable text and structured details", async () => {
    const tool = /** @type {any} */ (createWorkRecordSearchTool(
        /** @type {any} */ ({
            cwd: "/repo",
            accessMode: "current",
            searchWorkRecords: (/** @type {string} */ _cwd, /** @type {string} */ query, /** @type {any} */ options) =>
                Promise.resolve({
                    query,
                    accessMode: options.accessMode,
                    bootstrapped: false,
                    rebuild: null,
                    staleRecordIds: [],
                    records: [{
                        recordId: "rid-1",
                        title: "Useful outcome",
                        summary: "Full summary text",
                        status: "approved",
                        scope: "feature",
                        origin: "internal",
                        completionMode: "verified",
                        sourcePlans: ["plan-1"],
                        path: "docs/work-records/useful.md",
                        notices: [],
                    }],
                }),
        }),
    ));

    const result = await tool.execute("call", { query: "useful" }, undefined, undefined, {});

    assertEquals(result.details.accessMode, "current");
    assertEquals(result.details.records[0].recordId, "rid-1");
    assertEquals(Object.hasOwn(result.details.records[0], "record"), false);
    assertEquals(Object.hasOwn(result.details.records[0], "body"), false);
    assertStringIncludes(result.content[0].text, "Useful outcome");
    assertStringIncludes(result.content[0].text, "Full summary text");
});

Deno.test("work_record_search reports failures as tool errors", async () => {
    const tool = /** @type {any} */ (createWorkRecordSearchTool(
        /** @type {any} */ ({
            cwd: "/repo",
            accessMode: "all",
            searchWorkRecords: () => Promise.reject(new Error("index unavailable")),
        }),
    ));

    const result = await tool.execute("call", { query: "x" }, undefined, undefined, {});

    assertEquals(result.isError, true);
    assertEquals(result.details.accessMode, "all");
    assertStringIncludes(result.content[0].text, "index unavailable");
});
