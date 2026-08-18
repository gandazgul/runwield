/**
 * @module shared/worktree
 * Git worktree helpers for isolated plan execution.
 */

import { basename, dirname, join } from "@std/path";
import { getHomeDir, RUNWIELD_DIR_NAME, WORKTREE_BRANCH_PREFIX } from "../constants.js";
import { encodeCwdForSessionDir } from "./session/root-session.js";
import { assertGitRepository, GitRepositoryRequiredError } from "./git.js";
import { getWorkflowDiff } from "./workflow/git-snapshot.js";
import { addEntry, listEntries, pruneStaleEntries, removeEntry } from "./worktree-registry.js";
import { isRunWieldOwnedRuntimePath, RUNWIELD_OWNED_RUNTIME_PATHS } from "./runwield-owned-paths.ts";

/**
 * @param {string} cwd
 * @param {string[]} args
 * @returns {Promise<string>}
 */
async function runGit(cwd, args) {
    const result = await runGitResult(cwd, args);
    if (result.code !== 0) {
        const output = result.stderr || result.stdout;
        if (output.includes("not a git repository") || output.includes("not a git command")) {
            throw new GitRepositoryRequiredError(
                `Git operation requires a Git repository: git ${args.join(" ")}. ${output}`.trim(),
                { cwd, operation: `git ${args.join(" ")}`, state: "not_git" },
            );
        }
        throw new Error(`git ${args.join(" ")} failed: ${output}`.trim());
    }
    return result.stdout;
}

/**
 * @param {string} cwd
 * @param {string[]} args
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
async function runGitResult(cwd, args) {
    try {
        const command = new Deno.Command("git", { args, cwd, stdout: "piped", stderr: "piped" });
        const { code, stdout, stderr } = await command.output();
        const decoder = new TextDecoder();
        return { code, stdout: decoder.decode(stdout), stderr: decoder.decode(stderr) };
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
            return { code: 127, stdout: "", stderr: "The git executable was not found." };
        }
        throw error;
    }
}

/** @param {string} value */
function slugify(value) {
    const slug = value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
    return slug.slice(0, 48) || "plan";
}

/** @param {string} path */
async function pathExists(path) {
    try {
        await Deno.stat(path);
        return true;
    } catch {
        return false;
    }
}

/**
 * @typedef {Object} PrimaryPlanPathSnapshot
 * @property {string} projectRoot
 * @property {string} relativePath
 * @property {string} absolutePath
 * @property {boolean} existed
 * @property {boolean} tracked
 * @property {boolean} headTracked
 * @property {string|null} indexMode
 * @property {string|null} indexObjectId
 * @property {string|null} content
 */

/**
 * Snapshot a dirty primary Plan path and return the checkout path to HEAD so
 * Git can merge the execution branch's finalized copy.
 *
 * @param {{ projectRoot: string, relativePath: string }} opts
 * @returns {Promise<PrimaryPlanPathSnapshot>}
 */
export async function preparePrimaryPlanPathForMerge({ projectRoot, relativePath }) {
    const normalizedPath = relativePath.replaceAll("\\", "/");
    if (!normalizedPath.startsWith("docs/plans/") || !normalizedPath.endsWith(".md") || normalizedPath.includes("..")) {
        throw new Error(`Refusing to prepare non-Plan merge path: ${relativePath}`);
    }

    const absolutePath = join(projectRoot, normalizedPath);
    const existed = await pathExists(absolutePath);
    const content = existed ? await Deno.readTextFile(absolutePath) : null;
    const indexEntry = (await runGit(projectRoot, ["ls-files", "--stage", "--", normalizedPath])).trim();
    const indexMatch = indexEntry.match(/^(\d+) ([0-9a-f]+) 0\t/);
    const indexMode = indexMatch?.[1] || null;
    const indexObjectId = indexMatch?.[2] || null;
    const tracked = Boolean(indexObjectId);
    const headResult = await runGitResult(projectRoot, ["cat-file", "-e", `HEAD:${normalizedPath}`]);
    const headTracked = headResult.code === 0;
    const snapshot = {
        projectRoot,
        relativePath: normalizedPath,
        absolutePath,
        existed,
        tracked,
        headTracked,
        indexMode,
        indexObjectId,
        content,
    };

    if (headTracked) {
        await runGit(projectRoot, ["restore", "--staged", "--worktree", "--source=HEAD", "--", normalizedPath]);
    } else {
        if (tracked) {
            await runGit(projectRoot, ["rm", "--cached", "--force", "--ignore-unmatch", "--", normalizedPath]);
        }
        if (existed) await Deno.remove(absolutePath);
    }
    return snapshot;
}

/**
 * Restore the exact primary Plan working-file state captured before merge.
 *
 * @param {PrimaryPlanPathSnapshot} snapshot
 * @returns {Promise<void>}
 */
export async function restorePrimaryPlanPathAfterMergeFailure(snapshot) {
    if (snapshot.indexMode && snapshot.indexObjectId) {
        await runGit(snapshot.projectRoot, [
            "update-index",
            "--add",
            "--cacheinfo",
            snapshot.indexMode,
            snapshot.indexObjectId,
            snapshot.relativePath,
        ]);
    } else {
        await runGit(snapshot.projectRoot, [
            "rm",
            "--cached",
            "--force",
            "--ignore-unmatch",
            "--",
            snapshot.relativePath,
        ]);
    }

    if (!snapshot.existed) {
        if (await pathExists(snapshot.absolutePath)) await Deno.remove(snapshot.absolutePath);
        return;
    }
    await Deno.mkdir(dirname(snapshot.absolutePath), { recursive: true });
    await Deno.writeTextFile(snapshot.absolutePath, snapshot.content || "");
}

/**
 * @param {string} projectRoot
 * @returns {Promise<boolean>}
 */
async function isMergeInProgress(projectRoot) {
    const mergeHeadPath = (await runGit(projectRoot, ["rev-parse", "--git-path", "MERGE_HEAD"])).trim();
    const absoluteMergeHeadPath = mergeHeadPath.startsWith("/") ? mergeHeadPath : join(projectRoot, mergeHeadPath);
    return await pathExists(absoluteMergeHeadPath);
}

/**
 * @param {string} statusText
 * @returns {string[]}
 */
function parseStatusPaths(statusText) {
    return statusText.split("\n").filter(Boolean).map((line) => line.slice(3).trim()).filter(Boolean);
}

/**
 * @param {string} diffText
 * @returns {string[]}
 */
function parseNameOnlyPaths(diffText) {
    return diffText.trim().split("\n").map((line) => line.trim()).filter(Boolean);
}

/**
 * @param {string} dirtyPath
 * @param {Set<string>} allowedPaths
 */
function isAllowedDirtyPath(dirtyPath, allowedPaths) {
    if (allowedPaths.has(dirtyPath)) return true;
    for (const allowedPath of allowedPaths) {
        const normalizedAllowed = allowedPath.endsWith("/") ? allowedPath : `${allowedPath}/`;
        const normalizedDirty = dirtyPath.endsWith("/") ? dirtyPath : `${dirtyPath}/`;
        if (dirtyPath.startsWith(normalizedAllowed)) return true;
        if (normalizedAllowed.startsWith(normalizedDirty)) return true;
    }
    return false;
}

