/** Durable, content-free Project measurement journal. */
import { dirname, join } from "@std/path";
import lockfile from "proper-lockfile";

/**
 * @typedef {Object} JournalInvocation
 * @property {boolean} enabled
 * @property {string} epoch
 * @property {number} deadline
 *
 * @typedef {Object} JournalCoverageGap
 * @property {number} tornBytes
 * @property {number[]} corruptLines
 *
 * @typedef {Object} JournalPersistence
 * @property {boolean} persisted
 * @property {string} [reason]
 * @property {string} [eventId]
 * @property {string} [collectionEpoch]
 * @property {boolean} [collectionEnabledAtCall]
 * @property {JournalCoverageGap} [coverageGap]
 *
 * @typedef {Record<string, unknown> & JournalPersistence} JournalResult
 */

/** @param {unknown} setting */
export function isWorkflowMetricsEnabled(setting) {
    return setting === true || (setting !== null && typeof setting === "object" &&
        !Array.isArray(setting) && "enabled" in setting && setting.enabled === true);
}

/** Read the latest durable epoch, not a process-local settings cache.
 * @param {string} filePath
 */
export function resolveCollectionEpoch(filePath) {
    let diskState;
    try {
        diskState = JSON.parse(Deno.readTextFileSync(join(dirname(filePath), "state.json")));
    } catch (error) {
        if (!(error instanceof Deno.errors.NotFound) && !(error instanceof SyntaxError)) throw error;
    }
    const journalState = rebuildEpochState(filePath);
    return diskState?.v === 1 && diskState.collectionEpoch?.id === journalState.collectionEpoch.id &&
            diskState.collectionEpoch.enabled === journalState.collectionEpoch.enabled &&
            diskState.historyEpoch === journalState.historyEpoch
        ? diskState
        : journalState;
}

/** Rebuild the fast state from authoritative journal control records.
 * @param {string} filePath
 */
function rebuildEpochState(filePath) {
    let epoch = { id: "initial", enabled: false };
    let historyEpoch = "initial";
    try {
        for (const line of Deno.readTextFileSync(filePath).split("\n").slice(0, -1)) {
            try {
                const record = JSON.parse(line);
                if (typeof record.historyEpoch === "string") historyEpoch = record.historyEpoch;
                if (
                    record.event === "collection_epoch" && typeof record.collectionEpoch === "string" &&
                    typeof record.enabled === "boolean" && typeof record.historyEpoch === "string"
                ) {
                    epoch = { id: record.collectionEpoch, enabled: record.enabled };
                    historyEpoch = record.historyEpoch;
                }
            } catch { /* Corruption is reported by repairJournalTail under the lock. */ }
        }
    } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    return { v: 1, collectionEpoch: epoch, historyEpoch };
}

/** Truncate only an incomplete final line. Keep interior corruption as gap evidence.
 * @param {string} filePath
 * @param {string} historyEpoch
 */
export function repairJournalTail(filePath, historyEpoch) {
    let bytes;
    try {
        bytes = Deno.readFileSync(filePath);
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return { tornBytes: 0, corruptLines: [] };
        throw error;
    }
    const end = bytes.lastIndexOf(10) + 1;
    const tornBytes = bytes.length - end;
    const lines = new TextDecoder().decode(bytes.subarray(0, end)).split("\n");
    const corruptLines = [];
    for (let index = 0; index < lines.length - 1; index++) {
        try {
            JSON.parse(lines[index]);
        } catch {
            corruptLines.push(index + 1);
        }
    }
    if (tornBytes) {
        const gap = new TextEncoder().encode(
            JSON.stringify({
                v: 1,
                event: "measurement_gap",
                ts: new Date().toISOString(),
                reason: "incomplete_append",
                tornBytes,
                corruptLines,
                historyEpoch,
            }) + "\n",
        );
        const repaired = new Uint8Array(end + gap.length);
        repaired.set(bytes.subarray(0, end));
        repaired.set(gap, end);
        // Atomic replacement keeps either the torn evidence or its durable gap, even on process death.
        replaceSynced(filePath, repaired);
    }
    return { tornBytes, corruptLines };
}

/** @param {string} path @param {string | Uint8Array} text @param {boolean} [append] */
function writeSynced(path, text, append = false) {
    const file = Deno.openSync(path, { create: true, write: true, append, truncate: !append });
    try {
        const bytes = typeof text === "string" ? new TextEncoder().encode(text) : text;
        let offset = 0;
        while (offset < bytes.length) offset += file.writeSync(bytes.subarray(offset));
        file.syncSync();
    } finally {
        file.close();
    }
}

