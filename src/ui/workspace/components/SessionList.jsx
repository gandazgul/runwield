import { RunWieldButton } from "../../design-system/components/react/RunWieldPrimitives.jsx";

/** @param {string} projectId @param {string} sessionId */
function sessionHref(projectId, sessionId) {
    return `/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}`;
}

/** @param {string} projectId */
function newSessionHref(projectId) {
    return `/projects/${encodeURIComponent(projectId)}/sessions/new`;
}

/** @param {unknown} value */
function safeDiagnosticText(value) {
    if (!value || typeof value !== "object") return String(value || "");
    const record = /** @type {Record<string, unknown>} */ (value);
    return [record.code, record.message].filter((part) => typeof part === "string" && part).join(": ");
}

/** @param {{ projectId: string, data?: any, loading?: boolean, error?: string, onRetry?: () => void, onPageChange?: (page: number) => void }} props */
export function SessionList({
    projectId,
    data,
    loading = false,
    error = "",
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
    const diagnostics = Array.isArray(data?.diagnostics) ? /** @type {unknown[]} */ (data.diagnostics) : [];
    const newSessionAction = (
        <section className="session-create-panel" aria-labelledby="session-list-new-heading">
            <a className="rw-toolbar-button" href={newSessionHref(projectId)}>
                <span className="rw-toolbar-plus" aria-hidden="true">+</span>
                <span>New Session</span>
            </a>
        </section>
    );
    if (!sessions.length) {
        return (
            <section className="session-list-surface" aria-label="Project Sessions">
                {newSessionAction}
                <section className="empty-state session-list-state session-empty-panel">
                    <h2>No Sessions cataloged</h2>
                    <p>Start a new browser Session or run a full Session rescan from the Project card.</p>
                </section>
            </section>
        );
    }
    return (
        <section className="session-list-surface" aria-label="Project Sessions">
            {newSessionAction}
            {diagnostics.length
                ? (
                    <details className="notice warning session-diagnostics">
                        <summary>Catalog diagnostics ({diagnostics.length})</summary>
                        <ul>{diagnostics.map((item, index) => <li key={index}>{safeDiagnosticText(item)}</li>)}</ul>
                    </details>
                )
                : null}
            <section className="session-catalog" aria-label="Existing Sessions">
                <header className="session-catalog-header">
                    <div>
                        <p className="kicker">History</p>
                        <h2>Sessions</h2>
                    </div>
                    <span>{total} total</span>
                </header>
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
            </section>
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
