import { assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, join } from "@std/path";
import { defineGitFixture, git } from "../git-test-fixture.ts";
import { listEntries } from "../worktree-registry.js";
import { loadControllerView } from "./controller-registry.ts";
import { preparePlanningWorktreeForPlan } from "./planning-worktree.ts";

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
    assertEquals(view.state.worktreeStatus, "planning");
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
