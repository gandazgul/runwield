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

const MAX_PAIR_PROMPT_VALUE_LENGTH = 500;
const MAX_PAIR_EVIDENCE_ITEMS = 8;

/**
 * @param {unknown} value
 * @returns {string}
 */
function formatPairPromptValue(value) {
    if (typeof value !== "string" && typeof value !== "number") return "";
    const text = String(value).trim();
    if (text.length <= MAX_PAIR_PROMPT_VALUE_LENGTH) return text;
    return `${text.slice(0, MAX_PAIR_PROMPT_VALUE_LENGTH - 3)}...`;
}

/**
 * @param {import('./types.js').UiAPI} uiAPI
 * @param {TuiInteractionDependencies} [dependencies]
 * @returns {import('../../shared/session/session-runtime-interactions.js').RuntimeInteractionAdapter}
 */
export function createTuiInteractionAdapter(uiAPI, dependencies = {}) {
    const submitPlanReview = dependencies.submitPlanForReview || submitPlanForReview;
    const submitCodeReview = dependencies.runCodeReview || runCodeReview;
    return {
        supportsInteraction(type) {
            return type === RuntimeInteractionTypes.PAIR_CHECKPOINT;
        },
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
            if (request.type === RuntimeInteractionTypes.PAIR_CHECKPOINT) {
                const meta = /** @type {any} */ (request._meta || {});
                const rawEvidence = Array.isArray(meta.evidence) ? meta.evidence : [];
                const evidenceItems = rawEvidence.map(formatPairPromptValue).filter(Boolean).slice(
                    0,
                    MAX_PAIR_EVIDENCE_ITEMS,
                );
                const evidence = evidenceItems.length
                    ? `Evidence: ${evidenceItems.join(", ")}${
                        rawEvidence.length > MAX_PAIR_EVIDENCE_ITEMS
                            ? ` (+${rawEvidence.length - MAX_PAIR_EVIDENCE_ITEMS} more)`
                            : ""
                    }`
                    : "";
                const checkpointNumber = Number.isInteger(meta.checkpointNumber) && meta.checkpointNumber > 0
                    ? meta.checkpointNumber
                    : null;
                const route = formatPairPromptValue(meta.route);
                const state = formatPairPromptValue(meta.state);
                const viewport = formatPairPromptValue(meta.viewport);
                const diagnostics = formatPairPromptValue(meta.diagnostics);
                const nextIncrement = formatPairPromptValue(meta.nextIncrement);
                const context = [
                    checkpointNumber && `Checkpoint: ${checkpointNumber}`,
                    route && `Route: ${route}`,
                    state && `State: ${state}`,
                    viewport && `Viewport: ${viewport}`,
                ].filter(Boolean).join(" | ");
                const prompt = [
                    "Pair checkpoint",
                    formatPairPromptValue(request.prompt),
                    context,
                    evidence,
                    diagnostics && `Diagnostics: ${diagnostics}`,
                    nextIncrement && `Next: ${nextIncrement}`,
                ].filter(Boolean).join("\n");
                const options = [
                    { value: "continue", label: "Continue to the next increment" },
                    { value: "revise", label: "Revise this increment" },
                    { value: "autonomous", label: "Finish autonomously" },
                    { value: "stop", label: "Stop and keep the Plan in progress" },
                ];
                const value = await uiAPI.promptSelect(prompt, options);
                if (value === null) return { outcome: RuntimeInteractionOutcomes.CANCELED };
                const option = options.find((item) => item.value === value);
                if (!option) {
                    return {
                        outcome: RuntimeInteractionOutcomes.UNSUPPORTED,
                        message: `Pair checkpoint prompt returned invalid option: ${value}`,
                    };
                }
                if (value !== "revise") return { outcome: RuntimeInteractionOutcomes.SELECTED, value };
                const feedback = await uiAPI.promptText("Revision feedback for this Pair checkpoint", {
                    placeholder: "Describe what should change in this increment",
                    allowEmpty: false,
                });
                if (feedback === null || !feedback.trim()) return { outcome: RuntimeInteractionOutcomes.CANCELED };
                return { outcome: RuntimeInteractionOutcomes.SELECTED, value, _meta: { feedback } };
            }
            if (request.type === RuntimeInteractionTypes.PLAN_REVIEW) {
                const meta = /** @type {any} */ (request._meta || {});
                const result = await submitPlanReview({
                    cwd: meta.cwd,
                    planName: meta.planName,
                    planPath: meta.planPath,
                    triageMeta: meta.triageMeta,
                    onOutput: typeof meta.onOutput === "function" ? meta.onOutput : undefined,
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
                    planContent: meta.planContent,
                    planAttrs: meta.planAttrs,
                    executionCwd: meta.executionCwd,
                    guidedReview: meta.guidedReview,
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
