import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

// New Session chat structure is adapted from OpenChamber's ChatContainer/ChatInput UI.
// OpenChamber is MIT licensed: Copyright (c) 2025 Bohdan Triapitsyn.
import {
    RunWieldButton,
    RunWieldLink,
    RunWieldPanelToggle,
    RunWieldThinkingDots,
} from "../../design-system/components/react/RunWieldPrimitives.jsx";
import { SessionList } from "../components/SessionList.jsx";
import { deriveSessionAvailability } from "../components/SessionActivationStatus.jsx";
import { reduceSessionEvents, SessionTimeline } from "../components/SessionTimeline.jsx";
import {
    buildSessionSidebarProjection,
    defaultSessionSidebarTab,
    SESSION_SIDEBAR_TABS,
    sessionArtifactKindLabel,
    sessionSidebarFields,
} from "../../../shared/session/session-sidebar.ts";
import { createSessionTabNotificationController } from "../browser/session-tab-notifications.ts";
import { WorkspaceHeaderActionsPortal } from "../react/WorkspaceHeaderActionsPortal.tsx";
import { loadSessionDrafts, readSessionDraft, saveSessionDraft } from "../browser/session-drafts.ts";

export const SESSION_PAGE_SIZE = 30;
const TIMELINE_PAGE_LIMIT = 200;
const POLL_INTERVAL_MS = 1500;
const AVAILABILITY_REFRESH_INTERVAL_MS = 5000;

/** @param {string} projectId @param {string} sessionId */
export function sessionDraftKey(projectId, sessionId) {
    return `runwield:owner:project:${projectId}:session:${sessionId}:draft`;
}

/** @param {string} projectId @param {string} sessionId */
export function sessionRequestKey(projectId, sessionId) {
    return `runwield:owner:project:${projectId}:session:${sessionId}:request`;
}

/** @param {string} projectId @param {string} sessionId */
export function sessionAttachmentsKey(projectId, sessionId) {
    return `runwield:owner:project:${projectId}:session:${sessionId}:image-attachments`;
}

/** @param {string} projectId */
export function newSessionDraftInstanceStorageKey(projectId) {
    return `runwield:owner:project:${projectId}:session:new:draft-instance`;
}

/** @param {string} projectId */
function getNewSessionDraftInstanceId(projectId) {
    if (typeof sessionStorage === "undefined") return "";
    const key = newSessionDraftInstanceStorageKey(projectId);
    const stored = sessionStorage.getItem(key);
    if (stored) return stored;
    const next = `new:${crypto.randomUUID()}`;
    sessionStorage.setItem(key, next);
    return next;
}

/**
 * @typedef {Object} SessionImageAttachmentDraft
 * @property {string} id
 * @property {string} name
 * @property {string} mimeType
 * @property {string} base64
 */

/**
 * @typedef {Object} SessionImageRequest
 * @property {string} base64
 * @property {string} mimeType
 */

/**
 * @typedef {Object} WorkspaceQueuedMessage
 * @property {string} id
 * @property {string} text
 * @property {SessionImageRequest[]} images
 * @property {string} queuedAt
 */

/** @param {unknown} value */
function asRecord(value) {
    return value && typeof value === "object" ? /** @type {Record<string, any>} */ (value) : {};
}

/** @param {string} name */
function ownerCookie(name) {
    return document.cookie.split("; ").find((value) => value.startsWith(`${name}=`))?.split("=").slice(1).join("=") ||
        "";
}

/** @param {string} url @param {RequestInit} [options] */
async function ownerFetch(url, options = {}) {
    const headers = new Headers(options.headers || {});
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
    headers.set("x-runwield-csrf", decodeURIComponent(ownerCookie("rw_owner_csrf")));
    const response = await fetch(url, { ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(payload.error || `Request failed with ${response.status}`);
        Reflect.set(error, "status", response.status);
        Reflect.set(error, "payload", payload);
        throw error;
    }
    return payload;
}

/** @param {string} key */
function readStored(key) {
    try {
        return JSON.parse(readSessionDraft(key) || "null");
    } catch {
        return null;
    }
}

/** @param {unknown} error */
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

/** @param {string} href @param {"push" | "replace"} [history] */
function workspaceNavigate(href, history = "push") {
    const event = new CustomEvent("runwield:workspace-navigate", {
        cancelable: true,
        detail: { href, history },
    });
    if (document.dispatchEvent(event)) {
        if (history === "replace") globalThis.location.replace(href);
        else globalThis.location.assign(href);
    }
}

/** @param {SessionImageAttachmentDraft} image */
export function serializeSessionImageForRequest(image) {
    return { base64: image.base64, mimeType: image.mimeType };
}

/** @param {File} file */
async function readPastedImage(file) {
    if (!/^image\/(png|jpeg|jpg|gif|webp)$/.test(file.type)) throw new Error("Attach a PNG, JPEG, GIF, or WebP image.");
    if (file.size > 7 * 1024 * 1024) throw new Error("This image is too large. Choose an image smaller than 7 MB.");
    const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error || new Error("Image paste failed."));
        reader.readAsDataURL(file);
    });
    const marker = ";base64,";
    const markerIndex = dataUrl.indexOf(marker);
    if (markerIndex < 0) throw new Error("Image paste did not include base64 data.");
    return {
        id: crypto.randomUUID(),
        name: file.name || "pasted-image",
        mimeType: file.type,
        base64: dataUrl.slice(markerIndex + marker.length),
    };
}

/**
 * @param {{ status?: string, responseAccepted?: boolean }} input
 * @returns {"idle" | "retry-same-envelope" | "poll-operation" | "manual-resubmit"}
 */
export function draftRecoveryDecision(input) {
    if (input.status === "running" || input.status === "accepted" || input.responseAccepted) return "poll-operation";
    if (input.status === "network-error") return "retry-same-envelope";
    if (input.status === "conflict" || input.status === "unavailable") return "manual-resubmit";
    return "idle";
}

/** @param {{ cancelled: boolean, currentOperationId?: string, polledOperationId: string }} input */
export function shouldApplyOperationPoll(input) {
    return !input.cancelled && input.currentOperationId === input.polledOperationId;
}

/** @param {unknown} events */
export function reduceOperationTransientItems(events) {
    return reduceSessionEvents(
        Array.isArray(events) ? events.filter((event) => !event.eventId && event.type !== "interaction_requested") : [],
        { source: "transient" },
    );
}

let operationNotificationController = null;

function getOperationNotificationController() {
    if (!operationNotificationController) {
        operationNotificationController = createSessionTabNotificationController();
    }
    return operationNotificationController;
}

export function disposeOperationBrowserNotifications() {
    operationNotificationController?.dispose();
    operationNotificationController = null;
}

export function observeOperationBrowserNotifications(current, payload, cursorRef) {
    const events = (Array.isArray(payload.events) ? payload.events : [])
        .filter((event) => !event.eventId && event.type === "attention_requested" && event.reason === "agentStopped");
    const key = `${current.scopeKey || ""}:${current.operationId}`;
    if (!cursorRef.current || cursorRef.current.key !== key) {
        cursorRef.current = {
            key,
            seen: new Set(
                current.restored && current.attempts === 0 ? events.map((event) => JSON.stringify(event)) : [],
            ),
        };
    }
    for (const event of events) {
        const identity = JSON.stringify(event);
        if (cursorRef.current.seen.has(identity)) continue;
        cursorRef.current.seen.add(identity);
        getOperationNotificationController().notifyAgentStopped(event, payload.browserNotificationPolicy);
    }
}

export function syncOperationBrowserNotificationLifecycle({ operationId, scopeKey, operationKeyRef, cursorRef }) {
    const nextKey = operationId ? `${scopeKey || ""}:${operationId}` : null;
    const previousKey = operationKeyRef.current;
    if (!nextKey) {
        cursorRef.current = null;
        return;
    }
    if (previousKey && previousKey !== nextKey) disposeOperationBrowserNotifications();
    if (previousKey !== nextKey) cursorRef.current = null;
    operationKeyRef.current = nextKey;
}

/** @param {{ scrollHeight: number, scrollTop: number, clientHeight: number, threshold?: number }} input */
export function isAtLiveScrollEdge(input) {
    const threshold = typeof input.threshold === "number" ? input.threshold : 48;
    return input.scrollHeight - input.scrollTop - input.clientHeight < threshold;
}

/** @param {{ mode: string, state?: string, localOperationActive?: boolean, queuedMessageCount?: number }} input */
export function shouldRefreshSessionAvailability(input) {
    return input.mode === "detail" && input.localOperationActive !== true;
}

/**
 * @typedef {{ model?: string, provider?: string }} SessionModelState
 */

/**
 * @typedef {{ activeModel?: SessionModelState | null, model?: string, provider?: string }} SessionModelSnapshot
 */

