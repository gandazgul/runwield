import { PLAN_UI_TOKEN_QUERY } from "../constants.js";

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

/**
 * @param {any} plan
 * @param {URL} url
 */
export function editBodyHref(plan, url) {
    return workspaceHref(`/plans/${encodeURIComponent(plan.planId)}?edit=body`, url);
}

/** @param {{ plan: any, url: URL, compact?: boolean, roleLabel?: string }} props */
export function PlanCard({ plan, url, compact = false, roleLabel = "Plan" }) {
    const isChildCard = plan.hierarchyRole === "child" || plan.hierarchyRole === "orphan-child";
    const href = detailHref(plan, url);
    return (
        <article
            class={compact ? "plan-card compact clickable-card" : "plan-card clickable-card"}
            data-plan-id={plan.planId}
            data-status={plan.status}
        >
            <a class="card-hit-area" href={href} aria-label={`Open ${plan.planName} details`}></a>
            <div class="card-header">
                <div>
                    <p class="card-kicker">
                        <span>{roleLabel}</span>
                        {plan.complexity ? <span>{plan.complexity}</span> : null}
                    </p>
                    <span class="card-title">{plan.planName}</span>
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
        </article>
    );
}
