import { BoardColumn } from "./BoardColumn.jsx";
import { DetailMetadata, FrontMatterSummary } from "./PlanDetail.jsx";
import { MarkdownView } from "./MarkdownView.jsx";

/** @param {any} entry */
function dependencyLabel(entry) {
    return `${entry.dependency}: ${entry.state}${entry.status ? ` (${entry.status})` : ""}`;
}

/** @param {any} plan */
function holdMetadata(plan) {
    const metadata = [];
    if (plan.heldFromStatus) metadata.push(`held from ${plan.heldFromStatus}`);
    if (plan.heldAt) metadata.push(`held at ${plan.heldAt}`);
    if (plan.holdReason) metadata.push(`reason: ${plan.holdReason}`);
    return metadata.length ? metadata.join("; ") : "No hold metadata provided.";
}

/** @param {{ epic: any, url: URL }} props */
export function EpicDetail({ epic, url }) {
    const progress = epic.childProgress || { verified: 0, total: 0, active: 0, remaining: 0, failed: 0, byStatus: {} };
    const health = epic.childHealth || {};
    const failed = health.failed?.length || 0;
    const held = health.held?.length || 0;
    const blocked = health.blocked?.length || 0;
    const missing = health.missingDependencies?.length || 0;
    const visibleColumns = (epic.childColumns || []).filter(
        (/** @type {any} */ column) => column.cards.length || column.orphanChildren.length,
    );
    const childrenWithDependencies = (epic.children || []).filter(
        (/** @type {any} */ child) => child.dependencyStates?.length,
    );
    return (
        <article class="detail epic-detail" data-plan-id={epic.planId}>
            <header class="page-header detail-header">
                <p class="eyebrow">Epic detail</p>
                <h2>{epic.planName}</h2>
                <p>{epic.summary || "No Epic summary provided."}</p>
                <div class="progress-meter large" aria-label="Epic child progress">
                    <span>{progress.verified}/{progress.total} child Plans verified</span>
                    <span>{progress.active} active or implemented</span>
                    <span>{progress.remaining} remaining</span>
                    {failed ? <span>{failed} failed</span> : null}
                    {held ? <span>{held} on hold</span> : null}
                    {blocked ? <span>{blocked} blocked by dependencies</span> : null}
                    {missing ? <span>{missing} with missing dependencies</span> : null}
                </div>
                <div class="badge-row health-summary">
                    {epic.doneEnough
                        ? (
                            <span class="badge success">
                                Epic marked done enough{epic.epicDoneEnoughAt ? ` at ${epic.epicDoneEnoughAt}` : ""}
                            </span>
                        )
                        : null}
                    {epic.status === "on_hold"
                        ? (
                            <span class="badge muted">
                                Epic on hold{epic.heldFromStatus ? ` from ${epic.heldFromStatus}` : ""}
                                {epic.heldAt ? ` at ${epic.heldAt}` : ""}
                            </span>
                        )
                        : null}
                    {failed ? <span class="badge danger">{failed} failed child Plans</span> : null}
                    {held ? <span class="badge muted">{held} child Plans on hold</span> : null}
                    {blocked ? <span class="badge warning">{blocked} child Plans blocked</span> : null}
                </div>
                {epic.doneEnough && epic.epicDoneEnoughSummary
                    ? <p class="notice success">Done enough: {epic.epicDoneEnoughSummary}</p>
                    : null}
                {epic.status === "on_hold"
                    ? (
                        <p class="notice muted">
                            Held Epic only blocks child work in UI context; child statuses are shown unchanged.{" "}
                            {holdMetadata(epic)}
                        </p>
                    )
                    : null}
            </header>
            <section class="detail-grid">
                <div>
                    <h3>Epic body</h3>
                    <MarkdownView markdown={epic.body || ""} />
                    <section class="child-plan-section">
                        <h3>Child health</h3>
                        {failed || held || blocked || missing
                            ? (
                                <ul class="health-list">
                                    {(health.failed || []).map(/** @param {any} child */ (child) => (
                                        <li key={`failed-${child.planId}`}>
                                            <strong>Failed:</strong> {child.planName}{" "}
                                            {child.failureReason || "needs recovery attention"}
                                        </li>
                                    ))}
                                    {(health.held || []).map(/** @param {any} child */ (child) => (
                                        <li key={`held-${child.planId}`}>
                                            <strong>Held:</strong> {child.planName} {holdMetadata(child)}
                                        </li>
                                    ))}
                                    {(health.blocked || []).map(/** @param {any} child */ (child) => (
                                        <li key={`blocked-${child.planId}`}>
                                            <strong>Blocked:</strong> {child.planName} has{" "}
                                            {child.unverifiedDependencyCount || 0} unverified and{" "}
                                            {child.missingDependencyCount || 0} missing dependencies.
                                            {child.dependencyStates?.length
                                                ? (
                                                    <ul>
                                                        {child.dependencyStates.map(/** @param {any} entry */ (
                                                            entry,
                                                        ) => (
                                                            <li key={`${child.planId}-${entry.dependency}`}>
                                                                {dependencyLabel(entry)}
                                                            </li>
                                                        ))}
                                                    </ul>
                                                )
                                                : null}
                                        </li>
                                    ))}
                                </ul>
                            )
                            : <p class="empty">No failed, held, or dependency-blocked children.</p>}
                    </section>
                    <section class="child-plan-section">
                        <h3>Child dependencies</h3>
                        {childrenWithDependencies.length
                            ? (
                                <ul class="health-list dependency-health-list">
                                    {childrenWithDependencies.map(/** @param {any} child */ (child) => (
                                        <li key={`dependencies-${child.planId}`}>
                                            <strong>{child.planName}:</strong>{" "}
                                            {child.dependencyStates.map(dependencyLabel).join(", ")}
                                        </li>
                                    ))}
                                </ul>
                            )
                            : <p class="empty">No child FEATURE Plan dependencies declared.</p>}
                    </section>
                    <section class="child-plan-section">
                        <h3>Child FEATURE Plans</h3>
                        {visibleColumns.length
                            ? (
                                <div class="status-board child-status-board">
                                    {visibleColumns.map(/** @param {any} column */ (column) => (
                                        <BoardColumn key={column.status} column={column} url={url} />
                                    ))}
                                </div>
                            )
                            : <p class="empty">No child FEATURE Plans are attached to this Epic.</p>}
                    </section>
                </div>
                <aside>
                    <h3>Epic metadata</h3>
                    <DetailMetadata plan={epic} />
                    <h3>Front matter summary</h3>
                    <FrontMatterSummary frontMatter={epic.frontMatter || {}} />
                </aside>
            </section>
        </article>
    );
}