/** @param {SessionModelSnapshot | undefined | null} snapshot */
export function activePlanId(snapshot) {
    const context = asRecord(snapshot?.workflowContext || snapshot?.activeExecutionWorkflow || {});
    return typeof context.planId === "string" && context.planId.trim()
        ? context.planId.trim()
        : typeof context.planName === "string" && context.planName.trim()
        ? context.planName.trim()
        : "";
}

export function activePlanProgressUrl(projectId, runwieldSessionId, snapshot) {
    const planId = activePlanId(snapshot);
    return planId
        ? `/projects/${encodeURIComponent(projectId)}/plans/${encodeURIComponent(planId)}/progress?session=${
            encodeURIComponent(runwieldSessionId)
        }`
        : "";
}

export function activePlanProgressApiUrl(projectId, runwieldSessionId, snapshot) {
    const planId = activePlanId(snapshot);
    return planId
        ? `/api/owner/projects/${encodeURIComponent(projectId)}/plans/${encodeURIComponent(planId)}/progress?session=${
            encodeURIComponent(runwieldSessionId)
        }`
        : "";
}

function highestStageState(stages) {
    const priority = [
        "needs_attention",
        "failed",
        "paused",
        "running",
        "passed",
        "completed",
        "not_required",
        "pending",
        "unknown",
    ];
    return stages.map((item) => item?.state || "unknown").sort((left, right) =>
        priority.indexOf(left) - priority.indexOf(right)
    )[0] || "unknown";
}

export function deriveWorkflowSidebarStages(progress) {
    const stages = Array.isArray(progress?.stages) ? progress.stages : [];
    const byId = (id) => stages.find((stage) => stage.id === id) || null;
    const validationStages = [byId("mechanical"), byId("semantic")].filter(Boolean);
    const validationState = validationStages.length ? highestStageState(validationStages) : "unknown";
    const validationDetail = validationStages.map((stage) => `${stage.label}: ${stage.detail}`).join(" ") ||
        "Validation has no committed stage evidence yet.";
    const completion = byId("completion") || byId("delivery");
    return [
        byId("execution") || {
            id: "execution",
            label: "Execution",
            state: "unknown",
            detail: "Execution has no committed stage evidence yet.",
        },
        {
            id: "validation",
            label: "Validation",
            state: validationState,
            detail: validationDetail,
        },
        byId("repair") || {
            id: "repair",
            label: "Repair",
            state: "unknown",
            detail: "Repair has no committed stage evidence yet.",
        },
        completion || {
            id: "completion",
            label: "Completion",
            state: "unknown",
            detail: "Completion has no committed stage evidence yet.",
        },
    ];
}

function PaperAirplaneIcon() {
    return (
        <svg className="rw-session-toolbar-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.5 4.5 20.5 12 3.5 19.5 6 12Zm0 0h7" />
        </svg>
    );
}

function resizeComposerTextArea(textarea) {
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
}

function SessionBusyPanel() {
    return (
        <div className="session-inline-loader" role="status">
            <RunWieldThinkingDots label="Working" />
        </div>
    );
}

function SessionComposer({
    id,
    draft,
    disabled,
    controlsDisabled = disabled,
    canSend,
    submitting,
    onDraftChange,
    onSubmit,
    onQueue = undefined,
    onStop = undefined,
    sendLabel = "Send",
    steeringMessages = [],
    onPaste,
    onFiles,
    imageAttachments = [],
    onRemoveImage,
    agents = [],
    models = [],
    thinkingLevels = [],
    agentValue,
    modelValue,
    thinkingValue,
    onAgentChange,
    onModelChange,
    onThinkingChange,
    agentFallback = null,
    modelFallback = null,
    thinkingFallback = null,
    queuedMessages = [],
}) {
    const textareaRef = useRef(null);
    const fileInputRef = useRef(null);
    useEffect(() => resizeComposerTextArea(textareaRef.current), [draft]);
    return (
        <form
            className="session-composer"
            onDragOver={(event) => {
                if (event.dataTransfer.types.includes("Files")) event.preventDefault();
            }}
            onDrop={(event) => {
                if (!event.dataTransfer.files.length) return;
                event.preventDefault();
                if (!disabled) onFiles?.(Array.from(event.dataTransfer.files));
            }}
            onSubmit={(event) => {
                event.preventDefault();
                onSubmit();
            }}
        >
            {queuedMessages.length
                ? (
                    <ol className="session-composer-queue" aria-label="Queued messages">
                        {queuedMessages.map((item) => (
                            <li key={item.id}>
                                <span>{item.text || "Image message"}</span>
                                {Array.isArray(item.images) && item.images.length
                                    ? <small>{item.images.length} image{item.images.length === 1 ? "" : "s"}</small>
                                    : null}
                            </li>
                        ))}
                    </ol>
                )
                : null}
            {steeringMessages.length
                ? (
                    <ul className="session-composer-queue" aria-label="Pending steering messages">
                        {steeringMessages.map((item) => (
                            <li key={item.id}>
                                <span>Steering · {item.text}</span>
                            </li>
                        ))}
                    </ul>
                )
                : null}
            <textarea
                ref={textareaRef}
                id={id}
                value={draft}
                rows={2}
                disabled={disabled}
                onPaste={onPaste}
                onChange={(event) => {
                    onDraftChange(event.currentTarget.value);
                    resizeComposerTextArea(event.currentTarget);
                }}
                onKeyDown={(event) => {
                    if (event.key === "Escape" && onStop) {
                        event.preventDefault();
                        onStop();
                    }
                    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        if (canSend && !submitting) onSubmit();
                    }
                }}
                placeholder="Ask RunWield..."
                aria-label="Message"
            />
            {imageAttachments.length
                ? (
                    <ul className="session-image-attachments rw-image-previews" aria-label="Attached images">
                        {imageAttachments.map((image) => (
                            <li key={image.id}>
                                <img src={`data:${image.mimeType};base64,${image.base64}`} alt={image.name} />
                                <span>{image.name} · {image.mimeType}</span>
                                <button type="button" onClick={() => onRemoveImage?.(image.id)}>Remove</button>
                            </li>
                        ))}
                    </ul>
                )
                : null}
            <div className="session-composer-actions" aria-label="Session settings">
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp"
                    multiple
                    hidden
                    onChange={(event) => {
                        onFiles?.(Array.from(event.currentTarget.files || []));
                        event.currentTarget.value = "";
                    }}
                />
                <button
                    type="button"
                    className="rw-toolbar-button"
                    disabled={disabled}
                    onClick={() => fileInputRef.current?.click()}
                >
                    Attach image
                </button>
                <select
                    aria-label="Agent"
                    value={agentValue}
                    disabled={controlsDisabled || !agents.length}
                    onChange={(event) => onAgentChange(event.currentTarget.value)}
                >
                    {agentFallback}
                    {agents.map((agent) => (
                        <option key={agent.name} value={agent.name}>{agent.displayName || agent.name}</option>
                    ))}
                </select>
                <select
                    aria-label="Model"
                    value={modelValue}
                    disabled={controlsDisabled || !models.length}
                    onChange={(event) => onModelChange(event.currentTarget.value)}
                >
                    {modelFallback}
                    {models.map((model) => (
                        <option key={`${model.provider}/${model.id}`} value={`${model.provider}\u001f${model.id}`}>
                            {model.name || model.id}
                        </option>
                    ))}
                </select>
                <select
                    aria-label="Thinking"
                    value={thinkingValue}
                    disabled={controlsDisabled || !thinkingLevels.length}
                    onChange={(event) => onThinkingChange(event.currentTarget.value)}
                >
                    {thinkingFallback}
                    {thinkingLevels.map((level) => <option key={level} value={level}>{level}</option>)}
                </select>
                {onStop ? <button type="button" className="rw-toolbar-button" onClick={onStop}>Stop</button> : null}
                {onQueue
                    ? (
                        <button
                            type="button"
                            className="rw-toolbar-button"
                            disabled={!canSend || submitting}
                            onClick={onQueue}
                        >
                            Queue
                        </button>
                    )
                    : null}
                <button
                    type="submit"
                    className="rw-toolbar-button session-send-button"
                    disabled={!canSend || submitting}
                    aria-label={submitting ? "Sending" : sendLabel}
                >
                    {submitting ? <RunWieldThinkingDots label="Sending" /> : (
                        <>
                            <PaperAirplaneIcon />
                            <span>{sendLabel}</span>
                        </>
                    )}
                </button>
            </div>
        </form>
    );
}

