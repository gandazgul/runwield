import { BoardColumn } from "./BoardColumn.jsx";
import { DetailMetadata, FrontMatterSummary } from "./PlanDetail.jsx";
import { MarkdownView } from "./MarkdownView.jsx";

/** @param {{ epic: any, url: URL }} props */
export function EpicDetail({ epic, url }) {
    const progress = epic.childProgress || { verified: 0, total: 0, active: 0, remaining: 0, failed: 0 };
    const failed = epic.childHealth?.failed?.length || 0;
    const held = epic.childHealth?.held?.length || 0;
    const visibleColumns = (epic.childColumns || []).filter(
        (/** @type {any} */ column) => column.cards.length || column.orphanChildren.length,
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
                </div>
            </header>
            <section class="detail-grid">
                <div>
                    <h3>Epic body</h3>
                    <MarkdownView markdown={epic.body || ""} />
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
