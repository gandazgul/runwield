import { assertEquals, assertStringIncludes } from "@std/assert";
import { savePlan } from "../../plan-store.js";
import { PLAN_UI_TOKEN_HEADER } from "../../constants.js";
import {
    buildBoardGroups,
    buildWorkspaceBoard,
    loadBoard,
    loadPlanSummaries,
    loadWorkspaceDetail,
    serializePlanSummary,
} from "./server/plan-adapter.js";
import { renderMarkdown } from "./components/MarkdownView.jsx";
import { createWorkspaceApp, hasWorkspaceToken } from "./server.js";

Deno.test("workspace token accepts query or header and rejects missing tokens", () => {
    assertEquals(hasWorkspaceToken(new Request("http://localhost/?token=abc"), "abc"), true);
    assertEquals(
        hasWorkspaceToken(new Request("http://localhost/", { headers: { [PLAN_UI_TOKEN_HEADER]: "abc" } }), "abc"),
        true,
    );
    assertEquals(hasWorkspaceToken(new Request("http://localhost/"), "abc"), false);
});

Deno.test("serializePlanSummary omits absolute paths and surfaces hierarchy/dependency metadata", () => {
    const summary = serializePlanSummary({
        planId: "p1",
        planName: "epic/child",
        relativePath: "plans/epic/child.md",
        path: "/tmp/project/plans/epic/child.md",
        attrs: {
            status: "draft",
            classification: "FEATURE",
            parentPlan: "epic",
            summary: "Child",
            dependencies: ["sibling-id"],
        },
    });
    assertEquals(summary.relativePath, "plans/epic/child.md");
    assertEquals(Object.hasOwn(summary, "path"), false);
    assertEquals(summary.isChild, true);
    assertEquals(summary.hierarchyRole, "child");
    assertEquals(summary.dependsOn, ["sibling-id"]);
    assertEquals(summary.dependencies, ["sibling-id"]);
});

Deno.test("buildBoardGroups separates active closed and on-hold Plans", () => {
    const plans = [
        { name: "active", planName: "active", planId: "a", status: "draft", attrs: {}, classification: "FEATURE" },
        {
            name: "closed",
            planName: "closed",
            planId: "c",
            status: "closed_without_verification",
            attrs: {},
            classification: "FEATURE",
        },
        { name: "hold", planName: "hold", planId: "h", status: "on_hold", attrs: {}, classification: "FEATURE" },
    ];
    const groups = /** @type {any} */ (buildBoardGroups(/** @type {any} */ (plans)));
    assertEquals(groups.active.standalone.map(/** @param {any} plan */ (plan) => plan.planName), ["active"]);
    assertEquals(groups.closed.standalone.map(/** @param {any} plan */ (plan) => plan.planName), ["closed"]);
    assertEquals(groups.onHold.standalone.map(/** @param {any} plan */ (plan) => plan.planName), ["hold"]);
});

Deno.test("buildWorkspaceBoard groups top-level cards into status columns and hides resolved children", () => {
    const plans = [
        {
            name: "epic",
            planName: "epic",
            planId: "epic-id",
            status: "draft",
            attrs: { classification: "PROJECT", type: "epic" },
            classification: "PROJECT",
            type: "epic",
            isEpic: true,
            isChild: false,
            hierarchyRole: "epic",
        },
        {
            name: "epic/child",
            planName: "epic/child",
            planId: "child-id",
            status: "draft",
            attrs: { classification: "FEATURE", parentPlan: "epic" },
            classification: "FEATURE",
            parentPlan: "epic",
            isEpic: false,
            isChild: true,
            hierarchyRole: "child",
        },
        {
            name: "standalone",
            planName: "standalone",
            planId: "standalone-id",
            status: "ready_for_work",
            attrs: { classification: "FEATURE" },
            classification: "FEATURE",
            isEpic: false,
            isChild: false,
            hierarchyRole: "top-level",
        },
    ];
    const board = /** @type {any} */ (buildWorkspaceBoard(/** @type {any} */ (plans)));
    const draftCards = board.active.columns.find((/** @type {any} */ column) => column.status === "draft").cards;
    const readyCards =
        board.active.columns.find((/** @type {any} */ column) => column.status === "ready_for_work").cards;
    assertEquals(draftCards.map((/** @type {any} */ plan) => plan.planName), ["epic"]);
    assertEquals(draftCards[0].childProgress.total, 1);
    assertEquals(readyCards.map((/** @type {any} */ plan) => plan.planName), ["standalone"]);
});

