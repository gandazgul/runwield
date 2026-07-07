import { useEffect, useRef, useState } from "preact/hooks";
import { basicSetup, EditorView } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { PLAN_UI_TOKEN_HEADER, PLAN_UI_TOKEN_QUERY } from "../constants.js";
import { renderMarkdown } from "../components/MarkdownView.jsx";

/**
 * @param {string} workspaceKey
 * @param {string} planId
 */
export function planBodyDraftKey(workspaceKey, planId) {
    return `runwield:workspace:${workspaceKey}:plan:${planId}:bodyDraft`;
}

/**
 * @param {{ baseBodyHash?: string } | null} draft
 * @param {string} currentBodyHash
 * @returns {"none"|"same-base"|"changed-on-disk"}
 */
export function draftRecoveryState(draft, currentBodyHash) {
    if (!draft) return "none";
    return draft.baseBodyHash === currentBodyHash ? "same-base" : "changed-on-disk";
}

/**
 * @param {{ baseBodyHash: string }} draft
 * @returns {string}
 */
export function restoredDraftExpectedBodyHash(draft) {
    return draft.baseBodyHash;
}

/**
 * @typedef {Object} PlanBodyDraft
 * @property {string} body
 * @property {string} baseBodyHash
 * @property {string} [updatedAt]
 */

/** @param {{ body: string, baseBodyHash: string }} draft */
function serializeDraft(draft) {
    return JSON.stringify({ body: draft.body, baseBodyHash: draft.baseBodyHash, updatedAt: new Date().toISOString() });
}

/**
 * @param {string} key
 * @returns {{ body: string, baseBodyHash: string, updatedAt?: string } | null}
 */
function readDraft(key) {
    try {
        const parsed = JSON.parse(localStorage.getItem(key) || "null");
        return parsed && typeof parsed.body === "string" && typeof parsed.baseBodyHash === "string" ? parsed : null;
    } catch {
        return null;
    }
}

