/**
 * @module shared/work-records/schema
 * Canonical Work Record schema constants and JSDoc typedefs.
 */

export const WORK_RECORD_KIND = "work_record";

export const WORK_RECORD_STATUSES = Object.freeze([
    "pending_verification",
    "draft",
    "approved",
    "superseded",
]);

export const WORK_RECORD_SCOPES = Object.freeze(["feature", "epic", "quick_fix"]);
export const WORK_RECORD_ORIGINS = Object.freeze(["internal", "external"]);
export const WORK_RECORD_COMPLETION_MODES = Object.freeze([
    "verified",
    "closed_without_verification",
    "done_enough",
]);

export const WORK_RECORD_OPTIONAL_SECTION_TITLES = Object.freeze([
    "Deviations from Plan",
    "Deferred Work",
    "Future Planning Notes",
]);

export const WORK_RECORD_FRONT_MATTER_KEYS = Object.freeze({
    kind: "kind",
    recordId: "recordId",
    status: "status",
    scope: "scope",
    origin: "origin",
    completionMode: "completionMode",
    createdAt: "createdAt",
    archivedAt: "archivedAt",
    supersedes: "supersedes",
    supersededBy: "supersededBy",
    provenance: "provenance",
});

export const WORK_RECORD_FRONT_MATTER_KEY_ORDER = Object.freeze(Object.values(WORK_RECORD_FRONT_MATTER_KEYS));

/**
 * @typedef {Object} WorkRecordEvidence
 * @property {string} path
 * @property {string} note
 */

/**
 * @typedef {Object} WorkRecordProvenance
 * @property {string[]} [sourcePlans]
 * @property {WorkRecordEvidence[]} [evidence]
 */

/**
 * @typedef {Object} WorkRecordFrontMatter
 * @property {"work_record"} kind
 * @property {string} recordId
 * @property {"pending_verification"|"draft"|"approved"|"superseded"} status
 * @property {"feature"|"epic"|"quick_fix"} scope
 * @property {"internal"|"external"} origin
 * @property {"verified"|"closed_without_verification"|"done_enough"} completionMode
 * @property {string} createdAt
 * @property {string} [archivedAt]
 * @property {string|string[]} [supersedes]
 * @property {string} [supersededBy]
 * @property {WorkRecordProvenance} [provenance]
 */

/**
 * @typedef {Object} WorkRecordSections
 * @property {string} title
 * @property {string} summary
 * @property {Record<string, string>} optional
 */

/**
 * @typedef {Object} WorkRecordResource
 * @property {WorkRecordFrontMatter} attrs
 * @property {string} body
 * @property {string} markdown
 * @property {string} title
 * @property {string} summary
 * @property {Record<string, string>} sections
 * @property {string} path
 * @property {string} relativePath
 */

/** @param {unknown} value */
export function isWorkRecordStatus(value) {
    return typeof value === "string" && WORK_RECORD_STATUSES.includes(/** @type {any} */ (value));
}

/** @param {unknown} value */
export function isWorkRecordScope(value) {
    return typeof value === "string" && WORK_RECORD_SCOPES.includes(/** @type {any} */ (value));
}

/** @param {unknown} value */
export function isWorkRecordOrigin(value) {
    return typeof value === "string" && WORK_RECORD_ORIGINS.includes(/** @type {any} */ (value));
}

/** @param {unknown} value */
export function isWorkRecordCompletionMode(value) {
    return typeof value === "string" && WORK_RECORD_COMPLETION_MODES.includes(/** @type {any} */ (value));
}
