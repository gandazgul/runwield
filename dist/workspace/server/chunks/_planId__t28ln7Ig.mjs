import { e as createComponent, k as renderComponent, r as renderTemplate, h as createAstro, m as maybeRenderHead } from './astro/server_CySqi4lW.mjs';
import { e as PLAN_UI_TOKEN_QUERY, f as PLAN_UI_TOKEN_HEADER, g as workspaceHref, h as PlanLifecycleActions, B as BoardColumn, C as ComplexityLabel, i as loadCanonicalWorkspaceDetail, s as serializeCanonicalPlanError, $ as $$WorkspaceLayout } from './astro-canonical-data_DtpUFPWi.mjs';
import { jsx, jsxs, Fragment } from 'react/jsx-runtime';
import { useState, useRef, useEffect } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { markdown } from '@codemirror/lang-markdown';
import quikdown from 'quikdown';
import '../renderers.mjs';

const PLAN_FRONT_MATTER_KEYS = Object.freeze({
    planId: "planId",
    classification: "classification",
    complexity: "complexity",
    summary: "summary",
    affectedPaths: "affectedPaths",
    frontend: "frontend",
    devServerCommand: "devServerCommand",
    devServerUrl: "devServerUrl",
    devServerHmr: "devServerHmr",
    createdAt: "createdAt",
    updatedAt: "updatedAt",
    status: "status",
    origin: "origin",
    type: "type",
    parentPlan: "parentPlan",
    order: "order",
    dependencies: "dependencies",
    failureReason: "failureReason",
    failedAt: "failedAt",
    implementedAt: "implementedAt",
    verifiedAt: "verifiedAt",
    humanReviewMode: "humanReviewMode",
    humanReviewDecision: "humanReviewDecision",
    humanReviewedAt: "humanReviewedAt",
    epicCompletionMode: "epicCompletionMode",
    epicDoneEnoughAt: "epicDoneEnoughAt",
    epicDoneEnoughSummary: "epicDoneEnoughSummary",
    executionBaselineTree: "executionBaselineTree",
    worktreeId: "worktreeId",
    worktreePath: "worktreePath",
    worktreeBranch: "worktreeBranch",
    worktreeBaseBranch: "worktreeBaseBranch",
    worktreeStatus: "worktreeStatus",
    heldFromStatus: "heldFromStatus",
    heldAt: "heldAt",
    holdReason: "holdReason",
    holdStalenessBaseline: "holdStalenessBaseline",
    archivedAt: "archivedAt",
    archiveReason: "archiveReason",
    archivedFromStatus: "archivedFromStatus",
    archivedFromPath: "archivedFromPath",
    restoredAt: "restoredAt",
    restoredFromPath: "restoredFromPath",
    collaborationState: "collaborationState",
    collaborationServerUrl: "collaborationServerUrl",
    collaborationSpaceId: "collaborationSpaceId",
    collaborationRevision: "collaborationRevision",
    collaborationBodyHash: "collaborationBodyHash",
    collaborationSyncedAt: "collaborationSyncedAt",
});

const PLAN_FRONT_MATTER_KEY_ORDER = Object.freeze(Object.values(PLAN_FRONT_MATTER_KEYS));

function MarkdownView({ markdown }) {
  const html = renderMarkdown(markdown || "");
  return html ? /* @__PURE__ */ jsx("div", { className: "markdown-view", dangerouslySetInnerHTML: { __html: html } }) : /* @__PURE__ */ jsx("div", { className: "markdown-view", children: /* @__PURE__ */ jsx("p", { className: "empty", children: "No Plan body content." }) });
}
function renderMarkdown(markdown) {
  return String(quikdown(markdown || "")).trim();
}

