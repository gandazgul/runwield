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
    loadArchivedPlan,
    loadPlan,
    resolvePlanExecutionPolicy,
    updatePlanFrontMatter,
} from "../../plan-store.js";
import type { PlanFrontMatter } from "../../plan-store.js";
import { assertNotReservedEpicArtifactPlanName } from "../epic-artifacts.ts";
import { enterProjectRuntime, resolveProjectRuntimeLayout } from "../project-runtime-layout.ts";
import { runWieldGitignoreNeedsUpdate } from "../runwield-owned-paths.ts";
import { VERSION } from "../version.js";
import { recordPlanEvent } from "../workflow/plan-lifecycle.js";
import { isAnsweredPlanReview } from "../workflow/plan-review-recovery.js";
import { applySharedPlanReviewDecision } from "../workflow/plan-review-actions.ts";
import { loadReviewFeedbackImagePaths } from "../workflow/review-feedback-images.ts";
import type { ReviewDecision } from "../../ui/workspace/routes/api/review-handlers.js";
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
    type AttachedReviewOutcome,
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
    loadLatestAttachedWorkflowRecord,
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
    if (record.state === "awaiting_review" && record.plan && record.review) {
        return { kind: "review", round: record.review.round, planName: record.plan.planName };
    }
    if (record.state === "plan_ready" && record.plan) {
        return {
            kind: "plan_ready",
            planName: record.plan.planName,
            guidance: "The Plan is ready for work. Execution handoff is a later Preview step.",
        };
    }
    return record.closure?.reason === "plan_advanced_in_core"
        ? { kind: "return_to_host", ...record.closure }
        : { kind: "return_to_host", reason: "unsupported_in_preview" };
}

/** Project the canonical Plan position without writing an Attached record. */
async function reconcilePlanPosition(record: AttachedWorkflowRecord): Promise<AttachedWorkflowRecord> {
    if (!record.plan || (record.state !== "awaiting_review" && record.state !== "plan_ready")) return record;
    const { plan, archived } = await resolveWorkflowPlanLocation(record.projectRoot, record.plan.planName, {
        migrateRegistry: false,
        readOnly: true,
    });
    const archivedPlan = !plan && !archived ? await loadArchivedPlan(record.projectRoot, record.plan.planId) : null;
    if (!plan && !archived && !archivedPlan) throw new Error(`Plan not found: ${record.plan.planName}`);
    const status = archived || archivedPlan ? "archived" : plan?.attrs.status;
    if (status === "approved" || status === "ready_for_work" || status === "ready_for_decomposition") {
        return record.state === "plan_ready" ? record : { ...record, state: "plan_ready", pendingAction: null };
    }
    if (status === "draft" || status === "feedback") {
        if (
            record.state === "awaiting_review" &&
            (status === "draft" || plan?.controllerRevision === record.review?.controllerRevision)
        ) return record;
        return {
            ...record,
            state: "awaiting_planning",
            pendingAction: {
                actionId: `${record.review?.actionId ?? record.workflowId}:core-feedback`,
                role: "planner",
                contractVersion: ATTACHED_PLANNER_CONTRACT_VERSION,
                note: "The Plan changed in Core. Read the Plan Events before revising and submitting it again.",
            },
        };
    }
    return {
        ...record,
        state: "closed",
        pendingAction: null,
        closure: {
            reason: "plan_advanced_in_core",
            message: `The Plan advanced in Core to ${status}. No Attached browser review is pending.`,
        },
    };
}

