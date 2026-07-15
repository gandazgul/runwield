/** @module shared/collaboration/protocol */

import { assertCapabilityScope } from "./capabilities.js";

/**
 * @typedef {Object} SharedSpaceMetadata
 * @property {string} spaceId
 * @property {string} planId
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {number} latestRevision
 * @property {"open" | "closed"} [status]
 * @property {string} [closedAt]
 */

/**
 * @typedef {Object} CreateSharedSpacePayload
 * @property {string} planId
 * @property {{ payloadCiphertext: string }} initialRevision
 * @property {CapabilityRecord[]} capabilities
 */

/**
 * @typedef {Object} AppendRevisionPayload
 * @property {string} payloadCiphertext
 * @property {number} [expectedRevision]
 */

/**
 * @typedef {Object} AppendCommentPayload
 * @property {string} ciphertext
 */

/**
 * @typedef {Object} RevisionMetadata
 * @property {string} spaceId
 * @property {number} revision
 * @property {string} createdAt
 * @property {string} payloadCiphertext
 */

/**
 * @typedef {Object} EncryptedPlanPayload
 * @property {string} planId
 * @property {string} title
 * @property {Record<string, unknown>} metadata
 * @property {string} body
 */

/**
 * @typedef {Object} EncryptedCommentRecord
 * @property {string} id
 * @property {string} spaceId
 * @property {string} ciphertext
 * @property {string} createdAt
 * @property {boolean} resolved
 */

/**
 * @typedef {Object} DecryptedReviewCommentPayload
 * @property {number} schemaVersion
 * @property {"comment" | "global_comment"} type
 * @property {string} displayName
 * @property {string} body
 * @property {string} [originalText]
 * @property {Record<string, unknown> | null} [anchor]
 * @property {string} [createdAt]
 */

/**
 * @typedef {Object} CapabilityRecord
 * @property {"reviewer" | "maintainer"} scope
 * @property {string} capabilityHash
 */

/**
 * @typedef {Object} CommentStateChangePayload
 * @property {string} commentId
 * @property {"resolve" | "reopen"} action
 */

/**
 * @typedef {Object} SharedSpaceLifecyclePayload
 * @property {string} spaceId
 * @property {"close" | "delete"} action
 */

/**
 * @typedef {Object} ApiErrorPayload
 * @property {string} error
 * @property {string} message
 * @property {number} [status]
 */

/**
 * @typedef {Object} LocalSecretRecord
 * @property {string} planId
 * @property {string} [spaceId]
 * @property {string} contentKey
 * @property {string} [reviewerCapability]
 * @property {string} [maintainerCapability]
 * @property {string} updatedAt
 */

/**
 * @param {unknown} value
 * @param {string} name
 * @returns {string}
 */
