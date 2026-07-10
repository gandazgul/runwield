import Fuse from "fuse.js";
import { useEffect, useMemo, useRef, useState } from "react";

/**
 * @typedef {Object} PlanSearchEntry
 * @property {string} planId
 * @property {string} planName
 * @property {string} title
 * @property {string} summary
 */

/**
 * @typedef {Object} PlanBoardSearchProps
 * @property {string} boardId
 * @property {PlanSearchEntry[]} searchIndex
 * @property {string} [initialQuery]
 */

export const PLAN_SEARCH_QUERY_PARAM = "q";

export const PLAN_SEARCH_OPTIONS = Object.freeze({
    keys: [
        { name: "title", weight: 0.45 },
        { name: "planName", weight: 0.4 },
        { name: "summary", weight: 0.15 },
    ],
    threshold: 0.36,
    ignoreLocation: true,
    includeScore: true,
});

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizePlanSearchQuery(value) {
    return String(value || "").trim().replace(/\s+/g, " ");
}

/**
 * @param {PlanSearchEntry[]} searchIndex
 * @param {string} query
 * @returns {Set<string>}
 */
export function matchingPlanIds(searchIndex, query) {
    const normalizedQuery = normalizePlanSearchQuery(query);
    if (!normalizedQuery) return new Set(searchIndex.map((entry) => entry.planId));
    const fuse = new Fuse(searchIndex, PLAN_SEARCH_OPTIONS);
    return new Set(fuse.search(normalizedQuery).map((result) => result.item.planId));
}

/**
 * @param {PlanSearchEntry} plan
 * @param {string} query
 * @returns {boolean}
 */
export function planMatchesSearch(plan, query) {
    return matchingPlanIds([plan], query).has(plan.planId);
}

/**
 * @param {string} query
 */
function replaceQueryInUrl(query) {
    const url = new URL(globalThis.location.href);
    if (query) url.searchParams.set(PLAN_SEARCH_QUERY_PARAM, query);
    else url.searchParams.delete(PLAN_SEARCH_QUERY_PARAM);
    globalThis.history.replaceState(globalThis.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

/**
 * @param {string} query
 */
function syncQueryInWorkspaceLinks(query) {
    for (const link of document.querySelectorAll("a[href]")) {
        const anchor = /** @type {HTMLAnchorElement} */ (link);
        const href = anchor.getAttribute("href") || "";
        if (!href || href.startsWith("#")) continue;
        const url = new URL(href, globalThis.location.href);
        if (url.origin !== globalThis.location.origin) continue;
        if (query) url.searchParams.set(PLAN_SEARCH_QUERY_PARAM, query);
        else url.searchParams.delete(PLAN_SEARCH_QUERY_PARAM);
        anchor.setAttribute("href", `${url.pathname}${url.search}${url.hash}`);
    }
}

/**
 * @param {Element} scope
 * @param {Set<string>} visiblePlanIds
 * @param {boolean} hasQuery
 */
export function applyPlanSearchDomState(scope, visiblePlanIds, hasQuery) {
    const cards = [...scope.querySelectorAll("[data-plan-search-card]")];
    let visibleCount = 0;
    for (const card of cards) {
        const planId = /** @type {HTMLElement} */ (card).dataset.planSearchCard || "";
        const visible = !hasQuery || visiblePlanIds.has(planId);
        /** @type {HTMLElement} */ (card).hidden = !visible;
        if (visible) visibleCount += 1;
    }

    for (const column of scope.querySelectorAll("[data-plan-search-column]")) {
        const columnElement = /** @type {HTMLElement} */ (column);
        const columnCards = [...columnElement.querySelectorAll("[data-plan-search-card]")];
        const columnVisibleCount = columnCards.filter((card) => !/** @type {HTMLElement} */ (card).hidden).length;
        const count = columnElement.querySelector("[data-column-count]");
        if (count) {
            count.textContent = hasQuery
                ? String(columnVisibleCount)
                : columnElement.dataset.columnOriginalCount || String(columnVisibleCount);
        }
        const filteredEmpty = columnElement.querySelector("[data-filtered-empty]");
        if (filteredEmpty) /** @type {HTMLElement} */ (filteredEmpty).hidden = !hasQuery || columnVisibleCount > 0;
        const originalEmpty = columnElement.querySelector("[data-original-empty]");
        if (originalEmpty) /** @type {HTMLElement} */ (originalEmpty).hidden = hasQuery;
    }

    for (const repairLane of scope.querySelectorAll("[data-plan-search-repair]")) {
        const laneElement = /** @type {HTMLElement} */ (repairLane);
        const laneCards = [...laneElement.querySelectorAll("[data-plan-search-card]")];
        const laneVisibleCount = laneCards.filter((card) => !/** @type {HTMLElement} */ (card).hidden).length;
        const filteredEmpty = laneElement.querySelector("[data-filtered-empty]");
        if (filteredEmpty) /** @type {HTMLElement} */ (filteredEmpty).hidden = !hasQuery || laneVisibleCount > 0;
    }

    const noResults = scope.querySelector("[data-plan-search-no-results]");
    if (noResults) /** @type {HTMLElement} */ (noResults).hidden = !hasQuery || visibleCount > 0;
}

/** @param {PlanBoardSearchProps} props */
export function PlanBoardSearch({ boardId, searchIndex, initialQuery = "" }) {
    const [query, setQuery] = useState(normalizePlanSearchQuery(initialQuery));
    const searchElementRef = useRef(/** @type {HTMLDivElement | null} */ (null));
    const resultIds = useMemo(() => matchingPlanIds(searchIndex, query), [searchIndex, query]);

    useEffect(() => {
        const searchElement = searchElementRef.current;
        const searchSlot = document.querySelector("[data-plan-search-slot]");
        const originalParent = searchElement?.parentElement || null;
        const nextSibling = searchElement?.nextSibling || null;
        if (!searchElement || !searchSlot) return undefined;
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

    /** @param {{ currentTarget: HTMLInputElement }} event */
    function handleInput(event) {
        setQuery(event.currentTarget.value);
    }

    function handleClear() {
        setQuery("");
    }

    const hasQuery = Boolean(normalizePlanSearchQuery(query));

    return (
        <div ref={searchElementRef} className="plan-search" role="search" aria-label="Filter board Plans">
            <div className="plan-search-field">
                <div className="plan-search-input-row">
                    <input
                        id={`${boardId}-plan-search`}
                        type="search"
                        value={query}
                        placeholder="Filter by title, name, or summary"
                        autoComplete="off"
                        aria-label="Search Plans"
                        onInput={handleInput}
                    />
                    {hasQuery
                        ? <button type="button" className="plan-search-clear" onClick={handleClear}>Clear</button>
                        : null}
                </div>
            </div>
        </div>
    );
}

export default PlanBoardSearch;
