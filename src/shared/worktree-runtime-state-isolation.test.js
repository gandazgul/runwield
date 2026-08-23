import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { defineGitFixture, git } from "./git-test-fixture.ts";
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
        await Deno.mkdir(join(cwd, ".wld"), { recursive: true });
        await Deno.writeTextFile(join(cwd, ".wld", "worktrees.json"), "primary registry\n");
        const registryBefore = await Deno.readTextFile(join(cwd, ".wld", "worktrees.json"));
        await Deno.mkdir(join(worktreePath, ".wld", "plan-locks"), { recursive: true });
        await Deno.mkdir(join(worktreePath, ".wld", "plan-transitions"), { recursive: true });
        await Deno.writeTextFile(join(worktreePath, ".wld", "plan-transitions", "x.json"), "{}\n");
        await Deno.writeTextFile(join(worktreePath, "feature.txt"), "work\n");

        await checkpointExecutionWorktree({ worktreePath, branch: "runtime-side" });
        await mergeExecutionWorktree({ projectRoot: cwd, branch: "runtime-side", targetBranch: "main", worktreePath });

        assertEquals(await Deno.readTextFile(join(cwd, ".wld", "worktrees.json")), registryBefore);
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

Deno.test("previously committed runtime state is removed before merge", async () => {
    const cwd = await repo.checkout();
    const worktreePath = await makeWorktree(cwd, "runtime-committed-side");
    try {
        await Deno.mkdir(join(worktreePath, ".wld", "plan-transitions"), { recursive: true });
        await Deno.writeTextFile(join(worktreePath, ".wld", "plan-transitions", "old.json"), "{}\n");
        await git(worktreePath, ["add", "."]);
        await git(worktreePath, ["commit", "-m", "old runtime"]);
        await Deno.writeTextFile(join(worktreePath, ".wld", "plan-transitions", "old.json"), "{ }\n");
        await Deno.writeTextFile(join(worktreePath, "intermediate.txt"), "work before publication\n");
        await git(worktreePath, ["add", "."]);
        await git(worktreePath, ["commit", "-m", "second old runtime"]);
        await Deno.writeTextFile(join(worktreePath, "feature.txt"), "work\n");

        await checkpointExecutionWorktree({
            worktreePath,
            branch: "runtime-committed-side",
            mergeTargetRef: (await git(cwd, ["rev-parse", "main"])).trim(),
        });
        await mergeExecutionWorktree({
            projectRoot: cwd,
            branch: "runtime-committed-side",
            targetBranch: "main",
            worktreePath,
        });

        assertEquals(await Deno.readTextFile(join(cwd, "feature.txt")), "work\n");
        assertEquals(await Deno.readTextFile(join(cwd, "intermediate.txt")), "work before publication\n");
        assertEquals(
            (await git(cwd, ["ls-tree", "-r", "--name-only", "HEAD"])).includes(".wld/plan-transitions/old.json"),
            false,
        );
    } finally {
        await git(cwd, ["worktree", "remove", "--force", worktreePath]).catch(() => {});
        await Deno.remove(cwd, { recursive: true }).catch(() => {});
    }
});
