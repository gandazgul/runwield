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

Deno.test("prepareExecutionPlanFile fills a missing Plan ID from the primary Plan", async () => {
    const projectRoot = await makeTempProject();
    const executionRoot = await makeTempProject();
    await Deno.writeTextFile(
        join(projectRoot, "docs", "plans", "demo.md"),
        injectFrontMatter("# Canonical", { planId: "plan-1" }),
    );
    const legacy = injectFrontMatter("# Legacy", {});
    await Deno.writeTextFile(join(executionRoot, "docs", "plans", "demo.md"), legacy);

    const result = await prepareExecutionPlanFile({ projectRoot, executionCwd: executionRoot, planName: "demo" });

    assertEquals(result.kind, "reconciled");
    const healed = parsePlanFrontMatter(await Deno.readTextFile(join(executionRoot, "docs", "plans", "demo.md")));
    assertEquals(healed.attrs.planId, "plan-1");
    assertEquals(healed.body, "# Legacy");
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
            executionAgent: "engineer",
            collaborationRecommendation: "autonomous",
            implementedAt: "2026-01-01T00:00:00.000Z",
            validationCiAttempts: 2,
            validationCheckpoint: {
                version: 1,
                attemptId: "attempt-1",
                generation: "generation-1",
                expectedStatus: "ready_for_work",
                nextPhase: "mechanical",
                state: "paused",
                updatedAt: "2026-01-01T00:00:00.000Z",
            },
        }),
    );
    const executionMarkdown = injectFrontMatter("# Worktree body\n\nPreserve this exact prose.", {
        planId: "plan-1",
        classification: "QUICK_FIX",
        status: "approved",
        executionAgent: "frontend-engineer",
        collaborationRecommendation: "pair",
        implementedAt: null,
        validationCiAttempts: 0,
        validationCheckpoint: null,
        summary: "keep-me",
    }) + "\n";
    await Deno.writeTextFile(join(executionRoot, "docs", "plans", "demo.md"), executionMarkdown);

    const result = await prepareExecutionPlanFile({ projectRoot, executionCwd: executionRoot, planName: "demo" });

    assertEquals(result.kind, "reconciled");
    const reconciledMarkdown = await Deno.readTextFile(join(executionRoot, "docs", "plans", "demo.md"));
    assertStringIncludes(reconciledMarkdown, "validationCheckpoint:\n  version: 1");
    assertEquals(reconciledMarkdown.includes("validationCheckpoint:\n    version: 1"), false);
    const formatCheck = await new Deno.Command(Deno.execPath(), {
        args: ["fmt", "--check", join(executionRoot, "docs", "plans", "demo.md")],
        stdout: "piped",
        stderr: "piped",
    }).output();
    assertEquals(formatCheck.success, true, new TextDecoder().decode(formatCheck.stderr));
    const reconciled = parsePlanFrontMatter(reconciledMarkdown);
    assertEquals(reconciled.attrs.classification, "PLANNED_CHANGE");
    assertEquals(reconciled.attrs.status, "ready_for_work");
    assertEquals(reconciled.attrs.executionAgent, "engineer");
    assertEquals(reconciled.attrs.collaborationRecommendation, "autonomous");
    assertEquals(reconciled.attrs.implementedAt, "2026-01-01T00:00:00.000Z");
    assertEquals(reconciled.attrs.validationCiAttempts, 2);
    assertEquals(reconciled.attrs.validationCheckpoint?.generation, "generation-1");
    assertEquals(reconciled.attrs.summary, "keep-me");
    assertEquals(reconciled.body, "# Worktree body\n\nPreserve this exact prose.\n");
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

Deno.test("prepareExecutionPlanFile preserves a symlink and blocks", async () => {
    const projectRoot = await makeTempProject();
    const executionRoot = await makeTempProject();
    const canonical = injectFrontMatter("# Canonical", {});
    await Deno.writeTextFile(join(projectRoot, "docs", "plans", "demo.md"), canonical);
    await Deno.symlink(await Deno.makeTempFile(), join(executionRoot, "docs", "plans", "demo.md"));

    const result = await prepareExecutionPlanFile({ projectRoot, executionCwd: executionRoot, planName: "demo" });

    assertEquals(result.kind, "symlink");
    assertEquals((await Deno.lstat(join(executionRoot, "docs", "plans", "demo.md"))).isSymlink, true);
});

