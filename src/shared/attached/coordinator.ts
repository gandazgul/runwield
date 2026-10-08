/**
 * @module shared/attached/coordinator
 * The Attached Workflow Coordinator: a sibling runtime to `SessionRuntime` (ADR-014).
 *
 * Each operation is one short step: load the Attached Workflow Record, check it, make
 * at most one change, save, return. Nothing lives in process memory, so a fresh Core
 * process continues where the last one stopped. The coordinator never creates a
 * Session, calls a model, or stores a host transcript.
 *
 * Operations cover activation and Triage. A PLANNED_CHANGE outcome leaves the workflow
 * waiting for planning; any other Routing Intent closes it.
 */

import { createHash } from "node:crypto";
import { VERSION } from "../version.js";
import { normalizeTriageOutcome } from "../workflow/triage-outcome.ts";
import {
    type ActivateEnvelope,
    ATTACHED_TRIAGE_CONTRACT_VERSION,
    type AttachedJsonValue,
    type AttachedNextAction,
    type AttachedOperationName,
    type AttachedOperationResult,
    type AttachedRejection,
    type AttachedRejectionCode,
    type AttachedWorkflowView,
    MAX_ATTACHED_INPUT_BYTES,
    parseActivateInput,
    parseStatusInput,
    parseSubmitInput,
    type ProjectMovedRecovery,
    type StatusEnvelope,
    type SubmitEnvelope,
} from "./operations.ts";
import {
    type AttachedWorkflowLocation,
    type AttachedWorkflowRecord,
    loadAttachedWorkflowRecord,
    locateAttachedWorkflows,
    writeAttachedWorkflowRecord,
} from "./record-store.ts";

type Decision = { result: AttachedOperationResult; next?: AttachedWorkflowRecord };

function nextActionFor(record: AttachedWorkflowRecord): AttachedNextAction {
    if (record.state === "triaging" && record.pendingAction) return { kind: "triage", ...record.pendingAction };
    if (record.state === "awaiting_planning") return { kind: "plan" };
    return { kind: "return_to_host", reason: "unsupported_in_preview" };
}

function viewOf(record: AttachedWorkflowRecord, recovery: ProjectMovedRecovery | null = null): AttachedWorkflowView {
    return {
        workflowId: record.workflowId,
        revision: record.revision,
        state: record.state,
        nextAction: nextActionFor(record),
        triageOutcome: record.triageOutcome,
        closure: record.closure,
        recovery,
    };
}

function rejected(
    operation: AttachedOperationName,
    rejection: AttachedRejection,
    record?: AttachedWorkflowRecord,
): AttachedOperationResult {
    return { ok: false, operation, rejection, ...(record ? { workflow: viewOf(record) } : {}) };
}

function rejection(code: AttachedRejectionCode, message: string): AttachedRejection {
    return { code, message };
}

function movedRecovery(location: AttachedWorkflowLocation, record: AttachedWorkflowRecord): ProjectMovedRecovery {
    return { case: "project_moved", recordedProjectRoot: record.projectRoot, currentProjectRoot: location.projectRoot };
}

