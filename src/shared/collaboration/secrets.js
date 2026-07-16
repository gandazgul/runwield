/** @module shared/collaboration/secrets */

import { dirname, join } from "@std/path";
import { redactCapabilityValue, redactSecrets } from "./capabilities.js";
import { assertRecord, normalizeLocalSecretRecord } from "./protocol.js";

export const SECRET_STORE_SCHEMA_VERSION = 1;
export const PROJECT_SECRET_STORE_RELATIVE_PATH = ".wld/collaboration-secrets.json";

/**
 * @param {string} planId
 * @param {string} spaceId
 * @returns {string}
 */
export function secretRecordKey(planId, spaceId) {
    return `${planId}:${spaceId}`;
}

/**
 * @typedef {Object} SecretStoreDocument
 * @property {number} schemaVersion
 * @property {Record<string, import("./protocol.js").LocalSecretRecord>} records
 */

/**
 * @param {string} [homeDir]
 * @returns {string}
 */
export function getGlobalSecretStorePath(homeDir = Deno.env.get("HOME") ?? "") {
    return join(homeDir, ".wld", "collaboration-secrets.json");
}

/**
 * @param {string} projectRoot
 * @returns {string}
 */
export function getProjectSecretStorePath(projectRoot) {
    return join(projectRoot, PROJECT_SECRET_STORE_RELATIVE_PATH);
}

/**
 * @param {string} path
 * @returns {Promise<SecretStoreDocument>}
 */
export async function readSecretStore(path) {
    try {
        const raw = await Deno.readTextFile(path);
        return normalizeSecretStore(JSON.parse(raw));
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return { schemaVersion: SECRET_STORE_SCHEMA_VERSION, records: {} };
        throw new Error(`Unable to read collaboration secret store: ${redactSecrets(error)}`);
    }
}

/**
 * @param {string} path
 * @param {SecretStoreDocument} document
 */
export async function writeSecretStore(path, document) {
    const normalized = normalizeSecretStore(document);
    await Deno.mkdir(dirname(path), { recursive: true });
    const tempPath = `${path}.${crypto.randomUUID()}.tmp`;
    const content = `${JSON.stringify(normalized, null, 2)}\n`;
    try {
        await Deno.writeTextFile(tempPath, content, { mode: 0o600 });
        try {
            await Deno.chmod(tempPath, 0o600);
        } catch { /* best effort */ }
        await Deno.rename(tempPath, path);
        try {
            await Deno.chmod(path, 0o600);
        } catch { /* best effort */ }
    } catch (error) {
        try {
            await Deno.remove(tempPath);
        } catch { /* ignore cleanup */ }
        throw new Error(`Unable to write collaboration secret store: ${redactSecrets(error)}`);
    }
}

/**
 * @param {string} path
 * @param {string} key
 * @param {import("./protocol.js").LocalSecretRecord} record
 */
export async function putSecretRecord(path, key, record) {
    const document = await readSecretStore(path);
    document.records[key] = normalizeLocalSecretRecord(record);
    await writeSecretStore(path, document);
}

/**
 * @param {string} path
 * @param {string} key
 * @returns {Promise<import("./protocol.js").LocalSecretRecord | undefined>}
 */
export async function getSecretRecord(path, key) {
    return (await readSecretStore(path)).records[key];
}

/**
 * @typedef {Object} PullSecretMatch
 * @property {string} path
 * @property {string} key
 * @property {import("./protocol.js").LocalSecretRecord} record
 */

/**
 * @param {import("./protocol.js").LocalSecretRecord} record
 * @param {string} planId
 * @param {string} spaceId
 * @returns {boolean}
 */
function isCompatibleSecretRecord(record, planId, spaceId) {
    const normalized = normalizeLocalSecretRecord(record);
    if (normalized.planId && normalized.planId !== planId) return false;
    if (normalized.spaceId && normalized.spaceId !== spaceId) return false;
    return true;
}

