import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
    ensureExecutionPlanFile,
    loadCanonicalExecutionPlanSource,
    prepareExecutionPlanFile,
} from "./execution-plan-file.js";
import { injectFrontMatter, parsePlanFrontMatter } from "../../plan-store.js";

async function makeTempProject() {
    const root = await Deno.makeTempDir();
    await Deno.mkdir(join(root, "docs", "plans"), { recursive: true });
    return root;
}

Deno.test("prepareExecutionPlanFile restores absent top-level and nested execution Plans exactly", async () => {
    const projectRoot = await makeTempProject();
    const executionRoot = await makeTempProject();
    const markdown = injectFrontMatter("# Plan\n\nBody", { planId: "plan-1", status: "implemented" });
    await Deno.writeTextFile(join(projectRoot, "docs", "plans", "epic", "child.md"), markdown).catch(async () => {
        await Deno.mkdir(join(projectRoot, "docs", "plans", "epic"));
        await Deno.writeTextFile(join(projectRoot, "docs", "plans", "epic", "child.md"), markdown);
    });

    await Deno.remove(join(executionRoot, "docs", "plans"), { recursive: true });
    const result = await prepareExecutionPlanFile({ projectRoot, executionCwd: executionRoot, planName: "epic/child" });

    assertEquals(result.kind, "restored");
    assertEquals(result.relativePath, "docs/plans/epic/child.md");
    assertEquals(await Deno.readTextFile(join(executionRoot, "docs", "plans", "epic", "child.md")), markdown);
});

Deno.test("prepareExecutionPlanFile preserves valid legacy execution Plan without Plan ID", async () => {
    const projectRoot = await makeTempProject();
    const executionRoot = await makeTempProject();
    await Deno.writeTextFile(
        join(projectRoot, "docs", "plans", "demo.md"),
        injectFrontMatter("# Canonical", { planId: "plan-1" }),
    );
    const legacy = injectFrontMatter("# Legacy", {});
    await Deno.writeTextFile(join(executionRoot, "docs", "plans", "demo.md"), legacy);

    const result = await prepareExecutionPlanFile({ projectRoot, executionCwd: executionRoot, planName: "demo" });

    assertEquals(result.kind, "present");
    assertEquals(await Deno.readTextFile(join(executionRoot, "docs", "plans", "demo.md")), legacy);
});

Deno.test("prepareExecutionPlanFile reconciles stale execution metadata without replacing its Plan body", async () => {
    const projectRoot = await makeTempProject();
    const executionRoot = await makeTempProject();
    await Deno.writeTextFile(
        join(projectRoot, "docs", "plans", "demo.md"),
        injectFrontMatter("# Canonical body\n\nPrimary checkout prose.", {
            planId: "plan-1",
            classification: "PLANNED_CHANGE",
            status: "ready_for_work",
        }),
    );
    const executionMarkdown = injectFrontMatter("# Worktree body\n\nPreserve this exact prose.", {
        planId: "plan-1",
        classification: "QUICK_FIX",
        status: "approved",
        summary: "keep-me",
    });
    await Deno.writeTextFile(join(executionRoot, "docs", "plans", "demo.md"), executionMarkdown);

    const result = await prepareExecutionPlanFile({ projectRoot, executionCwd: executionRoot, planName: "demo" });

    assertEquals(result.kind, "reconciled");
    const reconciled = parsePlanFrontMatter(await Deno.readTextFile(join(executionRoot, "docs", "plans", "demo.md")));
    assertEquals(reconciled.attrs.classification, "PLANNED_CHANGE");
    assertEquals(reconciled.attrs.status, "ready_for_work");
    assertEquals(reconciled.attrs.summary, "keep-me");
    assertEquals(reconciled.body, "# Worktree body\n\nPreserve this exact prose.");
});

