import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import {
    archivePlan,
    archivePlansByStatus,
    countChildPlanProgress,
    ensurePlanIdentity,
    ensurePlansDir,
    findPlanById,
    findPlansByParent,
    getPlansDir,
    groupPlanHierarchy,
    hashPlanBody,
    injectFrontMatter,
    isChildFeaturePlan,
    isEpicPlan,
    listArchivedPlans,
    listPlanResources,
    listPlans,
    loadArchivedPlan,
    loadExternalPlan,
    loadPlan,
    loadPlanBodyById,
    parsePlanFrontMatter,
    PLAN_FRONT_MATTER_KEY_ORDER,
    PLAN_FRONT_MATTER_KEYS,
    resolvePlan,
    resolveSiblingChildPlanDependencyStates,
    restoreArchivedPlan,
    saveChildFeaturePlans,
    savePlan,
    savePlanBodyById,
    splitPlanMarkdownBody,
    updatePlanCollaborationMetadata,
    updatePlanFrontMatter,
    updatePlanStatus,
} from "./plan-store.js";
import {
    COLLABORATION_LOCK_BYPASS,
    COLLABORATION_STATE_REMOTE_CANONICAL,
    SharedPlanLockError,
} from "./shared/collaboration/lock.js";

/**
 * @param {string} name
 * @param {() => Promise<void>} fn
 */
function testWithFs(name, fn) {
    Deno.test({ name, permissions: { read: true, write: true }, fn });
}

Deno.test("front matter key constants expose canonical planning metadata order", () => {
    assertEquals(PLAN_FRONT_MATTER_KEYS.planId, "planId");
    assertEquals(PLAN_FRONT_MATTER_KEY_ORDER[0], PLAN_FRONT_MATTER_KEYS.planId);
    assertEquals(PLAN_FRONT_MATTER_KEYS.frontend, "frontend");
    assertEquals(PLAN_FRONT_MATTER_KEY_ORDER.includes(PLAN_FRONT_MATTER_KEYS.devServerUrl), true);
    assertEquals(PLAN_FRONT_MATTER_KEY_ORDER.includes(PLAN_FRONT_MATTER_KEYS.worktreePath), true);
    assertEquals(new Set(PLAN_FRONT_MATTER_KEY_ORDER).size, PLAN_FRONT_MATTER_KEY_ORDER.length);
});

Deno.test("injectFrontMatter escapes YAML double-quoted values", () => {
    const markdown = "## Plan\n\nBody";
    const withFm = injectFrontMatter(markdown, {
        summary: 'Handle "Other" and \\slashes',
        affectedPaths: ['<|"|src/tools/user-interview.js<|"|'],
    });

    const { attrs } = parsePlanFrontMatter(withFm);

    assertEquals(attrs.summary, 'Handle "Other" and \\slashes');
    assertEquals(attrs.affectedPaths, ['<|"|src/tools/user-interview.js<|"|']);
});

Deno.test("frontend verification front matter round trips", () => {
    const markdown = "## Plan\n\nBody";
    const withFm = injectFrontMatter(markdown, {
        frontend: true,
        devServerCommand: "npm run dev",
        devServerUrl: "http://localhost:5173",
        devServerHmr: true,
    });

    const { attrs } = parsePlanFrontMatter(withFm);

    assertEquals(attrs.frontend, true);
    assertEquals(attrs.devServerCommand, "npm run dev");
    assertEquals(attrs.devServerUrl, "http://localhost:5173");
    assertEquals(attrs.devServerHmr, true);
    assertEquals(withFm.indexOf("affectedPaths:") < withFm.indexOf("frontend:"), true);
    assertEquals(withFm.indexOf("devServerHmr:") < withFm.indexOf("createdAt:"), true);
});

Deno.test("injectFrontMatter preserves new closure and hold lifecycle fields", () => {
    const markdown = "## Plan\n\nBody";
    const withClosed = injectFrontMatter(markdown, {
        status: "closed_without_verification",
        createdAt: "2026-06-23T00:00:00.000Z",
    });
    assertEquals(parsePlanFrontMatter(withClosed).attrs.status, "closed_without_verification");

    const withHold = injectFrontMatter(markdown, {
        status: "on_hold",
        heldFromStatus: "in_progress",
        heldAt: "2026-06-23T01:00:00.000Z",
        holdReason: "priority shifted",
        holdStalenessBaseline: "2026-06-22T00:00:00.000Z",
        worktreeId: "wt-1",
    });
    const { attrs } = parsePlanFrontMatter(withHold);
    assertEquals(attrs.status, "on_hold");
    assertEquals(attrs.heldFromStatus, "in_progress");
    assertEquals(attrs.heldAt, "2026-06-23T01:00:00.000Z");
    assertEquals(attrs.holdReason, "priority shifted");
    assertEquals(attrs.holdStalenessBaseline, "2026-06-22T00:00:00.000Z");
    assertEquals(
        withHold.indexOf("worktreeStatus:") === -1 ||
            withHold.indexOf("worktreeStatus:") < withHold.indexOf("heldFromStatus:"),
        true,
    );
});

Deno.test("injectFrontMatter clears hold fields with null overrides", () => {
    const withHold = injectFrontMatter("## Plan", {
        status: "on_hold",
        heldFromStatus: "ready_for_work",
        heldAt: "2026-06-23T01:00:00.000Z",
        holdReason: "paused",
        holdStalenessBaseline: "2026-06-22T00:00:00.000Z",
    });
    const cleared = injectFrontMatter(withHold, {
        status: "draft",
        heldFromStatus: null,
        heldAt: null,
        holdReason: null,
        holdStalenessBaseline: null,
    });
    const { attrs } = parsePlanFrontMatter(cleared);
    assertEquals(attrs.status, "draft");
    assertEquals(attrs.heldFromStatus, null);
    assertEquals(attrs.heldAt, undefined);
    assertEquals(attrs.holdReason, undefined);
    assertEquals(attrs.holdStalenessBaseline, undefined);
});

Deno.test("injectFrontMatter preserves human review metadata", () => {
    const markdown = "## Plan\n\nBody";
    const withFm = injectFrontMatter(markdown, {
        classification: "FEATURE",
        complexity: "MEDIUM",
        summary: "Reviewed",
        affectedPaths: [],
        createdAt: "2026-06-23T00:00:00.000Z",
        status: "verified",
        verifiedAt: "2026-06-23T01:30:00.000Z",
        humanReviewMode: "ask",
        humanReviewDecision: "approved",
        humanReviewedAt: "2026-06-23T01:00:00.000Z",
        executionBaselineTree: "tree123",
    });

    const { attrs } = parsePlanFrontMatter(withFm);

    assertEquals(attrs.humanReviewMode, "ask");
    assertEquals(attrs.humanReviewDecision, "approved");
    assertEquals(attrs.humanReviewedAt, "2026-06-23T01:00:00.000Z");
    assertEquals(
        withFm.indexOf("verifiedAt:") < withFm.indexOf("humanReviewMode:") &&
            withFm.indexOf("humanReviewedAt:") < withFm.indexOf("executionBaselineTree:"),
        true,
    );
});

Deno.test("planId round trips and blank values normalize away", () => {
    const withId = injectFrontMatter("## Plan", { planId: "plan-123" });
    assertEquals(parsePlanFrontMatter(withId).attrs.planId, "plan-123");

    const blank = injectFrontMatter("## Plan", { planId: "" });
    assertEquals(parsePlanFrontMatter(blank).attrs.planId, undefined);
    assertEquals(blank.includes("planId:"), false);
});

Deno.test("order front matter round trips and numeric strings normalize", () => {
    const withOrder = injectFrontMatter("## Plan", { parentPlan: "epic-a", order: 3 });
    assertEquals(parsePlanFrontMatter(withOrder).attrs.order, 3);
    assertEquals(withOrder.includes("parentPlan:"), true);
    assertEquals(withOrder.indexOf("parentPlan:") < withOrder.indexOf("order:"), true);

    const parsedString = parsePlanFrontMatter([
        "---",
        "classification: FEATURE",
        "summary: child",
        "parentPlan: epic-a",
        'order: "4"',
        "---",
        "# Child",
    ].join("\n"));
    assertEquals(parsedString.attrs.order, 4);
});

