import { e as createComponent, g as addAttribute, l as renderHead, n as renderSlot, r as renderTemplate, h as createAstro } from './astro/server_CySqi4lW.mjs';
import 'clsx';
import { jsx, jsxs } from 'react/jsx-runtime';
import { useState, useRef, useMemo, useEffect } from 'react';
import Fuse from 'fuse.js';

/**
 * Workspace-specific constants.
 * These are safe for both server and client environments.
 */

/** Query parameter accepted for bootstrapping Workspace access. */
const PLAN_UI_TOKEN_QUERY = "token";

/** Header accepted by Workspace mutation API endpoints. */
const PLAN_UI_TOKEN_HEADER = "x-runwield-workspace-token";

/** @type {{ MOVE_STATUS: "move_status", CLOSE_WITHOUT_VERIFICATION: "close_without_verification", PUT_ON_HOLD: "put_on_hold", RESUME_FROM_HOLD: "resume_from_hold", RESET_TO_DRAFT: "reset_to_draft" }} */
const PLAN_LIFECYCLE_ACTIONS = {
    MOVE_STATUS: "move_status",
    CLOSE_WITHOUT_VERIFICATION: "close_without_verification",
    PUT_ON_HOLD: "put_on_hold",
    RESUME_FROM_HOLD: "resume_from_hold",
    RESET_TO_DRAFT: "reset_to_draft",
};

/**
 * @param {string} planId
 * @returns {string}
 */
function lifecycleActionApiPath(planId) {
    return `/api/plans/${encodeURIComponent(planId)}/lifecycle-action`;
}

