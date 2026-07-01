import { assertEquals, assertStringIncludes } from "@std/assert";
import { loadPlanBodyById, savePlan } from "../../plan-store.js";
import { PLAN_UI_TOKEN_HEADER } from "../../constants.js";
import {
    buildBoardGroups,
    buildWorkspaceBoard,
    loadBoard,
    loadPlanSummaries,
    loadWorkspaceDetail,
    runWorkspaceResumeCheck,
    serializePlanSummary,
    workspaceMetadata as _workspaceMetadata,
} from "./server/plan-adapter.js";
import { buildPlanBoardSearchIndex } from "./components/Board.jsx";
import { renderMarkdown } from "./components/MarkdownView.jsx";
import { detailHref, workspaceHref } from "./components/PlanCard.jsx";
import { draftRecoveryState, planBodyDraftKey, restoredDraftExpectedBodyHash } from "./islands/PlanBodyEditor.jsx";
import { blockedDropMessage, isAllowedDropTarget, parseAllowedTargetStatuses } from "./islands/PlanBoardDragDrop.jsx";
import { matchingPlanIds, normalizePlanSearchQuery, PLAN_SEARCH_QUERY_PARAM } from "./islands/PlanBoardSearch.jsx";
import {
    createMoveStatusIntent,
    createPutOnHoldIntent,
    lifecycleActionLabel,
} from "./islands/PlanLifecycleActions.jsx";
import { createWorkspaceApp, hasWorkspaceToken } from "./server.js";
import { renderWorkspaceThemeCss } from "./server/theme-css.js";

/**
 * @param {string} cwd
 * @param {string[]} args
 */
async function git(cwd, args) {
    const command = new Deno.Command("git", { args, cwd, stdout: "piped", stderr: "piped" });
    const output = await command.output();
    if (!output.success) {
        const decoder = new TextDecoder();
        throw new Error(decoder.decode(output.stderr) || decoder.decode(output.stdout));
    }
    return new TextDecoder().decode(output.stdout);
}

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
            worktreePath: "/tmp/project-runwield-worktree",
        },
    });
    assertEquals(summary.relativePath, "plans/epic/child.md");
    assertEquals(Object.hasOwn(summary, "path"), false);
    assertEquals(Object.hasOwn(summary.attrs, "worktreePath"), false);
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

Deno.test("Plan Board search helpers normalize query and match title name and summary", () => {
    const searchIndex = [
        {
            planId: "fuzzy-id",
            title: "Add Fuzzy Search",
            planName: "plans-ui-fuzzy-search",
            summary: "Filter the board by title, name, or summary",
        },
        {
            planId: "archive-id",
            title: "Archive Plans",
            planName: "implementing-plan-archival",
            summary: "Move closed Plans into an archive folder",
        },
    ];

    assertEquals(normalizePlanSearchQuery("  fuzzy\n search  "), "fuzzy search");
    assertEquals([...matchingPlanIds(searchIndex, "")].sort(), ["archive-id", "fuzzy-id"]);
    assertEquals(matchingPlanIds(searchIndex, "archival").has("archive-id"), true);
    assertEquals(matchingPlanIds(searchIndex, "fuzzy").has("fuzzy-id"), true);
});

Deno.test("buildPlanBoardSearchIndex includes top-level cards and orphan repair cards once", () => {
    const searchIndex = buildPlanBoardSearchIndex({
        columns: [
            {
                cards: [{ planId: "epic-id", planName: "epic", title: "Epic", summary: "Parent project" }],
                orphanChildren: [{ planId: "orphan-id", planName: "missing/child", summary: "Repair me" }],
            },
            {
                cards: [{ planId: "epic-id", planName: "epic", title: "Duplicate", summary: "Duplicate" }],
                orphanChildren: [],
            },
        ],
        orphanChildren: [{ planId: "orphan-id", planName: "missing/child", summary: "Repair me" }],
    });

    assertEquals(searchIndex.map((/** @type {any} */ entry) => entry.planId), ["epic-id", "orphan-id"]);
    assertEquals(searchIndex[1].title, "missing/child");
});

