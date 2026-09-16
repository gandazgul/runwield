import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { dirname, join } from "@std/path";
import { defineGitFixture, git } from "./git-test-fixture.ts";
import { getWorktreeRegistryPath } from "./worktree-registry.js";
import { stageGitChangesExcludingRuntime } from "./git-runtime-safety.ts";
import { checkpointExecutionPreparation, checkpointExecutionWorktree, mergeExecutionWorktree } from "./worktree.js";

const repo = defineGitFixture(async (repoPath) => {
    await Deno.writeTextFile(join(repoPath, "README.md"), "base\n");
    await Deno.writeTextFile(join(repoPath, ".gitignore"), ".wld/plan-locks\n");
    await git(repoPath, ["add", "."]);
    await git(repoPath, ["commit", "-m", "base"]);
});

/**
 * @param {string} cwd
 * @param {string} branch
 */
async function makeWorktree(cwd, branch) {
    const worktreePath = `${cwd}-${branch}`;
    await git(cwd, ["worktree", "add", "-b", branch, worktreePath, "main"]);
    return worktreePath;
}

Deno.test("execution runtime state does not enter the merge when primary .wld is untracked", async () => {
    const cwd = await repo.checkout();
    const worktreePath = await makeWorktree(cwd, "runtime-side");
    try {
        const registryPath = getWorktreeRegistryPath(cwd);
        await Deno.mkdir(dirname(registryPath), { recursive: true });
        await Deno.writeTextFile(registryPath, "primary registry\n");
        const registryBefore = await Deno.readTextFile(registryPath);
        await Deno.mkdir(join(worktreePath, ".wld", "plan-locks"), { recursive: true });
        await Deno.mkdir(join(worktreePath, ".wld", "plan-transitions"), { recursive: true });
        await Deno.writeTextFile(join(worktreePath, ".wld", "plan-transitions", "x.json"), "{}\n");
        await Deno.writeTextFile(join(worktreePath, "feature.txt"), "work\n");

        await checkpointExecutionWorktree({ worktreePath, branch: "runtime-side" });
        await mergeExecutionWorktree({ projectRoot: cwd, branch: "runtime-side", targetBranch: "main", worktreePath });

        assertEquals(await Deno.readTextFile(registryPath), registryBefore);
        assertEquals(await Deno.readTextFile(join(cwd, "feature.txt")), "work\n");
        assertEquals(
            (await git(cwd, ["ls-tree", "-r", "--name-only", "HEAD"])).includes(".wld/plan-transitions/x.json"),
            false,
        );
    } finally {
        await git(cwd, ["worktree", "remove", "--force", worktreePath]).catch(() => {});
        await Deno.remove(cwd, { recursive: true }).catch(() => {});
    }
});

Deno.test("checkpoint ignores gitignored RunWield runtime state", async () => {
    const cwd = await repo.checkout();
    const worktreePath = await makeWorktree(cwd, "ignored-runtime-side");
    try {
        await Deno.writeTextFile(join(worktreePath, ".gitignore"), ".wld/plan-locks\n");
        await Deno.mkdir(join(worktreePath, ".wld", "plan-locks"), { recursive: true });
        await Deno.writeTextFile(join(worktreePath, ".wld", "plan-locks", "x.json"), "{}\n");
        await Deno.writeTextFile(join(worktreePath, "feature.txt"), "work\n");

        await checkpointExecutionWorktree({ worktreePath, branch: "ignored-runtime-side" });

        const committedPaths = await git(worktreePath, ["ls-tree", "-r", "--name-only", "HEAD"]);
        assertEquals(committedPaths.includes("feature.txt"), true);
        assertEquals(committedPaths.includes(".wld/plan-locks/x.json"), false);
    } finally {
        await git(cwd, ["worktree", "remove", "--force", worktreePath]).catch(() => {});
        await Deno.remove(cwd, { recursive: true }).catch(() => {});
    }
});

