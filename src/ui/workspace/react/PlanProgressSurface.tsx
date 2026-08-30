// @ts-nocheck: Workspace React islands compile TSX, but progress payloads are server-owned JSON.

import { useEffect, useMemo, useRef, useState } from "react";
import { RunWieldLink } from "../../design-system/components/react/RunWieldPrimitives.jsx";

const BASE_PROGRESS = {
    ok: true,
    readOnly: true,
    projectId: "fixture-project",
    plan: {
        planId: "fixture-plan",
        planName: "fixture-plan",
        title: "Workspace progress fixture",
        status: "validated_ci",
        classification: "PLANNED_CHANGE",
        executionAgent: "frontend-engineer",
        updatedAt: "2026-08-20T21:30:00-04:00",
    },
    overall: {
        state: "running",
        label: "running",
        detail: "AI code review is running.",
        updatedAt: "2026-08-20T21:30:00-04:00",
        settled: false,
    },
    stages: [
        {
            id: "execution",
            label: "Execution",
            state: "passed",
            detail: "Implementation is ready for validation.",
            updatedAt: "2026-08-20T21:20:00-04:00",
        },
        {
            id: "mechanical",
            label: "Tests and CI",
            state: "passed",
            detail: "Tests and CI passed.",
            updatedAt: "2026-08-20T21:25:00-04:00",
        },
        {
            id: "semantic",
            label: "AI code review",
            state: "running",
            detail: "AI code review is running.",
            updatedAt: "2026-08-20T21:30:00-04:00",
        },
        { id: "repair", label: "Repair", state: "not_required", detail: "No repair is active.", updatedAt: null },
        {
            id: "delivery",
            label: "Delivery",
            state: "pending",
            detail: "Waiting for AI code review.",
            updatedAt: null,
        },
        {
            id: "completion",
            label: "Completion",
            state: "pending",
            detail: "Waiting for delivery to finish.",
            updatedAt: null,
        },
    ],
    session: {
        runwieldSessionId: "fixture-session",
        displayName: "Workspace review Session",
        state: "active",
        activeSurface: "workspace",
        activeAgent: "Reviewer",
        projectionState: "ok",
        progressUrl: "/projects/fixture-project/plans/fixture-plan/progress?session=fixture-session",
        segments: [
            { ordinal: 0, kind: "planning", label: "Planning segment 1", sealed: true, current: false },
            { ordinal: 1, kind: "execution", label: "Execution segment 2", sealed: true, current: false },
            { ordinal: 2, kind: "semantic_repair", label: "AI review repair segment 3", sealed: false, current: true },
        ],
    },
    degraded: null,
};

const FIXTURE_VARIANTS = {
    semantic: BASE_PROGRESS,
    repair: {
        ...BASE_PROGRESS,
        overall: {
            ...BASE_PROGRESS.overall,
            state: "repairing",
            label: "repairing",
            detail: "AI code review repair is active.",
        },
        stages: BASE_PROGRESS.stages.map((stage) =>
            stage.id === "repair" ? { ...stage, state: "running", detail: "AI code review repair is active." } : stage
        ),
    },
    publicationFailure: {
        ...BASE_PROGRESS,
        overall: {
            ...BASE_PROGRESS.overall,
            state: "needs_attention",
            label: "needs attention",
            detail: "Delivery failed while publishing the work.",
            settled: true,
        },
        stages: BASE_PROGRESS.stages.map((stage) =>
            stage.id === "delivery"
                ? {
                    ...stage,
                    state: "needs_attention",
                    detail:
                        "Delivery failed while publishing the work. This is a long failure message that wraps without hiding the next action or creating horizontal page overflow.",
                }
                : stage.id === "semantic"
                ? { ...stage, state: "passed", detail: "AI code review passed." }
                : stage
        ),
    },
    completed: {
        ...BASE_PROGRESS,
        overall: {
            ...BASE_PROGRESS.overall,
            state: "completed",
            label: "completed",
            detail: "The Plan is complete.",
            settled: true,
        },
        stages: BASE_PROGRESS.stages.map((stage) => ({
            ...stage,
            state: stage.id === "repair" ? "not_required" : "completed",
            detail: stage.id === "completion" ? "The Plan is complete." : stage.detail,
        })),
    },
    degraded: {
        ...BASE_PROGRESS,
        ok: false,
        overall: {
            ...BASE_PROGRESS.overall,
            state: "degraded",
            label: "evidence degraded",
            detail: "RunWield found ambiguous progress evidence and refused to guess.",
            settled: true,
        },
        stages: BASE_PROGRESS.stages.map((stage) => ({
            ...stage,
            state: stage.id === "execution" ? "unknown" : "pending",
            detail: stage.id === "execution" ? "Evidence is degraded." : stage.detail,
        })),
        degraded: {
            code: "progress_evidence_degraded",
            message:
                "Two unfinished attempts exist for this Plan. RunWield is not choosing one because that could show the wrong work.",
        },
    },
};