/** Atomic replacement also syncs the parent directory.
 * @param {string} path
 * @param {string | Uint8Array} content
 */
function replaceSynced(path, content) {
    const temporary = `${path}.${crypto.randomUUID()}.tmp`;
    try {
        writeSynced(temporary, content);
        Deno.renameSync(temporary, path);
        const parent = Deno.openSync(dirname(path), { read: true });
        try {
            parent.syncSync();
        } finally {
            parent.close();
        }
    } finally {
        try {
            Deno.removeSync(temporary);
        } catch { /* Already renamed. */ }
    }
}

/**
 * The observation and its epoch are captured once by the caller and reused on retry.
 * @param {string} filePath
 * @param {string} projectRoot
 * @param {Record<string, unknown>} record
 * @param {JournalInvocation} invocation
 * @returns {Promise<JournalResult>}
 */
export async function appendWorkflowMetric(filePath, projectRoot, record, invocation) {
    // Failure metadata lets an explicit retry retain its original boundary and identity.
    const failedRecord = { ...record, collectionEpoch: invocation.epoch, collectionEnabledAtCall: invocation.enabled };
    let release;
    let compromised = false;
    try {
        const { getMergedCustomSetting } = await import("../settings.js");
        // Do not create a journal for an opt-out installation.
        if (!invocation.enabled && invocation.epoch === "initial") {
            return { ...failedRecord, persisted: false, reason: "disabled" };
        }
        const directory = dirname(filePath);
        Deno.mkdirSync(directory, { recursive: true });
        const lockPath = join(directory, ".journal.lock");
        Deno.openSync(lockPath, { create: true, write: true }).close();
        while (!release) {
            if (Date.now() >= invocation.deadline) return { ...failedRecord, persisted: false, reason: "lock_timeout" };
            try {
                release = lockfile.lockSync(lockPath, {
                    realpath: false,
                    onCompromised: () => {
                        compromised = true;
                    },
                });
            } catch (error) {
                if (!(error && typeof error === "object" && "code" in error && error.code === "ELOCKED")) throw error;
                await new Promise((resolve) => setTimeout(resolve, Math.min(20, invocation.deadline - Date.now())));
            }
        }
        const enabled = isWorkflowMetricsEnabled(getMergedCustomSetting("workflowMetrics", projectRoot));
        const state = resolveCollectionEpoch(filePath);
        const entries = [];
        if (state.historyEpoch === "initial") state.historyEpoch = crypto.randomUUID();
        const repair = repairJournalTail(filePath, state.historyEpoch);
        if (!repair.tornBytes && repair.corruptLines.length) {
            entries.push({
                v: 1,
                event: "measurement_gap",
                ts: new Date().toISOString(),
                reason: "interior_corruption",
                ...repair,
                historyEpoch: state.historyEpoch,
            });
        }
        if (
            enabled !== state.collectionEpoch.enabled ||
            (state.collectionEpoch.id === "initial" && invocation.enabled && !enabled)
        ) {
            // The first observed enablement accepts observations from the empty history.
            state.collectionEpoch = {
                id: state.collectionEpoch.id === "initial" && enabled ? "initial-enabled" : crypto.randomUUID(),
                enabled,
            };
            entries.push({
                v: 1,
                event: "collection_epoch",
                ts: new Date().toISOString(),
                collectionEpoch: state.collectionEpoch.id,
                enabled,
                historyEpoch: state.historyEpoch,
            });
        }
        if (entries.length) {
            writeSynced(
                filePath,
                entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
                true,
            );
        }
        replaceSynced(join(directory, "state.json"), JSON.stringify(state) + "\n");
        if (compromised) return { ...failedRecord, persisted: false, reason: "lock_compromised" };
        if (!invocation.enabled || !enabled) return { ...failedRecord, persisted: false, reason: "disabled" };
        if (
            invocation.epoch !== state.collectionEpoch.id &&
            !(invocation.epoch === "initial" && state.collectionEpoch.id === "initial-enabled")
        ) {
            return { ...failedRecord, persisted: false, reason: "collection_boundary" };
        }
        const saved = { ...record, collectionEpoch: state.collectionEpoch.id, historyEpoch: state.historyEpoch };
        writeSynced(filePath, JSON.stringify(saved) + "\n", true);
        return {
            ...saved,
            persisted: true,
            ...(repair.tornBytes || repair.corruptLines.length ? { coverageGap: repair } : {}),
        };
    } catch {
        return { ...failedRecord, persisted: false, reason: "storage_failure" };
    } finally {
        try {
            release?.();
        } catch { /* Persistence result must not throw into delivery work. */ }
    }
}