Deno.test("checkpoint preserves removal of a tracked file whose working copy is now ignored", async () => {
    const cwd = await repo.checkout();
    const worktreePath = await makeWorktree(cwd, "ignored-generated-side");
    try {
        await Deno.writeTextFile(join(worktreePath, ".gitignore"), ".wld/plan-locks\n.astro/\n");
        await Deno.mkdir(join(worktreePath, ".astro"), { recursive: true });
        await Deno.writeTextFile(join(worktreePath, ".astro", "settings.json"), "generated\n");
        await git(worktreePath, ["add", ".gitignore"]);
        await git(worktreePath, ["add", "-f", ".astro/settings.json"]);
        await git(worktreePath, ["commit", "-m", "track old generated settings"]);

        await git(worktreePath, ["rm", "--cached", ".astro/settings.json"]);
        await Deno.writeTextFile(join(worktreePath, "feature.txt"), "work\n");

        await checkpointExecutionWorktree({ worktreePath, branch: "ignored-generated-side" });

        const committedPaths = await git(worktreePath, ["ls-tree", "-r", "--name-only", "HEAD"]);
        assertEquals(committedPaths.includes("feature.txt"), true);
        assertEquals(committedPaths.includes(".astro/settings.json"), false);
        assertEquals(await Deno.readTextFile(join(worktreePath, ".astro", "settings.json")), "generated\n");
    } finally {
        await git(cwd, ["worktree", "remove", "--force", worktreePath]).catch(() => {});
        await Deno.remove(cwd, { recursive: true }).catch(() => {});
        await Deno.remove(worktreePath, { recursive: true }).catch(() => {});
    }
});

Deno.test("resumed local merge refuses runtime history before continuing", async () => {
    const cwd = await repo.checkout();
    const worktreePath = await makeWorktree(cwd, "runtime-resumed-merge");
    try {
        await Deno.mkdir(join(cwd, "docs", "plans"), { recursive: true });
        await Deno.writeTextFile(join(cwd, "docs", "plans", "resume.md"), "base\n");
        await git(cwd, ["add", "docs/plans/resume.md"]);
        await git(cwd, ["commit", "-m", "plan base"]);
        await git(worktreePath, ["merge", "main"]);
        await Deno.mkdir(join(worktreePath, ".wld", "internal"), { recursive: true });
        await Deno.writeTextFile(join(worktreePath, ".wld", "internal", "old.json"), "runtime\n");
        await git(worktreePath, ["add", ".wld/internal/old.json"]);
        await git(worktreePath, ["commit", "-m", "track runtime"]);
        await Deno.remove(join(worktreePath, ".wld", "internal", "old.json"));
        await Deno.writeTextFile(join(worktreePath, "docs", "plans", "resume.md"), "branch\n");
        await git(worktreePath, ["add", "."]);
        await git(worktreePath, ["commit", "-m", "remove runtime with plan change"]);
        await Deno.writeTextFile(join(cwd, "docs", "plans", "resume.md"), "target\n");
        await git(cwd, ["add", "docs/plans/resume.md"]);
        await git(cwd, ["commit", "-m", "target plan change"]);
        const mainBefore = await git(cwd, ["rev-parse", "HEAD"]);
        await git(cwd, ["merge", "--no-ff", "runtime-resumed-merge"]).catch(() => "");

        const error = await assertRejects(
            () =>
                mergeExecutionWorktree({
                    projectRoot: cwd,
                    branch: "runtime-resumed-merge",
                    targetBranch: "main",
                    preservePlanPaths: ["docs/plans/resume.md"],
                }),
            Error,
            "publication candidate contains RunWield runtime paths",
        );

        assertStringIncludes(error.message, ".wld/internal/old.json");
        assertEquals(await git(cwd, ["rev-parse", "HEAD"]), mainBefore);
    } finally {
        await git(cwd, ["merge", "--abort"]).catch(() => {});
        await git(cwd, ["worktree", "remove", "--force", worktreePath]).catch(() => {});
        await Deno.remove(cwd, { recursive: true }).catch(() => {});
    }
});

