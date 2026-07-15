// @ts-nocheck: Workspace React UI is the scoped TypeScript/TSX exception zone.

import { useCallback, useEffect, useRef, useState } from "react";
import { createCollaborationClient } from "../../../shared/collaboration/client.js";
import { decryptJsonPayload, encryptJsonPayload, importContentKey } from "../../../shared/collaboration/crypto.js";
import { normalizeEncryptedPlanPayload } from "../../../shared/collaboration/protocol.js";
import { parseCollaborationUrl } from "../../../shared/collaboration/urls.js";
import { RenderedMarkdown } from "@plannotator/ui/components/RenderedMarkdown.tsx";
import { RemoteCommentPanel } from "./RemoteCommentPanel.tsx";
import { RemoteCommentPopover } from "./RemoteCommentPopover.tsx";
import { buildRemoteCommentPayload, normalizeRemoteCommentPayload } from "./remote-review-payload.js";

const DISPLAY_NAME_KEY = "runwield.remoteReview.displayName";

export function RemotePlanReview({ spaceId }) {
    const documentRef = useRef(null);
    const [client, setClient] = useState(null);
    const [contentKey, setContentKey] = useState(null);
    const [role, setRole] = useState("reviewer");
    const [space, setSpace] = useState(null);
    const [selectedRevision, setSelectedRevision] = useState(null);
    const [plan, setPlan] = useState(null);
    const [comments, setComments] = useState([]);
    const [selectedCommentId, setSelectedCommentId] = useState(null);
    const [selection, setSelection] = useState(null);
    const [popoverMode, setPopoverMode] = useState(null);
    const [displayName, setDisplayName] = useState("");
    const [commentBody, setCommentBody] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [pendingCommentId, setPendingCommentId] = useState(null);
    const [error, setError] = useState("");
    const [status, setStatus] = useState("");

    const closed = space?.status === "closed";

    useEffect(() => {
        setDisplayName(localStorage.getItem(DISPLAY_NAME_KEY) || "");
        try {
            const parsed = parseCollaborationUrl(globalThis.location.href);
            if (parsed.spaceId !== spaceId) throw new Error("Collaboration URL does not match this Shared Space.");
            setRole(parsed.role);
            setClient(createCollaborationClient({
                serverUrl: parsed.apiBaseUrl,
                bearerCapability: parsed.bearerCapability,
                fetch: globalThis.fetch.bind(globalThis),
            }));
            importContentKey(parsed.contentKey).then(setContentKey).catch(() => {
                setError("The link contains an invalid content key. Ask the maintainer for a fresh Shared Space URL.");
                setLoading(false);
            });
        } catch (caught) {
            setError(safeMessage(caught) || "The collaboration link is missing key, capability, or role details.");
            setLoading(false);
        }
    }, [spaceId]);

    const loadRevision = useCallback(async (targetRevision) => {
        if (!client || !contentKey) return;
        setLoading(true);
        setError("");
        setStatus("");
        try {
            const metadata = await client.getSharedSpace(spaceId);
            const nextSpace = normalizeSpace(metadata);
            const revisionNumber = targetRevision || nextSpace.latestRevision;
            const revisionResponse = await client.getRevision(spaceId, revisionNumber);
            const nextRevision = normalizeRevisionResponse(revisionResponse);
            const decryptedPlan = normalizeEncryptedPlanPayload(
                await decryptJsonPayload(nextRevision.payloadCiphertext, contentKey),
            );
            const commentResponse = await client.listComments(spaceId, revisionNumber);
            const nextComments = await decryptComments(commentResponse, contentKey);
            setSpace(nextSpace);
            setSelectedRevision(revisionNumber);
            setPlan(decryptedPlan);
            setComments(nextComments);
            setSelectedCommentId(null);
            setSelection(null);
            setPopoverMode(null);
        } catch (caught) {
            setError(messageForFailure(caught));
        } finally {
            setLoading(false);
        }
    }, [client, contentKey, spaceId]);

    useEffect(() => {
        loadRevision(null);
    }, [loadRevision]);

    useEffect(() => {
        const missingIds = restoreInlineHighlights(documentRef.current, comments);
        const nextComments = comments.map((comment) =>
            comment.unreadable ? comment : {
                ...comment,
                anchorMissing: comment.type === "comment" ? missingIds.has(comment.id) : false,
            }
        );
        if (JSON.stringify(nextComments.map(anchorState)) !== JSON.stringify(comments.map(anchorState))) {
            setComments(nextComments);
        }
    }, [plan?.body, comments.length, selectedRevision]);

    function rememberDisplayName(value) {
        setDisplayName(value);
        localStorage.setItem(DISPLAY_NAME_KEY, value);
    }

    function captureSelection() {
        const nextSelection = readSelection(documentRef.current);
        if (nextSelection) setSelection(nextSelection);
    }

    function openGlobalComment() {
        setSelection(null);
        setCommentBody("");
        setPopoverMode("global");
    }

    function openInlineComment() {
        if (!selection) return;
        setCommentBody("");
        setPopoverMode("inline");
    }

    async function submitComment(event) {
        event.preventDefault();
        if (!client || !contentKey || !selectedRevision) return;
        if (closed) {
            setError("This Shared Space is closed. New comments are disabled.");
            return;
        }
        setSaving(true);
        setError("");
        try {
            const payload = buildRemoteCommentPayload({
                displayName,
                body: commentBody,
                selection: popoverMode === "inline" ? selection : null,
            });
            const ciphertext = await encryptJsonPayload(payload, contentKey);
            await client.appendComment(spaceId, selectedRevision, { ciphertext });
            setStatus("Encrypted comment saved.");
            setCommentBody("");
            setSelection(null);
            setPopoverMode(null);
            await loadRevision(selectedRevision);
        } catch (caught) {
            setError(messageForFailure(caught));
        } finally {
            setSaving(false);
        }
    }

    async function setCommentState(commentId, action) {
        if (!client || closed) return;
        setPendingCommentId(commentId);
        setError("");
        try {
            const response = await client.setCommentState(spaceId, commentId, { action });
            const updated = normalizeCommentRecord(response?.comment || response);
            setComments((items) =>
                items.map((item) => item.id === commentId ? { ...item, resolved: updated.resolved } : item)
            );
        } catch (caught) {
            setError(messageForFailure(caught));
        } finally {
            setPendingCommentId(null);
        }
    }

    function selectComment(commentId) {
        setSelectedCommentId(commentId);
        const comment = comments.find((item) => item.id === commentId);
        const blockId = comment?.anchor?.blockId;
        if (blockId) {
            documentRef.current?.querySelector(`[data-block-id="${CSS.escape(blockId)}"]`)?.scrollIntoView({
                block: "center",
            });
        }
    }

    return (
        <section className="rw-remote-review-shell">
            <header className="rw-remote-review-header">
                <div>
                    <p className="eyebrow">Shared Space Review · {role}</p>
                    <h1>{plan?.title || "Remote Plan Review"}</h1>
                    {space ? <p>Space {space.spaceId} · Plan {space.planId}</p> : <p>Decrypting Shared Space…</p>}
                </div>
                <div className="rw-remote-review-actions">
                    {space?.status
                        ? <span className={closed ? "badge warning" : "badge success"}>{space.status}</span>
                        : null}
                    <button type="button" onClick={openGlobalComment} disabled={loading || closed || !plan}>
                        Global comment
                    </button>
                </div>
            </header>

            {error ? <p className="rw-review-error" role="alert">{error}</p> : null}
            {status ? <p className="notice" role="status">{status}</p> : null}
            {closed
                ? (
                    <p className="notice muted">
                        This Shared Space is closed. You can read comments, but cannot create, resolve, or reopen them.
                    </p>
                )
                : null}

            <div className="rw-remote-review-toolbar">
                <label>
                    Revision
                    <select
                        value={selectedRevision || ""}
                        disabled={loading || !space?.revisions?.length}
                        onChange={(event) => loadRevision(Number(event.currentTarget.value))}
                    >
                        {(space?.revisions || []).map((item) => (
                            <option key={item.revision} value={item.revision}>Revision {item.revision}</option>
                        ))}
                    </select>
                </label>
                <label>
                    Display name
                    <input
                        value={displayName}
                        onChange={(event) => rememberDisplayName(event.currentTarget.value)}
                        placeholder="Your name"
                        autoComplete="name"
                    />
                </label>
                <button type="button" onClick={openInlineComment} disabled={loading || closed || !selection}>
                    Comment on selection
                </button>
                {selection
                    ? <span className="rw-selection-status">Selected: “{shorten(selection.originalText)}”</span>
                    : null}
            </div>

            {loading ? <p className="notice">Loading encrypted Shared Space…</p> : null}

            <div className="rw-remote-review-grid">
                <article className="rw-remote-plan-card">
                    <div ref={documentRef} onMouseUp={captureSelection} onKeyUp={captureSelection}>
                        {plan?.body
                            ? (
                                <RenderedMarkdown
                                    markdown={plan.body}
                                    className="markdown-view rw-remote-plan-document"
                                />
                            )
                            : (
                                <div className="markdown-view rw-remote-plan-document">
                                    <p className="empty">No Plan body content.</p>
                                </div>
                            )}
                    </div>
                </article>
                <RemoteCommentPanel
                    comments={comments}
                    selectedId={selectedCommentId}
                    closed={closed}
                    pendingId={pendingCommentId}
                    onSelect={selectComment}
                    onResolve={(id) => setCommentState(id, "resolve")}
                    onReopen={(id) => setCommentState(id, "reopen")}
                />
            </div>

            {popoverMode
                ? (
                    <div className="rw-remote-popover-backdrop">
                        <RemoteCommentPopover
                            mode={popoverMode === "inline" ? "inline" : "global"}
                            selection={popoverMode === "inline" ? selection : null}
                            displayName={displayName}
                            body={commentBody}
                            disabled={saving || closed}
                            onDisplayNameChange={rememberDisplayName}
                            onBodyChange={setCommentBody}
                            onCancel={() => setPopoverMode(null)}
                            onSubmit={submitComment}
                        />
                    </div>
                )
                : null}
        </section>
    );
}