const planDetailEntryModules = typeof import.meta.glob === "function" ? /* #__PURE__ */ Object.assign({"../react/plan-detail-entry.tsx": () => import('./plan-detail-entry_C1jVFOKJ.mjs')}) : { "../react/plan-detail-entry.tsx": () => Promise.resolve() };
function planBodyDraftKey(workspaceKey, planId) {
  return `runwield:workspace:${workspaceKey}:plan:${planId}:bodyDraft`;
}
function draftRecoveryState(draft, currentBodyHash) {
  if (!draft) return "none";
  return draft.baseBodyHash === currentBodyHash ? "same-base" : "changed-on-disk";
}
function restoredDraftExpectedBodyHash(draft) {
  return draft.baseBodyHash;
}
function serializeDraft(draft) {
  return JSON.stringify({ body: draft.body, baseBodyHash: draft.baseBodyHash, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
}
function readDraft(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "null");
    return parsed && typeof parsed.body === "string" && typeof parsed.baseBodyHash === "string" ? parsed : null;
  } catch {
    return null;
  }
}
function PlanBodyEditor({ plan, initialEdit = false }) {
  const canEdit = plan.capabilities?.bodyEditing !== false;
  const [mode, setMode] = useState("read");
  const [body, setBody] = useState(plan.body || "");
  const [savedBody, setSavedBody] = useState(plan.body || "");
  const [bodyHash, setBodyHash] = useState(plan.bodyHash || "");
  const [expectedBodyHash, setExpectedBodyHash] = useState(plan.bodyHash || "");
  const [message, setMessage] = useState("");
  const [draft, setDraft] = useState(
    /** @type {PlanBodyDraft | null} */
    null
  );
  const [saving, setSaving] = useState(false);
  const editorHost = useRef(
    /** @type {HTMLDivElement | null} */
    null
  );
  const readHost = useRef(
    /** @type {HTMLDivElement | null} */
    null
  );
  const editorView = useRef(
    /** @type {EditorView | null} */
    null
  );
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
    if (!canEdit || !dirty) return void 0;
    const handler = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    addEventListener("beforeunload", handler);
    return () => removeEventListener("beforeunload", handler);
  }, [canEdit, dirty]);
  useEffect(() => {
    if (!canEdit || mode !== "edit" || !editorHost.current) return void 0;
    const view = new EditorView({
      doc: body,
      extensions: [
        basicSetup,
        markdown(),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) setBody(update.state.doc.toString());
        })
      ],
      parent: editorHost.current
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
    if (mode !== "read" || !readHost.current) return void 0;
    const host = readHost.current;
    const loadPlanDetailEntry = planDetailEntryModules["../react/plan-detail-entry.tsx"];
    void loadPlanDetailEntry?.().then(() => {
      host.dispatchEvent(new CustomEvent("runwield:plannotator-plan-body:mount", { bubbles: true }));
    });
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
      draft.baseBodyHash === bodyHash ? "Draft restored. Review before saving." : "Draft restored against its original on-disk version. Saving will require resolving the newer on-disk changes."
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
          ...token ? { [PLAN_UI_TOKEN_HEADER]: token } : {}
        },
        body: JSON.stringify({ body, expectedBodyHash })
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
  const planBodyJson = JSON.stringify({ body: savedBody }).replace(/</g, "\\u003c");
  return /* @__PURE__ */ jsxs("section", { className: "plan-body-editor", "data-editor-mode": mode, children: [
    mode === "edit" ? /* @__PURE__ */ jsxs("div", { className: "editor-toolbar", children: [
      /* @__PURE__ */ jsx("button", { type: "button", className: "primary-action", disabled: saving || !dirty, onClick: saveBody, children: saving ? "Saving…" : "Save" }),
      /* @__PURE__ */ jsx("button", { type: "button", onClick: cancelEdit, children: "Cancel" }),
      /* @__PURE__ */ jsx("span", { className: dirty ? "dirty-indicator" : "saved-indicator", children: dirty ? "Unsaved changes" : "No changes" })
    ] }) : null,
    message ? /* @__PURE__ */ jsx("p", { className: "notice editor-notice", children: message }) : null,
    canEdit && draft && mode === "read" ? /* @__PURE__ */ jsxs("div", { className: recovery === "changed-on-disk" ? "notice warning" : "notice", children: [
      recovery === "changed-on-disk" ? "A local draft exists, but this Plan changed on disk. Restore only if you want to copy or merge it manually." : "A local unsaved draft is available for this Plan body.",
      /* @__PURE__ */ jsxs("div", { className: "inline-actions", children: [
        /* @__PURE__ */ jsx("button", { type: "button", onClick: restoreDraft, children: "Restore draft" }),
        /* @__PURE__ */ jsx("button", { type: "button", onClick: discardDraft, children: "Discard draft" })
      ] })
    ] }) : null,
    mode === "edit" ? /* @__PURE__ */ jsx("div", { className: "codemirror-shell", ref: editorHost, "aria-label": "Plan body markdown editor" }) : /* @__PURE__ */ jsxs(
      "div",
      {
        ref: readHost,
        "data-plannotator-plan-body": true,
        "data-plan-id": plan.planId,
        "data-plannotator-renderer": "ssr-fallback",
        children: [
          /* @__PURE__ */ jsx(
            "script",
            {
              type: "application/json",
              "data-plannotator-plan-body-json": true,
              dangerouslySetInnerHTML: { __html: planBodyJson }
            }
          ),
          /* @__PURE__ */ jsx("div", { "data-plannotator-plan-body-root": true, children: /* @__PURE__ */ jsx(MarkdownView, { markdown: savedBody }) })
        ]
      }
    )
  ] });
}

