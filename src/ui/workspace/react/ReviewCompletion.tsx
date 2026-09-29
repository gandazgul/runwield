import { useEffect, useRef } from "react";
import { CompletionOverlay } from "@plannotator/ui/components/CompletionOverlay.tsx";

interface ReviewCompletionPayload {
    mode?: string;
    projectId?: string;
    runwieldSessionId?: string;
    reviewContext?: { sessionHref?: string };
}

interface ReviewCompletionProps {
    payload: ReviewCompletionPayload;
    submitted: string | null | false;
    title: string;
    subtitle: string;
    agentLabel: string;
}

/** Workspace keeps its tab; standalone reviews retain Plannotator's close preference. */
export function ReviewCompletion({ payload, submitted, ...copy }: ReviewCompletionProps) {
    const workspace = payload.mode === "workspace";
    const sessionHref = payload.reviewContext?.sessionHref ||
        (payload.projectId && payload.runwieldSessionId
            ? `/projects/${encodeURIComponent(payload.projectId)}/sessions/${
                encodeURIComponent(payload.runwieldSessionId)
            }`
            : "/");
    const returned = useRef(false);
    useEffect(() => {
        if (!workspace || !submitted || returned.current) return;
        returned.current = true;
        const event = new CustomEvent("runwield:workspace-navigate", {
            cancelable: true,
            detail: { href: sessionHref, history: "replace" },
        });
        if (document.dispatchEvent(event)) globalThis.location.replace(sessionHref);
    }, [workspace, submitted, sessionHref]);

    // Never mount the auto-close hook in Workspace, even with a saved immediate-close preference.
    if (workspace) return null;
    return (
        <CompletionOverlay
            {...copy}
            submitted={submitted ? (submitted.startsWith("approved") ? "approved" : "feedback") : null}
        />
    );
}
