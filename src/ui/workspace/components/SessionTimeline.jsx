import { useState } from "react";
import {
    isApprovalAcceptedValue,
    RuntimeInteractionOutcomes,
    RuntimeInteractionTypes,
} from "../../../shared/session/session-runtime-interactions.js";
import { MarkdownView } from "./MarkdownView.jsx";
import { RunWieldLink, RunWieldThinkingDots } from "../../design-system/components/react/RunWieldPrimitives.jsx";

const MESSAGE_TYPES = new Set([
    "message",
    "thinking",
    "tool",
    "status",
    "usage",
    "activity",
    "interaction",
    "plan-review",
    "code-review",
    "interruption",
    "system-event",
]);

/** @param {unknown} value */
function asRecord(value) {
    return value && typeof value === "object" ? /** @type {Record<string, any>} */ (value) : {};
}

/** @param {unknown} value */
function text(value) {
    return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
}

/** @param {string} agentName */
export function displayAgentName(agentName) {
    const trimmed = agentName.trim();
    if (!trimmed) return "Ideator";
    const pinned = {
        "frontend-engineer": "Frontend Engineer",
        "plan-engineer": "Plan Engineer",
        "reviewer-feedback-engineer": "Validation Repair Engineer",
    }[trimmed];
    if (pinned) return pinned;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmed)) return trimmed;
    return trimmed.split("-").map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : "").join(" ");
}

/** @param {unknown} timestamp */
export function formatSessionTimelineTime(timestamp) {
    const date = new Date(text(timestamp));
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase().replace(" ", "");
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
    let lastSegmentKey = null;
    /** @type {Record<string, any> | null} */
    let lastAssistantMessage = null;
    const ensure = (/** @type {string} */ key, /** @type {Record<string, any>} */ item) => {
        const existing = byKey.get(key);
        if (existing) return existing;
        byKey.set(key, item);
        items.push(item);
        return item;
    };
    const appendSystemEvent = (/** @type {Record<string, any>} */ item) => {
        const previous = items.at(-1);
        if (
            previous?.kind === "system-event" && previous.header === item.header && previous.level === item.level &&
            previous.source === item.source
        ) {
            previous.lines = [...(Array.isArray(previous.lines) ? previous.lines : [previous.text]), item.text];
            previous.text = previous.lines.join("\n");
            if (item.timestamp) previous.timestamp = item.timestamp;
            return previous;
        }
        item.lines = [item.text];
        items.push(item);
        return item;
    };
    const compactCompletedActivity = (/** @type {Array<Record<string, any>>} */ rawItems) => {
        /** @type {Array<Record<string, any>>} */
        const compacted = [];
        /** @type {Array<Record<string, any>>} */
        let activity = [];
        const isCompletedActivity = (/** @type {Record<string, any>} */ item) =>
            item.kind === "usage" ||
            (item.kind === "tool" && ["completed", "failed"].includes(text(item.status))) ||
            (item.kind === "thinking" && item.done === true);
        const flushActivity = () => {
            if (!activity.length) return;
            if (activity.length === 1) {
                compacted.push(activity[0]);
            } else {
                compacted.push({
                    kind: "activity",
                    key: `activity:${activity[0]?.key || compacted.length}:${activity.length}`,
                    title: "Activity",
                    count: activity.length,
                    source: activity.some((item) => item.source === "transient") ? "transient" : source,
                    timestamp: activity.at(-1)?.timestamp || activity[0]?.timestamp || "",
                    items: activity,
                });
            }
            activity = [];
        };
        for (const item of rawItems) {
            if (isCompletedActivity(item)) {
                activity.push(item);
                continue;
            }
            if (item.kind === "message" && item.role === "assistant") flushActivity();
            else if (activity.length && item.kind !== "message") flushActivity();
            compacted.push(item);
        }
        compacted.push(...activity);
        return compacted;
    };

    events.forEach((raw, index) => {
        const event = asRecord(raw);
        const type = text(event.type);
        const id = text(event.messageId || event.toolCallId || event.eventId || `${source}:${startIndex + index}`);
        const timestamp = text(event.timestamp);
        const segmentOrdinal = Number.isInteger(event.segmentOrdinal) ? event.segmentOrdinal : null;
        const segmentKind = text(event.segmentKind || "session");
        const segmentKey = segmentOrdinal === null ? null : `${segmentOrdinal}:${segmentKind}`;
        if (segmentKey && segmentKey !== lastSegmentKey) {
            lastSegmentKey = segmentKey;
            const label = text(event.agentName) ||
                (segmentKind === "planning"
                    ? "Planner"
                    : segmentKind === "execution"
                    ? "Plan Engineer"
                    : segmentKind === "semantic_repair"
                    ? "Semantic Repair"
                    : "Session");
            appendSystemEvent({
                kind: "system-event",
                key: `segment:${segmentKey}`,
                header: "Segment",
                text: label,
                level: "info",
                segmentKind,
                timestamp,
                source,
            });
        }
        if (type === "user_message") {
            ensure(`user:${id}`, {
                kind: "message",
                role: "user",
                key: event.eventId || `user:${id}`,
                text: text(event.text),
                timestamp,
                source,
            });
            lastAssistantMessage = null;
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
            lastAssistantMessage = item;
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
                kind: requestType === "plan_review"
                    ? "plan-review"
                    : requestType === "code_review"
                    ? "code-review"
                    : "interaction",
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
            appendSystemEvent({
                kind: "system-event",
                key: event.eventId || `interaction-result:${id}:${index}`,
                header: "Interaction",
                level: type === "interaction_canceled" ? "warning" : "info",
                text: text(event.message || `Interaction ${text(event.outcome || "completed")}`),
                timestamp,
                source,
            });
            return;
        }
        if (
            type === "system_status" || type === "terminal_error" || type === "cancellation" ||
            type === "recovery_event"
        ) {
            const level = type === "terminal_error" ? "error" : text(event.level || "info");
            const header = type === "recovery_event" ? "Recovery" : type === "cancellation" ? "Cancellation" : "System";
            appendSystemEvent({
                kind: "system-event",
                key: event.eventId || `status:${id}:${index}`,
                header,
                level,
                text: text(event.message || type.replaceAll("_", " ")),
                timestamp,
                source,
            });
            return;
        }
        if (type === "usage") {
            const usage = asRecord(event.usage);
            const inputTokens = typeof usage.inputTokens === "number" ? usage.inputTokens : null;
            const outputTokens = typeof usage.outputTokens === "number" ? usage.outputTokens : null;
            if (lastAssistantMessage && inputTokens !== null && outputTokens !== null) {
                lastAssistantMessage.footerText = `Usage: ${inputTokens} in / ${outputTokens} out tokens`;
                lastAssistantMessage.completedTimestamp = timestamp;
            }
        }
    });
    return compactCompletedActivity(items.filter((item) => MESSAGE_TYPES.has(item.kind)));
}

