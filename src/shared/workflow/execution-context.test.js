import { assertEquals } from "@std/assert";
import { savePlan } from "../../plan-store.js";
import { addEntry } from "../worktree-registry.js";
import { resolveValidationExecutionContext } from "./execution-context.js";

/** @param {string} cwd @param {string[]} args */
async function git(cwd, args) {
    const command = new Deno.Command("git", { cwd, args, stdout: "piped", stderr: "piped" });
    const output = await command.output();
    if (output.code !== 0) {
        throw new Error(new TextDecoder().decode(output.stderr) || new TextDecoder().decode(output.stdout));
    }
    return new TextDecoder().decode(output.stdout).trim();
}

Deno.test("resolveValidationExecutionContext blocks FEATURE validation without durable mode or worktree identity", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "p", "# Plan", { classification: "FEATURE", status: "implemented" });
        const result = await resolveValidationExecutionContext({ projectRoot: cwd, planName: "p", triageMeta: {} });
        assertEquals(result.kind, "blocked");
        if (result.kind === "blocked") assertEquals(result.reason, "unknown_execution_mode");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("resolveValidationExecutionContext accepts explicit non-Git mode", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "p", "# Plan", {
            classification: "FEATURE",
            status: "implemented",
            executionMode: "non_git_in_place",
        });
        const result = await resolveValidationExecutionContext({ projectRoot: cwd, planName: "p", triageMeta: {} });
        assertEquals(result.kind, "ok");
        if (result.kind === "ok") assertEquals(result.context.executionMode, "non_git_in_place");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("resolveValidationExecutionContext allows a legacy creation tree to differ from a retry baseline", async () => {
    const projectRoot = await Deno.makeTempDir();
    const parent = await Deno.makeTempDir();
    try {
        await git(projectRoot, ["init", "-b", "main"]);
        await git(projectRoot, ["config", "user.email", "test@example.com"]);
        await git(projectRoot, ["config", "user.name", "Test"]);
        await Deno.writeTextFile(`${projectRoot}/file.txt`, "base\n");
        await git(projectRoot, ["add", "."]);
        await git(projectRoot, ["commit", "-m", "init"]);
        const creationTree = await git(projectRoot, ["rev-parse", "HEAD^{tree}"]);
        const worktreePath = `${parent}/wt`;
        await git(projectRoot, ["worktree", "add", "-b", "runwield/worktree/p-wt", worktreePath, "HEAD"]);
        await Deno.writeTextFile(`${worktreePath}/dependency.txt`, "integrated dependency\n");
        await git(worktreePath, ["add", "dependency.txt"]);
        await git(worktreePath, ["commit", "-m", "integrate dependency before retry"]);
        const baselineTree = await git(worktreePath, ["rev-parse", "HEAD^{tree}"]);
        await savePlan(worktreePath, "p", "# Plan", { classification: "FEATURE", status: "implemented" });
        await savePlan(projectRoot, "p", "# Plan", {
            classification: "FEATURE",
            status: "implemented",
            executionBaselineTree: baselineTree,
            worktreeId: "wt-1",
            worktreePath,
            worktreeBranch: "runwield/worktree/p-wt",
            worktreeBaseBranch: "main",
            worktreeStatus: "completed",
        });
        await addEntry(projectRoot, {
            id: "wt-1",
            planName: "p",
            baseBranch: "main",
            baseRef: "HEAD",
            baseCommit: await git(projectRoot, ["rev-parse", "HEAD"]),
            baseTree: creationTree,
            branch: "runwield/worktree/p-wt",
            path: worktreePath,
            status: "completed",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
        });

        const result = await resolveValidationExecutionContext({ projectRoot, planName: "p", triageMeta: {} });
        assertEquals(result.kind, "ok");
        if (result.kind === "ok") {
            assertEquals(result.context.executionMode, "worktree");
            assertEquals(result.persistedLegacyExecutionMode, true);
        }
    } finally {
        await Deno.remove(projectRoot, { recursive: true }).catch(() => {});
        await Deno.remove(parent, { recursive: true }).catch(() => {});
    }
});

Deno.test("resolveValidationExecutionContext blocks a persisted retry-baseline mismatch", async () => {
    const result = await resolveValidationExecutionContext({
        projectRoot: "/project",
        planName: "p",
        __deps: {
            loadPlan: () =>
                Promise.resolve(
                    /** @type {any} */ ({
                        attrs: {
                            classification: "FEATURE",
                            status: "implemented",
                            executionMode: "worktree",
                            executionBaselineTree: "plan-attempt-tree",
                            worktreeId: "wt-1",
                            worktreePath: "/worktree",
                            worktreeBranch: "runwield/worktree/p-wt",
                            worktreeBaseBranch: "main",
                            worktreeStatus: "completed",
                        },
                    }),
                ),
            findWorktreeRegistryEntryById: () =>
                Promise.resolve(
                    /** @type {any} */ ({
                        id: "wt-1",
                        planName: "p",
                        baseBranch: "main",
                        baseRef: "HEAD",
                        baseCommit: "base-commit",
                        baseTree: "creation-tree",
                        executionBaselineTree: "different-attempt-tree",
                        branch: "runwield/worktree/p-wt",
                        path: "/worktree",
                        status: "completed",
                    }),
                ),
        },
    });

    assertEquals(result.kind, "blocked");
    if (result.kind === "blocked") assertEquals(result.reason, "registry_base_tree_mismatch");
});

