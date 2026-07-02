import { assert, assertEquals, assertMatch, assertRejects } from "@std/assert";
import { createTriageReportTool } from "../triage-report.js";

Deno.test("createTriageReportTool exposes expected metadata", () => {
    const tool = createTriageReportTool();
    assertEquals(tool.name, "triage_report");
    assertEquals(tool.label, "Routing Intent Report");
    assertMatch(tool.description, /MUST call this tool exactly once/i);
    assertMatch(tool.description, /Routing Intent/i);
    assertEquals(typeof tool.execute, "function");
    assertEquals(typeof tool.parameters, "object");
    assert(!("classification" in tool.parameters.properties));
    assert(tool.parameters.required.includes("routingIntent"));
    assert(tool.parameters.required.includes("sessionName"));
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

Deno.test("triage_report execute returns canonical routingIntent details for INQUIRY", async () => {
    /** @type {string[]} */
    const messages = [];
    const uiAPI = /** @type {any} */ ({
        appendSystemMessage: (/** @type {string} */ msg) => {
            messages.push(msg);
        },
    });
    const tool = createTriageReportTool({ uiAPI });

    const params = {
        routingIntent: /** @type {const} */ ("INQUIRY"),
        complexity: /** @type {const} */ ("LOW"),
        summary: "explain routing",
        sessionName: "routing overview",
        affectedPaths: ["src/shared/workflow/orchestrator.js"],
    };

    const result = await /** @type {any} */ (tool.execute)("call-1", params);

    assertEquals(result.terminate, true);
    assertEquals(result.details, params);
    assert(!("classification" in result.details));
    assertMatch(result.content[0].text, /Triage complete/);
    assertEquals(messages.length, 1);
    assertMatch(messages[0], /Routing Intent: INQUIRY/);
});

Deno.test("triage_report execute preserves plan classification only for FEATURE and PROJECT", async () => {
    const tool = createTriageReportTool();

    const feature = await /** @type {any} */ (tool.execute)("call-1", {
        routingIntent: "FEATURE",
        complexity: "MEDIUM",
        summary: "plan feature",
        sessionName: "plan feature",
        affectedPaths: ["src/foo.js"],
    });
    const operation = await /** @type {any} */ (tool.execute)("call-2", {
        routingIntent: "OPERATION",
        complexity: "LOW",
        summary: "show status",
        sessionName: "show status",
        affectedPaths: [],
    });
    const quickFix = await /** @type {any} */ (tool.execute)("call-3", {
        routingIntent: "QUICK_FIX",
        complexity: "LOW",
        summary: "fix typo",
        sessionName: "fix typo",
        affectedPaths: ["src/foo.js"],
    });

    assertEquals(feature.details.routingIntent, "FEATURE");
    assertEquals(feature.details.classification, "FEATURE");
    assertEquals(operation.details.routingIntent, "OPERATION");
    assert(!("classification" in operation.details));
    assertEquals(quickFix.details.routingIntent, "QUICK_FIX");
    assert(!("classification" in quickFix.details));
});

Deno.test("triage_report execute normalizes legacy classification params", async () => {
    const tool = createTriageReportTool();

    const result = await /** @type {any} */ (tool.execute)("call-1", {
        classification: "PROJECT",
        complexity: "HIGH",
        summary: "legacy project",
        sessionName: "legacy project",
        affectedPaths: ["src/foo.js"],
    });

    assertEquals(result.details.routingIntent, "PROJECT");
    assertEquals(result.details.classification, "PROJECT");
});

Deno.test("triage_report execute sanitizes sessionName and falls back to summary", async () => {
    const tool = createTriageReportTool();

    const sanitized = await /** @type {any} */ (tool.execute)("call-1", {
        routingIntent: "INQUIRY",
        complexity: "LOW",
        summary: "explain routing",
        sessionName: " explain\n\trouting\u0007 ",
        affectedPaths: [],
    });
    const fallback = await /** @type {any} */ (tool.execute)("call-2", {
        routingIntent: "INQUIRY",
        complexity: "LOW",
        summary: "explain routing",
        sessionName: "\n",
        affectedPaths: [],
    });

    assertEquals(sanitized.details.sessionName, "explain routing");
    assertEquals(fallback.details.sessionName, "explain routing");
});

Deno.test("triage_report execute rejects params without canonical or legacy intent", async () => {
    const tool = createTriageReportTool();

    await assertRejects(
        () =>
            /** @type {any} */ (tool.execute)("call-1", {
                complexity: "LOW",
                summary: "missing intent",
                affectedPaths: [],
            }),
        TypeError,
        "routingIntent",
    );
});
