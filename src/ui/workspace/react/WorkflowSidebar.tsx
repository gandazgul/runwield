// @ts-nocheck: shared browser renderer accepts server payloads from JS and Astro.

import { Fragment } from "react";

export function workflowActionHref(payload, action) {
    if (!action) return "";
    if (
        (action.kind === "open_session" || action.kind === "resume" || action.kind === "recover" ||
            action.kind === "answer_agent") && payload.sessionHref
    ) {
        return action.kind === "answer_agent" && payload.interactionHref
            ? payload.interactionHref
            : payload.sessionHref;
    }
    if ((action.kind === "review_plan" || action.kind === "review_code") && payload.reviewHref) {
        return payload.reviewHref;
    }
    return payload.planHref || "";
}

export function WorkflowSidebar(
    { presentation, payload = {}, title = "Plan workflow", embedded = false, onAction = null },
) {
    const actionHref = workflowActionHref(payload, presentation.action);
    const stageLabels = new Map(presentation.stages.map((stage) => [stage.id, stage.label]));
    const repairReturns = new Map(
        presentation.connections?.filter((connection) => connection.kind === "repair_return")
            .map((connection) => [connection.from, connection.to]) || [],
    );
    return (
        <aside
            className={`rw-plan-home-workflow${embedded ? " rw-plan-home-workflow-embedded" : ""}`}
            aria-label={title}
        >
            {!embedded && (
                <header>
                    <h2>{title}</h2>
                    {presentation.epic ? <p>{presentation.epic}</p> : null}
                </header>
            )}
            {embedded && presentation.epic ? <p className="session-context-empty">{presentation.epic}</p> : null}
            <ol
                className="session-workflow-stage-list workflow-diagram workflow-diagram-connected"
                aria-label="Workflow stages"
            >
                {presentation.stages.map((stage) => {
                    const returnTarget = repairReturns.get(stage.id);
                    return (
                        <Fragment key={stage.id}>
                            <li
                                data-state={stage.state}
                                aria-current={stage.current ? "step" : undefined}
                            >
                                <span>{stage.label}</span>
                                {!["current", "upcoming"].includes(stage.state) && <strong>{stage.state}</strong>}
                                {stage.detail && <p>{stage.detail}</p>}
                            </li>
                            {returnTarget
                                ? (
                                    <li
                                        className="workflow-repair-return"
                                        key={`${stage.id}-${returnTarget}`}
                                        data-state="repair-return"
                                    >
                                        <span>
                                            {stageLabels.get(stage.id)} returns to{" "}
                                            {stageLabels.get(returnTarget) || returnTarget}
                                        </span>
                                        <strong>repair path</strong>
                                        <p>After repair, continue the failed check.</p>
                                    </li>
                                )
                                : null}
                        </Fragment>
                    );
                })}
            </ol>
            {presentation.blocker && presentation.blocker !== presentation.currentStage?.detail
                ? (
                    <section className="workflow-next-card" aria-label="Workflow blocker">
                        <h3>Blocked by</h3>
                        <p>{presentation.blocker}</p>
                    </section>
                )
                : null}
            {presentation.action
                ? (
                    <section className="workflow-next-card" aria-label="Workflow action">
                        <h3>Next action</h3>
                        <p>{presentation.action.detail}</p>
                        {onAction && ["run", "resume", "recover"].includes(presentation.action.kind)
                            ? (
                                <button
                                    className="rw-toolbar-button"
                                    type="button"
                                    onClick={() => onAction(presentation.action)}
                                >
                                    {presentation.action.label}
                                </button>
                            )
                            : actionHref
                            ? <a className="rw-toolbar-button" href={actionHref}>{presentation.action.label}</a>
                            : null}
                    </section>
                )
                : null}
        </aside>
    );
}