const STATE_LABELS = {
    pending: "Pending",
    running: "Running",
    passed: "Passed",
    needs_attention: "Needs attention",
    paused: "Paused",
    failed: "Failed",
    not_required: "Not required",
    completed: "Completed",
    unknown: "Unknown",
};

const OVERALL_LABELS = {
    waiting: "Waiting",
    running: "Running",
    repairing: "Repairing",
    paused: "Paused",
    needs_attention: "Needs attention",
    delivering: "Delivering",
    completed: "Completed",
    degraded: "Evidence degraded",
};

function formatTime(value) {
    if (!value) return "Not recorded";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
}

function canPoll(progress) {
    if (!progress) return true;
    if (progress.overall?.settled) return false;
    return !["completed", "degraded", "needs_attention", "paused"].includes(progress.overall?.state || "");
}

async function fetchProgress(apiUrl, signal) {
    const response = await fetch(apiUrl, { headers: { accept: "application/json" }, signal });
    if (!response.ok) throw new Error(`Progress request failed with ${response.status}.`);
    return await response.json();
}

type ProgressPayload = {
    ok: boolean;
    readOnly: boolean;
    projectId: string;
    plan: {
        planId: string;
        planName: string;
        title: string;
        status: string;
        classification: string;
        executionAgent: string | null;
        updatedAt: string | null;
    };
    overall: { state: string; label: string; detail: string; updatedAt: string | null; settled: boolean };
    stages: Array<{ id: string; label: string; state: string; detail: string; updatedAt: string | null }>;
    session: null | {
        runwieldSessionId: string;
        displayName: string;
        state: string;
        activeSurface: string | null;
        activeAgent: string | null;
        projectionState: string;
        progressUrl: string;
        segments: Array<{ ordinal: number; kind: string; label: string; sealed: boolean; current: boolean }>;
    };
    degraded: null | { code: string; message: string };
};

