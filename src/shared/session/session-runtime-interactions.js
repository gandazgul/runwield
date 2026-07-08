/**
 * @module shared/session/session-runtime-interactions
 * Adapter-neutral interaction broker for HostedSession-bound prompts.
 */

export const RuntimeInteractionTypes = Object.freeze({
    SELECT: "select",
    TEXT: "text",
    APPROVAL: "approval",
    LINK: "link",
});

export const RuntimeInteractionOutcomes = Object.freeze({
    SELECTED: "selected",
    TEXT: "text",
    ACCEPTED: "accepted",
    CANCELED: "canceled",
    UNSUPPORTED: "unsupported",
    BLOCKED: "blocked",
});

/**
 * @typedef {Object} RuntimeInteractionOption
 * @property {string} value
 * @property {string} label
 * @property {string} [description]
 * @property {Record<string, unknown>} [_meta]
 */

/**
 * @typedef {Object} RuntimeInteractionRequest
 * @property {string} [id]
 * @property {"select"|"text"|"approval"|"link"} type
 * @property {string} prompt
 * @property {RuntimeInteractionOption[]} [options]
 * @property {string} [defaultValue]
 * @property {string} [placeholder]
 * @property {boolean} [allowEmpty]
 * @property {string} [toolCallId]
 * @property {Record<string, unknown>} [_meta]
 */

/**
 * @typedef {Object} RuntimeInteractionResponse
 * @property {"selected"|"text"|"accepted"|"canceled"|"unsupported"|"blocked"} outcome
 * @property {string|boolean} [value]
 * @property {string} [valueLabel]
 * @property {string} [message]
 * @property {Record<string, unknown>} [_meta]
 */

/**
 * @typedef {Object} RuntimeInteractionAdapter
 * @property {(request: RuntimeInteractionRequest, signal?: AbortSignal) => Promise<RuntimeInteractionResponse>|RuntimeInteractionResponse} requestInteraction
 * @property {() => void} [cancelAll]
 */

/**
 * @typedef {Object} RuntimeInteractionAdapterMeta
 * @property {"tui"|"acp"|string} kind
 * @property {Record<string, unknown>} [capabilities]
 * @property {string} [acpSessionId]
 */

/** @param {unknown} value */
function isAbortError(value) {
    return value instanceof DOMException && value.name === "AbortError";
}

/** @returns {string} */
export function createInteractionId() {
    return crypto.randomUUID();
}

/**
 * @param {Partial<RuntimeInteractionResponse>|undefined|null} response
 * @returns {RuntimeInteractionResponse}
 */
export function normalizeInteractionResponse(response) {
    if (!response || typeof response !== "object") {
        return {
            outcome: RuntimeInteractionOutcomes.UNSUPPORTED,
            message: "Interaction adapter returned no response.",
        };
    }
    const outcome = response.outcome;
    if (Object.values(RuntimeInteractionOutcomes).includes(/** @type {any} */ (outcome))) {
        return /** @type {RuntimeInteractionResponse} */ ({ ...response, outcome });
    }
    return {
        outcome: RuntimeInteractionOutcomes.UNSUPPORTED,
        message: `Unsupported interaction outcome: ${String(outcome)}`,
    };
}

/**
 * @param {unknown} error
 * @returns {RuntimeInteractionResponse}
 */
export function interactionErrorToResponse(error) {
    if (isAbortError(error)) return { outcome: RuntimeInteractionOutcomes.CANCELED, message: "Interaction canceled." };
    const message = error instanceof Error ? error.message : String(error || "Interaction failed.");
    return { outcome: RuntimeInteractionOutcomes.UNSUPPORTED, message };
}

/**
 * @param {RuntimeInteractionRequest} request
 * @param {string} value
 * @returns {boolean}
 */
export function isApprovalAcceptedValue(request, value) {
    const options = request.options || [];
    const option = options.find((item) => item.value === value);
    if (option?._meta?.accepted === true || option?._meta?.approvalOutcome === "accepted") return true;
    if (option?._meta?.accepted === false || option?._meta?.approvalOutcome === "declined") return false;
    const acceptedValues = [
        "accept",
        "accepted",
        "approve",
        "approved",
        "yes",
        "true",
        "proceed",
        "continue",
        "confirm",
        "ok",
    ];
    const normalizedValue = value.toLowerCase();
    const normalizedLabel = String(option?.label || "").toLowerCase();
    return acceptedValues.includes(normalizedValue) || acceptedValues.includes(normalizedLabel);
}

/**
 * @param {import('./hosted-session.js').HostedSession} hostedSession
 * @param {RuntimeInteractionRequest} request
 * @param {AbortSignal} [signal]
 * @returns {Promise<RuntimeInteractionResponse>}
 */
export async function requestHostedSessionInteraction(hostedSession, request, signal) {
    const id = request.id || createInteractionId();
    const interaction = { ...request, id };
    const adapter = hostedSession.getInteractionAdapter?.();
    if (!adapter || typeof adapter.requestInteraction !== "function") {
        return {
            outcome: RuntimeInteractionOutcomes.UNSUPPORTED,
            message: "No interaction adapter is available for this session.",
        };
    }
    const abortController = new AbortController();
    /** @type {(() => void) | null} */
    let removeAbortListener = null;
    if (signal) {
        const abort = () => abortController.abort();
        signal.addEventListener("abort", abort, { once: true });
        removeAbortListener = () => signal.removeEventListener("abort", abort);
    }
    hostedSession.addActiveInteraction?.(id, { request: interaction, abortController });
    try {
        if (signal?.aborted || abortController.signal.aborted) {
            return { outcome: RuntimeInteractionOutcomes.CANCELED, message: "Interaction canceled." };
        }
        const canceled = new Promise((resolve) => {
            abortController.signal.addEventListener(
                "abort",
                () => resolve({ outcome: RuntimeInteractionOutcomes.CANCELED, message: "Interaction canceled." }),
                { once: true },
            );
        });
        const response = await Promise.race([
            adapter.requestInteraction(interaction, abortController.signal),
            canceled,
        ]);
        return normalizeInteractionResponse(/** @type {Partial<RuntimeInteractionResponse>} */ (response));
    } catch (error) {
        return interactionErrorToResponse(error);
    } finally {
        removeAbortListener?.();
        hostedSession.removeActiveInteraction?.(id);
    }
}

/**
 * @param {import('../../ui/tui/types.js').UiAPI} uiAPI
 * @returns {RuntimeInteractionAdapter}
 */
export function createUiPromptInteractionAdapter(uiAPI) {
    return {
        async requestInteraction(request) {
            if (request.type === RuntimeInteractionTypes.SELECT || request.type === RuntimeInteractionTypes.APPROVAL) {
                if (!uiAPI?.promptSelect) {
                    return {
                        outcome: RuntimeInteractionOutcomes.UNSUPPORTED,
                        message: "Select prompts are unsupported.",
                    };
                }
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
                    return {
                        outcome: RuntimeInteractionOutcomes.ACCEPTED,
                        value: true,
                    };
                }
                return {
                    outcome: RuntimeInteractionOutcomes.SELECTED,
                    value,
                    valueLabel: option?.label || String(value),
                };
            }
            if (request.type === RuntimeInteractionTypes.TEXT) {
                if (!uiAPI?.promptText) {
                    return {
                        outcome: RuntimeInteractionOutcomes.UNSUPPORTED,
                        message: "Text prompts are unsupported.",
                    };
                }
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
            uiAPI?.abortActivePrompt?.();
        },
    };
}
