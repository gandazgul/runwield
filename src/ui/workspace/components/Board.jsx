import { PlanBoardDragDrop } from "../islands/PlanBoardDragDrop.jsx";
import { PLAN_SEARCH_QUERY_PARAM, PlanBoardSearch } from "../islands/PlanBoardSearch.jsx";
import { BoardColumn } from "./BoardColumn.jsx";
import { PlanCard, workspaceUrl } from "./PlanCard.jsx";

/** @param {{ label: string }} props */
function EmptyState({ label }) {
    return <p className="empty">No {label} Plans found in this checkout.</p>;
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

/** @param {{ screen: any, url: URL | string }} props */
function OrphanRepairSection({ screen, url }) {
    if (!screen.orphanChildren?.length) return null;
    return (
        <section className="repair-lane" data-plan-search-repair>
            <header>
                <p className="eyebrow">Repair</p>
                <h3>Orphaned child Plans ({screen.orphanChildren.length})</h3>
                <p>
                    These child FEATURE Plans reference a parentPlan value that does not resolve to a loaded Epic and
                    remain visible for repair.
                </p>
            </header>
            <div className="repair-grid">
                {screen.orphanChildren.map(/** @param {any} plan */ (plan) => (
                    <PlanCard key={plan.planId} plan={plan} url={url} roleLabel="Orphan child" />
                ))}
                <p className="empty compact-empty filtered-empty" data-filtered-empty hidden>
                    No orphaned child Plans match this search.
                </p>
            </div>
        </section>
    );
}

/** @param {{ board: any, view: "active"|"closed"|"onHold", url: URL | string, staticRender?: boolean }} props */
export function PlanBoard({ board, view, url, staticRender = false }) {
    const currentUrl = workspaceUrl(url);
    const screen = board.screens[view];
    const totalCards = screen.columns.reduce(
        (/** @type {number} */ total, /** @type {any} */ column) =>
            total + column.cards.length + column.orphanChildren.length,
        0,
    );
    const boardId = `status-board-${view}`;
    const searchIndex = buildPlanBoardSearchIndex(screen);
    const initialQuery = currentUrl.searchParams.get(PLAN_SEARCH_QUERY_PARAM) || "";
    return (
        <section className="board-view" data-view={view} data-plan-search-scope={boardId}>
            {staticRender
                ? (
                    <div className="plan-search" role="search" aria-label="Filter board Plans">
                        <input type="search" value={initialQuery} aria-label="Search Plans" readOnly />
                    </div>
                )
                : <PlanBoardSearch boardId={boardId} searchIndex={searchIndex} initialQuery={initialQuery} />}
            {totalCards === 0 ? <EmptyState label={screen.title.toLowerCase()} /> : null}
            <p className="empty board-filtered-empty" data-plan-search-no-results hidden>
                No Plans match this search in {screen.title}.
            </p>
            <div
                id={boardId}
                className="status-board"
                data-plan-board="true"
                aria-label={`${screen.title} status columns`}
            >
                {screen.columns.map(/** @param {any} column */ (column) => (
                    <BoardColumn key={column.status} column={column} url={url} />
                ))}
            </div>
            {screen.columns.length && !staticRender ? <PlanBoardDragDrop boardId={boardId} /> : null}
            {screen.columns.length && staticRender
                ? <p className="notice muted board-dnd-status">Drag this Plan Card to an allowed status column.</p>
                : null}
            <OrphanRepairSection screen={screen} url={url} />
        </section>
    );
}