Deno.test("buildWorkspaceBoard keeps closed children with their active Epic instead of closed tab cards", () => {
    const board = /** @type {any} */ (buildWorkspaceBoard(
        /** @type {any} */ ([
            {
                name: "epic",
                planName: "epic",
                planId: "epic-id",
                status: "in_progress",
                attrs: { classification: "PROJECT", type: "epic", status: "in_progress" },
                classification: "PROJECT",
                type: "epic",
                isEpic: true,
                isChild: false,
                hierarchyRole: "epic",
            },
            {
                name: "epic/closed-child",
                planName: "epic/closed-child",
                planId: "closed-child-id",
                status: "verified",
                attrs: { classification: "FEATURE", parentPlan: "epic", status: "verified" },
                classification: "FEATURE",
                parentPlan: "epic",
                isEpic: false,
                isChild: true,
                hierarchyRole: "child",
            },
        ]),
    ));
    const inProgressColumn = board.active.columns.find((/** @type {any} */ column) => column.status === "in_progress");
    const verifiedColumn = board.closed.columns.find((/** @type {any} */ column) => column.status === "verified");
    assertEquals(inProgressColumn.cards.map((/** @type {any} */ plan) => plan.planId), ["epic-id"]);
    assertEquals(inProgressColumn.cards[0].childProgress.verified, 1);
    assertEquals(verifiedColumn.cards.length, 0);
});

Deno.test("buildWorkspaceBoard keeps orphan children visible for repair outside main status cards", () => {
    const board = /** @type {any} */ (buildWorkspaceBoard(
        /** @type {any} */ ([{
            name: "missing/child",
            planName: "missing/child",
            planId: "orphan-id",
            status: "draft",
            attrs: { classification: "FEATURE", parentPlan: "missing" },
            classification: "FEATURE",
            parentPlan: "missing",
            isEpic: false,
            isChild: true,
            hierarchyRole: "orphan-child",
        }]),
    ));
    const draftColumn = board.active.columns.find((/** @type {any} */ column) => column.status === "draft");
    assertEquals(draftColumn.cards.length, 0);
    assertEquals(draftColumn.orphanChildren.map((/** @type {any} */ plan) => plan.planId), ["orphan-id"]);
    assertEquals(board.active.orphanChildren.map((/** @type {any} */ plan) => plan.planId), ["orphan-id"]);
});

