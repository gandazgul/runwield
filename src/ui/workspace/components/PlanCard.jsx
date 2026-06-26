import { PLAN_UI_TOKEN_QUERY } from "../../../constants.js";

/**
 * @param {string} path
 * @param {URL} url
 */
export function workspaceHref(path, url) {
    const next = new URL(path, url);
    const token = url.searchParams.get(PLAN_UI_TOKEN_QUERY) || "";
    if (token) next.searchParams.set(PLAN_UI_TOKEN_QUERY, token);
    return `${next.pathname}${next.search}`;
}

/**
 * @param {any} plan
 * @param {URL} url
 */
export function detailHref(plan, url) {
    return workspaceHref(`/plans/${encodeURIComponent(plan.planId)}`, url);
}

/** @param {{ plan: any, url: URL, compact?: boolean, roleLabel?: string }} props */
export function PlanCard({ plan, url, compact = false, roleLabel = "Plan" }) {
    const isChildCard = plan.hierarchyRole === "child" || plan.hierarchyRole === "orphan-child";
    return (
        <article
            class={compact ? "plan-card compact" : "plan-card"}
            data-plan-id={plan.planId}
            data-status={plan.status}
        >
            <div class="card-header">
                <div>
                    <p class="card-kicker">{roleLabel}</p>
                    <a class="card-title" href={detailHref(plan, url)}>{plan.planName}</a>
                </div>
            </div>
            <p>{plan.summary || "No summary provided."}</p>
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
            <dl class="meta-list">
                <div>
                    <dt>Class</dt>
                    <dd>{plan.classification}</dd>
                </div>
                {plan.complexity
                    ? (
                        <div>
                            <dt>Complexity</dt>
                            <dd>{plan.complexity}</dd>
                        </div>
                    )
                    : null}
                {plan.parentPlan
                    ? (
                        <div>
                            <dt>Epic</dt>
                            <dd>{plan.parentPlan}</dd>
                        </div>
                    )
                    : null}
            </dl>
            <div class="card-actions" aria-label="Read-only card actions">
                <a href={detailHref(plan, url)}>Open detail</a>
                <span aria-disabled="true">Actions after lifecycle slice</span>
            </div>
        </article>
    );
}