/**
 * @param {string} dirtyPath
 * @param {Set<string>} branchChangedPaths
 */
function overlapsBranchChangedPath(dirtyPath, branchChangedPaths) {
    return isAllowedDirtyPath(dirtyPath, branchChangedPaths);
}

/**
 * @param {string[]} paths
 * @param {Set<string>} allowed
 * @returns {string[]}
 */
function filterUserDirtyPaths(paths, allowed = new Set()) {
    return paths.filter((path) => !isRunWieldOwnedRuntimePath(path) && !isAllowedDirtyPath(path, allowed));
}

/**
 * @param {string} cwd
 * @param {string[]} paths
 */
async function restoreExistingPathsFromHead(cwd, paths) {
    const existingPaths = [];
    for (const path of paths) {
        const existsInHead = await runGitResult(cwd, ["cat-file", "-e", `HEAD:${path}`]);
        if (existsInHead.code === 0) existingPaths.push(path);
    }
    if (existingPaths.length > 0) {
        await runGit(cwd, ["restore", "--worktree", "--source=HEAD", "--", ...existingPaths]);
    }
}

/**
 * Stage all changed files except RunWield-owned runtime files.
 * Listing paths first avoids passing ignored exclusion paths to `git add`.
 *
 * @param {string} worktreePath
 */
async function stageDirtyPathsExceptOwnedRuntime(worktreePath) {
    const tracked = parseNameOnlyPaths(
        await runGit(worktreePath, ["diff", "--name-only", "--no-renames", "HEAD", "--"]),
    );
    const untracked = parseNameOnlyPaths(
        await runGit(worktreePath, ["ls-files", "--others", "--exclude-standard"]),
    );
    const paths = [...new Set([...tracked, ...untracked])].filter((path) => !isRunWieldOwnedRuntimePath(path));
    if (paths.length > 0) await runGit(worktreePath, ["add", "-A", "--", ...paths]);
}

/**
 * @param {string} worktreePath
 * @param {string} mergeTargetRef
 */
async function untrackOwnedRuntimePathsAbsentFromMergeTarget(worktreePath, mergeTargetRef) {
    const trackedText = await runGit(worktreePath, ["ls-files", "--", ...RUNWIELD_OWNED_RUNTIME_PATHS]);
    const tracked = parseNameOnlyPaths(trackedText).filter(isRunWieldOwnedRuntimePath);
    if (tracked.length === 0) return;
    const absent = [];
    for (const path of tracked) {
        const existedInMergeTarget = await runGitResult(worktreePath, ["cat-file", "-e", `${mergeTargetRef}:${path}`]);
        if (existedInMergeTarget.code !== 0) absent.push(path);
    }
    if (absent.length > 0) await runGit(worktreePath, ["rm", "-r", "--cached", "--ignore-unmatch", "--", ...absent]);
}

/**
 * @param {string} porcelainText
 * @returns {{ path: string, branchRef: string }[]}
 */
function parseWorktreeRecords(porcelainText) {
    return porcelainText.trim().split("\n\n").filter(Boolean).map((record) => {
        const lines = record.split("\n");
        const worktreePath = lines.find((line) => line.startsWith("worktree "))?.slice("worktree ".length);
        const branchRef = lines.find((line) => line.startsWith("branch "))?.slice("branch ".length);
        return { path: worktreePath || "", branchRef: branchRef || "" };
    });
}

/**
 * @param {string} porcelainText
 * @param {string} branch
 * @returns {string | null}
 */
function findWorktreePathForBranch(porcelainText, branch) {
    const record = parseWorktreeRecords(porcelainText).find((entry) => entry.branchRef === `refs/heads/${branch}`);
    return record?.path || null;
}

/**
 * @param {string} projectRoot
 * @param {string} branch
 */
async function assertLocalBranchExists(projectRoot, branch) {
    await runGit(projectRoot, ["rev-parse", "--verify", `refs/heads/${branch}`]);
}

/**
 * @typedef {Object} PreparedTargetBranchRef
 * @property {string} baseRef
 * @property {string} baseBranch
 */

/**
 * @param {string} projectRoot
 * @param {string} ref
 * @returns {Promise<boolean>}
 */
async function gitRefExists(projectRoot, ref) {
    const result = await runGitResult(projectRoot, ["rev-parse", "--verify", "--quiet", ref]);
    return result.code === 0;
}

/**
 * @param {string} projectRoot
 * @param {string} branch
 */
async function assertValidTargetBranchName(projectRoot, branch) {
    if (!branch || branch === "HEAD") throw new Error("Target branch must be a branch name, not HEAD.");
    if (branch.startsWith("refs/")) throw new Error(`Target branch must not be a full ref: ${branch}`);
    if (branch.startsWith(WORKTREE_BRANCH_PREFIX)) {
        throw new Error(`Target branch cannot use reserved execution prefix: ${WORKTREE_BRANCH_PREFIX}`);
    }
    const result = await runGitResult(projectRoot, ["check-ref-format", "--branch", branch]);
    if (result.code !== 0) throw new Error(`Invalid target branch name: ${branch}`);
}

/**
 * @param {string} projectRoot
 * @param {string} branch
 * @returns {Promise<boolean>}
 */
