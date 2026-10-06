/** Durable execution ownership, including an explicit clear tombstone. */
export const EXECUTION_WORKFLOW_CUSTOM_TYPE = "runwield.execution_workflow";

/**
 * @typedef {Object} ExecutionWorkflowSnapshot
 * @property {1} version
 * @property {import('../types.js').ActiveExecutionWorkflow | null} workflow
 */
/**
 * @typedef {Object} ExecutionWorkflowEntry
 * @property {string} type
 * @property {string} [customType]
 * @property {ExecutionWorkflowSnapshot} [data]
 */
/**
 * @param {import('./hosted-session.js').MinimalSessionManagerLike | null} manager
 * @returns {ExecutionWorkflowSnapshot | undefined}
 */
export function readExecutionWorkflowSnapshot(manager) {
    const entries = manager?.getBranch?.() || manager?.getEntries?.() || [];
    for (let i = entries.length - 1; i >= 0; i--) {
        const entry = /** @type {ExecutionWorkflowEntry} */ (entries[i]);
        if (entry.type !== "custom" || entry.customType !== EXECUTION_WORKFLOW_CUSTOM_TYPE) continue;
        // A malformed marker also forbids legacy inference.
        const data = entry.data;
        if (data?.version !== 1 || !data.workflow) return { version: 1, workflow: null };
        const workflow = data.workflow;
        if (
            (typeof workflow.planName !== "string" ||
                (!workflow.planName && workflow.triageMeta?.classification !== "QUICK_FIX")) ||
            !["engineer", "frontend-engineer"].includes(workflow.executionAgent)
        ) {
            return { version: 1, workflow: null };
        }
        return { version: 1, workflow };
    }
    return undefined;
}
/** @param {import('./hosted-session.js').HostedSession} session */
export function recordExecutionWorkflowSnapshot(session) {
    const manager = session.getRootSessionManager();
    if (!manager) return;
    if (session.getManagedMetadata()) {
        const capability = session.getManagedOperationCapability();
        if (!capability) throw new Error("managed_operation_required");
        capability.assertLive();
    }
    appendExecutionWorkflowSnapshot(manager, session.getActiveExecutionWorkflow());
}

/**
 * Append to a transcript while its caller owns the Session writer lock.
 * @param {import('./hosted-session.js').MinimalSessionManagerLike} manager
 * @param {import('../types.js').ActiveExecutionWorkflow | null} workflow
 */
export function appendExecutionWorkflowSnapshot(manager, workflow) {
    manager.appendCustomEntry?.(EXECUTION_WORKFLOW_CUSTOM_TYPE, { version: 1, workflow });
}
