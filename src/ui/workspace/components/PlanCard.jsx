import { PLAN_UI_TOKEN_QUERY } from "../constants.js";
import { PLAN_SEARCH_QUERY_PARAM } from "../islands/PlanBoardSearch.jsx";

/**
 * @param {string} path
 * @param {URL} url
 */
export function workspaceHref(path, url) {
    const next = new URL(path, url);
    const token = url.searchParams.get(PLAN_UI_TOKEN_QUERY) || "";
    const query = url.searchParams.get(PLAN_SEARCH_QUERY_PARAM) || "";
    if (token) next.searchParams.set(PLAN_UI_TOKEN_QUERY, token);
    if (query) next.searchParams.set(PLAN_SEARCH_QUERY_PARAM, query);
    return `${next.pathname}${next.search}`;
}

/**
 * @param {any} plan
 * @param {URL} url
 */
export function detailHref(plan, url) {
    return workspaceHref(`/plans/${encodeURIComponent(plan.planId)}`, url);
}

/**
 * @param {any} plan
 * @param {URL} url
 */
export function editBodyHref(plan, url) {
    return workspaceHref(`/plans/${encodeURIComponent(plan.planId)}?edit=body`, url);
}

/** @param {any} plan */
function holdMetadata(plan) {
    const metadata = [];
    if (plan.heldFromStatus) metadata.push(`held from ${plan.heldFromStatus}`);
    if (plan.heldAt) metadata.push(`held at ${plan.heldAt}`);
    if (plan.holdReason) metadata.push(`reason: ${plan.holdReason}`);
    return metadata.length ? metadata.join("; ") : "No hold metadata provided.";
}

/** @type {Record<string, string>} */
const COMPLEXITY_CLASS_BY_VALUE = {
    LOW: "complexity-low",
    MEDIUM: "complexity-medium",
    HIGH: "complexity-high",
};

/** @param {string} complexity */
export function complexityClassName(complexity) {
    const key = String(complexity || "").toUpperCase();
    return `complexity-label ${COMPLEXITY_CLASS_BY_VALUE[key] || "complexity-unknown"}`;
}

/** @param {{ complexity: string }} props */
export function ComplexityLabel({ complexity }) {
    return <span class={complexityClassName(complexity)}>{complexity}</span>;
}

/** @param {{ plan: any, url: URL, compact?: boolean, roleLabel?: string, draggableCard?: boolean }} props */
export function PlanCard({ plan, url, compact = false, roleLabel = "Plan", draggableCard = false }) {
    const isChildCard = plan.hierarchyRole === "child" || plan.hierarchyRole === "orphan-child";
    const href = detailHref(plan, url);
    const allowedTargetStatuses =
        (plan.actions?.dnd?.allowedTargetStatuses || plan.actions?.allowedManualTargetStatuses || [])
            .join(" ");
    const canDrag = draggableCard && Boolean(allowedTargetStatuses);
    return (
        <article
            class={compact ? "plan-card compact clickable-card" : "plan-card clickable-card"}
            data-draggable-plan-card={canDrag ? "true" : undefined}
            draggable={canDrag}
            data-plan-id={plan.planId}
            data-plan-search-card={plan.planId}
            data-plan-name={plan.planName}
            data-status={plan.status}
            data-allowed-target-statuses={canDrag ? allowedTargetStatuses : undefined}
            aria-describedby={canDrag ? `drag-help-${plan.planId}` : undefined}
        >
            <a class="card-hit-area" href={href} aria-label={`Open ${plan.planName} details`}></a>
            <div class="card-header">
                <div>
                    <p class="card-kicker">
                        <span>{roleLabel}</span>
                        {plan.complexity ? <ComplexityLabel complexity={plan.complexity} /> : null}
                    </p>
                    <span class="card-title">{plan.planName}</span>
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
                    <span id={`drag-help-${plan.planId}`} class="sr-only">
                        Drag this Plan Card to an allowed status column: {allowedTargetStatuses.replaceAll(" ", ", ")}.
                    </span>
                )
                : null}
            <p>{plan.summary || "No summary provided."}</p>
            {plan.status === "on_hold" ? <p class="hold-summary">{holdMetadata(plan)}</p> : null}
            <div class="badge-row">
                {plan.blockedByDependencies ? <span class="badge warning">Blocked by dependency</span> : null}
                {plan.unverifiedDependencyCount
                    ? <span class="badge warning">{plan.unverifiedDependencyCount} unverified dependency</span>
                    : null}
                {plan.missingDependencyCount
                    ? <span class="badge danger">{plan.missingDependencyCount} missing dependency</span>
                    : null}
                {plan.hierarchyRole === "orphan-child" ? <span class="badge warning">Missing parent Epic</span> : null}
                {isChildCard && plan.status === "on_hold" ? <span class="badge muted">Child on hold</span> : null}
                {isChildCard && plan.status === "failed" ? <span class="badge danger">Failed child</span> : null}
            </div>
        </article>
    );
}