const PLAN_SEARCH_QUERY_PARAM = "q";
const PLAN_SEARCH_OPTIONS = Object.freeze({
  keys: [
    { name: "title", weight: 0.45 },
    { name: "planName", weight: 0.4 },
    { name: "summary", weight: 0.15 }
  ],
  threshold: 0.36,
  ignoreLocation: true,
  includeScore: true
});
function normalizePlanSearchQuery(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}
function matchingPlanIds(searchIndex, query) {
  const normalizedQuery = normalizePlanSearchQuery(query);
  if (!normalizedQuery) return new Set(searchIndex.map((entry) => entry.planId));
  const fuse = new Fuse(searchIndex, PLAN_SEARCH_OPTIONS);
  return new Set(fuse.search(normalizedQuery).map((result) => result.item.planId));
}
function replaceQueryInUrl(query) {
  const url = new URL(globalThis.location.href);
  if (query) url.searchParams.set(PLAN_SEARCH_QUERY_PARAM, query);
  else url.searchParams.delete(PLAN_SEARCH_QUERY_PARAM);
  globalThis.history.replaceState(globalThis.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}
function syncQueryInWorkspaceLinks(query) {
  for (const link of document.querySelectorAll("a[href]")) {
    const anchor = (
      /** @type {HTMLAnchorElement} */
      link
    );
    const href = anchor.getAttribute("href") || "";
    if (!href || href.startsWith("#")) continue;
    const url = new URL(href, globalThis.location.href);
    if (url.origin !== globalThis.location.origin) continue;
    if (query) url.searchParams.set(PLAN_SEARCH_QUERY_PARAM, query);
    else url.searchParams.delete(PLAN_SEARCH_QUERY_PARAM);
    anchor.setAttribute("href", `${url.pathname}${url.search}${url.hash}`);
  }
}
function applyPlanSearchDomState(scope, visiblePlanIds, hasQuery) {
  const cards = [...scope.querySelectorAll("[data-plan-search-card]")];
  let visibleCount = 0;
  for (const card of cards) {
    const planId = (
      /** @type {HTMLElement} */
      card.dataset.planSearchCard || ""
    );
    const visible = !hasQuery || visiblePlanIds.has(planId);
    card.hidden = !visible;
    if (visible) visibleCount += 1;
  }
  for (const column of scope.querySelectorAll("[data-plan-search-column]")) {
    const columnElement = (
      /** @type {HTMLElement} */
      column
    );
    const columnCards = [...columnElement.querySelectorAll("[data-plan-search-card]")];
    const columnVisibleCount = columnCards.filter((card) => !/** @type {HTMLElement} */
    card.hidden).length;
    const count = columnElement.querySelector("[data-column-count]");
    if (count) {
      count.textContent = hasQuery ? String(columnVisibleCount) : columnElement.dataset.columnOriginalCount || String(columnVisibleCount);
    }
    const filteredEmpty = columnElement.querySelector("[data-filtered-empty]");
    if (filteredEmpty) filteredEmpty.hidden = !hasQuery || columnVisibleCount > 0;
    const originalEmpty = columnElement.querySelector("[data-original-empty]");
    if (originalEmpty) originalEmpty.hidden = hasQuery;
  }
  for (const repairLane of scope.querySelectorAll("[data-plan-search-repair]")) {
    const laneElement = (
      /** @type {HTMLElement} */
      repairLane
    );
    const laneCards = [...laneElement.querySelectorAll("[data-plan-search-card]")];
    const laneVisibleCount = laneCards.filter((card) => !/** @type {HTMLElement} */
    card.hidden).length;
    const filteredEmpty = laneElement.querySelector("[data-filtered-empty]");
    if (filteredEmpty) filteredEmpty.hidden = !hasQuery || laneVisibleCount > 0;
  }
  const noResults = scope.querySelector("[data-plan-search-no-results]");
  if (noResults) noResults.hidden = !hasQuery || visibleCount > 0;
}
function PlanBoardSearch({ boardId, searchIndex, initialQuery = "" }) {
  const [query, setQuery] = useState(normalizePlanSearchQuery(initialQuery));
  const searchElementRef = useRef(
    /** @type {HTMLDivElement | null} */
    null
  );
  const resultIds = useMemo(() => matchingPlanIds(searchIndex, query), [searchIndex, query]);
  useEffect(() => {
    const searchElement = searchElementRef.current;
    const searchSlot = document.querySelector("[data-plan-search-slot]");
    const originalParent = searchElement?.parentElement || null;
    const nextSibling = searchElement?.nextSibling || null;
    if (!searchElement || !searchSlot) return void 0;
    searchSlot.appendChild(searchElement);
    return () => {
      if (!originalParent) return;
      originalParent.insertBefore(searchElement, nextSibling);
    };
  }, []);
  useEffect(() => {
    const scope = document.querySelector(`[data-plan-search-scope="${boardId}"]`);
    if (!scope) return;
    const normalizedQuery = normalizePlanSearchQuery(query);
    applyPlanSearchDomState(scope, resultIds, Boolean(normalizedQuery));
    replaceQueryInUrl(normalizedQuery);
    syncQueryInWorkspaceLinks(normalizedQuery);
  }, [boardId, query, resultIds]);
  function handleInput(event) {
    setQuery(event.currentTarget.value);
  }
  function handleClear() {
    setQuery("");
  }
  const hasQuery = Boolean(normalizePlanSearchQuery(query));
  return /* @__PURE__ */ jsx("div", { ref: searchElementRef, className: "plan-search", role: "search", "aria-label": "Filter board Plans", children: /* @__PURE__ */ jsx("div", { className: "plan-search-field", children: /* @__PURE__ */ jsxs("div", { className: "plan-search-input-row", children: [
    /* @__PURE__ */ jsx(
      "input",
      {
        id: `${boardId}-plan-search`,
        type: "search",
        value: query,
        placeholder: "Filter by title, name, or summary",
        autoComplete: "off",
        "aria-label": "Search Plans",
        onInput: handleInput
      }
    ),
    hasQuery ? /* @__PURE__ */ jsx("button", { type: "button", className: "plan-search-clear", onClick: handleClear, children: "Clear" }) : null
  ] }) }) });
}

const $$Astro = createAstro();
const $$WorkspaceLayout = createComponent(($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$Astro, $$props, $$slots);
  Astro2.self = $$WorkspaceLayout;
  const { title = "RunWield Workspace", selectedTab = "active", url = Astro2.url.href } = Astro2.props;
  const currentUrl = url instanceof URL ? url : new URL(String(url));
  function linkWithToken(path) {
    const token = currentUrl.searchParams.get(PLAN_UI_TOKEN_QUERY) || "";
    const query = currentUrl.searchParams.get(PLAN_SEARCH_QUERY_PARAM) || "";
    const next = new URL(path, currentUrl);
    if (token) next.searchParams.set(PLAN_UI_TOKEN_QUERY, token);
    if (query) next.searchParams.set(PLAN_SEARCH_QUERY_PARAM, query);
    return `${next.pathname}${next.search}`;
  }
  return renderTemplate`<html lang="en"> <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="generator"${addAttribute(Astro2.generator, "content")}><title>${title}</title><link rel="icon" href="/logo.svg" type="image/svg+xml"><link rel="stylesheet" href="/tokens.css"><link rel="stylesheet" href="/components.css"><link rel="stylesheet" href="/workspace.css"><link rel="stylesheet" href="/theme.css">${renderHead()}</head> <body> <div class="workspace-shell"${addAttribute(selectedTab, "data-selected-tab")} data-astro-workspace-shell> <header class="topbar"> <a class="brand"${addAttribute(linkWithToken("/"), "href")} aria-label="RunWield Planning Workspace home"> <img class="brand-logo" src="/logo.svg" alt="" aria-hidden="true"> <span>RunWield Planning Workspace</span> </a> </header> <nav class="tabs" aria-label="Workspace views"> <a${addAttribute(selectedTab === "active" ? "active" : "", "class")} data-tab="active"${addAttribute(linkWithToken("/"), "href")}>
Plan Board
</a> <a${addAttribute(selectedTab === "closed" ? "active" : "", "class")} data-tab="closed"${addAttribute(linkWithToken("/closed"), "href")}>
Closed
</a> <a${addAttribute(selectedTab === "on-hold" ? "active" : "", "class")} data-tab="on-hold"${addAttribute(linkWithToken("/on-hold"), "href")}>
On Hold
</a> <div class="tab-search-slot" data-plan-search-slot></div> </nav> <main> ${renderSlot($$result, $$slots["default"])} </main> </div> </body></html>`;
}, "/Users/gandazgul/Documents/web/harns/src/ui/workspace/layouts/WorkspaceLayout.astro", void 0);

