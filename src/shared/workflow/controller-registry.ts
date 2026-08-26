/** File-backed controller state shared by all worktrees of one project. */
import { dirname, join, resolve } from "@std/path";
import { AsyncLocalStorage } from "node:async_hooks";
import { getRunWieldRuntimeDir } from "../../constants.js";
import { resolvePrimaryCheckoutRoot } from "../primary-checkout.ts";
import { inspectWorktreeRegistry } from "../worktree-registry.js";
import {
    CONTROLLER_STATE_FIELDS,
    pickControllerState,
    type WorkflowControllerState,
    type WorkflowWorktreeContext,
} from "./controller-state.ts";

type WriteScope = {
    revisions: Map<string, number>;
    previousRecovery: Map<string, WorkflowWorktreeContext | undefined>;
    parent?: WriteScope;
};
const writes = new AsyncLocalStorage<WriteScope>();

/** Attribute writes to their transition, including nested lifecycle transitions. */
export function withControllerWriteTracking<T>(run: () => Promise<T>): Promise<T> {
    return writes.run({ revisions: new Map(), previousRecovery: new Map(), parent: writes.getStore() }, run);
}

export function controllerStatesEqual(a: WorkflowControllerState, b: WorkflowControllerState): boolean {
    const left = pickControllerState(a);
    const right = pickControllerState(b);
    return CONTROLLER_STATE_FIELDS.every((key) => JSON.stringify(left[key]) === JSON.stringify(right[key]));
}

export async function restoreOwnControllerWrite(
    cwd: string,
    identity: WorkflowIdentity,
    state: WorkflowControllerState,
): Promise<boolean> {
    const current = await readControllerRecord(cwd, identity);
    const path = controllerRecordPath(cwd, identity);
    const scope = writes.getStore();
    const recovery = scope?.previousRecovery.has(path) ? scope.previousRecovery.get(path) : current?.recovery;
    if (
        controllerStatesEqual(current?.state || {}, state) &&
        JSON.stringify(recovery) === JSON.stringify(current?.recovery)
    ) return true;
    if (!current || scope?.revisions.get(path) !== current.revision) {
        return false;
    }
    const restored: WorkflowControllerState = {};
    for (const key of CONTROLLER_STATE_FIELDS) Object.assign(restored, { [key]: state[key] });
    try {
        await writeControllerState(cwd, identity, restored, {
            expectedRevision: current.revision,
            recovery: recovery || null,
        });
        return true;
    } catch (error) {
        if (error instanceof StaleControllerWriteError) return false;
        throw error;
    }
}

export interface WorkflowIdentity {
    planId?: string;
    planName: string;
}

export interface ControllerRecord {
    version: 1;
    revision: number;
    planId?: string;
    planName: string;
    state: WorkflowControllerState;
    /** Imported only when the old registry is missing; removed after registry recovery. */
    recovery?: WorkflowWorktreeContext;
}

export class StaleControllerWriteError extends Error {
    constructor() {
        super("The workflow advanced while this operation was running. Reload its current state and continue.");
        this.name = "StaleControllerWriteError";
    }
}

function canonicalPath(path: string): string {
    try {
        return Deno.realPathSync(path);
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return resolve(path);
        throw error;
    }
}

function projectRoot(cwd: string): string {
    return canonicalPath(resolvePrimaryCheckoutRoot(resolve(cwd)));
}

export function controllerRecordPath(cwd: string, identity: WorkflowIdentity): string {
    const key = identity.planId || `name:${identity.planName}`;
    return join(getRunWieldRuntimeDir(projectRoot(cwd)), "controller", "plans", `${encodeURIComponent(key)}.json`);
}

export async function readControllerRecord(cwd: string, identity: WorkflowIdentity): Promise<ControllerRecord | null> {
    try {
        const record: ControllerRecord = JSON.parse(await Deno.readTextFile(controllerRecordPath(cwd, identity)));
        if (record.version !== 1 || !Number.isInteger(record.revision) || !record.state) {
            throw new Error(
                "RunWield could not read this Plan's saved workflow. Your files and commits are unchanged.",
            );
        }
        return record;
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return null;
        throw error;
    }
}

