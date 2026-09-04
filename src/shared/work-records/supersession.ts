import { dirname, join } from "@std/path";
import { getRunWieldRuntimeDir } from "../../constants.js";
import { formatWorkRecordMarkdown, parseWorkRecordMarkdown } from "./markdown.js";
import type { WorkRecordResource } from "./schema.js";
import { listWorkRecords, replaceWorkRecord } from "./store.js";
import { supersedeWorkRecord } from "./lifecycle.js";
import { syncWorkRecordToIndex } from "./index-adapter.js";
import type { WorkRecordMnemotecaPort } from "./mnemoteca-port.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCK_WAIT_TIMEOUT_MS = 5 * 60_000;
const LOCK_STALE_MS = 10 * 60_000;
const RECOVERY_LOCK_STALE_MS = 30_000;
const LOCK_HEARTBEAT_MS = Math.floor(LOCK_STALE_MS / 3);
const RECOVERY_LOCK_HEARTBEAT_MS = Math.floor(RECOVERY_LOCK_STALE_MS / 3);
const LOCK_RETRY_MS = 50;
const INDEX_GUIDANCE = "Run `wld wr index rebuild` to repair the derived Work Record index.";

export interface WorkRecordSupersessionOptions {
    successorRecordId: string;
    predecessorRecordIds: string[];
    mnemotecaPort: WorkRecordMnemotecaPort;
}

export interface WorkRecordSupersessionProposalEntry {
    successorRecordId: string;
    predecessorRecordId: string;
    reason: string;
}

interface PreparedReplacement {
    current: WorkRecordResource;
    markdown: string;
    parsed: WorkRecordResource;
}

export class WorkRecordSupersessionRollbackError extends Error {
    readonly uncertainRelativePaths: string[];
    readonly originalError: Error;

    constructor(originalError: Error, uncertainRelativePaths: string[], rollbackErrors: string[]) {
        super(
            `Work Record supersession failed and rollback was incomplete. Uncertain canonical paths: ${
                uncertainRelativePaths.join(", ")
            }. Original error: ${originalError.message}. Rollback errors: ${
                rollbackErrors.join("; ")
            }. Inspect these files before retrying; do not delete the successor blindly.`,
            { cause: originalError },
        );
        this.name = "WorkRecordSupersessionRollbackError";
        this.uncertainRelativePaths = uncertainRelativePaths;
        this.originalError = originalError;
    }
}

function validateId(value: string, label: string): string {
    if (typeof value !== "string" || !UUID_RE.test(value.trim())) {
        throw new Error(`${label} must be a plain UUID string.`);
    }
    return value.trim();
}

interface LockRecord {
    token: string;
    createdAt: number;
    updatedAt: number;
}

interface LockSnapshot {
    record?: LockRecord;
    mtime: number;
    size: number;
}

async function readLockSnapshot(lockPath: string): Promise<LockSnapshot | undefined> {
    let record: LockRecord | undefined;
    try {
        const value = JSON.parse(await Deno.readTextFile(lockPath));
        if (
            typeof value?.token === "string" && typeof value?.createdAt === "number" &&
            typeof value?.updatedAt === "number"
        ) {
            record = { token: value.token, createdAt: value.createdAt, updatedAt: value.updatedAt };
        }
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return undefined;
    }
    try {
        const stat = await Deno.stat(lockPath);
        return { record, mtime: stat.mtime?.getTime() ?? Date.now(), size: stat.size };
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return undefined;
        throw error;
    }
}

async function readLockRecord(lockPath: string): Promise<LockRecord | undefined> {
    return (await readLockSnapshot(lockPath))?.record;
}

async function createLock(lockPath: string, token: string): Promise<void> {
    const file = await Deno.open(lockPath, { createNew: true, write: true });
    try {
        const now = Date.now();
        await file.write(new TextEncoder().encode(JSON.stringify({ token, createdAt: now, updatedAt: now })));
        await file.sync();
    } finally {
        file.close();
    }
}

async function removeLockIfOwned(lockPath: string, token: string): Promise<void> {
    const current = await readLockRecord(lockPath);
    if (current?.token !== token) return;
    await Deno.remove(lockPath).catch((error) => {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
    });
}

async function removeLockSnapshotIfUnchanged(lockPath: string, snapshot: LockSnapshot): Promise<void> {
    const current = await readLockSnapshot(lockPath);
    if (
        current?.mtime !== snapshot.mtime || current.size !== snapshot.size ||
        current.record?.token !== snapshot.record?.token || current.record?.updatedAt !== snapshot.record?.updatedAt
    ) return;
    await Deno.remove(lockPath).catch((error) => {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
    });
}