function createMoveStatusIntent({ planId, fromStatus, toStatus }) {
  return { planId, fromStatus, action: PLAN_LIFECYCLE_ACTIONS.MOVE_STATUS, targetStatus: toStatus };
}
function createPutOnHoldIntent({ planId, fromStatus, holdReason }) {
  if (holdReason === null) return null;
  return { planId, fromStatus, action: PLAN_LIFECYCLE_ACTIONS.PUT_ON_HOLD, holdReason };
}
function lifecycleActionLabel(actions, action) {
  return String(actions.metadata?.[action]?.label || action.replaceAll("_", " "));
}
async function dispatchPlanLifecycleAction(intent) {
  const url = new URL(location.href);
  const token = url.searchParams.get(PLAN_UI_TOKEN_QUERY) || "";
  const response = await fetch(lifecycleActionApiPath(intent.planId), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...token ? { [PLAN_UI_TOKEN_HEADER]: token } : {}
    },
    body: JSON.stringify(intent)
  });
  const payload = await response.json();
  return { response, payload };
}
function PlanLifecycleActions({
  plan,
  compact = false,
  epic = false,
  showStatusMoves = true,
  showPutOnHold = true,
  putOnHoldOnly = false
}) {
  const actions = plan.actions || {};
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [warningIntent, setWarningIntent] = useState(
    /** @type {PlanLifecycleActionIntent | null} */
    null
  );
  const disabled = pending;
  async function submit(intent) {
    setPending(true);
    setMessage("");
    try {
      const { response, payload } = await dispatchPlanLifecycleAction(intent);
      if (response.status === 409 && payload.requiresConfirmation) {
        setWarningIntent({ ...intent, acceptResumeWarnings: true });
        setMessage(
          `${payload.error || "Resume Check needs confirmation."} ${(payload.resumeCheck?.warnings || []).join(" ")}`
        );
        return;
      }
      if (!response.ok) {
        setMessage(payload.blockedReason || payload.error || "Lifecycle action was blocked.");
        return;
      }
      setMessage(payload.message || "Lifecycle action applied.");
      location.reload();
    } finally {
      setPending(false);
    }
  }
  function hold() {
    const promptText = epic ? "Optional hold reason for this Epic. Child Plan statuses will not be changed." : "Optional hold reason for this Plan.";
    const intent = createPutOnHoldIntent({
      planId: plan.planId,
      fromStatus: plan.status,
      holdReason: prompt(promptText, plan.holdReason || "")
    });
    if (intent) submit(intent);
  }
  const putOnHoldLabel = lifecycleActionLabel(actions, PLAN_LIFECYCLE_ACTIONS.PUT_ON_HOLD);
  const closeWithoutVerificationLabel = lifecycleActionLabel(
    actions,
    PLAN_LIFECYCLE_ACTIONS.CLOSE_WITHOUT_VERIFICATION
  );
  const resumeFromHoldLabel = lifecycleActionLabel(actions, PLAN_LIFECYCLE_ACTIONS.RESUME_FROM_HOLD);
  const resetToDraftLabel = lifecycleActionLabel(actions, PLAN_LIFECYCLE_ACTIONS.RESET_TO_DRAFT);
  const canShowPutOnHold = showPutOnHold && actions.canPutOnHold;
  const canShowCloseWithoutVerification = !putOnHoldOnly && actions.canCloseWithoutVerification;
  const canShowResumeFromHold = !putOnHoldOnly && actions.canResumeFromHold;
  const canShowResetToDraft = !putOnHoldOnly && actions.canResetToDraft;
  const hasStatusMoveControls = !putOnHoldOnly && showStatusMoves && actions.manualTargetOptions?.length;
  const hasPrimaryControls = hasStatusMoveControls || canShowCloseWithoutVerification || canShowPutOnHold || canShowResumeFromHold || canShowResetToDraft;
  if (putOnHoldOnly && !canShowPutOnHold) return null;
  return /* @__PURE__ */ jsxs(
    "section",
    {
      className: `${compact ? "lifecycle-actions compact" : "lifecycle-actions"}${putOnHoldOnly ? " hold-action-only" : ""}`,
      "data-plan-id": plan.planId,
      children: [
        actions.terminalMessage ? /* @__PURE__ */ jsx("p", { className: "terminal-message", children: actions.terminalMessage }) : null,
        plan.status === "on_hold" ? /* @__PURE__ */ jsx("p", { className: "hold-message", children: actions.holdMessage }) : null,
        hasPrimaryControls ? /* @__PURE__ */ jsxs("div", { className: "lifecycle-action-list", "aria-label": "Plan lifecycle actions", children: [
          showStatusMoves ? actions.manualTargetOptions?.map(
            /** @param {any} target */
            (target) => /* @__PURE__ */ jsxs(
              "button",
              {
                type: "button",
                className: "secondary-action lifecycle-action",
                disabled,
                "data-action": "move_status",
                "data-action-target-status": target.status,
                onClick: () => submit(createMoveStatusIntent({
                  planId: plan.planId,
                  fromStatus: plan.status,
                  toStatus: target.status
                })),
                children: [
                  "Move to ",
                  target.label
                ]
              },
              target.status
            )
          ) : null,
          canShowPutOnHold ? /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              className: "secondary-action lifecycle-action hold-action",
              disabled,
              onClick: hold,
              children: putOnHoldLabel
            }
          ) : null,
          canShowCloseWithoutVerification ? /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              className: "danger-action lifecycle-action",
              disabled,
              onClick: () => confirm(`${closeWithoutVerificationLabel}?`) && submit({
                planId: plan.planId,
                action: PLAN_LIFECYCLE_ACTIONS.CLOSE_WITHOUT_VERIFICATION,
                fromStatus: plan.status
              }),
              children: closeWithoutVerificationLabel
            }
          ) : null,
          canShowResumeFromHold ? /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              disabled,
              className: "primary-action",
              onClick: () => submit({
                planId: plan.planId,
                action: PLAN_LIFECYCLE_ACTIONS.RESUME_FROM_HOLD,
                fromStatus: plan.status
              }),
              children: resumeFromHoldLabel
            }
          ) : null,
          canShowResetToDraft ? /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              className: "secondary-action lifecycle-action",
              disabled,
              onClick: () => confirm(`${resetToDraftLabel}?`) && submit({
                planId: plan.planId,
                action: PLAN_LIFECYCLE_ACTIONS.RESET_TO_DRAFT,
                fromStatus: plan.status
              }),
              children: resetToDraftLabel
            }
          ) : null
        ] }) : null,
        warningIntent ? /* @__PURE__ */ jsx("div", { className: "notice warning resume-warning", children: /* @__PURE__ */ jsxs("button", { type: "button", disabled, onClick: () => submit(warningIntent), children: [
          "Accept Resume Check warnings and ",
          resumeFromHoldLabel
        ] }) }) : null,
        message ? /* @__PURE__ */ jsx("p", { className: "notice lifecycle-message", children: message }) : null,
        pending ? /* @__PURE__ */ jsx("p", { className: "notice muted", children: "Applying lifecycle action…" }) : null
      ]
    }
  );
}

