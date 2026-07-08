/**
 * @module acp/interaction-mapper
 * Maps SessionRuntime interaction requests to ACP client elicitation requests.
 */

import { methods } from "@agentclientprotocol/sdk";
import {
    isApprovalAcceptedValue,
    RuntimeInteractionOutcomes,
    RuntimeInteractionTypes,
} from "../shared/session/session-runtime-interactions.js";

/** @param {unknown} capabilities */
function supportsFormElicitation(capabilities) {
    const value = /** @type {any} */ (capabilities || {});
    return Boolean(value.elicitation?.form);
}

/**
 * @param {{ request?: Function, client?: { request?: Function } }} context
 * @param {string} method
 * @param {unknown} params
 */
function requestClient(context, method, params) {
    if (typeof context.request === "function") return context.request(method, params);
    if (context.client && typeof context.client.request === "function") return context.client.request(method, params);
    return Promise.resolve({ action: "cancel" });
}

/**
 * @param {import('../shared/session/session-runtime-interactions.js').RuntimeInteractionRequest} interaction
 */
function buildSchema(interaction) {
    if (interaction.type === RuntimeInteractionTypes.SELECT || interaction.type === RuntimeInteractionTypes.APPROVAL) {
        const oneOf = (interaction.options || []).map((option) => ({ const: option.value, title: option.label }));
        return {
            type: "object",
            title: interaction.prompt,
            properties: {
                answer: {
                    type: "string",
                    title: "Answer",
                    ...(oneOf.length ? { oneOf } : {}),
                },
            },
            required: ["answer"],
        };
    }
    return {
        type: "object",
        title: interaction.prompt,
        properties: {
            answer: {
                type: "string",
                title: "Answer",
                ...(interaction.defaultValue ? { default: interaction.defaultValue } : {}),
                ...(interaction.placeholder ? { description: interaction.placeholder } : {}),
            },
        },
        required: interaction.allowEmpty ? [] : ["answer"],
    };
}

/**
 * @param {{ context: any, acpSessionId: string, clientCapabilities?: unknown }} options
 * @returns {import('../shared/session/session-runtime-interactions.js').RuntimeInteractionAdapter}
 */
export function createAcpInteractionAdapter({ context, acpSessionId, clientCapabilities }) {
    return {
        async requestInteraction(interaction) {
            if (!supportsFormElicitation(clientCapabilities)) {
                return {
                    outcome: RuntimeInteractionOutcomes.UNSUPPORTED,
                    message: "ACP client does not advertise form elicitation support.",
                };
            }
            if (
                interaction.type !== RuntimeInteractionTypes.SELECT &&
                interaction.type !== RuntimeInteractionTypes.TEXT &&
                interaction.type !== RuntimeInteractionTypes.APPROVAL
            ) {
                return {
                    outcome: RuntimeInteractionOutcomes.UNSUPPORTED,
                    message: `ACP interaction type is unsupported: ${interaction.type}`,
                };
            }
            const response = await requestClient(context, methods.client.elicitation.create, {
                mode: "form",
                sessionId: acpSessionId,
                message: interaction.prompt,
                requestedSchema: buildSchema(interaction),
                _meta: { runwield: { interactionId: interaction.id, interactionType: interaction.type } },
            });
            const action = response?.action;
            if (action === "cancel" || action === "decline") {
                return { outcome: RuntimeInteractionOutcomes.CANCELED, message: `ACP elicitation ${action}.` };
            }
            if (action !== "accept") {
                return {
                    outcome: RuntimeInteractionOutcomes.UNSUPPORTED,
                    message: "ACP elicitation returned no answer.",
                };
            }
            const value = response?.content?.answer;
            if (interaction.type === RuntimeInteractionTypes.TEXT) {
                return {
                    outcome: RuntimeInteractionOutcomes.TEXT,
                    value: typeof value === "undefined" ? "" : String(value),
                };
            }
            const valueText = typeof value === "undefined" ? "" : String(value);
            const option = (interaction.options || []).find((item) => item.value === valueText);
            if ((interaction.options || []).length && !option) {
                return {
                    outcome: RuntimeInteractionOutcomes.UNSUPPORTED,
                    message: `ACP elicitation returned invalid option: ${valueText}`,
                };
            }
            if (interaction.type === RuntimeInteractionTypes.APPROVAL) {
                if (!isApprovalAcceptedValue(interaction, valueText)) {
                    return {
                        outcome: RuntimeInteractionOutcomes.CANCELED,
                        value: false,
                        valueLabel: option?.label || valueText,
                        message: "Approval was not accepted.",
                    };
                }
                return {
                    outcome: RuntimeInteractionOutcomes.ACCEPTED,
                    value: true,
                };
            }
            return {
                outcome: RuntimeInteractionOutcomes.SELECTED,
                value: valueText,
                valueLabel: option?.label || valueText,
            };
        },
    };
}
