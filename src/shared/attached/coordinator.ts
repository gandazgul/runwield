/**
 * @module shared/attached/coordinator
 * The Attached Workflow Coordinator: a sibling runtime to `SessionRuntime` (ADR-014).
 *
 * Each operation is one short step: load the Attached Workflow Record, check it, make
 * at most one change, save, return. Nothing lives in process memory, so a fresh Core
 * process continues where the last one stopped. The coordinator never starts a model
 * turn and never stores a host transcript.
 *
 * Operations cover activation, Triage, and Plan submission. A PLANNED_CHANGE outcome
 * hands the host the Planner role; any other Routing Intent closes the workflow.
 */

import { createHash } from "node:crypto";
import { isAbsolute, join, relative } from "@std/path";
import {
    canonicalizeStoredPlanName,
    ensurePlanIdentity,
    isHiddenPlanName,
    resolvePlanExecutionPolicy,
    updatePlanFrontMatter,
} from "../../plan-store.js";
import type { PlanFrontMatter } from "../../plan-store.js";
import { assertNotReservedEpicArtifactPlanName } from "../epic-artifacts.ts";
import { enterProjectRuntime, resolveProjectRuntimeLayout } from "../project-runtime-layout.ts";
import { runWieldGitignoreNeedsUpdate } from "../runwield-owned-paths.ts";
import { VERSION } from "../version.js";
import { resolveWorkflowPlanLocation } from "../workflow/plan-location.ts";
import { normalizeTriageOutcome, type TriageOutcome } from "../workflow/triage-outcome.ts";
import {
    type ActivateEnvelope,
    ATTACHED_PLANNER_CONTRACT_VERSION,
    ATTACHED_TRIAGE_CONTRACT_VERSION,
    type AttachedJsonValue,
    type AttachedNextAction,
    type AttachedOperationName,
    type AttachedOperationResult,
    type AttachedPlanReference,
    type AttachedRejection,
    type AttachedRejectionCode,
    type AttachedWorkflowView,
    MAX_ATTACHED_INPUT_BYTES,
    parseActivateInput,
    parsePlanWrittenInput,
    parseStatusInput,
    parseTriageReportInput,
    type PlanWrittenEnvelope,
    type PlanWrittenPayload,
    type ProjectMovedRecovery,
    type StatusEnvelope,
    type TriageReportEnvelope,
    type WorkflowOperationEnvelope,
} from "./operations.ts";
import {
    type AttachedWorkflowLocation,
    type AttachedWorkflowRecord,
    loadAttachedWorkflowRecord,
    locateAttachedWorkflows,
    transactAttachedWorkflowRecord,
    writeAttachedWorkflowRecord,
} from "./record-store.ts";
import { resolveAttachedRoleInstructions } from "./role-instructions.ts";

type Decision = { result: AttachedOperationResult; next?: AttachedWorkflowRecord };
type Decide = (current: AttachedWorkflowRecord) => Promise<Decision>;
type RecordChanges = Pick<AttachedWorkflowRecord, "state" | "pendingAction"> & Partial<AttachedWorkflowRecord>;

/** Repository paths that `plan_written` creates when it first enters the project runtime. */
async function projectSetupFor(projectRoot: string): Promise<string[]> {
    const internalPath = relative(projectRoot, resolveProjectRuntimeLayout(projectRoot).primary.internalRoot);
    const setup: string[] = [];
    const insideRepository = !internalPath.startsWith("..") && !isAbsolute(internalPath);
    if (insideRepository && !await Deno.stat(join(projectRoot, internalPath)).then(() => true, () => false)) {
        setup.push(`${internalPath}/`);
    }
    if (await runWieldGitignoreNeedsUpdate(projectRoot)) setup.push(".gitignore");
    return setup;
}

async function nextActionFor(record: AttachedWorkflowRecord): Promise<AttachedNextAction> {
    const pending = record.pendingAction;
    if (record.state === "triaging" && pending) return { kind: "triage", ...pending };
    if (record.state === "awaiting_planning" && pending) {
        return { kind: "plan", ...pending, projectSetup: await projectSetupFor(record.projectRoot) };
    }
    if (record.state === "plan_submitted" && record.plan) {
        return { kind: "plan_submitted", planName: record.plan.planName };
    }
    return { kind: "return_to_host", reason: "unsupported_in_preview" };
}