/**
 * @param {string} requestType
 * @param {Record<string, any>} request
 * @param {Record<string, any>|string} choice
 */
export function sessionInteractionChoiceResponse(requestType, request, choice) {
    const choiceRecord = typeof choice === "string" ? { value: choice, label: choice } : choice;
    const choiceLabel = text(choiceRecord.label || choiceRecord.value);
    const choiceValue = text(choiceRecord.value || choiceLabel);
    if (requestType === RuntimeInteractionTypes.APPROVAL) {
        const accepted = isApprovalAcceptedValue(
            /** @type {import("../../../shared/session/session-runtime-interactions.js").RuntimeInteractionRequest} */
            (request),
            choiceValue,
        );
        return {
            outcome: accepted ? RuntimeInteractionOutcomes.ACCEPTED : RuntimeInteractionOutcomes.CANCELED,
            value: choiceValue,
            valueLabel: choiceLabel,
        };
    }
    return {
        outcome: RuntimeInteractionOutcomes.SELECTED,
        value: choiceValue,
        valueLabel: choiceLabel,
    };
}

/**
 * @param {string} requestType
 * @param {string} value
 * @param {boolean} hasChoices
 */
export function sessionInteractionTypedResponse(requestType, value, hasChoices) {
    if (hasChoices && requestType === RuntimeInteractionTypes.SELECT) {
        return { outcome: RuntimeInteractionOutcomes.SELECTED, value, valueLabel: "Other" };
    }
    return { outcome: RuntimeInteractionOutcomes.TEXT, value };
}

