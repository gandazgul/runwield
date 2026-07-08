import {
    PLAN_FRONT_MATTER_KEY_ORDER as FRONT_MATTER_KEY_ORDER,
    PLAN_FRONT_MATTER_KEYS as FM,
} from "../../../plan-front-matter.js";
import { PlanBodyEditor } from "../islands/PlanBodyEditor.jsx";
import { PlanLifecycleActions } from "../islands/PlanLifecycleActions.jsx";
import { BoardColumn } from "./BoardColumn.jsx";
import { MarkdownView } from "./MarkdownView.jsx";
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
 * @param {URL | string} url
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

/** @param {any} plan */
function isEpicDetail(plan) {
    return Boolean(plan.isEpic || plan.detailKind === "epic" || plan.type === "epic");
}

/** @param {any} entry */
function dependencyLabel(entry) {
    return `${entry.dependency}: ${entry.state}${entry.status ? ` (${entry.status})` : ""}`;
}

/** @type {string[]} */
const FRONT_MATTER_KEYS_IN_ORDER = [...FRONT_MATTER_KEY_ORDER];
/** @type {Set<string>} */
const FRONT_MATTER_KEY_SET = new Set(FRONT_MATTER_KEYS_IN_ORDER);
/** @type {Set<string>} */
const HIDDEN_METADATA_KEYS = new Set([FM.worktreePath]);
const RESOURCE_METADATA_KEYS = Object.freeze({
    relativePath: "relativePath",
    dependencyState: "dependencyState",
    repairParent: "repairParent",
});

/** @type {Record<string, string>} */
const METADATA_LABELS = Object.freeze({
    [FM.planId]: "Plan ID",
    [RESOURCE_METADATA_KEYS.relativePath]: "Path",
    [FM.origin]: "Origin",
    [FM.type]: "Type",
    [FM.classification]: "Classification",
    [FM.complexity]: "Complexity",
    [FM.summary]: "Summary",
    [FM.affectedPaths]: "Affected paths",
    [FM.createdAt]: "Created at",
    [FM.updatedAt]: "Updated at",
    [FM.parentPlan]: "Epic",
    [FM.dependencies]: "Depends on",
    [RESOURCE_METADATA_KEYS.dependencyState]: "Dependency state",
    [RESOURCE_METADATA_KEYS.repairParent]: "Repair parent",
    [FM.status]: "Status",
    [FM.failureReason]: "Failure reason",
    [FM.failedAt]: "Failed at",
    [FM.implementedAt]: "Implemented at",
    [FM.verifiedAt]: "Verified at",
    [FM.executionBaselineTree]: "Execution baseline tree",
    [FM.worktreeId]: "Worktree ID",
    [FM.worktreeBranch]: "Worktree branch",
    [FM.worktreeStatus]: "Worktree status",
    [FM.humanReviewMode]: "Human review mode",
    [FM.humanReviewDecision]: "Human review decision",
    [FM.humanReviewedAt]: "Human reviewed at",
    [FM.epicCompletionMode]: "Epic completion mode",
    [FM.epicDoneEnoughAt]: "Epic done enough at",
    [FM.epicDoneEnoughSummary]: "Epic done enough summary",
    [FM.heldFromStatus]: "Held from status",
    [FM.heldAt]: "Held at",
    [FM.holdReason]: "Hold reason",
    [FM.holdStalenessBaseline]: "Hold staleness baseline",
});

const METADATA_GROUPS = Object.freeze([
    {
        title: "Identity",
        keys: [FM.planId, RESOURCE_METADATA_KEYS.relativePath, FM.origin, FM.type],
    },
    {
        title: "Planning",
        keys: [FM.classification, FM.complexity, FM.summary, FM.affectedPaths, FM.createdAt, FM.updatedAt],
    },
    {
        title: "Hierarchy & dependencies",
        keys: [
            FM.parentPlan,
            FM.dependencies,
            RESOURCE_METADATA_KEYS.dependencyState,
            RESOURCE_METADATA_KEYS.repairParent,
        ],
    },
    {
        title: "Lifecycle",
        keys: [FM.status, FM.failureReason, FM.failedAt, FM.implementedAt, FM.verifiedAt],
    },
    {
        title: "Execution worktree",
        keys: [FM.executionBaselineTree, FM.worktreeId, FM.worktreeBranch, FM.worktreeStatus],
    },
    {
        title: "Review",
        keys: [FM.humanReviewMode, FM.humanReviewDecision, FM.humanReviewedAt],
    },
    {
        title: "Epic completion",
        keys: [FM.epicCompletionMode, FM.epicDoneEnoughAt, FM.epicDoneEnoughSummary],
    },
    {
        title: "Hold",
        keys: [FM.heldFromStatus, FM.heldAt, FM.holdReason, FM.holdStalenessBaseline],
    },
]);

