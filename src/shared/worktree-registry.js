/**
 * @module shared/worktree-registry
 * Durable registry for RunWield execution worktrees.
 */

import { dirname, join } from "@std/path";
import { RUNWIELD_DIR_NAME, WORKTREE_REGISTRY_FILE, WORKTREE_REGISTRY_LOCK_FILE } from "../constants.js";

const LOCK_TIMEOUT_MS = 30_000;
const LOCK_RETRY_MS = 50;

function getHostname() {
    try {
        return Deno.hostname();
    } catch {
        return "unknown";
    }
}

/** @param {number} pid */
async function isPidAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    const command = new Deno.Command("kill", {
        args: ["-0", String(pid)],
        stdout: "null",
        stderr: "null",
    });
    const { code } = await command.output();
    return code === 0;
}

/**
 * @typedef {Object} WorktreeRegistryEntry
 * @property {string} id
 * @property {string} planName
 * @property {string} baseBranch
 * @property {string} baseRef
 * @property {string} baseCommit
 * @property {string} [baseTree]
 * @property {string} branch
 * @property {string} path
 * @property {"active"|"completed"|"execution_failed"|"validation_failed"|"merge_conflict"|"merged"|"abandoned"} status
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/** @param {number} ms */
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** @param {string} projectRoot */
export function getWorktreeRegistryPath(projectRoot) {
    return join(projectRoot, RUNWIELD_DIR_NAME, WORKTREE_REGISTRY_FILE);
}

/** @param {string} projectRoot */
export function getWorktreeRegistryLockPath(projectRoot) {
    return join(projectRoot, RUNWIELD_DIR_NAME, WORKTREE_REGISTRY_LOCK_FILE);
}

/**
 * @param {string} projectRoot
 * @returns {Promise<WorktreeRegistryEntry[]>}
 */
async function readRegistry(projectRoot) {
    try {
        const text = await Deno.readTextFile(getWorktreeRegistryPath(projectRoot));
        const parsed = JSON.parse(text);
        return Array.isArray(parsed.entries) ? parsed.entries : [];
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return [];
        throw error;
    }
}

/**
 * @param {string} projectRoot
 * @param {WorktreeRegistryEntry[]} entries
 */