function workspaceUrl(url) {
  return url instanceof URL ? url : new URL(String(url));
}
function workspaceHref(path, url) {
  const currentUrl = workspaceUrl(url);
  const next = new URL(path, currentUrl);
  const token = currentUrl.searchParams.get(PLAN_UI_TOKEN_QUERY) || "";
  const query = currentUrl.searchParams.get(PLAN_SEARCH_QUERY_PARAM) || "";
  if (token) next.searchParams.set(PLAN_UI_TOKEN_QUERY, token);
  if (query) next.searchParams.set(PLAN_SEARCH_QUERY_PARAM, query);
  return `${next.pathname}${next.search}`;
}
function detailHref(plan, url) {
  return workspaceHref(`/plans/${encodeURIComponent(plan.planId)}`, url);
}
function holdMetadata$1(plan) {
  const metadata = [];
  if (plan.heldFromStatus) metadata.push(`held from ${plan.heldFromStatus}`);
  if (plan.heldAt) metadata.push(`held at ${plan.heldAt}`);
  if (plan.holdReason) metadata.push(`reason: ${plan.holdReason}`);
  return metadata.length ? metadata.join("; ") : "No hold metadata provided.";
}
const COMPLEXITY_CLASS_BY_VALUE = {
  LOW: "complexity-low",
  MEDIUM: "complexity-medium",
  HIGH: "complexity-high"
};
function complexityClassName(complexity) {
  const key = String(complexity || "").toUpperCase();
  return `complexity-label ${COMPLEXITY_CLASS_BY_VALUE[key] || "complexity-unknown"}`;
}
function ComplexityLabel({ complexity }) {
  return /* @__PURE__ */ jsx("span", { className: complexityClassName(complexity), children: complexity });
}
function PlanCard({ plan, url, compact = false, roleLabel = "Plan", draggableCard = false }) {
  const isChildCard = plan.hierarchyRole === "child" || plan.hierarchyRole === "orphan-child";
  const href = detailHref(plan, url);
  const allowedTargetStatuses = (plan.actions?.dnd?.allowedTargetStatuses || plan.actions?.allowedManualTargetStatuses || []).join(" ");
  const canDrag = draggableCard && Boolean(allowedTargetStatuses);
  return /* @__PURE__ */ jsxs(
    "article",
    {
      className: compact ? "plan-card compact clickable-card" : "plan-card clickable-card",
      "data-draggable-plan-card": canDrag ? "true" : void 0,
      draggable: canDrag,
      "data-plan-id": plan.planId,
      "data-plan-search-card": plan.planId,
      "data-plan-name": plan.planName,
      "data-status": plan.status,
      "data-allowed-target-statuses": canDrag ? allowedTargetStatuses : void 0,
      "aria-describedby": canDrag ? `drag-help-${plan.planId}` : void 0,
      children: [
        /* @__PURE__ */ jsx("a", { className: "card-hit-area", href, "aria-label": `Open ${plan.planName} details` }),
        /* @__PURE__ */ jsxs("div", { className: "card-header", children: [
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsxs("p", { className: "card-kicker", children: [
              /* @__PURE__ */ jsx("span", { children: roleLabel }),
              plan.complexity ? /* @__PURE__ */ jsx(ComplexityLabel, { complexity: plan.complexity }) : null
            ] }),
            /* @__PURE__ */ jsx("span", { className: "card-title", children: plan.planName })
          ] }),
          canDrag ? /* @__PURE__ */ jsx("span", { className: "drag-grip", "aria-hidden": "true", title: "Drag to move status", children: "⋮⋮" }) : null
        ] }),
        canDrag ? /* @__PURE__ */ jsxs("span", { id: `drag-help-${plan.planId}`, className: "sr-only", children: [
          "Drag this Plan Card to an allowed status column: ",
          allowedTargetStatuses.replaceAll(" ", ", "),
          "."
        ] }) : null,
        /* @__PURE__ */ jsx("p", { children: plan.summary || "No summary provided." }),
        plan.status === "on_hold" ? /* @__PURE__ */ jsx("p", { className: "hold-summary", children: holdMetadata$1(plan) }) : null,
        /* @__PURE__ */ jsxs("div", { className: "badge-row", children: [
          plan.blockedByDependencies ? /* @__PURE__ */ jsx("span", { className: "badge warning", children: "Blocked by dependency" }) : null,
          plan.unverifiedDependencyCount ? /* @__PURE__ */ jsxs("span", { className: "badge warning", children: [
            plan.unverifiedDependencyCount,
            " unverified dependency"
          ] }) : null,
          plan.missingDependencyCount ? /* @__PURE__ */ jsxs("span", { className: "badge danger", children: [
            plan.missingDependencyCount,
            " missing dependency"
          ] }) : null,
          plan.hierarchyRole === "orphan-child" ? /* @__PURE__ */ jsx("span", { className: "badge warning", children: "Missing parent Epic" }) : null,
          isChildCard && plan.status === "on_hold" ? /* @__PURE__ */ jsx("span", { className: "badge muted", children: "Child on hold" }) : null,
          isChildCard && plan.status === "failed" ? /* @__PURE__ */ jsx("span", { className: "badge danger", children: "Failed child" }) : null
        ] })
      ]
    }
  );
}

