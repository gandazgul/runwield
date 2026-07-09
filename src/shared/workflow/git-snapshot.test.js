import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import {
    captureWorktreeTree,
    getWorkflowDiff,
    listCommitsTouchingPathsSince,
    restoreWorktreeTree,
} from "./git-snapshot.js";
import { GitRepositoryRequiredError } from "../git.js";

/**
 * @param {string} cwd
 * @param {string[]} args
 * @returns {Promise<string>}
 */
async function git(cwd, args) {
    const command = new Deno.Command("git", {
        args,
        cwd,
        stdout: "piped",
        stderr: "piped",
    });
    const { code, stdout, stderr } = await command.output();
    const decoder = new TextDecoder();
    const out = decoder.decode(stdout);
    const err = decoder.decode(stderr);
    if (code !== 0) {
        throw new Error(`git ${args.join(" ")} failed: ${err || out}`);
    }
    return out;
}

Deno.test("getWorkflowDiff excludes dirty worktree changes that existed before the baseline", async () => {
    const dir = await Deno.makeTempDir({ prefix: "runwield-snapshot-test-" });
    try {
        await git(dir, ["init"]);
        await Deno.writeTextFile(`${dir}/preexisting.js`, "before baseline\n");

        const baselineTree = await captureWorktreeTree(dir);

        await Deno.writeTextFile(`${dir}/preexisting.js`, "before baseline\n");
        await Deno.writeTextFile(`${dir}/changed.js`, "workflow change\n");

        const diff = await getWorkflowDiff(dir, baselineTree);

        assertEquals(diff.includes("preexisting.js"), false);
        assertStringIncludes(diff, "changed.js");
        assertStringIncludes(diff, "workflow change");
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("listCommitsTouchingPathsSince returns commits scoped to affected paths", async () => {
    const dir = await Deno.makeTempDir({ prefix: "runwield-snapshot-test-" });
    try {
        await git(dir, ["init"]);
        await git(dir, ["config", "user.email", "test@example.com"]);
        await git(dir, ["config", "user.name", "Test User"]);
        await Deno.mkdir(`${dir}/src`);

        await Deno.writeTextFile(`${dir}/src/a.js`, "a1\n");
        await git(dir, ["add", "src/a.js"]);
        await git(dir, ["commit", "-m", "touch a"]);

        await Deno.writeTextFile(`${dir}/src/b.js`, "b1\n");
        await git(dir, ["add", "src/b.js"]);
        await git(dir, ["commit", "-m", "touch b"]);

        const commits = await listCommitsTouchingPathsSince(dir, "1970-01-01T00:00:00Z", ["src/a.js"]);
        assertEquals(commits.length, 1);
        assertEquals(commits[0].subject, "touch a");

        const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        const futureCommits = await listCommitsTouchingPathsSince(dir, tomorrow, ["src/a.js"]);
        assertEquals(futureCommits, []);
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("workflow snapshots include later tracked edits and preserve the real index", async () => {
    const dir = await Deno.makeTempDir({ prefix: "runwield-snapshot-test-" });
    try {
        await git(dir, ["init"]);
        await Deno.writeTextFile(`${dir}/tracked.js`, "baseline\n");
        await Deno.writeTextFile(`${dir}/staged.js`, "staged before\n");
        await git(dir, ["add", "tracked.js", "staged.js"]);
        const statusBefore = await git(dir, ["status", "--short"]);

        const baselineTree = await captureWorktreeTree(dir);

        await Deno.writeTextFile(`${dir}/tracked.js`, "baseline\nworkflow edit\n");
        const diff = await getWorkflowDiff(dir, baselineTree);
        const statusAfter = await git(dir, ["status", "--short"]);

        assertStringIncludes(diff, "tracked.js");
        assertStringIncludes(diff, "workflow edit");
        assertEquals(statusAfter, statusBefore.replace("A  tracked.js", "AM tracked.js"));
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("restoreWorktreeTree restores baseline content and removes later files", async () => {
    const dir = await Deno.makeTempDir({ prefix: "runwield-snapshot-test-" });
    try {
        await git(dir, ["init"]);
        await Deno.writeTextFile(`${dir}/kept.js`, "baseline\n");
        await Deno.mkdir(`${dir}/nested`);
        await Deno.writeTextFile(`${dir}/nested/baseline.js`, "nested baseline\n");
        const baselineTree = await captureWorktreeTree(dir);

        await Deno.writeTextFile(`${dir}/kept.js`, "changed after baseline\n");
        await Deno.writeTextFile(`${dir}/added.js`, "added after baseline\n");
        await Deno.writeTextFile(`${dir}/nested/later.js`, "later nested\n");

        await restoreWorktreeTree(dir, baselineTree);

        assertEquals(await Deno.readTextFile(`${dir}/kept.js`), "baseline\n");
        assertEquals(await Deno.readTextFile(`${dir}/nested/baseline.js`), "nested baseline\n");
        await assertRejectsNotFound(`${dir}/added.js`);
        await assertRejectsNotFound(`${dir}/nested/later.js`);

        const restoredTree = await captureWorktreeTree(dir);
        assertEquals(restoredTree, baselineTree);
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

/**
 * @param {string} path
 */
async function assertRejectsNotFound(path) {
    let notFound = false;
    try {
        await Deno.stat(path);
    } catch (error) {
        notFound = error instanceof Deno.errors.NotFound;
    }
    assertEquals(notFound, true);
}

Deno.test("git snapshot helpers fail gracefully outside Git", async () => {
    const dir = await Deno.makeTempDir({ prefix: "runwield-non-git-snapshot-" });
    try {
        await assertRejects(
            () => captureWorktreeTree(dir),
            GitRepositoryRequiredError,
            "Capturing an execution baseline tree requires a Git repository",
        );
        await assertRejects(
            () => getWorkflowDiff(dir, undefined),
            GitRepositoryRequiredError,
            "Computing a workflow diff requires a Git repository",
        );
        await assertRejects(
            () => listCommitsTouchingPathsSince(dir, new Date().toISOString(), ["README.md"]),
            GitRepositoryRequiredError,
            "Checking affected path commit history requires a Git repository",
        );
        await assertRejects(
            () => restoreWorktreeTree(dir, "abc123"),
            GitRepositoryRequiredError,
            "Restoring an execution baseline tree requires a Git repository",
        );
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});