Deno.test("loadPlanSummaries marks top-level, Epic, child, and orphan-child hierarchy roles", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "top", "# Top", { planId: "top-id", classification: "FEATURE" });
        await savePlan(cwd, "epic", "# Epic", {
            planId: "epic-id",
            classification: "PROJECT",
            type: "epic",
        });
        await savePlan(cwd, "epic/child", "# Child", {
            planId: "child-id",
            classification: "FEATURE",
            parentPlan: "epic",
        });
        await savePlan(cwd, "missing/child", "# Orphan", {
            planId: "orphan-id",
            classification: "FEATURE",
            parentPlan: "missing",
        });
        const byId = new Map((await loadPlanSummaries(cwd)).map((plan) => [plan.planId, plan.hierarchyRole]));
        assertEquals(byId.get("top-id"), "top-level");
        assertEquals(byId.get("epic-id"), "epic");
        assertEquals(byId.get("child-id"), "child");
        assertEquals(byId.get("orphan-id"), "orphan-child");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("loadWorkspaceDetail returns Epic detail with children grouped by status", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "epic", "# Epic\n\nBody", {
            planId: "epic-id",
            classification: "PROJECT",
            type: "epic",
            status: "draft",
        });
        await savePlan(cwd, "epic/child", "# Child", {
            planId: "child-id",
            classification: "FEATURE",
            parentPlan: "epic",
            status: "failed",
        });
        const detail = /** @type {any} */ (await loadWorkspaceDetail(cwd, "epic-id"));
        assertEquals(detail.detailKind, "epic");
        assertEquals(detail.childProgress.total, 1);
        assertEquals(detail.childProgress.byStatus.failed, 1);
        assertEquals(detail.childHealth.failed.map((/** @type {any} */ plan) => plan.planId), ["child-id"]);
        const failedColumn = detail.childColumns.find((/** @type {any} */ column) => column.status === "failed");
        assertEquals(failedColumn.cards.map((/** @type {any} */ plan) => plan.planId), ["child-id"]);
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("workspace adapter exposes Epic dependency health done-enough held and orphan repair metadata", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "epic", "# Epic", {
            planId: "epic-id",
            classification: "PROJECT",
            type: "epic",
            status: "on_hold",
            heldFromStatus: "in_progress",
            heldAt: "2026-01-01T00:00:00.000Z",
            holdReason: "paused",
            epicCompletionMode: "done_enough",
            epicDoneEnoughSummary: "Enough value shipped",
            epicDoneEnoughAt: "2026-01-02T00:00:00.000Z",
        });
        await savePlan(cwd, "epic/01-done", "# Done", {
            planId: "done-id",
            classification: "FEATURE",
            parentPlan: "epic",
            status: "verified",
        });
        await savePlan(cwd, "epic/02-blocked", "# Blocked", {
            planId: "blocked-id",
            classification: "FEATURE",
            parentPlan: "epic",
            status: "draft",
            dependencies: ["01-done", "03-held", "04-missing"],
        });
        await savePlan(cwd, "epic/03-held", "# Held", {
            planId: "held-id",
            classification: "FEATURE",
            parentPlan: "epic",
            status: "on_hold",
            holdReason: "child paused",
        });
        await savePlan(cwd, "missing/child", "# Orphan", {
            planId: "orphan-id",
            classification: "FEATURE",
            parentPlan: "missing",
            status: "draft",
            dependencies: ["other"],
        });

        const detail = /** @type {any} */ (await loadWorkspaceDetail(cwd, "epic-id"));
        const blocked = detail.children.find((/** @type {any} */ child) => child.planId === "blocked-id");
        assertEquals(detail.doneEnough, true);
        assertEquals(detail.childHealth.held.map((/** @type {any} */ child) => child.planId), ["held-id"]);
        assertEquals(detail.childHealth.blocked.map((/** @type {any} */ child) => child.planId), ["blocked-id"]);
        assertEquals(detail.childHealth.missingDependencies.map((/** @type {any} */ child) => child.planId), [
            "blocked-id",
        ]);
        assertEquals(blocked.dependencyStates.map((/** @type {any} */ entry) => entry.state), [
            "verified",
            "unverified",
            "missing",
        ]);

        const orphan = /** @type {any} */ (await loadWorkspaceDetail(cwd, "orphan-id"));
        assertEquals(orphan.hierarchyRole, "orphan-child");
        assertEquals(orphan.parentResolved, false);
        assertStringIncludes(orphan.orphanReason, "missing");
        assertEquals(orphan.dependencyStates, [{ dependency: "other", state: "missing" }]);
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("renderMarkdown renders links and escapes unsafe markdown input", () => {
    const html = renderMarkdown(
        "# Title\n\nParagraph <script>alert(1)</script> with [RunWield](https://runwield.dev) and [bad](javascript:alert(1))\n\n- one\n- two\n\n```\ncode\n```",
    );
    assertStringIncludes(html, "<h1");
    assertStringIncludes(html, "&lt;script&gt;alert(1)&lt;/script&gt;");
    assertStringIncludes(html, 'href="https://runwield.dev"');
    assertStringIncludes(html, 'href="#"');
    assertStringIncludes(html, "<pre");
});

