import { assertEquals, assertMatch } from "@std/assert";
import { createTriageReportTool } from "../triage-report.js";

Deno.test("createTriageReportTool exposes expected metadata", () => {
    const tool = createTriageReportTool();
    assertEquals(tool.name, "triage_report");
    assertEquals(tool.label, "Triage Report");
    assertMatch(tool.description, /MUST call this tool exactly once/i);
    assertEquals(typeof tool.execute, "function");
    assertEquals(typeof tool.parameters, "object");
});

Deno.test("createTriageReportTool called with no opts produces valid tool shape", () => {
    const tool = createTriageReportTool({});
    assertEquals(tool.name, "triage_report");
    assertEquals(typeof tool.execute, "function");
});

Deno.test("createTriageReportTool instances are independent", () => {
    const t1 = createTriageReportTool();
    const t2 = createTriageReportTool();
    assertEquals(t1.name, t2.name);
    // Different closures — same shape
    assertEquals(typeof t1.execute, typeof t2.execute);
});

Deno.test("triage_report execute returns terminate:true with classification details", async () => {
    /** @type {string[]} */
    const messages = [];
    const uiAPI = /** @type {any} */ ({
        appendSystemMessage: (/** @type {string} */ msg) => {
            messages.push(msg);
        },
    });
    const tool = createTriageReportTool({ uiAPI });

    const params = {
        classification: /** @type {const} */ ("QUICK_FIX"),
        complexity: /** @type {const} */ ("LOW"),
        summary: "fix typo",
        affectedPaths: ["src/foo.js"],
    };

    const result = await /** @type {any} */ (tool.execute)("call-1", params);

    assertEquals(result.terminate, true);
    assertEquals(result.details, params);
    assertMatch(result.content[0].text, /Triage complete/);
    assertEquals(messages.length, 1);
    assertMatch(messages[0], /QUICK_FIX/);
});
