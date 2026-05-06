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
    const t1 = createTriageReportTool({ userRequest: "first" });
    const t2 = createTriageReportTool({ userRequest: "second" });
    assertEquals(t1.name, t2.name);
    // Different closures — same shape
    assertEquals(typeof t1.execute, typeof t2.execute);
});