Deno.test("publication refuses runtime history even when the final tree is clean", async () => {
    const cwd = await repo.checkout();
    const worktreePath = await makeWorktree(cwd, "runtime-committed-side");
    try {
        await Deno.mkdir(join(worktreePath, ".wld", "internal"), { recursive: true });
        await Deno.writeTextFile(join(worktreePath, ".wld", "internal", "collaboration-secrets.json"), "{}\n");
        await git(worktreePath, ["add", ".wld/internal/collaboration-secrets.json"]);
        await git(worktreePath, ["commit", "-m", "old runtime"]);
        await Deno.remove(join(worktreePath, ".wld", "internal", "collaboration-secrets.json"));
        await Deno.writeTextFile(join(worktreePath, "feature.txt"), "work\n");
        await git(worktreePath, ["add", "."]);
        await git(worktreePath, ["commit", "-m", "remove runtime and add feature"]);
        const mainBefore = await git(cwd, ["rev-parse", "main"]);
        const branchBefore = await git(worktreePath, ["rev-parse", "HEAD"]);

        const error = await assertRejects(
            () =>
                mergeExecutionWorktree({
                    projectRoot: cwd,
                    branch: "runtime-committed-side",
                    targetBranch: "main",
                    worktreePath,
                }),
            Error,
            "publication candidate contains RunWield runtime paths",
        );

        assertStringIncludes(error.message, ".wld/internal/collaboration-secrets.json");
        assertStringIncludes(error.message, "rotate any related capability secret");
        assertEquals(await git(cwd, ["rev-parse", "main"]), mainBefore);
        assertEquals(await git(worktreePath, ["rev-parse", "HEAD"]), branchBefore);
        await assertRejects(() => Deno.readTextFile(join(cwd, "feature.txt")));
    } finally {
        await git(cwd, ["worktree", "remove", "--force", worktreePath]).catch(() => {});
        await Deno.remove(cwd, { recursive: true }).catch(() => {});
    }
});

Deno.test("publication refuses runtime history from a merged side branch", async () => {
    const cwd = await repo.checkout();
    const worktreePath = await makeWorktree(cwd, "runtime-merged-side");
    try {
        await git(worktreePath, ["checkout", "-b", "runtime-source-side"]);
        await Deno.mkdir(join(worktreePath, ".wld", "internal"), { recursive: true });
        await Deno.writeTextFile(join(worktreePath, ".wld", "internal", "side.json"), "runtime\n");
        await git(worktreePath, ["add", ".wld/internal/side.json"]);
        await git(worktreePath, ["commit", "-m", "track side runtime"]);
        await Deno.remove(join(worktreePath, ".wld", "internal", "side.json"));
        await git(worktreePath, ["add", ".wld/internal/side.json"]);
        await git(worktreePath, ["commit", "-m", "remove side runtime"]);
        await git(worktreePath, ["checkout", "runtime-merged-side"]);
        await git(worktreePath, ["merge", "--no-ff", "runtime-source-side", "-m", "Merge side runtime history"]);
        await Deno.writeTextFile(join(worktreePath, "feature.txt"), "safe final tree\n");
        await git(worktreePath, ["add", "feature.txt"]);
        await git(worktreePath, ["commit", "-m", "safe final work"]);
        const mainBefore = await git(cwd, ["rev-parse", "main"]);

        const error = await assertRejects(
            () =>
                mergeExecutionWorktree({
                    projectRoot: cwd,
                    branch: "runtime-merged-side",
                    targetBranch: "main",
                    worktreePath,
                }),
            Error,
            "publication candidate contains RunWield runtime paths",
        );

        assertStringIncludes(error.message, ".wld/internal/side.json");
        assertEquals(await git(cwd, ["rev-parse", "main"]), mainBefore);
        await assertRejects(() => Deno.readTextFile(join(cwd, "feature.txt")));
    } finally {
        await git(cwd, ["worktree", "remove", "--force", worktreePath]).catch(() => {});
        await Deno.remove(cwd, { recursive: true }).catch(() => {});
    }
});

