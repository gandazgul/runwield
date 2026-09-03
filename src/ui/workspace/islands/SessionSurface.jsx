import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

// New Session chat structure is adapted from OpenChamber's ChatContainer/ChatInput UI.
// OpenChamber is MIT licensed: Copyright (c) 2025 Bohdan Triapitsyn.
import {
    RunWieldButton,
    RunWieldLink,
    RunWieldThinkingDots,
} from "../../design-system/components/react/RunWieldPrimitives.jsx";
import { SessionList } from "../components/SessionList.jsx";
import { deriveSessionAvailability, SessionActivationStatus } from "../components/SessionActivationStatus.jsx";
import { reduceSessionEvents, SessionTimeline } from "../components/SessionTimeline.jsx";
import {
    defaultSessionSidebarTab,
    SESSION_SIDEBAR_TABS,
    sessionArtifactKindLabel,
} from "../../../shared/session/session-sidebar.ts";

export const SESSION_PAGE_SIZE = 30;
const TIMELINE_PAGE_LIMIT = 200;
export const TIMELINE_MAX_PAGES = 10;
export const TIMELINE_MAX_EVENTS = 1500;
const POLL_INTERVAL_MS = 1500;
const AVAILABILITY_REFRESH_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 240;

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
        return JSON.parse(localStorage.getItem(key) || "null");
    } catch {
        return null;
    }
}

/** @param {unknown} error */
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

/** @param {SessionImageAttachmentDraft} image */
export function serializeSessionImageForRequest(image) {
    return { base64: image.base64, mimeType: image.mimeType };
}

/** @param {File} file */
async function readPastedImage(file) {
    if (!file.type.startsWith("image/")) throw new Error("Only pasted images can be attached.");
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
    return reduceSessionEvents(Array.isArray(events) ? events : [], { source: "transient" });
}

/** @param {{ scrollHeight: number, scrollTop: number, clientHeight: number, threshold?: number }} input */
export function isAtLiveScrollEdge(input) {
    const threshold = typeof input.threshold === "number" ? input.threshold : 48;
    return input.scrollHeight - input.scrollTop - input.clientHeight < threshold;
}

