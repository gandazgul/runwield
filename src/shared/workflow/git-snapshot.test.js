import { assertEquals, assertStringIncludes } from "@std/assert";
import { captureWorktreeTree, getWorkflowDiff } from "./git-snapshot.js";

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
    const dir = await Deno.makeTempDir({ prefix: "harns-snapshot-test-" });
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

Deno.test("workflow snapshots include later tracked edits and preserve the real index", async () => {
    const dir = await Deno.makeTempDir({ prefix: "harns-snapshot-test-" });
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
