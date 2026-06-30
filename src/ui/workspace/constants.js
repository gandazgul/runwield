/**
 * Workspace-specific constants.
 * These are safe for both server and client environments.
 */

/** Query parameter accepted for bootstrapping Workspace access. */
export const PLAN_UI_TOKEN_QUERY = "token";

/** Header accepted by Workspace mutation API endpoints. */
export const PLAN_UI_TOKEN_HEADER = "x-runwield-workspace-token";

/** @type {{ MOVE_STATUS: "move_status", CLOSE_WITHOUT_VERIFICATION: "close_without_verification", PUT_ON_HOLD: "put_on_hold", RESUME_FROM_HOLD: "resume_from_hold", RESET_TO_DRAFT: "reset_to_draft" }} */
export const PLAN_LIFECYCLE_ACTIONS = {
    MOVE_STATUS: "move_status",
    CLOSE_WITHOUT_VERIFICATION: "close_without_verification",
    PUT_ON_HOLD: "put_on_hold",
    RESUME_FROM_HOLD: "resume_from_hold",
    RESET_TO_DRAFT: "reset_to_draft",
};

/**
 * @param {string} planId
 * @returns {string}
 */
export function lifecycleActionApiPath(planId) {
    return `/api/plans/${encodeURIComponent(planId)}/lifecycle-action`;
}