function holdMetadata(plan) {
  const metadata = [];
  if (plan.heldFromStatus) metadata.push(`held from ${plan.heldFromStatus}`);
  if (plan.heldAt) metadata.push(`held at ${plan.heldAt}`);
  if (plan.holdReason) metadata.push(`reason: ${plan.holdReason}`);
  return metadata.length ? metadata.join("; ") : "No hold metadata provided.";
}
function EpicCard({ epic, url, draggableCard = false }) {
  const progress = epic.childProgress || { verified: 0, total: 0, active: 0, remaining: 0, failed: 0, byStatus: {} };
  const held = epic.childHealth?.held?.length || 0;
  const failed = epic.childHealth?.failed?.length || progress.failed || 0;
  const blocked = epic.childHealth?.blocked?.length || 0;
  const missing = epic.childHealth?.missingDependencies?.length || 0;
  const implemented = progress.byStatus?.implemented || 0;
  const href = detailHref(epic, url);
  const allowedTargetStatuses = (epic.actions?.dnd?.allowedTargetStatuses || epic.actions?.allowedManualTargetStatuses || []).join(" ");
  const canDrag = draggableCard && Boolean(allowedTargetStatuses);
  return /* @__PURE__ */ jsxs(
    "article",
    {
      className: "plan-card epic-card clickable-card",
      "data-draggable-plan-card": canDrag ? "true" : void 0,
      draggable: canDrag,
      "data-plan-id": epic.planId,
      "data-plan-search-card": epic.planId,
      "data-plan-name": epic.planName,
      "data-status": epic.status,
      "data-allowed-target-statuses": canDrag ? allowedTargetStatuses : void 0,
      "aria-describedby": canDrag ? `drag-help-${epic.planId}` : void 0,
      children: [
        /* @__PURE__ */ jsx("a", { className: "card-hit-area", href, "aria-label": `Open ${epic.planName} details` }),
        /* @__PURE__ */ jsxs("div", { className: "card-header", children: [
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx("p", { className: "card-kicker", children: "Epic" }),
            /* @__PURE__ */ jsx("span", { className: "card-title", children: epic.planName })
          ] }),
          canDrag ? /* @__PURE__ */ jsx("span", { className: "drag-grip", "aria-hidden": "true", title: "Drag to move status", children: "⋮⋮" }) : null
        ] }),
        canDrag ? /* @__PURE__ */ jsxs("span", { id: `drag-help-${epic.planId}`, className: "sr-only", children: [
          "Drag this Epic Card to an allowed status column: ",
          allowedTargetStatuses.replaceAll(" ", ", "),
          "."
        ] }) : null,
        /* @__PURE__ */ jsx("p", { children: epic.summary || "No Epic summary provided." }),
        epic.status === "on_hold" ? /* @__PURE__ */ jsx("p", { className: "hold-summary", children: holdMetadata(epic) }) : null,
        /* @__PURE__ */ jsxs("div", { className: "progress-meter", "aria-label": "Epic child progress", children: [
          /* @__PURE__ */ jsxs("span", { children: [
            progress.verified,
            "/",
            progress.total,
            " verified"
          ] }),
          progress.active ? /* @__PURE__ */ jsxs("span", { children: [
            progress.active,
            " active"
          ] }) : null,
          implemented ? /* @__PURE__ */ jsxs("span", { children: [
            implemented,
            " implemented"
          ] }) : null,
          progress.remaining ? /* @__PURE__ */ jsxs("span", { children: [
            progress.remaining,
            " remaining"
          ] }) : null
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "badge-row", children: [
          /* @__PURE__ */ jsxs("span", { className: "badge", children: [
            epic.childCount || progress.total || 0,
            " child Plans"
          ] }),
          epic.doneEnough ? /* @__PURE__ */ jsx("span", { className: "badge success", children: "Done enough" }) : null,
          failed ? /* @__PURE__ */ jsxs("span", { className: "badge danger", children: [
            failed,
            " failed"
          ] }) : null,
          held ? /* @__PURE__ */ jsxs("span", { className: "badge muted", children: [
            held,
            " on hold"
          ] }) : null,
          blocked ? /* @__PURE__ */ jsxs("span", { className: "badge warning", children: [
            blocked,
            " blocked"
          ] }) : null,
          missing ? /* @__PURE__ */ jsxs("span", { className: "badge danger", children: [
            missing,
            " missing deps"
          ] }) : null
        ] })
      ]
    }
  );
}

