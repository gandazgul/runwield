/**
 * @module shared/worktree
 * Git worktree helpers for isolated plan execution.
 */

import { basename, dirname, join } from "@std/path";
import { HOME_DIR, RUNWEILD_DIR_NAME, WORKTREE_BRANCH_PREFIX, WORKTREE_PATH_PREFIX } from "../constants.js";
import { encodeCwdForSessionDir } from "./session/root-session.js";
import { getWorkflowDiff } from "./workflow/git-snapshot.js";
import { addEntry, listEntries, pruneStaleEntries, removeEntry } from "./worktree-registry.js";

/**
 * @param {string} cwd
 * @param {string[]} args
 * @returns {Promise<string>}
 */
async function runGit(cwd, args) {
    const command = new Deno.Command("git", { args, cwd, stdout: "piped", stderr: "piped" });
    const { code, stdout, stderr } = await command.output();
    const decoder = new TextDecoder();
    const out = decoder.decode(stdout);
    const err = decoder.decode(stderr);
    if (code !== 0) throw new Error(`git ${args.join(" ")} failed: ${err || out}`.trim());
    return out;
}

/**
 * @param {string} cwd
 * @param {string[]} args
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
async function tryGit(cwd, args) {
    const command = new Deno.Command("git", { args, cwd, stdout: "piped", stderr: "piped" });
    const { code, stdout, stderr } = await command.output();
    const decoder = new TextDecoder();
    return { code, stdout: decoder.decode(stdout), stderr: decoder.decode(stderr) };
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
 * @param {string} projectRoot
 * @param {string} ref
 * @returns {Promise<boolean>}
 */
async function refExists(projectRoot, ref) {
    return (await tryGit(projectRoot, ["rev-parse", "--verify", "--quiet", ref])).code === 0;
}

/**
 * Prepare a user-authored execution target branch as an unambiguous local ref.
 *
 * @param {string} projectRoot
 * @param {string} branch
 * @returns {Promise<string>}
 */
