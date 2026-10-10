import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { resolvePrimaryCheckoutRoot } from "./primary-checkout.ts";
import { defineGitFixture, git } from "./git-test-fixture.ts";

const repo = defineGitFixture(async (repoPath) => {
    await Deno.writeTextFile(join(repoPath, "README.md"), "base\n");
    await git(repoPath, ["add", "."]);
    await git(repoPath, ["commit", "-m", "base"]);
});

Deno.test("resolvePrimaryCheckoutRoot redirects a linked worktree to the primary checkout", async () => {
    const cwd = await repo.checkout();
    const worktreePath = `${cwd}-linked`;
    try {
        await git(cwd, ["worktree", "add", "-b", "side", worktreePath, "main"]);
        assertEquals(resolvePrimaryCheckoutRoot(worktreePath), await Deno.realPath(cwd));
    } finally {
        await git(cwd, ["worktree", "remove", "--force", worktreePath]).catch(() => {});
        await Deno.remove(cwd, { recursive: true }).catch(() => {});
    }
});

Deno.test("resolvePrimaryCheckoutRoot leaves primary, subdirectory, and non-git roots unchanged", async () => {
    const cwd = await repo.checkout();
    const subdir = join(cwd, "subdir");
    const nonGit = await Deno.makeTempDir();
    try {
        await Deno.mkdir(subdir);
        assertEquals(resolvePrimaryCheckoutRoot(cwd), cwd);
        assertEquals(resolvePrimaryCheckoutRoot(subdir), subdir);
        assertEquals(resolvePrimaryCheckoutRoot(nonGit), nonGit);
    } finally {
        await Deno.remove(cwd, { recursive: true }).catch(() => {});
        await Deno.remove(nonGit, { recursive: true }).catch(() => {});
    }
});
