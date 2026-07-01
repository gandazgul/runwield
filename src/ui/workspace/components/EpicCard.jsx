import { detailHref } from "./PlanCard.jsx";

/** @param {any} plan */
function holdMetadata(plan) {
    const metadata = [];
    if (plan.heldFromStatus) metadata.push(`held from ${plan.heldFromStatus}`);
    if (plan.heldAt) metadata.push(`held at ${plan.heldAt}`);
    if (plan.holdReason) metadata.push(`reason: ${plan.holdReason}`);
    return metadata.length ? metadata.join("; ") : "No hold metadata provided.";
}

/** @param {{ epic: any, url: URL, draggableCard?: boolean }} props */
export function EpicCard({ epic, url, draggableCard = false }) {
    const progress = epic.childProgress || { verified: 0, total: 0, active: 0, remaining: 0, failed: 0, byStatus: {} };
    const held = epic.childHealth?.held?.length || 0;
    const failed = epic.childHealth?.failed?.length || progress.failed || 0;
    const blocked = epic.childHealth?.blocked?.length || 0;
    const missing = epic.childHealth?.missingDependencies?.length || 0;
    const implemented = progress.byStatus?.implemented || 0;
    const href = detailHref(epic, url);
    const allowedTargetStatuses =
        (epic.actions?.dnd?.allowedTargetStatuses || epic.actions?.allowedManualTargetStatuses || [])
            .join(" ");
    const canDrag = draggableCard && Boolean(allowedTargetStatuses);
    return (
        <article
            class="plan-card epic-card clickable-card"
            data-draggable-plan-card={canDrag ? "true" : undefined}
            draggable={canDrag}
            data-plan-id={epic.planId}
            data-plan-search-card={epic.planId}
            data-plan-name={epic.planName}
            data-status={epic.status}
            data-allowed-target-statuses={canDrag ? allowedTargetStatuses : undefined}
            aria-describedby={canDrag ? `drag-help-${epic.planId}` : undefined}
        >
            <a class="card-hit-area" href={href} aria-label={`Open ${epic.planName} details`}></a>
            <div class="card-header">
                <div>
                    <p class="card-kicker">Epic</p>
                    <span class="card-title">{epic.planName}</span>
                </div>
                {canDrag
                    ? (
                        <span class="drag-grip" aria-hidden="true" title="Drag to move status">
                            ⋮⋮
                        </span>
                    )
                    : null}
            </div>
            {canDrag
                ? (
                    <span id={`drag-help-${epic.planId}`} class="sr-only">
                        Drag this Epic Card to an allowed status column: {allowedTargetStatuses.replaceAll(" ", ", ")}.
                    </span>
                )
                : null}
            <p>{epic.summary || "No Epic summary provided."}</p>
            {epic.status === "on_hold" ? <p class="hold-summary">{holdMetadata(epic)}</p> : null}
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
        </article>
    );
}
