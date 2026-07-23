import { PlanBoardDragDrop } from "../islands/PlanBoardDragDrop.jsx";
import { BoardColumn } from "./BoardColumn.jsx";
import { PlanCard } from "./PlanCard.jsx";

export { buildPlanBoardSearchIndex } from "../plan-search.js";

/** @param {{ label: string }} props */
function EmptyState({ label }) {
    return <p className="empty">No {label} Plans found in this checkout.</p>;
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

/** @param {{ board: any, view: "active"|"closed"|"onHold", url: URL | string, staticRender?: boolean, staticRenderNotice?: string, draggableCards?: boolean }} props */
export function PlanBoard({ board, view, url, staticRender = false, staticRenderNotice, draggableCards = true }) {
    const screen = board.screens[view];
    const totalCards = screen.columns.reduce(
        (/** @type {number} */ total, /** @type {any} */ column) =>
            total + column.cards.length + column.orphanChildren.length,
        0,
    );
    const boardId = `status-board-${view}`;
    return (
        <section className="board-view" data-view={view} data-plan-search-scope={boardId}>
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
                    <BoardColumn key={column.status} column={column} url={url} draggableCards={draggableCards} />
                ))}
            </div>
            {screen.columns.length && !staticRender ? <PlanBoardDragDrop boardId={boardId} /> : null}
            {screen.columns.length && staticRender
                ? (
                    <p className="notice muted board-dnd-status">
                        {staticRenderNotice || "Drag this Plan Card to an allowed status column."}
                    </p>
                )
                : null}
            <OrphanRepairSection screen={screen} url={url} />
        </section>
    );
}
