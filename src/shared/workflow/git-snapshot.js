/**
 * @module shared/workflow/git-snapshot
 * Git tree snapshots for workflow-scoped validation diffs.
 */

import { join } from "@std/path";
import { assertGitRepository, GitRepositoryRequiredError } from "../git.js";

/**
 * @param {string} cwd
 * @param {string[]} args
 * @param {Record<string, string>} [env]
 * @returns {Promise<string>}
 */
async function runGit(cwd, args, env = {}) {
    let output;
    try {
        const command = new Deno.Command("git", {
            args,
            cwd,
            env,
            stdout: "piped",
            stderr: "piped",
        });
        output = await command.output();
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
            throw new GitRepositoryRequiredError(
                `Git operation requires a Git repository: git ${args.join(" ")}. The git executable was not found.`,
                { cwd, operation: `git ${args.join(" ")}`, state: "git_missing" },
            );
        }
        throw error;
    }
    const decoder = new TextDecoder();
    const stdoutText = decoder.decode(output.stdout);
    const stderrText = decoder.decode(output.stderr);

    if (output.code !== 0) {
        const text = stderrText || stdoutText;
        if (text.includes("not a git repository")) {
            throw new GitRepositoryRequiredError(
                `Git operation requires a Git repository: git ${args.join(" ")}. ${text}`.trim(),
                { cwd, operation: `git ${args.join(" ")}`, state: "not_git" },
            );
        }
        throw new Error(`git ${args.join(" ")} failed: ${text}`.trim());
    }

    return stdoutText;
}

/**
 * @typedef {Object} GitCommitSummary
 * @property {string} hash
 * @property {string} date
 * @property {string} subject
 */

/**
 * List commits on HEAD since a timestamp that touched any of the provided
 * paths.
 *
 * @param {string} cwd
 * @param {string | undefined} since
 * @param {string[]} paths
 * @returns {Promise<GitCommitSummary[]>}
 */
export async function listCommitsTouchingPathsSince(cwd, since, paths) {
    const pathspecs = (Array.isArray(paths) ? paths : [])
        .map((path) => String(path || "").trim())
        .filter(Boolean);
    if (!since || pathspecs.length === 0) return [];
    await assertGitRepository(cwd, "Checking affected path commit history");

    const output = await runGit(cwd, [
        "log",
        "HEAD",
        `--since=${since}`,
        "--date=iso-strict",
        "--format=%h%x1f%cd%x1f%s",
        "--",
        ...pathspecs,
    ]);

    return output.trim().split("\n").filter(Boolean).map((line) => {
        const [hash = "", date = "", ...subjectParts] = line.split("\x1f");
        return { hash, date, subject: subjectParts.join("\x1f") };
    });
}

/**
 * List file paths contained in a git tree object.
 *
 * @param {string} cwd
 * @param {string} tree
 * @returns {Promise<string[]>}
 */
async function listTreePaths(cwd, tree) {
    const output = await runGit(cwd, ["ls-tree", "-r", "-z", "--name-only", tree]);
    return output.split("\0").filter(Boolean);
}

/**
 * Capture the current working tree into a git tree object without mutating the
 * repository's real index.
 *
 * @param {string} cwd
 * @returns {Promise<string>}
 */
export async function captureWorktreeTree(cwd) {
    await assertGitRepository(cwd, "Capturing an execution baseline tree");
    const tempDir = await Deno.makeTempDir({ prefix: "runwield-git-index-" });
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
    await assertGitRepository(cwd, "Computing a workflow diff");
    return await runGit(cwd, ["diff", `${baseTree}..${currentTree}`]);
}

/**
 * @param {string} cwd
 * @param {string | undefined} baselineTree
 * @returns {Promise<string>}
 */
export async function getWorkflowDiff(cwd, baselineTree) {
    await assertGitRepository(cwd, "Computing a workflow diff");
    if (!baselineTree) {
        return await runGit(cwd, ["diff"]);
    }

    const currentTree = await captureWorktreeTree(cwd);
    return await diffTrees(cwd, baselineTree, currentTree);
}

/**
 * Restore the repository's real index and worktree to a previously captured
 * git tree. This is destructive: files that exist in the current worktree tree
 * but not the target tree are removed before checkout.
 *
 * @param {string} cwd
 * @param {string} targetTree
 * @returns {Promise<void>}
 */
export async function restoreWorktreeTree(cwd, targetTree) {
    await assertGitRepository(cwd, "Restoring an execution baseline tree");
    const targetType = (await runGit(cwd, ["cat-file", "-t", targetTree])).trim();
    if (targetType !== "tree") {
        throw new Error(`Target ${targetTree} is a ${targetType}, not a git tree.`);
    }

    const currentTree = await captureWorktreeTree(cwd);
    const [currentPaths, targetPaths] = await Promise.all([
        listTreePaths(cwd, currentTree),
        listTreePaths(cwd, targetTree),
    ]);
    const targetPathSet = new Set(targetPaths);

    for (const path of currentPaths) {
        if (targetPathSet.has(path)) continue;
        await Deno.remove(join(cwd, path), { recursive: true }).catch((error) => {
            if (error instanceof Deno.errors.NotFound) return;
            throw error;
        });
    }

    await runGit(cwd, ["read-tree", targetTree]);
    await runGit(cwd, ["checkout-index", "-a", "-f"]);
}