async function remoteBranchExists(projectRoot, branch) {
    const remoteResult = await runGitResult(projectRoot, ["remote", "get-url", "origin"]);
    if (remoteResult.code !== 0) return false;

    const fetchResult = await runGitResult(
        projectRoot,
        ["fetch", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`],
    );
    if (fetchResult.code !== 0) {
        const message = fetchResult.stderr || fetchResult.stdout;
        if (message.includes("couldn't find remote ref")) {
            return false;
        }
        throw new Error(`Could not check remote target branch origin/${branch}: ${message}`.trim());
    }
    return await gitRefExists(projectRoot, `refs/remotes/origin/${branch}`);
}

/**
 * @param {string} projectRoot
 * @param {string} localBranch
 * @param {string} remoteBranch
 * @returns {Promise<PreparedTargetBranchRef>}
 */
async function createLocalTrackingBranch(projectRoot, localBranch, remoteBranch) {
    await runGit(projectRoot, ["branch", "--track", localBranch, `origin/${remoteBranch}`]);
    return { baseRef: `refs/heads/${localBranch}`, baseBranch: localBranch };
}

/**
 * @param {string} projectRoot
 * @param {string} branch
 * @returns {Promise<PreparedTargetBranchRef>}
 */
async function createLocalBranchFromMain(projectRoot, branch) {
    if (!await gitRefExists(projectRoot, "refs/heads/main")) {
        throw new Error(`Cannot create target branch ${branch}: refs/heads/main does not exist.`);
    }
    await runGit(projectRoot, ["branch", branch, "refs/heads/main"]);
    return { baseRef: `refs/heads/${branch}`, baseBranch: branch };
}

/**
 * Resolve the local branch name that a plan-authored target would record, without creating or fetching branches.
 *
 * @param {string} projectRoot
 * @param {string} branch
 * @returns {Promise<string>}
 */
export async function resolveTargetBranchName(projectRoot, branch) {
    await assertGitRepository(projectRoot, "Resolving an execution target branch");
    const target = typeof branch === "string" ? branch.trim() : "";
    await assertValidTargetBranchName(projectRoot, target);
    if (await gitRefExists(projectRoot, `refs/heads/${target}`)) return target;

    if (target.startsWith("origin/")) {
        const localBranch = target.slice("origin/".length);
        await assertValidTargetBranchName(projectRoot, localBranch);
        return localBranch;
    }

    return target;
}

/**
 * Resolve the branch checked out in the primary checkout. A detached checkout
 * has no implicit merge target, so it returns undefined.
 *
 * @param {string} projectRoot
 * @returns {Promise<string | undefined>}
 */
export async function resolveCurrentCheckoutBranch(projectRoot) {
    await assertGitRepository(projectRoot, "Resolving the current checkout branch");
    const branch = (await runGit(projectRoot, ["branch", "--show-current"])).trim();
    return branch || undefined;
}

/**
 * Prepare an unambiguous local branch ref for a plan-authored execution target.
 *
 * @param {string} projectRoot
 * @param {string} branch
 * @returns {Promise<PreparedTargetBranchRef>}
 */
export async function prepareTargetBranchRef(projectRoot, branch) {
    await assertGitRepository(projectRoot, "Preparing an execution target branch");
    const target = await resolveTargetBranchName(projectRoot, branch);
    if (await gitRefExists(projectRoot, `refs/heads/${target}`)) {
        return { baseRef: `refs/heads/${target}`, baseBranch: target };
    }

    if (typeof branch === "string" && branch.trim().startsWith("origin/")) {
        if (!await remoteBranchExists(projectRoot, target)) {
            throw new Error(`Remote target branch does not exist: origin/${target}`);
        }
        return await createLocalTrackingBranch(projectRoot, target, target);
    }

    if (await remoteBranchExists(projectRoot, target)) {
        return await createLocalTrackingBranch(projectRoot, target, target);
    }

    return await createLocalBranchFromMain(projectRoot, target);
}

/**
 * @param {string} projectRoot
 * @param {string} branch
 * @returns {Promise<string | null>}
 */
async function findCheckoutPathForBranch(projectRoot, branch) {
    const worktreeList = await runGit(projectRoot, ["worktree", "list", "--porcelain"]);
    return findWorktreePathForBranch(worktreeList, branch);
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {Promise<boolean>}
 */
async function isSameFilesystemPath(a, b) {
    try {
        return await Deno.realPath(a) === await Deno.realPath(b);
    } catch {
        return a === b;
    }
}

/**
 * @typedef {Object} WorktreeCommitMessageOptions
 * @property {string} [planName]
 * @property {string} [planDescription]
 */

/**
 * @typedef {Object} WorktreeCommitMessage
 * @property {string} subject
 * @property {string} body
 */

/** @param {unknown} value */
function normalizeCommitMessageLine(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

/** @param {string[]} stagedPaths */
function formatStagedPaths(stagedPaths) {
    const visiblePaths = stagedPaths.slice(0, 5);
    const remaining = stagedPaths.length - visiblePaths.length;
    return remaining > 0 ? `${visiblePaths.join(", ")} and ${remaining} more` : visiblePaths.join(", ");
}

/**
 * @param {WorktreeCommitMessageOptions & { branch: string, stagedPaths: string[] }} options
 * @returns {WorktreeCommitMessage}
 */
function buildWorktreeCommitMessage({ planName, planDescription, branch, stagedPaths }) {
    const normalizedPlanName = normalizeCommitMessageLine(planName);
    const normalizedDescription = normalizeCommitMessageLine(planDescription);
    const subject = normalizedPlanName
        ? normalizeCommitMessageLine(`Complete ${normalizedPlanName}`)
        : "Commit execution worktree updates";
    const bodyLines = [];
    if (normalizedPlanName) bodyLines.push(`- Plan: ${normalizedPlanName}`);
    if (normalizedDescription) bodyLines.push(`- Description: ${normalizedDescription}`);
    bodyLines.push(`- Branch: ${branch}`);
    bodyLines.push(`- Files: ${formatStagedPaths(stagedPaths)}`);
    return { subject, body: bodyLines.join("\n") };
}

/**
 * @param {string} worktreePath
 * @param {string} branch
 * @param {WorktreeCommitMessageOptions} [messageOptions]
 */
/**
 * @param {string} worktreePath
 * @param {string} branch
 * @param {WorktreeCommitMessageOptions} [messageOptions]
 * @param {string[]} [allowedDirtyPaths]
 * @param {string} [mergeTargetRef]
 */
async function commitDirtyWorktreeState(
    worktreePath,
    branch,
    messageOptions = {},
    allowedDirtyPaths = [],
    mergeTargetRef,
) {
    const currentBranch = (await runGit(worktreePath, ["branch", "--show-current"])).trim();
    if (currentBranch !== branch) {
        throw new Error(`Worktree path ${worktreePath} is on ${currentBranch || "detached HEAD"}, not ${branch}`);
    }
    if (allowedDirtyPaths.length > 0) {
        const allowedPathSet = new Set(allowedDirtyPaths);
        const status = await runGit(worktreePath, ["status", "--porcelain", "--untracked-files=all"]);
        const dirtyPaths = parseStatusPaths(status);
        const disallowedPaths = filterUserDirtyPaths(dirtyPaths, allowedPathSet);
        if (disallowedPaths.length > 0) {
            throw new Error(
                "Execution worktree changed after candidate sealing outside finalized Plan paths:\n" +
                    disallowedPaths.map((path) => `  - ${path}`).join("\n"),
            );
        }
        const allowedPathNeedsOwnedExclusion = RUNWIELD_OWNED_RUNTIME_PATHS.some((ownedPath) =>
            isAllowedDirtyPath(ownedPath, allowedPathSet)
        );
        if (allowedPathNeedsOwnedExclusion) {
            await stageDirtyPathsExceptOwnedRuntime(worktreePath);
        } else {
            await runGit(worktreePath, ["add", "-A", "--", ...allowedDirtyPaths]);
        }
    } else {
        await stageDirtyPathsExceptOwnedRuntime(worktreePath);
    }
    if (mergeTargetRef) await untrackOwnedRuntimePathsAbsentFromMergeTarget(worktreePath, mergeTargetRef);
    const stagedDiff = await runGit(worktreePath, ["diff", "--cached", "--name-only"]);
    const stagedPaths = parseNameOnlyPaths(stagedDiff);
    if (stagedPaths.length === 0) return;
    const message = buildWorktreeCommitMessage({ ...messageOptions, branch, stagedPaths });
    await runGit(worktreePath, ["commit", "-m", message.subject, "-m", message.body]);
}

/**
 * Pre-merge proof: nothing but Plan metadata changed since the candidate was sealed.
 *
 * The paired postcondition is `verifyPostMergeCandidatePublished` in validation. This
 * one runs *before* the target ref moves and answers "is the thing we validated still
 * the thing we are about to publish?"; that one runs after and answers "did it land?".
 *
 * Single implementation on purpose. This check previously existed twice with different
 * rules — once here inside the merge, keyed on the staged Plan paths, and once in
 * validation, keyed on `docs/plans/<planName>.md` alone. The narrower rule was wrong for
 * Epic publication, where the parent Epic and siblings are staged too, so the staged
 * path set is the correct authority and prefix matching is kept.
 *
 * @param {Object} opts
 * @param {string} opts.worktreePath Execution worktree to inspect.
 * @param {string} opts.sealedExecutionCommit Commit the validated candidate was sealed at.
 * @param {string[]} opts.allowedPlanPaths Plan paths staging is permitted to have touched.
 * @returns {Promise<void>}
 */
export async function assertPreMergeCandidateUnchanged({ worktreePath, sealedExecutionCommit, allowedPlanPaths }) {
    const allowed = new Set(allowedPlanPaths);
    const committed = parseNameOnlyPaths(
        await runGit(worktreePath, ["diff", "--name-only", `${sealedExecutionCommit}..HEAD`]),
    );
    const dirty = parseStatusPaths(await runGit(worktreePath, ["status", "--porcelain", "--untracked-files=all"]));
    const changed = [...new Set([...committed, ...dirty])];
    const disallowed = filterUserDirtyPaths(changed, allowed);
    if (disallowed.length > 0) {
        throw new Error(
            "Execution worktree changed after the validated candidate was sealed. " +
                "Run Workflow Validation again before publishing these files: " +
                disallowed.join(", "),
        );
    }
}

/**
 * @param {{ worktreePath: string, branch: string, planName?: string, planDescription?: string, mergeTargetRef?: string }} opts
 * @returns {Promise<{ executionCommit: string }>}
 */
export async function checkpointExecutionWorktree({ worktreePath, branch, planName, planDescription, mergeTargetRef }) {
    await commitDirtyWorktreeState(worktreePath, branch, { planName, planDescription }, [], mergeTargetRef);
    const status = await runGit(worktreePath, ["status", "--porcelain", "--untracked-files=all"]);
    const remainingDirtyPaths = parseStatusPaths(status).filter((path) => !isRunWieldOwnedRuntimePath(path));
    if (remainingDirtyPaths.length > 0) {
        throw new Error(`Execution worktree is dirty after checkpoint commit:\n${status}`);
    }
    const executionCommit = (await runGit(worktreePath, ["rev-parse", "HEAD"])).trim();
    return { executionCommit };
}

/**
 * @param {string} projectRoot
 * @param {string} branch
 */
export async function getBranchHead(projectRoot, branch) {
    return (await runGit(projectRoot, ["rev-parse", `refs/heads/${branch}`])).trim();
}

/**
 * @param {string} projectRoot
 * @param {string} commit
 * @param {string} branch
 * @returns {Promise<boolean>}
 */
export async function isCommitAncestorOfBranch(projectRoot, commit, branch) {
    const result = await runGitResult(projectRoot, ["merge-base", "--is-ancestor", commit, `refs/heads/${branch}`]);
    return result.code === 0;
}

/**
 * @param {string} projectRoot
 * @param {string | undefined} worktreeRoot
 * @returns {string}
 */
export function resolveWorktreeParent(projectRoot, worktreeRoot) {
    if (worktreeRoot) return worktreeRoot;
    const homeDir = getHomeDir();
    if (homeDir) return join(homeDir, RUNWIELD_DIR_NAME, "worktrees", encodeCwdForSessionDir(projectRoot));
    return join(projectRoot, RUNWIELD_DIR_NAME, "worktrees");
}

/**
 * Create only the Git worktree/branch artifacts for an execution attempt. The
 * caller must settle the returned proof into the registry in the same semantic
 * transition that records Plan lifecycle metadata.
 *
 * @param {{ projectRoot: string, planName: string, planId: string, baseRef?: string, baseBranch?: string, worktreeRoot?: string, attemptId?: string }} opts
 * @returns {Promise<import('./worktree-registry.js').WorktreeRegistryEntry>}
 */
export async function createWorktreeGitArtifacts(
    { projectRoot, planName, planId, baseRef = "HEAD", baseBranch, worktreeRoot, attemptId },
) {
    await assertGitRepository(projectRoot, "Creating an execution worktree");
    if (typeof planId !== "string" || !planId) {
        throw new Error(`Creating an execution worktree for ${planName} requires a stable planId.`);
    }
    const id = attemptId || crypto.randomUUID().slice(0, 8);
    const slug = slugify(planName);
    const branch = `${WORKTREE_BRANCH_PREFIX}${slug}-${id}`;
    const repoName = basename(projectRoot);
    const parent = resolveWorktreeParent(projectRoot, worktreeRoot);
    const path = join(parent, `${repoName}-${slug}-${id}`);
    const now = new Date().toISOString();
    const resolvedBaseBranch = baseBranch || await resolveCurrentCheckoutBranch(projectRoot) || "HEAD";
    const baseCommit = (await runGit(projectRoot, ["rev-parse", baseRef])).trim();
    const baseTree = (await runGit(projectRoot, ["rev-parse", `${baseRef}^{tree}`])).trim();

    await Deno.mkdir(parent, { recursive: true });
    await runGit(projectRoot, ["worktree", "add", "-b", branch, path, baseRef]);
    if (await pathExists(join(path, ".gitmodules"))) {
        await runGit(path, ["submodule", "update", "--init", "--recursive"]);
    }

    return {
        id,
        planName,
        planId,
        baseBranch: resolvedBaseBranch,
        baseRef,
        baseCommit,
        baseTree,
        branch,
        path,
        status: "active",
        createdAt: now,
        updatedAt: now,
    };
}

/**
 * Settle a previously-created Git execution worktree into the durable registry.
 * @param {string} projectRoot
 * @param {import('./worktree-registry.js').WorktreeRegistryEntry} entry
 */
export async function settleWorktreeAttempt(projectRoot, entry) {
    try {
        await addEntry(projectRoot, entry);
    } catch (error) {
        // The Git artifacts already exist at this point. Reporting only the registry
        // error would leave a real worktree on a real branch with nothing naming it, so
        // say where it is: recovery needs the path and branch, not just the cause.
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
            `Execution worktree was created but registry settlement failed for attempt ${entry.id}; ` +
                `inspect ${entry.path} on branch ${entry.branch} before removing it: ${message}`,
        );
    }
    return entry;
}

/**
 * @param {{ projectRoot: string, path: string, branch?: string, baseTree?: string }} opts
 */
export async function getWorktreeStatus({ path, branch, baseTree }) {
    if (!await pathExists(path)) {
        return { exists: false, clean: false, statusText: "missing", diff: "" };
    }
    await assertGitRepository(path, "Inspecting an execution worktree");
    const statusText = await runGit(path, ["status", "--porcelain"]);
    const clean = statusText.trim() === "";
    let currentBranch = "";
    try {
        currentBranch = (await runGit(path, ["branch", "--show-current"])).trim();
    } catch {
        currentBranch = "";
    }
    let diff = "";
    if (baseTree) {
        try {
            diff = await getWorkflowDiff(path, baseTree);
        } catch {
            diff = await runGit(path, ["diff"]);
        }
    } else {
        diff = await getWorkflowDiff(path, undefined);
    }
    return {
        exists: true,
        clean,
        branch: currentBranch,
        expectedBranch: branch,
        statusText,
        diff,
    };
}

/**
 * @typedef {Error & { repairCwd?: string, mergeWorktreePath?: string, mergeFailureKind?: string, blockingPaths?: string[] }} MergeRepairError
 */

/**
 * @param {unknown} error
 * @param {{ repairCwd?: string, mergeWorktreePath?: string, mergeFailureKind?: string, blockingPaths?: string[] }} details
 * @returns {MergeRepairError}
 */
function attachMergeRepairDetails(error, details) {
    const mergeError = /** @type {MergeRepairError} */ (error instanceof Error ? error : new Error(String(error)));
    if (details.repairCwd) mergeError.repairCwd = details.repairCwd;
    if (details.mergeWorktreePath) mergeError.mergeWorktreePath = details.mergeWorktreePath;
    if (details.mergeFailureKind) mergeError.mergeFailureKind = details.mergeFailureKind;
    if (details.blockingPaths?.length) mergeError.blockingPaths = details.blockingPaths;
    return mergeError;
}

/**
 * @param {string} cwd
 * @param {string} targetRef
 * @param {string} branch
 * @param {string | undefined} executionWorktreePath
 * @param {string[]} [preservePlanPaths]
 */
async function alignPlanFilesWithMergeTarget(cwd, targetRef, branch, executionWorktreePath, preservePlanPaths = []) {
    if (!executionWorktreePath) return;
    const preserved = new Set(preservePlanPaths.map((path) => path.replaceAll("\\", "/")));
    const mergeBase = (await runGit(cwd, ["merge-base", targetRef, branch])).trim();
    const planFilesInBranch = new Set(
        parseNameOnlyPaths(
            await runGit(cwd, ["diff", "--name-only", `${mergeBase}..${branch}`, "--", "docs/plans/*.md"]),
        ),
    );
    const planFilesInTarget = new Set(
        parseNameOnlyPaths(
            await runGit(cwd, [
                "diff",
                "--name-only",
                "--diff-filter=AMRT",
                `${mergeBase}..${targetRef}`,
                "--",
                "docs/plans/*.md",
            ]),
        ),
    );
    const conflictingPlanFiles = [...planFilesInBranch].filter((/** @type {string} */ file) =>
        planFilesInTarget.has(file) && !preserved.has(file)
    );
    if (conflictingPlanFiles.length === 0) return;

    for (const file of conflictingPlanFiles) {
        const content = await runGit(cwd, ["show", `${targetRef}:${file}`]);
        const fullPath = join(executionWorktreePath, file);
        const parentDir = join(fullPath, "..");
        await Deno.mkdir(parentDir, { recursive: true });
        await Deno.writeTextFile(fullPath, content);
    }
    await runGit(executionWorktreePath, ["add", "-A", "--", ...conflictingPlanFiles]);
    const stagedPlanChanges = await runGit(executionWorktreePath, [
        "diff",
        "--cached",
        "--name-only",
        "--",
        ...conflictingPlanFiles,
    ]);
    if (!stagedPlanChanges.trim()) return;
    await runGit(executionWorktreePath, [
        "commit",
        "-m",
        "Align plan files with merge target to avoid frontmatter metadata conflicts",
    ]);
}

/**
 * @param {string} cwd
 * @param {string} branch
 * @param {string[]} preservePlanPaths
 * @returns {Promise<string[]>}
 */
async function restorePreservedPlanConflictPaths(cwd, branch, preservePlanPaths) {
    if (preservePlanPaths.length === 0 || !await isMergeInProgress(cwd)) return [];
    const preserved = new Set(preservePlanPaths.map((path) => path.replaceAll("\\", "/")));
    const unresolvedPaths = parseNameOnlyPaths(await runGit(cwd, ["diff", "--name-only", "--diff-filter=U"]));
    const preservedUnresolvedPaths = unresolvedPaths.filter((path) => preserved.has(path.replaceAll("\\", "/")));
    if (preservedUnresolvedPaths.length === 0) return [];

    await runGit(cwd, [
        "restore",
        "--staged",
        "--worktree",
        `--source=${branch}`,
        "--",
        ...preservedUnresolvedPaths,
    ]);
    await runGit(cwd, ["add", "--", ...preservedUnresolvedPaths]);
    return preservedUnresolvedPaths;
}

/**
 * @param {string} cwd
 * @param {string} branch
 * @param {string[]} preservePlanPaths
 * @returns {Promise<boolean>}
 */
async function resolvePreservedPlanMergeConflicts(cwd, branch, preservePlanPaths) {
    if (preservePlanPaths.length === 0 || !await isMergeInProgress(cwd)) return false;
    const unresolvedPaths = parseNameOnlyPaths(await runGit(cwd, ["diff", "--name-only", "--diff-filter=U"]));
    if (unresolvedPaths.length === 0) return false;
    const restoredPaths = await restorePreservedPlanConflictPaths(cwd, branch, preservePlanPaths);
    if (restoredPaths.length !== unresolvedPaths.length) return false;

    await runGit(cwd, ["-c", "core.editor=true", "merge", "--continue"]);
    return true;
}

/**
 * @param {string} cwd
 * @param {string} branch
 * @param {string[]} allowedDirtyPaths
 */
async function assertNoOverlappingDirtyPaths(cwd, branch, allowedDirtyPaths) {
    const statusText = await runGit(cwd, ["status", "--porcelain", "--untracked-files=all"]);
    const allowed = new Set(allowedDirtyPaths);
    const branchChangedPaths = new Set(
        parseNameOnlyPaths(await runGit(cwd, ["diff", "--name-only", `HEAD...${branch}`])),
    );
    const blockingDirtyPaths = filterUserDirtyPaths(parseStatusPaths(statusText), allowed).filter((path) =>
        overlapsBranchChangedPath(path, branchChangedPaths)
    );
    if (blockingDirtyPaths.length > 0) {
        // Not a conflict, and not something an Agent may fix: these are the user's own
        // uncommitted edits, and the merge would overwrite them. Mark the failure as
        // needing the user so callers ask rather than dispatching a repair that would
        // have to throw the work away to succeed.
        throw attachMergeRepairDetails(
            new Error(
                "Primary checkout has uncommitted changes that overlap execution worktree changes; refusing to merge: " +
                    blockingDirtyPaths.join(", "),
            ),
            { mergeFailureKind: "primary_checkout_dirty", blockingPaths: blockingDirtyPaths },
        );
    }
}

/**
 * @param {{ projectRoot: string, branch: string, worktreePath?: string, allowedDirtyPaths?: string[], preservePlanPaths?: string[] }} opts
 */
async function mergeExecutionWorktreeIntoCurrentCheckout(
    { projectRoot, branch, worktreePath, allowedDirtyPaths = [], preservePlanPaths = [] },
) {
    try {
        if (await isMergeInProgress(projectRoot)) {
            if (preservePlanPaths.length > 0) {
                await runGit(projectRoot, [
                    "restore",
                    "--staged",
                    "--worktree",
                    `--source=${branch}`,
                    "--",
                    ...preservePlanPaths,
                ]);
            }
            await runGit(projectRoot, ["-c", "core.editor=true", "merge", "--continue"]);
            if (preservePlanPaths.length > 0) {
                await restoreExistingPathsFromHead(projectRoot, preservePlanPaths);
            }
            return;
        }
        await assertNoOverlappingDirtyPaths(projectRoot, branch, allowedDirtyPaths);
        await alignPlanFilesWithMergeTarget(projectRoot, "HEAD", branch, worktreePath, preservePlanPaths);
        await runGit(projectRoot, ["merge", "--no-ff", branch]);
        if (preservePlanPaths.length > 0) {
            await restoreExistingPathsFromHead(projectRoot, preservePlanPaths);
        }
    } catch (error) {
        if (await resolvePreservedPlanMergeConflicts(projectRoot, branch, preservePlanPaths)) {
            if (preservePlanPaths.length > 0) {
                await restoreExistingPathsFromHead(projectRoot, preservePlanPaths);
            }
            return;
        }
        await restorePreservedPlanConflictPaths(projectRoot, branch, preservePlanPaths);
        // Keep a kind that was already decided. `primary_checkout_dirty` is raised from
        // inside this try and is not a conflict; relabeling it here would send an Agent
        // to resolve conflict markers that do not exist.
        const alreadyClassified = /** @type {MergeRepairError} */ (error)?.mergeFailureKind;
        throw attachMergeRepairDetails(error, {
            repairCwd: projectRoot,
            mergeFailureKind: alreadyClassified || "current_checkout_merge_conflict",
        });
    }
}

/**
 * @param {string} projectRoot
 * @param {string} mergeWorktreePath
 */
async function cleanupDetachedMergeWorktree(projectRoot, mergeWorktreePath) {
    await runGit(projectRoot, ["worktree", "remove", "--force", mergeWorktreePath]).catch(async () => {
        if (await pathExists(mergeWorktreePath)) {
            await Deno.remove(mergeWorktreePath, { recursive: true }).catch(() => {});
        }
    });
}

/**
 * @param {string} projectRoot
 * @param {string} targetBranch
 * @param {string} mergeWorktreePath
 * @param {string} branch
 * @param {string[]} [preservePlanPaths]
 * @returns {Promise<boolean>} true when the repaired merge was published; false when the preserved worktree was intentionally abandoned so the caller can retry a fresh detached merge.
 */
async function publishRepairedMergeWorktree(
    projectRoot,
    targetBranch,
    mergeWorktreePath,
    branch,
    preservePlanPaths = [],
) {
    if (!await pathExists(mergeWorktreePath)) {
        throw new Error(`Recorded merge repair worktree is missing: ${mergeWorktreePath}`);
    }

    try {
        if (await isMergeInProgress(mergeWorktreePath)) {
            await restorePreservedPlanConflictPaths(mergeWorktreePath, branch, preservePlanPaths);
            await runGit(mergeWorktreePath, ["-c", "core.editor=true", "merge", "--continue"]);
        }
    } catch (error) {
        throw attachMergeRepairDetails(error, {
            repairCwd: mergeWorktreePath,
            mergeWorktreePath,
            mergeFailureKind: "detached_merge_conflict",
        });
    }

    const statusText = await runGit(mergeWorktreePath, ["status", "--porcelain"]);
    if (statusText.trim()) {
        throw attachMergeRepairDetails(
            new Error(`Merge repair worktree still has uncommitted changes:\n${statusText}`),
            {
                repairCwd: mergeWorktreePath,
                mergeWorktreePath,
                mergeFailureKind: "detached_merge_conflict",
            },
        );
    }

    const checkoutPath = await findCheckoutPathForBranch(projectRoot, targetBranch);
    const targetCheckedOutInPrimary = checkoutPath ? await isSameFilesystemPath(checkoutPath, projectRoot) : false;
    if (checkoutPath && !targetCheckedOutInPrimary) {
        throw attachMergeRepairDetails(
            new Error(
                `Target branch ${targetBranch} is checked out at ${checkoutPath}; refusing to update it behind ` +
                    "that worktree.",
            ),
            {
                repairCwd: mergeWorktreePath,
                mergeWorktreePath,
                mergeFailureKind: "target_checked_out",
            },
        );
    }

    if (preservePlanPaths.length > 0) {
        await runGit(mergeWorktreePath, [
            "restore",
            "--source",
            branch,
            "--staged",
            "--worktree",
            "--",
            ...preservePlanPaths,
        ]);
        const stagedPlanPaths = parseNameOnlyPaths(
            await runGit(mergeWorktreePath, ["diff", "--cached", "--name-only"]),
        );
        if (stagedPlanPaths.length > 0) await runGit(mergeWorktreePath, ["commit", "--amend", "--no-edit"]);
    }

    const mergeCommit = (await runGit(mergeWorktreePath, ["rev-parse", "HEAD"])).trim();
    let oldTargetCommit;
    try {
        oldTargetCommit = (await runGit(mergeWorktreePath, ["rev-parse", "HEAD^1"])).trim();
        await runGit(mergeWorktreePath, ["rev-parse", "HEAD^2"]);
    } catch {
        await cleanupDetachedMergeWorktree(projectRoot, mergeWorktreePath);
        return false;
    }

    if (targetCheckedOutInPrimary) {
        try {
            await runGit(projectRoot, ["merge", "--ff-only", mergeCommit]);
        } catch {
            await cleanupDetachedMergeWorktree(projectRoot, mergeWorktreePath);
            return false;
        }
        await cleanupDetachedMergeWorktree(projectRoot, mergeWorktreePath);
        return true;
    }

    try {
        await runGit(projectRoot, ["update-ref", `refs/heads/${targetBranch}`, mergeCommit, oldTargetCommit]);
    } catch {
        await cleanupDetachedMergeWorktree(projectRoot, mergeWorktreePath);
        return false;
    }
    await cleanupDetachedMergeWorktree(projectRoot, mergeWorktreePath);
    return true;
}

/**
 * @param {{ projectRoot: string, branch: string, targetBranch: string, worktreePath?: string, allowedDirtyPaths?: string[], preservePlanPaths?: string[], repairMergeWorktreePath?: string, expectedTargetHead?: string, maxAttempts?: number }} opts
 */
async function mergeExecutionWorktreeIntoTargetBranch({
    projectRoot,
    branch,
    targetBranch,
    worktreePath,
    allowedDirtyPaths = [],
    preservePlanPaths = [],
    repairMergeWorktreePath,
    expectedTargetHead,
    maxAttempts = 3,
}) {
    await assertLocalBranchExists(projectRoot, branch);
    await assertLocalBranchExists(projectRoot, targetBranch);

    const checkoutPath = await findCheckoutPathForBranch(projectRoot, targetBranch);
    if (checkoutPath) {
        if (!await isSameFilesystemPath(checkoutPath, projectRoot)) {
            throw new Error(
                `Target branch ${targetBranch} is checked out at ${checkoutPath}; refusing to update it behind ` +
                    "that worktree. Run recovery from that checkout or close/remove that worktree first.",
            );
        }
        const currentBranch = (await runGit(projectRoot, ["branch", "--show-current"])).trim();
        if (currentBranch !== targetBranch) {
            throw new Error(
                `Target branch ${targetBranch} is recorded at ${projectRoot}, but current branch is ${currentBranch}.`,
            );
        }
        const currentTargetHead = await getBranchHead(projectRoot, targetBranch);
        if (expectedTargetHead && currentTargetHead !== expectedTargetHead) {
            throw attachMergeRepairDetails(
                new Error(`Target branch ${targetBranch} advanced before publication; rerun Workflow Validation.`),
                { mergeFailureKind: "target_branch_advanced" },
            );
        }
        if (repairMergeWorktreePath) {
            const published = await publishRepairedMergeWorktree(
                projectRoot,
                targetBranch,
                repairMergeWorktreePath,
                branch,
                preservePlanPaths,
            );
            if (published) return;
        }
        await alignPlanFilesWithMergeTarget(
            projectRoot,
            `refs/heads/${targetBranch}`,
            branch,
            worktreePath,
            preservePlanPaths,
        );
        await mergeExecutionWorktreeIntoCurrentCheckout({
            projectRoot,
            branch,
            worktreePath,
            allowedDirtyPaths,
            preservePlanPaths,
        });
        return;
    }

    const initialTargetHead = await getBranchHead(projectRoot, targetBranch);
    if (expectedTargetHead && initialTargetHead !== expectedTargetHead) {
        throw attachMergeRepairDetails(
            new Error(`Target branch ${targetBranch} advanced before publication; rerun Workflow Validation.`),
            { mergeFailureKind: "target_branch_advanced" },
        );
    }

    if (repairMergeWorktreePath) {
        const published = await publishRepairedMergeWorktree(
            projectRoot,
            targetBranch,
            repairMergeWorktreePath,
            branch,
            preservePlanPaths,
        );
        if (published) return;
    }

    const parent = worktreePath ? dirname(worktreePath) : resolveWorktreeParent(projectRoot, undefined);
    const repoName = basename(projectRoot);
    let attempt = 0;
    while (attempt < maxAttempts) {
        attempt++;
        const currentCheckoutPath = await findCheckoutPathForBranch(projectRoot, targetBranch);
        if (currentCheckoutPath) {
            throw new Error(
                `Target branch ${targetBranch} is checked out at ${currentCheckoutPath}; refusing to update it behind ` +
                    "that worktree. Run recovery from that checkout or close/remove that worktree first.",
            );
        }
        const oldTargetCommit = (await runGit(projectRoot, ["rev-parse", `refs/heads/${targetBranch}`])).trim();
        if (expectedTargetHead && oldTargetCommit !== expectedTargetHead) {
            throw attachMergeRepairDetails(
                new Error(`Target branch ${targetBranch} advanced before publication; rerun Workflow Validation.`),
                { mergeFailureKind: "target_branch_advanced" },
            );
        }
        await alignPlanFilesWithMergeTarget(projectRoot, oldTargetCommit, branch, worktreePath, preservePlanPaths);
        const tempId = crypto.randomUUID().slice(0, 8);
        const mergeWorktreePath = join(parent, `${repoName}-merge-${slugify(targetBranch)}-${tempId}`);
        let preserveMergeWorktree = false;
        await Deno.mkdir(parent, { recursive: true });
        try {
            await runGit(projectRoot, ["worktree", "add", "--detach", mergeWorktreePath, oldTargetCommit]);
            try {
                await runGit(mergeWorktreePath, ["merge", "--no-ff", branch]);
            } catch (mergeError) {
                if (!await resolvePreservedPlanMergeConflicts(mergeWorktreePath, branch, preservePlanPaths)) {
                    preserveMergeWorktree = true;
                    throw attachMergeRepairDetails(mergeError, {
                        repairCwd: mergeWorktreePath,
                        mergeWorktreePath,
                        mergeFailureKind: "detached_merge_conflict",
                    });
                }
            }
            const mergeCommit = (await runGit(mergeWorktreePath, ["rev-parse", "HEAD"])).trim();
            try {
                await runGit(projectRoot, ["update-ref", `refs/heads/${targetBranch}`, mergeCommit, oldTargetCommit]);
                return;
            } catch (updateError) {
                if (attempt >= maxAttempts) throw updateError;
            }
        } finally {
            if (!preserveMergeWorktree) {
                await runGit(projectRoot, ["worktree", "remove", "--force", mergeWorktreePath]).catch(() => {});
            }
        }
    }
}

/**
 * Inspect whether merging an execution worktree branch is obviously risky,
 * without mutating either checkout.
 *
 * @param {{ projectRoot: string, branch: string, targetBranch?: string, allowedDirtyPaths?: string[] }} opts
 * @returns {Promise<{ ok: boolean, warnings: string[], failures: string[] }>}
 */
export async function inspectExecutionWorktreeMergeRisk({ projectRoot, branch, targetBranch, allowedDirtyPaths = [] }) {
    /** @type {string[]} */
    const warnings = [];
    /** @type {string[]} */
    const failures = [];
    const normalizedTargetBranch = targetBranch === "HEAD" ? undefined : targetBranch;
    const mergeTarget = normalizedTargetBranch ? `refs/heads/${normalizedTargetBranch}` : "HEAD";

    try {
        await assertLocalBranchExists(projectRoot, branch);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, warnings, failures: [`Recorded worktree branch is not available: ${message}`] };
    }

    if (normalizedTargetBranch) {
        try {
            await assertLocalBranchExists(projectRoot, normalizedTargetBranch);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { ok: false, warnings, failures: [`Recorded worktree target branch is not available: ${message}`] };
        }
        try {
            const checkoutPath = await findCheckoutPathForBranch(projectRoot, normalizedTargetBranch);
            if (checkoutPath && !await isSameFilesystemPath(checkoutPath, projectRoot)) {
                failures.push(
                    `Target branch ${normalizedTargetBranch} is checked out at ${checkoutPath}; refusing to update it ` +
                        "behind that worktree.",
                );
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            warnings.push(`Could not inspect target branch checkout ownership: ${message}`);
        }
    }

    try {
        const statusText = await runGit(projectRoot, ["status", "--porcelain", "--untracked-files=all"]);
        const allowed = new Set(allowedDirtyPaths);
        const branchChangedPaths = new Set(
            parseNameOnlyPaths(await runGit(projectRoot, ["diff", "--name-only", `${mergeTarget}...${branch}`])),
        );
        const blockingDirtyPaths = filterUserDirtyPaths(parseStatusPaths(statusText), allowed).filter((path) =>
            overlapsBranchChangedPath(path, branchChangedPaths)
        );
        if (blockingDirtyPaths.length > 0) {
            warnings.push(
                "Primary checkout has uncommitted changes that overlap execution worktree changes: " +
                    blockingDirtyPaths.join(", "),
            );
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Could not inspect primary checkout dirty-path risk: ${message}`);
    }

    try {
        await runGit(projectRoot, ["merge-tree", "--write-tree", mergeTarget, branch]);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`Merge check reported possible conflicts or unsupported git merge-tree behavior: ${message}`);
    }

    return { ok: failures.length === 0, warnings, failures };
}

