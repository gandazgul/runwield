/**
 * Materialize and verify canonical Plan files inside execution worktrees.
 */

import { basename, dirname, join, relative, SEPARATOR } from "@std/path";
import { getStoredPlanPath, parsePlanFrontMatter } from "../../plan-store.js";

/**
 * @typedef {Object} ExecutionPlanFileResult
 * @property {"present"|"restored"|"absent"|"unreadable"|"malformed"|"symlink"|"non_regular"|"identity_conflict"|"restore_failed"} kind
 * @property {string} relativePath
 * @property {string} [path]
 * @property {string} [reason]
 */

/** @param {unknown} value */
function isPlanId(value) {
    return typeof value === "string" && value.trim().length > 0;
}

/**
 * @param {unknown} canonicalPlanId
 * @param {unknown} executionPlanId
 */
function hasPlanIdConflict(canonicalPlanId, executionPlanId) {
    return isPlanId(canonicalPlanId) && isPlanId(executionPlanId) && canonicalPlanId !== executionPlanId;
}

/**
 * @param {Deno.FileInfo} info
 */
function classifyNonRegular(info) {
    if (info.isSymlink) return "symlink";
    if (!info.isFile) return "non_regular";
    return null;
}

/**
 * @param {string} projectRoot
 * @param {string} absolutePath
 */
function projectRelativePath(projectRoot, absolutePath) {
    return relative(projectRoot, absolutePath).split(SEPARATOR).join("/");
}

/**
 * Inspect an existing canonical-source parent chain without following symlinked ancestors.
 *
 * @param {string} projectRoot
 * @param {string[]} segments
 * @param {string} sourceRelativePath
 * @returns {Promise<
 *   { ok: true } |
 *   { ok: false, kind: "absent"|"unreadable"|"symlink"|"non_regular", reason: string }
 * >}
 */
async function inspectCanonicalParentChain(projectRoot, segments, sourceRelativePath) {
    let current = projectRoot;
    for (const segment of segments) {
        current = join(current, segment);
        const currentRelativePath = projectRelativePath(projectRoot, current);
        let info;
        try {
            info = await lstatOrNull(current);
        } catch {
            return {
                ok: false,
                kind: "unreadable",
                reason:
                    `Canonical Plan source parent is unreadable at ${currentRelativePath}; source: ${sourceRelativePath}.`,
            };
        }
        if (!info) {
            return {
                ok: false,
                kind: "absent",
                reason:
                    `Canonical Plan source is absent: ${sourceRelativePath} (missing parent ${currentRelativePath}).`,
            };
        }
        if (info.isSymlink) {
            return {
                ok: false,
                kind: "symlink",
                reason:
                    `Canonical Plan source parent is a symlink at ${currentRelativePath}; source: ${sourceRelativePath}.`,
            };
        }
        if (!info.isDirectory) {
            return {
                ok: false,
                kind: "non_regular",
                reason:
                    `Canonical Plan source parent is not a directory at ${currentRelativePath}; source: ${sourceRelativePath}.`,
            };
        }
    }
    return { ok: true };
}

/**
 * @param {string} projectRoot
 * @param {string} planName
 * @returns {Promise<{ kind: "loaded", path: string, relativePath: string, markdown: string, attrs: import('../../plan-store.js').PlanFrontMatter } | ExecutionPlanFileResult>}
 */
