// @ts-nocheck: Deno test imports browser-shell helpers without a browser document.
import { assertEquals, assertStringIncludes } from "@std/assert";
import {
    currentRouteFromUrl,
    shouldApplySidebarRefresh,
    sidebarProjectOrder,
    sidebarSessionOrder,
} from "./static/workspace-shell.ts";

Deno.test("Workspace shell maps owner review and artifact routes back to the owning Session", () => {
    assertEquals(
        currentRouteFromUrl("http://workspace.local/projects/project-a/sessions/session-a"),
        { kind: "session", projectId: "project-a", runwieldSessionId: "session-a" },
    );
    assertEquals(
        currentRouteFromUrl("http://workspace.local/projects/project-a/sessions/session-a/review/code"),
        { kind: "session", projectId: "project-a", runwieldSessionId: "session-a" },
    );
    assertEquals(
        currentRouteFromUrl("http://workspace.local/projects/project-a/sessions/session-a/artifacts/artifact-a"),
        { kind: "session", projectId: "project-a", runwieldSessionId: "session-a" },
    );
    assertEquals(
        currentRouteFromUrl("http://workspace.local/projects/project-a/plans/plan-a?session=session-a"),
        { kind: "session", projectId: "project-a", runwieldSessionId: "session-a" },
    );
    assertEquals(
        currentRouteFromUrl("http://workspace.local/projects/project-a/plans/plan-a/progress?session=session-a"),
        { kind: "session", projectId: "project-a", runwieldSessionId: "session-a" },
    );
});

Deno.test("Workspace sidebar refreshes reject stale navigation responses", () => {
    assertEquals(shouldApplySidebarRefresh(2, 2, "http://workspace.local/a", "http://workspace.local/a"), true);
    assertEquals(shouldApplySidebarRefresh(1, 2, "http://workspace.local/a", "http://workspace.local/a"), false);
    assertEquals(shouldApplySidebarRefresh(2, 2, "http://workspace.local/a", "http://workspace.local/b"), false);
});

Deno.test("Workspace sidebar reconciliation keeps loaded older Sessions while inserting new server rows first", () => {
    const order = sidebarSessionOrder(
        {
            projectId: "project-a",
            sessions: [
                { runwieldSessionId: "existing", displayName: "Existing" },
                { runwieldSessionId: "loaded-old", displayName: "Loaded old", loaded: true },
            ],
        },
        {
            projectId: "project-a",
            sessions: [
                { runwieldSessionId: "new", displayName: "New Session" },
                { runwieldSessionId: "existing", displayName: "Existing renamed", state: "busy" },
            ],
        },
    );
    assertEquals(order.map((session) => session.runwieldSessionId), ["new", "existing", "loaded-old"]);
    assertEquals(order[1].displayName, "Existing renamed");
    assertEquals(order[2].loaded, true);
});

Deno.test("Workspace sidebar project reconciliation keeps unavailable local rows after server Projects", () => {
    const order = sidebarProjectOrder(
        [
            { projectId: "project-a", sessions: [] },
            { projectId: "loaded-project", sessions: [{ runwieldSessionId: "older" }] },
        ],
        [
            { projectId: "project-b", displayName: "Project B", enabled: true, sessions: [] },
            { projectId: "project-a", displayName: "Project A", enabled: true, sessions: [] },
        ],
    );
    assertEquals(order.map((project) => project.projectId), ["project-b", "project-a", "loaded-project"]);
});

Deno.test("Workspace shell is event-driven and does not poll the sidebar", async () => {
    const shell = await Deno.readTextFile(new URL("./static/workspace-shell.ts", import.meta.url));
    assertStringIncludes(shell, 'document.addEventListener("astro:page-load", installWorkspaceShell)');
    assertStringIncludes(shell, 'ownerJson("/api/owner/sidebar"');
    assertStringIncludes(shell, 'if (!brand.querySelector("[data-workspace-sidebar-collapse]"))');
    assertEquals(/setInterval\s*\(/.test(shell), false);
    assertEquals(shell.includes("setTimeout(()"), false);
    assertEquals(/visibilitychange[^\n]+sidebar/.test(shell), false);
});

Deno.test("Workspace owner layout persists the real sidebar and leaves the right pane replaceable", async () => {
    const layout = await Deno.readTextFile(new URL("./layouts/WorkspaceLayout.astro", import.meta.url));
    assertStringIncludes(layout, 'import { ClientRouter } from "astro:transitions";');
    assertStringIncludes(layout, "<ClientRouter />");
    assertStringIncludes(layout, 'transition:name="workspace-sidebar" transition:persist');
    assertStringIncludes(layout, '<div class="workspace-main-shell">');
    assertEquals(layout.includes('class="workspace-main-shell" transition:persist'), false);
    assertStringIncludes(layout, '<script is:inline type="module" src="/workspace-shell.js"></script>');
});
