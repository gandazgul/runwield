import { BoardColumn } from "./BoardColumn.jsx";
import { PlanCard } from "./PlanCard.jsx";

/** @param {{ label: string }} props */
function EmptyState({ label }) {
    return <p class="empty">No {label} Plans found in this checkout.</p>;
}

/** @param {{ screen: any, url: URL }} props */
function OrphanRepairSection({ screen, url }) {
    if (!screen.orphanChildren?.length) return null;
    return (
        <section class="repair-lane">
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
    return (
        <section class="board-view" data-view={view}>
            <header class="page-header">
                <p class="eyebrow">{screen.eyebrow}</p>
                <h2>{screen.title}</h2>
                <p>{screen.description}</p>
            </header>
            {totalCards === 0 ? <EmptyState label={screen.title.toLowerCase()} /> : null}
            <div class="status-board" aria-label={`${screen.title} status columns`}>
                {screen.columns.map(/** @param {any} column */ (column) => (
                    <BoardColumn key={column.status} column={column} url={url} />
                ))}
            </div>
            <OrphanRepairSection screen={screen} url={url} />
        </section>
    );
}