async function writeRegistry(projectRoot, entries) {
    const path = getWorktreeRegistryPath(projectRoot);
    await Deno.mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${crypto.randomUUID()}.tmp`;
    const payload = `${JSON.stringify({ version: 1, entries }, null, 2)}\n`;
    try {
        await Deno.writeTextFile(tmp, payload);
        await Deno.rename(tmp, path);
    } catch (error) {
        await Deno.remove(tmp).catch(() => {});
        throw error;
    }
}

/** @param {string} lockPath */
async function isStaleLock(lockPath) {
    try {
        const text = await Deno.readTextFile(lockPath);
        const parsed = JSON.parse(text);
        const age = Date.now() - Number(parsed.createdAtMs || 0);
        if (parsed.hostname && parsed.hostname === getHostname()) {
            return !(await isPidAlive(Number(parsed.pid)));
        }
        return age > LOCK_TIMEOUT_MS;
    } catch {
        return true;
    }
}

/**
 * Run a registry mutation/read under a best-effort file lock.
 * @template T
 * @param {string} projectRoot
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withWorktreeRegistryLock(projectRoot, fn) {
    const lockPath = getWorktreeRegistryLockPath(projectRoot);
    await Deno.mkdir(dirname(lockPath), { recursive: true });
    const deadline = Date.now() + LOCK_TIMEOUT_MS;

    while (true) {
        try {
            const file = await Deno.open(lockPath, { createNew: true, write: true });
            try {
                const payload = JSON.stringify({ pid: Deno.pid, hostname: getHostname(), createdAtMs: Date.now() });
                await file.write(new TextEncoder().encode(payload));
            } finally {
                file.close();
            }
            break;
        } catch (error) {
            if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
            if (await isStaleLock(lockPath)) {
                await Deno.remove(lockPath).catch(() => {});
                continue;
            }
            if (Date.now() > deadline) throw new Error(`Timed out waiting for worktree registry lock: ${lockPath}`);
            await delay(LOCK_RETRY_MS);
        }
    }

    try {
        return await fn();
    } finally {
        await Deno.remove(lockPath).catch(() => {});
    }
}

/** @param {string} projectRoot */
export async function listEntries(projectRoot) {
    return await withWorktreeRegistryLock(projectRoot, () => readRegistry(projectRoot));
}

/**
 * @param {string} projectRoot
 * @param {WorktreeRegistryEntry} entry
 */
export async function addEntry(projectRoot, entry) {
    return await withWorktreeRegistryLock(projectRoot, async () => {
        const entries = await readRegistry(projectRoot);
        if (entries.some((existing) => existing.id === entry.id)) {
            throw new Error(`Worktree registry entry already exists: ${entry.id}`);
        }
        entries.push(entry);
        await writeRegistry(projectRoot, entries);
        return entry;
    });
}

/**
 * @param {string} projectRoot
 * @param {string} id
 * @param {Partial<WorktreeRegistryEntry>} updates
 */
export async function updateEntry(projectRoot, id, updates) {
    return await withWorktreeRegistryLock(projectRoot, async () => {
        const entries = await readRegistry(projectRoot);
        const index = entries.findIndex((entry) => entry.id === id);
        if (index === -1) return null;
        entries[index] = { ...entries[index], ...updates, updatedAt: updates.updatedAt || new Date().toISOString() };
        await writeRegistry(projectRoot, entries);
        return entries[index];
    });
}

/**
 * @param {string} projectRoot
 * @param {string} id
 */
export async function removeEntry(projectRoot, id) {
    return await withWorktreeRegistryLock(projectRoot, async () => {
        const entries = await readRegistry(projectRoot);
        const next = entries.filter((entry) => entry.id !== id);
        await writeRegistry(projectRoot, next);
    });
}

/**
 * @param {string} projectRoot
 * @param {string} planName
 */
export async function findByPlanName(projectRoot, planName) {
    const entries = await listEntries(projectRoot);
    return entries.find((entry) => entry.planName === planName && entry.status !== "abandoned") || null;
}

/**
 * @param {string} projectRoot
 * @param {string} id
 */
export async function findById(projectRoot, id) {
    const entries = await listEntries(projectRoot);
    return entries.find((entry) => entry.id === id) || null;
}

/**
 * @param {Set<string>} paths
 * @param {string} path
 */
async function addWorktreePathVariants(paths, path) {
    paths.add(path);
    try {
        paths.add(await Deno.realPath(path));
    } catch {
        // Missing paths are handled by the caller's stat check.
    }
}

/** @param {string} projectRoot */
async function listGitWorktreePaths(projectRoot) {
    const command = new Deno.Command("git", {
        args: ["worktree", "list", "--porcelain"],
        cwd: projectRoot,
        stdout: "piped",
        stderr: "null",
    });
    const { code, stdout } = await command.output();
    if (code !== 0) return null;
    const text = new TextDecoder().decode(stdout);
    const paths = new Set();
    for (const line of text.split("\n")) {
        if (!line.startsWith("worktree ")) continue;
        const path = line.slice("worktree ".length).trim();
        if (!path) continue;
        await addWorktreePathVariants(paths, path);
    }
    return paths;
}

/** @param {string} projectRoot */
export async function pruneStaleEntries(projectRoot) {
    return await withWorktreeRegistryLock(projectRoot, async () => {
        const entries = await readRegistry(projectRoot);
        const gitWorktreePaths = await listGitWorktreePaths(projectRoot);
        const kept = [];
        const stale = [];
        for (const entry of entries) {
            try {
                const stat = await Deno.stat(entry.path);
                const realPath = await Deno.realPath(entry.path);
                const isRegisteredGitWorktree = !gitWorktreePaths ||
                    gitWorktreePaths.has(entry.path) || gitWorktreePaths.has(realPath);
                if (stat.isDirectory && isRegisteredGitWorktree) kept.push(entry);
                else stale.push(entry);
            } catch {
                stale.push(entry);
            }
        }
        if (stale.length > 0) await writeRegistry(projectRoot, kept);
        return stale;
    });
}
