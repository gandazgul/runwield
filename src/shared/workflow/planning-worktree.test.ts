import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { dirname, join } from "@std/path";
import { defineGitFixture, git } from "../git-test-fixture.ts";
import { listPlans } from "../../plan-store.js";
import { listEntries, updateEntry } from "../worktree-registry.js";
import { loadControllerView } from "./controller-registry.ts";
import { resolveWorkflowPlanLocation } from "./plan-location.ts";
import { findTargetBranchPlansByParent, preparePlanningWorktreeForPlan } from "./planning-worktree.ts";

async function writePlan(cwd: string, name: string, attrs: Record<string, unknown>, body: string) {
    const path = join(cwd, "docs", "plans", `${name}.md`);
    await Deno.mkdir(dirname(path), { recursive: true });
    const lines = ["---"];
    for (const [key, value] of Object.entries(attrs)) {
        if (Array.isArray(value)) {
            lines.push(`${key}:`);
            for (const item of value) lines.push(`  - ${JSON.stringify(item)}`);
        } else {
            lines.push(`${key}: ${JSON.stringify(value)}`);
        }
    }
    lines.push("---", "", body);
    await Deno.writeTextFile(path, lines.join("\n"));
}

const fixture = defineGitFixture(async (repo) => {
    await Deno.writeTextFile(join(repo, "README.md"), "base\n");
    await writePlan(repo, "epic", {
        planId: "plan-epic",
        classification: "PROJECT",
        complexity: "HIGH",
        status: "ready_for_work",
        targetBranch: "epic-target",
        affectedPaths: [],
        createdAt: "2026-01-01T00:00:00.000Z",
    }, "# Epic\n");
    await writePlan(repo, "epic/01-child", {
        planId: "plan-child-01",
        classification: "FEATURE",
        complexity: "MEDIUM",
        status: "draft",
        parentPlan: "epic",
        targetBranch: "epic-target",
        affectedPaths: [],
        createdAt: "2026-01-01T00:00:00.000Z",
    }, "# Child\n\nPRIMARY STALE MARKER\n");
    await git(repo, ["add", "."]);
    await git(repo, ["commit", "-m", "main stale plans"]);
    await git(repo, ["switch", "-c", "epic-target"]);
    await Deno.writeTextFile(join(repo, "src-target-only.js"), "export const targetOnly = true;\n");
    await writePlan(repo, "epic/01-child", {
        planId: "plan-child-01",
        classification: "FEATURE",
        complexity: "MEDIUM",
        status: "draft",
        parentPlan: "epic",
        targetBranch: "epic-target",
        affectedPaths: [],
        createdAt: "2026-01-01T00:00:00.000Z",
    }, "# Child\n\nTARGET PLAN BODY\n");
    await git(repo, ["add", "."]);
    await git(repo, ["commit", "-m", "target delivered context"]);
    await git(repo, ["switch", "main"]);
});

Deno.test("planning worktree starts from the target branch and is not execution", async () => {
    const repo = await fixture.checkout();
    await Deno.writeTextFile(join(repo, "primary-dirty.txt"), "do not touch\n");

    const result = await preparePlanningWorktreeForPlan(repo, "epic/01-child", {
        planId: "plan-child-01",
        targetBranch: "epic-target",
    });

    assertEquals(result.reused, false);
    assertEquals(result.entry.status, "planning");
    assertStringIncludes(await Deno.readTextFile(join(result.entry.path, "src-target-only.js")), "targetOnly");
    assertStringIncludes(result.plan.markdown, "TARGET PLAN BODY");
    assertEquals(result.plan.markdown.includes("PRIMARY STALE MARKER"), false);
    assertEquals(await Deno.readTextFile(join(repo, "primary-dirty.txt")), "do not touch\n");

    const entries = await listEntries(repo);
    assertEquals(entries.length, 1);
    assertEquals(entries[0].status, "planning");

    const view = await loadControllerView(repo, { planName: "epic/01-child", planId: "plan-child-01" }, {});
    assertEquals(view.state.documentWorktreeId, result.entry.id);
    assertEquals(view.state.worktreeId, undefined);
    assertEquals(view.state.worktreePath, undefined);
    assertEquals(view.state.worktreeStatus, undefined);
    assertEquals(view.state.executionMode, undefined);
});

Deno.test("planning worktree resume reuses saved Plan edits", async () => {
    const repo = await fixture.checkout();
    const first = await preparePlanningWorktreeForPlan(repo, "epic/01-child", {
        planId: "plan-child-01",
        targetBranch: "epic-target",
    });
    const planPath = join(first.entry.path, "docs", "plans", "epic", "01-child.md");
    await Deno.writeTextFile(
        planPath,
        (await Deno.readTextFile(planPath)).replace("TARGET PLAN BODY", "SAVED PLANNER EDIT"),
    );

    const second = await preparePlanningWorktreeForPlan(repo, "epic/01-child", {
        planId: "plan-child-01",
        targetBranch: "epic-target",
    });

    assertEquals(second.reused, true);
    assertEquals(second.entry.id, first.entry.id);
    assertStringIncludes(second.plan.markdown, "SAVED PLANNER EDIT");
});