/** @param {unknown} value */
function hasMetadataValue(value) {
    return value !== undefined && value !== "";
}

/**
 * @param {string} key
 * @returns {string}
 */
function metadataLabel(key) {
    if (METADATA_LABELS[key]) return METADATA_LABELS[key];
    return key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (char) => char.toUpperCase());
}

/**
 * @param {any} plan
 * @returns {Record<string, unknown>}
 */
function planMetadata(plan) {
    const source = plan.frontMatter || plan.attrs || {};
    return {
        ...source,
        [FM.planId]: source[FM.planId] ?? plan.planId,
        [RESOURCE_METADATA_KEYS.relativePath]: plan.relativePath,
        [FM.status]: source[FM.status] ?? plan.status,
        [FM.classification]: source[FM.classification] ?? plan.classification,
        [FM.complexity]: source[FM.complexity] ?? plan.complexity,
        [FM.summary]: source[FM.summary] ?? plan.summary,
        [FM.parentPlan]: source[FM.parentPlan] ?? plan.parentPlan,
        [FM.dependencies]: source[FM.dependencies] ?? plan.dependsOn,
        [FM.worktreeBranch]: source[FM.worktreeBranch] ?? plan.worktreeBranch,
        [FM.worktreeStatus]: source[FM.worktreeStatus] ?? plan.worktreeStatus,
        [FM.humanReviewMode]: source[FM.humanReviewMode] ?? plan.humanReviewMode,
        [FM.heldFromStatus]: source[FM.heldFromStatus] ?? plan.heldFromStatus,
        [FM.heldAt]: source[FM.heldAt] ?? plan.heldAt,
        [FM.holdReason]: source[FM.holdReason] ?? plan.holdReason,
        [FM.failureReason]: source[FM.failureReason] ?? plan.failureReason,
        [FM.failedAt]: source[FM.failedAt] ?? plan.failedAt,
        [FM.epicCompletionMode]: source[FM.epicCompletionMode] ?? plan.epicCompletionMode,
        [FM.epicDoneEnoughSummary]: source[FM.epicDoneEnoughSummary] ?? plan.epicDoneEnoughSummary,
        [FM.epicDoneEnoughAt]: source[FM.epicDoneEnoughAt] ?? plan.epicDoneEnoughAt,
        [RESOURCE_METADATA_KEYS.dependencyState]: plan.dependencyStates?.length
            ? plan.dependencyStates.map(/** @param {any} entry */ (entry) =>
                `${entry.dependency}: ${entry.state}${entry.status ? ` (${entry.status})` : ""}`
            )
            : undefined,
        [RESOURCE_METADATA_KEYS.repairParent]: plan.hierarchyRole === "orphan-child"
            ? plan.orphanReason || `parentPlan ${plan.parentPlan} does not resolve to a loaded Epic.`
            : undefined,
    };
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function stringifyMetadataValue(value) {
    if (Array.isArray(value)) return value.length ? value.map(stringifyMetadataValue).join(", ") : "[]";
    if (value && typeof value === "object") return JSON.stringify(value);
    return String(value);
}

/**
 * @param {string} key
 * @param {unknown} value
 */
function metadataValue(key, value) {
    if (key === FM.complexity && hasMetadataValue(value)) {
        return <ComplexityLabel complexity={String(value)} />;
    }
    return stringifyMetadataValue(value);
}

/**
 * @param {Record<string, unknown>} metadata
 * @param {string[]} keys
 * @param {Set<string>} renderedKeys
 */
function metadataEntries(metadata, keys, renderedKeys) {
    const entries = [];
    for (const key of keys) {
        renderedKeys.add(key);
        if (HIDDEN_METADATA_KEYS.has(key)) continue;
        const value = metadata[key];
        if (!hasMetadataValue(value)) continue;
        entries.push({ key, label: metadataLabel(key), value });
    }
    return entries;
}

/**
 * @param {Record<string, unknown>} metadata
 * @param {Set<string>} renderedKeys
 */
function additionalMetadataEntries(metadata, renderedKeys) {
    return Object.entries(metadata)
        .filter(([key, value]) => !renderedKeys.has(key) && !HIDDEN_METADATA_KEYS.has(key) && hasMetadataValue(value))
        .sort(([a], [b]) => {
            const aKnown = FRONT_MATTER_KEY_SET.has(a);
            const bKnown = FRONT_MATTER_KEY_SET.has(b);
            if (aKnown && bKnown) return FRONT_MATTER_KEYS_IN_ORDER.indexOf(a) - FRONT_MATTER_KEYS_IN_ORDER.indexOf(b);
            if (aKnown) return -1;
            if (bKnown) return 1;
            return a.localeCompare(b);
        })
        .map(([key, value]) => ({ key, label: metadataLabel(key), value }));
}

/** @param {{ title: string, entries: Array<{ key: string, label: string, value: unknown }> }} props */
function MetadataGroup({ title, entries }) {
    if (!entries.length) return null;
    return (
        <section className="metadata-group" aria-label={`${title} metadata`}>
            <h4 className="metadata-group-title">{title}</h4>
            <dl className="meta-list stacked">
                {entries.map((entry) => (
                    <div key={entry.key}>
                        <dt>{entry.label}</dt>
                        <dd>{metadataValue(entry.key, entry.value)}</dd>
                    </div>
                ))}
            </dl>
        </section>
    );
}

/** @param {{ plan: any }} props */
function DetailMetadata({ plan }) {
    const metadata = planMetadata(plan);
    const renderedKeys = new Set();
    const groups = METADATA_GROUPS.map((group) => ({
        title: group.title,
        entries: metadataEntries(metadata, group.keys, renderedKeys),
    })).filter((group) => group.entries.length);
    const additionalEntries = additionalMetadataEntries(metadata, renderedKeys);

    return (
        <div className="metadata-section">
            {groups.map((group) => <MetadataGroup key={group.title} title={group.title} entries={group.entries} />)}
            <MetadataGroup title="Additional metadata" entries={additionalEntries} />
        </div>
    );
}

/** @param {{ epic: any }} props */
function EpicSummary({ epic }) {
    const progress = epic.childProgress || { verified: 0, total: 0, active: 0, remaining: 0 };
    const health = epic.childHealth || {};
    const failed = health.failed?.length || 0;
    const held = health.held?.length || 0;
    const blocked = health.blocked?.length || 0;
    const missing = health.missingDependencies?.length || 0;

    return (
        <>
            <div className="progress-meter large" aria-label="Epic child progress">
                <span>{progress.verified}/{progress.total} child Plans verified</span>
                <span>{progress.active} active or implemented</span>
                <span>{progress.remaining} remaining</span>
                {failed ? <span>{failed} failed</span> : null}
                {held ? <span>{held} on hold</span> : null}
                {blocked ? <span>{blocked} blocked by dependencies</span> : null}
                {missing ? <span>{missing} with missing dependencies</span> : null}
            </div>
            <div className="badge-row health-summary">
                {epic.doneEnough
                    ? (
                        <span className="badge success">
                            Epic marked done enough{epic.epicDoneEnoughAt ? ` at ${epic.epicDoneEnoughAt}` : ""}
                        </span>
                    )
                    : null}
                {epic.status === "on_hold"
                    ? (
                        <span className="badge muted">
                            Epic on hold{epic.heldFromStatus ? ` from ${epic.heldFromStatus}` : ""}
                            {epic.heldAt ? ` at ${epic.heldAt}` : ""}
                        </span>
                    )
                    : null}
                {failed ? <span className="badge danger">{failed} failed child Plans</span> : null}
                {held ? <span className="badge muted">{held} child Plans on hold</span> : null}
                {blocked ? <span className="badge warning">{blocked} child Plans blocked</span> : null}
                {missing
                    ? <span className="badge warning">{missing} child Plans with missing dependencies</span>
                    : null}
            </div>
            {epic.doneEnough && epic.epicDoneEnoughSummary
                ? <p className="notice success">Done enough: {epic.epicDoneEnoughSummary}</p>
                : null}
            {epic.status === "on_hold"
                ? (
                    <p className="notice muted">
                        Held Epic only blocks child work in UI context; child statuses are shown unchanged.{" "}
                        {holdMetadata(epic)}
                    </p>
                )
                : null}
        </>
    );
}

/** @param {{ epic: any, url: URL | string }} props */
function EpicDetailSections({ epic, url }) {
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
        <>
            <section className="child-plan-section">
                <h3>Child health</h3>
                {failed || held || blocked || missing
                    ? (
                        <ul className="health-list">
                            {(health.failed || []).map(/** @param {any} child */ (child) => (
                                <li key={`failed-${child.planId}`}>
                                    <strong>Failed:</strong> {child.planName} {child.failureReason ||
                                        "needs recovery attention"}
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
                                                {child.dependencyStates.map(/** @param {any} entry */ (entry) => (
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
                    : <p className="empty">No failed, held, or dependency-blocked children.</p>}
            </section>
            <section className="child-plan-section">
                <h3>Child dependencies</h3>
                {childrenWithDependencies.length
                    ? (
                        <ul className="health-list dependency-health-list">
                            {childrenWithDependencies.map(/** @param {any} child */ (child) => (
                                <li key={`dependencies-${child.planId}`}>
                                    <strong>{child.planName}:</strong>{" "}
                                    {child.dependencyStates.map(dependencyLabel).join(
                                        ", ",
                                    )}
                                </li>
                            ))}
                        </ul>
                    )
                    : <p className="empty">No child FEATURE Plan dependencies declared.</p>}
            </section>
            <section className="child-plan-section">
                <h3>Child FEATURE Plans</h3>
                {visibleColumns.length
                    ? (
                        <div className="status-board child-status-board">
                            {visibleColumns.map(/** @param {any} column */ (column) => (
                                <BoardColumn key={column.status} column={column} url={url} />
                            ))}
                        </div>
                    )
                    : <p className="empty">No child FEATURE Plans are attached to this Epic.</p>}
            </section>
        </>
    );
}

/** @param {{ plan: any }} props */
function StaticPlanBody({ plan }) {
    const body = plan.body || "";
    const planBodyJson = JSON.stringify({ body }).replace(/</g, "\\u003c");
    return (
        <section className="plan-body-editor" data-editor-mode="read">
            <div data-plannotator-plan-body data-plan-id={plan.planId} data-plannotator-renderer="ssr-fallback">
                <script
                    type="application/json"
                    data-plannotator-plan-body-json
                    dangerouslySetInnerHTML={{ __html: planBodyJson }}
                />
                <div data-plannotator-plan-body-root>
                    <MarkdownView markdown={body} />
                </div>
            </div>
        </section>
    );
}

/** @param {{ plan: any }} props */
function StaticLifecycleActions({ plan }) {
    const actions = plan.actions || {};
    return (
        <section className="lifecycle-actions compact" aria-label="Lifecycle actions">
            <div className="lifecycle-action-list">
                {(actions.manualTargetOptions || []).map((/** @type {any} */ option) => (
                    <button
                        key={option.status}
                        type="button"
                        className="secondary-action lifecycle-action"
                        data-action-target-status={option.status}
                    >
                        Move to {option.label}
                    </button>
                ))}
                {actions.canPutOnHold
                    ? (
                        <button type="button" className="secondary-action lifecycle-action hold-action">
                            Put on hold
                        </button>
                    )
                    : null}
                {actions.canCloseWithoutVerification
                    ? (
                        <button type="button" className="danger-action lifecycle-action">
                            Close without verification
                        </button>
                    )
                    : null}
            </div>
        </section>
    );
}

/** @param {{ plan: any, url: URL | string, editIntent?: boolean, staticRender?: boolean }} props */
export function PlanDetail({ plan, url, editIntent = false, staticRender = false }) {
    const isEpic = isEpicDetail(plan);
    const canEditBody = plan.capabilities?.bodyEditing !== false && !isEpic;
    const editHref = workspaceHref(`/plans/${encodeURIComponent(plan.planId)}?edit=body`, url);
    const closeHref = boardHrefForPlanStatus(plan.status, url);
    return (
        <article className="detail" data-plan-id={plan.planId} data-selected-tab={tabForPlanStatus(plan.status)}>
            <header className="page-header detail-header split-header">
                <div>
                    <div className="detail-title-row">
                        <a className="detail-back-link" href={closeHref}>{"< Back"}</a>
                        <div className="detail-title-group">
                            <h2>{plan.planName}</h2>
                            <span className={`status status-${plan.status}`}>{plan.status}</span>
                        </div>
                        <a className="detail-close-link" href={closeHref} aria-label="Close plan detail">X</a>
                    </div>
                    <p>{plan.summary || "No summary provided."}</p>
                    {isEpic ? <EpicSummary epic={plan} /> : null}
                    {!isEpic && plan.status === "on_hold" ? <p className="notice muted">{holdMetadata(plan)}</p> : null}
                    {plan.hierarchyRole === "orphan-child" || plan.blockedByDependencies
                        ? (
                            <div className="detail-actions" aria-label="Plan warnings">
                                {plan.hierarchyRole === "orphan-child"
                                    ? <span className="badge warning">Missing parent Epic</span>
                                    : null}
                                {plan.blockedByDependencies
                                    ? <span className="badge warning">Dependency blocked</span>
                                    : null}
                            </div>
                        )
                        : null}
                </div>
            </header>
            <section className="detail-grid">
                <div>
                    {staticRender
                        ? <StaticPlanBody plan={plan} />
                        : <PlanBodyEditor plan={plan} initialEdit={canEditBody && editIntent} />}
                    {isEpic ? <EpicDetailSections epic={plan} url={url} /> : null}
                </div>
                <aside className="detail-sidebar">
                    <div className="detail-sidebar-actions" aria-label="Plan detail actions">
                        {canEditBody && !editIntent
                            ? <a className="primary-action detail-sidebar-edit" href={editHref}>Edit</a>
                            : null}
                        {staticRender
                            ? <StaticLifecycleActions plan={plan} />
                            : <PlanLifecycleActions plan={plan} compact epic={isEpic} />}
                    </div>
                    <h3>Metadata</h3>
                    <DetailMetadata plan={plan} />
                </aside>
            </section>
        </article>
    );
}

export { DetailMetadata };