Deno.test("resolveValidationExecutionContext blocks contradictory explicit and active workflow context", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "p", "# Plan", { classification: "FEATURE", status: "implemented" });
        const result = await resolveValidationExecutionContext({
            projectRoot: cwd,
            planName: "p",
            explicitContext: { planName: "p", executionMode: "worktree", executionCwd: "/worktree-a" },
            activeWorkflow: { planName: "p", executionMode: "worktree", executionCwd: "/worktree-b" },
        });
        assertEquals(result.kind, "blocked");
        if (result.kind === "blocked") assertEquals(result.reason, "execution_context_mismatch");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("resolveValidationExecutionContext blocks contradictory explicit mode", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "p", "# Plan", {
            classification: "FEATURE",
            status: "implemented",
            executionMode: "worktree",
            executionBaselineTree: "tree",
            worktreeId: "wt-1",
            worktreePath: "/tmp/wt",
            worktreeBranch: "runwield/worktree/p-wt",
            worktreeBaseBranch: "main",
        });
        const result = await resolveValidationExecutionContext({
            projectRoot: cwd,
            planName: "p",
            explicitContext: { planName: "p", nonGitInPlace: true },
        });
        assertEquals(result.kind, "blocked");
        if (result.kind === "blocked") assertEquals(result.reason, "execution_mode_mismatch");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("resolveValidationExecutionContext blocks worktree Plan ID mismatch", async () => {
    const projectRoot = await Deno.makeTempDir();
    const parent = await Deno.makeTempDir();
    try {
        await git(projectRoot, ["init", "-b", "main"]);
        await git(projectRoot, ["config", "user.email", "test@example.com"]);
        await git(projectRoot, ["config", "user.name", "Test"]);
        await Deno.writeTextFile(`${projectRoot}/file.txt`, "base\n");
        await git(projectRoot, ["add", "."]);
        await git(projectRoot, ["commit", "-m", "init"]);
        const baselineTree = await git(projectRoot, ["rev-parse", "HEAD^{tree}"]);
        const worktreePath = `${parent}/wt`;
        await git(projectRoot, ["worktree", "add", "-b", "runwield/worktree/p-wt", worktreePath, "HEAD"]);
        await savePlan(worktreePath, "p", "# Plan", {
            planId: "worktree-plan-id",
            classification: "FEATURE",
            status: "implemented",
        });
        await savePlan(projectRoot, "p", "# Plan", {
            planId: "canonical-plan-id",
            classification: "FEATURE",
            status: "implemented",
            executionMode: "worktree",
            executionBaselineTree: baselineTree,
            worktreeId: "wt-1",
            worktreePath,
            worktreeBranch: "runwield/worktree/p-wt",
            worktreeBaseBranch: "main",
            worktreeStatus: "completed",
        });
        await addEntry(projectRoot, {
            id: "wt-1",
            planName: "p",
            baseBranch: "main",
            baseRef: "HEAD",
            baseCommit: await git(projectRoot, ["rev-parse", "HEAD"]),
            baseTree: baselineTree,
            branch: "runwield/worktree/p-wt",
            path: worktreePath,
            status: "completed",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
        });

        const result = await resolveValidationExecutionContext({ projectRoot, planName: "p", triageMeta: {} });
        assertEquals(result.kind, "blocked");
        if (result.kind === "blocked") assertEquals(result.reason, "execution_plan_id_mismatch");
    } finally {
        await Deno.remove(projectRoot, { recursive: true }).catch(() => {});
        await Deno.remove(parent, { recursive: true }).catch(() => {});
    }
});

Deno.test("resolveValidationExecutionContext blocks selected path differing from Plan path", async () => {
    const projectRoot = await Deno.makeTempDir();
    const parent = await Deno.makeTempDir();
    try {
        await git(projectRoot, ["init", "-b", "main"]);
        await git(projectRoot, ["config", "user.email", "test@example.com"]);
        await git(projectRoot, ["config", "user.name", "Test"]);
        await Deno.writeTextFile(`${projectRoot}/file.txt`, "base\n");
        await git(projectRoot, ["add", "."]);
        await git(projectRoot, ["commit", "-m", "init"]);
        const baselineTree = await git(projectRoot, ["rev-parse", "HEAD^{tree}"]);
        const worktreePath = `${parent}/wt`;
        const otherPath = `${parent}/other`;
        await git(projectRoot, ["worktree", "add", "-b", "runwield/worktree/p-wt", worktreePath, "HEAD"]);
        await savePlan(worktreePath, "p", "# Plan", { classification: "FEATURE", status: "implemented" });
        await Deno.mkdir(otherPath);
        await savePlan(projectRoot, "p", "# Plan", {
            classification: "FEATURE",
            status: "implemented",
            executionMode: "worktree",
            executionBaselineTree: baselineTree,
            worktreeId: "wt-1",
            worktreePath,
            worktreeBranch: "runwield/worktree/p-wt",
            worktreeBaseBranch: "main",
            worktreeStatus: "completed",
        });
        await addEntry(projectRoot, {
            id: "wt-1",
            planName: "p",
            baseBranch: "main",
            baseRef: "HEAD",
            baseCommit: await git(projectRoot, ["rev-parse", "HEAD"]),
            baseTree: baselineTree,
            branch: "runwield/worktree/p-wt",
            path: worktreePath,
            status: "completed",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
        });
        const result = await resolveValidationExecutionContext({
            projectRoot,
            planName: "p",
            explicitContext: {
                planName: "p",
                executionMode: "worktree",
                executionCwd: otherPath,
                baselineTree,
                worktreeId: "wt-1",
                worktreeBranch: "runwield/worktree/p-wt",
                worktreeBaseBranch: "main",
            },
        });
        assertEquals(result.kind, "blocked");
        if (result.kind === "blocked") assertEquals(result.reason, "plan_worktree_path_mismatch");
    } finally {
        await Deno.remove(projectRoot, { recursive: true }).catch(() => {});
        await Deno.remove(parent, { recursive: true }).catch(() => {});
    }
});