testWithFs("ensurePlanIdentity backfills missing planId while preserving body exactly", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "missing-id", "\n\n# Title\n\nBody\n", { summary: "Missing ID" });
        const before = await loadPlan(cwd, "missing-id");
        const resource = await ensurePlanIdentity(cwd, "missing-id", { idGenerator: () => "generated-id" });
        const after = await loadPlan(cwd, "missing-id");

        assertEquals(resource.planId, "generated-id");
        assertEquals(after?.attrs.planId, "generated-id");
        assertEquals(after?.body, before?.body);
        assertEquals(resource.relativePath, "plans/missing-id.md");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

testWithFs(
    "listPlanResources preserves existing IDs, hides archived plans, and retries generated collisions",
    async () => {
        const cwd = await Deno.makeTempDir();
        try {
            await savePlan(cwd, "existing", "# Existing", { planId: "existing-id" });
            await savePlan(cwd, "missing", "# Missing");
            await savePlan(cwd, "archived/hidden", "# Hidden");
            const ids = ["existing-id", "new-id"];

            const resources = await listPlanResources(cwd, { idGenerator: () => ids.shift() || "fallback-id" });

            assertEquals(resources.map((resource) => resource.planName), ["existing", "missing"]);
            assertEquals(resources.map((resource) => resource.planId), ["existing-id", "new-id"]);
        } finally {
            await Deno.remove(cwd, { recursive: true });
        }
    },
);

testWithFs("listPlanResources throws repair-oriented duplicate planId errors before backfill", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "a", "# A", { planId: "dup" });
        await savePlan(cwd, "b", "# B", { planId: "dup" });
        await savePlan(cwd, "missing", "# Missing");

        await assertRejects(
            () => listPlanResources(cwd, { idGenerator: () => "new" }),
            Error,
            "Duplicate planId values found",
        );
        assertEquals((await loadPlan(cwd, "missing"))?.attrs.planId, undefined);
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

testWithFs("findPlanById resolves non-archived plan resources", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "lookup", "# Lookup", { planId: "lookup-id" });
        await savePlan(cwd, "prefixed", "# Prefixed", { planId: "01-prefixed-id" });
        const resource = await findPlanById(cwd, "lookup-id");
        assertEquals(resource.planName, "lookup");
        assertEquals(resource.relativePath, "plans/lookup.md");
        const prefixed = await findPlanById(cwd, "prefixed-id");
        assertEquals(prefixed.planName, "prefixed");

        await assertRejects(() => findPlanById(cwd, "missing-id"), Error, "Plan not found for planId");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("splitPlanMarkdownBody preserves front matter delimiter bytes and body", () => {
    const markdown = "---\r\n# comment\r\nplanId: quoted\r\n---\r\n# Body\n\nText\n";
    const split = splitPlanMarkdownBody(markdown);
    assertEquals(split.frontMatterBlock, "---\r\n# comment\r\nplanId: quoted\r\n---\r\n");
    assertEquals(split.body, "# Body\n\nText\n");
});

Deno.test("splitPlanMarkdownBody ignores indented front matter delimiter-like content", () => {
    const markdown = "---\nsummary: |\n  ---\n  body marker remains metadata\n---\n# Body\n";
    const split = splitPlanMarkdownBody(markdown);
    assertEquals(split.frontMatterBlock, "---\nsummary: |\n  ---\n  body marker remains metadata\n---\n");
    assertEquals(split.body, "# Body\n");
});