const CLOSED_STATUSES = /* @__PURE__ */ new Set(["verified", "closed_without_verification"]);
function tabForPlanStatus(status) {
  if (status === "on_hold") return "on-hold";
  if (CLOSED_STATUSES.has(status)) return "closed";
  return "active";
}
function boardHrefForPlanStatus(status, url) {
  const tab = tabForPlanStatus(status);
  if (tab === "closed") return workspaceHref("/closed", url);
  if (tab === "on-hold") return workspaceHref("/on-hold", url);
  return workspaceHref("/", url);
}
function holdMetadata(plan) {
  const metadata = [];
  if (plan.heldFromStatus) metadata.push(`held from ${plan.heldFromStatus}`);
  if (plan.heldAt) metadata.push(`held at ${plan.heldAt}`);
  if (plan.holdReason) metadata.push(`reason: ${plan.holdReason}`);
  return metadata.length ? metadata.join("; ") : "No hold metadata provided.";
}
function isEpicDetail(plan) {
  return Boolean(plan.isEpic || plan.detailKind === "epic" || plan.type === "epic");
}
function dependencyLabel(entry) {
  return `${entry.dependency}: ${entry.state}${entry.status ? ` (${entry.status})` : ""}`;
}
const FRONT_MATTER_KEYS_IN_ORDER = [...PLAN_FRONT_MATTER_KEY_ORDER];
const FRONT_MATTER_KEY_SET = new Set(FRONT_MATTER_KEYS_IN_ORDER);
const HIDDEN_METADATA_KEYS = /* @__PURE__ */ new Set([PLAN_FRONT_MATTER_KEYS.worktreePath]);
const RESOURCE_METADATA_KEYS = Object.freeze({
  relativePath: "relativePath",
  dependencyState: "dependencyState",
  repairParent: "repairParent"
});
const METADATA_LABELS = Object.freeze({
  [PLAN_FRONT_MATTER_KEYS.planId]: "Plan ID",
  [RESOURCE_METADATA_KEYS.relativePath]: "Path",
  [PLAN_FRONT_MATTER_KEYS.origin]: "Origin",
  [PLAN_FRONT_MATTER_KEYS.type]: "Type",
  [PLAN_FRONT_MATTER_KEYS.classification]: "Classification",
  [PLAN_FRONT_MATTER_KEYS.complexity]: "Complexity",
  [PLAN_FRONT_MATTER_KEYS.summary]: "Summary",
  [PLAN_FRONT_MATTER_KEYS.affectedPaths]: "Affected paths",
  [PLAN_FRONT_MATTER_KEYS.createdAt]: "Created at",
  [PLAN_FRONT_MATTER_KEYS.updatedAt]: "Updated at",
  [PLAN_FRONT_MATTER_KEYS.parentPlan]: "Epic",
  [PLAN_FRONT_MATTER_KEYS.dependencies]: "Depends on",
  [RESOURCE_METADATA_KEYS.dependencyState]: "Dependency state",
  [RESOURCE_METADATA_KEYS.repairParent]: "Repair parent",
  [PLAN_FRONT_MATTER_KEYS.status]: "Status",
  [PLAN_FRONT_MATTER_KEYS.failureReason]: "Failure reason",
  [PLAN_FRONT_MATTER_KEYS.failedAt]: "Failed at",
  [PLAN_FRONT_MATTER_KEYS.implementedAt]: "Implemented at",
  [PLAN_FRONT_MATTER_KEYS.verifiedAt]: "Verified at",
  [PLAN_FRONT_MATTER_KEYS.executionBaselineTree]: "Execution baseline tree",
  [PLAN_FRONT_MATTER_KEYS.worktreeId]: "Worktree ID",
  [PLAN_FRONT_MATTER_KEYS.worktreeBranch]: "Worktree branch",
  [PLAN_FRONT_MATTER_KEYS.worktreeStatus]: "Worktree status",
  [PLAN_FRONT_MATTER_KEYS.humanReviewMode]: "Human review mode",
  [PLAN_FRONT_MATTER_KEYS.humanReviewDecision]: "Human review decision",
  [PLAN_FRONT_MATTER_KEYS.humanReviewedAt]: "Human reviewed at",
  [PLAN_FRONT_MATTER_KEYS.epicCompletionMode]: "Epic completion mode",
  [PLAN_FRONT_MATTER_KEYS.epicDoneEnoughAt]: "Epic done enough at",
  [PLAN_FRONT_MATTER_KEYS.epicDoneEnoughSummary]: "Epic done enough summary",
  [PLAN_FRONT_MATTER_KEYS.heldFromStatus]: "Held from status",
  [PLAN_FRONT_MATTER_KEYS.heldAt]: "Held at",
  [PLAN_FRONT_MATTER_KEYS.holdReason]: "Hold reason",
  [PLAN_FRONT_MATTER_KEYS.holdStalenessBaseline]: "Hold staleness baseline"
});
const METADATA_GROUPS = Object.freeze([
  {
    title: "Identity",
    keys: [PLAN_FRONT_MATTER_KEYS.planId, RESOURCE_METADATA_KEYS.relativePath, PLAN_FRONT_MATTER_KEYS.origin, PLAN_FRONT_MATTER_KEYS.type]
  },
  {
    title: "Planning",
    keys: [PLAN_FRONT_MATTER_KEYS.classification, PLAN_FRONT_MATTER_KEYS.complexity, PLAN_FRONT_MATTER_KEYS.summary, PLAN_FRONT_MATTER_KEYS.affectedPaths, PLAN_FRONT_MATTER_KEYS.createdAt, PLAN_FRONT_MATTER_KEYS.updatedAt]
  },
  {
    title: "Hierarchy & dependencies",
    keys: [
      PLAN_FRONT_MATTER_KEYS.parentPlan,
      PLAN_FRONT_MATTER_KEYS.dependencies,
      RESOURCE_METADATA_KEYS.dependencyState,
      RESOURCE_METADATA_KEYS.repairParent
    ]
  },
  {
    title: "Lifecycle",
    keys: [PLAN_FRONT_MATTER_KEYS.status, PLAN_FRONT_MATTER_KEYS.failureReason, PLAN_FRONT_MATTER_KEYS.failedAt, PLAN_FRONT_MATTER_KEYS.implementedAt, PLAN_FRONT_MATTER_KEYS.verifiedAt]
  },
  {
    title: "Execution worktree",
    keys: [PLAN_FRONT_MATTER_KEYS.executionBaselineTree, PLAN_FRONT_MATTER_KEYS.worktreeId, PLAN_FRONT_MATTER_KEYS.worktreeBranch, PLAN_FRONT_MATTER_KEYS.worktreeStatus]
  },
  {
    title: "Review",
    keys: [PLAN_FRONT_MATTER_KEYS.humanReviewMode, PLAN_FRONT_MATTER_KEYS.humanReviewDecision, PLAN_FRONT_MATTER_KEYS.humanReviewedAt]
  },
  {
    title: "Epic completion",
    keys: [PLAN_FRONT_MATTER_KEYS.epicCompletionMode, PLAN_FRONT_MATTER_KEYS.epicDoneEnoughAt, PLAN_FRONT_MATTER_KEYS.epicDoneEnoughSummary]
  },
  {
    title: "Hold",
    keys: [PLAN_FRONT_MATTER_KEYS.heldFromStatus, PLAN_FRONT_MATTER_KEYS.heldAt, PLAN_FRONT_MATTER_KEYS.holdReason, PLAN_FRONT_MATTER_KEYS.holdStalenessBaseline]
  }
]);
function hasMetadataValue(value) {
  return value !== void 0 && value !== "";
}
function metadataLabel(key) {
  if (METADATA_LABELS[key]) return METADATA_LABELS[key];
  return key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (char) => char.toUpperCase());
}
function planMetadata(plan) {
  const source = plan.frontMatter || plan.attrs || {};
  return {
    ...source,
    [PLAN_FRONT_MATTER_KEYS.planId]: source[PLAN_FRONT_MATTER_KEYS.planId] ?? plan.planId,
    [RESOURCE_METADATA_KEYS.relativePath]: plan.relativePath,
    [PLAN_FRONT_MATTER_KEYS.status]: source[PLAN_FRONT_MATTER_KEYS.status] ?? plan.status,
    [PLAN_FRONT_MATTER_KEYS.classification]: source[PLAN_FRONT_MATTER_KEYS.classification] ?? plan.classification,
    [PLAN_FRONT_MATTER_KEYS.complexity]: source[PLAN_FRONT_MATTER_KEYS.complexity] ?? plan.complexity,
    [PLAN_FRONT_MATTER_KEYS.summary]: source[PLAN_FRONT_MATTER_KEYS.summary] ?? plan.summary,
    [PLAN_FRONT_MATTER_KEYS.parentPlan]: source[PLAN_FRONT_MATTER_KEYS.parentPlan] ?? plan.parentPlan,
    [PLAN_FRONT_MATTER_KEYS.dependencies]: source[PLAN_FRONT_MATTER_KEYS.dependencies] ?? plan.dependsOn,
    [PLAN_FRONT_MATTER_KEYS.worktreeBranch]: source[PLAN_FRONT_MATTER_KEYS.worktreeBranch] ?? plan.worktreeBranch,
    [PLAN_FRONT_MATTER_KEYS.worktreeStatus]: source[PLAN_FRONT_MATTER_KEYS.worktreeStatus] ?? plan.worktreeStatus,
    [PLAN_FRONT_MATTER_KEYS.humanReviewMode]: source[PLAN_FRONT_MATTER_KEYS.humanReviewMode] ?? plan.humanReviewMode,
    [PLAN_FRONT_MATTER_KEYS.heldFromStatus]: source[PLAN_FRONT_MATTER_KEYS.heldFromStatus] ?? plan.heldFromStatus,
    [PLAN_FRONT_MATTER_KEYS.heldAt]: source[PLAN_FRONT_MATTER_KEYS.heldAt] ?? plan.heldAt,
    [PLAN_FRONT_MATTER_KEYS.holdReason]: source[PLAN_FRONT_MATTER_KEYS.holdReason] ?? plan.holdReason,
    [PLAN_FRONT_MATTER_KEYS.failureReason]: source[PLAN_FRONT_MATTER_KEYS.failureReason] ?? plan.failureReason,
    [PLAN_FRONT_MATTER_KEYS.failedAt]: source[PLAN_FRONT_MATTER_KEYS.failedAt] ?? plan.failedAt,
    [PLAN_FRONT_MATTER_KEYS.epicCompletionMode]: source[PLAN_FRONT_MATTER_KEYS.epicCompletionMode] ?? plan.epicCompletionMode,
    [PLAN_FRONT_MATTER_KEYS.epicDoneEnoughSummary]: source[PLAN_FRONT_MATTER_KEYS.epicDoneEnoughSummary] ?? plan.epicDoneEnoughSummary,
    [PLAN_FRONT_MATTER_KEYS.epicDoneEnoughAt]: source[PLAN_FRONT_MATTER_KEYS.epicDoneEnoughAt] ?? plan.epicDoneEnoughAt,
    [RESOURCE_METADATA_KEYS.dependencyState]: plan.dependencyStates?.length ? plan.dependencyStates.map(
      /** @param {any} entry */
      (entry) => `${entry.dependency}: ${entry.state}${entry.status ? ` (${entry.status})` : ""}`
    ) : void 0,
    [RESOURCE_METADATA_KEYS.repairParent]: plan.hierarchyRole === "orphan-child" ? plan.orphanReason || `parentPlan ${plan.parentPlan} does not resolve to a loaded Epic.` : void 0
  };
}
function stringifyMetadataValue(value) {
  if (Array.isArray(value)) return value.length ? value.map(stringifyMetadataValue).join(", ") : "[]";
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value);
}
function metadataValue(key, value) {
  if (key === PLAN_FRONT_MATTER_KEYS.complexity && hasMetadataValue(value)) {
    return /* @__PURE__ */ jsx(ComplexityLabel, { complexity: String(value) });
  }
  return stringifyMetadataValue(value);
}
function metadataEntries(metadata, keys, renderedKeys) {
  const entries = [];
  for (const key of keys) {
    renderedKeys.add(key);
    if (HIDDEN_METADATA_KEYS.has(key)) continue;
    const value = metadata[key];
    if (!hasMetadataValue(value)) continue;
    entries.push({ key, label: metadataLabel(key), value });
  }
  return entries;
}
function additionalMetadataEntries(metadata, renderedKeys) {
  return Object.entries(metadata).filter(([key, value]) => !renderedKeys.has(key) && !HIDDEN_METADATA_KEYS.has(key) && hasMetadataValue(value)).sort(([a], [b]) => {
    const aKnown = FRONT_MATTER_KEY_SET.has(a);
    const bKnown = FRONT_MATTER_KEY_SET.has(b);
    if (aKnown && bKnown) return FRONT_MATTER_KEYS_IN_ORDER.indexOf(a) - FRONT_MATTER_KEYS_IN_ORDER.indexOf(b);
    if (aKnown) return -1;
    if (bKnown) return 1;
    return a.localeCompare(b);
  }).map(([key, value]) => ({ key, label: metadataLabel(key), value }));
}
function MetadataGroup({ title, entries }) {
  if (!entries.length) return null;
  return /* @__PURE__ */ jsxs("section", { className: "metadata-group", "aria-label": `${title} metadata`, children: [
    /* @__PURE__ */ jsx("h4", { className: "metadata-group-title", children: title }),
    /* @__PURE__ */ jsx("dl", { className: "meta-list stacked", children: entries.map((entry) => /* @__PURE__ */ jsxs("div", { children: [
      /* @__PURE__ */ jsx("dt", { children: entry.label }),
      /* @__PURE__ */ jsx("dd", { children: metadataValue(entry.key, entry.value) })
    ] }, entry.key)) })
  ] });
}
function DetailMetadata({ plan }) {
  const metadata = planMetadata(plan);
  const renderedKeys = /* @__PURE__ */ new Set();
  const groups = METADATA_GROUPS.map((group) => ({
    title: group.title,
    entries: metadataEntries(metadata, group.keys, renderedKeys)
  })).filter((group) => group.entries.length);
  const additionalEntries = additionalMetadataEntries(metadata, renderedKeys);
  return /* @__PURE__ */ jsxs("div", { className: "metadata-section", children: [
    groups.map((group) => /* @__PURE__ */ jsx(MetadataGroup, { title: group.title, entries: group.entries }, group.title)),
    /* @__PURE__ */ jsx(MetadataGroup, { title: "Additional metadata", entries: additionalEntries })
  ] });
}
function EpicSummary({ epic }) {
  const progress = epic.childProgress || { verified: 0, total: 0, active: 0, remaining: 0 };
  const health = epic.childHealth || {};
  const failed = health.failed?.length || 0;
  const held = health.held?.length || 0;
  const blocked = health.blocked?.length || 0;
  const missing = health.missingDependencies?.length || 0;
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsxs("div", { className: "progress-meter large", "aria-label": "Epic child progress", children: [
      /* @__PURE__ */ jsxs("span", { children: [
        progress.verified,
        "/",
        progress.total,
        " child Plans verified"
      ] }),
      /* @__PURE__ */ jsxs("span", { children: [
        progress.active,
        " active or implemented"
      ] }),
      /* @__PURE__ */ jsxs("span", { children: [
        progress.remaining,
        " remaining"
      ] }),
      failed ? /* @__PURE__ */ jsxs("span", { children: [
        failed,
        " failed"
      ] }) : null,
      held ? /* @__PURE__ */ jsxs("span", { children: [
        held,
        " on hold"
      ] }) : null,
      blocked ? /* @__PURE__ */ jsxs("span", { children: [
        blocked,
        " blocked by dependencies"
      ] }) : null,
      missing ? /* @__PURE__ */ jsxs("span", { children: [
        missing,
        " with missing dependencies"
      ] }) : null
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "badge-row health-summary", children: [
      epic.doneEnough ? /* @__PURE__ */ jsxs("span", { className: "badge success", children: [
        "Epic marked done enough",
        epic.epicDoneEnoughAt ? ` at ${epic.epicDoneEnoughAt}` : ""
      ] }) : null,
      epic.status === "on_hold" ? /* @__PURE__ */ jsxs("span", { className: "badge muted", children: [
        "Epic on hold",
        epic.heldFromStatus ? ` from ${epic.heldFromStatus}` : "",
        epic.heldAt ? ` at ${epic.heldAt}` : ""
      ] }) : null,
      failed ? /* @__PURE__ */ jsxs("span", { className: "badge danger", children: [
        failed,
        " failed child Plans"
      ] }) : null,
      held ? /* @__PURE__ */ jsxs("span", { className: "badge muted", children: [
        held,
        " child Plans on hold"
      ] }) : null,
      blocked ? /* @__PURE__ */ jsxs("span", { className: "badge warning", children: [
        blocked,
        " child Plans blocked"
      ] }) : null,
      missing ? /* @__PURE__ */ jsxs("span", { className: "badge warning", children: [
        missing,
        " child Plans with missing dependencies"
      ] }) : null
    ] }),
    epic.doneEnough && epic.epicDoneEnoughSummary ? /* @__PURE__ */ jsxs("p", { className: "notice success", children: [
      "Done enough: ",
      epic.epicDoneEnoughSummary
    ] }) : null,
    epic.status === "on_hold" ? /* @__PURE__ */ jsxs("p", { className: "notice muted", children: [
      "Held Epic only blocks child work in UI context; child statuses are shown unchanged.",
      " ",
      holdMetadata(epic)
    ] }) : null
  ] });
}
function EpicDetailSections({ epic, url }) {
  const health = epic.childHealth || {};
  const failed = health.failed?.length || 0;
  const held = health.held?.length || 0;
  const blocked = health.blocked?.length || 0;
  const missing = health.missingDependencies?.length || 0;
  const visibleColumns = (epic.childColumns || []).filter(
    (column) => column.cards.length || column.orphanChildren.length
  );
  const childrenWithDependencies = (epic.children || []).filter(
    (child) => child.dependencyStates?.length
  );
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsxs("section", { className: "child-plan-section", children: [
      /* @__PURE__ */ jsx("h3", { children: "Child health" }),
      failed || held || blocked || missing ? /* @__PURE__ */ jsxs("ul", { className: "health-list", children: [
        (health.failed || []).map(
          /** @param {any} child */
          (child) => /* @__PURE__ */ jsxs("li", { children: [
            /* @__PURE__ */ jsx("strong", { children: "Failed:" }),
            " ",
            child.planName,
            " ",
            child.failureReason || "needs recovery attention"
          ] }, `failed-${child.planId}`)
        ),
        (health.held || []).map(
          /** @param {any} child */
          (child) => /* @__PURE__ */ jsxs("li", { children: [
            /* @__PURE__ */ jsx("strong", { children: "Held:" }),
            " ",
            child.planName,
            " ",
            holdMetadata(child)
          ] }, `held-${child.planId}`)
        ),
        (health.blocked || []).map(
          /** @param {any} child */
          (child) => /* @__PURE__ */ jsxs("li", { children: [
            /* @__PURE__ */ jsx("strong", { children: "Blocked:" }),
            " ",
            child.planName,
            " has",
            " ",
            child.unverifiedDependencyCount || 0,
            " unverified and",
            " ",
            child.missingDependencyCount || 0,
            " missing dependencies.",
            child.dependencyStates?.length ? /* @__PURE__ */ jsx("ul", { children: child.dependencyStates.map(
              /** @param {any} entry */
              (entry) => /* @__PURE__ */ jsx("li", { children: dependencyLabel(entry) }, `${child.planId}-${entry.dependency}`)
            ) }) : null
          ] }, `blocked-${child.planId}`)
        )
      ] }) : /* @__PURE__ */ jsx("p", { className: "empty", children: "No failed, held, or dependency-blocked children." })
    ] }),
    /* @__PURE__ */ jsxs("section", { className: "child-plan-section", children: [
      /* @__PURE__ */ jsx("h3", { children: "Child dependencies" }),
      childrenWithDependencies.length ? /* @__PURE__ */ jsx("ul", { className: "health-list dependency-health-list", children: childrenWithDependencies.map(
        /** @param {any} child */
        (child) => /* @__PURE__ */ jsxs("li", { children: [
          /* @__PURE__ */ jsxs("strong", { children: [
            child.planName,
            ":"
          ] }),
          " ",
          child.dependencyStates.map(dependencyLabel).join(
            ", "
          )
        ] }, `dependencies-${child.planId}`)
      ) }) : /* @__PURE__ */ jsx("p", { className: "empty", children: "No child FEATURE Plan dependencies declared." })
    ] }),
    /* @__PURE__ */ jsxs("section", { className: "child-plan-section", children: [
      /* @__PURE__ */ jsx("h3", { children: "Child FEATURE Plans" }),
      visibleColumns.length ? /* @__PURE__ */ jsx("div", { className: "status-board child-status-board", children: visibleColumns.map(
        /** @param {any} column */
        (column) => /* @__PURE__ */ jsx(BoardColumn, { column, url }, column.status)
      ) }) : /* @__PURE__ */ jsx("p", { className: "empty", children: "No child FEATURE Plans are attached to this Epic." })
    ] })
  ] });
}
function StaticPlanBody({ plan }) {
  const body = plan.body || "";
  const planBodyJson = JSON.stringify({ body }).replace(/</g, "\\u003c");
  return /* @__PURE__ */ jsx("section", { className: "plan-body-editor", "data-editor-mode": "read", children: /* @__PURE__ */ jsxs("div", { "data-plannotator-plan-body": true, "data-plan-id": plan.planId, "data-plannotator-renderer": "ssr-fallback", children: [
    /* @__PURE__ */ jsx(
      "script",
      {
        type: "application/json",
        "data-plannotator-plan-body-json": true,
        dangerouslySetInnerHTML: { __html: planBodyJson }
      }
    ),
    /* @__PURE__ */ jsx("div", { "data-plannotator-plan-body-root": true, children: /* @__PURE__ */ jsx(MarkdownView, { markdown: body }) })
  ] }) });
}
function StaticLifecycleActions({ plan }) {
  const actions = plan.actions || {};
  return /* @__PURE__ */ jsx("section", { className: "lifecycle-actions compact", "aria-label": "Lifecycle actions", children: /* @__PURE__ */ jsxs("div", { className: "lifecycle-action-list", children: [
    (actions.manualTargetOptions || []).map((option) => /* @__PURE__ */ jsxs(
      "button",
      {
        type: "button",
        className: "secondary-action lifecycle-action",
        "data-action-target-status": option.status,
        children: [
          "Move to ",
          option.label
        ]
      },
      option.status
    )),
    actions.canPutOnHold ? /* @__PURE__ */ jsx("button", { type: "button", className: "secondary-action lifecycle-action hold-action", children: "Put on hold" }) : null,
    actions.canCloseWithoutVerification ? /* @__PURE__ */ jsx("button", { type: "button", className: "danger-action lifecycle-action", children: "Close without verification" }) : null
  ] }) });
}
function PlanDetail({ plan, url, editIntent = false, staticRender = false }) {
  const isEpic = isEpicDetail(plan);
  const canEditBody = plan.capabilities?.bodyEditing !== false && !isEpic;
  const editHref = workspaceHref(`/plans/${encodeURIComponent(plan.planId)}?edit=body`, url);
  const closeHref = boardHrefForPlanStatus(plan.status, url);
  return /* @__PURE__ */ jsxs("article", { className: "detail", "data-plan-id": plan.planId, "data-selected-tab": tabForPlanStatus(plan.status), children: [
    /* @__PURE__ */ jsx("header", { className: "page-header detail-header split-header", children: /* @__PURE__ */ jsxs("div", { children: [
      /* @__PURE__ */ jsxs("div", { className: "detail-title-row", children: [
        /* @__PURE__ */ jsx("a", { className: "detail-back-link", href: closeHref, children: "< Back" }),
        /* @__PURE__ */ jsxs("div", { className: "detail-title-group", children: [
          /* @__PURE__ */ jsx("h2", { children: plan.planName }),
          /* @__PURE__ */ jsx("span", { className: `status status-${plan.status}`, children: plan.status })
        ] }),
        /* @__PURE__ */ jsx("a", { className: "detail-close-link", href: closeHref, "aria-label": "Close plan detail", children: "X" })
      ] }),
      /* @__PURE__ */ jsx("p", { children: plan.summary || "No summary provided." }),
      isEpic ? /* @__PURE__ */ jsx(EpicSummary, { epic: plan }) : null,
      !isEpic && plan.status === "on_hold" ? /* @__PURE__ */ jsx("p", { className: "notice muted", children: holdMetadata(plan) }) : null,
      plan.hierarchyRole === "orphan-child" || plan.blockedByDependencies ? /* @__PURE__ */ jsxs("div", { className: "detail-actions", "aria-label": "Plan warnings", children: [
        plan.hierarchyRole === "orphan-child" ? /* @__PURE__ */ jsx("span", { className: "badge warning", children: "Missing parent Epic" }) : null,
        plan.blockedByDependencies ? /* @__PURE__ */ jsx("span", { className: "badge warning", children: "Dependency blocked" }) : null
      ] }) : null
    ] }) }),
    /* @__PURE__ */ jsxs("section", { className: "detail-grid", children: [
      /* @__PURE__ */ jsxs("div", { children: [
        staticRender ? /* @__PURE__ */ jsx(StaticPlanBody, { plan }) : /* @__PURE__ */ jsx(PlanBodyEditor, { plan, initialEdit: canEditBody && editIntent }),
        isEpic ? /* @__PURE__ */ jsx(EpicDetailSections, { epic: plan, url }) : null
      ] }),
      /* @__PURE__ */ jsxs("aside", { className: "detail-sidebar", children: [
        /* @__PURE__ */ jsxs("div", { className: "detail-sidebar-actions", "aria-label": "Plan detail actions", children: [
          canEditBody && !editIntent ? /* @__PURE__ */ jsx("a", { className: "primary-action detail-sidebar-edit", href: editHref, children: "Edit" }) : null,
          staticRender ? /* @__PURE__ */ jsx(StaticLifecycleActions, { plan }) : /* @__PURE__ */ jsx(PlanLifecycleActions, { plan, compact: true, epic: isEpic })
        ] }),
        /* @__PURE__ */ jsx("h3", { children: "Metadata" }),
        /* @__PURE__ */ jsx(DetailMetadata, { plan })
      ] })
    ] })
  ] });
}