/** One workflow per activation operation, so a retried activation finds its own record. */
function workflowIdFor(projectRoot: string, operationId: string): string {
    const hex = createHash("sha256").update(`${projectRoot}\n${operationId}`).digest("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** Save `decision.next`; on a lost race, decide again against the record that won. */
async function commit(
    location: AttachedWorkflowLocation,
    operation: AttachedOperationName,
    expectedRevision: number | null,
    decision: Decision,
    decide: (current: AttachedWorkflowRecord) => Decision,
): Promise<AttachedOperationResult> {
    if (!decision.next) return decision.result;
    const written = await writeAttachedWorkflowRecord(location, decision.next, expectedRevision);
    if (written.status === "written") return decision.result;
    if (written.status === "busy") {
        return rejected(operation, rejection("workflow_busy", "Another RunWield process holds this workflow. Retry."));
    }
    if (!written.current) return rejected(operation, rejection("workflow_not_found", "The workflow no longer exists."));
    return decide(written.current).result;
}

export async function activate(envelope: ActivateEnvelope): Promise<AttachedOperationResult> {
    const location = locateAttachedWorkflows(envelope.projectRoot);
    const workflowId = workflowIdFor(location.projectRoot, envelope.operationId);
    const replay = (current: AttachedWorkflowRecord): Decision => {
        const saved = current.acceptedOperations[envelope.operationId];
        return {
            result: saved?.result ??
                rejected("activate", rejection("revision_conflict", "This workflow already exists."), current),
        };
    };

    const loaded = await loadAttachedWorkflowRecord(location, workflowId);
    if (loaded.status !== "missing") return replay(loaded.record).result;

    const now = new Date().toISOString();
    const evidence = { ...envelope.evidence, coreVersion: VERSION };
    const record: AttachedWorkflowRecord = {
        schemaVersion: 1,
        workflowId,
        revision: 1,
        projectRoot: location.projectRoot,
        request: { text: envelope.payload.requestText, hostRequestId: envelope.payload.hostRequestId },
        evidence,
        state: "triaging",
        pendingAction: {
            actionId: crypto.randomUUID(),
            role: "router",
            contractVersion: ATTACHED_TRIAGE_CONTRACT_VERSION,
        },
        acceptedOperations: {},
        triageOutcome: null,
        closure: null,
        createdAt: now,
        updatedAt: now,
    };
    const result: AttachedOperationResult = { ok: true, operation: "activate", workflow: viewOf(record) };
    record.acceptedOperations[envelope.operationId] = { result, evidence, acceptedAt: now };
    return await commit(location, "activate", null, { result, next: record }, replay);
}

export async function submitOutcome(envelope: SubmitEnvelope): Promise<AttachedOperationResult> {
    const location = locateAttachedWorkflows(envelope.projectRoot);
    const decide = (current: AttachedWorkflowRecord): Decision => {
        const saved = current.acceptedOperations[envelope.operationId];
        if (saved) return { result: saved.result };
        if (current.revision !== envelope.expectedRevision) {
            return {
                result: rejected(
                    "submit",
                    rejection("revision_conflict", `The workflow is at revision ${current.revision}.`),
                    current,
                ),
            };
        }
        if (current.state !== "triaging" || current.pendingAction?.actionId !== envelope.payload.actionId) {
            return {
                result: rejected(
                    "submit",
                    rejection("action_superseded", "This action is not the workflow's pending action."),
                    current,
                ),
            };
        }
        const outcome = normalizeTriageOutcome(envelope.payload.outcome);
        if (!outcome) {
            return {
                result: rejected(
                    "submit",
                    rejection(
                        "invalid_outcome",
                        "The Triage outcome needs a valid routingIntent, complexity, and summary.",
                    ),
                    current,
                ),
            };
        }

        const now = new Date().toISOString();
        const plannedChange = outcome.routingIntent === "PLANNED_CHANGE";
        const next: AttachedWorkflowRecord = {
            ...current,
            revision: current.revision + 1,
            state: plannedChange ? "awaiting_planning" : "closed",
            pendingAction: null,
            triageOutcome: outcome,
            closure: plannedChange ? null : { reason: "unsupported_in_preview", routingIntent: outcome.routingIntent },
            updatedAt: now,
        };
        const result: AttachedOperationResult = { ok: true, operation: "submit", workflow: viewOf(next) };
        next.acceptedOperations = {
            ...current.acceptedOperations,
            [envelope.operationId]: {
                result,
                evidence: { ...envelope.evidence, coreVersion: VERSION },
                acceptedAt: now,
            },
        };
        return { result, next };
    };

    const loaded = await loadAttachedWorkflowRecord(location, envelope.workflowId);
    if (loaded.status === "missing") {
        return rejected("submit", rejection("workflow_not_found", "No Attached Workflow has this workflowId."));
    }
    if (loaded.status === "moved") {
        return rejected(
            "submit",
            rejection("project_moved", `This workflow belongs to ${loaded.record.projectRoot}.`),
        );
    }
    return await commit(location, "submit", loaded.record.revision, decide(loaded.record), decide);
}

export async function readStatus(envelope: StatusEnvelope): Promise<AttachedOperationResult> {
    const location = locateAttachedWorkflows(envelope.projectRoot);
    const loaded = await loadAttachedWorkflowRecord(location, envelope.workflowId);
    if (loaded.status === "missing") {
        return rejected("status", rejection("workflow_not_found", "No Attached Workflow has this workflowId."));
    }
    const recovery = loaded.status === "moved" ? movedRecovery(location, loaded.record) : null;
    return { ok: true, operation: "status", workflow: viewOf(loaded.record, recovery) };
}

function runParsedOperation(
    name: AttachedOperationName,
    projectRoot: string,
    input: AttachedJsonValue | undefined,
): Promise<AttachedOperationResult> {
    if (name === "activate") {
        const parsed = parseActivateInput(projectRoot, input);
        return parsed.ok ? activate(parsed.envelope) : Promise.resolve(rejected(name, parsed.rejection));
    }
    if (name === "submit") {
        const parsed = parseSubmitInput(projectRoot, input);
        return parsed.ok ? submitOutcome(parsed.envelope) : Promise.resolve(rejected(name, parsed.rejection));
    }
    const parsed = parseStatusInput(projectRoot, input);
    return parsed.ok ? readStatus(parsed.envelope) : Promise.resolve(rejected(name, parsed.rejection));
}

/**
 * The single entry both carriers use: JSON text in, one result object out. Because the
 * CLI and MCP carriers both pass text here, the same input gives the same result.
 */
export async function runAttachedOperation(
    name: AttachedOperationName,
    projectRoot: string,
    inputText: string,
): Promise<AttachedOperationResult> {
    if (new TextEncoder().encode(inputText).length > MAX_ATTACHED_INPUT_BYTES) {
        return rejected(name, rejection("payload_too_large", `Input exceeds ${MAX_ATTACHED_INPUT_BYTES} bytes.`));
    }
    let input: AttachedJsonValue | undefined;
    try {
        input = JSON.parse(inputText);
    } catch {
        input = undefined;
    }
    return await runParsedOperation(name, projectRoot, input);
}