function ActivityChevronIcon() {
    return (
        <svg className="session-activity-chevron" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path
                d="M6 4l4 4-4 4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

function activityRowLabel(activityItem) {
    if (activityItem.kind === "tool") return activityItem.toolName || activityItem.title || "tool";
    if (activityItem.kind === "thinking") return "Thinking";
    return "Usage";
}

export function compactToolLine(activityItem) {
    const title = text(activityItem.title || activityItem.toolName || "Tool activity").trim();
    const status = text(activityItem.status || "running");
    return status === "running" ? `${title} running` : title;
}

function activityRowSummary(activityItem) {
    if (activityItem.kind === "tool") return compactToolLine(activityItem);
    return activityRowLabel(activityItem);
}

function activityRowDetail(activityItem) {
    if (activityItem.kind === "tool") return activityItem.output || activityItem.status || "No output.";
    if (activityItem.kind === "thinking") return activityItem.text || "Thinking complete.";
    return activityItem.text || "Usage recorded";
}

function SessionInteractionCard({ item }) {
    const [value, setValue] = useState(text(item.request?.defaultValue));
    const [error, setError] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const requestType = text(item.request?.type || RuntimeInteractionTypes.TEXT);
    const choices = Array.isArray(item.request?.options) ? item.request.options : [];
    const answer = item.onAnswer;
    const sendAnswer = async (/** @type {Record<string, any>} */ response) => {
        if (!answer || submitting) return;
        setSubmitting(true);
        setError("");
        try {
            await answer(response);
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : String(caught || "Could not send answer."));
        } finally {
            setSubmitting(false);
        }
    };
    return (
        <article className="session-live-interaction">
            <strong>{requestType === "approval" ? "Approval needed" : "Agent needs input"}</strong>
            <p>{item.request?.prompt || "The agent is waiting for your answer."}</p>
            {item.request?.artifactReview && item.reviewUrl
                ? (
                    <RunWieldLink
                        variant="primary"
                        className="rw-plan-review-link"
                        href={item.reviewUrl}
                        target="_blank"
                    >
                        Open {String(item.request.artifactReview.kind || "artifact").toUpperCase()}
                    </RunWieldLink>
                )
                : null}
            {choices.length
                ? (
                    <div className="session-interaction-choice-row">
                        {choices.map((choice) => {
                            const choiceRecord = typeof choice === "string" ? { value: choice, label: choice } : choice;
                            const choiceLabel = text(choiceRecord.label || choiceRecord.value);
                            const choiceValue = text(choiceRecord.value || choiceLabel);
                            return (
                                <button
                                    key={String(choiceValue)}
                                    type="button"
                                    disabled={submitting}
                                    onClick={() =>
                                        sendAnswer(
                                            sessionInteractionChoiceResponse(
                                                requestType,
                                                asRecord(item.request),
                                                choice,
                                            ),
                                        )}
                                >
                                    {choiceLabel}
                                </button>
                            );
                        })}
                    </div>
                )
                : null}
            {answer && requestType === RuntimeInteractionTypes.APPROVAL && !choices.length
                ? (
                    <div className="session-interaction-choice-row">
                        <button
                            type="button"
                            disabled={submitting}
                            onClick={() => sendAnswer({ outcome: RuntimeInteractionOutcomes.ACCEPTED, value: true })}
                        >
                            Approve
                        </button>
                        <button
                            type="button"
                            disabled={submitting}
                            onClick={() => sendAnswer({ outcome: RuntimeInteractionOutcomes.CANCELED, value: false })}
                        >
                            Decline
                        </button>
                    </div>
                )
                : null}
            {answer && requestType !== RuntimeInteractionTypes.APPROVAL
                ? (
                    <form
                        className="session-interaction-answer-form"
                        onSubmit={(event) => {
                            event.preventDefault();
                            const nextValue = item.request?.allowEmpty ? value : value.trim();
                            if (nextValue || item.request?.allowEmpty) {
                                sendAnswer(sessionInteractionTypedResponse(requestType, nextValue, choices.length > 0));
                            }
                        }}
                    >
                        <label>
                            <span className="sr-only">
                                {choices.length ? "Other answer" : "Answer"}
                            </span>
                            <input
                                value={value}
                                onChange={(event) => setValue(event.currentTarget.value)}
                                placeholder={item.request?.placeholder || (choices.length ? "Other…" : "Answer…")}
                                disabled={submitting}
                            />
                        </label>
                        <button type="submit" disabled={submitting || (!value.trim() && !item.request?.allowEmpty)}>
                            {submitting
                                ? <RunWieldThinkingDots label="Sending" />
                                : choices.length
                                ? "Send other"
                                : "Send"}
                        </button>
                    </form>
                )
                : null}
            {error ? <p className="session-interaction-error" role="alert">{error}</p> : null}
        </article>
    );
}

/** @param {{ items?: Array<Record<string, any>>, events?: Array<Record<string, any>>, emptyMessage?: string }} props */
export function SessionTimeline({ items, events, emptyMessage = "" }) {
    const timelineItems = items || reduceSessionEvents(events || []);
    if (!timelineItems.length) {
        return emptyMessage
            ? (
                <section className="session-timeline empty-state">
                    <p>{emptyMessage}</p>
                </section>
            )
            : null;
    }
    return (
        <ol className="session-timeline" aria-label="Session timeline">
            {timelineItems.map((item, index) => (
                <li key={item.key || `${item.kind}:${index}`} className={`session-timeline-item item-${item.kind}`}>
                    {item.kind === "message"
                        ? (
                            <article className={`session-message role-${item.role}`}>
                                <header>
                                    <strong>
                                        {item.role === "user" ? "You" : displayAgentName(item.agentName || "Ideator")}
                                    </strong>
                                </header>
                                {item.role === "assistant"
                                    ? <MarkdownView markdown={item.text || ""} />
                                    : <p>{item.text}</p>}
                                {item.footerText || item.completedTimestamp
                                    ? (
                                        <footer className="session-message-footer">
                                            {item.footerText ? <span>{item.footerText}</span> : null}
                                            {item.footerText && item.completedTimestamp
                                                ? <span aria-hidden="true">-</span>
                                                : null}
                                            {item.completedTimestamp
                                                ? <time>{formatSessionTimelineTime(item.completedTimestamp)}</time>
                                                : null}
                                        </footer>
                                    )
                                    : null}
                            </article>
                        )
                        : item.kind === "thinking"
                        ? (
                            <details className="session-thinking">
                                <summary>
                                    <ActivityChevronIcon />
                                    <span>
                                        {item.done
                                            ? `${displayAgentName(item.agentName || "Ideator")} thinking complete`
                                            : (
                                                <RunWieldThinkingDots
                                                    label={`${displayAgentName(item.agentName || "Ideator")} thinking`}
                                                />
                                            )}
                                    </span>
                                </summary>
                                <p>{item.text || "Thinking details hidden."}</p>
                            </details>
                        )
                        : item.kind === "tool"
                        ? (
                            <details className={`session-tool status-${item.status}`}>
                                <summary>
                                    <ActivityChevronIcon />
                                    <span>{compactToolLine(item)}</span>
                                </summary>
                                <p>{activityRowDetail(item)}</p>
                            </details>
                        )
                        : item.kind === "activity"
                        ? (
                            <details className="session-activity-group">
                                <summary className="session-activity-group-summary">
                                    <ActivityChevronIcon />
                                    <strong>{item.title || "Activity"}</strong>
                                    <span>{item.count || item.items?.length || 0} events</span>
                                </summary>
                                <div className="session-activity-rows">
                                    {(Array.isArray(item.items) ? item.items : []).map((
                                        activityItem,
                                        activityIndex,
                                    ) => (
                                        <details
                                            className={`session-activity-row activity-${
                                                activityItem.kind || "item"
                                            } status-${activityItem.status || "complete"}`}
                                            key={activityItem.key || `activity:${activityIndex}`}
                                        >
                                            <summary>
                                                <ActivityChevronIcon />
                                                <span>{activityRowSummary(activityItem)}</span>
                                            </summary>
                                            <p>{activityRowDetail(activityItem)}</p>
                                        </details>
                                    ))}
                                </div>
                            </details>
                        )
                        : item.kind === "interaction"
                        ? <SessionInteractionCard item={item} />
                        : item.kind === "plan-review" || item.kind === "code-review"
                        ? (
                            <article
                                className="session-plan-review-card"
                                aria-label={item.kind === "code-review"
                                    ? "Code ready for review"
                                    : "Plan ready for review"}
                            >
                                <p className="kicker">
                                    {item.kind === "code-review" ? "Code ready for review" : "Plan ready for review"}
                                </p>
                                <strong>
                                    {item.kind === "code-review"
                                        ? item.request?.codeReview?.planName || "Workspace changes"
                                        : item.request?.planReview?.planName || "Plan"}
                                </strong>
                                {item.kind === "plan-review"
                                    ? (
                                        <p>
                                            {item.request?.planReview?.classification || "PLANNED_CHANGE"}
                                            {item.request?.planReview?.expectedStatus
                                                ? ` · ${item.request.planReview.expectedStatus}`
                                                : ""}
                                        </p>
                                    )
                                    : <p>Review the current workflow diff without leaving this Workspace.</p>}
                                {item.reviewUrl
                                    ? (
                                        <RunWieldLink
                                            variant="primary"
                                            className="rw-plan-review-link"
                                            href={item.reviewUrl}
                                        >
                                            {item.kind === "code-review" ? "Review Code" : "Review Plan"}
                                        </RunWieldLink>
                                    )
                                    : null}
                            </article>
                        )
                        : item.kind === "system-event" && item.header === "Segment"
                        ? (
                            <div className={`session-segment-marker segment-${item.segmentKind || "session"}`}>
                                <span>{item.text}</span>
                            </div>
                        )
                        : item.kind === "system-event"
                        ? (
                            <article className={`session-system-event level-${item.level || "info"}`}>
                                <header>
                                    <strong>{item.header || "System"}</strong>
                                </header>
                                {Array.isArray(item.lines) && item.lines.length > 1
                                    ? (
                                        <ul>
                                            {item.lines.map((line, lineIndex) => (
                                                <li key={`${item.key}:line:${lineIndex}`}>{line}</li>
                                            ))}
                                        </ul>
                                    )
                                    : <p>{item.text}</p>}
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