async function atomicWrite(path: string, record: ControllerRecord): Promise<void> {
    const temporary = `${path}.${crypto.randomUUID()}.tmp`;
    const data = new TextEncoder().encode(`${JSON.stringify(record, null, 2)}\n`);
    try {
        const file = await Deno.open(temporary, { createNew: true, write: true });
        try {
            let offset = 0;
            while (offset < data.length) offset += await file.write(data.subarray(offset));
            await file.sync();
        } finally {
            file.close();
        }
        await Deno.rename(temporary, path);
        const directory = await Deno.open(dirname(path), { read: true });
        try {
            await directory.sync();
        } finally {
            directory.close();
        }
    } finally {
        await Deno.remove(temporary).catch((error) => {
            if (!(error instanceof Deno.errors.NotFound)) throw error;
        });
    }
}

export interface ControllerWriteOptions {
    expectedRevision?: number;
    /** Import only once. Old Plan copies can never overwrite a controller record. */
    initializeOnly?: boolean;
    recovery?: WorkflowWorktreeContext | null;
}

/** Move pre-onboarding state to its stable identity exactly once. */
export async function bindControllerPlanIdentity(cwd: string, identity: WorkflowIdentity): Promise<void> {
    if (!identity.planId || await readControllerRecord(cwd, identity)) return;
    const temporaryIdentity = { planName: identity.planName };
    if (!await readControllerRecord(cwd, temporaryIdentity)) return;
    const path = controllerRecordPath(cwd, temporaryIdentity);
    const lock = await Deno.open(`${path}.lock`, { create: true, read: true, write: true });
    try {
        await lock.lock(true);
        const unnamed = await readControllerRecord(cwd, temporaryIdentity);
        if (!unnamed) return;
        await writeControllerState(cwd, identity, unnamed.state, { initializeOnly: true, recovery: unnamed.recovery });
    } finally {
        lock.close();
    }
}

/** Called under the Plan lock only after the document's stable identity was saved. */
export async function finishControllerPlanIdentity(cwd: string, identity: WorkflowIdentity): Promise<void> {
    if (!identity.planId || !await readControllerRecord(cwd, identity)) return;
    const path = controllerRecordPath(cwd, { planName: identity.planName });
    await Deno.remove(path).catch((error) => {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
    });
}

export async function writeControllerState(
    cwd: string,
    identity: WorkflowIdentity,
    updates: WorkflowControllerState,
    options: ControllerWriteOptions = {},
): Promise<ControllerRecord> {
    const path = controllerRecordPath(cwd, identity);
    await Deno.mkdir(dirname(path), { recursive: true });
    // Keep this inode: deleting a lock file lets a third process lock a different
    // inode while an existing waiter still owns the original one.
    const lock = await Deno.open(`${path}.lock`, { create: true, read: true, write: true });
    try {
        await lock.lock(true);
        const before = await readControllerRecord(cwd, identity);
        if (options.initializeOnly && before) return before;
        if (options.expectedRevision !== undefined && (before?.revision || 0) !== options.expectedRevision) {
            throw new StaleControllerWriteError();
        }
        const recovery = options.recovery === undefined ? before?.recovery : options.recovery;
        const record: ControllerRecord = {
            version: 1,
            revision: (before?.revision || 0) + 1,
            ...identity,
            state: { ...before?.state, ...pickControllerState(updates) },
            ...(recovery ? { recovery } : {}),
        };
        if (
            before && controllerStatesEqual(before.state, record.state) &&
            JSON.stringify(before.recovery) === JSON.stringify(record.recovery)
        ) return before;
        await atomicWrite(path, record);
        if (!options.initializeOnly) {
            for (let scope = writes.getStore(); scope; scope = scope.parent) {
                scope.revisions.set(path, record.revision);
                if (!scope.previousRecovery.has(path)) scope.previousRecovery.set(path, before?.recovery);
            }
        }
        return record;
    } finally {
        lock.close();
    }
}