function BoardColumn({ column, url }) {
  return /* @__PURE__ */ jsxs(
    "section",
    {
      className: "board-column",
      "data-status": column.status,
      "data-action-target-status": column.status,
      "data-column-label": column.label,
      "data-plan-search-column": column.status,
      "data-column-original-count": column.count,
      "aria-label": `${column.label}: ${column.description}`,
      children: [
        /* @__PURE__ */ jsxs("header", { className: "column-header", children: [
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx("h3", { children: column.label }),
            /* @__PURE__ */ jsx("p", { children: column.description })
          ] }),
          /* @__PURE__ */ jsx("span", { className: "column-count", "data-column-count": true, children: column.count })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "column-cards", children: [
          column.cards.map(
            /** @param {any} plan */
            (plan) => plan.isEpic ? /* @__PURE__ */ jsx(EpicCard, { epic: plan, url, draggableCard: true }, plan.planId) : /* @__PURE__ */ jsx(PlanCard, { plan, url, roleLabel: "Feature", draggableCard: true }, plan.planId)
          ),
          column.cards.length === 0 ? /* @__PURE__ */ jsx("p", { className: "empty compact-empty", "data-original-empty": true, children: "No top-level Plans." }) : null,
          /* @__PURE__ */ jsxs("p", { className: "empty compact-empty filtered-empty", "data-filtered-empty": true, hidden: true, children: [
            "No Plans match this search in ",
            column.label,
            "."
          ] })
        ] })
      ]
    }
  );
}