async function decryptComments(response, contentKey) {
    const records = Array.isArray(response?.comments) ? response.comments : [];
    return await Promise.all(records.map(async (record) => {
        const normalized = normalizeCommentRecord(record);
        try {
            const payload = normalizeRemoteCommentPayload(await decryptJsonPayload(normalized.ciphertext, contentKey));
            return {
                ...normalized,
                ...payload,
                anchorMissing: false,
                unreadable: false,
            };
        } catch {
            return {
                ...normalized,
                schemaVersion: 1,
                type: "global_comment",
                displayName: "",
                body: "",
                originalText: "",
                anchor: null,
                anchorMissing: false,
                unreadable: true,
            };
        }
    }));
}

function normalizeSpace(value) {
    if (!value || typeof value !== "object") throw new Error("Invalid Shared Space response.");
    const record = value.space && typeof value.space === "object" ? value.space : value;
    return {
        ...record,
        latestRevision: Number(record.latestRevision),
        revisions: Array.isArray(record.revisions)
            ? record.revisions.map((item) => ({ ...item, revision: Number(item.revision) }))
            : [],
    };
}

function normalizeRevisionResponse(value) {
    const record = value?.revision || value;
    if (!record?.payloadCiphertext) throw new Error("Invalid revision response.");
    return { ...record, revision: Number(record.revision) };
}