/**
 * @typedef {Object} MergeExecutionWorktreeResult
 * @property {boolean} updatedPrimaryCheckout
 * @property {string} [executionMetadataCommit]
 */

/**
 * @param {{ projectRoot: string, branch: string, targetBranch?: string, worktreePath?: string, allowedDirtyPaths?: string[], preservePlanPaths?: string[], repairMergeWorktreePath?: string, expectedTargetHead?: string, planName?: string, planDescription?: string, sealedExecutionCommit?: string }} opts
 * @returns {Promise<MergeExecutionWorktreeResult|void>}
 */
export async function mergeExecutionWorktree(
    {
        projectRoot,
        branch,
        targetBranch,
        worktreePath,
        allowedDirtyPaths = [],
        preservePlanPaths = [],
        repairMergeWorktreePath,
        expectedTargetHead,
        planName,
        planDescription,
        sealedExecutionCommit,
    },
) {
    await assertGitRepository(projectRoot, "Merging an execution worktree");
    const normalizedTargetBranch = targetBranch === "HEAD" ? undefined : targetBranch;
    let resolvedWorktreePath = worktreePath;
    if (!resolvedWorktreePath) {
        const worktreeList = await runGit(projectRoot, ["worktree", "list", "--porcelain"]);
        resolvedWorktreePath = findWorktreePathForBranch(worktreeList, branch) || undefined;
    }
    /** @type {string | undefined} */
    let executionMetadataCommit;
    if (repairMergeWorktreePath) {
        // The repair worktree is the frozen publication candidate. Reuse its
        // execution-side parent instead of checkpointing the execution branch again:
        // a new commit cannot be contained in a merge that was already repaired.
        let repairedMetadata = await runGitResult(repairMergeWorktreePath, ["rev-parse", "HEAD^2"]);
        if (repairedMetadata.code !== 0) {
            repairedMetadata = await runGitResult(repairMergeWorktreePath, ["rev-parse", "MERGE_HEAD"]);
        }
        if (repairedMetadata.code === 0) executionMetadataCommit = repairedMetadata.stdout.trim() || undefined;
    }
    if (resolvedWorktreePath && !executionMetadataCommit) {
        const mergeTargetRef = (await runGit(
            projectRoot,
            ["rev-parse", normalizedTargetBranch || "HEAD"],
        )).trim();
        await commitDirtyWorktreeState(
            resolvedWorktreePath,
            branch,
            { planName, planDescription },
            sealedExecutionCommit ? preservePlanPaths : [],
            mergeTargetRef,
        );
        executionMetadataCommit = (await runGit(resolvedWorktreePath, ["rev-parse", "HEAD"])).trim();
    }

    if (!normalizedTargetBranch) {
        await mergeExecutionWorktreeIntoCurrentCheckout({
            projectRoot,
            branch,
            worktreePath: resolvedWorktreePath,
            allowedDirtyPaths,
            preservePlanPaths,
        });
        return { updatedPrimaryCheckout: true, executionMetadataCommit };
    }

    const targetCheckoutPath = await findCheckoutPathForBranch(projectRoot, normalizedTargetBranch);
    const updatedPrimaryCheckout = Boolean(
        targetCheckoutPath && await isSameFilesystemPath(targetCheckoutPath, projectRoot),
    );
    await mergeExecutionWorktreeIntoTargetBranch({
        projectRoot,
        branch,
        targetBranch: normalizedTargetBranch,
        worktreePath: resolvedWorktreePath,
        repairMergeWorktreePath,
        expectedTargetHead,
        allowedDirtyPaths,
        preservePlanPaths,
    });
    return { updatedPrimaryCheckout, executionMetadataCommit };
}

