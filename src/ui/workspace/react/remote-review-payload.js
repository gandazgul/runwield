/**
 * Helpers for the remote Shared Space browser review payload.
 *
 * Plannotator's pinned source is not available in every Workspace worktree, and its Viewer stack currently imports
 * local review/editor/AI concerns. This remote review MVP therefore copies the narrow annotation concepts into small
 * RunWield-owned helpers while keeping the encrypted payload shape compatible with later pull/push flows.
 */

/**
 * @typedef {Object} RemoteCommentAnchor
 * @property {string} blockId
 * @property {number} startOffset
 * @property {number} endOffset
 * @property {string} [prefix]
 * @property {string} [suffix]
 */

/**
 * @typedef {Object} RemoteCommentPayload
 * @property {1} schemaVersion
 * @property {"comment" | "global_comment"} type
 * @property {string} displayName
 * @property {string} body
 * @property {string} originalText
 * @property {RemoteCommentAnchor | null} anchor
 * @property {string} createdAt
 */

/**
 * @param {unknown} value
 * @returns {RemoteCommentPayload}
 */
export function normalizeRemoteCommentPayload(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Comment payload must be an object.");
    }
    const record = /** @type {Record<string, unknown>} */ (value);
    if (record.schemaVersion !== 1) throw new Error("Unsupported comment payload version.");
    if (record.type !== "comment" && record.type !== "global_comment") {
        throw new Error("Comment payload type must be comment or global_comment.");
    }
    const body = nonEmpty(record.body, "body");
    return {
        schemaVersion: 1,
        type: record.type,
        displayName: nonEmpty(record.displayName, "displayName"),
        body,
        originalText: typeof record.originalText === "string" ? record.originalText : "",
        anchor: record.type === "comment" ? normalizeAnchor(record.anchor) : null,
        createdAt: nonEmpty(record.createdAt, "createdAt"),
    };
}

/**
 * @param {{ displayName: string, body: string, selection?: (RemoteCommentAnchor & { originalText: string }) | null }} input
 * @returns {RemoteCommentPayload}
 */
export function buildRemoteCommentPayload(input) {
    const selection = input.selection ?? null;
    return normalizeRemoteCommentPayload({
        schemaVersion: 1,
        type: selection ? "comment" : "global_comment",
        displayName: input.displayName,
        body: input.body,
        originalText: selection?.originalText ?? "",
        anchor: selection
            ? {
                blockId: selection.blockId,
                startOffset: selection.startOffset,
                endOffset: selection.endOffset,
                prefix: selection.prefix,
                suffix: selection.suffix,
            }
            : null,
        createdAt: new Date().toISOString(),
    });
}

/**
 * @param {unknown} value
 * @returns {RemoteCommentAnchor}
 */
function normalizeAnchor(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Comment anchor is required.");
    const record = /** @type {Record<string, unknown>} */ (value);
    const startOffset = positiveOffset(record.startOffset, "startOffset");
    const endOffset = positiveOffset(record.endOffset, "endOffset");
    if (endOffset <= startOffset) throw new Error("Comment anchor endOffset must be after startOffset.");
    return {
        blockId: nonEmpty(record.blockId, "blockId"),
        startOffset,
        endOffset,
        prefix: typeof record.prefix === "string" ? record.prefix : undefined,
        suffix: typeof record.suffix === "string" ? record.suffix : undefined,
    };
}

/** @param {unknown} value @param {string} name */
function nonEmpty(value, name) {
    if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} must be a non-empty string.`);
    return value.trim();
}

/** @param {unknown} value @param {string} name */
function positiveOffset(value, name) {
    if (!Number.isInteger(value) || /** @type {number} */ (value) < 0) {
        throw new Error(`${name} must be a non-negative integer.`);
    }
    return /** @type {number} */ (value);
}
