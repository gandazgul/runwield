/**
 * @module shared/workflow/git-snapshot
 * Git tree snapshots for workflow-scoped validation diffs.
 */

import { join } from "@std/path";

/**
 * @param {string} cwd
 * @param {string[]} args
 * @param {Record<string, string>} [env]
 * @returns {Promise<string>}
 */
async function runGit(cwd, args, env = {}) {
    const command = new Deno.Command("git", {
        args,
        cwd,
        env,
        stdout: "piped",
        stderr: "piped",
    });
    const { code, stdout, stderr } = await command.output();
    const decoder = new TextDecoder();
    const stdoutText = decoder.decode(stdout);
    const stderrText = decoder.decode(stderr);

    if (code !== 0) {
        throw new Error(`git ${args.join(" ")} failed: ${stderrText || stdoutText}`.trim());
    }

    return stdoutText;
}

/**
 * Capture the current working tree into a git tree object without mutating the
 * repository's real index.
 *
 * @param {string} cwd
 * @returns {Promise<string>}
 */
export async function captureWorktreeTree(cwd) {
    const tempDir = await Deno.makeTempDir({ prefix: "harns-git-index-" });
    const indexPath = join(tempDir, "index");
    const env = { GIT_INDEX_FILE: indexPath };

    try {
        await runGit(cwd, ["add", "-A", "--", "."], env);
        return (await runGit(cwd, ["write-tree"], env)).trim();
    } finally {
        await Deno.remove(tempDir, { recursive: true }).catch(() => {});
    }
}

/**
 * @param {string} cwd
 * @param {string} baseTree
 * @param {string} currentTree
 * @returns {Promise<string>}
 */
export async function diffTrees(cwd, baseTree, currentTree) {
    return await runGit(cwd, ["diff", `${baseTree}..${currentTree}`]);
}

/**
 * @param {string} cwd
 * @param {string | undefined} baselineTree
 * @returns {Promise<string>}
 */
export async function getWorkflowDiff(cwd, baselineTree) {
    if (!baselineTree) {
        return await runGit(cwd, ["diff"]);
    }

    const currentTree = await captureWorktreeTree(cwd);
    return await diffTrees(cwd, baselineTree, currentTree);
}