/**
 * Remove a worktree's Git artifacts. Never touches branches — deleting one is
 * irreversible, so it is `deleteMergedWorktreeBranch` and has to be asked for by name.
 *
 * @param {{ projectRoot: string, path: string, force?: boolean }} opts
 */
export async function removeWorktreeGitArtifacts({ projectRoot, path, force = false }) {
    await assertGitRepository(projectRoot, "Removing an execution worktree");
    if (force) {
        await runGit(projectRoot, ["worktree", "remove", "--force", path]).catch(async (error) => {
            if (await pathExists(path)) throw error;
        });
    } else {
        const status = await runGit(path, ["status", "--porcelain", "--ignore-submodules=none"]);
        if (status.trim()) {
            throw new Error(`Refusing to remove dirty execution worktree:\n${status}`);
        }
        try {
            await runGit(projectRoot, ["worktree", "remove", path]);
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            if (!reason.includes("working trees containing submodules cannot be moved or removed")) throw error;
            await runGit(projectRoot, ["worktree", "remove", "--force", path]);
        }
    }
}

/**
 * Delete an execution branch, but only once Git proves it is merged.
 *
 * Split out of worktree removal because it is the single most destructive operation in
 * the system: a worktree directory can be recreated from its branch, but a deleted
 * unmerged branch is gone. Removing a directory and destroying history are different
 * decisions and now read as different steps at every call site.
 *
 * Two proofs are accepted, because there are two ways to know nothing is lost:
 *
 * - The branch is merged into HEAD (`git branch --merged`), so its commits are reachable
 *   elsewhere.
 * - The branch never moved off the commit it was created from, so it carries no work at
 *   all. Rollback of a freshly created attempt is exactly this case, and without it a
 *   cancelled execution start left an orphan branch behind forever — a loose end doctor
 *   reports but nothing cleans up.
 *
 * Without either proof the branch is left alone and the caller is told nothing was
 * deleted, per PR-4. `baseCommit` is optional: callers that cannot prove the origin get
 * the merged check alone.
 *
 * @param {{ projectRoot: string, branch: string, baseCommit?: string }} opts
 * @returns {Promise<{ deleted: boolean, reason: string }>}
 */