async function viewOf(
    record: AttachedWorkflowRecord,
    recovery: ProjectMovedRecovery | null = null,
): Promise<AttachedWorkflowView> {
    return {
        workflowId: record.workflowId,
        revision: record.revision,
        state: record.state,
        nextAction: await nextActionFor(record),
        triageOutcome: record.triageOutcome,
        plan: record.plan,
        closure: record.closure,
        recovery,
    };
}

async function rejected(
    operation: AttachedOperationName,
    rejection: AttachedRejection,
    record?: AttachedWorkflowRecord,
): Promise<AttachedOperationResult> {
    return { ok: false, operation, rejection, ...(record ? { workflow: await viewOf(record) } : {}) };
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
    decide: Decide,
): Promise<AttachedOperationResult> {
    if (!decision.next) return decision.result;
    const written = await writeAttachedWorkflowRecord(location, decision.next, expectedRevision);
    if (written.status === "written") return decision.result;
    if (written.status === "busy") {
        return await rejected(
            operation,
            rejection("workflow_busy", "Another RunWield process holds this workflow. Retry."),
        );
    }
    if (!written.current) {
        return await rejected(operation, rejection("workflow_not_found", "The workflow no longer exists."));
    }
    return (await decide(written.current)).result;
}

/**
 * The checks every operation on an existing workflow makes before it changes anything:
 * a saved result replays, then the revision and the pending action must match.
 */
async function checkWorkflowOperation(
    operation: AttachedOperationName,
    envelope: WorkflowOperationEnvelope<{ actionId: string }>,
    current: AttachedWorkflowRecord,
    pendingState: AttachedWorkflowRecord["state"],
): Promise<Decision | null> {
    const saved = Object.hasOwn(current.acceptedOperations, envelope.operationId)
        ? current.acceptedOperations[envelope.operationId]
        : undefined;
    if (saved) return { result: saved.result };
    if (current.revision !== envelope.expectedRevision) {
        return {
            result: await rejected(
                operation,
                rejection("revision_conflict", `The workflow is at revision ${current.revision}.`),
                current,
            ),
        };
    }
    if (current.state !== pendingState || current.pendingAction?.actionId !== envelope.payload.actionId) {
        return {
            result: await rejected(
                operation,
                rejection("action_superseded", "This action is not the workflow's pending action."),
                current,
            ),
        };
    }
    return null;
}

/** The next revision with `changes` applied and this operation's result saved for replay. */
async function accept(
    operation: AttachedOperationName,
    envelope: WorkflowOperationEnvelope<{ actionId: string }>,
    current: AttachedWorkflowRecord,
    changes: RecordChanges,
): Promise<Decision> {
    const now = new Date().toISOString();
    const next: AttachedWorkflowRecord = { ...current, ...changes, revision: current.revision + 1, updatedAt: now };
    const result: AttachedOperationResult = { ok: true, operation, workflow: await viewOf(next) };
    next.acceptedOperations = {
        ...current.acceptedOperations,
        [envelope.operationId]: { result, evidence: { ...envelope.evidence, coreVersion: VERSION }, acceptedAt: now },
    };
    return { result, next };
}

/** Load the record an operation names, or the rejection that ends the operation. */
async function loadForOperation(
    operation: AttachedOperationName,
    location: AttachedWorkflowLocation,
    workflowId: string,
): Promise<{ record: AttachedWorkflowRecord } | { result: AttachedOperationResult }> {
    const loaded = await loadAttachedWorkflowRecord(location, workflowId);
    if (loaded.status === "missing") {
        return {
            result: await rejected(
                operation,
                rejection("workflow_not_found", "No Attached Workflow has this workflowId."),
            ),
        };
    }
    if (loaded.status === "moved") {
        return {
            result: await rejected(
                operation,
                rejection("project_moved", `This workflow belongs to ${loaded.record.projectRoot}.`),
            ),
        };
    }
    return { record: loaded.record };
}