function startLockHeartbeat(
    lockPath: string,
    token: string,
    intervalMs: number,
): ReturnType<typeof setInterval> {
    const timer = setInterval(async () => {
        try {
            const current = await readLockRecord(lockPath);
            if (current?.token !== token) return;
            await Deno.writeTextFile(lockPath, JSON.stringify({ ...current, updatedAt: Date.now() }));
        } catch {
            // A release or replacement can race with a heartbeat.
        }
    }, intervalMs);
    Deno.unrefTimer(timer);
    return timer;
}

function lockRelease(
    lockPath: string,
    token: string,
    heartbeat: ReturnType<typeof setInterval>,
): () => Promise<void> {
    return async () => {
        clearInterval(heartbeat);
        await removeLockIfOwned(lockPath, token);
    };
}

async function acquireRecoveryLock(cwd: string): Promise<() => Promise<void>> {
    const lockPath = join(getRunWieldRuntimeDir(cwd), "work-record-supersession-recovery.lock");
    await Deno.mkdir(dirname(lockPath), { recursive: true });
    const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;
    const token = crypto.randomUUID();
    while (true) {
        try {
            await createLock(lockPath, token);
            return lockRelease(lockPath, token, startLockHeartbeat(lockPath, token, RECOVERY_LOCK_HEARTBEAT_MS));
        } catch (error) {
            if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
            const snapshot = await readLockSnapshot(lockPath);
            if (
                snapshot && Date.now() - (snapshot.record?.updatedAt ?? snapshot.mtime) > RECOVERY_LOCK_STALE_MS
            ) {
                await removeLockSnapshotIfUnchanged(lockPath, snapshot);
                continue;
            }
            if (Date.now() >= deadline) {
                throw new Error(`Timed out waiting for the Work Record supersession recovery lock: ${lockPath}`);
            }
            await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
        }
    }
}

async function acquireSupersessionLock(cwd: string): Promise<() => Promise<void>> {
    const lockPath = join(getRunWieldRuntimeDir(cwd), "work-record-supersession.lock");
    await Deno.mkdir(dirname(lockPath), { recursive: true });
    const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;
    const token = crypto.randomUUID();
    while (true) {
        const releaseRecovery = await acquireRecoveryLock(cwd);
        try {
            try {
                await createLock(lockPath, token);
                const heartbeat = startLockHeartbeat(lockPath, token, LOCK_HEARTBEAT_MS);
                return async () => {
                    clearInterval(heartbeat);
                    const release = await acquireRecoveryLock(cwd);
                    try {
                        await removeLockIfOwned(lockPath, token);
                    } finally {
                        await release();
                    }
                };
            } catch (error) {
                if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
                const snapshot = await readLockSnapshot(lockPath);
                if (snapshot && Date.now() - (snapshot.record?.updatedAt ?? snapshot.mtime) > LOCK_STALE_MS) {
                    await removeLockSnapshotIfUnchanged(lockPath, snapshot);
                }
            }
        } finally {
            await releaseRecovery();
        }
        if (Date.now() >= deadline) {
            throw new Error(`Timed out waiting for the Work Record supersession lock: ${lockPath}`);
        }
        await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
    }
}

function uniqueRecordMap(records: WorkRecordResource[]): Map<string, WorkRecordResource> {
    const byId = new Map<string, WorkRecordResource>();
    for (const record of records) {
        const identity = record.attrs.recordId.toLowerCase();
        if (byId.has(identity)) {
            throw new Error(`Duplicate canonical Work Record recordId: ${record.attrs.recordId}.`);
        }
        byId.set(identity, record);
    }
    return byId;
}

function requestedIds(options: WorkRecordSupersessionOptions): { successorId: string; predecessorIds: string[] } {
    const successorId = validateId(options.successorRecordId, "successorRecordId");
    if (!Array.isArray(options.predecessorRecordIds) || options.predecessorRecordIds.length === 0) {
        throw new Error("predecessorRecordIds must contain at least one Work Record UUID.");
    }
    const predecessorIds = options.predecessorRecordIds.map((id, index) =>
        validateId(id, `predecessorRecordIds[${index}]`)
    );
    if (new Set(predecessorIds.map((id) => id.toLowerCase())).size !== predecessorIds.length) {
        throw new Error("predecessorRecordIds must not contain duplicates.");
    }
    if (predecessorIds.some((id) => id.toLowerCase() === successorId.toLowerCase())) {
        throw new Error("A Work Record cannot supersede itself.");
    }
    return { successorId, predecessorIds };
}

function supersedesList(value: string | string[] | undefined): string[] {
    if (Array.isArray(value)) return value;
    return value ? [value] : [];
}