Deno.test("preparation checkpoint refuses tracked runtime state before committing plan metadata", async () => {
    const cwd = await repo.checkout();
    const worktreePath = await makeWorktree(cwd, "runtime-preparation");
    try {
        const baseCommit = await git(worktreePath, ["rev-parse", "HEAD"]);
        await Deno.mkdir(join(worktreePath, "docs", "plans"), { recursive: true });
        await Deno.writeTextFile(join(worktreePath, "docs", "plans", "runtime-preparation.md"), "plan\n");
        await Deno.mkdir(join(worktreePath, ".wld", "internal"), { recursive: true });
        await Deno.writeTextFile(join(worktreePath, ".wld", "internal", "state.json"), "runtime\n");
        await git(worktreePath, ["add", "-N", ".wld/internal/state.json"]);

        await assertRejects(
            () =>
                checkpointExecutionPreparation({
                    worktreePath,
                    branch: "runtime-preparation",
                    baseCommit,
                    planName: "runtime-preparation",
                    planRelativePath: "docs/plans/runtime-preparation.md",
                }),
            Error,
            "runtime paths are tracked or staged",
        );

        assertEquals(await git(worktreePath, ["rev-parse", "HEAD"]), baseCommit);
        await assertRejects(() => git(worktreePath, ["show", "HEAD:docs/plans/runtime-preparation.md"]));
    } finally {
        await git(cwd, ["worktree", "remove", "--force", worktreePath]).catch(() => {});
        await Deno.remove(cwd, { recursive: true }).catch(() => {});
    }
});

Deno.test("checkpoint keeps current runtime untracked while committing user wld files", async () => {
    const cwd = await repo.checkout();
    const worktreePath = await makeWorktree(cwd, "current-runtime-and-config");
    try {
        await Deno.mkdir(join(worktreePath, ".wld", "internal", "future"), { recursive: true });
        await Deno.writeTextFile(join(worktreePath, ".wld", "internal", "future", "state.json"), "runtime\n");
        await Deno.mkdir(join(worktreePath, ".wld", "agents"), { recursive: true });
        await Deno.mkdir(join(worktreePath, ".wld", "skills", "local"), { recursive: true });
        await Deno.mkdir(join(worktreePath, ".wld", "prompts"), { recursive: true });
        await Deno.writeTextFile(join(worktreePath, ".wld", "settings.json"), "{}\n");
        await Deno.writeTextFile(join(worktreePath, ".wld", "agents", "agent.md"), "agent\n");
        await Deno.writeTextFile(join(worktreePath, ".wld", "skills", "local", "SKILL.md"), "skill\n");
        await Deno.writeTextFile(join(worktreePath, ".wld", "prompts", "prompt.md"), "prompt\n");

        await checkpointExecutionWorktree({ worktreePath, branch: "current-runtime-and-config" });

        const committedPaths = await git(worktreePath, ["ls-tree", "-r", "--name-only", "HEAD"]);
        assertStringIncludes(committedPaths, ".wld/settings.json");
        assertStringIncludes(committedPaths, ".wld/agents/agent.md");
        assertStringIncludes(committedPaths, ".wld/skills/local/SKILL.md");
        assertStringIncludes(committedPaths, ".wld/prompts/prompt.md");
        assertEquals(committedPaths.includes(".wld/internal/future/state.json"), false);
        assertEquals(
            await Deno.readTextFile(join(worktreePath, ".wld", "internal", "future", "state.json")),
            "runtime\n",
        );
        assertEquals(await git(worktreePath, ["diff", "--cached", "--name-only"]), "");
    } finally {
        await git(cwd, ["worktree", "remove", "--force", worktreePath]).catch(() => {});
        await Deno.remove(cwd, { recursive: true }).catch(() => {});
    }
});

Deno.test("checkpoint commits safe pathspec-like names while leaving runtime untracked", async () => {
    const cwd = await repo.checkout();
    const worktreePath = await makeWorktree(cwd, "pathspec-like-safe-files");
    const safePath = join(worktreePath, ":(glob) safe [file].txt");
    try {
        await Deno.writeTextFile(safePath, "safe\n");
        await Deno.mkdir(join(worktreePath, ".wld", "internal"), { recursive: true });
        await Deno.writeTextFile(join(worktreePath, ".wld", "internal", "state.json"), "runtime\n");

        await checkpointExecutionWorktree({ worktreePath, branch: "pathspec-like-safe-files" });

        const committedPaths = await git(worktreePath, ["ls-tree", "-r", "--name-only", "HEAD"]);
        assertStringIncludes(committedPaths, ":(glob) safe [file].txt");
        assertEquals(committedPaths.includes(".wld/internal/state.json"), false);
    } finally {
        await git(cwd, ["worktree", "remove", "--force", worktreePath]).catch(() => {});
        await Deno.remove(cwd, { recursive: true }).catch(() => {});
    }
});

