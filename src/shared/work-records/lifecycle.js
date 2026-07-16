/**
 * @module shared/work-records/lifecycle
 * V1 final-state-only Work Record lifecycle helpers.
 */

/** @param {Date | string} value */
function iso(value) {
    return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * @param {import('./schema.js').WorkRecordFrontMatter} attrs
 * @param {{ now?: Date | string }} [options]
 */
export function archiveWorkRecord(attrs, options = {}) {
    return { ...attrs, archivedAt: iso(options.now || new Date()) };
}

/** @param {import('./schema.js').WorkRecordFrontMatter} attrs */
export function restoreWorkRecord(attrs) {
    const next = { ...attrs };
    delete next.archivedAt;
    return next;
}

/**
 * @param {import('./schema.js').WorkRecordFrontMatter} attrs
 * @param {string} supersededBy
 */
export function supersedeWorkRecord(attrs, supersededBy) {
    const id = String(supersededBy || "").trim();
    if (!id) throw new Error("supersededBy is required to supersede a Work Record.");
    return { ...attrs, status: /** @type {const} */ ("superseded"), supersededBy: id };
}

/** @param {import('./schema.js').WorkRecordFrontMatter} attrs */
export function approveWorkRecord(attrs) {
    return { ...attrs, status: /** @type {const} */ ("approved") };
}

/** @param {import('./schema.js').WorkRecordFrontMatter} attrs */
export function markDraftWorkRecord(attrs) {
    return { ...attrs, status: /** @type {const} */ ("draft") };
}

/** @param {import('./schema.js').WorkRecordFrontMatter} attrs */
export function markPendingVerificationWorkRecord(attrs) {
    return { ...attrs, status: /** @type {const} */ ("pending_verification") };
}
