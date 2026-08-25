import { RunWieldButton } from "../../design-system/components/react/RunWieldPrimitives.jsx";

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

/** @param {{ projectId: string, data?: any, loading?: boolean, error?: string, newSessionText?: string, creating?: boolean, onNewSessionTextChange?: (value: string) => void, onCreateSession?: () => void, onRetry?: () => void, onPageChange?: (page: number) => void }} props */
export function SessionList({
    projectId,
    data,
    loading = false,
    error = "",
    newSessionText = "",
    creating = false,
    onNewSessionTextChange,
    onCreateSession,
    onRetry,
    onPageChange,
}) {
    const sessions = Array.isArray(data?.sessions) ? data.sessions : [];
    const page = Number.isInteger(data?.page) ? data.page : 0;
    const pageSize = Number.isInteger(data?.pageSize) ? data.pageSize : 30;
    const total = Number.isInteger(data?.total) ? data.total : sessions.length;
    const hasNext = data?.hasNext === true;
    const hasPrevious = data?.hasPrevious === true;
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
    const createForm = onCreateSession
        ? (
            <form
                className="owner-card session-create-card"
                onSubmit={(event) => {
                    event.preventDefault();
                    onCreateSession();
                }}
            >
                <p className="kicker">New Session</p>
                <h2>Start with Router</h2>
                <label htmlFor="new-session-request">First User Request</label>
                <textarea
                    id="new-session-request"
                    rows={4}
                    value={newSessionText}
                    onChange={(event) => onNewSessionTextChange?.(event.currentTarget.value)}
                    placeholder="Ask RunWield what you want to do next…"
                    disabled={creating}
                />
                <div className="card-actions">
                    <RunWieldButton type="submit" variant="primary" disabled={creating || !newSessionText.trim()}>
                        {creating ? "Starting…" : "Start Session"}
                    </RunWieldButton>
                </div>
            </form>
        )
        : null;
    if (!sessions.length) {
        return (
            <section className="session-list-surface" aria-label="Project Sessions">
                {createForm}
                <section className="owner-card empty-state session-list-state">
                    <h2>No Sessions cataloged</h2>
                    <p>Start a new Router-led Session or run a full Session rescan from the Project card.</p>
                </section>
            </section>
        );
    }
    const diagnostics = Array.isArray(data?.diagnostics) ? /** @type {unknown[]} */ (data.diagnostics) : [];
    return (
        <section className="session-list-surface" aria-label="Project Sessions">
            {createForm}
            {diagnostics.length
                ? (
                    <details className="notice warning session-diagnostics">
                        <summary>Catalog diagnostics ({diagnostics.length})</summary>
                        <ul>{diagnostics.map((item, index) => <li key={index}>{safeDiagnosticText(item)}</li>)}</ul>
                    </details>
                )
                : null}
            <div className="session-card-list">
                {sessions.map((session) => (
                    <a
                        className="session-list-item"
                        href={sessionHref(projectId, session.runwieldSessionId)}
                        key={session.runwieldSessionId}
                    >
                        <span className="session-list-name">{session.displayName || "Untitled Session"}</span>
                        <span className="session-list-status">{session.state || "unknown"}</span>
                    </a>
                ))}
            </div>
            <nav className="session-pagination" aria-label="Session pages">
                <span>
                    Showing {page * pageSize + 1}–{Math.min(page * pageSize + sessions.length, total)} of {total}
                </span>
                <div className="card-actions">
                    <RunWieldButton
                        type="button"
                        disabled={!hasPrevious}
                        onClick={() => onPageChange?.(page - 1)}
                    >
                        Previous
                    </RunWieldButton>
                    <RunWieldButton
                        type="button"
                        disabled={!hasNext}
                        onClick={() => onPageChange?.(page + 1)}
                    >
                        Next 30
                    </RunWieldButton>
                </div>
            </nav>
        </section>
    );
}

export default SessionList;