export async function activate(envelope: ActivateEnvelope): Promise<AttachedOperationResult> {
    const location = locateAttachedWorkflows(envelope.projectRoot);
    const workflowId = workflowIdFor(location.projectRoot, envelope.operationId);
    const replay = async (current: AttachedWorkflowRecord): Promise<Decision> => {
        const saved = Object.hasOwn(current.acceptedOperations, envelope.operationId)
            ? current.acceptedOperations[envelope.operationId]
            : undefined;
        return {
            result: saved?.result ??
                await rejected("activate", rejection("revision_conflict", "This workflow already exists."), current),
        };
    };

    const loaded = await loadAttachedWorkflowRecord(location, workflowId);
    if (loaded.status !== "missing") return (await replay(loaded.record)).result;

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
        plan: null,
        closure: null,
        createdAt: now,
        updatedAt: now,
    };
    const result: AttachedOperationResult = { ok: true, operation: "activate", workflow: await viewOf(record) };
    record.acceptedOperations[envelope.operationId] = { result, evidence, acceptedAt: now };
    return await commit(location, "activate", null, { result, next: record }, replay);
}

export async function triageReport(envelope: TriageReportEnvelope): Promise<AttachedOperationResult> {
    const location = locateAttachedWorkflows(envelope.projectRoot);
    const decide = async (current: AttachedWorkflowRecord): Promise<Decision> => {
        const checked = await checkWorkflowOperation("triage_report", envelope, current, "triaging");
        if (checked) return checked;
        const outcome = normalizeTriageOutcome(envelope.payload.outcome);
        if (!outcome) {
            return {
                result: await rejected(
                    "triage_report",
                    rejection(
                        "invalid_outcome",
                        "The Triage outcome needs a valid routingIntent, complexity, and summary.",
                    ),
                    current,
                ),
            };
        }
        if (outcome.routingIntent !== "PLANNED_CHANGE") {
            return await accept("triage_report", envelope, current, {
                state: "closed",
                pendingAction: null,
                triageOutcome: outcome,
                closure: { reason: "unsupported_in_preview", routingIntent: outcome.routingIntent },
            });
        }
        return await accept("triage_report", envelope, current, {
            state: "awaiting_planning",
            pendingAction: {
                actionId: crypto.randomUUID(),
                role: "planner",
                contractVersion: ATTACHED_PLANNER_CONTRACT_VERSION,
            },
            triageOutcome: outcome,
        });
    };

    const loaded = await loadForOperation("triage_report", location, envelope.workflowId);
    if ("result" in loaded) return loaded.result;
    return await commit(location, "triage_report", loaded.record.revision, await decide(loaded.record), decide);
}

type PlanSubmission = { ok: true; plan: AttachedPlanReference } | { ok: false; message: string };

/**
 * Make the written Plan a RunWield Plan: the Plan file steps of Core's `plan_written`
 * without its Hosted Session or review. Every check runs before the first write, so a
 * rejected submission leaves the Plan file as it was. The Plan stays `draft`.
 */
async function submitPlanDocument(
    projectRoot: string,
    payload: PlanWrittenPayload,
    triage: TriageOutcome,
): Promise<PlanSubmission> {
    let planName;
    let location;
    try {
        planName = canonicalizeStoredPlanName(payload.planName).name;
        assertNotReservedEpicArtifactPlanName(planName);
        if (isHiddenPlanName(planName)) throw new Error(`Plan is archived or hidden: ${planName}`);
        location = await resolveWorkflowPlanLocation(projectRoot, planName, { migrateRegistry: false, readOnly: true });
    } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
    if (!location.plan) {
        return {
            ok: false,
            message: `docs/plans/${planName}.md not found. Write the Plan first, then call plan_written again.`,
        };
    }

    const updates: Partial<PlanFrontMatter> = { classification: triage.classification, complexity: triage.complexity };
    if (triage.workKind) updates.workKind = triage.workKind;
    if (payload.executionAgent !== undefined) updates.executionAgent = payload.executionAgent;
    if (payload.collaborationRecommendation !== undefined) {
        updates.collaborationRecommendation = payload.collaborationRecommendation;
    }
    const policy = resolvePlanExecutionPolicy({ ...location.plan.attrs, ...updates });
    if (!policy.ok) {
        return {
            ok: false,
            message: `${policy.error} Correct executionAgent or collaborationRecommendation in the call or in ` +
                `docs/plans/${planName}.md, then call plan_written again.`,
        };
    }

    await enterProjectRuntime(projectRoot);
    await updatePlanFrontMatter(location.documentRoot, planName, updates, {}, {
        expectedRevision: location.plan.revision,
    });
    const identified = await ensurePlanIdentity(location.documentRoot, planName);
    return { ok: true, plan: { planId: identified.planId, planName } };
}