/** Absence, history, and an unreadable registry have different import semantics. */
export async function inspectControllerWorktree(cwd: string, identity: WorkflowIdentity) {
    const registry = await inspectWorktreeRegistry(projectRoot(cwd));
    if (registry.readError) return { kind: "uncertain" as const };
    const candidates = registry.entries.filter((entry) =>
        identity.planId && entry.planId ? entry.planId === identity.planId : entry.planName === identity.planName
    );
    const live = candidates.filter((entry) => entry.status !== "abandoned");
    if (live.length > 1) {
        // Document reads must still work so recovery can show both attempts.
        // The action/execution boundary rejects ambiguous registry lookups.
        return { kind: "uncertain" as const };
    }
    if (live[0]) return { kind: "live" as const, entry: live[0] };
    const retired = candidates.at(-1);
    return retired ? { kind: "retired" as const, entry: retired } : { kind: "absent" as const };
}

/** Only a live attempt supplies execution identity. History cannot reopen a branch. */
export async function readControllerWorktree(cwd: string, identity: WorkflowIdentity) {
    const result = await inspectControllerWorktree(cwd, identity);
    return result.kind === "live" ? result.entry : null;
}

/** Document candidates include reopened Plans, but never expose retired attempt IDs as live. */
export async function listControllerDocumentWorktrees(cwd: string) {
    const registry = await inspectWorktreeRegistry(projectRoot(cwd));
    const live = registry.entries.filter((entry) => entry.status !== "abandoned");
    const selected = new Set(live.map((entry) => entry.planName));
    const retired = registry.entries.filter((entry) => entry.status === "abandoned")
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    for (const entry of retired) {
        if (selected.has(entry.planName)) continue;
        const controller = await readControllerRecord(cwd, { planName: entry.planName, planId: entry.planId });
        if (controller?.state.documentWorktreeId !== entry.id) continue;
        live.push(entry);
        selected.add(entry.planName);
    }
    return live;
}

export async function loadControllerView(
    cwd: string,
    identity: WorkflowIdentity,
    legacy: WorkflowControllerState & WorkflowWorktreeContext,
) {
    const lookup = await inspectControllerWorktree(cwd, identity);
    const attempt = lookup.kind === "live" ? lookup.entry : null;
    let record = await readControllerRecord(cwd, identity);
    if ((attempt || lookup.kind === "retired") && record?.recovery) {
        // Once the registry owns the attempt, old import hints are finished.
        // Keeping them would resurrect a phantom attempt after publication prunes it.
        record = await writeControllerState(cwd, identity, {}, { recovery: null });
    }
    if (!record) {
        // Only the execution copy may seed legacy state once execution exists.
        // A stale primary document is never a fallback for missing runtime facts.
        const mayImport = lookup.kind === "absent" ||
            (attempt && canonicalPath(attempt.path) === canonicalPath(cwd));
        if (
            mayImport &&
            (Object.values(pickControllerState(legacy)).some((value) => value != null) || legacy.worktreeId)
        ) {
            const recovery = !attempt && legacy.worktreeId
                ? {
                    worktreeId: legacy.worktreeId,
                    worktreePath: legacy.worktreePath,
                    worktreeBranch: legacy.worktreeBranch,
                    worktreeBaseBranch: legacy.worktreeBaseBranch,
                    worktreeStatus: legacy.worktreeStatus,
                    executionBaselineTree: legacy.executionBaselineTree,
                }
                : undefined;
            record = await writeControllerState(cwd, identity, pickControllerState(legacy), {
                initializeOnly: true,
                recovery,
            });
        }
    }
    const state = record?.state || {};
    const worktree: WorkflowWorktreeContext = attempt
        ? {
            worktreeId: attempt.id,
            worktreePath: attempt.path,
            worktreeBranch: attempt.branch,
            worktreeBaseBranch: attempt.baseBranch,
            worktreeStatus: attempt.status === "validated" ? "completed" : attempt.status,
            executionBaselineTree: attempt.executionBaselineTree || attempt.baseTree,
        }
        : lookup.kind === "retired"
        ? { worktreeStatus: "abandoned" }
        : lookup.kind === "uncertain"
        ? {}
        : record?.recovery || {};
    return {
        state: {
            ...state,
            ...(attempt && attempt.status !== "abandoned" ? { executionMode: "worktree" as const } : {}),
            ...worktree,
        },
        revision: record?.revision || 0,
    };
}