function removeProposalCandidates(record: WorkRecordResource, ids: Set<string>) {
    const proposal = record.attrs.supersessionProposal;
    if (!proposal) return record.attrs;
    const candidates = proposal.candidates.filter((candidate) => !ids.has(candidate.recordId.toLowerCase()));
    const attrs = { ...record.attrs };
    if (candidates.length) attrs.supersessionProposal = { candidates };
    else delete attrs.supersessionProposal;
    return attrs;
}

function prepareReplacement(current: WorkRecordResource, attrs: WorkRecordResource["attrs"]): PreparedReplacement {
    const markdown = formatWorkRecordMarkdown(attrs, current.body);
    const parsed = parseWorkRecordMarkdown(markdown, {
        path: current.path,
        relativePath: current.relativePath,
    });
    return { current, markdown, parsed };
}

async function writePrepared(cwd: string, replacements: PreparedReplacement[]): Promise<void> {
    const ordered = [...replacements].sort((a, b) => a.current.relativePath.localeCompare(b.current.relativePath));
    const written: PreparedReplacement[] = [];
    try {
        for (const replacement of ordered) {
            await replaceWorkRecord(cwd, replacement.current, replacement.markdown);
            written.push(replacement);
        }
    } catch (error) {
        const rollbackErrors: string[] = [];
        const uncertainRelativePaths: string[] = [];
        for (const replacement of written.reverse()) {
            try {
                await replaceWorkRecord(cwd, replacement.parsed, replacement.current.markdown);
            } catch (rollbackError) {
                uncertainRelativePaths.push(replacement.current.relativePath);
                rollbackErrors.push(
                    `${replacement.current.relativePath}: ${
                        rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
                    }`,
                );
            }
        }
        if (rollbackErrors.length) {
            const originalError = error instanceof Error ? error : new Error(String(error));
            throw new WorkRecordSupersessionRollbackError(originalError, uncertainRelativePaths, rollbackErrors);
        }
        throw error;
    }
}

