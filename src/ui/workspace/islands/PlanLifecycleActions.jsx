import { useState } from "react";
import {
    lifecycleActionApiPath,
    PLAN_LIFECYCLE_ACTIONS,
    PLAN_UI_TOKEN_HEADER,
    PLAN_UI_TOKEN_QUERY,
} from "../constants.js";

/**
 * @typedef {Object} PlanLifecycleActionIntent
 * @property {string} planId
 * @property {"move_status"|"close_without_verification"|"put_on_hold"|"resume_from_hold"|"reset_to_draft"} action
 * @property {string} [fromStatus]
 * @property {string} [targetStatus]
 * @property {string} [holdReason]
 * @property {boolean} [acceptResumeWarnings]
 */

/**
 * @typedef {Object} MoveStatusIntentOptions
 * @property {string} planId
 * @property {string} fromStatus
 * @property {string} toStatus
 */

/**
 * @typedef {Object} PutOnHoldIntentOptions
 * @property {string} planId
 * @property {string} fromStatus
 * @property {?string} holdReason
 */

/**
 * @typedef {Object} LifecycleActionMeta
 * @property {string} label
 */

/**
 * @typedef {Object} LifecycleActions
 * @property {Record<string, LifecycleActionMeta>} [metadata]
 */

/**
 * @param {MoveStatusIntentOptions} opts
 * @returns {PlanLifecycleActionIntent}
 */
export function createMoveStatusIntent({ planId, fromStatus, toStatus }) {
    return { planId, fromStatus, action: PLAN_LIFECYCLE_ACTIONS.MOVE_STATUS, targetStatus: toStatus };
}

/**
 * @param {PutOnHoldIntentOptions} opts
 * @returns {?PlanLifecycleActionIntent}
 */
export function createPutOnHoldIntent({ planId, fromStatus, holdReason }) {
    if (holdReason === null) return null;
    return { planId, fromStatus, action: PLAN_LIFECYCLE_ACTIONS.PUT_ON_HOLD, holdReason };
}

/**
 * @param {LifecycleActions} actions
 * @param {string} action
 * @returns {string}
 */
export function lifecycleActionLabel(actions, action) {
    return String(actions.metadata?.[action]?.label || action.replaceAll("_", " "));
}

/**
 * @param {PlanLifecycleActionIntent} intent
 */
export async function dispatchPlanLifecycleAction(intent) {
    const url = new URL(location.href);
    const token = url.searchParams.get(PLAN_UI_TOKEN_QUERY) || "";
    const response = await fetch(lifecycleActionApiPath(intent.planId), {
        method: "POST",
        headers: {
            "content-type": "application/json",
            ...(token ? { [PLAN_UI_TOKEN_HEADER]: token } : {}),
        },
        body: JSON.stringify(intent),
    });
    const payload = await response.json();
    return { response, payload };
}

/**
 * @param {{
 *   plan: any,
 *   compact?: boolean,
 *   epic?: boolean,
 *   showStatusMoves?: boolean,
 *   showPutOnHold?: boolean,
 *   putOnHoldOnly?: boolean,
 * }} props
 */