export function PlanProgressSurface({
    initialProgress = null,
    apiUrl = "",
    progressUrl: _progressUrl = "",
}: { initialProgress?: ProgressPayload | null; apiUrl?: string; progressUrl?: string }) {
    const [fixtureKey, setFixtureKey] = useState("semantic");
    const [progress, setProgress] = useState(initialProgress || (apiUrl ? null : FIXTURE_VARIANTS.semantic));
    const [error, setError] = useState("");
    const [refreshing, setRefreshing] = useState(Boolean(apiUrl));
    const requestIdRef = useRef(0);
    const stages = useMemo(() => progress?.stages || [], [progress]);

    useEffect(() => {
        if (!apiUrl && !initialProgress) setProgress(FIXTURE_VARIANTS[fixtureKey] || FIXTURE_VARIANTS.semantic);
    }, [apiUrl, fixtureKey, initialProgress]);

    useEffect(() => {
        if (!apiUrl) return;
        let cancelled = false;
        let timer = 0;
        async function load() {
            const requestId = requestIdRef.current + 1;
            requestIdRef.current = requestId;
            const controller = new AbortController();
            setRefreshing(true);
            try {
                const next = await fetchProgress(apiUrl, controller.signal);
                if (!cancelled && requestId === requestIdRef.current) {
                    setProgress(next);
                    setError("");
                    if (canPoll(next)) timer = globalThis.setTimeout(load, 2500);
                }
            } catch (caught) {
                if (!cancelled) {
                    setError(caught instanceof Error ? caught.message : "Progress request failed.");
                    if (!progress) timer = globalThis.setTimeout(load, 5000);
                }
            } finally {
                if (!cancelled) setRefreshing(false);
            }
            return () => controller.abort();
        }
        load();
        return () => {
            cancelled = true;
            globalThis.clearTimeout(timer);
        };
    }, [apiUrl]);

    if (!progress) {
        return (
            <section className="owner-card workflow-progress-card" aria-live="polite">
                <p className="kicker">Plan progress</p>
                <h1>Loading progress</h1>
                <p>RunWield is reading the Plan state.</p>
                {error ? <p className="session-status-row level-error">{error}</p> : null}
            </section>
        );
    }

    return (
        <section className="plan-progress-surface" aria-live="polite">
            <header className="page-header plan-progress-header">
                <a
                    className="detail-back-link"
                    href={`/projects/${encodeURIComponent(progress.projectId)}/plans/${
                        encodeURIComponent(progress.plan.planId)
                    }`}
                >
                    ← Plan
                </a>
                <p className="kicker">Plan progress</p>
                <h1>{progress.plan.title}</h1>
                <p>{progress.overall.detail}</p>
                <div className="plan-progress-header-actions">
                    <span className={`rw-status-badge state-${progress.overall.state}`}>
                        {OVERALL_LABELS[progress.overall.state] || progress.overall.state}
                    </span>
                    {refreshing ? <span className="rw-status-badge state-running">Refreshing</span> : null}
                </div>
                {!apiUrl && !initialProgress
                    ? (
                        <label className="plan-progress-fixture-picker">
                            Fixture state
                            <select value={fixtureKey} onChange={(event) => setFixtureKey(event.currentTarget.value)}>
                                <option value="semantic">AI code review</option>
                                <option value="repair">Repair running</option>
                                <option value="publicationFailure">Publication failure</option>
                                <option value="completed">Completed</option>
                                <option value="degraded">Degraded evidence</option>
                            </select>
                        </label>
                    )
                    : null}
            </header>

            {error
                ? (
                    <aside className="owner-card plan-progress-warning" role="status">
                        <h2>Network refresh failed</h2>
                        <p>{error}</p>
                        <p>The last loaded progress remains visible.</p>
                    </aside>
                )
                : null}

            {progress.degraded
                ? (
                    <aside className="owner-card plan-progress-warning" role="alert">
                        <h2>Evidence is degraded</h2>
                        <p>{progress.degraded.message}</p>
                    </aside>
                )
                : null}

            <ol className="workflow-progress-list" aria-label="Workflow progress stages">
                {stages.map((item, index) => (
                    <li key={item.id} className={`workflow-progress-item state-${item.state}`}>
                        <span className="workflow-progress-index">{index + 1}</span>
                        <div>
                            <div className="workflow-progress-title-row">
                                <h2>{item.label}</h2>
                                <span className={`rw-status-badge state-${item.state}`}>
                                    {STATE_LABELS[item.state] || item.state}
                                </span>
                            </div>
                            <p>{item.detail}</p>
                            <time>{formatTime(item.updatedAt)}</time>
                        </div>
                    </li>
                ))}
            </ol>

            <section className="owner-card plan-progress-metadata">
                <h2>Progress facts</h2>
                <dl className="metadata-grid">
                    <div>
                        <dt>Plan status</dt>
                        <dd>{progress.plan.status}</dd>
                    </div>
                    <div>
                        <dt>Execution Agent</dt>
                        <dd>{progress.plan.executionAgent || "Not selected"}</dd>
                    </div>
                    <div>
                        <dt>Last update</dt>
                        <dd>{formatTime(progress.overall.updatedAt)}</dd>
                    </div>
                    <div>
                        <dt>Read-only</dt>
                        <dd>{progress.readOnly ? "Yes" : "No"}</dd>
                    </div>
                </dl>
            </section>

            {progress.session
                ? (
                    <section className="owner-card plan-progress-session">
                        <div className="workflow-progress-title-row">
                            <h2>Session context</h2>
                            <RunWieldLink
                                variant="primary"
                                className="rw-plan-review-link"
                                href={`/projects/${encodeURIComponent(progress.projectId)}/sessions/${
                                    encodeURIComponent(progress.session.runwieldSessionId)
                                }`}
                            >
                                Open Session
                            </RunWieldLink>
                        </div>
                        <p>
                            {progress.session.displayName} · {progress.session.state}
                            {progress.session.activeSurface ? ` · ${progress.session.activeSurface}` : ""}
                        </p>
                        <ol className="session-segment-list" aria-label="Session Transcript Segments">
                            {progress.session.segments.map((segment) => (
                                <li
                                    key={`${segment.ordinal}:${segment.kind}`}
                                    className={segment.current ? "current" : ""}
                                >
                                    <strong>{segment.label}</strong>
                                    <span>{segment.sealed ? "Sealed" : "Current"}</span>
                                </li>
                            ))}
                        </ol>
                    </section>
                )
                : null}
        </section>
    );
}

export default PlanProgressSurface;
