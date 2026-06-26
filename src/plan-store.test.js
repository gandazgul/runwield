import { assertEquals, assertRejects } from "@std/assert";
import {
    countChildPlanProgress,
    ensurePlanIdentity,
    findPlanById,
    findPlansByParent,
    getPlansDir,
    groupPlanHierarchy,
    injectFrontMatter,
    isChildFeaturePlan,
    isEpicPlan,
    listPlanResources,
    listPlans,
    loadExternalPlan,
    loadPlan,
    parsePlanFrontMatter,
    resolvePlan,
    resolveSiblingChildPlanDependencyStates,
    saveChildFeaturePlans,
    savePlan,
    updatePlanFrontMatter,
    updatePlanStatus,
} from "./plan-store.js";

/**
 * @param {string} name
 * @param {() => Promise<void>} fn
 */
function testWithFs(name, fn) {
    Deno.test({ name, permissions: { read: true, write: true }, fn });
}

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
        const resource = await findPlanById(cwd, "lookup-id");
        assertEquals(resource.planName, "lookup");
        assertEquals(resource.relativePath, "plans/lookup.md");

        await assertRejects(() => findPlanById(cwd, "missing-id"), Error, "Plan not found for planId");
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
            '  - "<|"|src/tools/user-interview.js<|"|"',
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

testWithFs("saveChildFeaturePlans creates draft child FEATURE plans with dependencies", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        const results = await saveChildFeaturePlans(cwd, "project-breakdown-epic", [
            {
                sequence: 1,
                title: "Preserve Epic and child metadata",
                summary: "Keep parent-child links loadable",
                affectedPaths: ["src/plan-store.js"],
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
            affectedPaths: ["src/plan-store.js"],
        });

        const first = await loadPlan(cwd, "project-breakdown-epic/01-preserve-epic-and-child-metadata");
        assertEquals(first?.attrs.classification, "FEATURE");
        assertEquals(first?.attrs.status, "draft");
        assertEquals(first?.attrs.parentPlan, "project-breakdown-epic");
        assertEquals(first?.attrs.summary, "Keep parent-child links loadable");

        const second = await loadPlan(cwd, "project-breakdown-epic/02-load-child-features");
        assertEquals(second?.attrs.dependencies, ["project-breakdown-epic/01-preserve-epic-and-child-metadata"]);
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
            "Child plan sequence must be a non-negative integer",
        );
        await assertRejects(
            () => saveChildFeaturePlans(cwd, "epic-a", [{ ...validChild, sequence: 1.5 }]),
            Error,
            "Child plan sequence must be a non-negative integer",
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
        worktreeStatus: "active",
    });

    const parsed = parsePlanFrontMatter(markdown);
    assertEquals(parsed.attrs.executionBaselineTree, "tree123");
    assertEquals(parsed.attrs.worktreeId, "wt-123");
    assertEquals(parsed.attrs.worktreePath, "/tmp/repo-runwield-plan-wt-123");
    assertEquals(parsed.attrs.worktreeBranch, "runwield/worktree/plan-wt-123");
    assertEquals(parsed.attrs.worktreeStatus, "active");

    const cleared = injectFrontMatter(markdown, {
        worktreeId: null,
        worktreePath: null,
        worktreeBranch: null,
        worktreeStatus: null,
    });
    const reparsed = parsePlanFrontMatter(cleared);
    assertEquals(reparsed.attrs.worktreeId, undefined);
    assertEquals(reparsed.attrs.worktreePath, undefined);
    assertEquals(reparsed.attrs.worktreeBranch, undefined);
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
        resolveSiblingChildPlanDependencyStates("epic", ["01-done", "epic/02-active", "03-missing"], siblings),
        [
            {
                dependency: "01-done",
                planId: "done-id",
                planName: "epic/01-done",
                path: undefined,
                status: "verified",
                state: "verified",
            },
            {
                dependency: "epic/02-active",
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
