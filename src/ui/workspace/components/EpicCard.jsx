import { detailHref } from "./PlanCard.jsx";

/** @param {any} plan */
function holdMetadata(plan) {
    const metadata = [];
    if (plan.heldFromStatus) metadata.push(`held from ${plan.heldFromStatus}`);
    if (plan.heldAt) metadata.push(`held at ${plan.heldAt}`);
    if (plan.holdReason) metadata.push(`reason: ${plan.holdReason}`);
    return metadata.length ? metadata.join("; ") : "No hold metadata provided.";
}

/** @param {{ epic: any, url: URL | string, draggableCard?: boolean }} props */
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
            className="plan-card epic-card clickable-card"
            data-draggable-plan-card={canDrag ? "true" : undefined}
            draggable={canDrag}
            data-plan-id={epic.planId}
            data-plan-search-card={epic.planId}
            data-plan-name={epic.planName}
            data-status={epic.status}
            data-allowed-target-statuses={canDrag ? allowedTargetStatuses : undefined}
            aria-describedby={canDrag ? `drag-help-${epic.planId}` : undefined}
        >
            <a className="card-hit-area" href={href} aria-label={`Open ${epic.planName} details`}></a>
            <div className="card-header">
                <div>
                    <p className="card-kicker">Epic</p>
                    <span className="card-title">{epic.planName}</span>
                </div>
                {canDrag
                    ? (
                        <span className="drag-grip" aria-hidden="true" title="Drag to move status">
                            ⋮⋮
                        </span>
                    )
                    : null}
            </div>
            {canDrag
                ? (
                    <span id={`drag-help-${epic.planId}`} className="sr-only">
                        Drag this Epic Card to an allowed status column: {allowedTargetStatuses.replaceAll(" ", ", ")}.
                    </span>
                )
                : null}
            <p>{epic.summary || "No Epic summary provided."}</p>
            {epic.status === "on_hold" ? <p className="hold-summary">{holdMetadata(epic)}</p> : null}
            <div className="progress-meter" aria-label="Epic child progress">
                <span>{progress.verified}/{progress.total} verified</span>
                {progress.active ? <span>{progress.active} active</span> : null}
                {implemented ? <span>{implemented} implemented</span> : null}
                {progress.remaining ? <span>{progress.remaining} remaining</span> : null}
            </div>
            <div className="badge-row">
                <span className="badge">{epic.childCount || progress.total || 0} child Plans</span>
                {epic.doneEnough ? <span className="badge success">Done enough</span> : null}
                {failed ? <span className="badge danger">{failed} failed</span> : null}
                {held ? <span className="badge muted">{held} on hold</span> : null}
                {blocked ? <span className="badge warning">{blocked} blocked</span> : null}
                {missing ? <span className="badge danger">{missing} missing deps</span> : null}
            </div>
        </article>
    );
}
