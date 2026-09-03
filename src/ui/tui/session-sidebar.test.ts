import { assertEquals, assertStringIncludes } from "@std/assert";
import stripAnsi from "strip-ansi";
import { composePinnedSessionSidebar, TuiSessionSidebar, tuiSessionSidebarProjection } from "./session-sidebar.ts";
import { initRunWieldTheme } from "../theme/theme.js";

initRunWieldTheme();

const ARTIFACT = {
    artifactId: "artifact-1",
    kind: "prd" as const,
    path: "docs/prd/session-sidebar.md",
    title: "Session Sidebar",
    registeredAt: "2026-01-01T00:00:00.000Z",
    registeredBy: "Ideator",
    sourceSegmentId: "segment-1",
};

Deno.test("TUI Session Sidebar defaults to workflow and cycles through shared tabs", () => {
    const snapshot = {
        name: "Demo Session",
        busy: true,
        activeAgent: "frontend-engineer",
        activeModel: { model: "demo-model", provider: "demo-provider" },
        thinkingLevel: "high",
        workflowContext: { routingIntent: "PLANNED_CHANGE", planName: "session-sidebar" },
        managed: { generation: 2 },
        artifacts: [ARTIFACT],
    };
    const sidebar = new TuiSessionSidebar(() => "session-1", () => snapshot);

    const workflow = stripAnsi(sidebar.render(34).join("\n"));
    assertStringIncludes(workflow, "PLAN");
    assertStringIncludes(workflow, "session-sidebar");
    assertStringIncludes(workflow, "Artifacts");

    sidebar.cycleTab();
    const session = stripAnsi(sidebar.render(34).join("\n"));
    assertStringIncludes(session, "Demo Session");
    assertStringIncludes(session, "demo-model");

    sidebar.cycleTab();
    const artifacts = stripAnsi(sidebar.render(34).join("\n"));
    assertStringIncludes(artifacts, "Session Sidebar");
    assertStringIncludes(artifacts, "PRD");
});

Deno.test("TUI Session Sidebar reuses the snapshot already loaded for the frame", () => {
    let snapshotReads = 0;
    const sidebar = new TuiSessionSidebar(
        () => "session-1",
        () => {
            snapshotReads += 1;
            return null;
        },
    );
    const lines = sidebar.render(34, { managed: { generation: 0 }, name: "Cached Session" });
    assertEquals(snapshotReads, 0);
    assertStringIncludes(stripAnsi(lines.join("\n")), "Cached Session");
});

Deno.test("shared TUI projection defaults idle Sessions without a Plan to Session", () => {
    const projection = tuiSessionSidebarProjection({ managed: { generation: 0 }, artifacts: [] });
    assertEquals(projection.defaultTab, "session");
    assertEquals(projection.workflow.active, false);
    assertEquals(projection.session.generation, "0");
});

Deno.test("TUI Session Sidebar stays at the top of the visible transcript viewport", () => {
    const mainLines = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`);
    const lines = composePinnedSessionSidebar(mainLines, ["sidebar top", "sidebar detail"], 12, 5);

    assertEquals(lines.length, 12);
    assertEquals(lines[0].includes("sidebar"), false);
    assertEquals(lines[6].includes("sidebar"), false);
    assertEquals(lines[7].endsWith("sidebar top"), true);
    assertEquals(lines[8].endsWith("sidebar detail"), true);
});
