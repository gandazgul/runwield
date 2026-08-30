// @ts-nocheck: Workspace React islands compile TSX, but this shared presentation component accepts server-owned JSON.

export function ReviewContextBar({ context, artifactLabel = "Review" }) {
    if (!context) return null;
    return (
        <section className="rw-plan-review-context" aria-label={`${artifactLabel} context`}>
            <nav aria-label={`${artifactLabel} location`}>
                <span>{context.projectLabel || "Project"}</span>
                <span aria-hidden="true">→</span>
                {context.sessionHref
                    ? <a href={context.sessionHref}>{context.sessionLabel || "Session"}</a>
                    : <span>{context.sessionLabel || "Session"}</span>}
                <span aria-hidden="true">→</span>
                <span>{context.artifactLabel || artifactLabel}</span>
            </nav>
            <div>
                <span>{context.actingSession || "Acting Session not recorded"}</span>
                {context.statusLabel ? <span>{context.statusLabel}</span> : null}
                <span>{context.live ? "Live review" : "Settled review"}</span>
            </div>
        </section>
    );
}
