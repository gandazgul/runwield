import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { dirname, join } from "@std/path";
import { loadPlan } from "../../plan-store.js";
import { defineGitFixture, git } from "../git-test-fixture.ts";
import { prepareEditedSiblingPlans } from "./epic-sibling-drafts.ts";

type PlanFixtureAttribute = string | number | string[];
type PlanFixtureAttributes = Record<string, PlanFixtureAttribute>;

async function writePlan(cwd: string, name: string, attrs: PlanFixtureAttributes, body: string) {
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

function childAttrs(order: number, status: string): PlanFixtureAttributes {
    return {
        planId: `plan-child-${order}`,
        classification: "PLANNED_CHANGE",
        complexity: "MEDIUM",
        status,
        parentPlan: "epic",
        order,
        targetBranch: "epic/epic",
        affectedPaths: [],
        createdAt: "2026-01-01T00:00:00.000Z",
    };
}

/** A child worktree as Planner leaves it: the child being planned plus its committed siblings. */
const familyFixture = defineGitFixture(async (repo) => {
    await writePlan(repo, "epic/01-current", childAttrs(1, "ready_for_work"), "# Current\n");
    await writePlan(repo, "epic/02-approved", childAttrs(2, "approved"), "# Approved\n\nOriginal scope.\n");
    await writePlan(repo, "epic/03-draft", childAttrs(3, "draft"), "# Draft\n");
    await writePlan(repo, "epic/04-started", childAttrs(4, "in_progress"), "# Started\n");
    await git(repo, ["add", "."]);
    await git(repo, ["commit", "-m", "Epic family"]);
});

const CURRENT_PATH = "docs/plans/epic/01-current.md";

Deno.test("an approved sibling whose scope moved goes back to draft and travels with the child", async () => {
    const repo = await familyFixture.checkout();
    const approved = await loadPlan(repo, "epic/02-approved");
    await Deno.writeTextFile(
        approved!.path,
        approved!.markdown.replace("Original scope.", "Original scope, plus the parser split out of child 1."),
    );

    const paths = await prepareEditedSiblingPlans(repo, "epic/01-current", CURRENT_PATH);

    assertEquals(paths, ["docs/plans/epic/02-approved.md"]);
    assertEquals((await loadPlan(repo, "epic/02-approved"))?.attrs.status, "draft");
});

Deno.test("an edited draft sibling and a new split-out draft travel with the child unchanged in status", async () => {
    const repo = await familyFixture.checkout();
    const draft = await loadPlan(repo, "epic/03-draft");
    await Deno.writeTextFile(draft!.path, `${draft!.markdown}\nMoved here from child 1.\n`);
    await writePlan(repo, "epic/05-split", childAttrs(5, "draft"), "# Split out of child 1\n");

    const paths = await prepareEditedSiblingPlans(repo, "epic/01-current", CURRENT_PATH);

    assertEquals(paths.sort(), ["docs/plans/epic/03-draft.md", "docs/plans/epic/05-split.md"]);
    assertEquals((await loadPlan(repo, "epic/03-draft"))?.attrs.status, "draft");
});

Deno.test("a started sibling stays as it is", async () => {
    const repo = await familyFixture.checkout();
    const started = await loadPlan(repo, "epic/04-started");
    await Deno.writeTextFile(started!.path, `${started!.markdown}\nMore scope.\n`);

    const error = await assertRejects(() => prepareEditedSiblingPlans(repo, "epic/01-current", CURRENT_PATH));

    assertStringIncludes(String(error), "epic/04-started has already started (in_progress)");
});

Deno.test("a child with no sibling edits carries nothing extra", async () => {
    const repo = await familyFixture.checkout();
    await Deno.writeTextFile(join(repo, CURRENT_PATH), "---\nstatus: ready_for_work\n---\n# Edited current\n");

    assertEquals(await prepareEditedSiblingPlans(repo, "epic/01-current", CURRENT_PATH), []);
});
