import { assertEquals, assertStringIncludes } from "@std/assert";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
import { buildPlanBoardSearchIndex, PlanBoard } from "./components/Board.jsx";
import { renderMarkdown } from "./components/MarkdownView.jsx";
import { PlanDetail } from "./components/PlanDetail.jsx";
import { detailHref, workspaceHref } from "./components/PlanCard.jsx";
import { draftRecoveryState, planBodyDraftKey, restoredDraftExpectedBodyHash } from "./islands/PlanBodyEditor.jsx";
import { blockedDropMessage, isAllowedDropTarget, parseAllowedTargetStatuses } from "./islands/PlanBoardDragDrop.jsx";
import { matchingPlanIds, normalizePlanSearchQuery, PLAN_SEARCH_QUERY_PARAM } from "./islands/PlanBoardSearch.jsx";
import {
    createMoveStatusIntent,
    createPutOnHoldIntent,
    lifecycleActionLabel,
} from "./islands/PlanLifecycleActions.jsx";
import { renderRunWieldThemeCss } from "../design-system/theme-bridge.js";
import {
    createReviewWorkspaceApp,
    createWorkspaceApp,
    hasWorkspaceToken,
    startReviewWorkspaceServer,
} from "./server.js";
import { COLLABORATION_STATE_REMOTE_CANONICAL } from "../../shared/collaboration/lock.js";
import { hashCapability } from "../../shared/collaboration/capabilities.js";
import { openRemoteDatabase } from "./server/remote-db.js";
import { createRemoteWorkspaceAdapter } from "./server/remote-adapter.js";
import { registerReviewDecisionPromise, unregisterReviewDecision } from "./routes/api/review-handlers.js";

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

Deno.test("workspace static assets bypass token checks for tokenized pages", async () => {
    const app = createWorkspaceApp({ cwd: Deno.cwd(), token: "secret" }).handler();
    for (const path of ["/tokens.css", "/components.css", "/workspace.css", "/theme.css", "/logo.svg"]) {
        const response = await app(new Request(`http://localhost${path}`));
        assertEquals(response.status, 200);
    }
});

Deno.test("review request forwarding does not inherit Deno.serve's legacy abort signal", async () => {
    const script = `
        import { rebuildRequestWithHeaders } from "./src/ui/workspace/server.js";
        const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, (request) => {
            rebuildRequestWithHeaders(request, new Headers(request.headers));
            return new Response("ok");
        });
        await fetch(\`http://127.0.0.1:\${server.addr.port}\`);
        await server.shutdown();
    `;
    const output = await new Deno.Command(Deno.execPath(), {
        args: ["eval", script],
        cwd: Deno.cwd(),
        stdout: "piped",
        stderr: "piped",
    }).output();

    assertEquals(output.success, true);
    assertEquals(new TextDecoder().decode(output.stderr), "");
});

Deno.test("review server reports stdout through its output callback", async () => {
    /** @type {Array<{ stream: "stdout" | "stderr", text: string }>} */
    const output = [];
    const server = startReviewWorkspaceServer({
        cwd: Deno.cwd(),
        token: "review-output",
        reviewPayload: { plan: "# Plan" },
        reviewType: "plan",
        onOutput: (entry) => output.push(entry),
    });

    await server.stop();

    assertEquals(output.length, 1);
    assertEquals(output[0].stream, "stdout");
    assertStringIncludes(output[0].text, "Listening on http://127.0.0.1:");
});

Deno.test("review page accepts Unicode Plan payloads", async () => {
    const token = "review-secret";
    const app = createReviewWorkspaceApp({
        cwd: Deno.cwd(),
        token,
        reviewPayload: { plan: "# Café 🚀\n", planPath: "plans/café.md" },
        reviewType: "plan",
    }).handler();

    const response = await app(new Request(`http://localhost/review/plan?token=${token}`));
    assertEquals(response.status < 500, true);
});