/** @param {{ projectId: string, mode?: "list" | "detail" | "new", runwieldSessionId?: string }} props */
export function SessionSurface({ projectId, mode = "detail", runwieldSessionId = "" }) {
    const [listData, setListData] = useState(/** @type {any} */ (null));
    const [listPage, setListPage] = useState(0);
    const [listError, setListError] = useState("");
    const [loadingList, setLoadingList] = useState(mode === "list");
    const [timeline, setTimeline] = useState(/** @type {any} */ (null));
    const [timelineItems, setTimelineItems] = useState(/** @type {Array<Record<string, any>>} */ ([]));
    const [pendingUserMessages, setPendingUserMessages] = useState(/** @type {Array<Record<string, any>>} */ ([]));
    const [transientItems, setTransientItems] = useState(/** @type {Array<Record<string, any>>} */ ([]));
    const [workflowProgress, setWorkflowProgress] = useState(/** @type {any} */ (null));
    const [workflowProgressError, setWorkflowProgressError] = useState("");
    const [sessionSidebarTab, setSessionSidebarTab] = useState("session");
    const [contextCollapsed, setContextCollapsed] = useState(false);
    useEffect(() => {
        try {
            const stored = localStorage.getItem("runwield:owner:session-context-collapsed");
            setContextCollapsed(
                stored === null ? globalThis.matchMedia("(max-width: 900px)").matches : stored === "true",
            );
        } catch { /* Sidebar state is optional. */ }
    }, []);
    function toggleContext() {
        const collapsed = !contextCollapsed;
        setContextCollapsed(collapsed);
        try {
            localStorage.setItem("runwield:owner:session-context-collapsed", String(collapsed));
        } catch { /* Sidebar state is optional. */ }
    }
    const sidebarSessionRef = useRef("");
    const [detailError, setDetailError] = useState("");
    const [loadingDetail, setLoadingDetail] = useState(mode === "detail");
    const [draft, setDraft] = useState("");
    const [loadedDraftKey, setLoadedDraftKey] = useState("");
    const operationNavigationRef = useRef(false);
    const [imageAttachments, setImageAttachments] = useState(/** @type {SessionImageAttachmentDraft[]} */ ([]));
    const [queuedMessages, setQueuedMessages] = useState(/** @type {WorkspaceQueuedMessage[]} */ ([]));
    const [message, setMessage] = useState("");
    const [operation, setOperation] = useState(
        /** @type {{ operationId: string, status: string, observed: number, attempts: number, remote?: boolean } | null} */ (null),
    );
    const [steeringMessages, setSteeringMessages] = useState([]);
    const [pendingConfiguration, setPendingConfiguration] = useState(
        /** @type {Record<string, string> | null} */ (null),
    );
    const [liveThinkingLevel, setLiveThinkingLevel] = useState("");
    const [sessionOptions, setSessionOptions] = useState(/** @type {any} */ (null));
    const [optionsError, setOptionsError] = useState("");
    const [selectedAgent, setSelectedAgent] = useState("router");
    const [selectedModelKey, setSelectedModelKey] = useState("");
    const [selectedThinking, setSelectedThinking] = useState("default");
    const [submitting, setSubmitting] = useState(false);
    const [attachingImages, setAttachingImages] = useState(false);
    const [loadingEarlier, setLoadingEarlier] = useState(false);
    const timelineLoadRef = useRef(0);
    const timelineRef = useRef(timeline);
    timelineRef.current = timeline;
    const sessionIdentityRef = useRef(runwieldSessionId);
    sessionIdentityRef.current = runwieldSessionId;
    const [interruptedOperation, setInterruptedOperation] = useState(false);
    const [operationStreamFailed, setOperationStreamFailed] = useState(false);
    const operationRef = useRef(operation);
    operationRef.current = operation;
    const notificationCursorRef = useRef(null);
    const notificationOperationKeyRef = useRef(null);
    const queuedDispatchActiveRef = useRef(false);
    const queuedSessionRef = useRef(runwieldSessionId);
    const timelineEndRef = useRef(/** @type {HTMLDivElement | null} */ (null));
    const timelineScrollRef = useRef(/** @type {HTMLDivElement | null} */ (null));
    const followingLiveEdgeRef = useRef(true);
    const didPinInitialTimelineRef = useRef(false);
    const [, setFollowingLiveEdge] = useState(true);
    const [latestActivityAvailable, setLatestActivityAvailable] = useState(false);
    const [newSessionStorageId] = useState(() => mode === "new" ? getNewSessionDraftInstanceId(projectId) : "");
    const sessionStorageId = runwieldSessionId || newSessionStorageId;

    const draftKey = sessionStorageId ? sessionDraftKey(projectId, sessionStorageId) : "";
    const requestKey = sessionStorageId ? sessionRequestKey(projectId, sessionStorageId) : "";
    const attachmentsKey = sessionStorageId ? sessionAttachmentsKey(projectId, sessionStorageId) : "";

    const notificationScopeKey = `${projectId}:${runwieldSessionId || sessionStorageId}`;

    useEffect(() => {
        return () => {
            disposeOperationBrowserNotifications();
            notificationCursorRef.current = null;
            notificationOperationKeyRef.current = null;
        };
    }, [notificationScopeKey]);

    useEffect(() => {
        syncOperationBrowserNotificationLifecycle({
            operationId: operation?.operationId,
            scopeKey: notificationScopeKey,
            operationKeyRef: notificationOperationKeyRef,
            cursorRef: notificationCursorRef,
        });
    }, [notificationScopeKey, operation?.operationId]);

    async function loadList(requestedPage = listPage) {
        setLoadingList(true);
        setListError("");
        try {
            const query = new URLSearchParams({ page: String(requestedPage), pageSize: String(SESSION_PAGE_SIZE) });
            const payload = await ownerFetch(
                `/api/owner/projects/${encodeURIComponent(projectId)}/sessions?${query}`,
                { method: "GET" },
            );
            setListData(payload);
        } catch (error) {
            setListError(errorMessage(error));
        } finally {
            setLoadingList(false);
        }
    }

    async function loadSessionOptions() {
        setOptionsError("");
        try {
            const payload = await ownerFetch(
                `/api/owner/projects/${encodeURIComponent(projectId)}/session-options`,
                { method: "GET" },
            );
            setSessionOptions(payload);
            const defaults = asRecord(payload.defaults);
            const defaultProvider = typeof defaults.provider === "string" ? defaults.provider : "";
            const defaultModel = typeof defaults.model === "string" ? defaults.model : "";
            setSelectedAgent(
                typeof defaults.agentName === "string" && defaults.agentName ? defaults.agentName : "router",
            );
            setSelectedModelKey(defaultModel ? `${defaultProvider}\u001f${defaultModel}` : "");
            setSelectedThinking(
                typeof defaults.thinkingLevel === "string" && defaults.thinkingLevel
                    ? defaults.thinkingLevel
                    : "default",
            );
        } catch (error) {
            setOptionsError(errorMessage(error));
        }
    }

    async function fetchTimeline(beforeEventId = "") {
        const existing = timelineRef.current;
        const qs = new URLSearchParams({ limit: String(TIMELINE_PAGE_LIMIT) });
        if (beforeEventId) qs.set("beforeEventId", beforeEventId);
        else if (existing?.nextCursor) qs.set("cursorEventId", existing.nextCursor);
        else qs.set("latest", "true");
        const url = `/api/owner/projects/${encodeURIComponent(projectId)}/sessions/${
            encodeURIComponent(runwieldSessionId)
        }/timeline`;
        let payload = await ownerFetch(`${url}?${qs}`, { method: "GET" });
        if (beforeEventId || !existing?.nextCursor) return payload;
        const events = [...(payload.cursorReset ? [] : existing.events), ...payload.events];
        // Only catch up new events. Older history is loaded explicitly by the reader.
        while (payload.complete === false) {
            if (!payload.nextCursor || payload.nextCursor === qs.get("cursorEventId")) break;
            qs.set("cursorEventId", payload.nextCursor);
            payload = await ownerFetch(`${url}?${qs}`, { method: "GET" });
            events.push(...payload.events);
        }
        return { ...payload, events, previousCursor: existing.previousCursor };
    }

    function applyTimeline(nextTimeline) {
        const events = Array.isArray(nextTimeline.events)
            ? [...new Map(nextTimeline.events.map((event) => [event.eventId, event])).values()]
            : [];
        const merged = { ...nextTimeline, events };
        timelineRef.current = merged;
        setTimeline(merged);
        if (typeof merged.snapshot?.name === "string") {
            document.dispatchEvent(
                new CustomEvent("runwield:session-named", {
                    detail: { projectId, runwieldSessionId, name: merged.snapshot.name },
                }),
            );
        }
        setTimelineItems(reduceSessionEvents(events, { source: "committed" }));
        setPendingUserMessages((messages) => {
            const committedUserText = new Set(
                events.filter((event) => event.type === "user_message").map((event) => event.text),
            );
            return messages.filter((item) => !committedUserText.has(item.text));
        });
        if (nextTimeline.state !== "active" && !operationRef.current) {
            setTransientItems([]);
            setPendingConfiguration(null);
            setSteeringMessages([]);
            setLiveThinkingLevel("");
        }
    }

    async function loadTimeline() {
        if (!runwieldSessionId) return null;
        const identity = runwieldSessionId;
        const loadId = ++timelineLoadRef.current;
        try {
            const nextTimeline = await fetchTimeline();
            if (sessionIdentityRef.current !== identity || loadId !== timelineLoadRef.current) return null;
            applyTimeline(nextTimeline);
            setDetailError("");
            return nextTimeline;
        } catch (error) {
            if (sessionIdentityRef.current === identity) setDetailError(errorMessage(error));
            return null;
        } finally {
            if (sessionIdentityRef.current === identity) setLoadingDetail(false);
        }
    }

    async function loadEarlierMessages() {
        const cursor = timelineRef.current?.previousCursor;
        if (!cursor || loadingEarlier) return;
        setLoadingEarlier(true);
        const identity = runwieldSessionId;
        const scroller = timelineScrollRef.current;
        const height = scroller?.scrollHeight || 0;
        try {
            const earlier = await fetchTimeline(cursor);
            if (sessionIdentityRef.current !== identity) return;
            const current = timelineRef.current;
            applyTimeline({
                ...current,
                events: [...earlier.events, ...current.events],
                previousCursor: earlier.previousCursor,
            });
            followingLiveEdgeRef.current = false;
            requestAnimationFrame(() => {
                if (scroller) scroller.scrollTop += scroller.scrollHeight - height;
            });
        } catch (error) {
            setMessage(errorMessage(error));
        } finally {
            setLoadingEarlier(false);
        }
    }

    useEffect(() => {
        if (queuedSessionRef.current === runwieldSessionId) return;
        queuedSessionRef.current = runwieldSessionId;
        setQueuedMessages([]);
    }, [runwieldSessionId]);

    useEffect(() => {
        didPinInitialTimelineRef.current = false;
        followingLiveEdgeRef.current = true;
        setFollowingLiveEdge(true);
        setLatestActivityAvailable(false);
        if (mode === "list") loadList(listPage);
        if (mode === "detail") {
            timelineRef.current = null;
            setTimeline(null);
            setLoadingDetail(true);
            loadTimeline();
            loadSessionOptions();
        }
        if (mode === "new") {
            setTimeline(null);
            setTimelineItems([]);
            setPendingUserMessages([]);
            setTransientItems([]);
            setDetailError("");
            setLoadingDetail(false);
            loadSessionOptions();
        }
    }, [mode, projectId, runwieldSessionId, listPage]);

    useEffect(() => {
        if (!draftKey) return;
        let cancelled = false;
        setLoadedDraftKey("");
        void loadSessionDrafts([draftKey, attachmentsKey, requestKey]).then(() => {
            if (cancelled) return;
            const storedDraft = readSessionDraft(draftKey) || "";
            setDraft(storedDraft);
            const storedAttachments = readStored(attachmentsKey);
            setImageAttachments(Array.isArray(storedAttachments) ? storedAttachments : []);
            setOperation(null);
            const storedRequest = asRecord(readStored(requestKey));
            if (storedRequest.operationId) {
                setOperation({
                    operationId: String(storedRequest.operationId),
                    status: "running",
                    observed: 0,
                    attempts: 0,
                    restored: true,
                });
                setMessage(
                    "Reconnected.",
                );
            } else if (storedRequest.requestId && storedRequest.status === "network-error") {
                setMessage("The connection was interrupted. Send again to retry your message.");
            }
            setLoadedDraftKey(draftKey);
        });
        return () => {
            cancelled = true;
        };
    }, [draftKey, requestKey, attachmentsKey]);

    useEffect(() => {
        if (!draftKey || loadedDraftKey !== draftKey) return;
        if (draft) saveSessionDraft(draftKey, draft);
        else saveSessionDraft(draftKey, null);
    }, [draft, draftKey, loadedDraftKey]);

    useEffect(() => {
        if (!attachmentsKey || loadedDraftKey !== draftKey) return;
        void saveSessionDraft(attachmentsKey, imageAttachments.length ? JSON.stringify(imageAttachments) : null)
            .then((saved) => {
                if (!saved && imageAttachments.length) {
                    setMessage("Image kept in this tab. Browser storage is unavailable; send before closing it.");
                }
            });
    }, [attachmentsKey, imageAttachments, draftKey, loadedDraftKey]);

    const availability = useMemo(() =>
        deriveSessionAvailability({
            state: timeline?.state,
            activeSurface: timeline?.activeSurface,
            bootstrapRequired: timeline?.bootstrapRequired,
            generation: timeline?.generation,
            snapshot: timeline?.snapshot,
            timelineComplete: timeline?.complete !== false,
            truncated: timeline?.truncated,
            localOperationActive: Boolean(operation && !["completed", "failed", "unknown"].includes(operation.status)),
        }), [listData, timeline, operation]);

    useEffect(() => {
        if (!timeline || !runwieldSessionId || sidebarSessionRef.current === runwieldSessionId) return;
        sidebarSessionRef.current = runwieldSessionId;
        setSessionSidebarTab(defaultSessionSidebarTab(Boolean(activePlanId(timeline.snapshot))));
    }, [timeline, runwieldSessionId]);

    async function createSession() {
        const text = draft;
        if (
            (!text.trim() && !imageAttachments.length) || submitting || attachingImages || loadedDraftKey !== draftKey
        ) return;
        scrollToLiveEdge();
        setSubmitting(true);
        setMessage("");
        const [selectedProvider, selectedModel] = selectedModelKey ? selectedModelKey.split("\u001f") : ["", ""];
        const existing = asRecord(readStored(requestKey));
        const envelope = existing.requestId && existing.status === "network-error" ? existing : {
            requestId: crypto.randomUUID(),
            text,
            images: imageAttachments.map(serializeSessionImageForRequest),
            agentName: selectedAgent,
            model: selectedModel || "",
            provider: selectedProvider || "",
            thinkingLevel: selectedThinking,
            status: "pending",
            createdAt: new Date().toISOString(),
        };
        await saveSessionDraft(requestKey, JSON.stringify(envelope));
        setPendingUserMessages([{
            kind: "message",
            role: "user",
            key: `pending-user:${envelope.requestId}`,
            text: envelope.text,
            images: envelope.images,
            source: "transient",
        }]);
        try {
            const payload = await ownerFetch(`/api/owner/projects/${encodeURIComponent(projectId)}/sessions`, {
                method: "POST",
                body: JSON.stringify({
                    requestId: envelope.requestId,
                    text: envelope.text,
                    images: envelope.images || [],
                    agentName: envelope.agentName,
                    model: envelope.model,
                    provider: envelope.provider,
                    thinkingLevel: envelope.thinkingLevel,
                }),
            });
            setDraft("");
            setImageAttachments([]);
            const stored = {
                ...envelope,
                status: payload.status || "running",
                operationId: payload.operationId,
                responseAccepted: true,
            };
            await saveSessionDraft(requestKey, JSON.stringify(stored));
            if (payload.runwieldSessionId) {
                await saveSessionDraft(sessionRequestKey(projectId, payload.runwieldSessionId), JSON.stringify(stored));
                await saveSessionDraft(requestKey, null);
                workspaceNavigate(
                    `/projects/${encodeURIComponent(projectId)}/sessions/${
                        encodeURIComponent(payload.runwieldSessionId)
                    }`,
                    "replace",
                );
                return;
            }
            if (payload.operationId) {
                setOperation({
                    operationId: payload.operationId,
                    status: payload.status || "running",
                    observed: 0,
                    attempts: 0,
                });
                setMessage("");
            }
        } catch (error) {
            await saveSessionDraft(requestKey, JSON.stringify({ ...envelope, status: "network-error" }));
            setMessage(errorMessage(error));
        } finally {
            setSubmitting(false);
        }
    }

    async function handleComposerFiles(files) {
        if (!files.length || attachingImages) return;
        setAttachingImages(true);
        try {
            const images = await Promise.all(files.map(readPastedImage));
            const size = [...imageAttachments, ...images].reduce((total, image) => total + image.base64.length, 0);
            if (size > 10 * 1024 * 1024) {
                throw new Error(
                    "These images are too large to send together. Remove an image or choose smaller files.",
                );
            }
            setImageAttachments((current) => [...current, ...images]);
            setMessage(`${files.length} image${files.length === 1 ? "" : "s"} attached.`);
        } catch (error) {
            setMessage(errorMessage(error));
        } finally {
            setAttachingImages(false);
        }
    }

    async function handleComposerPaste(event) {
        const files = new Map();
        for (const file of Array.from(event.clipboardData?.files || [])) {
            if (file.type.startsWith("image/")) files.set(`${file.name}:${file.size}`, file);
        }
        for (const item of Array.from(event.clipboardData?.items || [])) {
            if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
            const file = item.getAsFile();
            if (file) files.set(`${file.name}:${file.size}`, file);
        }
        if (!files.size) return;
        event.preventDefault();
        const pastedText = event.clipboardData.getData("text/plain");
        if (pastedText) {
            const input = event.currentTarget;
            setDraft(draft.slice(0, input.selectionStart) + pastedText + draft.slice(input.selectionEnd));
        }
        await handleComposerFiles([...files.values()]);
    }

    /** @param {string} id */
    function removeImageAttachment(id) {
        setImageAttachments((current) => current.filter((image) => image.id !== id));
    }

    async function configureSession(change) {
        if (!Number.isInteger(timeline?.generation)) return;
        setMessage("");
        try {
            const result = await ownerFetch(
                `/api/owner/projects/${encodeURIComponent(projectId)}/sessions/${
                    encodeURIComponent(runwieldSessionId)
                }/configure`,
                {
                    method: "POST",
                    body: JSON.stringify({ expectedGeneration: timeline.generation, ...change }),
                },
            );
            setPendingConfiguration(result.pendingConfiguration || null);
            if (change.thinkingLevel) setLiveThinkingLevel(String(change.thinkingLevel));
            setMessage(result.status === "staged" ? "Applies after this response." : "Session settings updated.");
            const currentOperation = operationRef.current;
            if (result.status !== "staged" && !currentOperation?.operationId) await loadTimeline();
        } catch (error) {
            setMessage(errorMessage(error));
        }
    }

    async function cancelOperation() {
        if (!operation?.operationId) return;
        setMessage("");
        try {
            await ownerFetch(`/api/owner/session-operations/${encodeURIComponent(operation.operationId)}/cancel`, {
                method: "POST",
                body: JSON.stringify({}),
            });
            setMessage("Stop requested.");
        } catch (error) {
            setMessage(errorMessage(error));
        }
    }

    /** @param {Record<string, any>} envelope @param {Record<string, any>} payload */
    function acceptContinuation(envelope, payload) {
        setPendingUserMessages((messages) => [
            ...messages,
            {
                kind: "message",
                role: "user",
                key: `pending-user:${envelope.requestId}`,
                text: envelope.text,
                images: envelope.images,
                timestamp: envelope.createdAt,
                source: "transient",
            },
        ]);
        const stored = {
            ...envelope,
            status: payload.status || "running",
            operationId: payload.operationId,
            responseAccepted: true,
        };
        saveSessionDraft(requestKey, JSON.stringify(stored));
        setOperationStreamFailed(false);
        setOperation({
            operationId: payload.operationId,
            status: payload.status || "running",
            observed: 0,
            attempts: 0,
        });
        setMessage("");
    }

    /** @param {Record<string, any>} envelope */
    async function postContinuation(envelope) {
        return await ownerFetch(
            `/api/owner/projects/${encodeURIComponent(projectId)}/sessions/${
                encodeURIComponent(runwieldSessionId)
            }/continue`,
            {
                method: "POST",
                body: JSON.stringify({
                    requestId: envelope.requestId,
                    expectedGeneration: envelope.expectedGeneration,
                    text: envelope.text,
                    images: Array.isArray(envelope.images) ? envelope.images : [],
                }),
            },
        );
    }

    /** @param {Record<string, any>} envelope */
    function queueContinuation(envelope) {
        setQueuedMessages((current) => [
            ...current,
            {
                id: String(envelope.requestId),
                text: String(envelope.text || ""),
                images: Array.isArray(envelope.images) ? envelope.images : [],
                queuedAt: String(envelope.createdAt || new Date().toISOString()),
            },
        ]);
        saveSessionDraft(requestKey, null);
        setDraft("");
        setImageAttachments([]);
        setMessage("Message queued in this browser tab. It will send when this Session becomes available.");
    }

    async function sendRequest(queueOnly = false) {
        const text = draft;
        const canSubmit = availability.canContinue || ["active", "workspace-running"].includes(availability.key);
        if (
            (!text.trim() && imageAttachments.length === 0) || !canSubmit || submitting || attachingImages ||
            loadedDraftKey !== draftKey || !timeline
        ) {
            return;
        }
        if (!queueOnly) scrollToLiveEdge();
        setSubmitting(true);
        setMessage("");
        const freshTimeline = timelineRef.current;
        if (!freshTimeline) {
            setSubmitting(false);
            setMessage("Could not refresh the Session state before sending. Try again.");
            return;
        }
        const existing = asRecord(readStored(requestKey));
        const envelope = existing.requestId && existing.status === "network-error" ? existing : {
            requestId: crypto.randomUUID(),
            expectedGeneration: freshTimeline.generation,
            text,
            images: imageAttachments.map(serializeSessionImageForRequest),
            status: "pending",
            createdAt: new Date().toISOString(),
        };
        if (freshTimeline.state === "active" || operationRef.current) {
            try {
                if (!queueOnly && operationRef.current) {
                    const result = await ownerFetch(
                        `/api/owner/projects/${encodeURIComponent(projectId)}/session-operations/${
                            encodeURIComponent(operationRef.current.operationId)
                        }/steer`,
                        {
                            method: "POST",
                            body: JSON.stringify({
                                requestId: envelope.requestId,
                                text: envelope.text,
                                images: envelope.images,
                            }),
                        },
                    );
                    if (result.ok && result.queued) {
                        setDraft("");
                        setImageAttachments([]);
                        setMessage("");
                        return;
                    }
                }
                queueContinuation(envelope);
            } catch (error) {
                setMessage(errorMessage(error));
            } finally {
                setSubmitting(false);
            }
            return;
        }
        await saveSessionDraft(requestKey, JSON.stringify(envelope));
        try {
            const payload = await postContinuation(envelope);
            setDraft("");
            setImageAttachments([]);
            acceptContinuation(envelope, payload);
        } catch (error) {
            const errorRecord = asRecord(error);
            const status = Number(errorRecord.status || 0);
            if (status === 409) {
                await loadTimeline();
                queueContinuation(envelope);
                return;
            }
            const nextStatus = status === 503 ? "unavailable" : "network-error";
            await saveSessionDraft(requestKey, JSON.stringify({ ...envelope, status: nextStatus }));
            if (status === 503) await loadTimeline();
            setMessage(errorMessage(error));
        } finally {
            setSubmitting(false);
        }
    }

    async function applyOperationSnapshot(current, payload) {
        const events = Array.isArray(payload.events) ? payload.events : [];
        let items = reduceOperationTransientItems(events);
        if (payload.liveInteraction?.interactionId) {
            const request = payload.liveInteraction.request || {};
            const isPlanReview = request.type === "plan_review";
            const isCodeReview = request.type === "code_review";
            items = [...items, {
                kind: isPlanReview ? "plan-review" : isCodeReview ? "code-review" : "interaction",
                key: `interaction:${payload.liveInteraction.interactionId}`,
                interactionId: payload.liveInteraction.interactionId,
                operationId: current.operationId,
                request,
                reviewUrl: request.reviewUrl,
                source: "transient",
            }];
        }
        setTransientItems(items);
        const next = {
            operationId: current.operationId,
            remote: payload.remote === true,
            status: payload.status || "unknown",
            observed: events.length,
            attempts: current.attempts + 1,
        };
        setOperation(next);
        setPendingConfiguration(payload.pendingConfiguration || null);
        setSteeringMessages((payload.queuedMessages || []).filter((item) => item.delivery === "steer"));
        if (mode === "new" && payload.runwieldSessionId) {
            if (operationNavigationRef.current) return;
            operationNavigationRef.current = true;
            await saveSessionDraft(
                sessionRequestKey(projectId, payload.runwieldSessionId),
                JSON.stringify({ ...asRecord(readStored(requestKey)), operationId: current.operationId }),
            );
            await saveSessionDraft(requestKey, null);
            workspaceNavigate(
                `/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(payload.runwieldSessionId)}`,
                "replace",
            );
            return;
        }
        if (!["completed", "failed", "unknown"].includes(next.status)) return;
        if (next.status === "failed") {
            const failedRequest = asRecord(readStored(requestKey));
            if (typeof failedRequest.text === "string") {
                setDraft(failedRequest.text);
                const images = Array.isArray(failedRequest.images) ? failedRequest.images : [];
                const attachments = images.map((image, index) => ({
                    ...image,
                    id: crypto.randomUUID(),
                    name: `Image ${index + 1}`,
                }));
                setImageAttachments(attachments);
                await saveSessionDraft(draftKey, failedRequest.text);
                await saveSessionDraft(attachmentsKey, JSON.stringify(attachments));
            }
            await saveSessionDraft(requestKey, null);
        }
        if (next.status === "completed") {
            await saveSessionDraft(requestKey, null);
            setMessage("");
        } else {
            if (next.status === "unknown") setInterruptedOperation(true);
            setMessage(
                next.status === "unknown"
                    ? "The agent was interrupted. Ask it to continue."
                    : payload.error || "The response failed. Your conversation is saved.",
            );
        }
        setPendingConfiguration(null);
        setOperationStreamFailed(false);
        setOperation(null);
        setTransientItems([]);
        operationRef.current = null;
        document.dispatchEvent(new CustomEvent("runwield:session-updated"));
        await loadTimeline();
    }

    useEffect(() => {
        if (!operation?.operationId) return undefined;
        let cancelled = false;
        const observeSnapshot = async (current, payload) => {
            if (
                !shouldApplyOperationPoll({
                    cancelled,
                    currentOperationId: operationRef.current?.operationId,
                    polledOperationId: current.operationId,
                })
            ) return;
            observeOperationBrowserNotifications(
                { ...current, scopeKey: notificationScopeKey },
                payload,
                notificationCursorRef,
            );
            await applyOperationSnapshot(current, payload);
        };
        if (typeof EventSource !== "undefined" && !operationStreamFailed && !operation.remote) {
            const source = new EventSource(
                `/api/owner/session-operations/${encodeURIComponent(operation.operationId)}/stream`,
            );
            source.onmessage = (event) => {
                const current = operationRef.current;
                if (!current || cancelled) return;
                try {
                    void observeSnapshot(current, JSON.parse(event.data)).catch((error) =>
                        setMessage(errorMessage(error))
                    );
                } catch (error) {
                    setMessage(`Observation interrupted: ${errorMessage(error)}.`);
                }
            };
            source.onerror = () => {
                if (cancelled) return;
                setMessage("");
                setOperationStreamFailed(true);
                source.close();
            };
            return () => {
                cancelled = true;
                source.close();
            };
        }
        const tick = async () => {
            const current = operationRef.current;
            if (!current || cancelled) return;
            try {
                const payload = await ownerFetch(
                    `/api/owner/session-operations/${encodeURIComponent(current.operationId)}`,
                    { method: "GET" },
                );
                await observeSnapshot(current, payload);
            } catch (error) {
                if (!cancelled) {
                    setMessage(
                        `Observation interrupted: ${errorMessage(error)}. The server-owned operation was not canceled.`,
                    );
                }
            }
        };
        const id = setInterval(tick, POLL_INTERVAL_MS);
        tick();
        return () => {
            cancelled = true;
            clearInterval(id);
        };
    }, [
        operation?.operationId,
        operation?.remote,
        operationStreamFailed,
        requestKey,
        mode,
        projectId,
        notificationScopeKey,
    ]);

    useEffect(() => {
        if (
            loadedDraftKey !== draftKey || !shouldRefreshSessionAvailability({
                mode,
                state: timeline?.state,
                localOperationActive: Boolean(operation?.operationId),
                queuedMessageCount: queuedMessages.length,
            })
        ) return undefined;
        let cancelled = false;
        let refreshing = false;
        const refresh = async () => {
            if (refreshing || cancelled) return;
            refreshing = true;
            try {
                const live = await ownerFetch(
                    `/api/owner/projects/${encodeURIComponent(projectId)}/sessions/${
                        encodeURIComponent(runwieldSessionId)
                    }/live`,
                );
                if (cancelled) return;
                if (live.generation !== timelineRef.current?.generation || live.state !== timelineRef.current?.state) {
                    await loadTimeline();
                }
                if (live.operation && !operationRef.current && !cancelled) {
                    document.dispatchEvent(new CustomEvent("runwield:session-updated"));
                    const current = { operationId: live.operation.operationId, attempts: 0 };
                    await applyOperationSnapshot(current, live.operation);
                }
            } catch (error) {
                if (!cancelled) setMessage(errorMessage(error));
            } finally {
                refreshing = false;
            }
        };
        const refreshWhenVisible = () => {
            if (document.visibilityState === "visible") refresh();
        };
        globalThis.addEventListener("focus", refresh);
        document.addEventListener("visibilitychange", refreshWhenVisible);
        const id = setInterval(refresh, POLL_INTERVAL_MS);
        void refresh();
        return () => {
            cancelled = true;
            globalThis.removeEventListener("focus", refresh);
            document.removeEventListener("visibilitychange", refreshWhenVisible);
            clearInterval(id);
        };
    }, [
        mode,
        timeline?.state,
        queuedMessages.length,
        operation?.operationId,
        projectId,
        runwieldSessionId,
        loadedDraftKey,
        draftKey,
    ]);

    useEffect(() => {
        if (
            mode !== "detail" || timeline?.state !== "idle" || operation?.operationId || queuedMessages.length === 0
        ) return undefined;
        let cancelled = false;
        const sendOldestQueuedMessage = async () => {
            if (cancelled || queuedDispatchActiveRef.current) return;
            const queued = queuedMessages[0];
            if (!queued) return;
            queuedDispatchActiveRef.current = true;
            setSubmitting(true);
            try {
                const freshTimeline = await loadTimeline();
                if (
                    cancelled || !freshTimeline || freshTimeline.state !== "idle"
                ) return;
                const envelope = {
                    requestId: queued.id,
                    expectedGeneration: freshTimeline.generation,
                    text: queued.text,
                    images: queued.images,
                    status: "pending",
                    createdAt: queued.queuedAt,
                };
                saveSessionDraft(requestKey, JSON.stringify(envelope));
                try {
                    const payload = await postContinuation(envelope);
                    if (cancelled) return;
                    setQueuedMessages((current) => current.filter((item) => item.id !== queued.id));
                    acceptContinuation(envelope, payload);
                } catch (error) {
                    saveSessionDraft(requestKey, null);
                    const status = Number(asRecord(error).status || 0);
                    if (status === 409 || status === 503) await loadTimeline();
                    if (!cancelled) {
                        setMessage(`${errorMessage(error)} Message remains queued in this browser tab.`);
                    }
                }
            } finally {
                queuedDispatchActiveRef.current = false;
                if (!cancelled) setSubmitting(false);
            }
        };
        void sendOldestQueuedMessage();
        const id = setInterval(sendOldestQueuedMessage, AVAILABILITY_REFRESH_INTERVAL_MS);
        return () => {
            cancelled = true;
            clearInterval(id);
        };
    }, [mode, timeline?.state, queuedMessages, operation?.operationId, projectId, runwieldSessionId, requestKey]);

    useEffect(() => {
        if (mode !== "detail" || !timeline) {
            setWorkflowProgress(null);
            setWorkflowProgressError("");
            return;
        }
        const apiUrl = activePlanProgressApiUrl(projectId, runwieldSessionId, timeline.snapshot);
        if (!apiUrl) {
            setWorkflowProgress(null);
            setWorkflowProgressError("");
            return;
        }
        let cancelled = false;
        setWorkflowProgressError("");
        ownerFetch(apiUrl, { method: "GET" })
            .then((payload) => {
                if (!cancelled) setWorkflowProgress(payload);
            })
            .catch((error) => {
                if (!cancelled) {
                    setWorkflowProgress(null);
                    setWorkflowProgressError(errorMessage(error));
                }
            });
        return () => {
            cancelled = true;
        };
    }, [mode, projectId, runwieldSessionId, timeline]);

    function scrollToLiveEdge() {
        const scroller = timelineScrollRef.current;
        if (scroller) scroller.scrollTop = scroller.scrollHeight;
        followingLiveEdgeRef.current = true;
        setFollowingLiveEdge(true);
        setLatestActivityAvailable(false);
    }

    function updateScrollFollowState() {
        const scroller = timelineScrollRef.current;
        if (!scroller) return;
        const atLiveEdge = isAtLiveScrollEdge(scroller);
        followingLiveEdgeRef.current = atLiveEdge;
        setFollowingLiveEdge(atLiveEdge);
        if (atLiveEdge) setLatestActivityAvailable(false);
    }

    useLayoutEffect(() => {
        if (mode !== "detail" && mode !== "new") return;
        const scroller = timelineScrollRef.current;
        if (!scroller) return;
        const shouldPinInitial = !didPinInitialTimelineRef.current && (mode === "new" || !loadingDetail);
        if (shouldPinInitial || followingLiveEdgeRef.current) {
            scroller.scrollTop = scroller.scrollHeight;
            didPinInitialTimelineRef.current = true;
            followingLiveEdgeRef.current = true;
            setFollowingLiveEdge(true);
            setLatestActivityAvailable(false);
            return;
        }
        setLatestActivityAvailable(true);
    }, [mode, loadingDetail, timelineItems, transientItems, pendingUserMessages, interruptedOperation]);

    useEffect(() => {
        if (!operation?.operationId) return undefined;
        const onKeyDown = (event) => {
            if (event.key === "Escape" && !event.defaultPrevented && !document.querySelector("dialog[open]")) {
                cancelOperation();
            }
        };
        globalThis.addEventListener("keydown", onKeyDown);
        return () => globalThis.removeEventListener("keydown", onKeyDown);
    }, [operation?.operationId]);

    async function answerInteraction(operationId, interactionId, response) {
        try {
            await ownerFetch(
                `/api/owner/projects/${encodeURIComponent(projectId)}/session-operations/${
                    encodeURIComponent(operationId)
                }/interactions/${encodeURIComponent(interactionId)}/answer`,
                {
                    method: "POST",
                    body: JSON.stringify({
                        response,
                        requestId: crypto.randomUUID(),
                        runwieldSessionId: runwieldSessionId || undefined,
                    }),
                },
            );
            setMessage("");
        } catch (error) {
            const message = errorMessage(error);
            setMessage(message);
            throw new Error(message);
        }
    }

    if (mode === "list") {
        return (
            <SessionList
                projectId={projectId}
                data={listData}
                loading={loadingList}
                error={listError}
                onRetry={() => loadList(listPage)}
                onPageChange={setListPage}
            />
        );
    }

    if (mode === "new") {
        const newSessionItems = [
            ...(transientItems.some((item) => item.kind === "message" && item.role === "user")
                ? []
                : pendingUserMessages),
            ...transientItems.map((item) =>
                item.kind === "interaction"
                    ? {
                        ...item,
                        onAnswer: (response) => answerInteraction(item.operationId, item.interactionId, response),
                    }
                    : item
            ),
            ...(interruptedOperation ? [{ kind: "interruption", key: "interruption:lost-workspace-operation" }] : []),
        ];
        const canSendNew = !submitting && !attachingImages && loadedDraftKey === draftKey && !operation?.operationId;
        const agents = Array.isArray(sessionOptions?.agents) ? sessionOptions.agents : [];
        const models = Array.isArray(sessionOptions?.models) ? sessionOptions.models : [];
        const thinkingLevels = Array.isArray(sessionOptions?.thinkingLevels) ? sessionOptions.thinkingLevels : [];
        return (
            <section className="session-surface session-surface-detail" aria-label="RunWield Session chat">
                {optionsError
                    ? (
                        <p className="rw-plan-review-dev-notice session-dev-shell-bar" role="status">
                            {optionsError}
                        </p>
                    )
                    : null}
                <div className="session-detail-layout session-detail-layout--chat-only">
                    <main className="session-stream-panel" aria-label="Session stream">
                        <div
                            className="session-timeline-scroll"
                            ref={timelineScrollRef}
                            onScroll={updateScrollFollowState}
                        >
                            <div className="session-surface-status" aria-live="polite">{message}</div>
                            <SessionTimeline items={newSessionItems} emptyMessage="" />
                            <div ref={timelineEndRef} aria-hidden="true" />
                        </div>
                        <SessionComposer
                            id="new-session-request-text"
                            draft={draft}
                            disabled={!canSendNew}
                            canSend={canSendNew && Boolean(draft.trim() || imageAttachments.length)}
                            submitting={submitting || Boolean(operation?.operationId)}
                            onDraftChange={setDraft}
                            onSubmit={createSession}
                            onStop={operation?.operationId ? cancelOperation : undefined}
                            onPaste={handleComposerPaste}
                            onFiles={handleComposerFiles}
                            imageAttachments={imageAttachments}
                            onRemoveImage={removeImageAttachment}
                            agents={agents}
                            models={models}
                            thinkingLevels={thinkingLevels}
                            agentValue={selectedAgent}
                            modelValue={selectedModelKey}
                            thinkingValue={selectedThinking}
                            onAgentChange={setSelectedAgent}
                            onModelChange={setSelectedModelKey}
                            onThinkingChange={setSelectedThinking}
                            agentFallback={agents.length ? null : <option value="router">Router</option>}
                            modelFallback={<option value="">Project default</option>}
                            thinkingFallback={<option value="default">Default</option>}
                        />
                    </main>
                </div>
            </section>
        );
    }

    const allItems = [
        ...timelineItems,
        ...(transientItems.some((item) => item.kind === "message" && item.role === "user") ? [] : pendingUserMessages),
        ...transientItems.map((item) =>
            item.kind === "interaction"
                ? {
                    ...item,
                    onAnswer: (response) => answerInteraction(item.operationId, item.interactionId, response),
                }
                : item
        ),
        ...(interruptedOperation ? [{ kind: "interruption", key: "interruption:lost-workspace-operation" }] : []),
    ];
    const activeExecutionWorkflow = asRecord(timeline?.snapshot?.activeExecutionWorkflow || {});
    const persistedWorkflowContext = asRecord(timeline?.snapshot?.workflowContext || {});
    const workflowContext = Object.keys(activeExecutionWorkflow).length
        ? activeExecutionWorkflow
        : persistedWorkflowContext;
    const activeWorkflowTriageMeta = asRecord(activeExecutionWorkflow.triageMeta || {});
    const workflowEpic = activeExecutionWorkflow.planName
        ? typeof activeWorkflowTriageMeta.parentPlan === "string" ? activeWorkflowTriageMeta.parentPlan : ""
        : typeof persistedWorkflowContext.parentPlan === "string"
        ? persistedWorkflowContext.parentPlan
        : "";
    const workflowSidebar = buildSessionSidebarProjection({
        workflowPlan: typeof workflowContext.planName === "string"
            ? workflowContext.planName
            : typeof workflowContext.planId === "string"
            ? workflowContext.planId
            : "",
        workflowEpic,
        workflowIntent: typeof persistedWorkflowContext.routingIntent === "string"
            ? persistedWorkflowContext.routingIntent
            : "",
    }).workflow;
    const progressUrl = timeline ? activePlanProgressUrl(projectId, runwieldSessionId, timeline.snapshot) : "";
    const agents = Array.isArray(sessionOptions?.agents) ? sessionOptions.agents : [];
    const models = Array.isArray(sessionOptions?.models) ? sessionOptions.models : [];
    const thinkingLevels = Array.isArray(sessionOptions?.thinkingLevels) ? sessionOptions.thinkingLevels : [];
    const activeModel = asRecord(timeline?.snapshot?.activeModel || {});
    const activeProvider = typeof activeModel.provider === "string"
        ? activeModel.provider
        : timeline?.snapshot?.provider || "";
    const activeModelId = typeof activeModel.model === "string" ? activeModel.model : timeline?.snapshot?.model || "";
    const activeModelKey = activeModelId ? `${activeProvider}\u001f${activeModelId}` : "";
    const activeThinking = typeof timeline?.snapshot?.thinkingLevel === "string"
        ? timeline.snapshot.thinkingLevel
        : "default";
    const hasActivePlan = Boolean(workflowContext.planId || workflowContext.planName || progressUrl);
    const workflowStages = deriveWorkflowSidebarStages(workflowProgress);
    const localOperationActive = Boolean(operation && !["completed", "failed", "unknown"].includes(operation.status));
    const canConfigureSession = availability.canContinue || (localOperationActive && !operation?.remote);
    const stagedAgent = pendingConfiguration?.agentName || timeline?.snapshot?.activeAgent || "";
    const stagedModelKey = pendingConfiguration?.model
        ? `${pendingConfiguration.provider || ""}\u001f${pendingConfiguration.model}`
        : activeModelKey;
    const displayedThinking = liveThinkingLevel || activeThinking;
    const showBusyPanel = ["active", "workspace-running", "execution-workflow"].includes(availability.key);
    const canSubmitSession = availability.canContinue || ["active", "workspace-running"].includes(availability.key);
    const sessionSidebar = buildSessionSidebarProjection({
        sessionName: timeline?.snapshot?.name,
        ...timeline?.snapshot?.sessionStats,
        queuedMessages: queuedMessages.length,
        contextUsedTokens: timeline?.snapshot?.contextUsage?.tokens,
        contextWindowTokens: timeline?.snapshot?.contextUsage?.contextWindow,
        contextPercent: timeline?.snapshot?.contextUsage?.percent,
        systemContextTokens: timeline?.snapshot?.systemContextTokens,
    }).session;
    return (
        <section className="session-surface session-surface-detail" aria-label="RunWield Session chat">
            {timeline && contextCollapsed && (
                <WorkspaceHeaderActionsPortal>
                    <RunWieldPanelToggle
                        side="right"
                        collapsed
                        label="Session sidebar"
                        controls="session-context-sidebar"
                        onClick={toggleContext}
                    />
                </WorkspaceHeaderActionsPortal>
            )}
            {loadingDetail && !timeline
                ? (
                    <p className="session-list-state" aria-busy="true">
                        <RunWieldThinkingDots label="Loading conversation" />
                    </p>
                )
                : null}
            {detailError
                ? (
                    <section className="error-panel" role="alert">
                        <h2>Session failed to load</h2>
                        <p>{detailError}</p>
                        <RunWieldButton type="button" onClick={loadTimeline}>Retry</RunWieldButton>
                    </section>
                )
                : null}
            {timeline
                ? (
                    <div
                        className={`session-detail-layout${
                            contextCollapsed ? " session-detail-layout--chat-only" : ""
                        }`}
                    >
                        <main className="session-stream-panel" aria-label="Session stream">
                            <div
                                className="session-timeline-scroll"
                                ref={timelineScrollRef}
                                onScroll={updateScrollFollowState}
                            >
                                {loadingDetail
                                    ? (
                                        <div className="session-inline-loader" aria-live="polite" aria-busy="true">
                                            <RunWieldThinkingDots label="Updating conversation" />
                                        </div>
                                    )
                                    : message
                                    ? <div className="session-surface-status" aria-live="polite">{message}</div>
                                    : null}
                                {showBusyPanel ? <SessionBusyPanel /> : null}
                                {latestActivityAvailable
                                    ? (
                                        <div className="session-scroll-offer" role="status">
                                            <span>New activity is available.</span>
                                            <button type="button" onClick={scrollToLiveEdge}>
                                                Latest activity
                                            </button>
                                        </div>
                                    )
                                    : null}
                                {timeline.previousCursor
                                    ? (
                                        <RunWieldButton
                                            type="button"
                                            onClick={loadEarlierMessages}
                                            disabled={loadingEarlier}
                                        >
                                            {loadingEarlier ? "Loading…" : "Load earlier messages"}
                                        </RunWieldButton>
                                    )
                                    : null}
                                <SessionTimeline
                                    items={allItems}
                                    sessionPath={`/projects/${encodeURIComponent(projectId)}/sessions/${
                                        encodeURIComponent(runwieldSessionId)
                                    }`}
                                />
                                <div ref={timelineEndRef} aria-hidden="true" />
                            </div>
                            <SessionComposer
                                id="session-request-text"
                                draft={draft}
                                disabled={!canSubmitSession || submitting || attachingImages ||
                                    loadedDraftKey !== draftKey}
                                controlsDisabled={!canConfigureSession}
                                canSend={canSubmitSession && !attachingImages && loadedDraftKey === draftKey &&
                                    Boolean(draft.trim() || imageAttachments.length)}
                                submitting={submitting}
                                onDraftChange={setDraft}
                                onSubmit={() => sendRequest()}
                                onQueue={operation?.operationId ? () => sendRequest(true) : undefined}
                                onStop={operation?.operationId ? cancelOperation : undefined}
                                sendLabel={operation?.operationId
                                    ? "Steer"
                                    : timeline.state === "active"
                                    ? "Queue"
                                    : "Send"}
                                steeringMessages={steeringMessages}
                                onPaste={handleComposerPaste}
                                onFiles={handleComposerFiles}
                                imageAttachments={imageAttachments}
                                onRemoveImage={removeImageAttachment}
                                agents={agents}
                                models={models}
                                thinkingLevels={thinkingLevels}
                                agentValue={stagedAgent}
                                modelValue={stagedModelKey}
                                thinkingValue={displayedThinking}
                                onAgentChange={(agentName) => configureSession({ agentName })}
                                onModelChange={(value) => {
                                    const [provider, model] = value ? value.split("\u001f") : ["", ""];
                                    if (model) configureSession({ provider, model });
                                }}
                                onThinkingChange={(thinkingLevel) => configureSession({ thinkingLevel })}
                                agentFallback={agents.some((agent) => agent.name === timeline.snapshot?.activeAgent)
                                    ? null
                                    : (
                                        <option value={timeline.snapshot?.activeAgent || ""}>
                                            {timeline.snapshot?.activeAgent || "Agent"}
                                        </option>
                                    )}
                                modelFallback={activeModelKey &&
                                        !models.some((model) => `${model.provider}\u001f${model.id}` === activeModelKey)
                                    ? <option value={activeModelKey}>{activeModelId}</option>
                                    : null}
                                thinkingFallback={thinkingLevels.includes(displayedThinking)
                                    ? null
                                    : <option value={displayedThinking}>{displayedThinking}</option>}
                                queuedMessages={queuedMessages}
                            />
                        </main>
                        <aside
                            id="session-context-sidebar"
                            hidden={contextCollapsed}
                            className="session-workflow-sidebar session-context-sidebar"
                            aria-label="Session context"
                        >
                            <div className="session-context-content">
                                <div className="session-context-header">
                                    <RunWieldPanelToggle
                                        side="right"
                                        collapsed={false}
                                        label="Session sidebar"
                                        controls="session-context-sidebar"
                                        onClick={toggleContext}
                                    />
                                    <div
                                        className="session-context-tabs"
                                        role="tablist"
                                        aria-label="Session context views"
                                    >
                                        {SESSION_SIDEBAR_TABS.map((tab) => (
                                            <button
                                                key={tab}
                                                type="button"
                                                role="tab"
                                                aria-selected={sessionSidebarTab === tab}
                                                onClick={() => setSessionSidebarTab(tab)}
                                            >
                                                {tab[0].toUpperCase() + tab.slice(1)}
                                                {tab === "artifacts" && Array.isArray(timeline.artifacts) &&
                                                        timeline.artifacts.length
                                                    ? <span>{timeline.artifacts.length}</span>
                                                    : null}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                {sessionSidebarTab === "workflow"
                                    ? (
                                        <div className="session-context-panel" role="tabpanel">
                                            {hasActivePlan
                                                ? (
                                                    <>
                                                        <dl>
                                                            {workflowSidebar.epic
                                                                ? (
                                                                    <div>
                                                                        <dt>Epic</dt>
                                                                        <dd>{workflowSidebar.epic}</dd>
                                                                    </div>
                                                                )
                                                                : null}
                                                            <div>
                                                                <dt>Plan</dt>
                                                                <dd>{workflowSidebar.plan}</dd>
                                                            </div>
                                                        </dl>
                                                        {workflowProgress
                                                            ? (
                                                                <ol
                                                                    className="session-workflow-stage-list"
                                                                    aria-label="Canonical workflow progress stages"
                                                                >
                                                                    {workflowStages.map((stage) => (
                                                                        <li key={stage.id} data-state={stage.state}>
                                                                            <span>{stage.label}</span>
                                                                            <strong>
                                                                                {String(stage.state || "unknown")
                                                                                    .replaceAll(
                                                                                        "_",
                                                                                        " ",
                                                                                    )}
                                                                            </strong>
                                                                            <p>{stage.detail}</p>
                                                                        </li>
                                                                    ))}
                                                                </ol>
                                                            )
                                                            : (
                                                                <p className="notice muted">
                                                                    {workflowProgressError
                                                                        ? "Workflow progress is temporarily unavailable."
                                                                        : "Loading canonical workflow progress…"}
                                                                </p>
                                                            )}
                                                        {progressUrl && !workflowProgressError
                                                            ? (
                                                                <RunWieldLink
                                                                    variant="primary"
                                                                    className="rw-plan-review-link"
                                                                    href={progressUrl}
                                                                >
                                                                    Open progress
                                                                </RunWieldLink>
                                                            )
                                                            : null}
                                                    </>
                                                )
                                                : (
                                                    <p className="session-context-empty">
                                                        This Session does not have an active Plan workflow.
                                                    </p>
                                                )}
                                        </div>
                                    )
                                    : sessionSidebarTab === "session"
                                    ? (
                                        <div className="session-context-panel" role="tabpanel">
                                            <dl>
                                                {sessionSidebarFields(sessionSidebar).map((field) => (
                                                    <div key={field.label}>
                                                        <dt>{field.label}</dt>
                                                        <dd>{field.value}</dd>
                                                    </div>
                                                ))}
                                            </dl>
                                        </div>
                                    )
                                    : (
                                        <div className="session-context-panel" role="tabpanel">
                                            {Array.isArray(timeline.artifacts) && timeline.artifacts.length
                                                ? (
                                                    <ul className="session-artifact-list">
                                                        {timeline.artifacts.map((artifact) => (
                                                            <li key={artifact.artifactId}>
                                                                <a
                                                                    href={`/projects/${
                                                                        encodeURIComponent(projectId)
                                                                    }/sessions/${
                                                                        encodeURIComponent(runwieldSessionId)
                                                                    }/artifacts/${
                                                                        encodeURIComponent(artifact.artifactId)
                                                                    }`}
                                                                >
                                                                    <span>{artifact.title}</span>
                                                                    <small>
                                                                        {sessionArtifactKindLabel(artifact.kind)}
                                                                    </small>
                                                                </a>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                )
                                                : (
                                                    <p className="session-context-empty">
                                                        Meaningful Markdown outputs will appear here when an agent
                                                        declares them.
                                                    </p>
                                                )}
                                        </div>
                                    )}
                            </div>
                        </aside>
                    </div>
                )
                : null}
        </section>
    );
}

export default SessionSurface;