export function PlanLifecycleActions({
    plan,
    compact = false,
    epic = false,
    showStatusMoves = true,
    showPutOnHold = true,
    putOnHoldOnly = false,
}) {
    const actions = plan.actions || {};
    const [pending, setPending] = useState(false);
    const [message, setMessage] = useState("");
    const [warningIntent, setWarningIntent] = useState(/** @type {PlanLifecycleActionIntent | null} */ (null));
    const disabled = pending;

    /** @param {PlanLifecycleActionIntent} intent */
    async function submit(intent) {
        setPending(true);
        setMessage("");
        try {
            const { response, payload } = await dispatchPlanLifecycleAction(intent);
            if (response.status === 409 && payload.requiresConfirmation) {
                setWarningIntent({ ...intent, acceptResumeWarnings: true });
                setMessage(
                    `${payload.error || "Resume Check needs confirmation."} ${
                        (payload.resumeCheck?.warnings || []).join(" ")
                    }`,
                );
                return;
            }
            if (!response.ok) {
                setMessage(payload.blockedReason || payload.error || "Lifecycle action was blocked.");
                return;
            }
            setMessage(payload.message || "Lifecycle action applied.");
            location.reload();
        } finally {
            setPending(false);
        }
    }

    function hold() {
        const promptText = epic
            ? "Optional hold reason for this Epic. Child Plan statuses will not be changed."
            : "Optional hold reason for this Plan.";
        const intent = createPutOnHoldIntent({
            planId: plan.planId,
            fromStatus: plan.status,
            holdReason: prompt(promptText, plan.holdReason || ""),
        });
        if (intent) submit(intent);
    }

    const putOnHoldLabel = lifecycleActionLabel(actions, PLAN_LIFECYCLE_ACTIONS.PUT_ON_HOLD);
    const closeWithoutVerificationLabel = lifecycleActionLabel(
        actions,
        PLAN_LIFECYCLE_ACTIONS.CLOSE_WITHOUT_VERIFICATION,
    );
    const resumeFromHoldLabel = lifecycleActionLabel(actions, PLAN_LIFECYCLE_ACTIONS.RESUME_FROM_HOLD);
    const resetToDraftLabel = lifecycleActionLabel(actions, PLAN_LIFECYCLE_ACTIONS.RESET_TO_DRAFT);

    const canShowPutOnHold = showPutOnHold && actions.canPutOnHold;
    const canShowCloseWithoutVerification = !putOnHoldOnly && actions.canCloseWithoutVerification;
    const canShowResumeFromHold = !putOnHoldOnly && actions.canResumeFromHold;
    const canShowResetToDraft = !putOnHoldOnly && actions.canResetToDraft;
    const hasStatusMoveControls = !putOnHoldOnly && showStatusMoves && actions.manualTargetOptions?.length;
    const hasPrimaryControls = hasStatusMoveControls || canShowCloseWithoutVerification ||
        canShowPutOnHold || canShowResumeFromHold || canShowResetToDraft;

    if (putOnHoldOnly && !canShowPutOnHold) return null;

    return (
        <section
            className={`${compact ? "lifecycle-actions compact" : "lifecycle-actions"}${
                putOnHoldOnly ? " hold-action-only" : ""
            }`}
            data-plan-id={plan.planId}
        >
            {actions.terminalMessage ? <p className="terminal-message">{actions.terminalMessage}</p> : null}
            {plan.status === "on_hold" ? <p className="hold-message">{actions.holdMessage}</p> : null}
            {hasPrimaryControls
                ? (
                    <div className="lifecycle-action-list" aria-label="Plan lifecycle actions">
                        {showStatusMoves
                            ? actions.manualTargetOptions?.map(/** @param {any} target */ (target) => (
                                <button
                                    key={target.status}
                                    type="button"
                                    className="secondary-action lifecycle-action"
                                    disabled={disabled}
                                    data-action="move_status"
                                    data-action-target-status={target.status}
                                    onClick={() =>
                                        submit(createMoveStatusIntent({
                                            planId: plan.planId,
                                            fromStatus: plan.status,
                                            toStatus: target.status,
                                        }))}
                                >
                                    Move to {target.label}
                                </button>
                            ))
                            : null}
                        {canShowPutOnHold
                            ? (
                                <button
                                    type="button"
                                    className="secondary-action lifecycle-action hold-action"
                                    disabled={disabled}
                                    onClick={hold}
                                >
                                    {putOnHoldLabel}
                                </button>
                            )
                            : null}
                        {canShowCloseWithoutVerification
                            ? (
                                <button
                                    type="button"
                                    className="danger-action lifecycle-action"
                                    disabled={disabled}
                                    onClick={() =>
                                        confirm(`${closeWithoutVerificationLabel}?`) && submit({
                                            planId: plan.planId,
                                            action: PLAN_LIFECYCLE_ACTIONS.CLOSE_WITHOUT_VERIFICATION,
                                            fromStatus: plan.status,
                                        })}
                                >
                                    {closeWithoutVerificationLabel}
                                </button>
                            )
                            : null}
                        {canShowResumeFromHold
                            ? (
                                <button
                                    type="button"
                                    disabled={disabled}
                                    className="primary-action"
                                    onClick={() =>
                                        submit({
                                            planId: plan.planId,
                                            action: PLAN_LIFECYCLE_ACTIONS.RESUME_FROM_HOLD,
                                            fromStatus: plan.status,
                                        })}
                                >
                                    {resumeFromHoldLabel}
                                </button>
                            )
                            : null}
                        {canShowResetToDraft
                            ? (
                                <button
                                    type="button"
                                    className="secondary-action lifecycle-action"
                                    disabled={disabled}
                                    onClick={() =>
                                        confirm(`${resetToDraftLabel}?`) && submit({
                                            planId: plan.planId,
                                            action: PLAN_LIFECYCLE_ACTIONS.RESET_TO_DRAFT,
                                            fromStatus: plan.status,
                                        })}
                                >
                                    {resetToDraftLabel}
                                </button>
                            )
                            : null}
                    </div>
                )
                : null}
            {warningIntent
                ? (
                    <div className="notice warning resume-warning">
                        <button type="button" disabled={disabled} onClick={() => submit(warningIntent)}>
                            Accept Resume Check warnings and {resumeFromHoldLabel}
                        </button>
                    </div>
                )
                : null}
            {message ? <p className="notice lifecycle-message">{message}</p> : null}
            {pending ? <p className="notice muted">Applying lifecycle action…</p> : null}
        </section>
    );
}

export default PlanLifecycleActions;
