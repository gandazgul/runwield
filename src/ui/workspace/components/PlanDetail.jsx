import { MarkdownView } from "./MarkdownView.jsx";

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

/** @param {{ plan: any }} props */
export function PlanDetail({ plan }) {
    return (
        <article class="detail" data-plan-id={plan.planId}>
            <header class="page-header detail-header">
                <p class="eyebrow">Read-first Plan detail</p>
                <h2>{plan.planName}</h2>
                <p>{plan.summary || "No summary provided."}</p>
                <div class="detail-actions" aria-label="Plan detail actions">
                    <span class="status">{plan.status}</span>
                    {plan.hierarchyRole === "orphan-child"
                        ? <span class="badge warning">Missing parent Epic</span>
                        : null}
                    {plan.blockedByDependencies ? <span class="badge warning">Dependency blocked</span> : null}
                    <span class="disabled-action" aria-disabled="true">Edit body after editor slice</span>
                    <span class="disabled-action" aria-disabled="true">
                        Lifecycle actions after board-actions slice
                    </span>
                </div>
            </header>
            <section class="detail-grid">
                <div>
                    <h3>Plan body</h3>
                    <MarkdownView markdown={plan.body || ""} />
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