Deno.test("checkpoint refuses runtime deletions and rename endpoints", async () => {
    const cwd = await repo.checkout();
    const deletionWorktree = await makeWorktree(cwd, "runtime-delete-side");
    const renameWorktree = await makeWorktree(cwd, "runtime-rename-side");
    try {
        await Deno.mkdir(join(deletionWorktree, ".wld", "internal"), { recursive: true });
        await Deno.writeTextFile(join(deletionWorktree, ".wld", "internal", "tracked.json"), "runtime\n");
        await git(deletionWorktree, ["add", "-f", ".wld/internal/tracked.json"]);
        await git(deletionWorktree, ["commit", "-m", "track runtime"]);
        await Deno.remove(join(deletionWorktree, ".wld", "internal", "tracked.json"));
        await git(deletionWorktree, ["add", ".wld/internal/tracked.json"]);
        const deletionHead = await git(deletionWorktree, ["rev-parse", "HEAD"]);

        const deletionError = await assertRejects(
            () => checkpointExecutionWorktree({ worktreePath: deletionWorktree, branch: "runtime-delete-side" }),
            Error,
            "runtime paths are tracked or staged",
        );
        assertStringIncludes(deletionError.message, ".wld/internal/tracked.json");
        assertEquals(await git(deletionWorktree, ["rev-parse", "HEAD"]), deletionHead);
        assertStringIncludes(await git(deletionWorktree, ["diff", "--cached", "--name-status"]), "D");

        await Deno.writeTextFile(join(renameWorktree, "safe.txt"), "safe\n");
        await git(renameWorktree, ["add", "safe.txt"]);
        await git(renameWorktree, ["commit", "-m", "track safe"]);
        await Deno.mkdir(join(renameWorktree, ".wld", "internal"), { recursive: true });
        await git(renameWorktree, ["mv", "-f", "safe.txt", ".wld/internal/renamed.json"]);
        const renameHead = await git(renameWorktree, ["rev-parse", "HEAD"]);

        const renameError = await assertRejects(
            () => checkpointExecutionWorktree({ worktreePath: renameWorktree, branch: "runtime-rename-side" }),
            Error,
            "runtime paths are tracked or staged",
        );
        assertStringIncludes(renameError.message, ".wld/internal/renamed.json");
        assertEquals(await git(renameWorktree, ["rev-parse", "HEAD"]), renameHead);
    } finally {
        await git(cwd, ["worktree", "remove", "--force", deletionWorktree]).catch(() => {});
        await git(cwd, ["worktree", "remove", "--force", renameWorktree]).catch(() => {});
        await Deno.remove(cwd, { recursive: true }).catch(() => {});
    }
});

Deno.test("runtime staging excludes legacy temporary files and Work Record locks while preserving partially staged user content", async () => {
    const cwd = await repo.checkout();
    try {
        await Deno.writeTextFile(join(cwd, "feature.txt"), "one\ntwo\n");
        await git(cwd, ["add", "feature.txt"]);
        await git(cwd, ["commit", "-m", "feature base"]);
        await Deno.writeTextFile(join(cwd, "feature.txt"), "staged\ntwo\n");
        await git(cwd, ["add", "feature.txt"]);
        await Deno.writeTextFile(join(cwd, "feature.txt"), "staged\nunstaged\n");
        await Deno.mkdir(join(cwd, ".wld"), { recursive: true });
        await Deno.writeTextFile(join(cwd, ".wld", "worktrees.json.token.tmp"), "tmp\n");
        await Deno.writeTextFile(join(cwd, ".wld", "collaboration-secrets.json.token.tmp"), "secret\n");
        await Deno.writeTextFile(join(cwd, ".wld", "work-record-supersession.lock"), "lock\n");
        await Deno.writeTextFile(join(cwd, ".wld", "work-record-supersession-recovery.lock"), "lock\n");

        await stageGitChangesExcludingRuntime(cwd);

        const staged = await git(cwd, ["diff", "--cached", "--name-only"]);
        assertStringIncludes(staged, "feature.txt");
        assertEquals(staged.includes(".wld/worktrees.json.token.tmp"), false);
        assertEquals(staged.includes(".wld/collaboration-secrets.json.token.tmp"), false);
        assertEquals(staged.includes(".wld/work-record-supersession.lock"), false);
        assertEquals(staged.includes(".wld/work-record-supersession-recovery.lock"), false);
        assertStringIncludes(await git(cwd, ["diff", "--cached", "--", "feature.txt"]), "+unstaged");
    } finally {
        await Deno.remove(cwd, { recursive: true }).catch(() => {});
    }
});