export async function planWritten(envelope: PlanWrittenEnvelope): Promise<AttachedOperationResult> {
    const location = locateAttachedWorkflows(envelope.projectRoot);
    const loaded = await loadForOperation("plan_written", location, envelope.workflowId);
    if ("result" in loaded) return loaded.result;
    const transaction = await transactAttachedWorkflowRecord<AttachedOperationResult>(
        location,
        envelope.workflowId,
        async (current): Promise<Decision> => {
            if (!current) {
                return {
                    result: await rejected(
                        "plan_written",
                        rejection("workflow_not_found", "The workflow no longer exists."),
                    ),
                };
            }
            const checked = await checkWorkflowOperation("plan_written", envelope, current, "awaiting_planning");
            if (checked) return checked;
            if (!current.triageOutcome) {
                return {
                    result: await rejected(
                        "plan_written",
                        rejection("invalid_outcome", "This workflow has no Triage outcome."),
                        current,
                    ),
                };
            }
            const submitted = await submitPlanDocument(envelope.projectRoot, envelope.payload, current.triageOutcome);
            if (!submitted.ok) {
                return {
                    result: await rejected("plan_written", rejection("invalid_outcome", submitted.message), current),
                };
            }
            return await accept("plan_written", envelope, current, {
                state: "plan_submitted",
                pendingAction: null,
                plan: submitted.plan,
            });
        },
    );
    return transaction.status === "busy"
        ? await rejected(
            "plan_written",
            rejection("workflow_busy", "Another RunWield process holds this workflow. Retry."),
        )
        : transaction.result;
}

export async function readStatus(envelope: StatusEnvelope): Promise<AttachedOperationResult> {
    const location = locateAttachedWorkflows(envelope.projectRoot);
    const loaded = await loadAttachedWorkflowRecord(location, envelope.workflowId);
    if (loaded.status === "missing") {
        return await rejected("status", rejection("workflow_not_found", "No Attached Workflow has this workflowId."));
    }
    const recovery = loaded.status === "moved" ? movedRecovery(location, loaded.record) : null;
    return { ok: true, operation: "status", workflow: await viewOf(loaded.record, recovery) };
}

async function runParsedOperation(
    name: AttachedOperationName,
    projectRoot: string,
    input: AttachedJsonValue | undefined,
): Promise<AttachedOperationResult> {
    if (name === "activate") {
        const parsed = parseActivateInput(projectRoot, input);
        return parsed.ok ? await activate(parsed.envelope) : await rejected(name, parsed.rejection);
    }
    if (name === "triage_report") {
        const parsed = parseTriageReportInput(projectRoot, input);
        return parsed.ok ? await triageReport(parsed.envelope) : await rejected(name, parsed.rejection);
    }
    if (name === "plan_written") {
        const parsed = parsePlanWrittenInput(projectRoot, input);
        return parsed.ok ? await planWritten(parsed.envelope) : await rejected(name, parsed.rejection);
    }
    const parsed = parseStatusInput(projectRoot, input);
    return parsed.ok ? await readStatus(parsed.envelope) : await rejected(name, parsed.rejection);
}

/**
 * Attach the current role instructions when the workflow waits on the host. They are
 * resolved for this response only and never saved, so a replayed result carries the
 * instructions in effect now.
 */
async function withRoleInstructions(
    projectRoot: string,
    result: AttachedOperationResult,
): Promise<AttachedOperationResult> {
    const action = result.workflow?.nextAction;
    if (action?.kind !== "triage" && action?.kind !== "plan") return result;
    const text = await resolveAttachedRoleInstructions(projectRoot, action.role);
    return { ...result, instructions: { role: action.role, contractVersion: action.contractVersion, text } };
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
        return await rejected(name, rejection("payload_too_large", `Input exceeds ${MAX_ATTACHED_INPUT_BYTES} bytes.`));
    }
    let input: AttachedJsonValue | undefined;
    try {
        input = JSON.parse(inputText);
    } catch {
        input = undefined;
    }
    return await withRoleInstructions(projectRoot, await runParsedOperation(name, projectRoot, input));
}
