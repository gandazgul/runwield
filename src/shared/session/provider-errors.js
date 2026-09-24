import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

const EOF_ERROR = /^unexpected eof\.?$/i;

/** @param {string} message */
function normalizeEof(message) {
    return EOF_ERROR.test(message.trim()) ? `Network error: ${message.trim()}` : message;
}

/**
 * Public provider-stream adapter. It changes only the diagnostic Pi uses to
 * classify a standalone EOF; Pi still owns every retry and backoff.
 *
 * @param {(model: import('@earendil-works/pi-ai').Model<import('@earendil-works/pi-ai').Api>, context: import('@earendil-works/pi-ai').TranscriptContext, options?: import('@earendil-works/pi-ai').SimpleStreamOptions) => import('@earendil-works/pi-ai').AssistantMessageEventStream | Promise<import('@earendil-works/pi-ai').AssistantMessageEventStream>} source
 * @param {import('@earendil-works/pi-ai').Model<import('@earendil-works/pi-ai').Api>} model
 * @param {import('@earendil-works/pi-ai').TranscriptContext} context
 * @param {import('@earendil-works/pi-ai').SimpleStreamOptions} [options]
 * @returns {import('@earendil-works/pi-ai').AssistantMessageEventStream}
 */
export function normalizeProviderStream(source, model, context, options) {
    const output = createAssistantMessageEventStream();
    // Start the provider synchronously: a deferred start can move steering and
    // cancellation across the request boundary.
    let initial;
    try {
        initial = source(model, context, options);
    } catch (error) {
        initial = Promise.reject(error);
    }
    (async () => {
        /** @type {import('@earendil-works/pi-ai').AssistantMessage | undefined} */
        let partial;
        try {
            const input = await initial;
            for await (const event of input) {
                if (event.type === "start" || "partial" in event) partial = event.partial;
                if (event.type === "error") {
                    const aborted = event.reason === "aborted" || options?.signal?.aborted;
                    const error = event.error;
                    const saved = partial && error.content.length === 0 && partial.content.length
                        ? {
                            ...error,
                            content: partial.content,
                            usage: error.usage.input || error.usage.output || error.usage.cacheRead ||
                                    error.usage.cacheWrite ||
                                    Object.values(error.usage.cost).some((value) => value !== 0)
                                ? error.usage
                                : partial.usage,
                        }
                        : error;
                    output.push({
                        ...event,
                        reason: aborted ? "aborted" : event.reason,
                        error: {
                            ...saved,
                            stopReason: aborted ? "aborted" : saved.stopReason,
                            errorMessage: aborted ? saved.errorMessage : normalizeEof(saved.errorMessage || ""),
                        },
                    });
                } else {
                    output.push(event);
                }
                if (event.type === "error" || event.type === "done") return;
            }
            throw new Error("Provider stream ended without a terminal response event");
        } catch (cause) {
            const message = cause instanceof Error ? cause.message : String(cause);
            const aborted = options?.signal?.aborted || (cause instanceof Error && cause.name === "AbortError");
            output.push({
                type: "error",
                reason: aborted ? "aborted" : "error",
                error: {
                    role: "assistant",
                    content: partial?.content || [],
                    api: model.api,
                    provider: model.provider,
                    model: model.id,
                    usage: partial?.usage || {
                        input: 0,
                        output: 0,
                        cacheRead: 0,
                        cacheWrite: 0,
                        totalTokens: 0,
                        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
                    },
                    stopReason: aborted ? "aborted" : "error",
                    errorMessage: aborted ? message : normalizeEof(message),
                    timestamp: Date.now(),
                },
            });
        }
    })();
    return output;
}

/**
 * @param {string | undefined} diagnostic
 * @param {number} retries
 * @returns {string}
 */
export function formatProviderRetryExhaustion(diagnostic, retries) {
    const message = formatProviderError(diagnostic);
    const retryCount = `${retries} ${retries === 1 ? "retry was" : "retries were"} completed.`;
    const temporary = /stopped responding|temporarily unavailable|too many requests/.test(message);
    return `${message} ${retryCount}${temporary ? " You can try again." : ""}`;
}

/** @param {string | undefined} diagnostic @returns {string} */
export function formatProviderError(diagnostic) {
    const text = diagnostic || "";
    if (/insufficient_quota|quota|billing|out of budget|usage limit|session limit|available balance/i.test(text)) {
        return "The model service reports a usage or billing limit. Check your account.";
    }
    if (/\b401\b|\b403\b|unauthori[sz]ed|authentication|invalid.api.key|credential/i.test(text)) {
        return "The model service could not verify your access. Check your sign-in or API credentials.";
    }
    if (
        /unexpected eof|stream ended without|stream ended before|socket hang up|connection (?:error|lost)|network error|fetch failed/i
            .test(text)
    ) {
        return "The model service stopped responding before the reply was complete.";
    }
    if (/\b429\b|rate.?limit|too many requests/i.test(text)) {
        return "The model service is receiving too many requests.";
    }
    if (/\b50[0234]\b|\b52[04]\b|overloaded|service unavailable|server error|timeout|timed out/i.test(text)) {
        return "The model service is temporarily unavailable.";
    }
    if (/\b40[04]\b|invalid.request|bad request|model not found|endpoint|context (?:length|overflow)/i.test(text)) {
        return "The model service rejected this request. Check the selected model and provider settings.";
    }
    return "The model service could not complete this request.";
}
