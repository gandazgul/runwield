import { assertEquals, assertRejects } from "@std/assert";
import {
    findPlansByParent,
    getPlansDir,
    injectFrontMatter,
    listPlans,
    loadExternalPlan,
    loadPlan,
    parsePlanFrontMatter,
    resolvePlan,
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
        await assertRejects(
            () => saveChildFeaturePlans(cwd, "../outside", []),
            Error,
            "Plan name cannot escape plans/",
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
        worktreePath: "/tmp/repo-harns-plan-wt-123",
        worktreeBranch: "harns/worktree/plan-wt-123",
        worktreeStatus: "active",
    });

    const parsed = parsePlanFrontMatter(markdown);
    assertEquals(parsed.attrs.executionBaselineTree, "tree123");
    assertEquals(parsed.attrs.worktreeId, "wt-123");
    assertEquals(parsed.attrs.worktreePath, "/tmp/repo-harns-plan-wt-123");
    assertEquals(parsed.attrs.worktreeBranch, "harns/worktree/plan-wt-123");
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