Deno.test("Fresh Workspace rejects missing token and SSR-renders status column board cards", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "workspace-card", "# Workspace Card\n\nBody", {
            planId: "workspace-card-id",
            status: "draft",
            classification: "FEATURE",
            summary: "SSR card",
        });
        const app = createWorkspaceApp({ cwd, token: "secret" }).handler();
        const rejected = await app(new Request("http://localhost/"));
        assertEquals(rejected.status, 401);

        const accepted = await app(new Request("http://localhost/?token=secret"));
        assertEquals(accepted.status, 200);
        const html = await accepted.text();
        assertStringIncludes(html, "Draft");
        assertStringIncludes(html, "Ready for Work");
        assertStringIncludes(html, "workspace-card");
        assertStringIncludes(html, "SSR card");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("Workspace API and detail route return read-only readable Plan content", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "detail", "# Detail\n\nReadable body with [RunWield](https://runwield.dev)", {
            planId: "detail-id",
            status: "implemented",
            classification: "FEATURE",
            summary: "Detail summary",
        });
        const board = await loadBoard(cwd);
        assertEquals(board.plans.length, 1);

        const app = createWorkspaceApp({ cwd, token: "secret" }).handler();
        const api = await app(
            new Request("http://localhost/api/plans/detail-id", {
                headers: { [PLAN_UI_TOKEN_HEADER]: "secret" },
            }),
        );
        assertEquals(api.status, 200);
        assertEquals((await api.json()).plan.readOnly, true);

        const detail = await app(new Request("http://localhost/plans/detail-id?token=secret"));
        const html = await detail.text();
        assertStringIncludes(html, "Read-first Plan detail");
        assertStringIncludes(html, "Readable body");
        assertStringIncludes(html, 'href="https://runwield.dev"');
        assertStringIncludes(html, "RunWield");
        assertStringIncludes(html, "Edit body after editor slice");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("Workspace Epic detail SSR-renders child FEATURE Plans by status", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "epic", "# Epic\n\nEpic body", {
            planId: "epic-id",
            status: "draft",
            classification: "PROJECT",
            type: "epic",
            summary: "Epic summary",
            epicCompletionMode: "done_enough",
            epicDoneEnoughSummary: "Shipped enough",
        });
        await savePlan(cwd, "epic/done", "# Done", {
            planId: "done-id",
            status: "verified",
            classification: "FEATURE",
            parentPlan: "epic",
            summary: "Done summary",
        });
        await savePlan(cwd, "epic/child", "# Child\n\nChild body", {
            planId: "child-id",
            status: "in_progress",
            classification: "FEATURE",
            parentPlan: "epic",
            summary: "Child summary",
            dependencies: ["done", "missing-child"],
        });
        await savePlan(cwd, "epic/held", "# Held", {
            planId: "held-id",
            status: "on_hold",
            classification: "FEATURE",
            parentPlan: "epic",
            summary: "Held summary",
            heldFromStatus: "ready_for_work",
            heldAt: "2026-01-04T00:00:00.000Z",
            holdReason: "child capacity pause",
        });
        await savePlan(cwd, "epic/failed", "# Failed", {
            planId: "failed-id",
            status: "failed",
            classification: "FEATURE",
            parentPlan: "epic",
            summary: "Failed summary",
        });
        await savePlan(cwd, "missing/orphan", "# Orphan", {
            planId: "orphan-id",
            status: "draft",
            classification: "FEATURE",
            parentPlan: "missing",
            summary: "Orphan summary",
        });
        await savePlan(cwd, "held-epic", "# Held Epic", {
            planId: "held-epic-id",
            status: "on_hold",
            classification: "PROJECT",
            type: "epic",
            summary: "Held Epic summary",
            heldFromStatus: "in_progress",
            heldAt: "2026-01-03T00:00:00.000Z",
            holdReason: "waiting for budget",
        });
        const app = createWorkspaceApp({ cwd, token: "secret" }).handler();
        const board = await app(new Request("http://localhost/?token=secret"));
        const boardHtml = await board.text();
        assertStringIncludes(boardHtml, "Epic summary");
        assertStringIncludes(boardHtml, "Orphan summary");
        assertStringIncludes(boardHtml, "Missing parent Epic");
        assertEquals(boardHtml.includes("Child summary"), false);

        const detail = await app(new Request("http://localhost/plans/epic-id?token=secret"));
        const detailHtml = await detail.text();
        assertStringIncludes(detailHtml, "Epic detail");
        assertStringIncludes(detailHtml, "Done enough");
        assertStringIncludes(detailHtml, "In Progress");
        assertStringIncludes(detailHtml, "Child summary");
        assertStringIncludes(detailHtml, "Failed summary");
        assertStringIncludes(detailHtml, "Held summary");
        assertStringIncludes(
            detailHtml,
            "held from ready_for_work; held at 2026-01-04T00:00:00.000Z; reason: child capacity pause",
        );
        assertStringIncludes(detailHtml, "done: verified");
        assertStringIncludes(detailHtml, "missing-child: missing");
        assertStringIncludes(detailHtml, "missing dependencies");

        const heldDetail = await app(new Request("http://localhost/plans/held-epic-id?token=secret"));
        const heldDetailHtml = await heldDetail.text();
        assertStringIncludes(heldDetailHtml, "Epic on hold from in_progress at 2026-01-03T00:00:00.000Z");
        assertStringIncludes(heldDetailHtml, "reason: waiting for budget");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});