export function assertNonEmptyString(value, name) {
    if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} must be a non-empty string`);
    return value.trim();
}

/**
 * @param {unknown} value
 * @param {string} name
 * @returns {number}
 */
export function assertPositiveInteger(value, name) {
    if (!Number.isInteger(value) || /** @type {number} */ (value) < 1) {
        throw new Error(`${name} must be a positive integer`);
    }
    return /** @type {number} */ (value);
}

/**
 * @param {unknown} value
 * @returns {SharedSpaceMetadata}
 */
export function normalizeSharedSpaceMetadata(value) {
    const record = assertRecord(value, "Shared space metadata");
    /** @type {SharedSpaceMetadata} */
    const normalized = {
        spaceId: assertNonEmptyString(record.spaceId, "spaceId"),
        planId: assertNonEmptyString(record.planId, "planId"),
        createdAt: assertNonEmptyString(record.createdAt, "createdAt"),
        updatedAt: assertNonEmptyString(record.updatedAt, "updatedAt"),
        latestRevision: assertPositiveInteger(record.latestRevision, "latestRevision"),
    };
    if (record.status !== undefined) {
        if (record.status !== "open" && record.status !== "closed") throw new Error("status must be open or closed");
        normalized.status = record.status;
    }
    if (record.closedAt !== undefined) normalized.closedAt = assertNonEmptyString(record.closedAt, "closedAt");
    return normalized;
}

/**
 * @param {unknown} value
 * @returns {RevisionMetadata}
 */
export function normalizeRevisionMetadata(value) {
    const record = assertRecord(value, "Revision metadata");
    return {
        spaceId: assertNonEmptyString(record.spaceId, "spaceId"),
        revision: assertPositiveInteger(record.revision, "revision"),
        createdAt: assertNonEmptyString(record.createdAt, "createdAt"),
        payloadCiphertext: assertNonEmptyString(record.payloadCiphertext, "payloadCiphertext"),
    };
}

/**
 * @param {unknown} value
 * @returns {CapabilityRecord}
 */
export function normalizeCapabilityRecord(value) {
    const record = assertRecord(value, "Capability record");
    return {
        scope: assertCapabilityScope(record.scope),
        capabilityHash: assertNonEmptyString(record.capabilityHash, "capabilityHash"),
    };
}

/**
 * @param {unknown} value
 * @returns {CreateSharedSpacePayload}
 */
export function normalizeCreateSharedSpacePayload(value) {
    const record = assertRecord(value, "Create Shared Space payload");
    rejectPlaintextFields(record);
    const initialRevision = assertRecord(record.initialRevision, "initialRevision");
    rejectPlaintextFields(initialRevision);
    const capabilities = Array.isArray(record.capabilities) ? record.capabilities.map(normalizeCapabilityRecord) : [];
    if (capabilities.length === 0) throw new Error("capabilities must include reviewer and maintainer hashes");
    return {
        planId: assertNonEmptyString(record.planId, "planId"),
        initialRevision: {
            payloadCiphertext: assertNonEmptyString(initialRevision.payloadCiphertext, "payloadCiphertext"),
        },
        capabilities,
    };
}

/**
 * @param {unknown} value
 * @returns {AppendRevisionPayload}
 */
export function normalizeAppendRevisionPayload(value) {
    const record = assertRecord(value, "Append revision payload");
    rejectPlaintextFields(record);
    /** @type {AppendRevisionPayload} */
    const normalized = { payloadCiphertext: assertNonEmptyString(record.payloadCiphertext, "payloadCiphertext") };
    if (record.expectedRevision !== undefined) {
        normalized.expectedRevision = assertPositiveInteger(record.expectedRevision, "expectedRevision");
    }
    return normalized;
}

/**
 * @param {unknown} value
 * @returns {AppendCommentPayload}
 */
export function normalizeAppendCommentPayload(value) {
    const record = assertRecord(value, "Append comment payload");
    rejectPlaintextFields(record);
    return { ciphertext: assertNonEmptyString(record.ciphertext, "ciphertext") };
}

/**
 * @param {unknown} value
 * @returns {EncryptedPlanPayload}
 */
export function normalizeEncryptedPlanPayload(value) {
    const record = assertRecord(value, "Encrypted plan payload");
    return {
        planId: assertNonEmptyString(record.planId, "planId"),
        title: assertNonEmptyString(record.title, "title"),
        metadata: { ...assertRecord(record.metadata, "metadata") },
        body: assertNonEmptyString(record.body, "body"),
    };
}

/**
 * @param {unknown} value
 * @returns {EncryptedCommentRecord}
 */
export function normalizeEncryptedCommentRecord(value) {
    const record = assertRecord(value, "Encrypted comment record");
    if (typeof record.resolved !== "boolean") throw new Error("resolved must be a boolean");
    return {
        id: assertNonEmptyString(record.id, "id"),
        spaceId: assertNonEmptyString(record.spaceId, "spaceId"),
        ciphertext: assertNonEmptyString(record.ciphertext, "ciphertext"),
        createdAt: assertNonEmptyString(record.createdAt, "createdAt"),
        resolved: record.resolved,
    };
}

/**
 * @param {unknown} value
 * @returns {DecryptedReviewCommentPayload}
 */
export function normalizeDecryptedReviewCommentPayload(value) {
    const record = assertRecord(value, "Decrypted review comment payload");
    if (record.schemaVersion !== 1) throw new Error("Review comment schemaVersion must be 1");
    if (record.type !== "comment" && record.type !== "global_comment") {
        throw new Error("Review comment type must be comment or global_comment");
    }
    /** @type {DecryptedReviewCommentPayload} */
    const normalized = {
        schemaVersion: 1,
        type: record.type,
        displayName: assertNonEmptyString(record.displayName, "displayName"),
        body: assertNonEmptyString(record.body, "body"),
    };
    if (record.originalText !== undefined) {
        if (typeof record.originalText !== "string") throw new Error("originalText must be a string");
        normalized.originalText = record.originalText;
    }
    if (record.anchor !== undefined && record.anchor !== null) {
        normalized.anchor = { ...assertRecord(record.anchor, "anchor") };
    }
    if (record.createdAt !== undefined) normalized.createdAt = assertNonEmptyString(record.createdAt, "createdAt");
    return normalized;
}

/**
 * @param {unknown} value
 * @returns {CommentStateChangePayload}
 */
export function normalizeCommentStateChangePayload(value) {
    const record = assertRecord(value, "Comment state change payload");
    if (record.action !== "resolve" && record.action !== "reopen") {
        throw new Error("Comment action must be resolve or reopen");
    }
    return {
        commentId: assertNonEmptyString(record.commentId, "commentId"),
        action: record.action,
    };
}

/**
 * @param {unknown} value
 * @returns {SharedSpaceLifecyclePayload}
 */
export function normalizeSharedSpaceLifecyclePayload(value) {
    const record = assertRecord(value, "Shared space lifecycle payload");
    if (record.action !== "close" && record.action !== "delete") {
        throw new Error("Shared Space lifecycle action must be close or delete");
    }
    return {
        spaceId: assertNonEmptyString(record.spaceId, "spaceId"),
        action: record.action,
    };
}

/**
 * @param {unknown} value
 * @returns {ApiErrorPayload}
 */
export function normalizeApiErrorPayload(value) {
    const record = assertRecord(value, "API error payload");
    /** @type {ApiErrorPayload} */
    const normalized = {
        error: assertNonEmptyString(record.error, "error"),
        message: assertNonEmptyString(record.message, "message"),
    };
    if (record.status !== undefined) normalized.status = assertPositiveInteger(record.status, "status");
    return normalized;
}

/**
 * @param {unknown} value
 * @returns {LocalSecretRecord}
 */
export function normalizeLocalSecretRecord(value) {
    const record = assertRecord(value, "Local secret record");
    /** @type {LocalSecretRecord} */
    const normalized = {
        planId: assertNonEmptyString(record.planId, "planId"),
        contentKey: assertNonEmptyString(record.contentKey, "contentKey"),
        updatedAt: assertNonEmptyString(record.updatedAt, "updatedAt"),
    };
    if (record.spaceId !== undefined) normalized.spaceId = assertNonEmptyString(record.spaceId, "spaceId");
    if (record.reviewerCapability !== undefined) {
        normalized.reviewerCapability = assertNonEmptyString(record.reviewerCapability, "reviewerCapability");
    }
    if (record.maintainerCapability !== undefined) {
        normalized.maintainerCapability = assertNonEmptyString(record.maintainerCapability, "maintainerCapability");
    }
    return normalized;
}

/**
 * @param {unknown} value
 * @param {string} name
 * @returns {Record<string, any>}
 */
export function assertRecord(value, name) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
    return /** @type {Record<string, any>} */ (value);
}

const PLAINTEXT_FIELD_NAMES = new Set([
    "body",
    "author",
    "authorName",
    "displayName",
    "originalText",
    "context",
    "anchor",
    "anchors",
]);

/** @param {Record<string, any>} record */
function rejectPlaintextFields(record) {
    for (const key of Object.keys(record)) {
        if (PLAINTEXT_FIELD_NAMES.has(key)) throw new Error(`${key} must be encrypted inside ciphertext payloads`);
    }
}
