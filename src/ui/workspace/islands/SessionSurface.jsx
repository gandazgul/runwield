import { useEffect, useMemo, useRef, useState } from "react";
import { RunWieldButton } from "../../design-system/components/react/RunWieldPrimitives.jsx";
import { SessionList } from "../components/SessionList.jsx";
import { deriveSessionAvailability, SessionActivationStatus } from "../components/SessionActivationStatus.jsx";
import { reduceSessionEvents, SessionTimeline } from "../components/SessionTimeline.jsx";

export const SESSION_PAGE_SIZE = 30;
const TIMELINE_PAGE_LIMIT = 200;
export const TIMELINE_MAX_PAGES = 10;
export const TIMELINE_MAX_EVENTS = 1500;
const POLL_INTERVAL_MS = 1500;
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

/** @param {{ projectId: string, mode?: "list" | "detail", runwieldSessionId?: string }} props */
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
    const [submitting, setSubmitting] = useState(false);
    const [newSessionText, setNewSessionText] = useState("");
    const [interruptedOperation, setInterruptedOperation] = useState(false);
    const operationRef = useRef(operation);
    operationRef.current = operation;
    const timelineEndRef = useRef(/** @type {HTMLDivElement | null} */ (null));

    const draftKey = runwieldSessionId ? sessionDraftKey(projectId, runwieldSessionId) : "";
    const requestKey = runwieldSessionId ? sessionRequestKey(projectId, runwieldSessionId) : "";
    const attachmentsKey = runwieldSessionId ? sessionAttachmentsKey(projectId, runwieldSessionId) : "";

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
        if (mode === "detail") loadTimeline();
    }, [mode, projectId, runwieldSessionId, listPage]);

    useEffect(() => {
        if (!draftKey) return;
        const storedDraft = localStorage.getItem(draftKey) || "";
        setDraft(storedDraft);
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
        const text = newSessionText;
        if (!text.trim() || submitting) return;
        setSubmitting(true);
        setListError("");
        try {
            const payload = await ownerFetch(`/api/owner/projects/${encodeURIComponent(projectId)}/sessions`, {
                method: "POST",
                body: JSON.stringify({ requestId: crypto.randomUUID(), text }),
            });
            setNewSessionText("");
            if (payload.runwieldSessionId) {
                globalThis.location.href = `/projects/${encodeURIComponent(projectId)}/sessions/${
                    encodeURIComponent(payload.runwieldSessionId)
                }`;
                return;
            }
            if (payload.operationId) {
                setListError("Session creation started. Open the Session after it appears in the list.");
                await loadList();
            }
        } catch (error) {
            setListError(errorMessage(error));
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
                if (["completed", "failed", "unknown"].includes(next.status)) {
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
    }, [operation?.operationId, requestKey]);

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

    useEffect(() => {
        if (mode !== "detail") return;
        timelineEndRef.current?.scrollIntoView({ block: "nearest" });
    }, [mode, timelineItems.length, transientItems.length, interruptedOperation]);

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
            setMessage(errorMessage(error));
        }
    }

    if (mode === "list") {
        return (
            <SessionList
                projectId={projectId}
                data={listData}
                loading={loadingList}
                error={listError}
                newSessionText={newSessionText}
                creating={submitting}
                onNewSessionTextChange={setNewSessionText}
                onCreateSession={createSession}
                onRetry={() => loadList(listPage)}
                onPageChange={setListPage}
            />
        );
    }

    const allItems = [
        ...timelineItems,
        ...transientItems.map((item) =>
            item.kind === "interaction"
                ? {
                    ...item,
                    onAnswer: () => {
                        const value = globalThis.prompt(item.request?.prompt || "Answer the agent") || "";
                        if (value) {
                            answerInteraction(item.operationId, item.interactionId, { outcome: "text", value });
                        }
                    },
                }
                : item
        ),
        ...(interruptedOperation ? [{ kind: "interruption", key: "interruption:lost-workspace-operation" }] : []),
    ];
    const workflowContext = asRecord(
        timeline?.snapshot?.activeExecutionWorkflow || timeline?.snapshot?.workflowContext || {},
    );
    const progressUrl = timeline ? activePlanProgressUrl(projectId, runwieldSessionId, timeline.snapshot) : "";
    const hasActivePlan = Boolean(workflowContext.planId || workflowContext.planName || progressUrl);
    const workflowStages = deriveWorkflowSidebarStages(workflowProgress);
    return (
        <section className="session-surface">
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
                        <main className="session-stream-panel" aria-label="Session stream">
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
                                {hasActivePlan && progressUrl && !workflowProgressError
                                    ? <a className="rw-plan-review-link" href={progressUrl}>View progress</a>
                                    : null}
                            </section>
                            <div className="session-scroll-offer">
                                <span>Scroll up for earlier blocks. New blocks stay near the input.</span>
                                <button type="button" onClick={() => timelineEndRef.current?.scrollIntoView()}>
                                    Latest block
                                </button>
                            </div>
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
                                    <RunWieldButton
                                        type="submit"
                                        variant="primary"
                                        disabled={!availability.canContinue || submitting ||
                                            (!draft.trim() && !imageAttachments.length)}
                                    >
                                        {submitting ? "Sending…" : "Send"}
                                    </RunWieldButton>
                                    <span>
                                        {availability.canContinue
                                            ? "Enter adds a newline. Command/Ctrl+Enter sends. Paste images to attach them."
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
