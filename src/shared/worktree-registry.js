/**
 * @module shared/worktree-registry
 * Durable registry for RunWield execution worktrees.
 */

import { dirname, join } from "@std/path";
import { RUNWIELD_DIR_NAME, WORKTREE_REGISTRY_FILE, WORKTREE_REGISTRY_LOCK_FILE } from "../constants.js";
import { listPlanResources } from "../plan-store.js";

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
 * @property {string} [planId]
 * @property {string} baseBranch
 * @property {string} baseRef
 * @property {string} baseCommit
 * @property {string} [baseTree]
 * @property {string} [executionBaselineTree]
 * @property {string} branch
 * @property {string} path
 * @property {"active"|"completed"|"execution_failed"|"validation_failed"|"merge_conflict"|"merged"|"abandoned"} status
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {{ reason: string, recordedAt: string, candidates?: string[] }} [migrationIssue]
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
 * @param {WorktreeRegistryEntry[]} entries
 * @param {Array<{ name: string, attrs: { planId?: string, worktreeId?: string|null } }>} resources
 * @returns {Promise<boolean>}
 */
async function migrateLegacyRegistryEntries(projectRoot, entries, resources) {
    let changed = false;
    const byExactAttempt = new Map(
        resources
            .filter((plan) => typeof plan.attrs.planId === "string" && typeof plan.attrs.worktreeId === "string")
            .map((plan) => [`${plan.name}\0${plan.attrs.worktreeId}`, plan]),
    );
    /** @type {Map<string, Array<{ name: string, attrs: { planId?: string } }>>} */
    const byName = new Map();
    for (const plan of resources) {
        if (typeof plan.attrs.planId !== "string") continue;
        const matches = byName.get(plan.name) || [];
        matches.push(plan);
        byName.set(plan.name, matches);
    }
    const migrationIssues = [];
    for (const entry of entries) {
        if (entry.planId || !entry.planName) continue;
        const exactPlan = byExactAttempt.get(`${entry.planName}\0${entry.id}`);
        const namedPlans = byName.get(entry.planName) || [];
        const plan = exactPlan || (namedPlans.length === 1 ? namedPlans[0] : null);
        if (plan?.attrs.planId) {
            entry.planId = plan.attrs.planId;
            delete entry.migrationIssue;
            changed = true;
            continue;
        }
        if (NONTERMINAL_STATUSES.has(entry.status)) {
            migrationIssues.push({
                id: entry.id,
                planName: entry.planName,
                reason: namedPlans.length > 1 ? "ambiguous_plan_name" : "plan_not_found_or_missing_plan_id",
                candidates: namedPlans.map((candidate) => candidate.name),
                recordedAt: new Date().toISOString(),
            });
        }
    }
    if (migrationIssues.length > 0) {
        const path = join(projectRoot, RUNWIELD_DIR_NAME, "worktree-registry-migration-issues.json");
        await Deno.mkdir(dirname(path), { recursive: true });
        await Deno.writeTextFile(path, JSON.stringify({ version: 1, issues: migrationIssues }, null, 2));
    }
    return changed;
}

/**
 * @param {WorktreeRegistryEntry[]} entries
 * @returns {boolean}
 */
function hasUnresolvedLegacyNonterminalEntries(entries) {
    return entries.some((entry) => !entry.planId && NONTERMINAL_STATUSES.has(entry.status));
}

/**
 * @param {WorktreeRegistryEntry[]} entries
 */
function assertRegistryIntegrity(entries) {
    for (const entry of entries) {
        assertNoDuplicateNonterminalAttempt(entries, entry);
    }
}

/**
 * @param {string} projectRoot
 * @param {{ migrate?: boolean, planResources?: Array<{ name: string, attrs: { planId?: string, worktreeId?: string|null } }> }} [options]
 * @returns {Promise<WorktreeRegistryEntry[]>}
 */