Deno.test("prepareExecutionPlanFile heals a diverged Plan ID toward canonical and blocks symlinked parents", async () => {
    const projectRoot = await makeTempProject();
    const executionRoot = await makeTempProject();
    await Deno.writeTextFile(
        join(projectRoot, "docs", "plans", "demo.md"),
        injectFrontMatter("# Canonical", { planId: "plan-1" }),
    );
    // The plan name is the store key, so an execution copy at the same path is this
    // Plan with a twice-minted id, not a different Plan. Blocking here stranded the
    // Plan over Front Matter RunWield owns, so the canonical id wins.
    const diverged = injectFrontMatter("# Worktree body\n\nUser-owned prose survives.", { planId: "plan-2" });
    await Deno.writeTextFile(join(executionRoot, "docs", "plans", "demo.md"), diverged);

    const healed = await prepareExecutionPlanFile({ projectRoot, executionCwd: executionRoot, planName: "demo" });
    assertEquals(healed.kind, "reconciled");
    assertEquals(healed.healedPlanId, { from: "plan-2", to: "plan-1" });
    const afterHeal = parsePlanFrontMatter(await Deno.readTextFile(join(executionRoot, "docs", "plans", "demo.md")));
    assertEquals(afterHeal.attrs.planId, "plan-1");
    assertEquals(afterHeal.body, "# Worktree body\n\nUser-owned prose survives.");

    // Healing is one-directional: the canonical Plan is never rewritten from a copy.
    const canonicalAfter = parsePlanFrontMatter(await Deno.readTextFile(join(projectRoot, "docs", "plans", "demo.md")));
    assertEquals(canonicalAfter.attrs.planId, "plan-1");

    const linkedRoot = await Deno.makeTempDir();
    await Deno.remove(join(executionRoot, "docs", "plans", "demo.md"));
    await Deno.remove(join(executionRoot, "docs", "plans"));
    await Deno.symlink(linkedRoot, join(executionRoot, "docs", "plans"));
    const symlink = await prepareExecutionPlanFile({ projectRoot, executionCwd: executionRoot, planName: "demo" });
    assertEquals(symlink.kind, "symlink");
});

Deno.test("loadCanonicalExecutionPlanSource classifies absent and malformed canonical source", async () => {
    const projectRoot = await makeTempProject();
    const absent = await loadCanonicalExecutionPlanSource(projectRoot, "missing");
    assertEquals(absent.kind, "absent");
    assertStringIncludes(absent.relativePath, "docs/plans/missing.md");

    await Deno.writeTextFile(join(projectRoot, "docs", "plans", "bad.md"), "---\n: bad\n---\n# Bad");
    const malformed = await loadCanonicalExecutionPlanSource(projectRoot, "bad");
    assertEquals(malformed.kind, "malformed");
});

Deno.test("prepareExecutionPlanFile classifies canonical symlink and non-regular sources", async () => {
    const projectRoot = await makeTempProject();
    const executionRoot = await makeTempProject();
    const outside = await Deno.makeTempFile();
    await Deno.symlink(outside, join(projectRoot, "docs", "plans", "linked.md"));
    const linked = await prepareExecutionPlanFile({ projectRoot, executionCwd: executionRoot, planName: "linked" });
    assertEquals(linked.kind, "symlink");

    await Deno.mkdir(join(projectRoot, "docs", "plans", "directory.md"));
    const directory = await prepareExecutionPlanFile({
        projectRoot,
        executionCwd: executionRoot,
        planName: "directory",
    });
    assertEquals(directory.kind, "non_regular");
});

Deno.test("loadCanonicalExecutionPlanSource rejects symlinked and non-directory canonical parents", async () => {
    const projectRoot = await makeTempProject();
    const outsidePlans = await makeTempProject();
    await Deno.writeTextFile(
        join(outsidePlans, "docs", "plans", "demo.md"),
        injectFrontMatter("# Outside", { planId: "outside-plan" }),
    );

    await Deno.remove(join(projectRoot, "docs", "plans"));
    await Deno.symlink(join(outsidePlans, "docs", "plans"), join(projectRoot, "docs", "plans"));
    const symlinkedParent = await loadCanonicalExecutionPlanSource(projectRoot, "demo");
    assertEquals(symlinkedParent.kind, "symlink");
    assertEquals(symlinkedParent.relativePath, "docs/plans/demo.md");

    await Deno.remove(join(projectRoot, "docs", "plans"));
    await Deno.mkdir(join(projectRoot, "docs", "plans"), { recursive: true });
    await Deno.writeTextFile(join(projectRoot, "docs", "plans", "epic"), "not a directory");
    const nonDirectoryParent = await loadCanonicalExecutionPlanSource(projectRoot, "epic/child");
    assertEquals(nonDirectoryParent.kind, "non_regular");
    assertEquals(nonDirectoryParent.relativePath, "docs/plans/epic/child.md");
});

