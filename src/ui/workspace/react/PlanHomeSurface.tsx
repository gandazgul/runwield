// @ts-nocheck: Workspace React islands compile TSX, but this module uses JSDoc-style JavaScript only.

import { useEffect, useMemo, useState } from "react";
import { ArtifactReadSurface } from "./ArtifactReadSurface.tsx";
import { WorkflowSidebar } from "./WorkflowSidebar.tsx";
import { buildWorkflowPresentation } from "../../../shared/workflow/workflow-presentation.ts";

function ownerCookie(name) {
    return document.cookie.split("; ").find((value) => value.startsWith(`${name}=`))?.split("=").slice(1).join("=") ||
        "";
}

async function ownerFetch(url, options = {}) {
    const headers = new Headers(options.headers || {});
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
    headers.set("x-runwield-csrf", decodeURIComponent(ownerCookie("rw_owner_csrf")));
    const response = await fetch(url, { ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) throw new Error(payload.error || `Request failed with ${response.status}`);
    return payload;
}

function progressFacts(progress) {
    return Array.isArray(progress?.progressFacts) ? progress.progressFacts : [];
}

function valueFromProgress(payload, progress, field) {
    return progress && Object.hasOwn(progress, field) ? progress[field] : payload[field];
}

function buildPresentation(payload, progress) {
    return buildWorkflowPresentation({
        planName: payload.title || payload.planName || payload.planId,
        epicName: payload.epicName || payload.parentPlan,
        intent: payload.classification,
        classification: payload.classification,
        projectPlanType: payload.type || payload.attrs?.type,
        status: progress?.plan?.status || payload.status,
        progressFacts: progressFacts(progress || payload.workflow),
        degradedMessage: typeof progress?.degraded?.message === "string"
            ? progress.degraded.message
            : typeof payload.workflow?.degradedMessage === "string"
            ? payload.workflow.degradedMessage
            : "",
        sessionState: typeof progress?.session?.state === "string"
            ? progress.session.state
            : typeof payload.workflow?.sessionState === "string"
            ? payload.workflow.sessionState
            : "",
        hasWorkingSession: Boolean(
            valueFromProgress(payload, progress, "sessionHref") || progress?.session?.runwieldSessionId,
        ),
        hasLiveQuestion: Boolean(valueFromProgress(payload, progress, "interactionHref")),
        hasPlanReview: valueFromProgress(payload, progress, "reviewKind") === "plan",
        hasCodeReview: valueFromProgress(payload, progress, "reviewKind") === "code",
        canRun: Boolean(valueFromProgress(payload, progress, "planWorkflowUrl")),
        canResume: Boolean(
            valueFromProgress(payload, progress, "planWorkflowUrl") &&
                valueFromProgress(payload, progress, "sessionHref"),
        ),
        canRecover: Boolean(valueFromProgress(payload, progress, "canRecover")),
    });
}

export function PlanHomeSurface({ payload, presentation = "workspace" }) {
    const [progress, setProgress] = useState(payload.workflow || null);
    const [message, setMessage] = useState("");
    useEffect(() => {
        if (!payload.progressApiUrl) return;
        let cancelled = false;
        let inFlight = false;
        async function refresh() {
            if (inFlight) return;
            inFlight = true;
            try {
                const next = await ownerFetch(payload.progressApiUrl, { method: "GET" });
                if (!cancelled) setProgress(next);
            } catch (error) {
                if (!cancelled) {
                    setProgress((current) => ({ ...current, degraded: { message: error.message || String(error) } }));
                }
            } finally {
                inFlight = false;
            }
        }
        refresh();
        const timer = setInterval(refresh, 5000);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [payload.progressApiUrl]);

    async function runAction(action) {
        setMessage(`${action.label} is starting…`);
        try {
            const actionPayload = {
                requestId: crypto.randomUUID(),
                expectedGeneration: progress?.expectedGeneration ?? payload.expectedGeneration,
                expectedCurrentSegmentId: progress?.expectedCurrentSegmentId ?? payload.expectedCurrentSegmentId,
                planId: payload.planId,
                action: action.kind,
            };
            const workflowUrl = progress?.planWorkflowUrl || payload.planWorkflowUrl;
            if (["run", "resume", "recover"].includes(action.kind) && workflowUrl) {
                await ownerFetch(workflowUrl, { method: "POST", body: JSON.stringify(actionPayload) });
            }
            if (progress?.sessionHref || payload.sessionHref) {
                location.assign(progress?.sessionHref || payload.sessionHref);
            }
        } catch (error) {
            setMessage(error.message || String(error));
        }
    }

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
    const workflow = useMemo(() => buildPresentation(payload, progress), [payload, progress]);

    return (
        <div className="rw-plan-home-shell">
            <div className="rw-plan-home-reader">
                {message ? <p className="session-surface-status" role="status">{message}</p> : null}
                <ArtifactReadSurface payload={artifactPayload} presentation={presentation} />
            </div>
            <WorkflowSidebar
                presentation={workflow}
                payload={{ ...payload, ...(progress || {}) }}
                onAction={runAction}
            />
        </div>
    );
}
