/** Submit a workflow action, including the existing Resume Check warning confirmation. */
/**
 * @typedef {Object} WorkflowActionRequest
 * @property {string} requestId
 * @property {string} planId
 * @property {string} action
 * @property {number | null} [expectedGeneration]
 * @property {string | null} [expectedCurrentSegmentId]
 * @property {string | null} [expectedRevision]
 * @property {boolean} [acceptResumeWarnings]
 */
/**
 * @typedef {Object} WorkflowActionResponse
 * @property {string} [error]
 * @property {string} [reviewUrl]
 * @property {string} [operationId]
 * @property {string} [status]
 * @property {string} [reason]
 * @property {boolean} [canceled]
 * @property {boolean} [requiresConfirmation]
 * @property {{ warnings: string[] }} [resumeCheck]
 * @property {{ kind: string, message: string }} [result]
 */
/** @param {string} url @param {WorkflowActionRequest} request @returns {Promise<WorkflowActionResponse>} */
export async function submitWorkflowAction(url, request) {
    const csrf = document.cookie.split("; ").find((value) => value.startsWith("rw_owner_csrf="))
        ?.split("=").slice(1).join("=") || "";
    const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-runwield-csrf": decodeURIComponent(csrf) },
        body: JSON.stringify(request),
    });
    /** @type {WorkflowActionResponse} */
    const payload = await response.json();
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
