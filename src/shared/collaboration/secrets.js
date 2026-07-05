/** @module shared/collaboration/secrets */

import { dirname, join } from "@std/path";
import { redactCapabilityValue, redactSecrets } from "./capabilities.js";
import { assertRecord, normalizeLocalSecretRecord } from "./protocol.js";

export const SECRET_STORE_SCHEMA_VERSION = 1;
export const PROJECT_SECRET_STORE_RELATIVE_PATH = ".wld/collaboration-secrets.json";

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
