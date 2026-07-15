/**
 * @module ui/tui/runtime-interaction-adapter
 * TUI implementation of the adapter-neutral SessionRuntime interaction port.
 */

import {
    isApprovalAcceptedValue,
    RuntimeInteractionOutcomes,
    RuntimeInteractionTypes,
} from "../../shared/session/session-runtime-interactions.js";
import { runCodeReview } from "../review/code-review.js";
import { submitPlanForReview } from "../review/plan-review.js";

/**
 * @typedef {Object} TuiInteractionDependencies
 * @property {typeof submitPlanForReview} [submitPlanForReview]
 * @property {typeof runCodeReview} [runCodeReview]
 */

/**
 * @param {import('./types.js').UiAPI} uiAPI
 * @param {TuiInteractionDependencies} [dependencies]
 * @returns {import('../../shared/session/session-runtime-interactions.js').RuntimeInteractionAdapter}
 */
export function createTuiInteractionAdapter(uiAPI, dependencies = {}) {
    const submitPlanReview = dependencies.submitPlanForReview || submitPlanForReview;
    const submitCodeReview = dependencies.runCodeReview || runCodeReview;
    return {
        async requestInteraction(request, signal) {
            if (request.type === RuntimeInteractionTypes.SELECT || request.type === RuntimeInteractionTypes.APPROVAL) {
                const value = await uiAPI.promptSelect(request.prompt, request.options || []);
                if (value === null) return { outcome: RuntimeInteractionOutcomes.CANCELED };
                const option = (request.options || []).find((item) => item.value === value);
                if ((request.options || []).length && !option) {
                    return {
                        outcome: RuntimeInteractionOutcomes.UNSUPPORTED,
                        message: `Select prompt returned invalid option: ${value}`,
                    };
                }
                if (request.type === RuntimeInteractionTypes.APPROVAL) {
                    if (!isApprovalAcceptedValue(request, value)) {
                        return {
                            outcome: RuntimeInteractionOutcomes.CANCELED,
                            value: false,
                            valueLabel: option?.label || String(value),
                            message: "Approval was not accepted.",
                        };
                    }
                    return { outcome: RuntimeInteractionOutcomes.ACCEPTED, value: true };
                }
                return {
                    outcome: RuntimeInteractionOutcomes.SELECTED,
                    value,
                    valueLabel: option?.label || String(value),
                };
            }
            if (request.type === RuntimeInteractionTypes.TEXT) {
                const value = await uiAPI.promptText(request.prompt, {
                    defaultValue: request.defaultValue,
                    placeholder: request.placeholder,
                    allowEmpty: request.allowEmpty,
                });
                if (value === null) return { outcome: RuntimeInteractionOutcomes.CANCELED };
                return { outcome: RuntimeInteractionOutcomes.TEXT, value };
            }
            if (request.type === RuntimeInteractionTypes.PLAN_REVIEW) {
                const meta = /** @type {any} */ (request._meta || {});
                const result = await submitPlanReview({
                    cwd: meta.cwd,
                    planName: meta.planName,
                    planPath: meta.planPath,
                    triageMeta: meta.triageMeta,
                    signal,
                });
                return {
                    outcome: result.canceled
                        ? RuntimeInteractionOutcomes.CANCELED
                        : result.approved
                        ? RuntimeInteractionOutcomes.ACCEPTED
                        : RuntimeInteractionOutcomes.SELECTED,
                    _meta: result,
                };
            }
            if (request.type === RuntimeInteractionTypes.CODE_REVIEW) {
                const meta = /** @type {any} */ (request._meta || {});
                const result = await submitCodeReview({
                    planName: meta.planName,
                    diffText: meta.diffText,
                    executionCwd: meta.executionCwd,
                    signal,
                });
                return {
                    outcome: result.canceled || result.exit
                        ? RuntimeInteractionOutcomes.CANCELED
                        : result.approved
                        ? RuntimeInteractionOutcomes.ACCEPTED
                        : RuntimeInteractionOutcomes.SELECTED,
                    _meta: result,
                };
            }
            return {
                outcome: RuntimeInteractionOutcomes.UNSUPPORTED,
                message: `Unsupported interaction type: ${request.type}`,
            };
        },
        cancelAll() {
            uiAPI.abortActivePrompt?.();
        },
    };
}