function normalizeCommentRecord(value) {
    const record = value?.comment || value;
    if (!record?.id) throw new Error("Invalid comment response.");
    return {
        ...record,
        id: String(record.id),
        resolved: Boolean(record.resolved),
        createdAt: String(record.createdAt || new Date().toISOString()),
    };
}

function readSelection(root) {
    const selection = globalThis.getSelection?.();
    if (!root || !selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return null;
    const selectedText = selection.toString().trim();
    if (!selectedText) return null;
    const element = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;
    const block = element?.closest?.("[data-block-id]");
    if (!block) return null;
    const blockText = block.textContent || "";
    const beforeRange = range.cloneRange();
    beforeRange.selectNodeContents(block);
    beforeRange.setEnd(range.startContainer, range.startOffset);
    const startOffset = beforeRange.toString().length;
    const endOffset = startOffset + selectedText.length;
    return {
        blockId: block.dataset.blockId,
        originalText: selectedText,
        startOffset,
        endOffset,
        prefix: blockText.slice(Math.max(0, startOffset - 40), startOffset),
        suffix: blockText.slice(endOffset, endOffset + 40),
    };
}

function restoreInlineHighlights(root, comments) {
    const missing = new Set();
    if (!root) return missing;
    for (const mark of root.querySelectorAll("mark.rw-remote-inline-highlight")) {
        mark.replaceWith(document.createTextNode(mark.textContent || ""));
    }
    root.normalize();
    for (const block of root.querySelectorAll("[data-block-id]")) block.classList.remove("rw-remote-commented-block");
    for (const comment of comments) {
        if (comment.unreadable || comment.type !== "comment" || !comment.anchor?.blockId) continue;
        const restored = highlightComment(root, comment);
        if (!restored) missing.add(comment.id);
    }
    return missing;
}

function highlightComment(root, comment) {
    const block = root.querySelector(`[data-block-id="${CSS.escape(comment.anchor.blockId)}"]`);
    if (!block) return false;
    const blockText = block.textContent || "";
    const expected = comment.originalText || "";
    const start = findHighlightStart(blockText, comment.anchor, expected);
    if (start < 0) return false;
    const end = start + expected.length;
    const range = rangeForTextOffsets(block, start, end);
    if (!range) return false;
    const mark = document.createElement("mark");
    mark.className = "rw-remote-inline-highlight";
    mark.dataset.commentId = comment.id;
    mark.title = `Comment by ${comment.displayName}`;
    try {
        range.surroundContents(mark);
    } catch {
        mark.append(range.extractContents());
        range.insertNode(mark);
    }
    block.classList.add("rw-remote-commented-block");
    return true;
}

function findHighlightStart(blockText, anchor, expected) {
    if (!expected) return -1;
    const anchored = blockText.slice(anchor.startOffset, anchor.endOffset);
    if (anchored === expected) return anchor.startOffset;
    return blockText.indexOf(expected);
}

function rangeForTextOffsets(root, start, end) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let offset = 0;
    let startNode = null;
    let startNodeOffset = 0;
    let endNode = null;
    let endNodeOffset = 0;
    while (walker.nextNode()) {
        const node = walker.currentNode;
        const nextOffset = offset + (node.textContent || "").length;
        if (!startNode && start >= offset && start <= nextOffset) {
            startNode = node;
            startNodeOffset = start - offset;
        }
        if (startNode && end >= offset && end <= nextOffset) {
            endNode = node;
            endNodeOffset = end - offset;
            break;
        }
        offset = nextOffset;
    }
    if (!startNode || !endNode) return null;
    const range = document.createRange();
    range.setStart(startNode, startNodeOffset);
    range.setEnd(endNode, endNodeOffset);
    return range;
}

function anchorState(comment) {
    return `${comment.id}:${comment.anchorMissing ? "missing" : "ok"}`;
}

function messageForFailure(caught) {
    const message = safeMessage(caught);
    if (/decrypt|content key|payload/i.test(message)) {
        return "Unable to decrypt this Shared Space with the provided key. Ask the maintainer for a fresh link.";
    }
    if (/401|Bearer/i.test(message)) return "This link is missing an authorization capability.";
    if (/403|authorized|forbidden/i.test(message)) return "This link is not authorized for the requested Shared Space.";
    if (/404|not found|deleted/i.test(message)) return "Shared Space not found or deleted.";
    if (/closed/i.test(message)) return "This Shared Space is closed. Updates are disabled.";
    return message || "Unable to load the Shared Space.";
}

function safeMessage(caught) {
    const message = caught instanceof Error ? caught.message : String(caught || "");
    return message.replace(/#.*$/g, "#[redacted]").replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]");
}

function shorten(value) {
    return value.length > 80 ? `${value.slice(0, 77)}…` : value;
}
