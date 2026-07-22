/**
 * @module shared/workflow/plan-approval
 * Approval-intent contract shared by Plan Review transport and workflow routing.
 */

export const PLAN_APPROVAL_ACTIONS = Object.freeze({
    RUN: "run",
    DECOMPOSE: "decompose",
    LATER: "later",
});

/**
 * @typedef {typeof PLAN_APPROVAL_ACTIONS[keyof typeof PLAN_APPROVAL_ACTIONS]} PlanApprovalAction
 */

/**
 * @param {unknown} classification
 * @returns {"PROJECT"|"FEATURE"|""}
 */
function normalizePlanClassification(classification) {
    const value = String(classification || "").trim().replace(/^['\"]|['\"]$/g, "").toUpperCase();
    if (value === "PROJECT") return "PROJECT";
    if (value === "FEATURE") return "FEATURE";
    return "";
}

/**
 * @param {unknown} action
 * @returns {string}
 */
function normalizeActionValue(action) {
    return String(action || "").trim().toLowerCase();
}

/**
 * Return the immediate approval action for a Plan Classification.
 *
 * @param {unknown} classification
 * @returns {PlanApprovalAction}
 */
export function primaryPlanApprovalActionForClassification(classification) {
    return normalizePlanClassification(classification) === "PROJECT"
        ? PLAN_APPROVAL_ACTIONS.DECOMPOSE
        : PLAN_APPROVAL_ACTIONS.RUN;
}

/**
 * Safely normalize a browser approval action against trusted Plan Classification.
 * Missing, unknown, or classification-incompatible values intentionally become
 * `later` so approval never grants accidental immediate execution/decomposition.
 *
 * @param {{ classification?: unknown, action?: unknown }} opts
 * @returns {PlanApprovalAction}
 */
export function normalizePlanApprovalAction({ classification, action }) {
    const planClassification = normalizePlanClassification(classification);
    const requestedAction = normalizeActionValue(action);

    if (requestedAction === PLAN_APPROVAL_ACTIONS.LATER) return PLAN_APPROVAL_ACTIONS.LATER;
    if (planClassification === "PROJECT" && requestedAction === PLAN_APPROVAL_ACTIONS.DECOMPOSE) {
        return PLAN_APPROVAL_ACTIONS.DECOMPOSE;
    }
    if (planClassification === "FEATURE" && requestedAction === PLAN_APPROVAL_ACTIONS.RUN) {
        return PLAN_APPROVAL_ACTIONS.RUN;
    }
    return PLAN_APPROVAL_ACTIONS.LATER;
}

/**
 * @param {unknown} action
 * @returns {PlanApprovalAction | undefined}
 */
export function readPlanApprovalAction(action) {
    const requestedAction = normalizeActionValue(action);
    if (Object.values(PLAN_APPROVAL_ACTIONS).includes(/** @type {PlanApprovalAction} */ (requestedAction))) {
        return /** @type {PlanApprovalAction} */ (requestedAction);
    }
    return undefined;
}