Deno.test("review API accepts review token header before workspace app token gate", async () => {
    const token = "review-secret";
    const { promise } = registerReviewDecisionPromise(token);
    try {
        const app = createReviewWorkspaceApp({
            cwd: Deno.cwd(),
            token,
            reviewPayload: {},
            reviewType: "code",
        }).handler();

        const response = await app(
            new Request("http://localhost/api/review/feedback", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-runwield-review-token": token,
                },
                body: JSON.stringify({ approved: false, feedback: "fix annotations" }),
            }),
        );

        assertEquals(response.status, 200);
        assertEquals(await promise, {
            approved: false,
            feedback: "fix annotations",
            annotations: [],
            agentSwitch: undefined,
        });
    } finally {
        unregisterReviewDecision(token);
    }
});

Deno.test("Code review approval preserves comments and attached images", async () => {
    const token = "code-approval-secret";
    const { promise } = registerReviewDecisionPromise(token);
    try {
        const app = createReviewWorkspaceApp({
            cwd: Deno.cwd(),
            token,
            reviewPayload: {},
            reviewType: "code",
        }).handler();
        const annotations = [{
            id: "code-approval-comment",
            type: "comment",
            scope: "general",
            filePath: "",
            lineStart: 0,
            lineEnd: 0,
            side: "new",
            text: "Keep this implementation detail.",
            images: [{ path: "/tmp/code-approval.png", name: "code-approval" }],
        }];

        const response = await app(
            new Request("http://localhost/api/review/feedback", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-runwield-review-token": token,
                },
                body: JSON.stringify({
                    approved: true,
                    feedback: "# Code Review Feedback\n\nKeep this implementation detail.",
                    annotations,
                }),
            }),
        );

        assertEquals(response.status, 200);
        assertEquals(await promise, {
            approved: true,
            feedback: "# Code Review Feedback\n\nKeep this implementation detail.",
            annotations,
            images: [{ path: "/tmp/code-approval.png", name: "code-approval" }],
            agentSwitch: undefined,
        });
    } finally {
        unregisterReviewDecision(token);
    }
});

Deno.test("Plan review feedback preserves all annotations and the edited Plan", async () => {
    const token = "plan-feedback-secret";
    const { promise } = registerReviewDecisionPromise(token);
    try {
        const app = createReviewWorkspaceApp({
            cwd: Deno.cwd(),
            token,
            reviewPayload: {},
            reviewType: "plan",
        }).handler();
        const annotations = [
            {
                id: "annotation-1",
                type: "COMMENT",
                text: "Clarify this section.",
                images: [{ path: "/tmp/annotated.png", name: "annotated" }],
            },
            { id: "annotation-2", type: "DELETION", text: "Remove this sentence." },
        ];
        const globalAttachments = [{ path: "/tmp/reference.png", name: "reference" }];

        const response = await app(
            new Request("http://localhost/api/review/deny", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-runwield-review-token": token,
                },
                body: JSON.stringify({
                    feedback: "# Plan Feedback\n\nClarify this section.",
                    annotations,
                    globalAttachments,
                    plan: "# Edited Plan\n",
                    planSave: { enabled: true, path: "plans/edited.md" },
                }),
            }),
        );

        assertEquals(response.status, 200);
        assertEquals(await promise, {
            approved: false,
            feedback: "# Plan Feedback\n\nClarify this section.",
            annotations,
            globalAttachments,
            images: [
                { path: "/tmp/reference.png", name: "reference" },
                { path: "/tmp/annotated.png", name: "annotated" },
            ],
            plan: "# Edited Plan\n",
            savedPath: "plans/edited.md",
        });
    } finally {
        unregisterReviewDecision(token);
    }
});