const $$Astro = createAstro();
const $$planId = createComponent(async ($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$Astro, $$props, $$slots);
  Astro2.self = $$planId;
  const runtime = globalThis;
  const workspaceCwd = Astro2.request.headers.get("x-runwield-workspace-cwd") || runtime.Deno?.cwd?.() || ".";
  const planId = Astro2.params.planId ?? "";
  const editIntent = Astro2.url.searchParams.get("edit") === "body";
  let plan = null;
  let error = null;
  try {
    plan = await loadCanonicalWorkspaceDetail(workspaceCwd, planId);
  } catch (caught) {
    error = await serializeCanonicalPlanError(caught);
    Astro2.response.status = error.error.includes("not found") || error.error.includes("Plan not found") ? 404 : 409;
  }
  return renderTemplate`${renderComponent($$result, "WorkspaceLayout", $$WorkspaceLayout, { "title": plan ? `${plan.planName} \xB7 RunWield Workspace` : "Plan Detail \xB7 RunWield Workspace", "selectedTab": plan ? tabForPlanStatus(plan.status) : "active", "url": Astro2.url.href }, { "default": async ($$result2) => renderTemplate`${error ? renderTemplate`${maybeRenderHead()}<section class="error-panel"> <h2>Plan lookup failed</h2> <p>${error.error}</p> <p>${error.repair}</p> </section>` : renderTemplate`${renderComponent($$result2, "PlanDetail", PlanDetail, { "plan": plan, "url": Astro2.url.href, "editIntent": editIntent, "client:load": true, "client:component-hydration": "load", "client:component-path": "/Users/gandazgul/Documents/web/harns/src/ui/workspace/components/PlanDetail.jsx", "client:component-export": "PlanDetail" })}`}` })}`;
}, "/Users/gandazgul/Documents/web/harns/src/ui/workspace/pages/plans/[planId].astro", void 0);

const $$file = "/Users/gandazgul/Documents/web/harns/src/ui/workspace/pages/plans/[planId].astro";
const $$url = "/plans/[planId]";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
    __proto__: null,
    default: $$planId,
    file: $$file,
    url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page as p, renderMarkdown as r };
