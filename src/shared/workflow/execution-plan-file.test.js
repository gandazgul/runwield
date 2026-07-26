import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
    ensureExecutionPlanFile,
    loadCanonicalExecutionPlanSource,
    prepareExecutionPlanFile,
} from "./execution-plan-file.js";
import { injectFrontMatter } from "../../plan-store.js";

async function makeTempProject() {
    const root = await Deno.makeTempDir();
    await Deno.mkdir(join(root, "plans"));
    return root;
}

Deno.test("prepareExecutionPlanFile restores absent top-level and nested execution Plans exactly", async () => {
    const projectRoot = await makeTempProject();
    const executionRoot = await makeTempProject();
    const markdown = injectFrontMatter("# Plan\n\nBody", { planId: "plan-1", status: "implemented" });
    await Deno.writeTextFile(join(projectRoot, "plans", "epic", "child.md"), markdown).catch(async () => {
        await Deno.mkdir(join(projectRoot, "plans", "epic"));
        await Deno.writeTextFile(join(projectRoot, "plans", "epic", "child.md"), markdown);
    });

    await Deno.remove(join(executionRoot, "plans"), { recursive: true });
    const result = await prepareExecutionPlanFile({ projectRoot, executionCwd: executionRoot, planName: "epic/child" });

    assertEquals(result.kind, "restored");
    assertEquals(result.relativePath, "plans/epic/child.md");
    assertEquals(await Deno.readTextFile(join(executionRoot, "plans", "epic", "child.md")), markdown);
});

Deno.test("prepareExecutionPlanFile preserves valid legacy execution Plan without Plan ID", async () => {
    const projectRoot = await makeTempProject();
    const executionRoot = await makeTempProject();
    await Deno.writeTextFile(
        join(projectRoot, "plans", "demo.md"),
        injectFrontMatter("# Canonical", { planId: "plan-1" }),
    );
    const legacy = injectFrontMatter("# Legacy", {});
    await Deno.writeTextFile(join(executionRoot, "plans", "demo.md"), legacy);

    const result = await prepareExecutionPlanFile({ projectRoot, executionCwd: executionRoot, planName: "demo" });

    assertEquals(result.kind, "present");
    assertEquals(await Deno.readTextFile(join(executionRoot, "plans", "demo.md")), legacy);
});

Deno.test("prepareExecutionPlanFile blocks conflicting Plan IDs and symlinked parents without overwriting", async () => {
    const projectRoot = await makeTempProject();
    const executionRoot = await makeTempProject();
    await Deno.writeTextFile(
        join(projectRoot, "plans", "demo.md"),
        injectFrontMatter("# Canonical", { planId: "plan-1" }),
    );
    const conflicting = injectFrontMatter("# Conflict", { planId: "plan-2" });
    await Deno.writeTextFile(join(executionRoot, "plans", "demo.md"), conflicting);

    const conflict = await prepareExecutionPlanFile({ projectRoot, executionCwd: executionRoot, planName: "demo" });
    assertEquals(conflict.kind, "identity_conflict");
    assertEquals(await Deno.readTextFile(join(executionRoot, "plans", "demo.md")), conflicting);

    const linkedRoot = await Deno.makeTempDir();
    await Deno.remove(join(executionRoot, "plans", "demo.md"));
    await Deno.remove(join(executionRoot, "plans"));
    await Deno.symlink(linkedRoot, join(executionRoot, "plans"));
    const symlink = await prepareExecutionPlanFile({ projectRoot, executionCwd: executionRoot, planName: "demo" });
    assertEquals(symlink.kind, "symlink");
});

Deno.test("loadCanonicalExecutionPlanSource classifies absent and malformed canonical source", async () => {
    const projectRoot = await makeTempProject();
    const absent = await loadCanonicalExecutionPlanSource(projectRoot, "missing");
    assertEquals(absent.kind, "absent");
    assertStringIncludes(absent.relativePath, "plans/missing.md");

    await Deno.writeTextFile(join(projectRoot, "plans", "bad.md"), "---\n: bad\n---\n# Bad");
    const malformed = await loadCanonicalExecutionPlanSource(projectRoot, "bad");
    assertEquals(malformed.kind, "malformed");
});

Deno.test("prepareExecutionPlanFile classifies canonical symlink and non-regular sources", async () => {
    const projectRoot = await makeTempProject();
    const executionRoot = await makeTempProject();
    const outside = await Deno.makeTempFile();
    await Deno.symlink(outside, join(projectRoot, "plans", "linked.md"));
    const linked = await prepareExecutionPlanFile({ projectRoot, executionCwd: executionRoot, planName: "linked" });
    assertEquals(linked.kind, "symlink");

    await Deno.mkdir(join(projectRoot, "plans", "directory.md"));
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
        join(outsidePlans, "plans", "demo.md"),
        injectFrontMatter("# Outside", { planId: "outside-plan" }),
    );

    await Deno.remove(join(projectRoot, "plans"));
    await Deno.symlink(join(outsidePlans, "plans"), join(projectRoot, "plans"));
    const symlinkedParent = await loadCanonicalExecutionPlanSource(projectRoot, "demo");
    assertEquals(symlinkedParent.kind, "symlink");
    assertEquals(symlinkedParent.relativePath, "plans/demo.md");

    await Deno.remove(join(projectRoot, "plans"));
    await Deno.mkdir(join(projectRoot, "plans"));
    await Deno.writeTextFile(join(projectRoot, "plans", "epic"), "not a directory");
    const nonDirectoryParent = await loadCanonicalExecutionPlanSource(projectRoot, "epic/child");
    assertEquals(nonDirectoryParent.kind, "non_regular");
    assertEquals(nonDirectoryParent.relativePath, "plans/epic/child.md");
});

