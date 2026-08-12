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
    if (typeof supersededBy !== "string" || !supersededBy.trim()) {
        throw new Error("supersededBy must be a non-blank string to supersede a Work Record.");
    }
    const id = supersededBy.trim();
    if (id.toLowerCase() === attrs.recordId.toLowerCase()) throw new Error("A Work Record cannot supersede itself.");
    if (attrs.supersededBy && attrs.supersededBy.toLowerCase() !== id.toLowerCase()) {
        throw new Error(`Work Record ${attrs.recordId} is already superseded by ${attrs.supersededBy}.`);
    }
    return {
        ...attrs,
        status: /** @type {const} */ ("superseded"),
        supersededBy: attrs.supersededBy || id,
    };
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
