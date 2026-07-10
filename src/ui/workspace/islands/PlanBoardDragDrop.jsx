import { useEffect, useRef, useState } from "react";
import { createMoveStatusIntent, dispatchPlanLifecycleAction } from "./PlanLifecycleActions.jsx";

/**
 * @typedef {Object} DragPlanState
 * @property {string} planId
 * @property {string} planName
 * @property {string} fromStatus
 * @property {Set<string>} allowedTargetStatuses
 * @property {HTMLElement} card
 */

/**
 * @param {string} value
 * @returns {Set<string>}
 */
export function parseAllowedTargetStatuses(value) {
    return new Set(value.split(/\s+/).map((status) => status.trim()).filter(Boolean));
}

/**
 * @param {{ fromStatus: string, targetStatus: string, allowedTargetStatuses: Set<string> }} opts
 */
export function isAllowedDropTarget({ fromStatus, targetStatus, allowedTargetStatuses }) {
    return Boolean(targetStatus) && targetStatus !== fromStatus && allowedTargetStatuses.has(targetStatus);
}

/** @param {Set<string>} statuses */
function allowedStatusList(statuses) {
    return [...statuses].join(", ") || "no columns";
}

/**
 * @param {{ planName: string, targetStatus?: string, allowedTargetStatuses: Set<string> }} opts
 */
export function blockedDropMessage({ planName, targetStatus = "that column", allowedTargetStatuses }) {
    return `${planName} cannot move to ${targetStatus}. Available columns: ${
        allowedStatusList(allowedTargetStatuses)
    }.`;
}

/**
 * @param {Element | null} element
 * @returns {HTMLElement | null}
 */
function closestCard(element) {
    return /** @type {HTMLElement | null} */ (element?.closest?.('[data-draggable-plan-card="true"]') || null);
}

/**
 * @param {Element | null} element
 * @returns {HTMLElement | null}
 */
function closestColumn(element) {
    return /** @type {HTMLElement | null} */ (element?.closest?.("[data-action-target-status]") || null);
}

/** @param {HTMLElement} boardElement */
function clearDropClasses(boardElement) {
    boardElement.querySelectorAll(".drop-allowed, .drop-blocked, .drop-target-active").forEach(
        (/** @param {Element} element */ element) => {
            element.classList.remove("drop-allowed", "drop-blocked", "drop-target-active");
        },
    );
}

/** @param {HTMLElement} card */
function makeDragImage(card) {
    const clone = /** @type {HTMLElement} */ (card.cloneNode(true));
    clone.classList.add("drag-image-card");
    clone.style.position = "fixed";
    clone.style.top = "-1000px";
    clone.style.left = "-1000px";
    clone.style.width = `${card.getBoundingClientRect().width}px`;
    document.body.appendChild(clone);
    return clone;
}

/** @param {{ boardId: string }} props */
export function PlanBoardDragDrop({ boardId }) {
    const [message, setMessage] = useState("Drag a Plan Card to an allowed status column.");
    const dragging = useRef(/** @type {DragPlanState | null} */ (null));

    useEffect(() => {
        const board = document.getElementById(boardId);
        if (!board) return undefined;
        const boardElement = board;

        /** @param {DragEvent} event */
        function handleDragStart(event) {
            const card = closestCard(/** @type {Element | null} */ (event.target));
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

        /** @param {DragEvent} event */
        function handleDragOver(event) {
            const state = dragging.current;
            if (!state || !event.dataTransfer) return;
            const column = closestColumn(/** @type {Element | null} */ (event.target));
            if (!column) return;
            const targetStatus = column.dataset.actionTargetStatus || "";
            const allowed = isAllowedDropTarget({
                fromStatus: state.fromStatus,
                targetStatus,
                allowedTargetStatuses: state.allowedTargetStatuses,
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
                    allowedTargetStatuses: state.allowedTargetStatuses,
                }),
            );
        }

        /** @param {DragEvent} event */
        function handleDragLeave(event) {
            const state = dragging.current;
            if (!state) return;
            const column = closestColumn(/** @type {Element | null} */ (event.target));
            if (!column) return;
            const relatedTarget = /** @type {Node | null} */ (event.relatedTarget || null);
            if (relatedTarget && column.contains(relatedTarget)) return;
            column.classList.remove("drop-allowed", "drop-blocked", "drop-target-active");
        }

        /** @param {DragEvent} event */
        function handleDrop(event) {
            const state = dragging.current;
            if (!state) return;
            const column = closestColumn(/** @type {Element | null} */ (event.target));
            const targetStatus = column?.dataset.actionTargetStatus || "";
            const allowed = isAllowedDropTarget({
                fromStatus: state.fromStatus,
                targetStatus,
                allowedTargetStatuses: state.allowedTargetStatuses,
            });
            event.preventDefault();
            if (!allowed) {
                state.card.classList.add("drop-rejected");
                setTimeout(() => state.card.classList.remove("drop-rejected"), 420);
                setMessage(
                    blockedDropMessage({
                        planName: state.planName,
                        targetStatus: targetStatus || "that column",
                        allowedTargetStatuses: state.allowedTargetStatuses,
                    }),
                );
                clearDropClasses(boardElement);
                return;
            }
            submitDrop(state, targetStatus);
        }

        /** @param {DragEvent} event */
        function handleDragEnd(event) {
            const state = dragging.current;
            if (state && event.dataTransfer?.dropEffect === "none") {
                state.card.classList.add("drop-rejected");
                setTimeout(() => state.card.classList.remove("drop-rejected"), 420);
                setMessage(
                    blockedDropMessage({
                        planName: state.planName,
                        allowedTargetStatuses: state.allowedTargetStatuses,
                    }),
                );
            }
            dragging.current = null;
            boardElement.classList.remove("is-dragging-plan");
            boardElement.querySelectorAll(".is-drag-source").forEach((element) =>
                element.classList.remove("is-drag-source")
            );
            clearDropClasses(boardElement);
            boardElement.dataset.justDragged = "true";
            setTimeout(() => delete boardElement.dataset.justDragged, 0);
        }

        /** @param {MouseEvent} event */
        function handleClick(event) {
            if (boardElement.dataset.justDragged === "true") {
                event.preventDefault();
                event.stopPropagation();
            }
        }

        /**
         * @param {DragPlanState} state
         * @param {string} targetStatus
         */
        async function submitDrop(state, targetStatus) {
            clearDropClasses(boardElement);
            boardElement.classList.add("is-drop-pending");
            setMessage(`Moving ${state.planName} to ${targetStatus}…`);
            try {
                const { response, payload } = await dispatchPlanLifecycleAction(
                    createMoveStatusIntent({
                        planId: state.planId,
                        fromStatus: state.fromStatus,
                        toStatus: targetStatus,
                    }),
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

    return (
        <p className="notice muted board-dnd-status" aria-live="polite" data-board-dnd-status>
            {message}
        </p>
    );
}

export default PlanBoardDragDrop;
