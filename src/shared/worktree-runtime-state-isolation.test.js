import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { dirname, join } from "@std/path";
import { defineGitFixture, git } from "./git-test-fixture.ts";
import { getWorktreeRegistryPath } from "./worktree-registry.js";
import { checkpointExecutionWorktree, mergeExecutionWorktree } from "./worktree.js";

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

Deno.test("publication refuses runtime history even when the final tree is clean", async () => {
    const cwd = await repo.checkout();
    const worktreePath = await makeWorktree(cwd, "runtime-committed-side");
    try {
        await Deno.mkdir(join(worktreePath, ".wld", "internal", "future"), { recursive: true });
        await Deno.writeTextFile(join(worktreePath, ".wld", "internal", "future", "old.json"), "{}\n");
        await git(worktreePath, ["add", ".wld/internal/future/old.json"]);
        await git(worktreePath, ["commit", "-m", "old runtime"]);
        await Deno.remove(join(worktreePath, ".wld", "internal", "future", "old.json"));
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

        assertStringIncludes(error.message, ".wld/internal/future/old.json");
        assertEquals(await git(cwd, ["rev-parse", "main"]), mainBefore);
        assertEquals(await git(worktreePath, ["rev-parse", "HEAD"]), branchBefore);
        await assertRejects(() => Deno.readTextFile(join(cwd, "feature.txt")));
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

Deno.test("checkpoint refuses runtime paths already in the index", async () => {
    const cwd = await repo.checkout();
    const worktreePath = await makeWorktree(cwd, "runtime-index-side");
    try {
        await Deno.mkdir(join(worktreePath, ".wld", "internal"), { recursive: true });
        await Deno.writeTextFile(join(worktreePath, ".wld", "internal", "staged.json"), "runtime\n");
        await Deno.writeTextFile(join(worktreePath, "feature.txt"), "work\n");
        await git(worktreePath, ["add", "-N", ".wld/internal/staged.json"]);
        const headBefore = await git(worktreePath, ["rev-parse", "HEAD"]);
        const indexBefore = await git(worktreePath, ["diff", "--cached", "--name-only"]).catch(() => "");

        const error = await assertRejects(
            () => checkpointExecutionWorktree({ worktreePath, branch: "runtime-index-side" }),
            Error,
            "runtime paths are tracked or staged",
        );

        assertStringIncludes(error.message, ".wld/internal/staged.json");
        assertEquals(await git(worktreePath, ["rev-parse", "HEAD"]), headBefore);
        assertEquals(await git(worktreePath, ["diff", "--cached", "--name-only"]).catch(() => ""), indexBefore);
        assertEquals(await Deno.readTextFile(join(worktreePath, "feature.txt")), "work\n");
    } finally {
        await git(cwd, ["worktree", "remove", "--force", worktreePath]).catch(() => {});
        await Deno.remove(cwd, { recursive: true }).catch(() => {});
    }
});