/** @param {{ mode: string, state?: string, localOperationActive?: boolean, queuedMessageCount?: number }} input */
export function shouldRefreshSessionAvailability(input) {
    return input.mode === "detail" && input.localOperationActive !== true &&
        (input.state === "active" || (input.queuedMessageCount || 0) > 0);
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

/** @param {string | null | undefined} value */
function sessionSurfaceLabel(value) {
    switch (String(value || "")) {
        case "tui":
            return "TUI";
        case "acp":
            return "ACP";
        case "workspace":
            return "Workspace";
        case "test":
            return "another surface";
        default:
            return String(value || "another surface");
    }
}

/** @param {{ surface?: string | null, canRecover?: boolean, recovering?: boolean, onRecover?: () => void }} props */
function SessionBusyPanel({ surface, canRecover = false, recovering = false, onRecover }) {
    return (
        <section className="session-busy-panel" role="status" aria-live="polite" aria-busy="true">
            <RunWieldThinkingDots label="Session busy" />
            <p>This Session is busy in {sessionSurfaceLabel(surface)}.</p>
            {canRecover
                ? (
                    <RunWieldButton type="button" onClick={onRecover} disabled={recovering}>
                        {recovering ? "Recovering…" : "Recover stale Session"}
                    </RunWieldButton>
                )
                : null}
        </section>
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
    onPaste,
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
    useEffect(() => resizeComposerTextArea(textareaRef.current), [draft]);
    return (
        <form
            className="session-composer"
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
                    if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        onSubmit();
                    }
                }}
                placeholder="Ask RunWield..."
                aria-label="Message"
            />
            {imageAttachments.length
                ? (
                    <ul className="session-image-attachments" aria-label="Attached images">
                        {imageAttachments.map((image) => (
                            <li key={image.id}>
                                <span>{image.name} · {image.mimeType}</span>
                                <button type="button" onClick={() => onRemoveImage?.(image.id)}>Remove</button>
                            </li>
                        ))}
                    </ul>
                )
                : null}
            <div className="session-composer-actions" aria-label="Session settings">
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
                <button
                    type="submit"
                    className="rw-toolbar-button session-send-button"
                    disabled={!canSend || submitting}
                    aria-label={submitting ? "Sending" : "Send"}
                >
                    {submitting ? <RunWieldThinkingDots label="Sending" /> : (
                        <>
                            <PaperAirplaneIcon />
                            <span>Send</span>
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
    const sidebarSessionRef = useRef("");
    const [detailError, setDetailError] = useState("");
    const [loadingDetail, setLoadingDetail] = useState(mode === "detail");
    const [draft, setDraft] = useState("");
    const [imageAttachments, setImageAttachments] = useState(/** @type {SessionImageAttachmentDraft[]} */ ([]));
    const [queuedMessages, setQueuedMessages] = useState(/** @type {WorkspaceQueuedMessage[]} */ ([]));
    const [message, setMessage] = useState("");
    const [operation, setOperation] = useState(
        /** @type {{ operationId: string, status: string, observed: number, attempts: number } | null} */ (null),
    );
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
    const [recoveringSession, setRecoveringSession] = useState(false);
    const [interruptedOperation, setInterruptedOperation] = useState(false);
    const [operationStreamFailed, setOperationStreamFailed] = useState(false);
    const operationRef = useRef(operation);
    operationRef.current = operation;
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

    async function fetchTimeline() {
        let cursor = "";
        /** @type {Array<Record<string, any>>} */
        const events = [];
        let pageCount = 0;
        let payload = null;
        while (pageCount < TIMELINE_MAX_PAGES && events.length <= TIMELINE_MAX_EVENTS) {
            const qs = new URLSearchParams({ limit: String(TIMELINE_PAGE_LIMIT) });
            if (cursor) qs.set("cursorEventId", cursor);
            payload = await ownerFetch(
                `/api/owner/projects/${encodeURIComponent(projectId)}/sessions/${
                    encodeURIComponent(runwieldSessionId)
                }/timeline?${qs}`,
                { method: "GET" },
            );
            events.push(...(Array.isArray(payload.events) ? payload.events : []));
            pageCount += 1;
            if (payload.complete !== false) break;
            if (!payload.nextCursor || payload.nextCursor === cursor) {
                throw new Error("Timeline cursor did not advance.");
            }
            cursor = payload.nextCursor;
        }
        const truncated = Boolean(
            payload?.complete === false || pageCount >= TIMELINE_MAX_PAGES || events.length > TIMELINE_MAX_EVENTS,
        );
        return {
            ...(payload || {}),
            events,
            complete: !truncated && payload?.complete !== false,
            truncated,
        };
    }

    function applyTimeline(nextTimeline) {
        const events = Array.isArray(nextTimeline.events) ? nextTimeline.events : [];
        setTimeline(nextTimeline);
        setTimelineItems(reduceSessionEvents(events, { source: "committed" }));
        setPendingUserMessages((messages) => {
            const committedUserText = new Set(
                events
                    .filter((event) => event?.type === "user_message" && typeof event.text === "string")
                    .map((event) => event.text),
            );
            return messages.filter((item) => !committedUserText.has(item.text));
        });
        setTransientItems([]);
        setPendingConfiguration(null);
        setLiveThinkingLevel("");
        if (nextTimeline.truncated) {
            setMessage(
                "Timeline budget exceeded. Reload this Session to continue from the complete committed timeline.",
            );
        }
    }

    async function loadTimeline() {
        if (!runwieldSessionId) return null;
        setLoadingDetail(true);
        setDetailError("");
        setMessage("");
        try {
            const nextTimeline = await fetchTimeline();
            applyTimeline(nextTimeline);
            return nextTimeline;
        } catch (error) {
            setDetailError(errorMessage(error));
            return null;
        } finally {
            setLoadingDetail(false);
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
        const storedDraft = localStorage.getItem(draftKey) || "";
        if (storedDraft === "Draft request for visual check") {
            localStorage.removeItem(draftKey);
            setDraft("");
        } else {
            setDraft(storedDraft);
        }
        const storedAttachments = readStored(attachmentsKey);
        setImageAttachments(Array.isArray(storedAttachments) ? storedAttachments : []);
        const storedRequest = asRecord(readStored(requestKey));
        if (storedRequest.operationId) {
            setOperation({
                operationId: String(storedRequest.operationId),
                status: "running",
                observed: 0,
                attempts: 0,
            });
            setMessage(
                "Reconnected to an accepted Session operation. Watching progress without replaying the request.",
            );
        } else if (storedRequest.requestId && storedRequest.status === "network-error") {
            setMessage("Previous response was lost. Send will retry the exact same request envelope.");
        }
    }, [draftKey, requestKey, attachmentsKey]);

    useEffect(() => {
        if (!draftKey) return;
        if (draft) localStorage.setItem(draftKey, draft);
        else localStorage.removeItem(draftKey);
    }, [draft, draftKey]);

    useEffect(() => {
        if (!attachmentsKey) return;
        if (imageAttachments.length) localStorage.setItem(attachmentsKey, JSON.stringify(imageAttachments));
        else localStorage.removeItem(attachmentsKey);
    }, [attachmentsKey, imageAttachments]);

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
        if (!text.trim() || submitting) return;
        setSubmitting(true);
        setMessage("");
        const [selectedProvider, selectedModel] = selectedModelKey ? selectedModelKey.split("\u001f") : ["", ""];
        const existing = asRecord(readStored(requestKey));
        const envelope = existing.requestId && existing.status === "network-error" ? existing : {
            requestId: crypto.randomUUID(),
            text,
            agentName: selectedAgent,
            model: selectedModel || "",
            provider: selectedProvider || "",
            thinkingLevel: selectedThinking,
            status: "pending",
            createdAt: new Date().toISOString(),
        };
        localStorage.setItem(requestKey, JSON.stringify(envelope));
        try {
            const payload = await ownerFetch(`/api/owner/projects/${encodeURIComponent(projectId)}/sessions`, {
                method: "POST",
                body: JSON.stringify({
                    requestId: envelope.requestId,
                    text: envelope.text,
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
            localStorage.setItem(requestKey, JSON.stringify(stored));
            if (payload.runwieldSessionId) {
                localStorage.removeItem(requestKey);
                globalThis.location.replace(
                    `/projects/${encodeURIComponent(projectId)}/sessions/${
                        encodeURIComponent(payload.runwieldSessionId)
                    }`,
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
                setMessage("Session creation accepted. Watching progress without replaying on refresh.");
            }
        } catch (error) {
            localStorage.setItem(requestKey, JSON.stringify({ ...envelope, status: "network-error" }));
            setMessage(errorMessage(error));
        } finally {
            setSubmitting(false);
        }
    }

    async function handleComposerPaste(event) {
        const files = Array.from(event.clipboardData?.files || []).filter((file) => file.type.startsWith("image/"));
        if (!files.length) return;
        event.preventDefault();
        try {
            const images = await Promise.all(files.map(readPastedImage));
            setImageAttachments((current) => [...current, ...images]);
            setMessage(`${files.length} image${files.length === 1 ? "" : "s"} attached.`);
        } catch (error) {
            setMessage(errorMessage(error));
        }
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
        localStorage.setItem(requestKey, JSON.stringify(stored));
        setOperationStreamFailed(false);
        setOperation({
            operationId: payload.operationId,
            status: payload.status || "running",
            observed: 0,
            attempts: 0,
        });
        setMessage("Request accepted. Watching progress without replaying on refresh.");
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
        localStorage.removeItem(requestKey);
        setDraft("");
        setImageAttachments([]);
        setMessage("Message queued in this browser tab. It will send when this Session becomes available.");
    }

    async function sendRequest() {
        const text = draft;
        const canSubmit = availability.canContinue || availability.key === "active";
        if ((!text.trim() && imageAttachments.length === 0) || !canSubmit || submitting || !timeline) {
            return;
        }
        setSubmitting(true);
        setMessage("");
        const freshTimeline = await loadTimeline();
        if (!freshTimeline || freshTimeline.truncated || freshTimeline.complete === false) {
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
        if (freshTimeline.state === "active") {
            queueContinuation(envelope);
            setSubmitting(false);
            return;
        }
        localStorage.setItem(requestKey, JSON.stringify(envelope));
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
            localStorage.setItem(requestKey, JSON.stringify({ ...envelope, status: nextStatus }));
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
            status: payload.status || "unknown",
            observed: events.length,
            attempts: current.attempts + 1,
        };
        setOperation(next);
        setPendingConfiguration(payload.pendingConfiguration || null);
        if (!["completed", "failed", "unknown"].includes(next.status)) return;
        if (mode === "new" && payload.runwieldSessionId) {
            localStorage.removeItem(requestKey);
            globalThis.location.replace(
                `/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(payload.runwieldSessionId)}`,
            );
            return;
        }
        if (next.status === "completed") {
            localStorage.removeItem(requestKey);
            setMessage("Operation completed. Reconciled committed timeline.");
        } else {
            if (next.status === "unknown") setInterruptedOperation(true);
            setMessage(
                next.status === "unknown"
                    ? "Operation is unknown after reconnect. Reloaded committed state; do not replay automatically."
                    : payload.error || "Operation failed. Committed state reloaded.",
            );
        }
        setPendingConfiguration(null);
        setOperationStreamFailed(false);
        setOperation(null);
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
            await applyOperationSnapshot(current, payload);
        };
        if (typeof EventSource !== "undefined" && !operationStreamFailed) {
            const source = new EventSource(
                `/api/owner/session-operations/${encodeURIComponent(operation.operationId)}/stream`,
            );
            source.onmessage = (event) => {
                const current = operationRef.current;
                if (!current || cancelled) return;
                try {
                    void observeSnapshot(current, JSON.parse(event.data));
                } catch (error) {
                    setMessage(`Observation interrupted: ${errorMessage(error)}.`);
                }
            };
            source.onerror = () => {
                if (cancelled) return;
                setMessage("Live Session updates paused. Checking operation status safely.");
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
            if (!current || cancelled || current.attempts >= MAX_POLL_ATTEMPTS) return;
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
    }, [operation?.operationId, operationStreamFailed, requestKey, mode, projectId]);

    useEffect(() => {
        if (
            !shouldRefreshSessionAvailability({
                mode,
                state: timeline?.state,
                localOperationActive: Boolean(operation?.operationId),
                queuedMessageCount: queuedMessages.length,
            })
        ) return undefined;
        const refresh = () => {
            void loadTimeline();
        };
        const refreshWhenVisible = () => {
            if (document.visibilityState === "visible") refresh();
        };
        globalThis.addEventListener("focus", refresh);
        document.addEventListener("visibilitychange", refreshWhenVisible);
        const id = setInterval(refresh, AVAILABILITY_REFRESH_INTERVAL_MS);
        return () => {
            globalThis.removeEventListener("focus", refresh);
            document.removeEventListener("visibilitychange", refreshWhenVisible);
            clearInterval(id);
        };
    }, [mode, timeline?.state, queuedMessages.length, operation?.operationId, projectId, runwieldSessionId]);

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
                    cancelled || !freshTimeline || freshTimeline.state !== "idle" || freshTimeline.truncated ||
                    freshTimeline.complete === false
                ) return;
                const envelope = {
                    requestId: queued.id,
                    expectedGeneration: freshTimeline.generation,
                    text: queued.text,
                    images: queued.images,
                    status: "pending",
                    createdAt: queued.queuedAt,
                };
                localStorage.setItem(requestKey, JSON.stringify(envelope));
                try {
                    const payload = await postContinuation(envelope);
                    if (cancelled) return;
                    setQueuedMessages((current) => current.filter((item) => item.id !== queued.id));
                    acceptContinuation(envelope, payload);
                } catch (error) {
                    localStorage.removeItem(requestKey);
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
    }, [mode, loadingDetail, timelineItems.length, transientItems.length, interruptedOperation]);

    useEffect(() => {
        if (!operation?.operationId) return undefined;
        const onKeyDown = (event) => {
            if (event.key === "Escape") cancelOperation();
        };
        globalThis.addEventListener("keydown", onKeyDown);
        return () => globalThis.removeEventListener("keydown", onKeyDown);
    }, [operation?.operationId]);

    async function recoverSessionControl() {
        if (!timeline || typeof timeline.generation !== "number" || recoveringSession) return;
        const confirmed = globalThis.confirm?.(
            "RunWield will recover this Session only if the other surface stopped renewing its lock. Continue?",
        );
        if (!confirmed) return;
        setRecoveringSession(true);
        setMessage("");
        try {
            await ownerFetch(
                `/api/owner/projects/${encodeURIComponent(projectId)}/sessions/${
                    encodeURIComponent(runwieldSessionId)
                }/force-recovery`,
                { method: "POST", body: JSON.stringify({ expectedGeneration: timeline.generation }) },
            );
            await loadTimeline();
            setMessage("Recovered stale Session control. You can send now.");
        } catch (error) {
            setMessage(errorMessage(error));
        } finally {
            setRecoveringSession(false);
        }
    }

    async function answerInteraction(operationId, interactionId, response) {
        try {
            await ownerFetch(
                `/api/owner/projects/${encodeURIComponent(projectId)}/session-operations/${
                    encodeURIComponent(operationId)
                }/interactions/${encodeURIComponent(interactionId)}/answer`,
                { method: "POST", body: JSON.stringify({ response }) },
            );
            setMessage("Interaction answer sent.");
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
        const canSendNew = !submitting && !operation?.operationId;
        const agents = Array.isArray(sessionOptions?.agents) ? sessionOptions.agents : [];
        const models = Array.isArray(sessionOptions?.models) ? sessionOptions.models : [];
        const thinkingLevels = Array.isArray(sessionOptions?.thinkingLevels) ? sessionOptions.thinkingLevels : [];
        return (
            <section className="session-surface session-surface-detail" aria-label="RunWield Session chat">
                {optionsError
                    ? (
                        <p className="rw-plan-review-dev-notice session-dev-shell-bar" role="status">
                            DEV MODE — Owner Session APIs are not connected.
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
                            canSend={canSendNew && Boolean(draft.trim())}
                            submitting={submitting || Boolean(operation?.operationId)}
                            onDraftChange={setDraft}
                            onSubmit={createSession}
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
        ...pendingUserMessages,
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
    const workflowContext = asRecord(
        timeline?.snapshot?.activeExecutionWorkflow || timeline?.snapshot?.workflowContext || {},
    );
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
    const canConfigureSession = availability.canContinue || localOperationActive;
    const stagedAgent = pendingConfiguration?.agentName || timeline?.snapshot?.activeAgent || "";
    const stagedModelKey = pendingConfiguration?.model
        ? `${pendingConfiguration.provider || ""}\u001f${pendingConfiguration.model}`
        : activeModelKey;
    const displayedThinking = liveThinkingLevel || activeThinking;
    const showBusyPanel = ["active", "workspace-running", "execution-workflow"].includes(availability.key);
    const canRecoverBusySession = availability.key === "active" && typeof timeline?.generation === "number";
    const busySurface = timeline?.activeSurface || (operation?.operationId ? "workspace" : null);
    const canSubmitSession = availability.canContinue || availability.key === "active";
    return (
        <section className="session-surface session-surface-detail" aria-label="RunWield Session chat">
            {loadingDetail && !timeline
                ? (
                    <p className="session-list-state" aria-busy="true">
                        <RunWieldThinkingDots label="Loading committed Session timeline" />
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
                    <div className="session-detail-layout">
                        <main className="session-stream-panel" aria-label="Session stream">
                            <div
                                className="session-timeline-scroll"
                                ref={timelineScrollRef}
                                onScroll={updateScrollFollowState}
                            >
                                {loadingDetail
                                    ? (
                                        <div className="session-inline-loader" aria-live="polite" aria-busy="true">
                                            <RunWieldThinkingDots label="Updating committed Session timeline" />
                                        </div>
                                    )
                                    : message
                                    ? <div className="session-surface-status" aria-live="polite">{message}</div>
                                    : null}
                                {showBusyPanel
                                    ? (
                                        <SessionBusyPanel
                                            surface={busySurface}
                                            canRecover={canRecoverBusySession}
                                            recovering={recoveringSession}
                                            onRecover={recoverSessionControl}
                                        />
                                    )
                                    : null}
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
                                <SessionTimeline items={allItems} />
                                <div ref={timelineEndRef} aria-hidden="true" />
                            </div>
                            <SessionComposer
                                id="session-request-text"
                                draft={draft}
                                disabled={!canSubmitSession || submitting}
                                controlsDisabled={!canConfigureSession}
                                canSend={canSubmitSession && Boolean(draft.trim() || imageAttachments.length)}
                                submitting={submitting}
                                onDraftChange={setDraft}
                                onSubmit={sendRequest}
                                onPaste={handleComposerPaste}
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
                            className="session-workflow-sidebar session-context-sidebar"
                            aria-label="Session context"
                        >
                            <div className="session-context-tabs" role="tablist" aria-label="Session context views">
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
                            {sessionSidebarTab === "workflow"
                                ? (
                                    <div className="session-context-panel" role="tabpanel">
                                        <p className="kicker">Workflow state</p>
                                        {hasActivePlan
                                            ? (
                                                <>
                                                    <dl>
                                                        <div>
                                                            <dt>Plan</dt>
                                                            <dd>
                                                                {workflowContext.planName || workflowContext.planId}
                                                            </dd>
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
                                        <p className="kicker">Session</p>
                                        <SessionActivationStatus availability={availability} compact />
                                        <dl>
                                            <div>
                                                <dt>State</dt>
                                                <dd>{timeline.state || "unknown"}</dd>
                                            </div>
                                            <div>
                                                <dt>Agent</dt>
                                                <dd>{timeline.snapshot?.activeAgent || "Not recorded"}</dd>
                                            </div>
                                            <div>
                                                <dt>Model</dt>
                                                <dd>{activeModelId || "Project default"}</dd>
                                            </div>
                                            <div>
                                                <dt>Thinking</dt>
                                                <dd>{displayedThinking}</dd>
                                            </div>
                                            <div>
                                                <dt>Generation</dt>
                                                <dd>{timeline.generation ?? "Not committed"}</dd>
                                            </div>
                                        </dl>
                                    </div>
                                )
                                : (
                                    <div className="session-context-panel" role="tabpanel">
                                        <p className="kicker">Artifacts</p>
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
                                                                }/artifacts/${encodeURIComponent(artifact.artifactId)}`}
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
                                                    Meaningful Markdown outputs will appear here when an agent declares
                                                    them.
                                                </p>
                                            )}
                                    </div>
                                )}
                        </aside>
                    </div>
                )
                : null}
        </section>
    );
}

export default SessionSurface;