/**
 * @param {PullSecretMatch[]} matches
 * @param {import("./protocol.js").LocalSecretRecord} [expected]
 */
function assertCompatiblePullSecretMatches(matches, expected) {
    const normalizedExpected = expected ? normalizeLocalSecretRecord(expected) : undefined;
    const records = normalizedExpected
        ? [...matches.map((match) => ({ label: `${match.path}:${match.key}`, record: match.record })), {
            label: "incoming maintainer URL",
            record: normalizedExpected,
        }]
        : matches.map((match) => ({ label: `${match.path}:${match.key}`, record: match.record }));
    for (const field of ["contentKey", "maintainerCapability"]) {
        const baseline = records.find((entry) =>
            /** @type {Record<string, string | undefined>} */ (entry.record)[field]
        );
        if (!baseline) continue;
        const expectedValue = /** @type {Record<string, string | undefined>} */ (baseline.record)[field];
        for (const entry of records) {
            const actualValue = /** @type {Record<string, string | undefined>} */ (entry.record)[field];
            if (expectedValue && actualValue && expectedValue !== actualValue) {
                throw new Error(
                    `Conflicting collaboration secret record for ${field}; refusing to choose between ${baseline.label} and ${entry.label}.`,
                );
            }
        }
    }
}

/**
 * @param {string[]} paths
 * @param {string} planId
 * @param {string} spaceId
 * @returns {Promise<PullSecretMatch[]>}
 */
async function collectPullSecretMatches(paths, planId, spaceId) {
    const keys = [secretRecordKey(planId, spaceId), planId];
    const documents = [];
    for (const path of paths) {
        documents.push({ path, document: await readSecretStore(path) });
    }
    const matches = /** @type {PullSecretMatch[]} */ ([]);
    for (const key of keys) {
        for (const { path, document } of documents) {
            const record = document.records[key];
            if (record) matches.push({ path, key, record });
        }
    }
    return matches;
}

/**
 * @param {string[]} paths
 * @param {string} planId
 * @param {string} spaceId
 * @param {import("./protocol.js").LocalSecretRecord} expected
 */
export async function assertCompatiblePullSecretRecord(paths, planId, spaceId, expected) {
    const matches = await collectPullSecretMatches(paths, planId, spaceId);
    assertCompatiblePullSecretMatches(matches, expected);
}

/**
 * @param {string[]} paths
 * @param {string} planId
 * @param {string} spaceId
 * @returns {Promise<PullSecretMatch | null>}
 */
export async function resolvePullSecretRecord(paths, planId, spaceId) {
    const matches = await collectPullSecretMatches(paths, planId, spaceId);
    assertCompatiblePullSecretMatches(matches);
    return matches[0] || null;
}

/**
 * Resolve only records that are either explicitly bound to the requested Shared
 * Space or legacy records with no stored spaceId. Records for another Shared
 * Space are ignored instead of being used for authorization.
 *
 * @param {string[]} paths
 * @param {string} planId
 * @param {string} spaceId
 * @returns {Promise<PullSecretMatch | null>}
 */
export async function resolveCompatibleSecretRecord(paths, planId, spaceId) {
    const matches = (await collectPullSecretMatches(paths, planId, spaceId)).filter((match) =>
        isCompatibleSecretRecord(match.record, planId, spaceId)
    );
    assertCompatiblePullSecretMatches(matches);
    return matches[0] || null;
}

/**
 * @param {string} path
 * @param {string} key
 * @param {import("./protocol.js").LocalSecretRecord} record
 */
export async function putCompatibleSecretRecord(path, key, record) {
    const existing = await getSecretRecord(path, key);
    const normalized = normalizeLocalSecretRecord(record);
    if (existing) {
        for (const field of ["contentKey", "maintainerCapability", "reviewerCapability"]) {
            const oldValue = /** @type {Record<string, string | undefined>} */ (existing)[field];
            const newValue = /** @type {Record<string, string | undefined>} */ (normalized)[field];
            if (oldValue && newValue && oldValue !== newValue) {
                throw new Error(`Conflicting collaboration secret record for ${key}; refusing to replace ${field}.`);
            }
        }
    }
    await putSecretRecord(path, key, { ...existing, ...normalized });
}