export async function prepareTargetBranchRef(projectRoot, branch) {
    const target = String(branch || "").trim();
    if (!target || target === "HEAD") throw new Error("Target branch must not be empty or HEAD");

    const check = await tryGit(projectRoot, ["check-ref-format", "--branch", target]);
    if (check.code !== 0) {
        throw new Error(`Invalid target branch name ${target}: ${check.stderr || check.stdout}`.trim());
    }

    const localRef = `refs/heads/${target}`;
    if (await refExists(projectRoot, localRef)) return localRef;

    const hasOrigin = (await tryGit(projectRoot, ["remote", "get-url", "origin"])).code === 0;
    if (hasOrigin) {
        const remoteRef = `refs/remotes/origin/${target}`;
        if (await refExists(projectRoot, remoteRef)) {
            await runGit(projectRoot, ["branch", "--track", target, `origin/${target}`]);
            return localRef;
        }

        const remoteLookup = await tryGit(projectRoot, ["ls-remote", "--exit-code", "--heads", "origin", target]);
        if (remoteLookup.code === 0) {
            await runGit(projectRoot, ["fetch", "origin", `refs/heads/${target}:refs/remotes/origin/${target}`]);
            await runGit(projectRoot, ["branch", "--track", target, `origin/${target}`]);
            return localRef;
        }
        if (remoteLookup.code !== 2) {
            throw new Error(`Could not inspect origin/${target}: ${remoteLookup.stderr || remoteLookup.stdout}`.trim());
        }
    }

    if (!(await refExists(projectRoot, "refs/heads/main"))) {
        throw new Error(`Cannot create target branch ${target}: refs/heads/main does not exist`);
    }
    await runGit(projectRoot, ["branch", target, "refs/heads/main"]);
    return localRef;
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

/** @param {string} subject */
function clampCommitSubject(subject) {
    const normalized = normalizeCommitMessageLine(subject);
    if (normalized.length <= 50) return normalized;
    return normalized.slice(0, 50).trimEnd();
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
        ? clampCommitSubject(`Complete ${normalizedPlanName}`)
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
async function commitDirtyWorktreeState(worktreePath, branch, messageOptions = {}) {
    const currentBranch = (await runGit(worktreePath, ["branch", "--show-current"])).trim();
    if (currentBranch !== branch) {
        throw new Error(`Worktree path ${worktreePath} is on ${currentBranch || "detached HEAD"}, not ${branch}`);
    }
    await runGit(worktreePath, ["add", "-A", "--", "."]);
    const stagedDiff = await runGit(worktreePath, ["diff", "--cached", "--name-only"]);
    const stagedPaths = parseNameOnlyPaths(stagedDiff);
    if (stagedPaths.length === 0) return;
    const message = buildWorktreeCommitMessage({ ...messageOptions, branch, stagedPaths });
    await runGit(worktreePath, ["commit", "-m", message.subject, "-m", message.body]);
}

/**
 * @param {string} projectRoot
 * @param {string | undefined} worktreeRoot
 * @returns {string}
 */
export function resolveWorktreeParent(projectRoot, worktreeRoot) {
    if (worktreeRoot) return worktreeRoot;
    if (HOME_DIR) return join(HOME_DIR, RUNWEILD_DIR_NAME, "worktrees", encodeCwdForSessionDir(projectRoot));
    return join(projectRoot, RUNWEILD_DIR_NAME, "worktrees");
}

/**
 * @param {{ projectRoot: string, planName: string, baseRef?: string, baseBranch?: string, worktreeRoot?: string }} opts
 */
export async function createExecutionWorktree({ projectRoot, planName, baseRef = "HEAD", baseBranch, worktreeRoot }) {
    const id = crypto.randomUUID().slice(0, 8);
    const slug = slugify(planName);
    const branch = `${WORKTREE_BRANCH_PREFIX}${slug}-${id}`;
    const repoName = basename(projectRoot);
    const parent = resolveWorktreeParent(projectRoot, worktreeRoot);
    const path = join(parent, `${repoName}-${WORKTREE_PATH_PREFIX}${slug}-${id}`);
    const now = new Date().toISOString();
    const resolvedBaseBranch = baseBranch || (await runGit(projectRoot, ["branch", "--show-current"])).trim() || "HEAD";
    const baseCommit = (await runGit(projectRoot, ["rev-parse", baseRef])).trim();
    const baseTree = (await runGit(projectRoot, ["rev-parse", `${baseRef}^{tree}`])).trim();

    await Deno.mkdir(parent, { recursive: true });
    await runGit(projectRoot, ["worktree", "add", "-b", branch, path, baseRef]);

    /** @type {import('./worktree-registry.js').WorktreeRegistryEntry} */
    const entry = {
        id,
        planName,
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
    await addEntry(projectRoot, entry);
    return entry;
}

/**
 * @param {{ projectRoot: string, path: string, branch?: string, baseTree?: string }} opts
 */
export async function getWorktreeStatus({ path, branch, baseTree }) {
    if (!await pathExists(path)) {
        return { exists: false, clean: false, statusText: "missing", diff: "" };
    }
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
 * @typedef {Error & { repairCwd?: string, mergeWorktreePath?: string, mergeFailureKind?: string }} MergeRepairError
 */

/**
 * @param {unknown} error
 * @param {{ repairCwd?: string, mergeWorktreePath?: string, mergeFailureKind?: string }} details
 * @returns {MergeRepairError}
 */
function attachMergeRepairDetails(error, details) {
    const mergeError = /** @type {MergeRepairError} */ (error instanceof Error ? error : new Error(String(error)));
    if (details.repairCwd) mergeError.repairCwd = details.repairCwd;
    if (details.mergeWorktreePath) mergeError.mergeWorktreePath = details.mergeWorktreePath;
    if (details.mergeFailureKind) mergeError.mergeFailureKind = details.mergeFailureKind;
    return mergeError;
}

/**
 * @param {string} cwd
 * @param {string} targetRef
 * @param {string} branch
 * @param {string | undefined} executionWorktreePath
 */
async function alignPlanFilesWithMergeTarget(cwd, targetRef, branch, executionWorktreePath) {
    if (!executionWorktreePath) return;
    const mergeBase = (await runGit(cwd, ["merge-base", targetRef, branch])).trim();
    const planFilesInBranch = new Set(
        parseNameOnlyPaths(await runGit(cwd, ["diff", "--name-only", `${mergeBase}..${branch}`, "--", "plans/*.md"])),
    );
    const planFilesInTarget = new Set(
        parseNameOnlyPaths(
            await runGit(cwd, ["diff", "--name-only", `${mergeBase}..${targetRef}`, "--", "plans/*.md"]),
        ),
    );
    const conflictingPlanFiles = [...planFilesInBranch].filter((/** @type {string} */ file) =>
        planFilesInTarget.has(file)
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
    await runGit(executionWorktreePath, [
        "commit",
        "-m",
        "Align plan files with merge target to avoid frontmatter metadata conflicts",
    ]);
}

/**
 * @param {string} projectRoot
 * @param {string} branch
 * @param {string} targetBranch
 * @param {string | undefined} worktreePath
 */
async function maybeRebaseStaleExecutionBranch(projectRoot, branch, targetBranch, worktreePath) {
    const targetRef = `refs/heads/${targetBranch}`;
    const mergeBase = (await runGit(projectRoot, ["merge-base", targetRef, branch])).trim();
    const commitsBehind = parseInt(
        (await runGit(projectRoot, ["rev-list", "--count", `${mergeBase}..${targetRef}`])).trim(),
        10,
    );
    if (commitsBehind <= 5) return;
    if (!worktreePath) {
        throw new Error(
            `Worktree branch ${branch} is ${commitsBehind} commits behind ${targetBranch}, but no execution ` +
                "worktree path is available for a safe rebase.",
        );
    }
    try {
        await runGit(worktreePath, ["rebase", targetRef]);
    } catch (rebaseError) {
        await runGit(worktreePath, ["rebase", "--abort"]).catch(() => {});
        const reason = rebaseError instanceof Error ? rebaseError.message : String(rebaseError);
        throw new Error(
            `Worktree branch ${branch} is ${commitsBehind} commits behind ${targetBranch} and rebase failed: ${reason}.`,
        );
    }
}

/**
 * @param {string} cwd
 * @param {string} branch
 * @param {string[]} allowedDirtyPaths
 */
async function assertNoOverlappingDirtyPaths(cwd, branch, allowedDirtyPaths) {
    const statusText = await runGit(cwd, ["status", "--porcelain"]);
    const allowed = new Set(allowedDirtyPaths);
    const branchChangedPaths = new Set(
        parseNameOnlyPaths(await runGit(cwd, ["diff", "--name-only", `HEAD...${branch}`])),
    );
    const blockingDirtyPaths = parseStatusPaths(statusText).filter((path) =>
        !isAllowedDirtyPath(path, allowed) && overlapsBranchChangedPath(path, branchChangedPaths)
    );
    if (blockingDirtyPaths.length > 0) {
        throw new Error(
            "Primary checkout has uncommitted changes that overlap execution worktree changes; refusing to merge: " +
                blockingDirtyPaths.join(", "),
        );
    }
}

/**
 * @param {{ projectRoot: string, branch: string, worktreePath?: string, allowedDirtyPaths?: string[] }} opts
 */
async function mergeExecutionWorktreeIntoCurrentCheckout(
    { projectRoot, branch, worktreePath, allowedDirtyPaths = [] },
) {
    try {
        if (await isMergeInProgress(projectRoot)) {
            await runGit(projectRoot, ["-c", "core.editor=true", "merge", "--continue"]);
            return;
        }
        await assertNoOverlappingDirtyPaths(projectRoot, branch, allowedDirtyPaths);
        await alignPlanFilesWithMergeTarget(projectRoot, "HEAD", branch, worktreePath);
        await runGit(projectRoot, ["merge", "--no-ff", branch]);
    } catch (error) {
        throw attachMergeRepairDetails(error, {
            repairCwd: projectRoot,
            mergeFailureKind: "current_checkout_merge_conflict",
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
 * @returns {Promise<boolean>} true when the repaired merge was published; false when the preserved worktree was intentionally abandoned so the caller can retry a fresh detached merge.
 */
async function publishRepairedMergeWorktree(projectRoot, targetBranch, mergeWorktreePath) {
    if (!await pathExists(mergeWorktreePath)) {
        throw new Error(`Recorded merge repair worktree is missing: ${mergeWorktreePath}`);
    }

    try {
        if (await isMergeInProgress(mergeWorktreePath)) {
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

    const mergeCommit = (await runGit(mergeWorktreePath, ["rev-parse", "HEAD"])).trim();
    let oldTargetCommit;
    try {
        oldTargetCommit = (await runGit(mergeWorktreePath, ["rev-parse", "HEAD^1"])).trim();
        await runGit(mergeWorktreePath, ["rev-parse", "HEAD^2"]);
    } catch {
        await cleanupDetachedMergeWorktree(projectRoot, mergeWorktreePath);
        return false;
    }

    const checkoutPath = await findCheckoutPathForBranch(projectRoot, targetBranch);
    if (checkoutPath) {
        if (await isSameFilesystemPath(checkoutPath, projectRoot)) {
            await cleanupDetachedMergeWorktree(projectRoot, mergeWorktreePath);
            return false;
        }
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
 * @param {{ projectRoot: string, branch: string, targetBranch: string, worktreePath?: string, allowedDirtyPaths?: string[], repairMergeWorktreePath?: string, maxAttempts?: number }} opts
 */
async function mergeExecutionWorktreeIntoTargetBranch({
    projectRoot,
    branch,
    targetBranch,
    worktreePath,
    allowedDirtyPaths = [],
    repairMergeWorktreePath,
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
        if (repairMergeWorktreePath) {
            const published = await publishRepairedMergeWorktree(projectRoot, targetBranch, repairMergeWorktreePath);
            if (published) return;
        }
        await alignPlanFilesWithMergeTarget(projectRoot, `refs/heads/${targetBranch}`, branch, worktreePath);
        await maybeRebaseStaleExecutionBranch(projectRoot, branch, targetBranch, worktreePath);
        await mergeExecutionWorktreeIntoCurrentCheckout({ projectRoot, branch, worktreePath, allowedDirtyPaths });
        return;
    }

    if (repairMergeWorktreePath) {
        const published = await publishRepairedMergeWorktree(projectRoot, targetBranch, repairMergeWorktreePath);
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
        await alignPlanFilesWithMergeTarget(projectRoot, oldTargetCommit, branch, worktreePath);
        await maybeRebaseStaleExecutionBranch(projectRoot, branch, targetBranch, worktreePath);
        const tempId = crypto.randomUUID().slice(0, 8);
        const mergeWorktreePath = join(parent, `${repoName}-runwield-merge-${slugify(targetBranch)}-${tempId}`);
        let preserveMergeWorktree = false;
        await Deno.mkdir(parent, { recursive: true });
        try {
            await runGit(projectRoot, ["worktree", "add", "--detach", mergeWorktreePath, oldTargetCommit]);
            try {
                await runGit(mergeWorktreePath, ["merge", "--no-ff", branch]);
            } catch (mergeError) {
                preserveMergeWorktree = true;
                throw attachMergeRepairDetails(mergeError, {
                    repairCwd: mergeWorktreePath,
                    mergeWorktreePath,
                    mergeFailureKind: "detached_merge_conflict",
                });
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
        const statusText = await runGit(projectRoot, ["status", "--porcelain"]);
        const allowed = new Set(allowedDirtyPaths);
        const branchChangedPaths = new Set(
            parseNameOnlyPaths(await runGit(projectRoot, ["diff", "--name-only", `${mergeTarget}...${branch}`])),
        );
        const blockingDirtyPaths = parseStatusPaths(statusText).filter((path) =>
            !isAllowedDirtyPath(path, allowed) && overlapsBranchChangedPath(path, branchChangedPaths)
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
 * @param {{ projectRoot: string, branch: string, targetBranch?: string, worktreePath?: string, allowedDirtyPaths?: string[], repairMergeWorktreePath?: string, planName?: string, planDescription?: string }} opts
 */
export async function mergeExecutionWorktree(
    {
        projectRoot,
        branch,
        targetBranch,
        worktreePath,
        allowedDirtyPaths = [],
        repairMergeWorktreePath,
        planName,
        planDescription,
    },
) {
    const normalizedTargetBranch = targetBranch === "HEAD" ? undefined : targetBranch;
    let resolvedWorktreePath = worktreePath;
    if (!resolvedWorktreePath) {
        const worktreeList = await runGit(projectRoot, ["worktree", "list", "--porcelain"]);
        resolvedWorktreePath = findWorktreePathForBranch(worktreeList, branch) || undefined;
    }
    if (resolvedWorktreePath) {
        await commitDirtyWorktreeState(resolvedWorktreePath, branch, { planName, planDescription });
    }

    if (!normalizedTargetBranch) {
        await mergeExecutionWorktreeIntoCurrentCheckout({
            projectRoot,
            branch,
            worktreePath: resolvedWorktreePath,
            allowedDirtyPaths,
        });
        return;
    }

    await mergeExecutionWorktreeIntoTargetBranch({
        projectRoot,
        branch,
        targetBranch: normalizedTargetBranch,
        worktreePath: resolvedWorktreePath,
        repairMergeWorktreePath,
        allowedDirtyPaths,
    });
}

/**
 * @param {{ projectRoot: string, path: string, branch?: string, force?: boolean }} opts
 */
export async function removeExecutionWorktree({ projectRoot, path, branch, force = false }) {
    const args = ["worktree", "remove"];
    if (force) args.push("--force");
    args.push(path);
    await runGit(projectRoot, args).catch(async (error) => {
        if (!force || await pathExists(path)) throw error;
    });
    if (branch) await runGit(projectRoot, ["branch", "-D", branch]).catch(() => {});
}

/** @param {{ projectRoot: string }} opts */
export async function pruneMissingWorktrees({ projectRoot }) {
    await runGit(projectRoot, ["worktree", "prune"]).catch(() => {});
    return await pruneStaleEntries(projectRoot);
}

/**
 * @param {{ projectRoot: string, planName: string }} opts
 */
export async function findReusableWorktree({ projectRoot, planName }) {
    await pruneStaleEntries(projectRoot);
    const entries = await listEntries(projectRoot);
    for (const entry of entries) {
        if (entry.planName !== planName) continue;
        if (["active", "completed", "execution_failed", "validation_failed", "merge_conflict"].includes(entry.status)) {
            if (await pathExists(entry.path)) return entry;
        }
    }
    return null;
}

export { removeEntry as removeWorktreeRegistryEntry };