// @ts-nocheck: Astro dev runs through Vite's SSR loader, which cannot statically resolve Deno JSR imports.
// Keep Workspace data canonical by dynamically importing the real adapter through Deno instead of reimplementing it.

const ADAPTER_URL = new URL("./plan-adapter.js", import.meta.url).href;

async function workspaceAdapter() {
    const nativeImport = Function("specifier", "return import(specifier)");
    try {
        return await nativeImport(ADAPTER_URL);
    } catch (error) {
        const runtime = globalThis;
        const cwd = runtime.Deno?.cwd?.();
        if (!cwd) throw error;
        const sourceAdapterUrl = new URL("src/ui/workspace/server/plan-adapter.js", `file://${cwd}/`).href;
        return await nativeImport(sourceAdapterUrl);
    }
}

/** @param {string} cwd */
async function loadCanonicalBoard(cwd) {
    const adapter = await workspaceAdapter();
    return await adapter.loadBoard(cwd);
}

/** @param {string} cwd @param {string} planId */
async function loadCanonicalWorkspaceDetail(cwd, planId) {
    const adapter = await workspaceAdapter();
    return await adapter.loadWorkspaceDetail(cwd, planId);
}

/** @param {unknown} error */
async function serializeCanonicalPlanError(error) {
    const adapter = await workspaceAdapter();
    return adapter.serializePlanError(error);
}

export { $$WorkspaceLayout as $, BoardColumn as B, ComplexityLabel as C, PLAN_SEARCH_QUERY_PARAM as P, PlanBoardSearch as a, PlanCard as b, createMoveStatusIntent as c, dispatchPlanLifecycleAction as d, PLAN_UI_TOKEN_QUERY as e, PLAN_UI_TOKEN_HEADER as f, workspaceHref as g, PlanLifecycleActions as h, loadCanonicalWorkspaceDetail as i, loadCanonicalBoard as l, serializeCanonicalPlanError as s, workspaceUrl as w };
