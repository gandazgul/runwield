import { MarkdownView } from "./MarkdownView.jsx";

const MESSAGE_TYPES = new Set([
    "message",
    "thinking",
    "tool",
    "status",
    "usage",
    "interaction",
    "plan-review",
    "interruption",
]);

/** @param {unknown} value */
function asRecord(value) {
    return value && typeof value === "object" ? /** @type {Record<string, any>} */ (value) : {};
}

/** @param {unknown} value */
function text(value) {
    return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
}

/**
 * @param {Array<Record<string, any>>} events
 * @param {{ source?: "committed" | "transient", startIndex?: number }} [options]
 * @returns {Array<Record<string, any>>}
 */
export function reduceSessionEvents(events, options = {}) {
    /** @type {Array<Record<string, any>>} */
    const items = [];
    /** @type {Map<string, Record<string, any>>} */
    const byKey = new Map();
    const source = options.source || "committed";
    const startIndex = options.startIndex || 0;
    const ensure = (/** @type {string} */ key, /** @type {Record<string, any>} */ item) => {
        const existing = byKey.get(key);
        if (existing) return existing;
        byKey.set(key, item);
        items.push(item);
        return item;
    };
    events.forEach((raw, index) => {
        const event = asRecord(raw);
        const type = text(event.type);
        const id = text(event.messageId || event.toolCallId || event.eventId || `${source}:${startIndex + index}`);
        const timestamp = text(event.timestamp);
        if (type === "user_message") {
            ensure(`user:${id}`, {
                kind: "message",
                role: "user",
                key: event.eventId || `user:${id}`,
                text: text(event.text),
                timestamp,
                source,
            });
            return;
        }
        if (type === "assistant_text_delta") {
            const item = ensure(`assistant:${id}`, {
                kind: "message",
                role: "assistant",
                key: event.eventId || `assistant:${id}`,
                text: "",
                agentName: text(event.agentName || "Ideator"),
                timestamp,
                source,
            });
            item.text += text(event.delta);
            if (timestamp) item.timestamp = timestamp;
            return;
        }
        if (type === "assistant_thinking_delta" || type === "assistant_thinking_end") {
            const item = ensure(`thinking:${id}`, {
                kind: "thinking",
                key: event.eventId || `thinking:${id}`,
                text: "",
                agentName: text(event.agentName || "Ideator"),
                done: false,
                timestamp,
                source,
            });
            if (type === "assistant_thinking_delta") item.text += text(event.delta);
            if (type === "assistant_thinking_end") item.done = true;
            if (timestamp) item.timestamp = timestamp;
            return;
        }
        if (type === "tool_start" || type === "tool_update" || type === "tool_end") {
            const toolId = text(event.toolCallId || id);
            const item = ensure(`tool:${toolId}`, {
                kind: "tool",
                key: event.eventId || `tool:${toolId}`,
                title: text(event.title || event.toolName || "Tool activity"),
                toolName: text(event.toolName || "tool"),
                status: "running",
                output: "",
                timestamp,
                source,
            });
            item.title = text(event.title || item.title);
            if (type !== "tool_start") item.output = text(event.output || item.output);
            if (type === "tool_end") item.status = event.isError ? "failed" : "completed";
            if (timestamp) item.timestamp = timestamp;
            return;
        }
        if (type === "interaction_requested") {
            const requestType = text(event.interactionType || "text");
            const review = asRecord(event.review);
            ensure(`interaction:${text(event.interactionId || id)}`, {
                kind: requestType === "plan_review" ? "plan-review" : "interaction",
                key: event.eventId || `interaction:${text(event.interactionId || id)}`,
                interactionId: text(event.interactionId || id),
                request: {
                    prompt: text(
                        event.prompt ||
                            (requestType === "plan_review" ? "Plan ready for review." : "The agent needs input."),
                    ),
                    type: requestType,
                    planReview: requestType === "plan_review"
                        ? {
                            planId: text(review.planId),
                            planName: text(review.planName || "Plan"),
                            classification: text(review.classification || "PLANNED_CHANGE"),
                            expectedStatus: text(review.expectedStatus),
                            expectedRevision: text(review.expectedRevision),
                        }
                        : null,
                },
                status: "live",
                timestamp,
                source,
            });
            return;
        }
        if (type === "interaction_resolved" || type === "interaction_canceled") {
            ensure(`status:${id}:${index}`, {
                kind: "status",
                key: event.eventId || `interaction-result:${id}:${index}`,
                level: type === "interaction_canceled" ? "warning" : "info",
                text: text(event.message || `Interaction ${text(event.outcome || "completed")}`),
                timestamp,
                source,
            });
            return;
        }
        if (type === "system_status" || type === "terminal_error" || type === "cancellation") {
            ensure(`status:${id}:${index}`, {
                kind: "status",
                key: event.eventId || `status:${id}:${index}`,
                level: type === "terminal_error" ? "error" : text(event.level || "info"),
                text: text(event.message || type.replaceAll("_", " ")),
                timestamp,
                source,
            });
            return;
        }
        if (type === "usage") {
            const usage = asRecord(event.usage);
            const tokens = [usage.inputTokens, usage.outputTokens].filter((value) => typeof value === "number");
            ensure(`usage:${id}:${index}`, {
                kind: "usage",
                key: event.eventId || `usage:${id}:${index}`,
                text: tokens.length ? `Usage: ${tokens.join(" in / ")} out tokens` : "Usage recorded",
                timestamp,
                source,
            });
        }
    });
    return items.filter((item) => MESSAGE_TYPES.has(item.kind));
}

