// @ts-nocheck: Workspace React UI is the scoped TypeScript/TSX exception zone.

export function RemoteCommentPanel({ comments, selectedId, closed, pendingId, onSelect, onResolve, onReopen }) {
    return (
        <aside className="rw-remote-comments" aria-label="Remote review comments">
            <div className="rw-remote-comments-header">
                <h2>Comments</h2>
                <span>{comments.length}</span>
            </div>
            {closed && (
                <p className="notice muted" role="status">
                    This Shared Space is closed. Comments remain readable, but updates are disabled.
                </p>
            )}
            {comments.length === 0 ? <p className="empty">No comments on this revision yet.</p> : null}
            <ol className="rw-remote-comment-list">
                {comments.map((comment) => (
                    <li key={comment.id}>
                        <article
                            className={`rw-remote-comment-card ${selectedId === comment.id ? "selected" : ""} ${
                                comment.resolved ? "resolved" : ""
                            } ${comment.unreadable ? "unreadable" : ""}`}
                        >
                            <button
                                type="button"
                                className="rw-comment-card-select"
                                onClick={() => onSelect(comment.id)}
                            >
                                <span className="rw-comment-author">{comment.displayName || "Unreadable comment"}</span>
                                <span className="rw-comment-meta">
                                    {comment.type === "global_comment" ? "Global" : "Inline"} ·{" "}
                                    {formatDate(comment.createdAt)}
                                </span>
                            </button>
                            {comment.unreadable
                                ? (
                                    <p className="rw-comment-error">
                                        This comment could not be decrypted. It may use a different key or be tampered
                                        with.
                                    </p>
                                )
                                : (
                                    <>
                                        {comment.originalText
                                            ? (
                                                <blockquote className="rw-comment-context">
                                                    {comment.originalText}
                                                </blockquote>
                                            )
                                            : null}
                                        {comment.anchorMissing
                                            ? (
                                                <p className="rw-comment-anchor-missing">
                                                    Anchor not found in this revision.
                                                </p>
                                            )
                                            : null}
                                        <p className="rw-comment-body">{comment.body}</p>
                                    </>
                                )}
                            <div className="rw-comment-state-row">
                                <span className={comment.resolved ? "badge success" : "badge"}>
                                    {comment.resolved ? "Resolved" : "Open"}
                                </span>
                                {!comment.unreadable
                                    ? (
                                        comment.resolved
                                            ? (
                                                <button
                                                    type="button"
                                                    disabled={closed || pendingId === comment.id}
                                                    onClick={() => onReopen(comment.id)}
                                                >
                                                    {pendingId === comment.id ? "Reopening…" : "Reopen"}
                                                </button>
                                            )
                                            : (
                                                <button
                                                    type="button"
                                                    disabled={closed || pendingId === comment.id}
                                                    onClick={() => onResolve(comment.id)}
                                                >
                                                    {pendingId === comment.id ? "Resolving…" : "Resolve"}
                                                </button>
                                            )
                                    )
                                    : null}
                            </div>
                        </article>
                    </li>
                ))}
            </ol>
        </aside>
    );
}

function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
}