Deno.test("planning worktree refuses to create a missing target from main", async () => {
    const repo = await fixture.checkout();

    await assertRejects(
        () =>
            preparePlanningWorktreeForPlan(repo, "epic/01-child", {
                planId: "plan-child-01",
                targetBranch: "missing-target",
            }),
        Error,
        "Target branch does not exist",
    );
});

Deno.test("target child catalog uses saved planning documents over target branch copies", async () => {
    const repo = await fixture.checkout();
    const planning = await preparePlanningWorktreeForPlan(repo, "epic/01-child", {
        planId: "plan-child-01",
        targetBranch: "epic-target",
    });
    const planPath = join(planning.entry.path, "docs", "plans", "epic", "01-child.md");
    await Deno.writeTextFile(
        planPath,
        (await Deno.readTextFile(planPath)).replace('status: "draft"', 'status: "approved"'),
    );

    const children = await findTargetBranchPlansByParent(repo, "epic-target", "epic");

    assertEquals(children.length, 1);
    assertEquals(children[0].attrs.status, "approved");
    assertEquals(children[0].path, join(planning.entry.path, "docs", "plans", "epic", "01-child.md"));
});

Deno.test("target document is selected before stale primary copy", async () => {
    const repo = await fixture.checkout();

    const location = await resolveWorkflowPlanLocation(repo, "epic/01-child");

    assertStringIncludes(location.plan?.markdown || "", "TARGET PLAN BODY");
    assertEquals(location.plan?.markdown.includes("PRIMARY STALE MARKER"), false);
});

Deno.test("planning document is selected by load and catalog", async () => {
    const repo = await fixture.checkout();
    const planning = await preparePlanningWorktreeForPlan(repo, "epic/01-child", {
        planId: "plan-child-01",
        targetBranch: "epic-target",
    });
    const planPath = join(planning.entry.path, "docs", "plans", "epic", "01-child.md");
    await Deno.writeTextFile(
        planPath,
        (await Deno.readTextFile(planPath)).replace("TARGET PLAN BODY", "SAVED CATALOG BODY"),
    );

    const location = await resolveWorkflowPlanLocation(repo, "epic/01-child");
    const plans = await listPlans(repo);
    const listed = plans.find((item) => item.name === "epic/01-child");

    assertEquals(location.documentRoot, planning.entry.path);
    assertStringIncludes(location.plan?.markdown || "", "SAVED CATALOG BODY");
    assertEquals(listed?.path, planPath);
});

Deno.test("planning preparation stops when target fetch fails", async () => {
    const repo = await fixture.checkout();
    await git(repo, ["update-ref", "refs/remotes/origin/epic-target", "epic-target"]);
    await git(repo, ["remote", "add", "origin", join(repo, "missing-remote.git")]);

    await assertRejects(
        () =>
            preparePlanningWorktreeForPlan(repo, "epic/01-child", {
                planId: "plan-child-01",
                targetBranch: "epic-target",
            }),
        Error,
        "Could not refresh target branch",
    );

    assertEquals((await listEntries(repo)).length, 0);
});

Deno.test("target discovery errors stop the catalog before stale overlays", async () => {
    const repo = await fixture.checkout();
    await git(repo, ["switch", "epic-target"]);
    await writePlan(repo, "epic/01-child", {
        planId: "different-child-id",
        classification: "FEATURE",
        complexity: "MEDIUM",
        status: "draft",
        parentPlan: "epic",
        targetBranch: "epic-target",
        affectedPaths: [],
        createdAt: "2026-01-01T00:00:00.000Z",
    }, "# Child\n");
    await git(repo, ["add", "."]);
    await git(repo, ["commit", "-m", "break target identity"]);
    await git(repo, ["switch", "main"]);

    await assertRejects(
        () => listPlans(repo),
        Error,
        "Target Plan epic/01-child has a different Plan ID",
    );
});

Deno.test("planning preparation serializes duplicate callers", async () => {
    const repo = await fixture.checkout();

    const [first, second] = await Promise.all([
        preparePlanningWorktreeForPlan(repo, "epic/01-child", {
            planId: "plan-child-01",
            targetBranch: "epic-target",
        }),
        preparePlanningWorktreeForPlan(repo, "epic/01-child", {
            planId: "plan-child-01",
            targetBranch: "epic-target",
        }),
    ]);

    assertEquals(first.entry.id, second.entry.id);
    assertEquals((await listEntries(repo)).length, 1);
});

Deno.test("planning preparation returns live execution instead of registering twice", async () => {
    const repo = await fixture.checkout();
    const planning = await preparePlanningWorktreeForPlan(repo, "epic/01-child", {
        planId: "plan-child-01",
        targetBranch: "epic-target",
    });
    await updateEntry(repo, planning.entry.id, { status: "active" });

    const result = await preparePlanningWorktreeForPlan(repo, "epic/01-child", {
        planId: "plan-child-01",
        targetBranch: "epic-target",
    });

    assertEquals(result.reused, true);
    assertEquals(result.entry.id, planning.entry.id);
    assertEquals((await listEntries(repo)).length, 1);
});