async function viewOf(
    record: AttachedWorkflowRecord,
    recovery: ProjectMovedRecovery | null = null,
): Promise<AttachedWorkflowView> {
    if (!recovery) record = await reconcilePlanPosition(record);
    return {
        workflowId: record.workflowId,
        revision: record.revision,
        state: record.state,
        nextAction: await nextActionFor(record),
        triageOutcome: record.triageOutcome,
        plan: record.plan,
        review: record.review,
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
                rejection(
                    "action_superseded",
                    current.state === "awaiting_review"
                        ? "A browser review is pending. Wait for its decision before submitting another Plan."
                        : "This action is not the workflow's pending action.",
                ),
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
        review: null,
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

type PlanSubmission =
    | { ok: true; plan: AttachedPlanReference; revision: string; controllerRevision: number }
    | { ok: false; message: string };

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
    const submittedPlan = await loadPlan(location.documentRoot, planName);
    if (!submittedPlan) throw new Error(`Plan not found: ${planName}`);
    return {
        ok: true,
        plan: { planId: identified.planId, planName },
        revision: identified.revision,
        controllerRevision: submittedPlan.controllerRevision,
    };
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
            current = await reconcilePlanPosition(current);
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
                state: "awaiting_review",
                pendingAction: null,
                plan: submitted.plan,
                review: {
                    round: (current.review?.round ?? 0) + 1,
                    actionId: crypto.randomUUID(),
                    planRevision: submitted.revision,
                    controllerRevision: submitted.controllerRevision,
                    waitingReason: "user_decision",
                    status: "pending",
                },
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

/** The reviewed document and durable round identity a carrier must present together. */
export interface AttachedReviewPayloadBasis {
    review: NonNullable<AttachedWorkflowRecord["review"]>;
    planName: string;
    planPath: string;
    documentRoot: string;
    markdown: string;
    attrs: PlanFrontMatter;
    triageMeta: TriageOutcome | null;
}

export type AttachedReviewOpenResult =
    | { kind: "opened"; basis: AttachedReviewPayloadBasis }
    | { kind: "not_pending"; workflow: AttachedWorkflowView };

/** Pin the actual document revision before any carrier opens or restores a review. */
export async function openAttachedReviewRound(
    projectRoot: string,
    workflowId: string,
): Promise<AttachedReviewOpenResult> {
    const location = locateAttachedWorkflows(projectRoot);
    const transaction = await transactAttachedWorkflowRecord<AttachedReviewOpenResult>(
        location,
        workflowId,
        async (current) => {
            if (!current) throw new Error("workflow_not_found: No Attached Workflow has this workflowId.");
            if (current.projectRoot !== location.projectRoot) {
                throw new Error("project_moved: This workflow belongs elsewhere.");
            }
            const reconciled = await reconcilePlanPosition(current);
            const now = new Date().toISOString();
            if (reconciled !== current) {
                const next = { ...reconciled, revision: current.revision + 1, updatedAt: now };
                return { result: { kind: "not_pending", workflow: await viewOf(next) }, next };
            }
            if (current.state !== "awaiting_review" || current.review?.status !== "pending" || !current.plan) {
                return { result: { kind: "not_pending", workflow: await viewOf(current) } };
            }
            const { plan, documentRoot } = await resolveWorkflowPlanLocation(projectRoot, current.plan.planName, {
                migrateRegistry: false,
                readOnly: true,
            });
            if (!plan) throw new Error(`Plan not found: ${current.plan.planName}`);
            const review = {
                ...current.review,
                planRevision: plan.revision,
                controllerRevision: plan.controllerRevision,
            };
            const changed = review.planRevision !== current.review.planRevision ||
                review.controllerRevision !== current.review.controllerRevision;
            const next = changed ? { ...current, review, revision: current.revision + 1, updatedAt: now } : undefined;
            return {
                result: {
                    kind: "opened",
                    basis: {
                        review,
                        planName: current.plan.planName,
                        planPath: plan.path,
                        documentRoot,
                        markdown: plan.markdown,
                        attrs: plan.attrs,
                        triageMeta: current.triageOutcome,
                    },
                },
                ...(next && { next }),
            };
        },
    );
    if (transaction.status === "busy") {
        throw new Error("workflow_busy: Another RunWield process holds this workflow. Retry.");
    }
    return transaction.result;
}

type AttachedReviewDecisionResult = { outcome: AttachedReviewOutcome } | { rejection: string };

/** Apply a browser decision against its pinned payload, then commit before acknowledgment. */
export async function applyAttachedReviewDecision(
    projectRoot: string,
    workflowId: string,
    round: AttachedReviewPayloadBasis,
    decision: ReviewDecision,
): Promise<AttachedReviewOutcome> {
    const location = locateAttachedWorkflows(projectRoot);
    const transaction = await transactAttachedWorkflowRecord<AttachedReviewDecisionResult>(
        location,
        workflowId,
        async (current) => {
            if (!current) throw new Error("workflow_not_found: No Attached Workflow has this workflowId.");
            if (current.projectRoot !== location.projectRoot) {
                throw new Error("project_moved: This workflow belongs elsewhere.");
            }
            const saved = current.review;
            if (saved?.round !== round.review.round || saved.actionId !== round.review.actionId) {
                throw new Error("action_superseded: This review round is no longer pending.");
            }
            if (saved.status === "applied" && saved.outcome) return { result: { outcome: saved.outcome } };
            if (current.state !== "awaiting_review" || saved.planRevision !== round.review.planRevision) {
                throw new Error("action_superseded: This reviewed document is no longer pending. Reopen the review.");
            }
            const reconciled = await reconcilePlanPosition(current);
            if (reconciled !== current) {
                return {
                    result: {
                        rejection:
                            "action_superseded: The Plan advanced in Core. Read status for its current position.",
                    },
                    next: { ...reconciled, revision: current.revision + 1, updatedAt: new Date().toISOString() },
                };
            }
            const canceled = decision.canceled === true || decision.exit === true;
            if (!canceled && !isAnsweredPlanReview(decision)) {
                throw new Error(
                    "invalid_outcome: Review has no decision.",
                );
            }
            let outcome: AttachedReviewOutcome;
            if (canceled) {
                outcome = { kind: "canceled" };
            } else {
                const applied = await applySharedPlanReviewDecision({
                    cwd: round.documentRoot,
                    planName: round.planName,
                    planPath: round.planPath,
                    planWithFrontMatter: round.markdown,
                    planRevision: saved.planRevision,
                    originalAttrs: round.attrs,
                    trustedClassification: current.triageOutcome?.classification,
                    trustedWorkKind: current.triageOutcome?.workKind,
                    decision,
                });
                if (applied.cancellationReason || applied.recoveryRequired) {
                    throw new Error(applied.feedback || "The Plan changed. Reload this review.");
                }
                if (applied.approved) {
                    await recordPlanEvent({
                        cwd: round.documentRoot,
                        planName: round.planName,
                        event: "readiness_passed",
                        currentStatus: "approved",
                        expectedRevision: applied.revision,
                    });
                    outcome = {
                        kind: "approved",
                        ...(applied.approvalAction && { approvalAction: applied.approvalAction }),
                    };
                } else {
                    outcome = {
                        kind: "feedback",
                        feedback: applied.feedback ?? "",
                        imagePaths: await loadReviewFeedbackImagePaths(decision, round.documentRoot),
                    };
                }
            }
            const pendingAction = outcome.kind === "approved" ? null : {
                actionId: crypto.randomUUID(),
                role: "planner" as const,
                contractVersion: ATTACHED_PLANNER_CONTRACT_VERSION,
                ...(outcome.kind === "canceled"
                    ? {
                        note:
                            "The user canceled the browser review. Return to the user in Claude; this workflow remains open.",
                    }
                    : {
                        feedback: outcome.feedback,
                        imagePaths: outcome.imagePaths,
                        note:
                            "Read the feedback before revising. Browser edits are already in the Plan; do not apply them twice.",
                    }),
            };
            const next: AttachedWorkflowRecord = {
                ...current,
                state: outcome.kind === "approved" ? "plan_ready" : "awaiting_planning",
                pendingAction,
                review: { ...saved, status: "applied", outcome },
                revision: current.revision + 1,
                updatedAt: new Date().toISOString(),
            };
            return { result: { outcome }, next };
        },
    );
    if (transaction.status === "busy") throw new Error("workflow_busy: Another process holds this workflow. Retry.");
    if ("rejection" in transaction.result) throw new Error(transaction.result.rejection);
    return transaction.result.outcome;
}

export async function readStatus(envelope: StatusEnvelope): Promise<AttachedOperationResult> {
    const location = locateAttachedWorkflows(envelope.projectRoot);
    const latest = envelope.workflowId ? null : await loadLatestAttachedWorkflowRecord(location);
    const loaded = envelope.workflowId
        ? await loadAttachedWorkflowRecord(location, envelope.workflowId)
        : latest
        ? { status: "found" as const, record: latest }
        : { status: "missing" as const };
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