Deno.test("Plan approval preserves annotations, global images, and the edited Plan", async () => {
    const token = "plan-approval-secret";
    const { promise } = registerReviewDecisionPromise(token);
    try {
        const app = createReviewWorkspaceApp({
            cwd: Deno.cwd(),
            token,
            reviewPayload: {},
            reviewType: "plan",
        }).handler();
        const annotations = [{
            id: "approval-annotation",
            type: "COMMENT",
            text: "Keep the command wording.",
            images: [{ path: "/tmp/approval-inline.png", name: "approval-inline" }],
        }];
        const globalAttachments = [{ path: "/tmp/approval-global.png", name: "approval-global" }];

        const response = await app(
            new Request("http://localhost/api/review/decision", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-runwield-review-token": token,
                },
                body: JSON.stringify({
                    approved: true,
                    feedback: "# Approval annotations\n\nKeep the command wording.",
                    annotations,
                    globalAttachments,
                    plan: "# Approved edited Plan\n",
                    planSave: { enabled: true, path: "plans/approved.md" },
                }),
            }),
        );

        assertEquals(response.status, 200);
        assertEquals(await promise, {
            approved: true,
            feedback: "# Approval annotations\n\nKeep the command wording.",
            annotations,
            globalAttachments,
            images: [
                { path: "/tmp/approval-global.png", name: "approval-global" },
                { path: "/tmp/approval-inline.png", name: "approval-inline" },
            ],
            plan: "# Approved edited Plan\n",
            savedPath: "plans/approved.md",
            agentSwitch: undefined,
            permissionMode: undefined,
        });
    } finally {
        unregisterReviewDecision(token);
    }
});

Deno.test("review image endpoints upload and serve an annotated image", async () => {
    const token = "review-image-secret";
    const app = createReviewWorkspaceApp({
        cwd: Deno.cwd(),
        token,
        reviewPayload: {},
        reviewType: "plan",
    }).handler();
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const formData = new FormData();
    formData.set("file", new File([bytes], "annotated.png", { type: "image/png" }));

    const upload = await app(
        new Request(`http://localhost/api/upload?token=${token}`, {
            method: "POST",
            body: formData,
        }),
    );
    assertEquals(upload.status, 200);
    const uploaded = await upload.json();

    try {
        const image = await app(
            new Request(`http://localhost/api/image?token=${token}&path=${encodeURIComponent(uploaded.path)}`),
        );
        assertEquals(image.status, 200);
        assertEquals(image.headers.get("content-type"), "image/png");
        assertEquals(new Uint8Array(await image.arrayBuffer()), bytes);
    } finally {
        await Deno.remove(uploaded.path).catch(() => {});
    }
});

