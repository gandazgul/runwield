import { PlanBodyEditor } from "../islands/PlanBodyEditor.jsx";
import { PlanLifecycleActions } from "../islands/PlanLifecycleActions.jsx";
import { ComplexityLabel, workspaceHref } from "./PlanCard.jsx";

const CLOSED_STATUSES = new Set(["verified", "closed_without_verification"]);

/** @param {string} status */
export function tabForPlanStatus(status) {
    if (status === "on_hold") return "on-hold";
    if (CLOSED_STATUSES.has(status)) return "closed";
    return "active";
}

/**
 * @param {string} status
 * @param {URL} url
 */
export function boardHrefForPlanStatus(status, url) {
    const tab = tabForPlanStatus(status);
    if (tab === "closed") return workspaceHref("/closed", url);
    if (tab === "on-hold") return workspaceHref("/on-hold", url);
    return workspaceHref("/", url);
}

/** @param {any} plan */
function holdMetadata(plan) {
    const metadata = [];
    if (plan.heldFromStatus) metadata.push(`held from ${plan.heldFromStatus}`);
    if (plan.heldAt) metadata.push(`held at ${plan.heldAt}`);
    if (plan.holdReason) metadata.push(`reason: ${plan.holdReason}`);
    return metadata.length ? metadata.join("; ") : "No hold metadata provided.";
}

/** @param {{ plan: any }} props */
function DetailMetadata({ plan }) {
    return (
        <dl class="meta-list stacked">
            <div>
                <dt>Plan ID</dt>
                <dd>{plan.planId}</dd>
            </div>
            <div>
                <dt>Path</dt>
                <dd>{plan.relativePath}</dd>
            </div>
            <div>
                <dt>Status</dt>
                <dd>{plan.status}</dd>
            </div>
            <div>
                <dt>Classification</dt>
                <dd>{plan.classification}</dd>
            </div>
            {plan.complexity
                ? (
                    <div>
                        <dt>Complexity</dt>
                        <dd>
                            <ComplexityLabel complexity={plan.complexity} />
                        </dd>
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
            {plan.dependsOn?.length
                ? (
                    <div>
                        <dt>Depends on</dt>
                        <dd>{plan.dependsOn.join(", ")}</dd>
                    </div>
                )
                : null}
            {plan.dependencyStates?.length
                ? (
                    <div>
                        <dt>Dependency state</dt>
                        <dd>
                            {plan.dependencyStates.map(/** @param {any} entry */ (entry) =>
                                `${entry.dependency}: ${entry.state}${entry.status ? ` (${entry.status})` : ""}`
                            ).join(", ")}
                        </dd>
                    </div>
                )
                : null}
            {plan.hierarchyRole === "orphan-child"
                ? (
                    <div>
                        <dt>Repair parent</dt>
                        <dd>
                            {plan.orphanReason || `parentPlan ${plan.parentPlan} does not resolve to a loaded Epic.`}
                        </dd>
                    </div>
                )
                : null}
            {plan.worktreeStatus
                ? (
                    <div>
                        <dt>Worktree</dt>
                        <dd>{plan.worktreeStatus} {plan.worktreeBranch ? `(${plan.worktreeBranch})` : ""}</dd>
                    </div>
                )
                : null}
            {plan.status === "on_hold"
                ? (
                    <div>
                        <dt>Hold</dt>
                        <dd>{holdMetadata(plan)}</dd>
                    </div>
                )
                : null}
        </dl>
    );
}

/** @param {{ frontMatter: Record<string, unknown> }} props */
function FrontMatterSummary({ frontMatter }) {
    const entries = Object.entries(frontMatter || {}).filter(([, value]) => value !== undefined && value !== "");
    return (
        <dl class="meta-list stacked front-matter-summary">
            {entries.map(([key, value]) => (
                <div key={key}>
                    <dt>{key}</dt>
                    <dd>{Array.isArray(value) ? value.join(", ") : String(value)}</dd>
                </div>
            ))}
        </dl>
    );
}

/** @param {{ plan: any, url: URL, editIntent?: boolean }} props */
export function PlanDetail({ plan, url, editIntent = false }) {
    const editHref = workspaceHref(`/plans/${encodeURIComponent(plan.planId)}?edit=body`, url);
    const closeHref = boardHrefForPlanStatus(plan.status, url);
    return (
        <article class="detail" data-plan-id={plan.planId} data-selected-tab={tabForPlanStatus(plan.status)}>
            <header class="page-header detail-header split-header">
                <div>
                    <div class="detail-title-row">
                        <a class="detail-back-link" href={closeHref}>{"< Back"}</a>
                        <h2>{plan.planName}</h2>
                        <a class="detail-close-link" href={closeHref} aria-label="Close plan detail">X</a>
                    </div>
                    <p>{plan.summary || "No summary provided."}</p>
                    {plan.status === "on_hold" ? <p class="notice muted">{holdMetadata(plan)}</p> : null}
                    <div class="detail-actions" aria-label="Plan status">
                        <span class={`status status-${plan.status}`}>{plan.status}</span>
                        {plan.hierarchyRole === "orphan-child"
                            ? <span class="badge warning">Missing parent Epic</span>
                            : null}
                        {plan.blockedByDependencies ? <span class="badge warning">Dependency blocked</span> : null}
                    </div>
                </div>
                <div class="header-actions" aria-label="Plan detail actions">
                    <PlanLifecycleActions plan={plan} />
                    {editIntent ? null : <a class="primary-action" href={editHref}>Edit</a>}
                </div>
            </header>
            <section class="detail-grid">
                <div>
                    <PlanBodyEditor plan={plan} initialEdit={editIntent} />
                </div>
                <aside>
                    <h3>Metadata</h3>
                    <DetailMetadata plan={plan} />
                    <h3>Front matter summary</h3>
                    <FrontMatterSummary frontMatter={plan.frontMatter || {}} />
                </aside>
            </section>
        </article>
    );
}

export { DetailMetadata, FrontMatterSummary };
