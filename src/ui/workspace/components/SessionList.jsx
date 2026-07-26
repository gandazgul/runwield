import { RunWieldButton, RunWieldCard } from "../../design-system/components/react/RunWieldPrimitives.jsx";
import { deriveSessionAvailability, SessionActivationStatus } from "./SessionActivationStatus.jsx";

/** @param {string} projectId @param {string} sessionId */
function sessionHref(projectId, sessionId) {
    return `/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}`;
}

/** @param {unknown} value */
function safeDiagnosticText(value) {
    if (!value || typeof value !== "object") return String(value || "");
    const record = /** @type {Record<string, unknown>} */ (value);
    return [record.code, record.message].filter((part) => typeof part === "string" && part).join(": ");
}

/** @param {{ projectId: string, data?: any, loading?: boolean, error?: string, onRetry?: () => void }} props */
export function SessionList({ projectId, data, loading = false, error = "", onRetry }) {
    const sessions = Array.isArray(data?.sessions) ? [...data.sessions] : [];
    sessions.sort((a, b) => {
        const aa = deriveSessionAvailability({
            protocol: data?.protocol,
            ...a,
            timelineComplete: true,
            snapshot: a.snapshot,
        });
        const bb = deriveSessionAvailability({
            protocol: data?.protocol,
            ...b,
            timelineComplete: true,
            snapshot: b.snapshot,
        });
        /** @param {{ canContinue: boolean, canPrepare: boolean }} availability */
        const score = (availability) => availability.canContinue ? 0 : availability.canPrepare ? 1 : 2;
        return score(aa) - score(bb) ||
            String(a.displayName || a.runwieldSessionId).localeCompare(String(b.displayName || b.runwieldSessionId));
    });
    if (loading) {
        return (
            <section className="session-list-state" aria-busy="true">
                <p>Loading Project Sessions…</p>
            </section>
        );
    }
    if (error) {
        return (
            <section className="error-panel session-list-state" role="alert">
                <h2>Sessions failed to load</h2>
                <p>{error}</p>
                {onRetry ? <RunWieldButton type="button" onClick={onRetry}>Retry</RunWieldButton> : null}
            </section>
        );
    }
    if (!sessions.length) {
        return (
            <section className="owner-card empty-state session-list-state">
                <h2>No Sessions cataloged</h2>
                <p>Run a full Session rescan from the Project card, then return here.</p>
            </section>
        );
    }
    const diagnostics = Array.isArray(data?.diagnostics) ? /** @type {unknown[]} */ (data.diagnostics) : [];
    return (
        <section className="session-list-surface" aria-label="Project Sessions">
            {data?.protocol
                ? (
                    <p className="notice session-protocol-notice">
                        Activation protocol:{" "}
                        {data.protocol.enabled === false ? "disabled" : data.protocol.status || "enabled"}
                    </p>
                )
                : null}
            {diagnostics.length
                ? (
                    <details className="notice warning session-diagnostics">
                        <summary>Catalog diagnostics ({diagnostics.length})</summary>
                        <ul>{diagnostics.map((item, index) => <li key={index}>{safeDiagnosticText(item)}</li>)}</ul>
                    </details>
                )
                : null}
            <div className="session-card-list">
                {sessions.map((session) => {
                    const availability = deriveSessionAvailability({
                        protocol: data?.protocol,
                        ...session,
                        timelineComplete: true,
                        snapshot: session.snapshot,
                    });
                    const title = session.displayName || session.snapshot?.name || "Untitled Session";
                    return (
                        <RunWieldCard key={session.runwieldSessionId} className="session-card">
                            <div className="card-header">
                                <div>
                                    <p className="kicker">Session</p>
                                    <h2>{title}</h2>
                                    <p className="session-card-id">{session.runwieldSessionId}</p>
                                    <p className="session-card-meta">
                                        Generation {session.generation ?? "not prepared"} · {session.state || "unknown"}
                                    </p>
                                </div>
                                <SessionActivationStatus availability={availability} compact />
                            </div>
                            <p>{availability.explanation}</p>
                            <div className="card-actions">
                                <a className="action-primary" href={sessionHref(projectId, session.runwieldSessionId)}>
                                    Open Session
                                </a>
                            </div>
                        </RunWieldCard>
                    );
                })}
            </div>
        </section>
    );
}

export default SessionList;
