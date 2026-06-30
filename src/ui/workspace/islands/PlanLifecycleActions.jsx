import { useState } from "preact/hooks";
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

/** @param {{ plan: any, compact?: boolean, epic?: boolean }} props */
export function PlanLifecycleActions({ plan, compact = false, epic = false }) {
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

    const hasPrimaryControls = actions.manualTargetOptions?.length || actions.canCloseWithoutVerification ||
        actions.canPutOnHold || actions.canResumeFromHold || actions.canResetToDraft;

    return (
        <section class={compact ? "lifecycle-actions compact" : "lifecycle-actions"} data-plan-id={plan.planId}>
            {actions.terminalMessage ? <p class="terminal-message">{actions.terminalMessage}</p> : null}
            {plan.status === "on_hold" ? <p class="hold-message">{actions.holdMessage}</p> : null}
            {hasPrimaryControls
                ? (
                    <div class="lifecycle-action-list" aria-label="Plan lifecycle actions">
                        {actions.manualTargetOptions?.map(/** @param {any} target */ (target) => (
                            <button
                                type="button"
                                class="secondary-action lifecycle-action"
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
                        ))}
                        {actions.canPutOnHold
                            ? <button type="button" disabled={disabled} onClick={hold}>{putOnHoldLabel}</button>
                            : null}
                        {actions.canCloseWithoutVerification
                            ? (
                                <button
                                    type="button"
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
                        {actions.canResumeFromHold
                            ? (
                                <button
                                    type="button"
                                    disabled={disabled}
                                    class="primary-action"
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
                        {actions.canResetToDraft
                            ? (
                                <button
                                    type="button"
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
                    <div class="notice warning resume-warning">
                        <button type="button" disabled={disabled} onClick={() => submit(warningIntent)}>
                            Accept Resume Check warnings and {resumeFromHoldLabel}
                        </button>
                    </div>
                )
                : null}
            {message ? <p class="notice lifecycle-message">{message}</p> : null}
            {pending ? <p class="notice muted">Applying lifecycle action…</p> : null}
        </section>
    );
}

export default PlanLifecycleActions;