export async function loadCanonicalExecutionPlanSource(projectRoot, planName) {
    const path = getStoredPlanPath(projectRoot, planName);
    const relativePath = projectRelativePath(projectRoot, path);
    const parentRelativePath = dirname(relativePath);
    const parentSegments = parentRelativePath === "." ? [] : parentRelativePath.split("/");
    const parents = await inspectCanonicalParentChain(projectRoot, parentSegments, relativePath);
    if (!parents.ok) return { kind: parents.kind, path, relativePath, reason: parents.reason };

    let info;
    try {
        info = await Deno.lstat(path);
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
            return { kind: "absent", path, relativePath, reason: `Canonical Plan source is absent: ${relativePath}.` };
        }
        return {
            kind: "unreadable",
            path,
            relativePath,
            reason: `Canonical Plan source is unreadable: ${relativePath}.`,
        };
    }
    const nonRegular = classifyNonRegular(info);
    if (nonRegular) {
        return {
            kind: nonRegular,
            path,
            relativePath,
            reason: `Canonical Plan source is ${
                nonRegular === "symlink" ? "a symlink" : "not a regular file"
            }: ${relativePath}.`,
        };
    }
    let markdown;
    try {
        markdown = await Deno.readTextFile(path);
    } catch {
        return {
            kind: "unreadable",
            path,
            relativePath,
            reason: `Canonical Plan source is unreadable: ${relativePath}.`,
        };
    }
    try {
        const { attrs } = parsePlanFrontMatter(markdown);
        const recheckedParents = await inspectCanonicalParentChain(projectRoot, parentSegments, relativePath);
        if (!recheckedParents.ok) {
            return { kind: recheckedParents.kind, path, relativePath, reason: recheckedParents.reason };
        }
        return { kind: "loaded", path, relativePath, markdown, attrs };
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return {
            kind: "malformed",
            path,
            relativePath,
            reason: `Canonical Plan source has malformed Front Matter at ${relativePath}: ${reason}`,
        };
    }
}

/**
 * @param {string} path
 */
async function lstatOrNull(path) {
    try {
        return await Deno.lstat(path);
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return null;
        throw error;
    }
}

/**
 * Inspect or create the directory chain one segment at a time without following symlinks.
 * @param {string} root
 * @param {string[]} segments
 * @param {boolean} createMissing
 * @returns {Promise<{ ok: true } | { ok: false, kind: "symlink"|"non_regular"|"restore_failed", path: string, reason: string }>}
 */
async function verifyParentChain(root, segments, createMissing) {
    let current = root;
    for (const segment of segments) {
        current = join(current, segment);
        let info;
        try {
            info = await lstatOrNull(current);
        } catch {
            return {
                ok: false,
                kind: "restore_failed",
                path: current,
                reason: `Cannot inspect execution Plan parent ${current}. Existing evidence was preserved.`,
            };
        }
        if (!info) {
            if (!createMissing) {
                return {
                    ok: false,
                    kind: "restore_failed",
                    path: current,
                    reason: `Execution Plan parent is absent: ${current}.`,
                };
            }
            try {
                await Deno.mkdir(current);
            } catch (error) {
                if (!(error instanceof Deno.errors.AlreadyExists)) {
                    return {
                        ok: false,
                        kind: "restore_failed",
                        path: current,
                        reason: `Cannot create execution Plan parent ${current}. Existing evidence was preserved.`,
                    };
                }
            }
            try {
                info = await Deno.lstat(current);
            } catch {
                return {
                    ok: false,
                    kind: "restore_failed",
                    path: current,
                    reason: `Cannot inspect created execution Plan parent ${current}. Existing evidence was preserved.`,
                };
            }
        }
        if (info.isSymlink) {
            return {
                ok: false,
                kind: "symlink",
                path: current,
                reason: `Execution Plan parent is a symlink: ${current}. Existing evidence was preserved.`,
            };
        }
        if (!info.isDirectory) {
            return {
                ok: false,
                kind: "non_regular",
                path: current,
                reason: `Execution Plan parent is not a directory: ${current}. Existing evidence was preserved.`,
            };
        }
    }
    return { ok: true };
}

/**
 * @param {{ executionCwd: string, planName: string, canonicalSource: Extract<Awaited<ReturnType<typeof loadCanonicalExecutionPlanSource>>, {kind:"loaded"}> }} opts
 * @returns {Promise<ExecutionPlanFileResult>}
 */
