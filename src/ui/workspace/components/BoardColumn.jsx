import { EpicCard } from "./EpicCard.jsx";
import { PlanCard } from "./PlanCard.jsx";

/** @param {{ column: any, url: URL | string }} props */
export function BoardColumn({ column, url }) {
    return (
        <section
            className="board-column"
            data-status={column.status}
            data-action-target-status={column.status}
            data-column-label={column.label}
            data-plan-search-column={column.status}
            data-column-original-count={column.count}
            aria-label={`${column.label}: ${column.description}`}
        >
            <header className="column-header">
                <div>
                    <h3>{column.label}</h3>
                    <p>{column.description}</p>
                </div>
                <span className="column-count" data-column-count>{column.count}</span>
            </header>
            <div className="column-cards">
                {column.cards.map(/** @param {any} plan */ (plan) => (
                    plan.isEpic
                        ? <EpicCard key={plan.planId} epic={plan} url={url} draggableCard />
                        : <PlanCard key={plan.planId} plan={plan} url={url} roleLabel="Feature" draggableCard />
                ))}
                {column.cards.length === 0
                    ? <p className="empty compact-empty" data-original-empty>No top-level Plans.</p>
                    : null}
                <p className="empty compact-empty filtered-empty" data-filtered-empty hidden>
                    No Plans match this search in {column.label}.
                </p>
            </div>
        </section>
    );
}
