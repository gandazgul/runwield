import { PlanBoardDragDrop } from "../islands/PlanBoardDragDrop.jsx";
import { PLAN_SEARCH_QUERY_PARAM, PlanBoardSearch } from "../islands/PlanBoardSearch.jsx";
import { BoardColumn } from "./BoardColumn.jsx";
import { PlanCard } from "./PlanCard.jsx";

/** @param {{ label: string }} props */
function EmptyState({ label }) {
    return <p class="empty">No {label} Plans found in this checkout.</p>;
}

/**
 * @param {any[]} plans
 * @param {Map<string, { planId: string, title: string, planName: string, summary: string }>} byId
 */
function addPlansToSearchIndex(plans, byId) {
    for (const plan of plans || []) {
        if (!plan?.planId || byId.has(plan.planId)) continue;
        const planName = String(plan.planName || "");
        byId.set(plan.planId, {
            planId: String(plan.planId),
            title: String(plan.title || planName),
            planName,
            summary: String(plan.summary || ""),
        });
    }
}

/**
 * @param {any} screen
 * @returns {Array<{ planId: string, title: string, planName: string, summary: string }>}
 */
export function buildPlanBoardSearchIndex(screen) {
    const byId = new Map();
    for (const column of screen.columns || []) {
        addPlansToSearchIndex(column.cards, byId);
        addPlansToSearchIndex(column.orphanChildren, byId);
    }
    addPlansToSearchIndex(screen.orphanChildren, byId);
    return [...byId.values()];
}

/** @param {{ screen: any, url: URL }} props */
function OrphanRepairSection({ screen, url }) {
    if (!screen.orphanChildren?.length) return null;
    return (
        <section class="repair-lane" data-plan-search-repair>
            <header>
                <p class="eyebrow">Repair</p>
                <h3>Orphaned child Plans ({screen.orphanChildren.length})</h3>
                <p>
                    These child FEATURE Plans reference a parentPlan value that does not resolve to a loaded Epic and
                    remain visible for repair.
                </p>
            </header>
            <div class="repair-grid">
                {screen.orphanChildren.map(/** @param {any} plan */ (plan) => (
                    <PlanCard key={plan.planId} plan={plan} url={url} roleLabel="Orphan child" />
                ))}
                <p class="empty compact-empty filtered-empty" data-filtered-empty hidden>
                    No orphaned child Plans match this search.
                </p>
            </div>
        </section>
    );
}

/** @param {{ board: any, view: "active"|"closed"|"onHold", url: URL }} props */
export function PlanBoard({ board, view, url }) {
    const screen = board.screens[view];
    const totalCards = screen.columns.reduce(
        (/** @type {number} */ total, /** @type {any} */ column) =>
            total + column.cards.length + column.orphanChildren.length,
        0,
    );
    const boardId = `status-board-${view}`;
    const searchIndex = buildPlanBoardSearchIndex(screen);
    const initialQuery = url.searchParams.get(PLAN_SEARCH_QUERY_PARAM) || "";
    return (
        <section class="board-view" data-view={view} data-plan-search-scope={boardId}>
            <PlanBoardSearch boardId={boardId} searchIndex={searchIndex} initialQuery={initialQuery} />
            {totalCards === 0 ? <EmptyState label={screen.title.toLowerCase()} /> : null}
            <p class="empty board-filtered-empty" data-plan-search-no-results hidden>
                No Plans match this search in {screen.title}.
            </p>
            <div
                id={boardId}
                class="status-board"
                data-plan-board="true"
                aria-label={`${screen.title} status columns`}
            >
                {screen.columns.map(/** @param {any} column */ (column) => (
                    <BoardColumn key={column.status} column={column} url={url} />
                ))}
            </div>
            {screen.columns.length ? <PlanBoardDragDrop boardId={boardId} /> : null}
            <OrphanRepairSection screen={screen} url={url} />
        </section>
    );
}