Deno.test("prepareExecutionPlanFile preserves a non-file path and blocks", async () => {
    const projectRoot = await makeTempProject();
    const executionRoot = await makeTempProject();
    const canonical = injectFrontMatter("# Canonical", {});
    await Deno.writeTextFile(join(projectRoot, "docs", "plans", "demo.md"), canonical);
    await Deno.remove(join(executionRoot, "docs", "plans", "demo.md")).catch(() => {});
    await Deno.mkdir(join(executionRoot, "docs", "plans", "demo.md"));

    const result = await prepareExecutionPlanFile({ projectRoot, executionCwd: executionRoot, planName: "demo" });

    assertEquals(result.kind, "non_regular");
    assertEquals((await Deno.stat(join(executionRoot, "docs", "plans", "demo.md"))).isDirectory, true);
});

Deno.test("prepareExecutionPlanFile preserves malformed bytes and blocks", async () => {
    const projectRoot = await makeTempProject();
    const executionRoot = await makeTempProject();
    const canonical = injectFrontMatter("# Canonical", {});
    const malformed = "---\n: bad\n---\n# Bad";
    await Deno.writeTextFile(join(projectRoot, "docs", "plans", "demo.md"), canonical);
    await Deno.writeTextFile(join(executionRoot, "docs", "plans", "demo.md"), malformed);

    const result = await prepareExecutionPlanFile({ projectRoot, executionCwd: executionRoot, planName: "demo" });

    assertEquals(result.kind, "malformed");
    assertEquals(await Deno.readTextFile(join(executionRoot, "docs", "plans", "demo.md")), malformed);
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

Deno.test("ensureExecutionPlanFile keeps a concurrent body while fixing owned metadata", async () => {
    const projectRoot = await makeTempProject();
    const executionRoot = await makeTempProject();
    const canonicalMarkdown = injectFrontMatter("# Canonical", { planId: "plan-1", status: "implemented" });
    await Deno.writeTextFile(join(projectRoot, "docs", "plans", "demo.md"), canonicalMarkdown);
    const source = await loadCanonicalExecutionPlanSource(projectRoot, "demo");
    if (source.kind !== "loaded") throw new Error("source did not load");
    const concurrent = injectFrontMatter("# Concurrent", { planId: "plan-1", status: "approved" });
    await Deno.writeTextFile(join(executionRoot, "docs", "plans", "demo.md"), concurrent);

    const result = await ensureExecutionPlanFile({
        executionCwd: executionRoot,
        planName: "demo",
        canonicalSource: source,
    });

    assertEquals(result.kind, "reconciled");
    const resultPlan = parsePlanFrontMatter(
        await Deno.readTextFile(join(executionRoot, "docs", "plans", "demo.md")),
    );
    assertEquals(resultPlan.body, "# Concurrent");
    assertEquals(resultPlan.attrs.planId, "plan-1");
    assertEquals(resultPlan.attrs.status, "implemented");
    const entries = [];
    for await (const entry of Deno.readDir(join(executionRoot, "docs", "plans"))) entries.push(entry.name);
    assertEquals(entries.some((name) => name.startsWith(".rw-plan-")), false);
});

Deno.test("ensureExecutionPlanFile materializes the complete latest Plan before execution starts", async () => {
    const projectRoot = await makeTempProject();
    const executionRoot = await makeTempProject();
    const canonicalMarkdown = injectFrontMatter("# Latest Plan", {
        planId: "plan-1",
        status: "ready_for_work",
        objectiveChecks: [{ id: "OC_NEW", command: "false", rationale: "latest check" }],
    });
    const oldMarkdown = injectFrontMatter("# Old Plan", {
        planId: "plan-1",
        status: "draft",
        objectiveChecks: [{ id: "OC_OLD", command: "true", rationale: "stale check" }],
    });
    await Deno.writeTextFile(join(projectRoot, "docs", "plans", "demo.md"), canonicalMarkdown);
    await Deno.writeTextFile(join(executionRoot, "docs", "plans", "demo.md"), oldMarkdown);
    const source = await loadCanonicalExecutionPlanSource(projectRoot, "demo");
    if (source.kind !== "loaded") throw new Error("source did not load");

    const result = await ensureExecutionPlanFile({
        executionCwd: executionRoot,
        planName: "demo",
        canonicalSource: source,
        replaceFromCanonical: true,
    });

    assertEquals(result.kind, "reconciled");
    assertEquals(await Deno.readTextFile(join(executionRoot, "docs", "plans", "demo.md")), canonicalMarkdown);
});