/**
 * @param {string} path
 * @param {string} key
 */
export async function deleteSecretRecord(path, key) {
    const document = await readSecretStore(path);
    if (!Object.hasOwn(document.records, key)) return;
    delete document.records[key];
    await writeSecretStore(path, document);
}

/**
 * @typedef {Object} DeletedSecretRecord
 * @property {string} path
 * @property {string} key
 */

/**
 * Delete local secret records for the given Plan/Shared Space pair from all
 * provided stores. Legacy planId-only records are deleted only when they are
 * not bound to a different Shared Space.
 *
 * @param {string[]} paths
 * @param {string} planId
 * @param {string} spaceId
 * @returns {Promise<DeletedSecretRecord[]>}
 */
export async function deleteCompatibleSecretRecords(paths, planId, spaceId) {
    const keys = [secretRecordKey(planId, spaceId), planId];
    const deleted = /** @type {DeletedSecretRecord[]} */ ([]);
    for (const path of paths) {
        const document = await readSecretStore(path);
        let changed = false;
        for (const key of keys) {
            const record = document.records[key];
            if (!record || !isCompatibleSecretRecord(record, planId, spaceId)) continue;
            delete document.records[key];
            deleted.push({ path, key });
            changed = true;
        }
        if (changed) await writeSecretStore(path, document);
    }
    return deleted;
}

/**
 * @param {unknown} value
 * @returns {SecretStoreDocument}
 */
export function normalizeSecretStore(value) {
    const record = assertRecord(value, "Secret store");
    if (record.schemaVersion !== SECRET_STORE_SCHEMA_VERSION) {
        throw new Error(`Unsupported collaboration secret store schema version: ${String(record.schemaVersion)}`);
    }
    const records = assertRecord(record.records, "Secret store records");
    /** @type {Record<string, import("./protocol.js").LocalSecretRecord>} */
    const normalizedRecords = {};
    for (const [key, secretRecord] of Object.entries(records)) {
        normalizedRecords[key] = normalizeLocalSecretRecord(secretRecord);
    }
    return { schemaVersion: SECRET_STORE_SCHEMA_VERSION, records: normalizedRecords };
}

/**
 * @param {string} projectRoot
 */
export async function ensureProjectSecretStoreIgnored(projectRoot) {
    const gitignorePath = join(projectRoot, ".gitignore");
    await Deno.mkdir(projectRoot, { recursive: true });
    await Deno.mkdir(join(projectRoot, ".wld"), { recursive: true });
    let existing = "";
    try {
        existing = await Deno.readTextFile(gitignorePath);
    } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    const lines = existing.split(/\r?\n/).map((line) => line.trim());
    if (lines.includes(PROJECT_SECRET_STORE_RELATIVE_PATH)) return;
    const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
    await Deno.writeTextFile(gitignorePath, `${existing}${separator}${PROJECT_SECRET_STORE_RELATIVE_PATH}\n`);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function redactSecretStoreValue(value) {
    return redactSecrets(JSON.stringify(redactSecretStoreFields(value)));
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function redactSecretStoreFields(value) {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map((item) => redactSecretStoreFields(item));
    /** @type {Record<string, unknown>} */
    const redacted = {};
    for (const [key, fieldValue] of Object.entries(value)) {
        if (key === "contentKey" || key === "reviewerCapability" || key === "maintainerCapability") {
            redacted[key] = redactCapabilityValue(typeof fieldValue === "string" ? fieldValue : "");
        } else {
            redacted[key] = redactSecretStoreFields(fieldValue);
        }
    }
    return redacted;
}