Deno.test("prepareExecutionPlanFile blocks target symlink directory and malformed target evidence", async () => {
    const projectRoot = await makeTempProject();
    const executionRoot = await makeTempProject();
    await Deno.writeTextFile(join(projectRoot, "plans", "demo.md"), injectFrontMatter("# Canonical", {}));

    await Deno.symlink(await Deno.makeTempFile(), join(executionRoot, "plans", "demo.md"));
    const symlink = await prepareExecutionPlanFile({ projectRoot, executionCwd: executionRoot, planName: "demo" });
    assertEquals(symlink.kind, "symlink");

    await Deno.remove(join(executionRoot, "plans", "demo.md"));
    await Deno.mkdir(join(executionRoot, "plans", "demo.md"));
    const directory = await prepareExecutionPlanFile({ projectRoot, executionCwd: executionRoot, planName: "demo" });
    assertEquals(directory.kind, "non_regular");

    await Deno.remove(join(executionRoot, "plans", "demo.md"));
    await Deno.writeTextFile(join(executionRoot, "plans", "demo.md"), "---\n: bad\n---\n# Bad");
    const malformed = await prepareExecutionPlanFile({ projectRoot, executionCwd: executionRoot, planName: "demo" });
    assertEquals(malformed.kind, "malformed");
});

Deno.test("prepareExecutionPlanFile reports restore failure when plans parent cannot be created", async () => {
    const projectRoot = await makeTempProject();
    const executionRoot = await Deno.makeTempDir();
    await Deno.writeTextFile(join(projectRoot, "plans", "demo.md"), injectFrontMatter("# Canonical", {}));
    await Deno.writeTextFile(join(executionRoot, "plans"), "not a directory");

    const result = await prepareExecutionPlanFile({ projectRoot, executionCwd: executionRoot, planName: "demo" });

    assertEquals(result.kind, "non_regular");
    assertEquals(await Deno.readTextFile(join(executionRoot, "plans")), "not a directory");
});

Deno.test("ensureExecutionPlanFile handles real concurrent publication without overwriting", async () => {
    const projectRoot = await makeTempProject();
    const executionRoot = await makeTempProject();
    const canonicalMarkdown = injectFrontMatter("# Canonical", { planId: "plan-1" });
    await Deno.writeTextFile(join(projectRoot, "plans", "demo.md"), canonicalMarkdown);
    const source = await loadCanonicalExecutionPlanSource(projectRoot, "demo");
    if (source.kind !== "loaded") throw new Error("source did not load");
    await Deno.remove(join(executionRoot, "plans", "demo.md")).catch(() => {});

    const results = await Promise.all([
        ensureExecutionPlanFile({ executionCwd: executionRoot, planName: "demo", canonicalSource: source }),
        ensureExecutionPlanFile({ executionCwd: executionRoot, planName: "demo", canonicalSource: source }),
    ]);

    assertEquals(results.every((result) => result.kind === "restored" || result.kind === "present"), true);
    assertEquals(results.some((result) => result.kind === "restored"), true);
    assertEquals(await Deno.readTextFile(join(executionRoot, "plans", "demo.md")), canonicalMarkdown);
});

Deno.test("ensureExecutionPlanFile preserves concurrently created target and cleans temporary file", async () => {
    const projectRoot = await makeTempProject();
    const executionRoot = await makeTempProject();
    const canonicalMarkdown = injectFrontMatter("# Canonical", { planId: "plan-1" });
    await Deno.writeTextFile(join(projectRoot, "plans", "demo.md"), canonicalMarkdown);
    const source = await loadCanonicalExecutionPlanSource(projectRoot, "demo");
    if (source.kind !== "loaded") throw new Error("source did not load");
    const concurrent = injectFrontMatter("# Concurrent", { planId: "plan-1" });
    await Deno.writeTextFile(join(executionRoot, "plans", "demo.md"), concurrent);

    const result = await ensureExecutionPlanFile({
        executionCwd: executionRoot,
        planName: "demo",
        canonicalSource: source,
    });

    assertEquals(result.kind, "present");
    assertEquals(await Deno.readTextFile(join(executionRoot, "plans", "demo.md")), concurrent);
    const entries = [];
    for await (const entry of Deno.readDir(join(executionRoot, "plans"))) entries.push(entry.name);
    assertEquals(entries.some((name) => name.startsWith(".rw-plan-")), false);
});
