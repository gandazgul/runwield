/**
 * @typedef {Object} RemoteCommentStateItem
 * @property {string} id
 * @property {boolean} resolved
 * @property {string} createdAt
 * @property {"comment" | "global_comment"} type
 * @property {string} displayName
 * @property {string} body
 * @property {string} originalText
 * @property {boolean} [anchorMissing]
 * @property {boolean} [unreadable]
 */

/**
 * @typedef {Object} RemoteCommentStateListProps
 * @property {RemoteCommentStateItem[]} comments
 * @property {string | null} selectedId
 * @property {boolean} closed
 * @property {string | null} pendingId
 * @property {(id: string) => void} onSelect
 * @property {(id: string) => void} onResolve
 * @property {(id: string) => void} onReopen
 */

/** @param {RemoteCommentStateListProps} props */
export function RemoteCommentStateList({ comments, selectedId, closed, pendingId, onResolve, onReopen }) {
    const selectedComment = selectedId ? comments.find((comment) => comment.id === selectedId) : null;
    return (
        <>
            {closed && (
                <p className="notice muted" role="status">
                    This Shared Space is closed. Comments remain readable, but updates are disabled.
                </p>
            )}
            {selectedComment
                ? (
                    <section className="rw-remote-comment-state-panel" aria-label="Selected comment state">
                        {selectedComment.unreadable
                            ? (
                                <p className="rw-comment-error">
                                    This comment could not be decrypted. It may use a different key or be tampered with.
                                </p>
                            )
                            : null}
                        {selectedComment.anchorMissing
                            ? <p className="rw-comment-anchor-missing">Anchor not found in this revision.</p>
                            : null}
                        <div className="rw-comment-state-row">
                            <span className={selectedComment.resolved ? "badge success" : "badge"}>
                                {selectedComment.resolved ? "Resolved" : "Open"}
                            </span>
                            {!selectedComment.unreadable
                                ? (
                                    selectedComment.resolved
                                        ? (
                                            <button
                                                type="button"
                                                disabled={closed || pendingId === selectedComment.id}
                                                onClick={() => onReopen(selectedComment.id)}
                                            >
                                                {pendingId === selectedComment.id ? "Reopening…" : "Reopen"}
                                            </button>
                                        )
                                        : (
                                            <button
                                                type="button"
                                                disabled={closed || pendingId === selectedComment.id}
                                                onClick={() => onResolve(selectedComment.id)}
                                            >
                                                {pendingId === selectedComment.id ? "Resolving…" : "Resolve"}
                                            </button>
                                        )
                                )
                                : null}
                        </div>
                    </section>
                )
                : null}
        </>
    );
}
