/**
 * Helpers for the remote Shared Space browser review payload.
 *
 * Remote APIs store this payload only after content-key encryption. The helper
 * shape intentionally mirrors Plannotator's annotation metadata so the browser
 * can render/restore annotations while `wld plans pull` still receives the
 * stable remote review fields it already understands.
 */

/**
 * @typedef {Object} RemoteSelectionMeta
 * @property {string} parentTagName
 * @property {number} parentIndex
 * @property {number} textOffset
 */

/**
 * @typedef {Object} RemoteCommentAnchor
 * @property {string} blockId
 * @property {number} startOffset
 * @property {number} endOffset
 * @property {string} [prefix]
 * @property {string} [suffix]
 * @property {RemoteSelectionMeta} [startMeta]
 * @property {RemoteSelectionMeta} [endMeta]
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
 * @typedef {Object} RemoteCommentRecord
 * @property {string} id
 * @property {boolean} resolved
 * @property {string} createdAt
 * @property {boolean} [unreadable]
 * @property {boolean} [anchorMissing]
 * @property {"comment" | "global_comment"} type
 * @property {string} displayName
 * @property {string} body
 * @property {string} originalText
 * @property {RemoteCommentAnchor | null} anchor
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
 * @param {{
 *   displayName: string,
 *   body?: string,
 *   selection?: (RemoteCommentAnchor & { originalText: string }) | null,
 *   annotation?: Record<string, unknown> | null,
 * }} input
 * @returns {RemoteCommentPayload}
 */
export function buildRemoteCommentPayload(input) {
    const annotation = input.annotation ?? null;
    if (annotation) {
        const type = annotation.type === "GLOBAL_COMMENT" ? "global_comment" : "comment";
        const originalText = typeof annotation.originalText === "string" ? annotation.originalText : "";
        return normalizeRemoteCommentPayload({
            schemaVersion: 1,
            type,
            displayName: input.displayName,
            body: typeof input.body === "string" ? input.body : String(annotation.text || ""),
            originalText,
            anchor: type === "comment"
                ? {
                    blockId: annotation.blockId,
                    startOffset: annotation.startOffset,
                    endOffset: annotation.endOffset,
                    startMeta: annotation.startMeta,
                    endMeta: annotation.endMeta,
                }
                : null,
            createdAt: new Date(typeof annotation.createdA === "number" ? annotation.createdA : Date.now())
                .toISOString(),
        });
    }

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
                startMeta: selection.startMeta,
                endMeta: selection.endMeta,
            }
            : null,
        createdAt: new Date().toISOString(),
    });
}

/**
 * @param {RemoteCommentRecord} comment
 * @returns {Record<string, unknown>}
 */
export function remoteCommentToPlannotatorAnnotation(comment) {
    const createdA = Date.parse(comment.createdAt || "");
    const anchor = comment.anchor || null;
    const legacyInlineAnchor = comment.type === "comment" && anchor && (!anchor.startMeta || !anchor.endMeta);
    return {
        id: comment.id,
        blockId: legacyInlineAnchor ? `__missing_legacy_anchor_${comment.id}` : anchor?.blockId || "",
        startOffset: legacyInlineAnchor ? 0 : anchor?.startOffset || 0,
        endOffset: legacyInlineAnchor ? Math.max(1, comment.originalText.length) : anchor?.endOffset ||
            Math.max(0, comment.originalText.length),
        type: comment.type === "global_comment" ? "GLOBAL_COMMENT" : "COMMENT",
        text: comment.unreadable ? "Unreadable encrypted comment." : comment.body,
        originalText: comment.originalText || "",
        createdA: Number.isFinite(createdA) ? createdA : Date.now(),
        author: comment.displayName || (comment.unreadable ? "Unreadable comment" : "Reviewer"),
        startMeta: legacyInlineAnchor ? undefined : anchor?.startMeta,
        endMeta: legacyInlineAnchor ? undefined : anchor?.endMeta,
    };
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
        startMeta: normalizeSelectionMeta(record.startMeta),
        endMeta: normalizeSelectionMeta(record.endMeta),
    };
}

/** @param {unknown} value @returns {RemoteSelectionMeta | undefined} */
function normalizeSelectionMeta(value) {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "object" || Array.isArray(value)) throw new Error("Selection metadata must be an object.");
    const record = /** @type {Record<string, unknown>} */ (value);
    return {
        parentTagName: nonEmpty(record.parentTagName, "parentTagName"),
        parentIndex: positiveOffset(record.parentIndex, "parentIndex"),
        textOffset: positiveOffset(record.textOffset, "textOffset"),
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