Deno.test("code review host serves safe file content and disables unsupported open-in actions", async () => {
    const token = "review-file-secret";
    const cwd = await Deno.makeTempDir({ prefix: "runwield-review-files-" });
    await Deno.mkdir(`${cwd}/src`);
    await Deno.writeTextFile(`${cwd}/src/example.js`, "export const fixture = true;\n");
    const app = createReviewWorkspaceApp({
        cwd,
        token,
        reviewPayload: {},
        reviewType: "code",
    }).handler();
    const headers = { referer: `http://localhost/review/code?token=${token}` };

    try {
        const content = await app(
            new Request("http://localhost/api/file-content?path=src%2Fexample.js", { headers }),
        );
        assertEquals(content.status, 200);
        assertEquals(await content.json(), {
            oldContent: null,
            newContent: "export const fixture = true;\n",
        });

        const traversal = await app(
            new Request("http://localhost/api/file-content?path=..%2Foutside.js", { headers }),
        );
        assertEquals(traversal.status, 403);

        const apps = await app(new Request("http://localhost/api/open-in/apps", { headers }));
        assertEquals(apps.status, 200);
        assertEquals(await apps.json(), { available: false, apps: [] });

        const config = await app(new Request("http://localhost/api/config", { method: "POST", headers }));
        assertEquals(config.status, 200);
        assertEquals(await config.json(), { ok: true });
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("review API returns 401 for invalid token and 404 for expired matching token", async () => {
    const app = createReviewWorkspaceApp({
        cwd: Deno.cwd(),
        token: "expected-review-token",
        reviewPayload: {},
        reviewType: "plan",
    }).handler();

    const invalidResponse = await app(
        new Request("http://localhost/api/review/decision", {
            method: "POST",
            headers: { "x-runwield-review-token": "wrong-review-token" },
        }),
    );
    assertEquals(invalidResponse.status, 401);

    const expiredResponse = await app(
        new Request("http://localhost/api/review/decision", {
            method: "POST",
            headers: { "x-runwield-review-token": "expected-review-token" },
        }),
    );
    assertEquals(expiredResponse.status, 404);
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

Deno.test("renderRunWieldThemeCss maps agent theme tokens to workspace CSS variables", () => {
    const css = renderRunWieldThemeCss({
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
    assertStringIncludes(css, ".theme-runwield {");
    assertStringIncludes(css, "--background: var(--rw-page-bg);");
    assertStringIncludes(css, "--primary: var(--rw-accent);");
});

Deno.test("renderRunWieldThemeCss renders bundled Catppuccin Mocha export colors", async () => {
    const themeJson = JSON.parse(
        await Deno.readTextFile(new URL("../theme/catppuccin-mocha.json", import.meta.url)),
    );
    const css = renderRunWieldThemeCss(themeJson);

    assertStringIncludes(css, '--rw-theme-name: "catppuccin-mocha"');
    assertStringIncludes(css, "--rw-page-bg: #11111b;");
    assertStringIncludes(css, "--rw-surface: #181825;");
    assertStringIncludes(css, "--rw-surface-raised: #313244;");
    assertStringIncludes(css, "--rw-text: #cdd6f4;");
    assertStringIncludes(css, "--rw-accent: #cba6f7;");
});

Deno.test("workspace detail header CSS lets lifecycle actions wrap without squeezing summary", async () => {
    const workspaceCss = await Deno.readTextFile(new URL("./static/workspace.css", import.meta.url));
    const componentsCss = await Deno.readTextFile(new URL("../design-system/components.css", import.meta.url));
    assertStringIncludes(workspaceCss, ".detail-title-row {\n    align-items: center;\n    display: grid;");
    assertStringIncludes(workspaceCss, "grid-template-columns: auto minmax(0, 1fr) auto;");
    assertStringIncludes(workspaceCss, ".split-header {\n    align-items: flex-start;\n    display: grid;");
    assertStringIncludes(workspaceCss, "grid-template-columns: minmax(0, 1fr);");
    assertStringIncludes(workspaceCss, ".header-actions .lifecycle-actions {\n    flex: 1 1 100%;");
    assertStringIncludes(
        workspaceCss,
        ".tabs a,\n    .tab-search-slot,\n    .plan-search-clear {\n        box-sizing: border-box;",
    );
    assertStringIncludes(workspaceCss, ".detail-grid > * {\n    min-width: 0;");
    assertStringIncludes(componentsCss, ".markdown-view {\n    background:");
    assertStringIncludes(componentsCss, "overflow-wrap: anywhere;");
});

Deno.test("Workspace wrapper protects page routes and serves public assets without token", async () => {
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
        const pageResponse = await app(new Request("http://localhost/?token=secret&q=workspace"));
        const pageBody = await pageResponse.text();
        if (pageResponse.status === 503) {
            assertStringIncludes(pageBody, "Workspace Astro build unavailable");
        } else {
            assertEquals(pageResponse.status, 200);
            assertStringIncludes(pageBody, "workspace-card");
        }
        const tokensCss = await app(new Request("http://localhost/tokens.css"));
        assertEquals(tokensCss.status, 200);
        assertStringIncludes(await tokensCss.text(), "--rw-page-bg:");
        const componentsCss = await app(new Request("http://localhost/components.css"));
        assertEquals(componentsCss.status, 200);
        assertStringIncludes(await componentsCss.text(), ".primary-action");
        const workspaceCss = await app(new Request("http://localhost/workspace.css"));
        assertEquals(workspaceCss.status, 200);
        assertStringIncludes(await workspaceCss.text(), ".workspace-shell");
        const themeCss = await app(new Request("http://localhost/theme.css"));
        assertEquals(themeCss.status, 200);
        assertEquals(themeCss.headers.get("cache-control"), "no-store");
        assertStringIncludes(await themeCss.text(), "--rw-theme-name:");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("PlanBoard SSR renders status column board cards", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "workspace-card", "# Workspace Card\n\nBody", {
            planId: "workspace-card-id",
            status: "draft",
            classification: "FEATURE",
            summary: "SSR card",
        });
        const board = await loadBoard(cwd);
        const html = renderToStaticMarkup(
            React.createElement(PlanBoard, {
                board,
                view: "active",
                url: "http://localhost/?token=secret&q=workspace",
                staticRender: true,
            }),
        );
        assertStringIncludes(html, 'aria-label="Search Plans"');
        assertStringIncludes(html, 'value="workspace"');
        assertEquals(html.includes("matching Plan"), false);
        assertEquals(html.includes("searchable Plan"), false);
        assertStringIncludes(html, 'data-plan-search-card="workspace-card-id"');
        assertStringIncludes(html, 'href="/plans/workspace-card-id?token=secret&amp;q=workspace"');
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

Deno.test("Workspace page routes require Astro handler instead of static React fallback", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "one", "# One\n", {
            planId: "duplicate-id",
            status: "draft",
            classification: "FEATURE",
            summary: "One",
        });
        await savePlan(cwd, "two", "# Two\n", {
            planId: "duplicate-id",
            status: "draft",
            classification: "FEATURE",
            summary: "Two",
        });
        const app = createWorkspaceApp({ cwd, token: "secret" }).handler();
        const response = await app(new Request("http://localhost/?token=secret"));
        const body = await response.text();
        if (response.status === 503) {
            assertStringIncludes(body, "Workspace Astro build unavailable");
            assertEquals(body.includes("Duplicate planId"), false);
        } else {
            assertEquals(response.status, 409);
            assertStringIncludes(body, "Duplicate planId");
        }
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

        const plan = await loadWorkspaceDetail(cwd, "detail-id");
        const html = renderToStaticMarkup(
            React.createElement(PlanDetail, {
                plan,
                url: "http://localhost/plans/detail-id?token=secret",
                staticRender: true,
            }),
        );
        assertStringIncludes(html, "Readable body");
        assertStringIncludes(html, "data-plannotator-plan-body");
        assertStringIncludes(html, "data-plannotator-plan-body-json");
        assertStringIncludes(html, "data-plannotator-plan-body-root");
        assertStringIncludes(html, "Readable body");
        assertStringIncludes(html, 'data-plan-id="detail-id"');
        assertStringIncludes(html, 'data-plannotator-renderer="ssr-fallback"');
        assertStringIncludes(html, 'class="markdown-view"');
        assertStringIncludes(html, 'class="complexity-label complexity-high"');
        assertStringIncludes(html, 'href="https://runwield.dev"');
        assertStringIncludes(html, ">RunWield</a>");
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

Deno.test("Workspace detail SSR fallback renders visible empty Plan body state", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "empty-detail", "", {
            planId: "empty-detail-id",
            status: "draft",
            classification: "FEATURE",
            summary: "Empty body detail",
        });

        const plan = await loadWorkspaceDetail(cwd, "empty-detail-id");
        const html = renderToStaticMarkup(
            React.createElement(PlanDetail, {
                plan,
                url: "http://localhost/plans/empty-detail-id?token=secret",
                staticRender: true,
            }),
        );
        assertStringIncludes(html, "data-plannotator-plan-body");
        assertStringIncludes(html, 'data-plannotator-renderer="ssr-fallback"');
        assertStringIncludes(html, 'class="markdown-view"');
        assertStringIncludes(html, "No Plan body content.");
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

        await savePlan(cwd, "epic", "# Epic\n", {
            planId: "epic-id",
            classification: "PROJECT",
            type: "epic",
            status: "draft",
        });
        const epicRejected = await app(
            new Request("http://localhost/api/plans/epic-id/body", {
                method: "POST",
                headers: { [PLAN_UI_TOKEN_HEADER]: "secret", "content-type": "application/json" },
                body: JSON.stringify({ body: "# Edited Epic\n", expectedBodyHash: "hash" }),
            }),
        );
        assertEquals(epicRejected.status, 409);
        assertStringIncludes((await epicRejected.json()).error, "Epic Plan bodies are not editable");
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
        const board = await loadBoard(cwd);
        const boardHtml = renderToStaticMarkup(
            React.createElement(PlanBoard, {
                board,
                view: "active",
                url: "http://localhost/?token=secret",
                staticRender: true,
            }),
        );
        assertStringIncludes(boardHtml, "Epic summary");
        assertStringIncludes(boardHtml, "Orphan summary");
        assertStringIncludes(boardHtml, "Missing parent Epic");
        assertEquals(boardHtml.includes("Child summary"), false);

        const onHoldBoardHtml = renderToStaticMarkup(
            React.createElement(PlanBoard, {
                board,
                view: "onHold",
                url: "http://localhost/on-hold?token=secret",
                staticRender: true,
            }),
        );
        assertStringIncludes(onHoldBoardHtml, "held from in_progress; held at 2026-01-03T00:00:00.000Z");
        assertStringIncludes(onHoldBoardHtml, "reason: waiting for budget");

        const detailPlan = await loadWorkspaceDetail(cwd, "epic-id");
        const detailHtml = renderToStaticMarkup(
            React.createElement(PlanDetail, {
                plan: detailPlan,
                url: "http://localhost/plans/epic-id?token=secret",
                staticRender: true,
            }),
        );
        assertStringIncludes(detailHtml, 'class="detail-title-row"');
        assertStringIncludes(detailHtml, "&lt; Back</a>");
        assertStringIncludes(detailHtml, 'class="detail-close-link"');
        assertStringIncludes(detailHtml, 'aria-label="Close plan detail"');
        assertStringIncludes(detailHtml, ">X</a>");
        assertEquals(detailHtml.includes('class="detail-sidebar-edit"'), false);
        assertEquals(detailHtml.includes("edit=body"), false);
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
        assertStringIncludes(detailHtml, "Metadata");
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

        const heldDetailPlan = await loadWorkspaceDetail(cwd, "held-epic-id");
        const heldDetailHtml = renderToStaticMarkup(
            React.createElement(PlanDetail, {
                plan: heldDetailPlan,
                url: "http://localhost/plans/held-epic-id?token=secret",
                staticRender: true,
            }),
        );
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

Deno.test("Workspace APIs return lock-aware 409 responses without mutating locked Plans", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "locked", "# Locked\n", {
            planId: "locked-api-id",
            status: "draft",
            classification: "FEATURE",
            collaborationState: COLLABORATION_STATE_REMOTE_CANONICAL,
            collaborationServerUrl: "https://plans.example.test",
            collaborationSpaceId: "space-1",
        });
        const loaded = await loadPlanBodyById(cwd, "locked-api-id");
        const before = await Deno.readTextFile(`${cwd}/plans/locked.md`);
        const app = createWorkspaceApp({ cwd, token: "secret" }).handler();

        const bodyEdit = await app(
            new Request("http://localhost/api/plans/locked-api-id/body", {
                method: "POST",
                headers: { [PLAN_UI_TOKEN_HEADER]: "secret", "content-type": "application/json" },
                body: JSON.stringify({ body: "# Changed\n", expectedBodyHash: loaded.bodyHash }),
            }),
        );
        assertEquals(bodyEdit.status, 409);
        const bodyPayload = await bodyEdit.json();
        assertStringIncludes(bodyPayload.error, "remote-canonical");
        assertStringIncludes(bodyPayload.repair, "wld plans pull");
        assertEquals(await Deno.readTextFile(`${cwd}/plans/locked.md`), before);

        const lifecycle = await app(
            new Request("http://localhost/api/plans/locked-api-id/lifecycle-action", {
                method: "POST",
                headers: { [PLAN_UI_TOKEN_HEADER]: "secret", "content-type": "application/json" },
                body: JSON.stringify({ action: "move_status", targetStatus: "approved" }),
            }),
        );
        assertEquals(lifecycle.status, 409);
        const lifecyclePayload = await lifecycle.json();
        assertStringIncludes(lifecyclePayload.blockedReason, "remote-canonical");
        assertStringIncludes(lifecyclePayload.repair, "wld plans pull");
        assertEquals(await Deno.readTextFile(`${cwd}/plans/locked.md`), before);
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

/** @param {Response} response */
async function readJsonResponse(response) {
    return await response.json();
}

/** @param {string} url @param {unknown} body @param {string} [bearer] */
function jsonRequest(url, body, bearer) {
    /** @type {Record<string, string>} */
    const headers = { "content-type": "application/json" };
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    return new Request(url, { method: "POST", headers, body: JSON.stringify(body) });
}

Deno.test("remote Workspace mode isolates local Plan Board and local APIs", async () => {
    const app = createWorkspaceApp({ mode: "remote" }).handler();
    for (
        const path of ["/", "/api/plans", "/api/board", "/api/plans/plan-1/body", "/api/plans/plan-1/lifecycle-action"]
    ) {
        const method = path.includes("body") || path.includes("lifecycle") ? "POST" : "GET";
        const response = await app(new Request(`http://localhost${path}`, { method }));
        assertEquals(response.status, 404);
    }
});

Deno.test("remote Shared Space API enforces capabilities, ciphertext storage, lifecycle, and delete", async () => {
    const reviewerCapability = "reviewer-secret-capability";
    const maintainerCapability = "maintainer-secret-capability";
    const database = openRemoteDatabase();
    const adapter = createRemoteWorkspaceAdapter({ database });
    const app = createWorkspaceApp({ mode: "remote", adapter }).handler();
    try {
        const reviewerHash = await hashCapability(reviewerCapability);
        const maintainerHash = await hashCapability(maintainerCapability);
        const createResponse = await app(jsonRequest("http://localhost/api/spaces", {
            planId: "plan-1",
            initialRevision: { payloadCiphertext: "cipher:initial-plan-body" },
            capabilities: [
                { scope: "reviewer", capabilityHash: reviewerHash },
                { scope: "maintainer", capabilityHash: maintainerHash },
            ],
        }));
        assertEquals(createResponse.status, 201);
        const created = await readJsonResponse(createResponse);
        const spaceId = created.spaceId;

        const missingBearer = await app(new Request(`http://localhost/api/spaces/${spaceId}`));
        assertEquals(missingBearer.status, 401);

        const reviewerRead = await app(
            new Request(`http://localhost/api/spaces/${spaceId}`, {
                headers: { authorization: `Bearer ${reviewerCapability}` },
            }),
        );
        assertEquals(reviewerRead.status, 200);
        assertEquals((await readJsonResponse(reviewerRead)).latestRevision, 1);

        const reviewerAppendRevision = await app(jsonRequest(
            `http://localhost/api/spaces/${spaceId}/revisions`,
            { payloadCiphertext: "cipher:revision-2", expectedRevision: 2 },
            reviewerCapability,
        ));
        assertEquals(reviewerAppendRevision.status, 403);

        const conflict = await app(jsonRequest(
            `http://localhost/api/spaces/${spaceId}/revisions`,
            { payloadCiphertext: "cipher:revision-2", expectedRevision: 3 },
            maintainerCapability,
        ));
        assertEquals(conflict.status, 409);

        const appendRevision = await app(jsonRequest(
            `http://localhost/api/spaces/${spaceId}/revisions`,
            { payloadCiphertext: "cipher:revision-2", expectedRevision: 2 },
            maintainerCapability,
        ));
        assertEquals(appendRevision.status, 201);

        const revision = await app(
            new Request(`http://localhost/api/spaces/${spaceId}/revisions/2`, {
                headers: { authorization: `Bearer ${reviewerCapability}` },
            }),
        );
        assertEquals(revision.status, 200);
        assertEquals((await readJsonResponse(revision)).revision.payloadCiphertext, "cipher:revision-2");

        const appendComment = await app(jsonRequest(
            `http://localhost/api/spaces/${spaceId}/revisions/2/comments`,
            { ciphertext: "cipher:comment-body" },
            reviewerCapability,
        ));
        assertEquals(appendComment.status, 201);
        const commentId = (await readJsonResponse(appendComment)).comment.id;

        const revisionOneComments = await app(
            new Request(`http://localhost/api/spaces/${spaceId}/revisions/1/comments`, {
                headers: { authorization: `Bearer ${reviewerCapability}` },
            }),
        );
        assertEquals((await readJsonResponse(revisionOneComments)).comments.length, 0);

        const resolveComment = await app(jsonRequest(
            `http://localhost/api/spaces/${spaceId}/comments/${commentId}/state`,
            { action: "resolve" },
            reviewerCapability,
        ));
        assertEquals(resolveComment.status, 200);
        assertEquals((await readJsonResponse(resolveComment)).comment.resolved, true);

        const reopenComment = await app(jsonRequest(
            `http://localhost/api/spaces/${spaceId}/comments/${commentId}/state`,
            { action: "reopen" },
            reviewerCapability,
        ));
        assertEquals(reopenComment.status, 200);
        assertEquals((await readJsonResponse(reopenComment)).comment.resolved, false);

        const closeResponse = await app(jsonRequest(
            `http://localhost/api/spaces/${spaceId}/lifecycle`,
            { action: "close" },
            maintainerCapability,
        ));
        assertEquals(closeResponse.status, 200);
        assertEquals((await readJsonResponse(closeResponse)).status, "closed");

        const closedComment = await app(jsonRequest(
            `http://localhost/api/spaces/${spaceId}/revisions/2/comments`,
            { ciphertext: "cipher:late-comment" },
            reviewerCapability,
        ));
        assertEquals(closedComment.status, 409);
        const closedState = await app(jsonRequest(
            `http://localhost/api/spaces/${spaceId}/comments/${commentId}/state`,
            { action: "resolve" },
            reviewerCapability,
        ));
        assertEquals(closedState.status, 409);

        const rows = database.handle.prepare(
            "SELECT payload_ciphertext AS value FROM space_revisions UNION ALL SELECT ciphertext AS value FROM space_comments UNION ALL SELECT capability_hash AS value FROM space_capabilities",
        ).all();
        const storedText = JSON.stringify(rows);
        assertEquals(storedText.includes("reviewer-secret-capability"), false);
        assertEquals(storedText.includes("maintainer-secret-capability"), false);
        assertEquals(storedText.includes("plaintext plan body"), false);
        assertEquals(storedText.includes("Alice"), false);
        assertEquals(storedText.includes("original text"), false);

        const invalidPlaintext = await app(jsonRequest("http://localhost/api/spaces", {
            planId: "plan-2",
            body: "plaintext plan body",
            initialRevision: { payloadCiphertext: "cipher:plan" },
            capabilities: [
                { scope: "reviewer", capabilityHash: reviewerHash },
                { scope: "maintainer", capabilityHash: maintainerHash },
            ],
        }));
        assertEquals(invalidPlaintext.status, 400);

        const reviewerDelete = await app(jsonRequest(
            `http://localhost/api/spaces/${spaceId}/lifecycle`,
            { action: "delete" },
            reviewerCapability,
        ));
        assertEquals(reviewerDelete.status, 403);

        const deleteResponse = await app(jsonRequest(
            `http://localhost/api/spaces/${spaceId}/lifecycle`,
            { action: "delete" },
            maintainerCapability,
        ));
        assertEquals(deleteResponse.status, 200);

        const deletedRead = await app(
            new Request(`http://localhost/api/spaces/${spaceId}`, {
                headers: { authorization: `Bearer ${maintainerCapability}` },
            }),
        );
        assertEquals(deletedRead.status, 404);
    } finally {
        adapter.close();
    }
});
