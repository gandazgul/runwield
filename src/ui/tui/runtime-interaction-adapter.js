/**
 * @module ui/tui/runtime-interaction-adapter
 * TUI implementation of the adapter-neutral SessionRuntime interaction port.
 */

import {
    isApprovalAcceptedValue,
    RuntimeInteractionOutcomes,
    RuntimeInteractionTypes,
} from "../../shared/session/session-runtime-interactions.js";

/**
 * @param {import('./types.js').UiAPI} uiAPI
 * @returns {import('../../shared/session/session-runtime-interactions.js').RuntimeInteractionAdapter}
 */
export function createTuiInteractionAdapter(uiAPI) {
    return {
        async requestInteraction(request) {
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