async function readRegistry(projectRoot, options = {}) {
    try {
        const text = await Deno.readTextFile(getWorktreeRegistryPath(projectRoot));
        const parsed = JSON.parse(text);
        const version = typeof parsed.version === "number" ? parsed.version : 1;
        if (version > 2) throw new Error(`Unsupported worktree registry schema version: ${version}`);
        const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
        const ids = new Set();
        for (const entry of entries) {
            if (ids.has(entry.id)) throw new Error(`Duplicate worktree registry id: ${entry.id}`);
            ids.add(entry.id);
        }
        const migrated = options.migrate === false || !Array.isArray(options.planResources)
            ? false
            : await migrateLegacyRegistryEntries(projectRoot, entries, options.planResources);
        assertRegistryIntegrity(entries);
        const hasUnresolvedLegacy = hasUnresolvedLegacyNonterminalEntries(entries);
        if (
            options.migrate !== false && ((migrated && !hasUnresolvedLegacy) || (version < 2 && !hasUnresolvedLegacy))
        ) {
            await writeRegistry(projectRoot, entries);
        }
        return entries;
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return [];
        throw error;
    }
}

const NONTERMINAL_STATUSES = new Set([
    "active",
    "completed",
    "execution_failed",
    "validation_failed",
    "merge_conflict",
]);

/** @param {WorktreeRegistryEntry} entry */
function registryPlanKey(entry) {
    return entry.planId || entry.planName;
}

/**
 * @param {WorktreeRegistryEntry[]} entries
 * @param {WorktreeRegistryEntry} candidate
 */
