/** @module shared/collaboration/protocol */

import { assertCapabilityScope } from "./capabilities.js";

/**
 * @typedef {Object} SharedSpaceMetadata
 * @property {string} spaceId
 * @property {string} planId
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {number} latestRevision
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
    return {
        spaceId: assertNonEmptyString(record.spaceId, "spaceId"),
        planId: assertNonEmptyString(record.planId, "planId"),
        createdAt: assertNonEmptyString(record.createdAt, "createdAt"),
        updatedAt: assertNonEmptyString(record.updatedAt, "updatedAt"),
        latestRevision: assertPositiveInteger(record.latestRevision, "latestRevision"),
    };
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
 * @returns {EncryptedPlanPayload}
 */
export function normalizeEncryptedPlanPayload(value) {
    const record = assertRecord(value, "Encrypted plan payload");
    return {
        planId: assertNonEmptyString(record.planId, "planId"),
        title: assertNonEmptyString(record.title, "title"),
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