export async function deleteMergedWorktreeBranch({ projectRoot, branch, baseCommit }) {
    if (baseCommit) {
        const tip = await runGitResult(projectRoot, ["rev-parse", `refs/heads/${branch}`]);
        if (tip.code === 0 && tip.stdout.trim() === baseCommit) {
            await runGit(projectRoot, ["branch", "-D", branch]);
            return {
                deleted: true,
                reason: `${branch} never moved off ${baseCommit}, so it carried no work and was deleted.`,
            };
        }
    }
    const merged = await runGitResult(projectRoot, ["branch", "--merged", "HEAD"]);
    const hasMergedProof = merged.code === 0 &&
        merged.stdout.split("\n").some((line) => line.replace(/^\*\s*/, "").trim() === branch);
    if (!hasMergedProof) {
        return {
            deleted: false,
            reason: `${branch} is not proven merged into HEAD, so it was kept.`,
        };
    }
    await runGit(projectRoot, ["branch", "-d", branch]);
    return { deleted: true, reason: `${branch} was merged into HEAD and deleted.` };
}

/** @param {{ projectRoot: string }} opts */
export async function pruneMissingWorktrees({ projectRoot }) {
    await runGit(projectRoot, ["worktree", "prune"]).catch(() => {});
    return await pruneStaleEntries(projectRoot);
}

/**
 * @param {{ projectRoot: string, planName: string, planId: string, worktreeId?: string }} opts
 */
export async function findReusableWorktree({ projectRoot, planName, planId, worktreeId }) {
    if (typeof planId !== "string" || !planId) {
        throw new Error(`Finding a reusable worktree for ${planName} requires a stable planId.`);
    }
    await pruneStaleEntries(projectRoot);
    const entries = await listEntries(projectRoot);
    for (const entry of entries) {
        if (entry.planId !== planId) continue;
        if (entry.planName !== planName) continue;
        if (worktreeId && entry.id !== worktreeId) continue;
        if (["active", "completed", "execution_failed", "validation_failed", "merge_conflict"].includes(entry.status)) {
            if (await pathExists(entry.path)) return entry;
        }
    }
    return null;
}

export { removeEntry as removeWorktreeRegistryEntry };
