// @ts-nocheck: Workspace React islands compile TSX, but this module uses JSDoc-style JavaScript only.

import { useMemo } from "react";
import { ArtifactReadSurface } from "./ArtifactReadSurface.tsx";
import { buildWorkflowPresentation } from "../../../shared/workflow/workflow-presentation.ts";

function workflowActionHref(payload, action) {
    if (!action) return "";
    if (
        (action.kind === "open_session" || action.kind === "resume" || action.kind === "recover") && payload.sessionHref
    ) {
        return payload.sessionHref;
    }
    if (
        (action.kind === "review_plan" || action.kind === "review_code" || action.kind === "answer_agent") &&
        payload.reviewHref
    ) {
        return payload.reviewHref;
    }
    return payload.planHref || "";
}

function PlanWorkflowSidebar({ payload }) {
    const presentation = useMemo(() =>
        buildWorkflowPresentation({
            planName: payload.title || payload.planName || payload.planId,
            epicName: payload.epicName || payload.parentPlan,
            intent: payload.classification,
            classification: payload.classification,
            status: payload.status,
            stages: Array.isArray(payload.workflow?.stages) ? payload.workflow.stages : undefined,
            degradedMessage: typeof payload.workflow?.degradedMessage === "string"
                ? payload.workflow.degradedMessage
                : "",
            sessionState: typeof payload.workflow?.sessionState === "string" ? payload.workflow.sessionState : "",
            hasWorkingSession: Boolean(payload.sessionHref),
        }), [payload]);
    const actionHref = workflowActionHref(payload, presentation.action);

    return (
        <aside className="rw-plan-home-workflow" aria-label="Plan workflow">
            <header>
                <h2>Plan workflow</h2>
                {presentation.epic ? <p>{presentation.epic}</p> : null}
            </header>
            <ol className="session-workflow-stage-list workflow-diagram" aria-label="Workflow stages">
                {presentation.stages.map((stage) => (
                    <li key={stage.id} data-state={stage.state} aria-current={stage.current ? "step" : undefined}>
                        <span>{stage.label}</span>
                        <strong>{stage.state}</strong>
                        <p>{stage.detail}</p>
                    </li>
                ))}
            </ol>
            {presentation.blocker
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
                        {actionHref
                            ? <a className="rw-toolbar-button" href={actionHref}>{presentation.action.label}</a>
                            : null}
                    </section>
                )
                : null}
        </aside>
    );
}

export function PlanHomeSurface({ payload, presentation = "workspace" }) {
    const artifactPayload = useMemo(() => ({
        markdown: payload.markdown || payload.body || "",
        mode: payload.mode || "dev",
        artifactKind: "plan",
        title: payload.title || payload.planName || "Plan",
        artifactPath: payload.artifactPath,
        returnHref: payload.returnHref || "/",
        returnLabel: payload.returnLabel || "Back",
        imageBaseDir: payload.imageBaseDir,
    }), [payload]);

    return (
        <div className="rw-plan-home-shell">
            <div className="rw-plan-home-reader">
                <ArtifactReadSurface payload={artifactPayload} presentation={presentation} />
            </div>
            <PlanWorkflowSidebar payload={payload} />
        </div>
    );
}