async function projectFreshCanonicalRecords(
    cwd: string,
    changedRecordIds: string[],
    mnemotecaPort: WorkRecordMnemotecaPort,
): Promise<{ records?: WorkRecordResource[]; warning?: string }> {
    let release: (() => Promise<void>) | undefined;
    const failures: string[] = [];
    try {
        release = await acquireSupersessionLock(cwd);
        const byId = uniqueRecordMap(await listWorkRecords(cwd, { createDir: false }));
        const records = changedRecordIds.map((recordId) => {
            const record = byId.get(recordId.toLowerCase());
            if (!record) throw new Error(`Changed Work Record was not found during index projection: ${recordId}.`);
            return record;
        });
        for (const record of records) {
            try {
                await syncWorkRecordToIndex(cwd, record, { mnemotecaPort });
            } catch (error) {
                failures.push(`${record.attrs.recordId}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        return {
            records,
            ...(failures.length
                ? {
                    warning: `Canonical Work Records were updated, but index sync failed: ${
                        failures.join("; ")
                    } ${INDEX_GUIDANCE}`,
                }
                : {}),
        };
    } catch (error) {
        return {
            warning: `Canonical Work Records were updated, but index sync failed: ${
                error instanceof Error ? error.message : String(error)
            } ${INDEX_GUIDANCE}`,
        };
    } finally {
        await release?.();
    }
}

async function applyLocked(
    cwd: string,
    options: WorkRecordSupersessionOptions,
    requirePending: boolean,
): Promise<WorkRecordResource[]> {
    const { successorId, predecessorIds } = requestedIds(options);
    const records = await listWorkRecords(cwd, { createDir: false });
    const byId = uniqueRecordMap(records);
    const successor = byId.get(successorId.toLowerCase());
    if (!successor) throw new Error(`Successor Work Record was not found: ${successorId}.`);
    const predecessors = predecessorIds.map((id) => {
        const record = byId.get(id.toLowerCase());
        if (!record) throw new Error(`Predecessor Work Record was not found: ${id}.`);
        if (
            record.attrs.supersededBy &&
            record.attrs.supersededBy.toLowerCase() !== successor.attrs.recordId.toLowerCase()
        ) {
            throw new Error(
                `Work Record ${record.attrs.recordId} is already superseded by ${record.attrs.supersededBy}.`,
            );
        }
        return record;
    });
    const pending = new Set(
        (successor.attrs.supersessionProposal?.candidates || []).map((item) => item.recordId.toLowerCase()),
    );
    if (requirePending) {
        const absent = predecessorIds.filter((id) => !pending.has(id.toLowerCase()));
        if (absent.length) throw new Error(`Supersession proposal is not pending for: ${absent.join(", ")}.`);
    }
    const requested = new Set(predecessorIds.map((id) => id.toLowerCase()));
    const successorAttrs = removeProposalCandidates(successor, requested);
    const priorIds = supersedesList(successorAttrs.supersedes);
    const seenSupersedes = new Set(priorIds.map((id) => id.toLowerCase()));
    successorAttrs.supersedes = [...priorIds];
    for (const predecessor of predecessors) {
        const identity = predecessor.attrs.recordId.toLowerCase();
        if (seenSupersedes.has(identity)) continue;
        seenSupersedes.add(identity);
        successorAttrs.supersedes.push(predecessor.attrs.recordId);
    }
    const replacements = [
        prepareReplacement(successor, successorAttrs),
        ...predecessors.map((record) =>
            prepareReplacement(record, supersedeWorkRecord(record.attrs, successor.attrs.recordId))
        ),
    ];
    await writePrepared(cwd, replacements);
    return replacements.map((replacement) => replacement.parsed);
}

export async function applyWorkRecordSupersession(cwd: string, options: WorkRecordSupersessionOptions) {
    const release = await acquireSupersessionLock(cwd);
    let records: WorkRecordResource[];
    try {
        records = await applyLocked(cwd, options, false);
    } finally {
        await release();
    }
    const projection = await projectFreshCanonicalRecords(
        cwd,
        records.map((record) => record.attrs.recordId),
        options.mnemotecaPort,
    );
    return {
        records: projection.records || records,
        ...(projection.warning ? { indexWarning: projection.warning } : {}),
    };
}

export async function listWorkRecordSupersessionProposals(cwd: string): Promise<WorkRecordSupersessionProposalEntry[]> {
    const records = await listWorkRecords(cwd, { createDir: false });
    return records.flatMap((record) =>
        (record.attrs.supersessionProposal?.candidates || []).map((candidate) => ({
            successorRecordId: record.attrs.recordId,
            predecessorRecordId: candidate.recordId,
            reason: candidate.reason,
        }))
    );
}

export async function confirmWorkRecordSupersession(cwd: string, options: WorkRecordSupersessionOptions) {
    const release = await acquireSupersessionLock(cwd);
    let records: WorkRecordResource[];
    try {
        records = await applyLocked(cwd, options, true);
    } finally {
        await release();
    }
    const projection = await projectFreshCanonicalRecords(
        cwd,
        records.map((record) => record.attrs.recordId),
        options.mnemotecaPort,
    );
    return {
        records: projection.records || records,
        ...(projection.warning ? { indexWarning: projection.warning } : {}),
    };
}

export async function rejectWorkRecordSupersession(cwd: string, options: WorkRecordSupersessionOptions) {
    const release = await acquireSupersessionLock(cwd);
    let successor: WorkRecordResource;
    try {
        const { successorId, predecessorIds } = requestedIds(options);
        const records = await listWorkRecords(cwd, { createDir: false });
        const current = uniqueRecordMap(records).get(successorId.toLowerCase());
        if (!current) throw new Error(`Successor Work Record was not found: ${successorId}.`);
        const pending = new Set(
            (current.attrs.supersessionProposal?.candidates || []).map((item) => item.recordId.toLowerCase()),
        );
        const absent = predecessorIds.filter((id) => !pending.has(id.toLowerCase()));
        if (absent.length) throw new Error(`Supersession proposal is not pending for: ${absent.join(", ")}.`);
        const replacement = prepareReplacement(
            current,
            removeProposalCandidates(current, new Set(predecessorIds.map((id) => id.toLowerCase()))),
        );
        await writePrepared(cwd, [replacement]);
        successor = replacement.parsed;
    } finally {
        await release();
    }
    const projection = await projectFreshCanonicalRecords(cwd, [successor.attrs.recordId], options.mnemotecaPort);
    return {
        record: projection.records?.[0] || successor,
        ...(projection.warning ? { indexWarning: projection.warning } : {}),
    };
}

export interface WorkRecordSupersessionProposalDecisionOptions {
    successorRecordId: string;
    predecessorRecordId: string;
    mnemotecaPort: WorkRecordMnemotecaPort;
}

export function confirmWorkRecordSupersessionProposal(
    cwd: string,
    options: WorkRecordSupersessionProposalDecisionOptions,
) {
    return confirmWorkRecordSupersession(cwd, {
        successorRecordId: options.successorRecordId,
        predecessorRecordIds: [options.predecessorRecordId],
        mnemotecaPort: options.mnemotecaPort,
    });
}

export function rejectWorkRecordSupersessionProposal(
    cwd: string,
    options: WorkRecordSupersessionProposalDecisionOptions,
) {
    return rejectWorkRecordSupersession(cwd, {
        successorRecordId: options.successorRecordId,
        predecessorRecordIds: [options.predecessorRecordId],
        mnemotecaPort: options.mnemotecaPort,
    });
}

export const listPendingWorkRecordSupersessionProposals = listWorkRecordSupersessionProposals;
