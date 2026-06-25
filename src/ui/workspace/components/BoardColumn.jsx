import { EpicCard } from "./EpicCard.jsx";
import { PlanCard } from "./PlanCard.jsx";

/** @param {{ column: any, url: URL }} props */
export function BoardColumn({ column, url }) {
    return (
        <section class="board-column" data-status={column.status}>
            <header class="column-header">
                <div>
                    <h3>{column.label}</h3>
                    <p>{column.description}</p>
                </div>
                <span class="column-count">{column.count}</span>
            </header>
            <div class="column-cards">
                {column.cards.map(/** @param {any} plan */ (plan) => (
                    plan.isEpic
                        ? <EpicCard key={plan.planId} epic={plan} url={url} />
                        : <PlanCard key={plan.planId} plan={plan} url={url} roleLabel="Feature" />
                ))}
                {column.cards.length === 0 ? <p class="empty compact-empty">No top-level Plans.</p> : null}
            </div>
        </section>
    );
}