testWithFs("body-only save preserves front matter bytes and markdown body fidelity", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await Deno.mkdir(`${cwd}/plans`, { recursive: true });
        const frontMatter = [
            "---",
            "# preserve this comment",
            "planId: body-id",
            'unknownKey: "kept"',
            "classification: FEATURE",
            "status: in_progress",
            "worktreeStatus: active",
            "dependencies:",
            "    - sibling",
            "---\n",
        ].join("\n");
        const body =
            "# Old\n\n- item\n- [ ] task\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n[RunWield](https://runwield.dev)\n\n```js\nconsole.log(1);\n```\n";
        await Deno.writeTextFile(`${cwd}/plans/body.md`, frontMatter + body);
        const loaded = await loadPlanBodyById(cwd, "body-id");
        const nextBody =
            "# New\n\n- item\n- [x] task\n\n| A | B |\n| - | - |\n| 3 | 4 |\n\n[RunWield](https://runwield.dev)\n\n```js\nconsole.log(2);\n```\n\n";

        const saved = await savePlanBodyById(cwd, "body-id", nextBody, loaded.bodyHash);
        const after = await Deno.readTextFile(`${cwd}/plans/body.md`);

        assertEquals(after, frontMatter + nextBody);
        assertEquals(saved.body, nextBody);
        assertEquals(saved.bodyHash, await hashPlanBody(nextBody));
        assertEquals(parsePlanFrontMatter(after).attrs.status, "in_progress");
        assertEquals(parsePlanFrontMatter(after).attrs.worktreeStatus, "active");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

testWithFs("body-only save rejects stale hashes duplicate IDs and archived plans", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "editable", "# Original", { planId: "editable-id" });
        const loaded = await loadPlanBodyById(cwd, "editable-id");
        await savePlanBodyById(cwd, "editable-id", "# External", loaded.bodyHash);
        await assertRejects(
            () => savePlanBodyById(cwd, "editable-id", "# Browser", loaded.bodyHash),
            Error,
            "changed on disk",
        );

        await savePlan(cwd, "dup-a", "# A", { planId: "dup" });
        await savePlan(cwd, "dup-b", "# B", { planId: "dup" });
        await assertRejects(() => loadPlanBodyById(cwd, "dup"), Error, "Duplicate planId values found");
        await Deno.remove(`${cwd}/plans/dup-a.md`);
        await Deno.remove(`${cwd}/plans/dup-b.md`);

        await savePlan(cwd, "archived/hidden", "# Hidden", { planId: "hidden-id" });
        await assertRejects(() => loadPlanBodyById(cwd, "hidden-id"), Error, "Plan not found for planId");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("groupPlanHierarchy groups Epics, nested children, standalone, and orphaned children", () => {
    const plans = [
        { name: "epic", path: "plans/epic.md", attrs: { classification: "PROJECT", type: "epic", status: "draft" } },
        {
            name: "epic/child",
            path: "plans/epic/child.md",
            attrs: { classification: "FEATURE", parentPlan: "epic", status: "verified" },
        },
        { name: "solo", path: "plans/solo.md", attrs: { classification: "FEATURE", status: "draft" } },
        {
            name: "orphan/child",
            path: "plans/orphan/child.md",
            attrs: { classification: "FEATURE", parentPlan: "missing", status: "failed" },
        },
    ];

    const grouped = groupPlanHierarchy(/** @type {any} */ (plans));
    assertEquals(grouped.epics.map((plan) => plan.name), ["epic"]);
    assertEquals((grouped.childrenByParent.get("epic") || []).map((plan) => plan.name), ["epic/child"]);
    assertEquals(grouped.standalone.map((plan) => plan.name), ["solo"]);
    assertEquals(grouped.orphanChildren.map((plan) => plan.name), ["orphan/child"]);
    assertEquals(countChildPlanProgress(/** @type {any} */ (plans.slice(1, 4))), {
        verified: 1,
        active: 0,
        failed: 1,
        onHold: 0,
        remaining: 1,
        total: 3,
        byStatus: { verified: 1, failed: 1, draft: 1 },
    });
});

testWithFs("updatePlanStatus self-heals malformed front matter using recovery attrs", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        const plansDir = `${cwd}/plans`;
        await Deno.mkdir(plansDir, { recursive: true });
        const planPath = `${plansDir}/broken.md`;

        const malformed = [
            "---",
            'classification: "FEATURE"',
            'summary: "bad "quote"',
            "affectedPaths:",
            '    - "<|"|src/tools/user-interview.js<|"|"',
            'status: "in_review"',
            "---",
            "## Objective",
            "Keep going",
            "",
        ].join("\n");
        await Deno.writeTextFile(planPath, malformed);

        await updatePlanStatus(cwd, "broken", "approved", {
            classification: "FEATURE",
            complexity: "LOW",
            summary: "Recovered summary",
            affectedPaths: ["src/tools/user-interview.js"],
            origin: "internal",
        });

        const healed = await Deno.readTextFile(planPath);
        const { attrs, body } = parsePlanFrontMatter(healed);
        assertEquals(attrs.status, "approved");
        assertEquals(attrs.summary, "Recovered summary");
        assertEquals(attrs.affectedPaths, ["src/tools/user-interview.js"]);
        assertEquals(body.includes("## Objective"), true);
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

testWithFs("plan-store saves and reloads on-hold metadata without normalizing to draft", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "held-plan", "## Objective\nPause", {
            classification: "FEATURE",
            complexity: "MEDIUM",
            summary: "Paused plan",
            affectedPaths: ["src/plan-store.js"],
            status: "on_hold",
            heldFromStatus: "implemented",
            heldAt: "2026-06-23T01:00:00.000Z",
            holdReason: "priority shifted",
            holdStalenessBaseline: "2026-06-22T00:00:00.000Z",
            createdAt: "2026-06-23T00:00:00.000Z",
        });

        const loaded = await loadPlan(cwd, "held-plan");
        assertEquals(loaded?.attrs.status, "on_hold");
        assertEquals(loaded?.attrs.heldFromStatus, "implemented");
        assertEquals(loaded?.attrs.heldAt, "2026-06-23T01:00:00.000Z");
        assertEquals(loaded?.attrs.holdReason, "priority shifted");
        assertEquals(loaded?.attrs.holdStalenessBaseline, "2026-06-22T00:00:00.000Z");

        const updated = await updatePlanFrontMatter(cwd, "held-plan", {
            status: "draft",
            heldFromStatus: null,
            heldAt: null,
            holdReason: null,
            holdStalenessBaseline: null,
        });
        assertEquals(updated.status, "draft");
        assertEquals(updated.heldFromStatus, null);
        assertEquals(updated.heldAt, undefined);
        assertEquals(updated.holdReason, undefined);
        assertEquals(updated.holdStalenessBaseline, undefined);
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

testWithFs("plan-store saves and reloads manual closure status without verified metadata", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "closed-plan", "## Objective\nClose", {
            classification: "FEATURE",
            complexity: "MEDIUM",
            summary: "Closed plan",
            affectedPaths: [],
            status: "closed_without_verification",
            createdAt: "2026-06-23T00:00:00.000Z",
        });

        const loaded = await loadPlan(cwd, "closed-plan");
        assertEquals(loaded?.attrs.status, "closed_without_verification");
        assertEquals(loaded?.attrs.verifiedAt, undefined);
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

testWithFs("plan-store saves, loads, lists, and resolves project plans", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        const savedPath = await savePlan(cwd, "ship-tests", "## Objective\nGrow coverage", {
            classification: "PROJECT",
            complexity: "HIGH",
            summary: "Coverage push",
            affectedPaths: ["src/plan-store.js"],
            status: "ready_for_work",
            createdAt: "2026-06-15T00:00:00.000Z",
        });

        assertEquals(savedPath, `${getPlansDir(cwd)}/ship-tests.md`);

        const loaded = await loadPlan(cwd, "ship-tests");
        assertEquals(loaded?.attrs.classification, "PROJECT");
        assertEquals(loaded?.attrs.status, "ready_for_work");
        assertEquals(loaded?.body.trim(), "## Objective\nGrow coverage");

        const listed = await listPlans(cwd);
        assertEquals(listed.map((plan) => plan.name), ["ship-tests"]);
        assertEquals(listed[0].attrs.summary, "Coverage push");

        const resolvedByName = await resolvePlan(cwd, "ship-tests");
        assertEquals(resolvedByName.planName, "ship-tests");
        assertEquals(resolvedByName.attrs.complexity, "HIGH");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

testWithFs("plan-store preserves Epic and nested child metadata", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "project-breakdown-epic", "# Epic", {
            classification: "PROJECT",
            complexity: "HIGH",
            summary: "Break down projects",
            affectedPaths: ["src/plan-store.js"],
            status: "ready_for_work",
            type: "epic",
            createdAt: "2026-06-16T00:00:00.000Z",
        });

        await savePlan(cwd, "project-breakdown-epic/feature1", "# Child", {
            classification: "FEATURE",
            complexity: "MEDIUM",
            summary: "Child slice",
            affectedPaths: ["src/plan-store.test.js"],
            status: "draft",
            parentPlan: "project-breakdown-epic",
            dependencies: ["feature0", "project-breakdown-epic/feature0"],
            createdAt: "2026-06-16T01:00:00.000Z",
        });

        const epic = await loadPlan(cwd, "project-breakdown-epic");
        assertEquals(epic?.attrs.classification, "PROJECT");
        assertEquals(epic?.attrs.type, "epic");

        const child = await loadPlan(cwd, "project-breakdown-epic/feature1");
        assertEquals(child?.attrs.parentPlan, "project-breakdown-epic");
        assertEquals(child?.attrs.dependencies, ["feature0", "project-breakdown-epic/feature0"]);

        const listed = await listPlans(cwd);
        assertEquals(listed.map((plan) => plan.name), ["project-breakdown-epic", "project-breakdown-epic/feature1"]);

        const resolvedChild = await resolvePlan(cwd, "project-breakdown-epic/feature1");
        assertEquals(resolvedChild.planName, "project-breakdown-epic/feature1");
        assertEquals(resolvedChild.attrs.parentPlan, "project-breakdown-epic");

        const resolvedChildWithExtension = await resolvePlan(cwd, "project-breakdown-epic/feature1.md");
        assertEquals(resolvedChildWithExtension.planName, "project-breakdown-epic/feature1");

        const children = await findPlansByParent(cwd, "project-breakdown-epic");
        assertEquals(children.map((plan) => plan.name), ["project-breakdown-epic/feature1"]);
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

testWithFs("listPlans hides archived plans", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "active-plan", "# Active", {
            classification: "FEATURE",
            complexity: "MEDIUM",
            summary: "Visible plan",
            affectedPaths: [],
            status: "draft",
            createdAt: "2026-06-18T00:00:00.000Z",
        });
        await savePlan(cwd, "archived/old-plan", "# Archived", {
            classification: "FEATURE",
            complexity: "LOW",
            summary: "Hidden plan",
            affectedPaths: [],
            status: "verified",
            createdAt: "2026-06-17T00:00:00.000Z",
        });

        const listed = await listPlans(cwd);
        assertEquals(listed.map((plan) => plan.name), ["active-plan"]);

        const explicitArchived = await loadPlan(cwd, "archived/old-plan");
        assertEquals(explicitArchived?.attrs.summary, "Hidden plan");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

testWithFs("archivePlan moves verified nested plans with metadata and hides them from active lists", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "epic/01-child", "# Child\n\nBody stays", {
            planId: "child-id",
            summary: "Child plan",
            status: "verified",
            createdAt: "2026-06-18T00:00:00.000Z",
        });

        const archived = await archivePlan(cwd, "child-id", {
            reason: "done",
            now: "2026-06-19T00:00:00.000Z",
        });

        assertEquals(archived.name, "epic/01-child");
        assertEquals(archived.relativePath, "plans/archived/epic/01-child.md");
        assertEquals((await listPlans(cwd)).map((plan) => plan.name), []);
        assertEquals((await listArchivedPlans(cwd)).map((plan) => plan.name), ["epic/01-child"]);

        const loaded = await loadArchivedPlan(cwd, "epic/01-child");
        assertEquals(loaded?.attrs.status, "verified");
        assertEquals(loaded?.attrs.archivedAt, "2026-06-19T00:00:00.000Z");
        assertEquals(loaded?.attrs.archiveReason, "done");
        assertEquals(loaded?.attrs.archivedFromStatus, "verified");
        assertEquals(loaded?.attrs.archivedFromPath, "plans/epic/01-child.md");
        assertEquals(loaded?.body, "# Child\n\nBody stays");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

testWithFs("archivePlan allows terminal closure and requires force for non-terminal statuses", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "closed", "# Closed", { status: "closed_without_verification" });
        await archivePlan(cwd, "closed", { now: "2026-06-19T00:00:00.000Z" });
        assertEquals((await loadArchivedPlan(cwd, "closed"))?.attrs.archivedFromStatus, "closed_without_verification");

        await savePlan(cwd, "draft", "# Draft", { status: "draft" });
        await assertRejects(() => archivePlan(cwd, "draft"), Error, "without --force");
        await archivePlan(cwd, "draft", { force: true, now: "2026-06-20T00:00:00.000Z" });
        assertEquals((await loadArchivedPlan(cwd, "draft"))?.attrs.archivedFromStatus, "draft");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

testWithFs("archivePlan requires force for recoverable worktree states and refuses overwrites", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "busy", "# Busy", { status: "verified", worktreeStatus: "active" });
        await assertRejects(() => archivePlan(cwd, "busy"), Error, "worktreeStatus active");
        await archivePlan(cwd, "busy", { force: true, now: "2026-06-21T00:00:00.000Z" });
        assertEquals((await loadArchivedPlan(cwd, "busy"))?.attrs.archivedFromStatus, "verified");

        await savePlan(cwd, "dup", "# Dup", { status: "verified" });
        await savePlan(cwd, "archived/dup", "# Archived Dup", { status: "verified" });
        await assertRejects(() => archivePlan(cwd, "dup"), Error, "already exists");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

testWithFs("archivePlansByStatus archives matching parents with all children and reports no-op matches", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "epic", "# Epic", {
            classification: "PROJECT",
            type: "epic",
            status: "verified",
            summary: "Done",
        });
        await savePlan(cwd, "epic/01-child", "# Child", {
            parentPlan: "epic",
            status: "draft",
            summary: "Child",
        });
        await savePlan(cwd, "standalone", "# Standalone", { status: "verified", summary: "Done" });
        await savePlan(cwd, "draft", "# Draft", { status: "draft" });
        await savePlan(cwd, "closed", "# Closed", { status: "closed_without_verification" });

        const result = await archivePlansByStatus(cwd, "verified", {
            reason: "done",
            now: "2026-07-04T00:00:00.000Z",
        });

        assertEquals(result.matched.map((plan) => plan.name), ["epic", "epic/01-child", "standalone"]);
        assertEquals(result.archived.map((plan) => plan.relativePath), [
            "plans/archived/epic.md",
            "plans/archived/epic/01-child.md",
            "plans/archived/standalone.md",
        ]);
        assertEquals(result.failed, []);
        assertEquals((await listPlans(cwd)).map((plan) => plan.name), ["closed", "draft"]);
        const archivedChild = await loadArchivedPlan(cwd, "epic/01-child");
        assertEquals(archivedChild?.attrs.archivedAt, "2026-07-04T00:00:00.000Z");
        assertEquals(archivedChild?.attrs.archiveReason, "done");
        assertEquals(archivedChild?.attrs.archivedFromStatus, "draft");

        const noOp = await archivePlansByStatus(cwd, "verified", { now: "2026-07-05T00:00:00.000Z" });
        assertEquals(noOp, { matched: [], archived: [], failed: [] });
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

testWithFs("archivePlansByStatus ignores children when parent status does not match", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "epic", "# Epic", {
            classification: "PROJECT",
            type: "epic",
            status: "draft",
        });
        await savePlan(cwd, "epic/01-child", "# Child", { parentPlan: "epic", status: "verified" });

        const result = await archivePlansByStatus(cwd, "verified", { now: "2026-07-04T00:00:00.000Z" });

        assertEquals(result, { matched: [], archived: [], failed: [] });
        assertEquals((await listPlans(cwd)).map((plan) => plan.name), ["epic", "epic/01-child"]);
        assertEquals(await listArchivedPlans(cwd), []);
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

testWithFs("archivePlansByStatus keeps archiving safe matches when other matches fail", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "ok", "# OK", { status: "verified" });
        await savePlan(cwd, "blocked", "# Blocked", { status: "verified", worktreeStatus: "active" });
        await savePlan(cwd, "dup", "# Dup", { status: "verified" });
        await savePlan(cwd, "archived/dup", "# Existing", { status: "verified" });

        const result = await archivePlansByStatus(cwd, "verified", { now: "2026-07-04T00:00:00.000Z" });

        assertEquals(result.matched.map((plan) => plan.name), ["blocked", "dup", "ok"]);
        assertEquals(result.archived, [{ name: "ok", relativePath: "plans/archived/ok.md" }]);
        assertEquals(result.failed.map((plan) => plan.name), ["blocked", "dup"]);
        assertStringIncludes(result.failed[0].message, "worktreeStatus active");
        assertStringIncludes(result.failed[1].message, "already exists");
        assertEquals((await listPlans(cwd)).map((plan) => plan.name), ["blocked", "dup"]);
        assertEquals((await listArchivedPlans(cwd)).map((plan) => plan.name), ["dup", "ok"]);
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

testWithFs("archivePlansByStatus validates requested lifecycle status", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await assertRejects(
            () => archivePlansByStatus(cwd, /** @type {any} */ ("verfied")),
            Error,
            "Unknown Plan status",
        );
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

testWithFs(
    "restoreArchivedPlan moves archived plans back without changing body and refuses active overwrites",
    async () => {
        const cwd = await Deno.makeTempDir();
        try {
            await savePlan(cwd, "done", "# Done\n\nBody", { status: "verified", planId: "done-id" });
            await archivePlan(cwd, "done", { now: "2026-06-19T00:00:00.000Z" });
            const restored = await restoreArchivedPlan(cwd, "done-id", { now: "2026-06-20T00:00:00.000Z" });

            assertEquals(restored.relativePath, "plans/done.md");
            const loaded = await loadPlan(cwd, "done");
            assertEquals(loaded?.body, "# Done\n\nBody");
            assertEquals(loaded?.attrs.archivedAt, undefined);
            assertEquals(loaded?.attrs.archiveReason, undefined);
            assertEquals(loaded?.attrs.archivedFromStatus, undefined);
            assertEquals(loaded?.attrs.archivedFromPath, undefined);
            assertEquals(loaded?.attrs.restoredAt, "2026-06-20T00:00:00.000Z");
            assertEquals(loaded?.attrs.restoredFromPath, "plans/archived/done.md");

            await savePlan(cwd, "archived/old", "# Old", { status: "verified" });
            await savePlan(cwd, "old", "# Active", { status: "draft" });
            await assertRejects(() => restoreArchivedPlan(cwd, "old"), Error, "already exists");
        } finally {
            await Deno.remove(cwd, { recursive: true });
        }
    },
);

testWithFs("archived plan store resolves planId and preserves custom front matter text", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        const planPath = `${getPlansDir(cwd)}/custom.md`;
        await Deno.mkdir(getPlansDir(cwd), { recursive: true });
        await Deno.writeTextFile(
            planPath,
            [
                "---",
                "planId: durable-custom-id",
                "classification: FEATURE",
                "complexity: MEDIUM",
                "summary: Custom metadata",
                "affectedPaths:",
                "    []",
                "status: verified",
                "customObject:",
                "  nested: true",
                "# keep this comment with the custom field",
                "---",
                "# Custom Body",
                "",
            ].join("\n"),
        );

        await archivePlan(cwd, "custom", { now: "2026-06-21T00:00:00.000Z" });
        const archived = await loadArchivedPlan(cwd, "durable-custom-id");
        assertEquals(archived?.name, "custom");
        assertEquals(archived?.attrs.archivedAt, "2026-06-21T00:00:00.000Z");
        assertStringIncludes(archived?.markdown || "", "customObject:\n  nested: true");
        assertStringIncludes(archived?.markdown || "", "# keep this comment with the custom field");
        assertEquals(archived?.body, "# Custom Body\n");

        await restoreArchivedPlan(cwd, "durable-custom-id", { now: "2026-06-22T00:00:00.000Z" });
        const restoredMarkdown = await Deno.readTextFile(planPath);
        assertStringIncludes(restoredMarkdown, "customObject:\n  nested: true");
        assertStringIncludes(restoredMarkdown, "# keep this comment with the custom field");
        assertStringIncludes(restoredMarkdown, 'restoredAt: "2026-06-22T00:00:00.000Z"');
        assertStringIncludes(restoredMarkdown, "# Custom Body\n");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

testWithFs("archived listing skips malformed files while direct reads report parse errors", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "archived/good", "# Good", { status: "verified", planId: "good-id" });
        await Deno.writeTextFile(
            `${getPlansDir(cwd)}/archived/bad.md`,
            "---\nsummary: [unterminated\n---\n# Bad\n",
        );

        const listed = await listArchivedPlans(cwd);
        assertEquals(listed.map((plan) => plan.name), ["good"]);
        await assertRejects(() => loadArchivedPlan(cwd, "bad"), Error, "Malformed archived Plan plans/archived/bad.md");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

testWithFs("archive helpers reject traversal and active archive source names", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "archived/old", "# Old", { status: "verified" });
        await assertRejects(() => archivePlan(cwd, "archived/old"), Error, "active Plan name");
        await assertRejects(() => loadArchivedPlan(cwd, "../escape"), Error, "cannot escape");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

testWithFs("saveChildFeaturePlans creates draft child FEATURE plans with order and legacy sequence alias", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        const results = await saveChildFeaturePlans(cwd, "project-breakdown-epic", [
            {
                order: 1,
                title: "Preserve Epic and child metadata",
                summary: "Keep parent-child links loadable",
                affectedPaths: ["src/plan-store.js"],
                frontend: true,
                devServerCommand: "deno task workspace:dev",
                devServerUrl: "http://localhost:5173",
                devServerHmr: true,
                worktreeBaseBranch: "feature-base",
                dependencies: [],
                content: "# Preserve Epic and child metadata\n\n## Context\nDraft slice",
            },
            {
                sequence: 2,
                title: "Load child FEATURES",
                summary: "Let load-plan execute child features",
                affectedPaths: ["src/cmd/load-plan/index.js"],
                dependencies: ["project-breakdown-epic/01-preserve-epic-and-child-metadata"],
                content: "# Load child FEATURES\n\n## Context\nDraft slice",
            },
        ]);

        assertEquals(results.map((result) => ({ name: result.name, action: result.action })), [
            { name: "project-breakdown-epic/01-preserve-epic-and-child-metadata", action: "created" },
            { name: "project-breakdown-epic/02-load-child-features", action: "created" },
        ]);
        assertEquals(results[0].metadata, {
            classification: "FEATURE",
            status: "draft",
            parentPlan: "project-breakdown-epic",
            order: 1,
            affectedPaths: ["src/plan-store.js"],
            frontend: true,
            devServerCommand: "deno task workspace:dev",
            devServerUrl: "http://localhost:5173",
            devServerHmr: true,
            worktreeBaseBranch: "feature-base",
        });

        const first = await loadPlan(cwd, "project-breakdown-epic/01-preserve-epic-and-child-metadata");
        assertEquals(first?.attrs.classification, "FEATURE");
        assertEquals(first?.attrs.status, "draft");
        assertEquals(first?.attrs.parentPlan, "project-breakdown-epic");
        assertEquals(first?.attrs.summary, "Keep parent-child links loadable");
        assertEquals(first?.attrs.order, 1);
        assertEquals(first?.attrs.frontend, true);
        assertEquals(first?.attrs.devServerCommand, "deno task workspace:dev");
        assertEquals(first?.attrs.devServerUrl, "http://localhost:5173");
        assertEquals(first?.attrs.devServerHmr, true);
        assertEquals(first?.attrs.worktreeBaseBranch, "feature-base");

        const second = await loadPlan(cwd, "project-breakdown-epic/02-load-child-features");
        assertEquals(second?.attrs.dependencies, ["project-breakdown-epic/01-preserve-epic-and-child-metadata"]);
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

testWithFs("findPlansByParent sorts child plans by order before name", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "epic-sort", "# Epic", {
            classification: "PROJECT",
            type: "epic",
            status: "ready_for_work",
        });
        await savePlan(cwd, "epic-sort/03-third", "# Third", { parentPlan: "epic-sort", order: 3 });
        await savePlan(cwd, "epic-sort/01-legacy", "# Legacy", { parentPlan: "epic-sort" });
        await savePlan(cwd, "epic-sort/02-second", "# Second", { parentPlan: "epic-sort", order: 2 });
        await savePlan(cwd, "epic-sort/04-also-second", "# Also Second", { parentPlan: "epic-sort", order: 2 });

        const children = await findPlansByParent(cwd, "epic-sort");
        assertEquals(children.map((child) => child.name), [
            "epic-sort/02-second",
            "epic-sort/04-also-second",
            "epic-sort/03-third",
            "epic-sort/01-legacy",
        ]);
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

testWithFs("saveChildFeaturePlans updates existing drafts at stable child paths", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        const descriptor = {
            sequence: 1,
            title: "Write Draft Plans",
            summary: "Initial summary",
            affectedPaths: ["src/plan-store.js"],
            dependencies: [],
            content: "# Write Draft Plans\n\nInitial content",
        };
        await saveChildFeaturePlans(cwd, "epic-a", [descriptor]);

        const results = await saveChildFeaturePlans(cwd, "epic-a", [{
            ...descriptor,
            summary: "Updated summary",
            content: "# Write Draft Plans\n\nUpdated content",
        }]);

        assertEquals(results[0].action, "updated");
        const loaded = await loadPlan(cwd, "epic-a/01-write-draft-plans");
        assertEquals(loaded?.attrs.summary, "Updated summary");
        assertEquals(loaded?.body.trim(), "# Write Draft Plans\n\nUpdated content");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

testWithFs("saveChildFeaturePlans rejects invalid child and parent names", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        const validChild = {
            sequence: 1,
            title: "Draft child",
            summary: "Draft summary",
            affectedPaths: [],
            dependencies: [],
            content: "# Draft child",
        };

        await assertRejects(
            () => saveChildFeaturePlans(cwd, "../outside", []),
            Error,
            "Plan name cannot escape plans/",
        );
        await assertRejects(
            () => saveChildFeaturePlans(cwd, "/tmp/outside", []),
            Error,
            "Plan name must be relative to plans/",
        );
        await assertRejects(
            () => saveChildFeaturePlans(cwd, "epic-a/nested", [validChild]),
            Error,
            "Parent Epic plan name must be a top-level plan",
        );
        await assertRejects(
            () =>
                saveChildFeaturePlans(cwd, "epic-a", [{
                    sequence: 1,
                    title: "...",
                    summary: "Bad child",
                    affectedPaths: [],
                    dependencies: [],
                    content: "# Bad",
                }]),
            Error,
            "Child plan title must produce a valid plan name",
        );
        await assertRejects(
            () => saveChildFeaturePlans(cwd, "epic-a", [{ ...validChild, sequence: -1 }]),
            Error,
            "Child plan order must be a non-negative integer",
        );
        await assertRejects(
            () => saveChildFeaturePlans(cwd, "epic-a", [{ ...validChild, sequence: 1.5 }]),
            Error,
            "Child plan order must be a non-negative integer",
        );
        await assertRejects(
            () =>
                saveChildFeaturePlans(cwd, "epic-a", [
                    { ...validChild, title: "Same child" },
                    { ...validChild, title: "Same child" },
                ]),
            Error,
            "Duplicate child plan name: epic-a/01-same-child",
        );
        await assertRejects(
            () =>
                saveChildFeaturePlans(
                    cwd,
                    "epic-a",
                    /** @type {any} */ ([{ ...validChild, dependencies: "feature-1" }]),
                ),
            Error,
            "Child plan dependencies must be an array",
        );
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

testWithFs("plan-store updates preserve parent-child metadata and unknown front matter", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        const markdown = injectFrontMatter(
            "# Child",
            /** @type {any} */ ({
                classification: "FEATURE",
                parentPlan: "project-breakdown-epic",
                dependencies: ["feature0"],
                customFlag: true,
                customOrder: 7,
                customTags: ["alpha", "beta"],
            }),
        );
        await Deno.mkdir(`${cwd}/plans/project-breakdown-epic`, { recursive: true });
        await Deno.writeTextFile(`${cwd}/plans/project-breakdown-epic/feature2.md`, markdown);

        await updatePlanStatus(cwd, "project-breakdown-epic/feature2", "approved");
        const afterStatus = await loadPlan(cwd, "project-breakdown-epic/feature2");
        assertEquals(afterStatus?.attrs.status, "approved");
        assertEquals(afterStatus?.attrs.parentPlan, "project-breakdown-epic");
        assertEquals(afterStatus?.attrs.dependencies, ["feature0"]);
        assertEquals(/** @type {any} */ (afterStatus?.attrs).customFlag, true);
        assertEquals(/** @type {any} */ (afterStatus?.attrs).customOrder, 7);
        assertEquals(/** @type {any} */ (afterStatus?.attrs).customTags, ["alpha", "beta"]);

        const attrs = await updatePlanFrontMatter(cwd, "project-breakdown-epic/feature2", {
            status: "ready_for_work",
            summary: "Updated child",
        });
        assertEquals(attrs.status, "ready_for_work");
        assertEquals(attrs.parentPlan, "project-breakdown-epic");
        assertEquals(attrs.dependencies, ["feature0"]);
        assertEquals(/** @type {any} */ (attrs).customFlag, true);
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

testWithFs("plan-store rejects stored plan names that escape plans directory", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await assertRejects(
            () => savePlan(cwd, "../outside", "# Bad"),
            Error,
            "Plan name cannot escape plans/",
        );
        await assertRejects(
            () => savePlan(cwd, "/tmp/outside", "# Bad"),
            Error,
            "Plan name must be relative to plans/",
        );
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

testWithFs("plan-store resolves external plans and injects defaults when front matter is missing", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        const externalPath = `${cwd}/outside.md`;
        await Deno.writeTextFile(externalPath, "# External plan\n\nBody");

        const loaded = await loadExternalPlan(externalPath);
        assertEquals(loaded.attrs.origin, "external");
        assertEquals(loaded.attrs.status, "draft");
        assertEquals(loaded.markdown.startsWith("---\n"), true);

        const resolved = await resolvePlan(cwd, "./outside.md");
        assertEquals(resolved.planName, "outside");
        assertEquals(resolved.attrs.origin, "external");

        await assertRejects(
            () => resolvePlan(cwd, "missing"),
            Error,
            "Plan not found: missing",
        );
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("worktree front matter fields round-trip and can be cleared", () => {
    const markdown = injectFrontMatter("## Body", {
        executionBaselineTree: "tree123",
        worktreeId: "wt-123",
        worktreePath: "/tmp/repo-runwield-plan-wt-123",
        worktreeBranch: "runwield/worktree/plan-wt-123",
        worktreeBaseBranch: "feature-base",
        worktreeStatus: "active",
    });

    const parsed = parsePlanFrontMatter(markdown);
    assertEquals(parsed.attrs.executionBaselineTree, "tree123");
    assertEquals(parsed.attrs.worktreeId, "wt-123");
    assertEquals(parsed.attrs.worktreePath, "/tmp/repo-runwield-plan-wt-123");
    assertEquals(parsed.attrs.worktreeBranch, "runwield/worktree/plan-wt-123");
    assertEquals(parsed.attrs.worktreeBaseBranch, "feature-base");
    assertEquals(parsed.attrs.worktreeStatus, "active");

    const cleared = injectFrontMatter(markdown, {
        worktreeId: null,
        worktreePath: null,
        worktreeBranch: null,
        worktreeBaseBranch: null,
        worktreeStatus: null,
    });
    const reparsed = parsePlanFrontMatter(cleared);
    assertEquals(reparsed.attrs.worktreeId, undefined);
    assertEquals(reparsed.attrs.worktreePath, undefined);
    assertEquals(reparsed.attrs.worktreeBranch, undefined);
    assertEquals(reparsed.attrs.worktreeBaseBranch, undefined);
    assertEquals(reparsed.attrs.worktreeStatus, undefined);
});

Deno.test("Epic done-enough front matter fields round-trip and can be cleared", () => {
    const markdown = injectFrontMatter("## Body", {
        epicCompletionMode: "done_enough",
        epicDoneEnoughAt: "2026-06-17T00:00:00.000Z",
        epicDoneEnoughSummary: "1/2 features verified",
    });

    const parsed = parsePlanFrontMatter(markdown);
    assertEquals(parsed.attrs.epicCompletionMode, "done_enough");
    assertEquals(parsed.attrs.epicDoneEnoughAt, "2026-06-17T00:00:00.000Z");
    assertEquals(parsed.attrs.epicDoneEnoughSummary, "1/2 features verified");

    const cleared = injectFrontMatter(markdown, {
        epicCompletionMode: null,
        epicDoneEnoughAt: null,
        epicDoneEnoughSummary: null,
    });
    const reparsed = parsePlanFrontMatter(cleared);
    assertEquals(reparsed.attrs.epicCompletionMode, undefined);
    assertEquals(reparsed.attrs.epicDoneEnoughAt, undefined);
    assertEquals(reparsed.attrs.epicDoneEnoughSummary, undefined);
});

testWithFs("updatePlanFrontMatter preserves body and clears optional fields", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "front-matter", "## Body", {
            failureReason: "old failure",
            failedAt: "2026-06-14T00:00:00.000Z",
            status: "failed",
        });

        const attrs = await updatePlanFrontMatter(cwd, "front-matter", {
            status: "implemented",
            failureReason: null,
            failedAt: null,
            implementedAt: "2026-06-15T00:00:00.000Z",
        });

        assertEquals(attrs.status, "implemented");
        assertEquals(attrs.failureReason, undefined);
        assertEquals(attrs.failedAt, undefined);
        assertEquals(attrs.implementedAt, "2026-06-15T00:00:00.000Z");

        const loaded = await loadPlan(cwd, "front-matter");
        assertEquals(loaded?.body.trim(), "## Body");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

testWithFs("updatePlanFrontMatter self-heals malformed front matter", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        const plansDir = `${cwd}/plans`;
        await Deno.mkdir(plansDir, { recursive: true });
        await Deno.writeTextFile(`${plansDir}/healed.md`, '---\nstatus: "bad\n---\n# Body');

        const attrs = await updatePlanFrontMatter(cwd, "healed", { status: "feedback" }, {
            classification: "QUICK_FIX",
            complexity: "LOW",
            summary: "Recovered",
            affectedPaths: ["src/a.js"],
        });

        assertEquals(attrs.status, "feedback");
        assertEquals(attrs.classification, "QUICK_FIX");
        assertEquals(attrs.summary, "Recovered");

        await assertRejects(
            () => updatePlanFrontMatter(cwd, "missing", { status: "draft" }),
            Error,
            "Plan not found: missing",
        );
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("parsePlanFrontMatter normalizes legacy and invalid statuses", () => {
    const completed = parsePlanFrontMatter([
        "---",
        'status: "completed"',
        "---",
        "body",
    ].join("\n"));
    assertEquals(completed.attrs.status, "verified");

    const inReview = parsePlanFrontMatter([
        "---",
        'status: "in_review"',
        "---",
        "body",
    ].join("\n"));
    assertEquals(inReview.attrs.status, "feedback");

    const invalid = parsePlanFrontMatter([
        "---",
        'status: "whatever"',
        "---",
        "body",
    ].join("\n"));
    assertEquals(invalid.attrs.status, "draft");
});

Deno.test("planId front matter round-trips and blank values normalize away", () => {
    const markdown = injectFrontMatter("## Body", { planId: "plan-123" });
    const parsed = parsePlanFrontMatter(markdown);
    assertEquals(parsed.attrs.planId, "plan-123");
    assertEquals(markdown.includes('planId: "plan-123"'), true);

    assertEquals(parsePlanFrontMatter('---\nplanId: ""\n---\nBody').attrs.planId, undefined);
    assertEquals(parsePlanFrontMatter("---\nplanId: 123\n---\nBody").attrs.planId, undefined);
});

testWithFs("ensurePlanIdentity backfills missing planId while preserving body exactly", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "needs-id", "\n# Title\n\nBody with trailing spaces  \n\n", {
            summary: "Needs id",
            createdAt: "2026-06-24T00:00:00.000Z",
        });
        const before = await loadPlan(cwd, "needs-id");

        const resource = await ensurePlanIdentity(cwd, "needs-id", { __testGenerateId: () => "generated-id" });
        const after = await loadPlan(cwd, "needs-id");

        assertEquals(resource.planId, "generated-id");
        assertEquals(resource.planName, "needs-id");
        assertEquals(resource.relativePath, "plans/needs-id.md");
        assertEquals(after?.attrs.planId, "generated-id");
        assertEquals(after?.body, before?.body);
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

testWithFs("ensurePlanIdentity preserves existing planId", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "has-id", "# Body", { planId: "existing-id" });
        const before = await Deno.readTextFile(`${cwd}/plans/has-id.md`);

        const resource = await ensurePlanIdentity(cwd, "has-id", { __testGenerateId: () => "new-id" });
        const after = await Deno.readTextFile(`${cwd}/plans/has-id.md`);

        assertEquals(resource.planId, "existing-id");
        assertEquals(after, before);
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

testWithFs("ensurePlanIdentity skips archived plans and does not backfill them", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "archived/old", "# Old");
        const before = await Deno.readTextFile(`${cwd}/plans/archived/old.md`);

        await assertRejects(
            () => ensurePlanIdentity(cwd, "archived/old", { __testGenerateId: () => "archived-id" }),
            Error,
            "archived or hidden",
        );

        const after = await Deno.readTextFile(`${cwd}/plans/archived/old.md`);
        assertEquals(after, before);
        assertEquals((await loadPlan(cwd, "archived/old"))?.attrs.planId, undefined);
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

testWithFs("ensurePlanIdentity retries generated collisions and rejects duplicate existing planIds", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "existing", "# Existing", { planId: "existing-id" });
        await savePlan(cwd, "missing", "# Missing");
        const generatedIds = ["existing-id", "new-id"];

        const resource = await ensurePlanIdentity(cwd, "missing", {
            __testGenerateId: () => generatedIds.shift() || "unused",
        });

        assertEquals(resource.planId, "new-id");

        await savePlan(cwd, "duplicate", "# Duplicate", { planId: "existing-id" });
        await assertRejects(
            () => ensurePlanIdentity(cwd, "another-missing", { __testGenerateId: () => "another-id" }),
            Error,
            "Plan not found",
        );
        await assertRejects(
            () => ensurePlanIdentity(cwd, "missing", { __testGenerateId: () => "another-id" }),
            Error,
            "Duplicate planId",
        );
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

testWithFs("listPlanResources detects duplicate existing planIds before backfilling", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "a", "# A", { planId: "dup" });
        await savePlan(cwd, "b", "# B", { planId: "dup" });
        await savePlan(cwd, "missing", "# Missing");
        const before = await Deno.readTextFile(`${cwd}/plans/missing.md`);

        await assertRejects(
            () => listPlanResources(cwd, { __testGenerateId: () => "should-not-write" }),
            Error,
            "Duplicate planId",
        );
        const after = await Deno.readTextFile(`${cwd}/plans/missing.md`);
        assertEquals(after, before);
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

testWithFs(
    "listPlanResources backfills missing IDs, retries generated collisions, and hides archived plans",
    async () => {
        const cwd = await Deno.makeTempDir();
        try {
            await savePlan(cwd, "a", "# A", { planId: "existing" });
            await savePlan(cwd, "b", "# B");
            await savePlan(cwd, "archived/old", "# Old");
            const ids = ["existing", "generated"];

            const resources = await listPlanResources(cwd, { __testGenerateId: () => ids.shift() || "unused" });

            assertEquals(resources.map((resource) => resource.name), ["a", "b"]);
            assertEquals(resources.map((resource) => resource.planId), ["existing", "generated"]);
            assertEquals((await loadPlan(cwd, "archived/old"))?.attrs.planId, undefined);
        } finally {
            await Deno.remove(cwd, { recursive: true });
        }
    },
);

testWithFs("findPlanById resolves non-archived resources and reports unknown IDs", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "found", "# Found\n\nBody", { planId: "lookup-id", summary: "Found plan" });
        await savePlan(cwd, "archived/hidden", "# Hidden", { planId: "hidden-id" });

        const found = await findPlanById(cwd, "lookup-id");
        assertEquals(found.planName, "found");
        assertEquals(found.relativePath, "plans/found.md");
        assertEquals(found.attrs.summary, "Found plan");
        assertEquals(found.body, "# Found\n\nBody");
        assertEquals(found.markdown?.includes("lookup-id"), true);

        await assertRejects(() => findPlanById(cwd, "hidden-id"), Error, "Plan not found for planId");
        await assertRejects(() => findPlanById(cwd, "missing-id"), Error, "Plan not found for planId");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("shared hierarchy helpers match Epic, child, orphan, standalone, and progress semantics", () => {
    const plans = /** @type {any[]} */ ([
        { name: "epic", attrs: { classification: "PROJECT", type: "epic", status: "ready_for_work" } },
        { name: "epic/01-done", attrs: { classification: "FEATURE", parentPlan: "epic", status: "verified" } },
        { name: "epic/02-active", attrs: { classification: "FEATURE", parentPlan: "epic", status: "implemented" } },
        { name: "epic/03-failed", attrs: { classification: "FEATURE", parentPlan: "epic", status: "failed" } },
        { name: "epic/04-todo", attrs: { classification: "FEATURE", parentPlan: "epic", status: "draft" } },
        { name: "orphan/01-child", attrs: { classification: "FEATURE", parentPlan: "orphan", status: "draft" } },
        { name: "standalone", attrs: { classification: "FEATURE", status: "approved" } },
    ]);

    assertEquals(isEpicPlan(plans[0].attrs), true);
    assertEquals(isChildFeaturePlan(plans[1]), true);
    const grouped = groupPlanHierarchy(plans);
    assertEquals(grouped.epics.map((plan) => plan.name), ["epic"]);
    assertEquals((grouped.childrenByParent.get("epic") || []).map((plan) => plan.name), [
        "epic/01-done",
        "epic/02-active",
        "epic/03-failed",
        "epic/04-todo",
    ]);
    assertEquals(grouped.orphanChildren.map((plan) => plan.name), ["orphan/01-child"]);
    assertEquals(grouped.standalone.map((plan) => plan.name), ["standalone"]);
    assertEquals(countChildPlanProgress(grouped.childrenByParent.get("epic") || []), {
        verified: 1,
        active: 1,
        failed: 1,
        onHold: 0,
        remaining: 1,
        total: 4,
        byStatus: { verified: 1, implemented: 1, failed: 1, draft: 1 },
    });
});

Deno.test("resolveSiblingChildPlanDependencyStates exposes verified unverified and missing sibling states", () => {
    const siblings = /** @type {any[]} */ ([
        {
            name: "epic/01-done",
            planName: "epic/01-done",
            planId: "done-id",
            status: "verified",
            attrs: { status: "verified" },
        },
        {
            name: "epic/02-active",
            planName: "epic/02-active",
            planId: "active-id",
            status: "implemented",
            attrs: { status: "implemented" },
        },
    ]);

    assertEquals(
        resolveSiblingChildPlanDependencyStates("epic", ["done", "epic/active", "03-missing"], siblings),
        [
            {
                dependency: "done",
                planId: "done-id",
                planName: "epic/01-done",
                path: undefined,
                status: "verified",
                state: "verified",
            },
            {
                dependency: "epic/active",
                planId: "active-id",
                planName: "epic/02-active",
                path: undefined,
                status: "implemented",
                state: "unverified",
            },
            { dependency: "03-missing", state: "missing" },
        ],
    );
});

function lockedPlanFrontMatter(overrides = {}) {
    return {
        collaborationState: COLLABORATION_STATE_REMOTE_CANONICAL,
        collaborationServerUrl: "https://plans.example.test/base",
        collaborationSpaceId: "space-1",
        collaborationRevision: 7,
        collaborationBodyHash: "previous-body-hash",
        collaborationSyncedAt: "2026-07-04T00:00:00.000Z",
        ...overrides,
    };
}

testWithFs("collaboration front matter formats and parses non-secret metadata", async () => {
    await Promise.resolve();
    const markdown = injectFrontMatter(
        "## Plan\n\nBody",
        lockedPlanFrontMatter({
            collaborationServerUrl: "https://plans.example.test/base/",
            collaborationRevision: "8",
        }),
    );
    const { attrs } = parsePlanFrontMatter(markdown);

    assertEquals(attrs.collaborationState, COLLABORATION_STATE_REMOTE_CANONICAL);
    assertEquals(attrs.collaborationServerUrl, "https://plans.example.test/base");
    assertEquals(attrs.collaborationSpaceId, "space-1");
    assertEquals(attrs.collaborationRevision, 8);
    assertEquals(markdown.includes("contentKey"), false);
    assertEquals(markdown.includes("bearerCapability"), false);
    assertEquals(markdown.includes("reviewerUrl"), false);
});

testWithFs("locked shared plans reject normal save/status/front matter/body writes without mutation", async () => {
    const cwd = await Deno.makeTempDir();
    const path = await savePlan(cwd, "locked", "## Plan\n\nOriginal", lockedPlanFrontMatter());
    const before = await Deno.readTextFile(path);

    await assertRejects(() => savePlan(cwd, "locked", "## Plan\n\nChanged"), SharedPlanLockError);
    await assertRejects(() => updatePlanStatus(cwd, "locked", "approved"), SharedPlanLockError);
    await assertRejects(() => updatePlanFrontMatter(cwd, "locked", { summary: "Changed" }), SharedPlanLockError);

    await Deno.writeTextFile(
        path,
        injectFrontMatter("## Plan\n\nOriginal", { ...lockedPlanFrontMatter(), planId: "plan-1" }),
    );
    const bodyResource = await loadPlanBodyById(cwd, "plan-1");
    await assertRejects(
        () => savePlanBodyById(cwd, "plan-1", "## Plan\n\nChanged", bodyResource.bodyHash),
        SharedPlanLockError,
    );
    assertEquals((await Deno.readTextFile(path)).includes("Changed"), false);
    assertEquals(before.includes('collaborationBodyHash: "previous-body-hash"'), true);
});

testWithFs("locked shared plan writes require exact collaboration bypass", async () => {
    const cwd = await Deno.makeTempDir();
    await savePlan(cwd, "locked", "## Plan\n\nOriginal", lockedPlanFrontMatter());
    await assertRejects(
        () => savePlan(cwd, "locked", "## Plan\n\nChanged", {}, { collaborationLockBypass: /** @type {any} */ (true) }),
        SharedPlanLockError,
    );
    await savePlan(cwd, "locked", "## Plan\n\nChanged", {}, {
        collaborationLockBypass: COLLABORATION_LOCK_BYPASS.pull,
    });
    const loaded = await loadPlan(cwd, "locked");
    if (!loaded) throw new Error("Expected locked Plan to exist");
    assertStringIncludes(loaded.body, "Changed");
});

testWithFs("malformed remote-canonical front matter variants reject recovery writes without mutation", async () => {
    const cwd = await Deno.makeTempDir();
    const dir = await ensurePlansDir(cwd);
    const path = `${dir}/malformed.md`;
    const malformed = [
        "---",
        "collaborationState : remote_canonical # locked on the Plan Server",
        "classification: [",
        "---",
        "## Plan",
        "",
        "Original",
    ].join("\n");
    await Deno.writeTextFile(path, malformed);

    await assertRejects(() => updatePlanStatus(cwd, "malformed", "approved"), SharedPlanLockError);
    await assertRejects(() => updatePlanFrontMatter(cwd, "malformed", { summary: "Changed" }), SharedPlanLockError);
    assertEquals(await Deno.readTextFile(path), malformed);
});

testWithFs("saveChildFeaturePlans rejects overwriting locked child plans", async () => {
    const cwd = await Deno.makeTempDir();
    await savePlan(cwd, "epic/01-child", "## Child\n\nOriginal", lockedPlanFrontMatter());
    await assertRejects(
        () =>
            saveChildFeaturePlans(cwd, "epic", [{
                title: "Child",
                summary: "Changed",
                affectedPaths: [],
                dependencies: [],
                content: "## Child\n\nChanged",
                order: 1,
            }]),
        SharedPlanLockError,
    );
    const loaded = await loadPlan(cwd, "epic/01-child");
    if (!loaded) throw new Error("Expected child Plan to exist");
    assertStringIncludes(loaded.body, "Original");
});

testWithFs("updatePlanCollaborationMetadata intentionally refreshes controlled body hash", async () => {
    const cwd = await Deno.makeTempDir();
    await savePlan(cwd, "locked", "## Plan\n\nOriginal", lockedPlanFrontMatter());
    const attrs = await updatePlanCollaborationMetadata(
        cwd,
        "locked",
        { collaborationRevision: 8 },
        COLLABORATION_LOCK_BYPASS.pull,
        { body: "## Plan\n\nChanged" },
    );
    assertEquals(attrs.collaborationRevision, 8);
    assertEquals(attrs.collaborationBodyHash, await hashPlanBody("## Plan\n\nChanged"));
    const loaded = await loadPlan(cwd, "locked");
    if (!loaded) throw new Error("Expected locked Plan to exist");
    assertStringIncludes(loaded.body, "Changed");
});

testWithFs("updatePlanCollaborationMetadata preserves body hash without controlled body write", async () => {
    const cwd = await Deno.makeTempDir();
    await savePlan(cwd, "locked", "## Plan\n\nOriginal", lockedPlanFrontMatter());
    const attrs = await updatePlanCollaborationMetadata(
        cwd,
        "locked",
        { collaborationRevision: 8, collaborationBodyHash: "untrusted-new-hash" },
        COLLABORATION_LOCK_BYPASS.pull,
    );
    assertEquals(attrs.collaborationRevision, 8);
    assertEquals(attrs.collaborationBodyHash, "previous-body-hash");
});

testWithFs("updatePlanCollaborationMetadata filters non-front-matter collaboration secrets", async () => {
    const cwd = await Deno.makeTempDir();
    await savePlan(
        cwd,
        "locked",
        "## Plan\n\nOriginal",
        /** @type {any} */ ({
            ...lockedPlanFrontMatter(),
            bearerCapability: "bearer-secret",
            contentKey: "content-key-secret",
            reviewerUrl: "https://plans.example.test/p/space-1#contentKey=secret",
        }),
    );
    const attrs = await updatePlanCollaborationMetadata(
        cwd,
        "locked",
        /** @type {any} */ ({
            bearerCapability: "new-bearer-secret",
            collaborationRevision: 8,
            collaborationServerUrl: "https://plans.example.test/base#contentKey=secret",
            contentKey: "new-content-key-secret",
            reviewerUrl: "https://plans.example.test/p/space-1#contentKey=new-secret",
        }),
        COLLABORATION_LOCK_BYPASS.pull,
    );
    const loaded = await loadPlan(cwd, "locked");
    if (!loaded) throw new Error("Expected locked Plan to exist");
    const markdown = await Deno.readTextFile(loaded.path);

    assertEquals(attrs.collaborationRevision, 8);
    assertEquals(attrs.collaborationServerUrl, "https://plans.example.test/base");
    assertEquals(markdown.includes("bearerCapability"), false);
    assertEquals(markdown.includes("contentKey"), false);
    assertEquals(markdown.includes("reviewerUrl"), false);
    assertEquals(markdown.includes("secret"), false);
});