Deno.test("checkpoint refusal preserves partially staged user content", async () => {
    const cwd = await repo.checkout();
    const worktreePath = await makeWorktree(cwd, "runtime-index-preserves-partial");
    try {
        await Deno.writeTextFile(join(worktreePath, "feature.txt"), "one\ntwo\n");
        await git(worktreePath, ["add", "feature.txt"]);
        await git(worktreePath, ["commit", "-m", "feature base"]);
        await Deno.writeTextFile(join(worktreePath, "feature.txt"), "staged\ntwo\n");
        await git(worktreePath, ["add", "feature.txt"]);
        const stagedBefore = await git(worktreePath, ["diff", "--cached", "--", "feature.txt"]);
        await Deno.writeTextFile(join(worktreePath, "feature.txt"), "staged\nunstaged\n");
        await Deno.mkdir(join(worktreePath, ".wld", "internal"), { recursive: true });
        await Deno.writeTextFile(join(worktreePath, ".wld", "internal", "staged.json"), "runtime\n");
        await git(worktreePath, ["add", "-N", ".wld/internal/staged.json"]);

        await assertRejects(
            () => checkpointExecutionWorktree({ worktreePath, branch: "runtime-index-preserves-partial" }),
            Error,
            "runtime paths are tracked or staged",
        );

        assertEquals(await git(worktreePath, ["diff", "--cached", "--", "feature.txt"]), stagedBefore);
        assertStringIncludes(await git(worktreePath, ["diff", "--", "feature.txt"]), "+unstaged");
    } finally {
        await git(cwd, ["worktree", "remove", "--force", worktreePath]).catch(() => {});
        await Deno.remove(cwd, { recursive: true }).catch(() => {});
    }
});

Deno.test("checkpoint refuses runtime paths already in the index", async () => {
    const cwd = await repo.checkout();
    const worktreePath = await makeWorktree(cwd, "runtime-index-side");
    try {
        await Deno.mkdir(join(worktreePath, ".wld", "internal"), { recursive: true });
        await Deno.writeTextFile(join(worktreePath, ".wld", "internal", "staged.json"), "runtime\n");
        await Deno.writeTextFile(join(worktreePath, "feature.txt"), "work\n");
        await git(worktreePath, ["add", "-N", ".wld/internal/staged.json"]);
        const headBefore = await git(worktreePath, ["rev-parse", "HEAD"]);
        const indexBefore = await git(worktreePath, ["ls-files", "--stage", "--", ".wld/internal/staged.json"]);
        assertStringIncludes(indexBefore, ".wld/internal/staged.json");

        const error = await assertRejects(
            () => checkpointExecutionWorktree({ worktreePath, branch: "runtime-index-side" }),
            Error,
            "runtime paths are tracked or staged",
        );

        assertStringIncludes(error.message, ".wld/internal/staged.json");
        assertEquals(await git(worktreePath, ["rev-parse", "HEAD"]), headBefore);
        assertEquals(await git(worktreePath, ["ls-files", "--stage", "--", ".wld/internal/staged.json"]), indexBefore);
        assertEquals(await Deno.readTextFile(join(worktreePath, "feature.txt")), "work\n");
    } finally {
        await git(cwd, ["worktree", "remove", "--force", worktreePath]).catch(() => {});
        await Deno.remove(cwd, { recursive: true }).catch(() => {});
    }
});