/** @param {{ plan: any, initialEdit?: boolean }} props */
export function PlanBodyEditor({ plan, initialEdit = false }) {
    const canEdit = plan.capabilities?.bodyEditing !== false;
    const [mode, setMode] = useState("read");
    const [body, setBody] = useState(plan.body || "");
    const [savedBody, setSavedBody] = useState(plan.body || "");
    const [bodyHash, setBodyHash] = useState(plan.bodyHash || "");
    const [expectedBodyHash, setExpectedBodyHash] = useState(plan.bodyHash || "");
    const [message, setMessage] = useState("");
    const [draft, setDraft] = useState(/** @type {PlanBodyDraft | null} */ (null));
    const [saving, setSaving] = useState(false);
    const editorHost = useRef(/** @type {HTMLDivElement | null} */ (null));
    const readHost = useRef(/** @type {HTMLDivElement | null} */ (null));
    const editorView = useRef(/** @type {EditorView | null} */ (null));
    const dirty = body !== savedBody;
    const draftKey = planBodyDraftKey(plan.workspaceKey || "unknown", plan.planId);

    useEffect(() => {
        if (!canEdit) return;
        const stored = readDraft(draftKey);
        if (stored) {
            setDraft(stored);
            if (initialEdit) {
                setMessage("A local draft exists. Restore or discard it before editing this Plan body.");
                setMode("read");
            }
            return;
        }
        if (initialEdit) setMode("edit");
    }, [canEdit, draftKey, initialEdit]);

    useEffect(() => {
        if (!canEdit || !dirty) return undefined;
        const handler = (/** @type {BeforeUnloadEvent} */ event) => {
            event.preventDefault();
            event.returnValue = "";
        };
        addEventListener("beforeunload", handler);
        return () => removeEventListener("beforeunload", handler);
    }, [canEdit, dirty]);

    useEffect(() => {
        if (!canEdit || mode !== "edit" || !editorHost.current) return undefined;
        const view = new EditorView({
            doc: body,
            extensions: [
                basicSetup,
                markdown(),
                EditorView.updateListener.of((update) => {
                    if (update.docChanged) setBody(update.state.doc.toString());
                }),
            ],
            parent: editorHost.current,
        });
        editorView.current = view;
        return () => {
            view.destroy();
            editorView.current = null;
        };
    }, [canEdit, mode]);

    useEffect(() => {
        if (!canEdit || mode !== "edit" || !editorView.current) return;
        const current = editorView.current.state.doc.toString();
        if (current === body) return;
        editorView.current.dispatch({ changes: { from: 0, to: current.length, insert: body } });
    }, [body, canEdit, mode]);

    useEffect(() => {
        if (mode !== "read" || !readHost.current) return undefined;
        const host = readHost.current;
        return () => {
            host.dispatchEvent(new CustomEvent("runwield:plannotator-plan-body:unmount"));
        };
    }, [mode, savedBody]);

    useEffect(() => {
        if (!canEdit || !dirty) return;
        localStorage.setItem(draftKey, serializeDraft({ body, baseBodyHash: expectedBodyHash }));
    }, [body, canEdit, dirty, draftKey, expectedBodyHash]);

    function restoreDraft() {
        if (!draft) return;
        setBody(draft.body);
        setExpectedBodyHash(restoredDraftExpectedBodyHash(draft));
        setMessage(
            draft.baseBodyHash === bodyHash
                ? "Draft restored. Review before saving."
                : "Draft restored against its original on-disk version. Saving will require resolving the newer on-disk changes.",
        );
        setMode("edit");
    }

    function discardDraft() {
        localStorage.removeItem(draftKey);
        setDraft(null);
        setMessage("Draft discarded.");
    }

    function cancelEdit() {
        const shouldDiscard = dirty && confirm("Discard unsaved editor changes and local draft?");
        setBody(savedBody);
        setExpectedBodyHash(bodyHash);
        setMode("read");
        if (shouldDiscard) discardDraft();
    }

    async function saveBody() {
        setSaving(true);
        setMessage("");
        try {
            const url = new URL(location.href);
            const token = url.searchParams.get(PLAN_UI_TOKEN_QUERY) || "";
            const response = await fetch(`/api/plans/${encodeURIComponent(plan.planId)}/body`, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    ...(token ? { [PLAN_UI_TOKEN_HEADER]: token } : {}),
                },
                body: JSON.stringify({ body, expectedBodyHash }),
            });
            const payload = await response.json();
            if (response.status === 409) {
                setMessage(`${payload.error || "Conflict saving Plan body."} Your local draft was kept.`);
                return;
            }
            if (!response.ok) {
                setMessage(payload.error || "Unable to save Plan body.");
                return;
            }
            const nextHash = payload.bodyHash || payload.plan?.bodyHash || "";
            setBodyHash(nextHash);
            setExpectedBodyHash(nextHash);
            setSavedBody(body);
            localStorage.removeItem(draftKey);
            setDraft(null);
            setMode("read");
            setMessage("Plan body saved.");
        } finally {
            setSaving(false);
        }
    }

    const recovery = draftRecoveryState(draft, bodyHash);
    const preview = renderMarkdown(savedBody);
    const planBodyJson = JSON.stringify({ body: savedBody }).replace(/</g, "\\u003c");

    return (
        <section class="plan-body-editor" data-editor-mode={mode}>
            {mode === "edit"
                ? (
                    <div class="editor-toolbar">
                        <button type="button" class="primary-action" disabled={saving || !dirty} onClick={saveBody}>
                            {saving ? "Saving…" : "Save"}
                        </button>
                        <button type="button" onClick={cancelEdit}>Cancel</button>
                        <span class={dirty ? "dirty-indicator" : "saved-indicator"}>
                            {dirty ? "Unsaved changes" : "No changes"}
                        </span>
                    </div>
                )
                : null}
            {message ? <p class="notice editor-notice">{message}</p> : null}
            {canEdit && draft && mode === "read"
                ? (
                    <div class={recovery === "changed-on-disk" ? "notice warning" : "notice"}>
                        {recovery === "changed-on-disk"
                            ? "A local draft exists, but this Plan changed on disk. Restore only if you want to copy or merge it manually."
                            : "A local unsaved draft is available for this Plan body."}
                        <div class="inline-actions">
                            <button type="button" onClick={restoreDraft}>Restore draft</button>
                            <button type="button" onClick={discardDraft}>Discard draft</button>
                        </div>
                    </div>
                )
                : null}
            {mode === "edit"
                ? <div class="codemirror-shell" ref={editorHost} aria-label="Plan body markdown editor" />
                : (
                    <div
                        ref={readHost}
                        data-plannotator-plan-body
                        data-plan-id={plan.planId}
                        data-plannotator-renderer="ssr-fallback"
                    >
                        <script
                            type="application/json"
                            data-plannotator-plan-body-json
                            dangerouslySetInnerHTML={{ __html: planBodyJson }}
                        />
                        <div data-plannotator-plan-body-root />
                        <script type="module" src="/src/ui/workspace/react/plan-detail-entry.tsx" />
                        {preview
                            ? <div class="markdown-view" dangerouslySetInnerHTML={{ __html: preview }} />
                            : (
                                <div class="markdown-view">
                                    <p class="empty">No Plan body content.</p>
                                </div>
                            )}
                    </div>
                )}
        </section>
    );
}

export default PlanBodyEditor;
