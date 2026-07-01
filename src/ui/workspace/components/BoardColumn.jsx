import { EpicCard } from "./EpicCard.jsx";
import { PlanCard } from "./PlanCard.jsx";

/** @param {{ column: any, url: URL }} props */
export function BoardColumn({ column, url }) {
    return (
        <section
            class="board-column"
            data-status={column.status}
            data-action-target-status={column.status}
            data-column-label={column.label}
            data-plan-search-column={column.status}
            data-column-original-count={column.count}
            aria-label={`${column.label}: ${column.description}`}
        >
            <header class="column-header">
                <div>
                    <h3>{column.label}</h3>
                    <p>{column.description}</p>
                </div>
                <span class="column-count" data-column-count>{column.count}</span>
            </header>
            <div class="column-cards">
                {column.cards.map(/** @param {any} plan */ (plan) => (
                    plan.isEpic
                        ? <EpicCard key={plan.planId} epic={plan} url={url} draggableCard />
                        : <PlanCard key={plan.planId} plan={plan} url={url} roleLabel="Feature" draggableCard />
                ))}
                {column.cards.length === 0
                    ? <p class="empty compact-empty" data-original-empty>No top-level Plans.</p>
                    : null}
                <p class="empty compact-empty filtered-empty" data-filtered-empty hidden>
                    No Plans match this search in {column.label}.
                </p>
            </div>
        </section>
    );
}
