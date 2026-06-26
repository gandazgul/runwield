import { detailHref } from "./PlanCard.jsx";

/** @param {{ epic: any, url: URL }} props */
export function EpicCard({ epic, url }) {
    const progress = epic.childProgress || { verified: 0, total: 0, active: 0, remaining: 0, failed: 0, byStatus: {} };
    const held = epic.childHealth?.held?.length || 0;
    const failed = epic.childHealth?.failed?.length || progress.failed || 0;
    const blocked = epic.childHealth?.blocked?.length || 0;
    const missing = epic.childHealth?.missingDependencies?.length || 0;
    const implemented = progress.byStatus?.implemented || 0;
    return (
        <article class="plan-card epic-card" data-plan-id={epic.planId} data-status={epic.status}>
            <div class="card-header">
                <div>
                    <p class="card-kicker">Epic</p>
                    <a class="card-title" href={detailHref(epic, url)}>{epic.planName}</a>
                </div>
            </div>
            <p>{epic.summary || "No Epic summary provided."}</p>
            <div class="progress-meter" aria-label="Epic child progress">
                <span>{progress.verified}/{progress.total} verified</span>
                {progress.active ? <span>{progress.active} active</span> : null}
                {implemented ? <span>{implemented} implemented</span> : null}
                {progress.remaining ? <span>{progress.remaining} remaining</span> : null}
            </div>
            <div class="badge-row">
                <span class="badge">{epic.childCount || progress.total || 0} child Plans</span>
                {epic.doneEnough ? <span class="badge success">Done enough</span> : null}
                {failed ? <span class="badge danger">{failed} failed</span> : null}
                {held ? <span class="badge muted">{held} on hold</span> : null}
                {blocked ? <span class="badge warning">{blocked} blocked</span> : null}
                {missing ? <span class="badge danger">{missing} missing deps</span> : null}
            </div>
            <div class="card-actions" aria-label="Epic card actions">
                <a href={detailHref(epic, url)}>Open Epic detail</a>
                <span aria-disabled="true">Child actions live in Epic detail</span>
            </div>
        </article>
    );
}