Deno.test("workspaceHref preserves token and board search query", () => {
    const url = new URL("http://localhost/plans/plan-id?token=secret&q=fuzzy%20plan&edit=body");
    assertEquals(workspaceHref("/closed", url), "/closed?token=secret&q=fuzzy+plan");
    assertEquals(detailHref({ planId: "plan id" }, url), "/plans/plan%20id?token=secret&q=fuzzy+plan");
    assertEquals(PLAN_SEARCH_QUERY_PARAM, "q");
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

Deno.test("workspace metadata advertises real board drag/drop capability", () => {
    const metadata = _workspaceMetadata("/tmp/example-project");
    assertEquals(metadata.capabilities.lifecycleActions, true);
    assertEquals(metadata.capabilities.dragDrop, true);
});

Deno.test("draft helpers scope recovery to workspace plan and hash", () => {
    assertEquals(planBodyDraftKey("workspace", "plan"), "runwield:workspace:workspace:plan:plan:bodyDraft");
    assertEquals(draftRecoveryState(null, "hash"), "none");
    assertEquals(draftRecoveryState({ baseBodyHash: "hash" }, "hash"), "same-base");
    assertEquals(draftRecoveryState({ baseBodyHash: "old" }, "hash"), "changed-on-disk");
    assertEquals(restoredDraftExpectedBodyHash({ baseBodyHash: "old" }), "old");
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

Deno.test("renderWorkspaceThemeCss maps agent theme tokens to workspace CSS variables", () => {
    const css = renderWorkspaceThemeCss({
        name: 'agent "theme"',
        vars: {
            base: "#010203",
            overlay1: "#505152",
            text: "#202122",
            muted: "#303132",
            warning: "#404142",
        },
        colors: {
            accent: "#abcdef",
            borderAccent: "#123456",
            muted: "muted",
            success: "#0bad55",
            error: "#fedcba",
            warning: "warning",
        },
        export: {
            pageBg: "base",
            cardBg: "#111213",
            infoBg: "#141516",
        },
    });

    assertStringIncludes(css, '--rw-theme-name: "agent \\"theme\\""');
    assertStringIncludes(css, "--rw-page-bg: #010203;");
    assertStringIncludes(css, "--rw-surface: #111213;");
    assertStringIncludes(css, "--rw-surface-raised: #141516;");
    assertStringIncludes(css, "--rw-accent: #abcdef;");
    assertStringIncludes(css, "--rw-accent-strong: #123456;");
    assertStringIncludes(css, "--rw-error: #fedcba;");
    assertStringIncludes(css, "--rw-warning: #404142;");
    assertStringIncludes(css, "--rw-complexity-low: #0bad55;");
    assertStringIncludes(css, "--rw-complexity-medium: #404142;");
    assertStringIncludes(css, "--rw-complexity-high: #fedcba;");
    assertStringIncludes(css, "--rw-text: #202122;");
    assertStringIncludes(css, "--rw-text-dim: #505152;");
});

Deno.test("renderWorkspaceThemeCss renders bundled Catppuccin Mocha export colors", async () => {
    const themeJson = JSON.parse(
        await Deno.readTextFile(new URL("../../shared/ui/catppuccin-mocha.json", import.meta.url)),
    );
    const css = renderWorkspaceThemeCss(themeJson);

    assertStringIncludes(css, '--rw-theme-name: "catppuccin-mocha"');
    assertStringIncludes(css, "--rw-page-bg: #11111b;");
    assertStringIncludes(css, "--rw-surface: #181825;");
    assertStringIncludes(css, "--rw-surface-raised: #313244;");
    assertStringIncludes(css, "--rw-text: #cdd6f4;");
    assertStringIncludes(css, "--rw-accent: #cba6f7;");
});

Deno.test("workspace detail header CSS lets lifecycle actions wrap without squeezing summary", async () => {
    const css = await Deno.readTextFile(new URL("./static/styles.css", import.meta.url));
    assertStringIncludes(css, ".detail-title-row {\n    align-items: center;\n    display: grid;");
    assertStringIncludes(css, "grid-template-columns: auto minmax(0, 1fr) auto;");
    assertStringIncludes(css, ".split-header {\n    align-items: flex-start;\n    display: grid;");
    assertStringIncludes(css, "grid-template-columns: minmax(0, 1fr);");
    assertStringIncludes(css, ".header-actions .lifecycle-actions {\n    flex: 1 1 100%;");
    assertStringIncludes(css, ".detail-grid > * {\n    min-width: 0;");
    assertStringIncludes(css, ".markdown-view {\n    background:");
    assertStringIncludes(css, "overflow-wrap: anywhere;");
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
        const themeCss = await app(new Request("http://localhost/theme.css"));
        assertEquals(themeCss.status, 200);
        assertEquals(themeCss.headers.get("cache-control"), "no-store");
        assertStringIncludes(await themeCss.text(), "--rw-theme-name:");

        const accepted = await app(new Request("http://localhost/?token=secret&q=workspace"));
        assertEquals(accepted.status, 200);
        const html = await accepted.text();
        assertStringIncludes(html, '<link rel="stylesheet" href="/theme.css"');
        assertStringIncludes(html, 'aria-label="Search Plans"');
        assertStringIncludes(html, 'value="workspace"');
        assertEquals(html.includes("matching Plan"), false);
        assertEquals(html.includes("searchable Plan"), false);
        assertStringIncludes(html, 'data-plan-search-card="workspace-card-id"');
        assertStringIncludes(html, 'href="/plans/workspace-card-id?token=secret&amp;q=workspace"');
        assertStringIncludes(html, 'href="/closed?token=secret&amp;q=workspace"');
        assertStringIncludes(html, "Draft");
        assertStringIncludes(html, "Ready for Work");
        assertStringIncludes(html, "workspace-card");
        assertStringIncludes(html, "SSR card");
        assertStringIncludes(html, 'class="complexity-label complexity-medium"');
        assertStringIncludes(html, 'data-plan-board="true"');
        assertStringIncludes(html, 'data-draggable-plan-card="true"');
        assertStringIncludes(html, 'draggable="true"');
        assertStringIncludes(
            html,
            'data-allowed-target-statuses="feedback approved ready_for_work in_progress implemented"',
        );
        assertStringIncludes(html, 'data-action-target-status="draft"');
        assertStringIncludes(html, "Drag this Plan Card to an allowed status column");
        assertEquals(html.includes("Move to Feedback"), false);
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("Workspace API and detail route return readable editable Plan body metadata", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(
            cwd,
            "detail",
            "# Detail\n\nReadable body with [RunWield](https://runwield.dev)",
            /** @type {any} */ ({
                planId: "detail-id",
                status: "implemented",
                classification: "FEATURE",
                complexity: "HIGH",
                summary: "Detail summary",
                affectedPaths: ["src/ui/workspace/components/PlanDetail.jsx"],
                dependencies: ["sibling-plan"],
                implementedAt: "2026-06-30T10:00:00.000Z",
                executionBaselineTree: "tree-detail",
                worktreeId: "wt-detail",
                worktreePath: "/tmp/secret-worktree-path",
                worktreeBranch: "runwield/worktree/detail",
                worktreeStatus: "active",
                humanReviewMode: "ask",
                humanReviewDecision: "approved",
                humanReviewedAt: "2026-06-30T11:00:00.000Z",
                customPriority: "urgent",
            }),
        );
        const board = await loadBoard(cwd);
        assertEquals(board.plans.length, 1);

        const app = createWorkspaceApp({ cwd, token: "secret" }).handler();
        const api = await app(
            new Request("http://localhost/api/plans/detail-id", {
                headers: { [PLAN_UI_TOKEN_HEADER]: "secret" },
            }),
        );
        assertEquals(api.status, 200);
        const apiBody = await api.json();
        assertEquals(apiBody.plan.readOnly, true);
        assertEquals(typeof apiBody.plan.bodyHash, "string");
        assertEquals(apiBody.plan.capabilities.bodyEditing, true);
        assertEquals(Object.hasOwn(apiBody.plan, "path"), false);
        assertEquals(Object.hasOwn(apiBody.plan.frontMatter, "worktreePath"), false);
        assertEquals(Object.hasOwn(apiBody.plan.attrs, "worktreePath"), false);

        const detail = await app(new Request("http://localhost/plans/detail-id?token=secret"));
        const html = await detail.text();
        assertStringIncludes(html, "Readable body");
        assertStringIncludes(html, 'class="complexity-label complexity-high"');
        assertStringIncludes(html, 'href="https://runwield.dev"');
        assertStringIncludes(html, "RunWield");
        assertStringIncludes(html, ">Put on hold</button>");
        assertStringIncludes(html, 'class="danger-action lifecycle-action"');
        assertStringIncludes(html, ">Close without verification</button>");
        assertStringIncludes(html, 'class="detail-title-row"');
        assertStringIncludes(html, "&lt; Back</a>");
        assertStringIncludes(html, 'class="detail-close-link"');
        assertStringIncludes(html, 'aria-label="Close plan detail"');
        assertStringIncludes(html, ">X</a>");
        assertStringIncludes(html, ">Edit</a>");
        assertEquals(html.includes(">Close</a>"), false);
        assertStringIncludes(html, "edit=body");
        assertEquals(html.includes("Front matter summary"), false);
        assertStringIncludes(html, "Identity");
        assertStringIncludes(html, "Planning");
        assertStringIncludes(html, "Hierarchy &amp; dependencies");
        assertStringIncludes(html, "Lifecycle");
        assertStringIncludes(html, "Execution worktree");
        assertStringIncludes(html, "Review");
        assertStringIncludes(html, "Additional metadata");
        assertStringIncludes(html, "Plan ID");
        assertStringIncludes(html, "detail-id");
        assertStringIncludes(html, "Affected paths");
        assertStringIncludes(html, "src/ui/workspace/components/PlanDetail.jsx");
        assertStringIncludes(html, "Depends on");
        assertStringIncludes(html, "sibling-plan");
        assertStringIncludes(html, "Implemented at");
        assertStringIncludes(html, "2026-06-30T10:00:00.000Z");
        assertStringIncludes(html, "Execution baseline tree");
        assertStringIncludes(html, "tree-detail");
        assertStringIncludes(html, "Worktree branch");
        assertStringIncludes(html, "runwield/worktree/detail");
        assertStringIncludes(html, "Human review decision");
        assertStringIncludes(html, "approved");
        assertStringIncludes(html, "Custom Priority");
        assertStringIncludes(html, "urgent");
        assertEquals(html.includes("/tmp/secret-worktree-path"), false);
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("Workspace body-save API preserves front matter rejects stale writes and requires token", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await Deno.mkdir(`${cwd}/plans`, { recursive: true });
        const frontMatter =
            "---\nplanId: api-id\n# comment remains\nclassification: FEATURE\nstatus: draft\nunknown: kept\n---\n";
        await Deno.writeTextFile(`${cwd}/plans/api.md`, `${frontMatter}# Original\n`);
        const loaded = await loadPlanBodyById(cwd, "api-id");
        const app = createWorkspaceApp({ cwd, token: "secret" }).handler();

        const rejected = await app(new Request("http://localhost/api/plans/api-id/body", { method: "POST" }));
        assertEquals(rejected.status, 401);

        const invalid = await app(
            new Request("http://localhost/api/plans/api-id/body", {
                method: "POST",
                headers: { [PLAN_UI_TOKEN_HEADER]: "secret", "content-type": "application/json" },
                body: JSON.stringify({ body: 1, expectedBodyHash: loaded.bodyHash }),
            }),
        );
        assertEquals(invalid.status, 400);

        const saved = await app(
            new Request("http://localhost/api/plans/api-id/body", {
                method: "POST",
                headers: { [PLAN_UI_TOKEN_HEADER]: "secret", "content-type": "application/json" },
                body: JSON.stringify({ body: "# Saved\n", expectedBodyHash: loaded.bodyHash }),
            }),
        );
        assertEquals(saved.status, 200);
        const savedBody = await saved.json();
        assertEquals(typeof savedBody.bodyHash, "string");
        assertEquals(await Deno.readTextFile(`${cwd}/plans/api.md`), `${frontMatter}# Saved\n`);

        const stale = await app(
            new Request("http://localhost/api/plans/api-id/body", {
                method: "POST",
                headers: { [PLAN_UI_TOKEN_HEADER]: "secret", "content-type": "application/json" },
                body: JSON.stringify({ body: "# Stale\n", expectedBodyHash: loaded.bodyHash }),
            }),
        );
        assertEquals(stale.status, 409);
        assertStringIncludes((await stale.json()).error, "changed on disk");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("Workspace Epic detail SSR-renders child FEATURE Plans by status", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(
            cwd,
            "epic",
            "# Epic\n\nEpic body",
            /** @type {any} */ ({
                planId: "epic-id",
                status: "draft",
                classification: "PROJECT",
                type: "epic",
                summary: "Epic summary",
                epicCompletionMode: "done_enough",
                epicDoneEnoughAt: "2026-06-30T12:00:00.000Z",
                epicDoneEnoughSummary: "Shipped enough",
                customRisk: false,
            }),
        );
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

        const onHoldBoard = await app(new Request("http://localhost/on-hold?token=secret"));
        const onHoldBoardHtml = await onHoldBoard.text();
        assertStringIncludes(onHoldBoardHtml, "held from in_progress; held at 2026-01-03T00:00:00.000Z");
        assertStringIncludes(onHoldBoardHtml, "reason: waiting for budget");

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
        assertEquals(detailHtml.includes("Front matter summary"), false);
        assertStringIncludes(detailHtml, "Epic metadata");
        assertStringIncludes(detailHtml, "Identity");
        assertStringIncludes(detailHtml, "Planning");
        assertStringIncludes(detailHtml, "Epic completion");
        assertStringIncludes(detailHtml, "Epic completion mode");
        assertStringIncludes(detailHtml, "done_enough");
        assertStringIncludes(detailHtml, "Epic done enough at");
        assertStringIncludes(detailHtml, "2026-06-30T12:00:00.000Z");
        assertStringIncludes(detailHtml, "Additional metadata");
        assertStringIncludes(detailHtml, "Custom Risk");
        assertStringIncludes(detailHtml, "false");

        const heldDetail = await app(new Request("http://localhost/plans/held-epic-id?token=secret"));
        const heldDetailHtml = await heldDetail.text();
        assertStringIncludes(heldDetailHtml, "Epic on hold from in_progress at 2026-01-03T00:00:00.000Z");
        assertStringIncludes(heldDetailHtml, "reason: waiting for budget");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("workspace lifecycle action metadata blocks protected status movement and exposes DnD seams", () => {
    const summary = serializePlanSummary({
        planId: "p1",
        planName: "plan",
        relativePath: "plans/plan.md",
        attrs: { planId: "p1", status: "draft", classification: "FEATURE" },
    });
    assertEquals(summary.actions.allowedManualTargetStatuses.includes("verified"), false);
    assertEquals(summary.actions.allowedManualTargetStatuses.includes("failed"), false);
    assertEquals(summary.actions.canPutOnHold, true);
    assertEquals(createMoveStatusIntent({ planId: "p1", fromStatus: "draft", toStatus: "approved" }), {
        planId: "p1",
        fromStatus: "draft",
        action: "move_status",
        targetStatus: "approved",
    });
    assertEquals(lifecycleActionLabel(summary.actions, "put_on_hold"), summary.actions.metadata.put_on_hold.label);
    assertEquals(createPutOnHoldIntent({ planId: "p1", fromStatus: "draft", holdReason: "" }), {
        planId: "p1",
        fromStatus: "draft",
        action: "put_on_hold",
        holdReason: "",
    });
    assertEquals(createPutOnHoldIntent({ planId: "p1", fromStatus: "draft", holdReason: null }), null);

    const allowed = parseAllowedTargetStatuses("feedback approved ready_for_work");
    assertEquals(
        isAllowedDropTarget({ fromStatus: "draft", targetStatus: "approved", allowedTargetStatuses: allowed }),
        true,
    );
    assertEquals(
        isAllowedDropTarget({ fromStatus: "draft", targetStatus: "draft", allowedTargetStatuses: allowed }),
        false,
    );
    assertEquals(
        isAllowedDropTarget({ fromStatus: "draft", targetStatus: "verified", allowedTargetStatuses: allowed }),
        false,
    );
    assertEquals(
        blockedDropMessage({ planName: "p1", targetStatus: "verified", allowedTargetStatuses: allowed }),
        "p1 cannot move to verified. Available columns: feedback, approved, ready_for_work.",
    );
});

Deno.test("Workspace lifecycle API mutates through lifecycle events and blocks invalid actions", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "feature", "# Feature", {
            planId: "feature-id",
            status: "draft",
            classification: "FEATURE",
        });
        await savePlan(cwd, "held", "# Held", {
            planId: "held-id",
            status: "on_hold",
            heldFromStatus: "in_progress",
            classification: "FEATURE",
        });
        const app = createWorkspaceApp({ cwd, token: "secret" }).handler();
        const missingToken = await app(
            new Request("http://localhost/api/plans/feature-id/lifecycle-action", {
                method: "POST",
                body: JSON.stringify({ action: "move_status", targetStatus: "approved" }),
            }),
        );
        assertEquals(missingToken.status, 401);

        const invalid = await app(
            new Request("http://localhost/api/plans/feature-id/lifecycle-action", {
                method: "POST",
                headers: { [PLAN_UI_TOKEN_HEADER]: "secret", "content-type": "application/json" },
                body: JSON.stringify({ action: "move_status", targetStatus: "verified" }),
            }),
        );
        assertEquals(invalid.status, 409);

        const moved = await app(
            new Request("http://localhost/api/plans/feature-id/lifecycle-action", {
                method: "POST",
                headers: { [PLAN_UI_TOKEN_HEADER]: "secret", "content-type": "application/json" },
                body: JSON.stringify({ action: "move_status", targetStatus: "approved" }),
            }),
        );
        assertEquals(moved.status, 200);
        assertEquals((await loadWorkspaceDetail(cwd, "feature-id")).status, "approved");

        const held = await app(
            new Request("http://localhost/api/plans/feature-id/lifecycle-action", {
                method: "POST",
                headers: { [PLAN_UI_TOKEN_HEADER]: "secret", "content-type": "application/json" },
                body: JSON.stringify({ action: "put_on_hold", holdReason: "pause" }),
            }),
        );
        assertEquals(held.status, 200);
        let loaded = await loadWorkspaceDetail(cwd, "feature-id");
        assertEquals(loaded.status, "on_hold");
        assertEquals(loaded.heldFromStatus, "approved");
        assertEquals(loaded.holdReason, "pause");

        const reset = await app(
            new Request("http://localhost/api/plans/feature-id/lifecycle-action", {
                method: "POST",
                headers: { [PLAN_UI_TOKEN_HEADER]: "secret", "content-type": "application/json" },
                body: JSON.stringify({ action: "reset_to_draft" }),
            }),
        );
        assertEquals(reset.status, 200);
        loaded = await loadWorkspaceDetail(cwd, "feature-id");
        assertEquals(loaded.status, "draft");
        assertEquals(loaded.heldFromStatus, "");

        const resumed = await app(
            new Request("http://localhost/api/plans/held-id/lifecycle-action", {
                method: "POST",
                headers: { [PLAN_UI_TOKEN_HEADER]: "secret", "content-type": "application/json" },
                body: JSON.stringify({ action: "resume_from_hold" }),
            }),
        );
        assertEquals(resumed.status, 200);
        assertEquals((await loadWorkspaceDetail(cwd, "held-id")).status, "in_progress");

        const closed = await app(
            new Request("http://localhost/api/plans/feature-id/lifecycle-action", {
                method: "POST",
                headers: { [PLAN_UI_TOKEN_HEADER]: "secret", "content-type": "application/json" },
                body: JSON.stringify({ action: "close_without_verification" }),
            }),
        );
        assertEquals(closed.status, 200);
        loaded = await loadWorkspaceDetail(cwd, "feature-id");
        assertEquals(loaded.status, "closed_without_verification");
        assertEquals(loaded.frontMatter.verifiedAt, undefined);
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("Workspace lifecycle API requires Resume Check confirmation for staleness warnings", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "held-warning", "# Held Warning", {
            planId: "held-warning-id",
            status: "on_hold",
            heldFromStatus: "ready_for_work",
            holdStalenessBaseline: "baseline",
            classification: "FEATURE",
        });
        const app = createWorkspaceApp({ cwd, token: "secret" }).handler();
        const warned = await app(
            new Request("http://localhost/api/plans/held-warning-id/lifecycle-action", {
                method: "POST",
                headers: { [PLAN_UI_TOKEN_HEADER]: "secret", "content-type": "application/json" },
                body: JSON.stringify({ action: "resume_from_hold" }),
            }),
        );
        assertEquals(warned.status, 409);
        const warningBody = await warned.json();
        assertEquals(warningBody.requiresConfirmation, true);

        const accepted = await app(
            new Request("http://localhost/api/plans/held-warning-id/lifecycle-action", {
                method: "POST",
                headers: { [PLAN_UI_TOKEN_HEADER]: "secret", "content-type": "application/json" },
                body: JSON.stringify({ action: "resume_from_hold", acceptResumeWarnings: true }),
            }),
        );
        assertEquals(accepted.status, 200);
        assertEquals((await loadWorkspaceDetail(cwd, "held-warning-id")).status, "ready_for_work");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("Workspace Resume Check does not expose absolute worktree paths in blocked API responses", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        const missingWorktreePath = `${cwd}/missing-worktree`;
        await savePlan(cwd, "held-leak", "# Held Leak", {
            planId: "held-leak-id",
            status: "on_hold",
            heldFromStatus: "ready_for_work",
            worktreePath: missingWorktreePath,
            worktreeBranch: "missing-branch",
            classification: "FEATURE",
        });
        const app = createWorkspaceApp({ cwd, token: "secret" }).handler();
        const response = await app(
            new Request("http://localhost/api/plans/held-leak-id/lifecycle-action", {
                method: "POST",
                headers: { [PLAN_UI_TOKEN_HEADER]: "secret", "content-type": "application/json" },
                body: JSON.stringify({ action: "resume_from_hold" }),
            }),
        );
        assertEquals(response.status, 409);
        const bodyText = await response.text();
        assertEquals(bodyText.includes(cwd), false);
        assertEquals(bodyText.includes(missingWorktreePath), false);
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("Workspace Resume Check blocks resume when recorded branch cannot be determined", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await git(cwd, ["init", "-b", "main"]);
        await git(cwd, ["config", "user.email", "test@example.com"]);
        await git(cwd, ["config", "user.name", "Test User"]);
        await Deno.writeTextFile(`${cwd}/README.md`, "hello\n");
        await git(cwd, ["add", "README.md"]);
        await git(cwd, ["commit", "-m", "initial"]);
        const head = (await git(cwd, ["rev-parse", "HEAD"])).trim();
        await git(cwd, ["checkout", "--detach", head]);

        const resumeCheck = await runWorkspaceResumeCheck(cwd, {
            status: "on_hold",
            heldFromStatus: "ready_for_work",
            worktreePath: cwd,
            worktreeBranch: "main",
        });

        assertEquals(resumeCheck.ok, false);
        assertEquals(
            resumeCheck.failures.includes("Recorded worktree branch could not be determined for verification."),
            true,
        );
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});