Deno.test("prepareExecutionPlanFile blocks target symlink directory and malformed target evidence", async () => {
    const projectRoot = await makeTempProject();
    const executionRoot = await makeTempProject();
    await Deno.writeTextFile(join(projectRoot, "docs", "plans", "demo.md"), injectFrontMatter("# Canonical", {}));

    await Deno.symlink(await Deno.makeTempFile(), join(executionRoot, "docs", "plans", "demo.md"));
    const symlink = await prepareExecutionPlanFile({ projectRoot, executionCwd: executionRoot, planName: "demo" });
    assertEquals(symlink.kind, "symlink");

    await Deno.remove(join(executionRoot, "docs", "plans", "demo.md"));
    await Deno.mkdir(join(executionRoot, "docs", "plans", "demo.md"));
    const directory = await prepareExecutionPlanFile({ projectRoot, executionCwd: executionRoot, planName: "demo" });
    assertEquals(directory.kind, "non_regular");

    await Deno.remove(join(executionRoot, "docs", "plans", "demo.md"));
    await Deno.writeTextFile(join(executionRoot, "docs", "plans", "demo.md"), "---\n: bad\n---\n# Bad");
    const malformed = await prepareExecutionPlanFile({ projectRoot, executionCwd: executionRoot, planName: "demo" });
    assertEquals(malformed.kind, "malformed");
});

Deno.test("prepareExecutionPlanFile reports restore failure when plans parent cannot be created", async () => {
    const projectRoot = await makeTempProject();
    const executionRoot = await Deno.makeTempDir();
    await Deno.writeTextFile(join(projectRoot, "docs", "plans", "demo.md"), injectFrontMatter("# Canonical", {}));
    await Deno.mkdir(join(executionRoot, "docs"), { recursive: true });
    await Deno.writeTextFile(join(executionRoot, "docs", "plans"), "not a directory");

    const result = await prepareExecutionPlanFile({ projectRoot, executionCwd: executionRoot, planName: "demo" });

    assertEquals(result.kind, "non_regular");
    assertEquals(await Deno.readTextFile(join(executionRoot, "docs", "plans")), "not a directory");
});

Deno.test("ensureExecutionPlanFile handles real concurrent publication without overwriting", async () => {
    const projectRoot = await makeTempProject();
    const executionRoot = await makeTempProject();
    const canonicalMarkdown = injectFrontMatter("# Canonical", { planId: "plan-1" });
    await Deno.writeTextFile(join(projectRoot, "docs", "plans", "demo.md"), canonicalMarkdown);
    const source = await loadCanonicalExecutionPlanSource(projectRoot, "demo");
    if (source.kind !== "loaded") throw new Error("source did not load");
    await Deno.remove(join(executionRoot, "docs", "plans", "demo.md")).catch(() => {});

    const results = await Promise.all([
        ensureExecutionPlanFile({ executionCwd: executionRoot, planName: "demo", canonicalSource: source }),
        ensureExecutionPlanFile({ executionCwd: executionRoot, planName: "demo", canonicalSource: source }),
    ]);

    assertEquals(results.every((result) => result.kind === "restored" || result.kind === "present"), true);
    assertEquals(results.some((result) => result.kind === "restored"), true);
    assertEquals(await Deno.readTextFile(join(executionRoot, "docs", "plans", "demo.md")), canonicalMarkdown);
});

Deno.test("ensureExecutionPlanFile preserves concurrently created target and cleans temporary file", async () => {
    const projectRoot = await makeTempProject();
    const executionRoot = await makeTempProject();
    const canonicalMarkdown = injectFrontMatter("# Canonical", { planId: "plan-1" });
    await Deno.writeTextFile(join(projectRoot, "docs", "plans", "demo.md"), canonicalMarkdown);
    const source = await loadCanonicalExecutionPlanSource(projectRoot, "demo");
    if (source.kind !== "loaded") throw new Error("source did not load");
    const concurrent = injectFrontMatter("# Concurrent", { planId: "plan-1" });
    await Deno.writeTextFile(join(executionRoot, "docs", "plans", "demo.md"), concurrent);

    const result = await ensureExecutionPlanFile({
        executionCwd: executionRoot,
        planName: "demo",
        canonicalSource: source,
    });

    assertEquals(result.kind, "present");
    assertEquals(await Deno.readTextFile(join(executionRoot, "docs", "plans", "demo.md")), concurrent);
    const entries = [];
    for await (const entry of Deno.readDir(join(executionRoot, "docs", "plans"))) entries.push(entry.name);
    assertEquals(entries.some((name) => name.startsWith(".rw-plan-")), false);
});