export async function ensureExecutionPlanFile({ executionCwd, planName, canonicalSource }) {
    const targetPath = getStoredPlanPath(executionCwd, planName);
    const relativePath = projectRelativePath(executionCwd, targetPath);
    const targetDir = dirname(targetPath);
    const parentRelative = dirname(relativePath);
    const parentSegments = parentRelative === "." ? [] : parentRelative.split("/");

    const parents = await verifyParentChain(executionCwd, parentSegments, true);
    if (!parents.ok) return { kind: parents.kind, path: parents.path, relativePath, reason: parents.reason };

    let targetInfo;
    try {
        targetInfo = await lstatOrNull(targetPath);
    } catch {
        return {
            kind: "unreadable",
            path: targetPath,
            relativePath,
            reason: `Cannot inspect execution Plan path ${relativePath}. Existing evidence was preserved.`,
        };
    }
    if (targetInfo) {
        const nonRegular = classifyNonRegular(targetInfo);
        if (nonRegular) {
            return {
                kind: nonRegular,
                path: targetPath,
                relativePath,
                reason: `Execution Plan path ${relativePath} is ${
                    nonRegular === "symlink" ? "a symlink" : "not a regular file"
                }. Existing evidence was preserved.`,
            };
        }
        let markdown;
        try {
            markdown = await Deno.readTextFile(targetPath);
        } catch {
            return {
                kind: "unreadable",
                path: targetPath,
                relativePath,
                reason: `Execution Plan path ${relativePath} is unreadable. Existing evidence was preserved.`,
            };
        }
        try {
            const { attrs } = parsePlanFrontMatter(markdown);
            if (hasPlanIdConflict(canonicalSource.attrs.planId, attrs.planId)) {
                return {
                    kind: "identity_conflict",
                    path: targetPath,
                    relativePath,
                    reason:
                        `Execution Plan path ${relativePath} has a conflicting Plan ID. Existing evidence was preserved.`,
                };
            }
            return { kind: "present", path: targetPath, relativePath };
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            return {
                kind: "malformed",
                path: targetPath,
                relativePath,
                reason:
                    `Execution Plan path ${relativePath} has malformed Front Matter: ${reason}. Existing evidence was preserved.`,
            };
        }
    }

    const tempPath = join(targetDir, `.rw-plan-${basename(targetPath)}-${crypto.randomUUID()}.tmp`);
    try {
        await Deno.writeTextFile(tempPath, canonicalSource.markdown, { createNew: true });
        const tempMarkdown = await Deno.readTextFile(tempPath);
        const { attrs } = parsePlanFrontMatter(tempMarkdown);
        if (
            tempMarkdown !== canonicalSource.markdown || hasPlanIdConflict(canonicalSource.attrs.planId, attrs.planId)
        ) {
            return {
                kind: "restore_failed",
                path: targetPath,
                relativePath,
                reason:
                    `Temporary execution Plan validation failed for ${relativePath}. Existing evidence was preserved.`,
            };
        }
        const recheckedParents = await verifyParentChain(executionCwd, parentSegments, false);
        if (!recheckedParents.ok) {
            return {
                kind: recheckedParents.kind,
                path: recheckedParents.path,
                relativePath,
                reason: recheckedParents.reason,
            };
        }
        try {
            await Deno.link(tempPath, targetPath);
        } catch (error) {
            if (error instanceof Deno.errors.AlreadyExists) {
                const concurrent = await ensureExecutionPlanFile({ executionCwd, planName, canonicalSource });
                return concurrent.kind === "present" ? { kind: "present", path: targetPath, relativePath } : concurrent;
            }
            const reason = error instanceof Error ? error.message : String(error);
            return {
                kind: "restore_failed",
                path: targetPath,
                relativePath,
                reason:
                    `Failed to restore execution Plan path ${relativePath}: ${reason}. Existing evidence was preserved.`,
            };
        }
        return { kind: "restored", path: targetPath, relativePath };
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return {
            kind: "restore_failed",
            path: targetPath,
            relativePath,
            reason:
                `Failed to restore execution Plan path ${relativePath}: ${reason}. Existing evidence was preserved.`,
        };
    } finally {
        await Deno.remove(tempPath).catch(() => {});
    }
}

/**
 * @param {{ projectRoot: string, executionCwd: string, planName: string }} opts
 * @returns {Promise<ExecutionPlanFileResult>}
 */
export async function prepareExecutionPlanFile({ projectRoot, executionCwd, planName }) {
    const canonicalSource = await loadCanonicalExecutionPlanSource(projectRoot, planName);
    if (canonicalSource.kind !== "loaded") return canonicalSource;
    return await ensureExecutionPlanFile({ executionCwd, planName, canonicalSource });
}
