import { jsx, jsxs } from 'react/jsx-runtime';
import { useState, useRef, useEffect } from 'react';
import { d as dispatchPlanLifecycleAction, c as createMoveStatusIntent, w as workspaceUrl, P as PLAN_SEARCH_QUERY_PARAM, a as PlanBoardSearch, B as BoardColumn, b as PlanCard } from './astro-canonical-data_DtpUFPWi.mjs';

function parseAllowedTargetStatuses(value) {
  return new Set(value.split(/\s+/).map((status) => status.trim()).filter(Boolean));
}
function isAllowedDropTarget({ fromStatus, targetStatus, allowedTargetStatuses }) {
  return Boolean(targetStatus) && targetStatus !== fromStatus && allowedTargetStatuses.has(targetStatus);
}
function allowedStatusList(statuses) {
  return [...statuses].join(", ") || "no columns";
}
function blockedDropMessage({ planName, targetStatus = "that column", allowedTargetStatuses }) {
  return `${planName} cannot move to ${targetStatus}. Available columns: ${allowedStatusList(allowedTargetStatuses)}.`;
}
function closestCard(element) {
  return (
    /** @type {HTMLElement | null} */
    element?.closest?.('[data-draggable-plan-card="true"]') || null
  );
}
function closestColumn(element) {
  return (
    /** @type {HTMLElement | null} */
    element?.closest?.("[data-action-target-status]") || null
  );
}
function clearDropClasses(boardElement) {
  boardElement.querySelectorAll(".drop-allowed, .drop-blocked, .drop-target-active").forEach(
    (element) => {
      element.classList.remove("drop-allowed", "drop-blocked", "drop-target-active");
    }
  );
}
function makeDragImage(card) {
  const clone = (
    /** @type {HTMLElement} */
    card.cloneNode(true)
  );
  clone.classList.add("drag-image-card");
  clone.style.position = "fixed";
  clone.style.top = "-1000px";
  clone.style.left = "-1000px";
  clone.style.width = `${card.getBoundingClientRect().width}px`;
  document.body.appendChild(clone);
  return clone;
}
function PlanBoardDragDrop({ boardId }) {
  const [message, setMessage] = useState("Drag a Plan Card to an allowed status column.");
  const dragging = useRef(
    /** @type {DragPlanState | null} */
    null
  );
  useEffect(() => {
    const board = document.getElementById(boardId);
    if (!board) return void 0;
    const boardElement = board;
    function handleDragStart(event) {
      const card = closestCard(
        /** @type {Element | null} */
        event.target
      );
      if (!card || !event.dataTransfer) return;
      const allowedTargetStatuses = parseAllowedTargetStatuses(card.dataset.allowedTargetStatuses || "");
      const planId = card.dataset.planId || "";
      const planName = card.dataset.planName || planId;
      const fromStatus = card.dataset.status || "";
      if (!planId || !fromStatus || !allowedTargetStatuses.size) {
        event.preventDefault();
        setMessage(`${planName} cannot be dragged between columns. Available columns: no columns.`);
        return;
      }
      dragging.current = { planId, planName, fromStatus, allowedTargetStatuses, card };
      boardElement.classList.add("is-dragging-plan");
      card.classList.add("is-drag-source");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", planId);
      const dragImage = makeDragImage(card);
      const rect = card.getBoundingClientRect();
      const dragImageOffsetX = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
      const dragImageOffsetY = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
      event.dataTransfer.setDragImage(dragImage, dragImageOffsetX, dragImageOffsetY);
      setTimeout(() => dragImage.remove(), 0);
      setMessage(`Moving ${planName}. Available columns: ${allowedStatusList(allowedTargetStatuses)}.`);
    }
    function handleDragOver(event) {
      const state = dragging.current;
      if (!state || !event.dataTransfer) return;
      const column = closestColumn(
        /** @type {Element | null} */
        event.target
      );
      if (!column) return;
      const targetStatus = column.dataset.actionTargetStatus || "";
      const allowed = isAllowedDropTarget({
        fromStatus: state.fromStatus,
        targetStatus,
        allowedTargetStatuses: state.allowedTargetStatuses
      });
      clearDropClasses(boardElement);
      if (allowed) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        column.classList.add("drop-allowed", "drop-target-active");
        return;
      }
      event.dataTransfer.dropEffect = "none";
      column.classList.add("drop-blocked", "drop-target-active");
      setMessage(
        blockedDropMessage({
          planName: state.planName,
          targetStatus: targetStatus || "that column",
          allowedTargetStatuses: state.allowedTargetStatuses
        })
      );
    }
    function handleDragLeave(event) {
      const state = dragging.current;
      if (!state) return;
      const column = closestColumn(
        /** @type {Element | null} */
        event.target
      );
      if (!column) return;
      const relatedTarget = (
        /** @type {Node | null} */
        event.relatedTarget || null
      );
      if (relatedTarget && column.contains(relatedTarget)) return;
      column.classList.remove("drop-allowed", "drop-blocked", "drop-target-active");
    }
    function handleDrop(event) {
      const state = dragging.current;
      if (!state) return;
      const column = closestColumn(
        /** @type {Element | null} */
        event.target
      );
      const targetStatus = column?.dataset.actionTargetStatus || "";
      const allowed = isAllowedDropTarget({
        fromStatus: state.fromStatus,
        targetStatus,
        allowedTargetStatuses: state.allowedTargetStatuses
      });
      event.preventDefault();
      if (!allowed) {
        state.card.classList.add("drop-rejected");
        setTimeout(() => state.card.classList.remove("drop-rejected"), 420);
        setMessage(
          blockedDropMessage({
            planName: state.planName,
            targetStatus: targetStatus || "that column",
            allowedTargetStatuses: state.allowedTargetStatuses
          })
        );
        clearDropClasses(boardElement);
        return;
      }
      submitDrop(state, targetStatus);
    }
    function handleDragEnd(event) {
      const state = dragging.current;
      if (state && event.dataTransfer?.dropEffect === "none") {
        state.card.classList.add("drop-rejected");
        setTimeout(() => state.card.classList.remove("drop-rejected"), 420);
        setMessage(
          blockedDropMessage({
            planName: state.planName,
            allowedTargetStatuses: state.allowedTargetStatuses
          })
        );
      }
      dragging.current = null;
      boardElement.classList.remove("is-dragging-plan");
      boardElement.querySelectorAll(".is-drag-source").forEach(
        (element) => element.classList.remove("is-drag-source")
      );
      clearDropClasses(boardElement);
      boardElement.dataset.justDragged = "true";
      setTimeout(() => delete boardElement.dataset.justDragged, 0);
    }
    function handleClick(event) {
      if (boardElement.dataset.justDragged === "true") {
        event.preventDefault();
        event.stopPropagation();
      }
    }
    async function submitDrop(state, targetStatus) {
      clearDropClasses(boardElement);
      boardElement.classList.add("is-drop-pending");
      setMessage(`Moving ${state.planName} to ${targetStatus}…`);
      try {
        const { response, payload } = await dispatchPlanLifecycleAction(
          createMoveStatusIntent({
            planId: state.planId,
            fromStatus: state.fromStatus,
            toStatus: targetStatus
          })
        );
        if (!response.ok) {
          state.card.classList.add("drop-rejected");
          setTimeout(() => state.card.classList.remove("drop-rejected"), 420);
          setMessage(payload.blockedReason || payload.error || "Lifecycle move was blocked.");
          return;
        }
        setMessage(payload.message || "Lifecycle move applied.");
        location.reload();
      } finally {
        boardElement.classList.remove("is-drop-pending");
      }
    }
    boardElement.addEventListener("dragstart", handleDragStart);
    boardElement.addEventListener("dragover", handleDragOver);
    boardElement.addEventListener("dragenter", handleDragOver);
    boardElement.addEventListener("dragleave", handleDragLeave);
    boardElement.addEventListener("drop", handleDrop);
    boardElement.addEventListener("dragend", handleDragEnd);
    boardElement.addEventListener("click", handleClick, true);
    return () => {
      boardElement.removeEventListener("dragstart", handleDragStart);
      boardElement.removeEventListener("dragover", handleDragOver);
      boardElement.removeEventListener("dragenter", handleDragOver);
      boardElement.removeEventListener("dragleave", handleDragLeave);
      boardElement.removeEventListener("drop", handleDrop);
      boardElement.removeEventListener("dragend", handleDragEnd);
      boardElement.removeEventListener("click", handleClick, true);
    };
  }, [boardId]);
  return /* @__PURE__ */ jsx("p", { className: "notice muted board-dnd-status", "aria-live": "polite", "data-board-dnd-status": true, children: message });
}

