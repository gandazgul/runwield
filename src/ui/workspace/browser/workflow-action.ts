/** Submit a workflow action, including the existing Resume Check warning confirmation. */
type WorkflowActionRequest = {
    requestId: string;
    planId: string;
    action: string;
    expectedGeneration?: number | null;
    expectedCurrentSegmentId?: string | null;
    expectedRevision?: string | null;
    acceptResumeWarnings?: boolean;
};

type WorkflowActionResponse = {
    error?: string;
    reviewUrl?: string;
    operationId?: string;
    status?: string;
    reason?: string;
    canceled?: boolean;
    requiresConfirmation?: boolean;
    resumeCheck?: { warnings: string[] };
    result?: { kind: string; message: string };
};
export async function submitWorkflowAction(
    url: string,
    request: WorkflowActionRequest,
): Promise<WorkflowActionResponse> {
    const csrf = document.cookie.split("; ").find((value) => value.startsWith("rw_owner_csrf="))
        ?.split("=").slice(1).join("=") || "";
    const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-runwield-csrf": decodeURIComponent(csrf) },
        body: JSON.stringify(request),
    });
    const payload = await response.json() as WorkflowActionResponse;
    if (payload.requiresConfirmation && !request.acceptResumeWarnings) {
        if (!globalThis.confirm(`${payload.resumeCheck?.warnings.join("\n") || payload.error}\n\nResume from hold?`)) {
            return { canceled: true };
        }
        return await submitWorkflowAction(url, {
            ...request,
            requestId: crypto.randomUUID(),
            acceptResumeWarnings: true,
        });
    }
    if (!response.ok || payload.error || (payload.result && payload.result.kind !== "success")) {
        throw new Error(payload.error || payload.result?.message || `Request failed with ${response.status}`);
    }
    return payload;
}
