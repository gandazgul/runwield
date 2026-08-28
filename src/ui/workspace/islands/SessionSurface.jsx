import { useEffect, useMemo, useRef, useState } from "react";

// New Session chat structure is adapted from OpenChamber's ChatContainer/ChatInput UI.
// OpenChamber is MIT licensed: Copyright (c) 2025 Bohdan Triapitsyn.
import { RunWieldButton } from "../../design-system/components/react/RunWieldPrimitives.jsx";
import { SessionList } from "../components/SessionList.jsx";
import { deriveSessionAvailability, SessionActivationStatus } from "../components/SessionActivationStatus.jsx";
import { reduceSessionEvents, SessionTimeline } from "../components/SessionTimeline.jsx";

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

/** @param {{ mode: string, state?: string, localOperationActive?: boolean }} input */
export function shouldRefreshSessionAvailability(input) {
    return input.mode === "detail" && input.localOperationActive !== true && input.state === "active";
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

export function deriveSessionModelDisclosure(snapshot) {
    const activeModel = snapshot?.activeModel;
    const rawModel = typeof activeModel?.model === "string" ? activeModel.model : snapshot?.model;
    const rawProvider = typeof activeModel?.provider === "string" ? activeModel.provider : snapshot?.provider;
    const model = typeof rawModel === "string" && rawModel.trim() ? rawModel.trim() : "";
    const provider = typeof rawProvider === "string" && rawProvider.trim() ? rawProvider.trim() : "";
    const reference = model
        ? (provider && !model.startsWith(`${provider}/`) ? `${provider}/${model}` : model)
        : "Model not recorded";
    const isClaudeCli = provider === "claude-cli";
    return {
        reference,
        backendLabel: isClaudeCli ? "Claude CLI" : provider || "Execution Backend not recorded",
        showClaudeCaveat: isClaudeCli,
    };
}

/** @param {{ snapshot?: SessionModelSnapshot | null }} props */
function SessionsBackIcon() {
    return (
        <svg className="rw-session-toolbar-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 6l-6 6 6 6" />
        </svg>
    );
}

function PaperAirplaneIcon() {
    return (
        <svg className="rw-session-toolbar-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.5 4.5 20.5 12 3.5 19.5 6 12Zm0 0h7" />
        </svg>
    );
}

export function SessionBackendDisclosure({ snapshot }) {
    const disclosure = deriveSessionModelDisclosure(snapshot);
    return (
        <section className="session-backend-disclosure" aria-label="Session model and Execution Backend">
            <div className="session-backend-grid">
                <div>
                    <span className="session-backend-label">Model</span>
                    <code>{disclosure.reference}</code>
                </div>
                <div>
                    <span className="session-backend-label">Execution Backend</span>
                    <strong>{disclosure.backendLabel}</strong>
                </div>
            </div>
            {disclosure.showClaudeCaveat
                ? (
                    <p className="session-backend-caveat" role="note">
                        Claude Code owns its internal file/Bash/tool activity for this backend. RunWield persists the
                        final assistant/workflow Session Transcript and owns workflow, resume, and replay, but Claude
                        internal tool activity is not native RunWield tool-event history in this MVP.
                    </p>
                )
                : null}
        </section>
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
    const [transientItems, setTransientItems] = useState(/** @type {Array<Record<string, any>>} */ ([]));
    const [workflowProgress, setWorkflowProgress] = useState(/** @type {any} */ (null));
    const [workflowProgressError, setWorkflowProgressError] = useState("");
    const [detailError, setDetailError] = useState("");
    const [loadingDetail, setLoadingDetail] = useState(mode === "detail");
    const [draft, setDraft] = useState("");
    const [imageAttachments, setImageAttachments] = useState(/** @type {SessionImageAttachmentDraft[]} */ ([]));
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
    const [interruptedOperation, setInterruptedOperation] = useState(false);
    const operationRef = useRef(operation);
    operationRef.current = operation;
    const timelineEndRef = useRef(/** @type {HTMLDivElement | null} */ (null));
    const timelineScrollRef = useRef(/** @type {HTMLDivElement | null} */ (null));
    const [followingLiveEdge, setFollowingLiveEdge] = useState(true);
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

    async function loadTimeline() {
        if (!runwieldSessionId) return;
        setLoadingDetail(true);
        setDetailError("");
        setMessage("");
        try {
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
            const nextTimeline = {
                ...(payload || {}),
                events,
                complete: !truncated && payload?.complete !== false,
                truncated,
            };
            setTimeline(nextTimeline);
            setTimelineItems(reduceSessionEvents(events, { source: "committed" }));
            setTransientItems([]);
            setPendingConfiguration(null);
            setLiveThinkingLevel("");
            if (truncated) {
                setMessage(
                    "Timeline budget exceeded. Reload this Session to continue from the complete committed timeline.",
                );
            }
        } catch (error) {
            setDetailError(errorMessage(error));
        } finally {
            setLoadingDetail(false);
        }
    }

    useEffect(() => {
        if (mode === "list") loadList(listPage);
        if (mode === "detail") {
            loadTimeline();
            loadSessionOptions();
        }
        if (mode === "new") {
            setTimeline(null);
            setTimelineItems([]);
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
            setMessage("Reconnected to an accepted Session operation. Polling without replaying the request.");
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

    async function sendRequest() {
        const text = draft;
        if ((!text.trim() && imageAttachments.length === 0) || !availability.canContinue || submitting || !timeline) {
            return;
        }
        setSubmitting(true);
        setMessage("");
        const existing = asRecord(readStored(requestKey));
        const envelope = existing.requestId && existing.status === "network-error" ? existing : {
            requestId: crypto.randomUUID(),
            expectedGeneration: timeline.generation,
            text,
            images: imageAttachments.map(serializeSessionImageForRequest),
            status: "pending",
            createdAt: new Date().toISOString(),
        };
        localStorage.setItem(requestKey, JSON.stringify(envelope));
        try {
            const payload = await ownerFetch(
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
            setDraft("");
            setImageAttachments([]);
            const stored = {
                ...envelope,
                status: payload.status || "running",
                operationId: payload.operationId,
                responseAccepted: true,
            };
            localStorage.setItem(requestKey, JSON.stringify(stored));
            setOperation({
                operationId: payload.operationId,
                status: payload.status || "running",
                observed: 0,
                attempts: 0,
            });
            setMessage("Request accepted. Watching progress without replaying on refresh.");
        } catch (error) {
            const errorRecord = asRecord(error);
            const status = Number(errorRecord.status || 0);
            const nextStatus = status === 409 ? "conflict" : status === 503 ? "unavailable" : "network-error";
            localStorage.setItem(requestKey, JSON.stringify({ ...envelope, status: nextStatus }));
            setMessage(
                status === 409
                    ? `${errorMessage(error)} Refreshing; resubmit explicitly when ready.`
                    : errorMessage(error),
            );
            if (status === 409 || status === 503) await loadTimeline();
        } finally {
            setSubmitting(false);
        }
    }

    useEffect(() => {
        if (!operation?.operationId) return undefined;
        let cancelled = false;
        const tick = async () => {
            const current = operationRef.current;
            if (!current || cancelled || current.attempts >= MAX_POLL_ATTEMPTS) return;
            try {
                const payload = await ownerFetch(
                    `/api/owner/session-operations/${encodeURIComponent(current.operationId)}`,
                    { method: "GET" },
                );
                if (
                    !shouldApplyOperationPoll({
                        cancelled,
                        currentOperationId: operationRef.current?.operationId,
                        polledOperationId: current.operationId,
                    })
                ) return;
                const events = Array.isArray(payload.events) ? payload.events : [];
                const nextEvents = events.slice(current.observed);
                let items = reduceOperationTransientItems(events);
                if (payload.liveInteraction?.interactionId) {
                    const request = payload.liveInteraction.request || {};
                    const isPlanReview = request.type === "plan_review";
                    items = [...items, {
                        kind: isPlanReview ? "plan-review" : "interaction",
                        key: `interaction:${payload.liveInteraction.interactionId}`,
                        interactionId: payload.liveInteraction.interactionId,
                        operationId: current.operationId,
                        request,
                        reviewUrl: request.reviewUrl,
                        source: "transient",
                    }];
                }
                if (nextEvents.length || payload.liveInteraction?.interactionId) {
                    setTransientItems(items);
                }
                const next = {
                    operationId: current.operationId,
                    status: payload.status || "unknown",
                    observed: events.length,
                    attempts: current.attempts + 1,
                };
                setOperation(next);
                setPendingConfiguration(payload.pendingConfiguration || null);
                if (["completed", "failed", "unknown"].includes(next.status)) {
                    if (mode === "new" && payload.runwieldSessionId) {
                        localStorage.removeItem(requestKey);
                        globalThis.location.replace(
                            `/projects/${encodeURIComponent(projectId)}/sessions/${
                                encodeURIComponent(payload.runwieldSessionId)
                            }`,
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
                    await loadTimeline();
                    return;
                }
            } catch (error) {
                if (
                    !shouldApplyOperationPoll({
                        cancelled,
                        currentOperationId: operationRef.current?.operationId,
                        polledOperationId: current.operationId,
                    })
                ) return;
                setMessage(
                    `Observation interrupted: ${errorMessage(error)}. The server-owned operation was not canceled.`,
                );
            }
        };
        const id = setInterval(tick, POLL_INTERVAL_MS);
        tick();
        return () => {
            cancelled = true;
            clearInterval(id);
        };
    }, [operation?.operationId, requestKey, mode, projectId]);

    useEffect(() => {
        if (
            !shouldRefreshSessionAvailability({
                mode,
                state: timeline?.state,
                localOperationActive: Boolean(operation?.operationId),
            })
        ) return undefined;
        const id = setInterval(() => {
            void loadTimeline();
        }, AVAILABILITY_REFRESH_INTERVAL_MS);
        return () => clearInterval(id);
    }, [mode, timeline?.state, operation?.operationId, projectId, runwieldSessionId]);

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
        timelineEndRef.current?.scrollIntoView({ block: "nearest" });
        setFollowingLiveEdge(true);
        setLatestActivityAvailable(false);
    }

    function updateScrollFollowState() {
        const scroller = timelineScrollRef.current;
        if (!scroller) return;
        const atLiveEdge = isAtLiveScrollEdge(scroller);
        setFollowingLiveEdge(atLiveEdge);
        if (atLiveEdge) setLatestActivityAvailable(false);
    }

    useEffect(() => {
        if (mode !== "detail") return;
        if (followingLiveEdge) {
            timelineEndRef.current?.scrollIntoView({ block: "nearest" });
        } else {
            setLatestActivityAvailable(true);
        }
    }, [mode, timelineItems.length, transientItems.length, interruptedOperation, followingLiveEdge]);

    useEffect(() => {
        if (!operation?.operationId) return undefined;
        const onKeyDown = (event) => {
            if (event.key === "Escape") cancelOperation();
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
            <section className="session-surface session-surface-new" aria-label="RunWield Session chat">
                {optionsError
                    ? (
                        <p className="rw-plan-review-dev-notice session-dev-shell-bar" role="status">
                            DEV MODE — Owner Session APIs are not connected.
                        </p>
                    )
                    : null}
                <main className="session-oc-main" aria-label="New Session stream">
                    <header className="session-chat-topbar">
                        <a className="rw-toolbar-button" href={`/projects/${encodeURIComponent(projectId)}/sessions`}>
                            <SessionsBackIcon />
                            <span>Sessions</span>
                        </a>
                        <div>
                            <strong>New Session</strong>
                            <span>RunWield · {projectId}</span>
                        </div>
                    </header>
                    <div className="session-surface-status" aria-live="polite">{message}</div>
                    <div className="session-oc-scroll">
                        <section className="session-new-welcome" aria-labelledby="session-new-welcome-heading">
                            <h2 id="session-new-welcome-heading">What should RunWield do?</h2>
                        </section>
                        <SessionTimeline items={newSessionItems} emptyMessage="" />
                        <div ref={timelineEndRef} aria-hidden="true" />
                    </div>
                    <form
                        className="session-composer session-composer-openchamber"
                        onSubmit={(event) => {
                            event.preventDefault();
                            createSession();
                        }}
                    >
                        <label className="sr-only" htmlFor="new-session-request-text">User Request</label>
                        <textarea
                            id="new-session-request-text"
                            value={draft}
                            rows={3}
                            disabled={!canSendNew}
                            onChange={(event) => setDraft(event.currentTarget.value)}
                            onKeyDown={(event) => {
                                if (event.key === "Enter" && !event.shiftKey) {
                                    event.preventDefault();
                                    createSession();
                                }
                            }}
                            placeholder="Ask RunWield..."
                        />
                        <div className="session-composer-footer">
                            <div className="session-composer-toolbar" aria-label="Session settings">
                                <label>
                                    <span className="sr-only">Agent</span>
                                    <select
                                        value={selectedAgent}
                                        disabled={!canSendNew || !agents.length}
                                        onChange={(event) => setSelectedAgent(event.currentTarget.value)}
                                    >
                                        {agents.length ? null : <option value="router">Router</option>}
                                        {agents.map((agent) => (
                                            <option key={agent.name} value={agent.name}>
                                                {agent.displayName || agent.name}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                <label>
                                    <span className="sr-only">Model</span>
                                    <select
                                        value={selectedModelKey}
                                        disabled={!canSendNew || !models.length}
                                        onChange={(event) => setSelectedModelKey(event.currentTarget.value)}
                                    >
                                        <option value="">Project default</option>
                                        {models.map((model) => (
                                            <option
                                                key={`${model.provider}/${model.id}`}
                                                value={`${model.provider}\u001f${model.id}`}
                                            >
                                                {model.name || model.id}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                <label>
                                    <span className="sr-only">Thinking</span>
                                    <select
                                        value={selectedThinking}
                                        disabled={!canSendNew || !thinkingLevels.length}
                                        onChange={(event) => setSelectedThinking(event.currentTarget.value)}
                                    >
                                        <option value="default">Default</option>
                                        {thinkingLevels.map((level) => (
                                            <option key={level} value={level}>{level}</option>
                                        ))}
                                    </select>
                                </label>
                                <button
                                    type="submit"
                                    className="rw-toolbar-button session-send-button"
                                    disabled={!canSendNew || !draft.trim()}
                                    aria-label={submitting || operation?.operationId
                                        ? "Starting Session"
                                        : "Send User Request"}
                                >
                                    <PaperAirplaneIcon />
                                    <span>{submitting || operation?.operationId ? "Sending" : "Send"}</span>
                                </button>
                            </div>
                        </div>
                    </form>
                </main>
            </section>
        );
    }

    const allItems = [
        ...timelineItems,
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
    const stagedConfigurationVisible = Boolean(pendingConfiguration?.agentName || pendingConfiguration?.model);
    return (
        <section className="session-surface session-surface-detail" aria-label="RunWield Session chat">
            <header className="session-chat-topbar session-chat-topbar-detail">
                <a className="rw-toolbar-button" href={`/projects/${encodeURIComponent(projectId)}/sessions`}>
                    <SessionsBackIcon />
                    <span>Sessions</span>
                </a>
                <div>
                    <strong>{timeline?.snapshot?.name || "Session"}</strong>
                    <span>RunWield · {projectId}</span>
                </div>
            </header>
            <div className="session-surface-status" aria-live="polite">{message}</div>
            {loadingDetail
                ? <p className="session-list-state" aria-busy="true">Loading committed Session timeline…</p>
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
                        <main
                            className="session-stream-panel"
                            aria-label="Session stream"
                            ref={timelineScrollRef}
                            onScroll={updateScrollFollowState}
                        >
                            <section className="session-summary-card">
                                <div className="session-summary-heading">
                                    <div>
                                        <p className="kicker">Session</p>
                                        <h2>{timeline.snapshot?.name || runwieldSessionId}</h2>
                                        <p>
                                            Generation {timeline.generation ?? "unavailable"} · Agent{" "}
                                            {timeline.snapshot?.activeAgent || "unknown"}
                                        </p>
                                    </div>
                                    <SessionActivationStatus availability={availability} />
                                </div>
                                <SessionBackendDisclosure snapshot={timeline.snapshot} />
                                {operation?.operationId
                                    ? (
                                        <button
                                            type="button"
                                            className="rw-toolbar-button session-stop-button"
                                            onClick={cancelOperation}
                                        >
                                            Stop
                                        </button>
                                    )
                                    : null}
                                {hasActivePlan && progressUrl && !workflowProgressError
                                    ? <a className="rw-plan-review-link" href={progressUrl}>View progress</a>
                                    : null}
                            </section>
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
                            <form
                                className="session-composer"
                                onSubmit={(event) => {
                                    event.preventDefault();
                                    sendRequest();
                                }}
                            >
                                <label htmlFor="session-request-text">User Request</label>
                                <textarea
                                    id="session-request-text"
                                    value={draft}
                                    rows={5}
                                    disabled={!availability.canContinue || submitting}
                                    onPaste={handleComposerPaste}
                                    onChange={(event) => setDraft(event.currentTarget.value)}
                                    onKeyDown={(event) => {
                                        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                                            event.preventDefault();
                                            sendRequest();
                                        }
                                    }}
                                    placeholder="Type the exact request to send to the active Agent. Paste images here to attach them."
                                />
                                {imageAttachments.length
                                    ? (
                                        <ul className="session-image-attachments" aria-label="Attached images">
                                            {imageAttachments.map((image) => (
                                                <li key={image.id}>
                                                    <span>{image.name} · {image.mimeType}</span>
                                                    <button
                                                        type="button"
                                                        onClick={() => removeImageAttachment(image.id)}
                                                    >
                                                        Remove
                                                    </button>
                                                </li>
                                            ))}
                                        </ul>
                                    )
                                    : null}
                                <div className="session-composer-actions">
                                    <div className="session-detail-settings" aria-label="Session settings">
                                        <label>
                                            <span>Agent</span>
                                            <select
                                                value={stagedAgent}
                                                disabled={!canConfigureSession || !agents.length}
                                                onChange={(event) =>
                                                    configureSession({ agentName: event.currentTarget.value })}
                                            >
                                                {agents.some((agent) => agent.name === timeline.snapshot?.activeAgent)
                                                    ? null
                                                    : (
                                                        <option value={timeline.snapshot?.activeAgent || ""}>
                                                            {timeline.snapshot?.activeAgent || "Agent"}
                                                        </option>
                                                    )}
                                                {agents.map((agent) => (
                                                    <option key={agent.name} value={agent.name}>
                                                        {agent.displayName || agent.name}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>
                                        <label>
                                            <span>Model</span>
                                            <select
                                                value={stagedModelKey}
                                                disabled={!canConfigureSession || !models.length}
                                                onChange={(event) => {
                                                    const [provider, model] = event.currentTarget.value
                                                        ? event.currentTarget.value.split("\u001f")
                                                        : ["", ""];
                                                    if (model) configureSession({ provider, model });
                                                }}
                                            >
                                                {activeModelKey &&
                                                        !models.some((model) =>
                                                            `${model.provider}\u001f${model.id}` === activeModelKey
                                                        )
                                                    ? <option value={activeModelKey}>{activeModelId}</option>
                                                    : null}
                                                {models.map((model) => (
                                                    <option
                                                        key={`${model.provider}/${model.id}`}
                                                        value={`${model.provider}\u001f${model.id}`}
                                                    >
                                                        {model.name || model.id}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>
                                        <label>
                                            <span>Thinking</span>
                                            <select
                                                value={displayedThinking}
                                                disabled={!canConfigureSession || !thinkingLevels.length}
                                                onChange={(event) =>
                                                    configureSession({ thinkingLevel: event.currentTarget.value })}
                                            >
                                                {thinkingLevels.includes(displayedThinking)
                                                    ? null
                                                    : <option value={displayedThinking}>{displayedThinking}</option>}
                                                {thinkingLevels.map((level) => (
                                                    <option key={level} value={level}>{level}</option>
                                                ))}
                                            </select>
                                        </label>
                                    </div>
                                    <RunWieldButton
                                        type="submit"
                                        variant="primary"
                                        disabled={!availability.canContinue || submitting ||
                                            (!draft.trim() && !imageAttachments.length)}
                                    >
                                        {submitting ? "Sending…" : "Send"}
                                    </RunWieldButton>
                                    <span className="session-composer-help">
                                        {availability.canContinue
                                            ? (stagedConfigurationVisible
                                                ? "Agent settings apply after this response. Enter adds a newline. Command/Ctrl+Enter sends."
                                                : "Enter adds a newline. Command/Ctrl+Enter sends. Paste images to attach them.")
                                            : availability.explanation}
                                    </span>
                                </div>
                            </form>
                        </main>
                        {hasActivePlan
                            ? (
                                <aside className="session-workflow-sidebar" aria-label="Workflow state">
                                    <p className="kicker">Workflow state</p>
                                    <SessionActivationStatus availability={availability} compact />
                                    <dl>
                                        <div>
                                            <dt>Session</dt>
                                            <dd>{timeline.state || "unknown"}</dd>
                                        </div>
                                        <div>
                                            <dt>Plan</dt>
                                            <dd>
                                                {workflowContext.planName || workflowContext.planId || "No active Plan"}
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
                                                            {String(stage.state || "unknown").replaceAll("_", " ")}
                                                        </strong>
                                                        <p>{stage.detail}</p>
                                                    </li>
                                                ))}
                                            </ol>
                                        )
                                        : workflowProgressError
                                        ? null
                                        : (
                                            <p className="notice muted">
                                                {progressUrl
                                                    ? "Loading canonical workflow progress…"
                                                    : "No active Plan progress is recorded for this Session."}
                                            </p>
                                        )}
                                    {progressUrl && !workflowProgressError
                                        ? <a className="rw-plan-review-link" href={progressUrl}>Open progress</a>
                                        : null}
                                </aside>
                            )
                            : null}
                    </div>
                )
                : null}
        </section>
    );
}

export default SessionSurface;