function EmptyState({ label }) {
  return /* @__PURE__ */ jsxs("p", { className: "empty", children: [
    "No ",
    label,
    " Plans found in this checkout."
  ] });
}
function addPlansToSearchIndex(plans, byId) {
  for (const plan of plans || []) {
    if (!plan?.planId || byId.has(plan.planId)) continue;
    const planName = String(plan.planName || "");
    byId.set(plan.planId, {
      planId: String(plan.planId),
      title: String(plan.title || planName),
      planName,
      summary: String(plan.summary || "")
    });
  }
}
function buildPlanBoardSearchIndex(screen) {
  const byId = /* @__PURE__ */ new Map();
  for (const column of screen.columns || []) {
    addPlansToSearchIndex(column.cards, byId);
    addPlansToSearchIndex(column.orphanChildren, byId);
  }
  addPlansToSearchIndex(screen.orphanChildren, byId);
  return [...byId.values()];
}
function OrphanRepairSection({ screen, url }) {
  if (!screen.orphanChildren?.length) return null;
  return /* @__PURE__ */ jsxs("section", { className: "repair-lane", "data-plan-search-repair": true, children: [
    /* @__PURE__ */ jsxs("header", { children: [
      /* @__PURE__ */ jsx("p", { className: "eyebrow", children: "Repair" }),
      /* @__PURE__ */ jsxs("h3", { children: [
        "Orphaned child Plans (",
        screen.orphanChildren.length,
        ")"
      ] }),
      /* @__PURE__ */ jsx("p", { children: "These child FEATURE Plans reference a parentPlan value that does not resolve to a loaded Epic and remain visible for repair." })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "repair-grid", children: [
      screen.orphanChildren.map(
        /** @param {any} plan */
        (plan) => /* @__PURE__ */ jsx(PlanCard, { plan, url, roleLabel: "Orphan child" }, plan.planId)
      ),
      /* @__PURE__ */ jsx("p", { className: "empty compact-empty filtered-empty", "data-filtered-empty": true, hidden: true, children: "No orphaned child Plans match this search." })
    ] })
  ] });
}
function PlanBoard({ board, view, url, staticRender = false }) {
  const currentUrl = workspaceUrl(url);
  const screen = board.screens[view];
  const totalCards = screen.columns.reduce(
    (total, column) => total + column.cards.length + column.orphanChildren.length,
    0
  );
  const boardId = `status-board-${view}`;
  const searchIndex = buildPlanBoardSearchIndex(screen);
  const initialQuery = currentUrl.searchParams.get(PLAN_SEARCH_QUERY_PARAM) || "";
  return /* @__PURE__ */ jsxs("section", { className: "board-view", "data-view": view, "data-plan-search-scope": boardId, children: [
    staticRender ? /* @__PURE__ */ jsx("div", { className: "plan-search", role: "search", "aria-label": "Filter board Plans", children: /* @__PURE__ */ jsx("input", { type: "search", value: initialQuery, "aria-label": "Search Plans", readOnly: true }) }) : /* @__PURE__ */ jsx(PlanBoardSearch, { boardId, searchIndex, initialQuery }),
    totalCards === 0 ? /* @__PURE__ */ jsx(EmptyState, { label: screen.title.toLowerCase() }) : null,
    /* @__PURE__ */ jsxs("p", { className: "empty board-filtered-empty", "data-plan-search-no-results": true, hidden: true, children: [
      "No Plans match this search in ",
      screen.title,
      "."
    ] }),
    /* @__PURE__ */ jsx(
      "div",
      {
        id: boardId,
        className: "status-board",
        "data-plan-board": "true",
        "aria-label": `${screen.title} status columns`,
        children: screen.columns.map(
          /** @param {any} column */
          (column) => /* @__PURE__ */ jsx(BoardColumn, { column, url }, column.status)
        )
      }
    ),
    screen.columns.length && !staticRender ? /* @__PURE__ */ jsx(PlanBoardDragDrop, { boardId }) : null,
    screen.columns.length && staticRender ? /* @__PURE__ */ jsx("p", { className: "notice muted board-dnd-status", children: "Drag this Plan Card to an allowed status column." }) : null,
    /* @__PURE__ */ jsx(OrphanRepairSection, { screen, url })
  ] });
}

export { PlanBoard as P };