function assertNoDuplicateNonterminalAttempt(entries, candidate) {
    if (!NONTERMINAL_STATUSES.has(candidate.status)) return;
    if (!candidate.planId) return;
    const key = registryPlanKey(candidate);
    const duplicate = entries.find((entry) =>
        entry.id !== candidate.id && entry.planId && registryPlanKey(entry) === key &&
        NONTERMINAL_STATUSES.has(entry.status)
    );
    if (duplicate) {
        throw new Error(
            `Worktree registry already has a nonterminal attempt for ${candidate.planName}: ${duplicate.id}`,
        );
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
    const payload = `${JSON.stringify({ version: 2, entries }, null, 2)}\n`;
    try {
        const file = await Deno.open(tmp, { create: true, write: true, truncate: true });
        try {
            await file.write(new TextEncoder().encode(payload));
            await file.sync();
        } finally {
            file.close();
        }
        await Deno.rename(tmp, path);
        const dir = await Deno.open(dirname(path), { read: true });
        try {
            await dir.sync();
        } finally {
            dir.close();
        }
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

/** @param {string} projectRoot @param {{ migrate?: boolean }} [options] */
export async function listEntries(projectRoot, options = {}) {
    const planResources = options.migrate === false ? undefined : await listPlanResources(projectRoot).catch(() => []);
    return await withWorktreeRegistryLock(projectRoot, () => readRegistry(projectRoot, { ...options, planResources }));
}

/**
 * @param {string} projectRoot
 * @param {WorktreeRegistryEntry} entry
 */
export async function addEntry(projectRoot, entry) {
    return await withWorktreeRegistryLock(projectRoot, async () => {
        const entries = await readRegistry(projectRoot);
        if (typeof entry.planId !== "string" || !entry.planId) {
            throw new Error(`Worktree registry entry ${entry.id} requires a stable planId.`);
        }
        if (entries.some((existing) => existing.id === entry.id)) {
            throw new Error(`Worktree registry entry already exists: ${entry.id}`);
        }
        assertNoDuplicateNonterminalAttempt(entries, entry);
        entries.push(entry);
        await writeRegistry(projectRoot, entries);
        return entry;
    });
}

/**
 * @param {string} projectRoot
 * @param {string} id
 * @param {Partial<WorktreeRegistryEntry>} updates
 * @returns {Promise<WorktreeRegistryEntry|null>}
 */
export async function updateEntry(projectRoot, id, updates) {
    return await withWorktreeRegistryLock(projectRoot, async () => {
        const entries = await readRegistry(projectRoot);
        const index = entries.findIndex((entry) => entry.id === id);
        if (index === -1) throw new Error(`Worktree registry entry not found: ${id}`);
        const immutableKeys = [
            "id",
            "planName",
            "planId",
            "baseBranch",
            "baseRef",
            "baseCommit",
            "baseTree",
            "branch",
            "path",
        ];
        for (const key of immutableKeys) {
            if (
                Object.hasOwn(updates, key) && /** @type {Record<string, unknown>} */
                (updates)[key] !== /** @type {Record<string, unknown>} */ (entries[index])[key]
            ) {
                throw new Error(`Worktree registry identity field cannot be updated: ${key}`);
            }
        }
        entries[index] = { ...entries[index], ...updates, updatedAt: updates.updatedAt || new Date().toISOString() };
        assertNoDuplicateNonterminalAttempt(entries.filter((entry) => entry.id !== id), entries[index]);
        await writeRegistry(projectRoot, entries);
        return entries[index];
    });
}

/**
 * Repair an entry's identity fields from proven Plan facts.
 *
 * `updateEntry` treats identity as immutable so ordinary callers cannot quietly
 * rebind an attempt to a different Plan. Reconciliation still has to correct
 * drift, so it gets this narrow door instead: a missing `planId` may be filled
 * in, and `planName` may be corrected, but an existing `planId` is never
 * reassigned and no path, branch, base, or status field is touched. Callers must
 * have proven the pairing (Plan `worktreeId` naming this exact attempt, or the
 * `planId` owner naming the Plan) before calling.
 *
 * @param {string} projectRoot
 * @param {string} id
 * @param {{ planName?: string, planId?: string }} identity
 */
export async function reconcileEntryIdentity(projectRoot, id, identity) {
    return await withWorktreeRegistryLock(projectRoot, async () => {
        const entries = await readRegistry(projectRoot);
        const index = entries.findIndex((entry) => entry.id === id);
        if (index === -1) throw new Error(`Worktree registry entry not found: ${id}`);
        const entry = entries[index];
        if (identity.planId && entry.planId && identity.planId !== entry.planId) {
            throw new Error(
                `Refusing to rebind worktree registry entry ${id} from planId ${entry.planId} to ${identity.planId}.`,
            );
        }
        entries[index] = {
            ...entry,
            ...(identity.planName ? { planName: identity.planName } : {}),
            ...(identity.planId && !entry.planId ? { planId: identity.planId } : {}),
            updatedAt: new Date().toISOString(),
        };
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
        const index = entries.findIndex((entry) => entry.id === id);
        if (index === -1) return;
        const entry = entries[index];
        entries[index] = {
            ...entry,
            status: NONTERMINAL_STATUSES.has(entry.status) ? "abandoned" : entry.status,
            updatedAt: new Date().toISOString(),
        };
        await writeRegistry(projectRoot, entries);
    });
}

/**
 * Permanently prune a registry entry after an owning repair flow proves it is a stale settled artifact.
 * Normal attempt removal should use removeEntry() so history is retained.
 *
 * @param {string} projectRoot
 * @param {string} id
 */
export async function pruneEntry(projectRoot, id) {
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
    const legacyMatches = entries.filter((entry) =>
        !entry.planId && entry.planName === planName && NONTERMINAL_STATUSES.has(entry.status)
    );
    if (legacyMatches.length > 1) {
        throw new Error(`Ambiguous legacy worktree attempts for Plan ${planName}; use exact worktree id.`);
    }
    return legacyMatches[0] || null;
}

/**
 * @param {string} projectRoot
 * @param {string} planId
 */
export async function findByPlanId(projectRoot, planId) {
    const entries = await listEntries(projectRoot);
    return entries.find((entry) => entry.planId === planId && NONTERMINAL_STATUSES.has(entry.status)) || null;
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
        return stale;
    });
}