/** @param {{ items?: Array<Record<string, any>>, events?: Array<Record<string, any>>, emptyMessage?: string }} props */
export function SessionTimeline({ items, events, emptyMessage = "No committed timeline events yet." }) {
    const timelineItems = items || reduceSessionEvents(events || []);
    if (!timelineItems.length) {
        return (
            <section className="session-timeline empty-state">
                <p>{emptyMessage}</p>
            </section>
        );
    }
    return (
        <ol className="session-timeline" aria-label="Session timeline">
            {timelineItems.map((item, index) => (
                <li key={item.key || `${item.kind}:${index}`} className={`session-timeline-item item-${item.kind}`}>
                    {item.kind === "message"
                        ? (
                            <article className={`session-message role-${item.role}`}>
                                <header>
                                    <strong>{item.role === "user" ? "You" : item.agentName || "Ideator"}</strong>
                                    {item.timestamp ? <time>{item.timestamp}</time> : null}
                                </header>
                                {item.role === "assistant"
                                    ? <MarkdownView markdown={item.text || ""} />
                                    : <p>{item.text}</p>}
                            </article>
                        )
                        : item.kind === "thinking"
                        ? (
                            <details className="session-thinking">
                                <summary>
                                    {item.agentName || "Ideator"} thinking {item.done ? "complete" : "in progress"}
                                </summary>
                                <p>{item.text || "Thinking details hidden."}</p>
                            </details>
                        )
                        : item.kind === "tool"
                        ? (
                            <article className={`session-tool status-${item.status}`}>
                                <strong>{item.title}</strong>
                                <p>{item.status}{item.output ? ` · ${item.output}` : ""}</p>
                            </article>
                        )
                        : item.kind === "interaction"
                        ? (
                            <article className="session-live-interaction">
                                <strong>Agent needs input</strong>
                                <p>{item.request?.prompt || "The agent is waiting for your answer."}</p>
                                {item.onAnswer
                                    ? (
                                        <button
                                            type="button"
                                            onClick={() => item.onAnswer(item)}
                                        >
                                            Answer interaction
                                        </button>
                                    )
                                    : null}
                            </article>
                        )
                        : item.kind === "plan-review"
                        ? (
                            <article className="session-plan-review-card" aria-label="Plan ready for review">
                                <p className="kicker">Plan ready for review</p>
                                <strong>{item.request?.planReview?.planName || "Plan"}</strong>
                                <p>
                                    {item.request?.planReview?.classification || "PLANNED_CHANGE"}
                                    {item.request?.planReview?.expectedStatus
                                        ? ` · ${item.request.planReview.expectedStatus}`
                                        : ""}
                                </p>
                                {item.reviewUrl
                                    ? <a className="rw-plan-review-link" href={item.reviewUrl}>Review Plan</a>
                                    : null}
                            </article>
                        )
                        : item.kind === "interruption"
                        ? <p className="session-interruption">The agent was interrupted. Ask it to continue.</p>
                        : <p className={`session-status-row level-${item.level || "info"}`}>{item.text}</p>}
                </li>
            ))}
        </ol>
    );
}

export default SessionTimeline;
