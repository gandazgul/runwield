/** @module shared/collaboration/lock */

import { redactSecrets } from "./capabilities.js";
import { normalizePlanServerUrl } from "../settings.js";

export const COLLABORATION_STATE_REMOTE_CANONICAL = "remote_canonical";

export const COLLABORATION_FRONT_MATTER_KEYS = Object.freeze({
    collaborationState: "collaborationState",
    collaborationServerUrl: "collaborationServerUrl",
    collaborationSpaceId: "collaborationSpaceId",
    collaborationRevision: "collaborationRevision",
    collaborationBodyHash: "collaborationBodyHash",
    collaborationSyncedAt: "collaborationSyncedAt",
});

export const COLLABORATION_LOCK_BYPASS = Object.freeze({
    share: Symbol("runwield.collaborationLockBypass.share"),
    pull: Symbol("runwield.collaborationLockBypass.pull"),
    push: Symbol("runwield.collaborationLockBypass.push"),
    unshare: Symbol("runwield.collaborationLockBypass.unshare"),
});

const VALID_BYPASSES = new Set(Object.values(COLLABORATION_LOCK_BYPASS));

export const SHARED_PLAN_LOCK_REPAIR =
    "Run `wld plans pull`, `wld plans push`, or `wld plans unshare` before editing this shared Plan locally.";

/**
 * @typedef {Object} CollaborationFrontMatter
 * @property {string} [collaborationState]
 * @property {string} [collaborationServerUrl]
 * @property {string} [collaborationSpaceId]
 * @property {number} [collaborationRevision]
 * @property {string} [collaborationBodyHash]
 * @property {string} [collaborationSyncedAt]
 */

/**
 * @typedef {Object} CollaborationWriteOptions
 * @property {symbol} [collaborationLockBypass]
 */

export class SharedPlanLockError extends Error {
    /**
     * @param {Partial<CollaborationFrontMatter>} attrs
     * @param {{ reason?: string, repair?: string }} [options]
     */
    constructor(attrs = {}, options = {}) {
        super(buildSharedPlanLockMessage(attrs, options.reason));
        this.name = "SharedPlanLockError";
        this.blockedReason = this.message;
        this.repair = options.repair || SHARED_PLAN_LOCK_REPAIR;
        this.collaboration = redactCollaborationMetadata(attrs);
    }
}

/**
 * @param {Partial<CollaborationFrontMatter>} attrs
 * @returns {Partial<CollaborationFrontMatter>}
 */
function redactCollaborationMetadata(attrs) {
    return {
        collaborationState: attrs.collaborationState,
        collaborationServerUrl: typeof attrs.collaborationServerUrl === "string"
            ? redactSecrets(attrs.collaborationServerUrl).replace(/#.*$/, "#[redacted]")
            : attrs.collaborationServerUrl,
        collaborationSpaceId: attrs.collaborationSpaceId,
        collaborationRevision: attrs.collaborationRevision,
        collaborationBodyHash: attrs.collaborationBodyHash,
        collaborationSyncedAt: attrs.collaborationSyncedAt,
    };
}

/**
 * @param {unknown} value
 * @returns {number | undefined}
 */
export function normalizeCollaborationRevision(value) {
    if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
    if (typeof value === "string" && /^[1-9]\d*$/.test(value.trim())) return Number(value.trim());
    return undefined;
}

/**
 * @param {unknown} value
 * @returns {string | undefined}
 */
function normalizeOptionalString(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * @param {Partial<CollaborationFrontMatter>} attrs
 * @returns {Partial<CollaborationFrontMatter>}
 */
export function normalizeCollaborationFrontMatter(attrs = {}) {
    /** @type {Partial<CollaborationFrontMatter>} */
    const normalized = {};
    if (attrs.collaborationState === COLLABORATION_STATE_REMOTE_CANONICAL) {
        normalized.collaborationState = COLLABORATION_STATE_REMOTE_CANONICAL;
    } else if (typeof attrs.collaborationState === "string" && attrs.collaborationState.trim()) {
        normalized.collaborationState = attrs.collaborationState.trim();
    }

    if (attrs.collaborationServerUrl !== undefined) {
        try {
            normalized.collaborationServerUrl = normalizePlanServerUrl(attrs.collaborationServerUrl);
        } catch {
            // Invalid URLs are intentionally omitted instead of preserved so Plan
            // front matter never stores fragments, query strings, share URLs, or
            // other secret-bearing URL material.
        }
    }
    normalized.collaborationSpaceId = normalizeOptionalString(attrs.collaborationSpaceId);
    normalized.collaborationRevision = normalizeCollaborationRevision(attrs.collaborationRevision);
    normalized.collaborationBodyHash = normalizeOptionalString(attrs.collaborationBodyHash);
    normalized.collaborationSyncedAt = normalizeOptionalString(attrs.collaborationSyncedAt);
    return normalized;
}

/**
 * @param {Partial<CollaborationFrontMatter>} attrs
 * @returns {boolean}
 */
export function isSharedPlanLocked(attrs = {}) {
    return attrs.collaborationState === COLLABORATION_STATE_REMOTE_CANONICAL;
}

/**
 * @param {unknown} bypass
 * @returns {boolean}
 */
export function isCollaborationLockBypass(bypass) {
    return VALID_BYPASSES.has(/** @type {symbol} */ (bypass));
}

/**
 * @param {Partial<CollaborationFrontMatter>} attrs
 * @returns {string[]}
 */
function collaborationMetadataProblems(attrs) {
    const problems = [];
    if (!normalizeOptionalString(attrs.collaborationServerUrl)) problems.push("missing collaborationServerUrl");
    if (!normalizeOptionalString(attrs.collaborationSpaceId)) problems.push("missing collaborationSpaceId");
    return problems;
}

/**
 * @param {Partial<CollaborationFrontMatter>} attrs
 * @param {string} [reason]
 * @returns {string}
 */
export function buildSharedPlanLockMessage(attrs = {}, reason) {
    const server = typeof attrs.collaborationServerUrl === "string"
        ? redactSecrets(attrs.collaborationServerUrl).replace(/#.*$/, "#[redacted]")
        : "unknown server";
    const space = typeof attrs.collaborationSpaceId === "string"
        ? redactSecrets(attrs.collaborationSpaceId)
        : "unknown space";
    const details = reason ? ` ${redactSecrets(reason)}` : "";
    return `This shared Plan is remote-canonical (${server}, space ${space}) and cannot be changed by normal RunWield writes.${details} ${SHARED_PLAN_LOCK_REPAIR}`;
}

/**
 * @param {Partial<CollaborationFrontMatter>} attrs
 * @param {CollaborationWriteOptions} [options]
 */
export function assertSharedPlanWriteAllowed(attrs = {}, options = {}) {
    if (!isSharedPlanLocked(attrs)) return;
    if (isCollaborationLockBypass(options.collaborationLockBypass)) return;
    const problems = collaborationMetadataProblems(attrs);
    const reason = problems.length ? `Repair collaboration metadata first: ${problems.join(", ")}.` : undefined;
    throw new SharedPlanLockError(attrs, { reason });
}
