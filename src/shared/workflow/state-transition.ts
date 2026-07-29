/**
 * @module shared/workflow/state-transition
 * Transaction boundary helpers for Plan Lifecycle mutations.
 */

import { dirname, join } from "@std/path";
import { AsyncLocalStorage } from "node:async_hooks";
import { PLAN_TRANSITIONS_DIR_NAME, RUNWIELD_DIR_NAME } from "../../constants.js";
import {
    atomicWriteTextFile,
    getRecordedPlanWriteRevision,
    loadPlan,
    loadPlanStrict,
    parsePlanFrontMatter,
    updatePlanFrontMatter,
    withPlanCatalogLock,
    withPlanLock,
    writePlanMarkdownWithRevision,
} from "../../plan-store.js";
import { SharedPlanLockError } from "../collaboration/lock.js";
import { findById as findWorktreeRegistryEntryById } from "../worktree-registry.js";
import { recordWorkflowMetric } from "./metrics.js";

export interface TransitionRecoveryAction {
    label: string;
    description: string;
    command?: string;
}

export interface TransitionResult {
    status: "committed" | "rolled_back" | "needs_recovery" | "blocked";
    transitionId: string;
    operation: string;
    value?: unknown;
    message?: string;
    recoveryActions?: TransitionRecoveryAction[];
}

export interface TransitionResource {
    kind: "catalog" | "plan" | "attempt" | "target_ref";
    id?: string;
}

/**
 * A resource as it appears when read back from a journal file, where nothing is
 * yet proven to match {@link TransitionResource}.
 */
interface JournaledResource {
    kind?: unknown;
    id?: unknown;
}

/** Canonical Plan snapshot handed to transition callbacks. */
type PlanSnapshot = Awaited<ReturnType<typeof loadPlan>>;

/** Record a durably-completed external effect in the transition journal. */
type MarkEffect = (effect: string, proof?: Record<string, unknown>) => Promise<void>;

/** Register a compensating action run only if the transition rolls back. */
type RegisterRollback = (label: string, run: () => Promise<void>) => void;

/** Context for callbacks that only read canonical Plan state. */
interface BaseTransitionContext {
    transitionId: string;
    beforePlan: PlanSnapshot;
}

/** Context for callbacks that perform journaled external effects. */
interface EffectTransitionContext extends BaseTransitionContext {
    markEffect: MarkEffect;
}

/** Context for callbacks that may also register compensating rollbacks. */
interface RollbackTransitionContext extends EffectTransitionContext {
    registerRollback: RegisterRollback;
}

/** Fields every semantic transition entry point accepts. */
interface TransitionOptionsBase {
    projectRoot: string;
    planName: string;
    planId?: string;
    worktreeId?: string;
    targetRef?: string;
    expectedRevision?: string;
    recordMetric?: typeof recordWorkflowMetric;
}

const activeSemanticTransitions = new AsyncLocalStorage<Set<string>>();

function compactError(value: unknown): string {
    return value instanceof Error ? value.message : String(value);
}

function transitionResourceKey(resource: TransitionResource): string {
    return `${resource.kind}:${resource.id || ""}`;
}

/**
 * Acquire transition resources in deterministic order. Non-Plan resources are
 * represented by lock files in the Plan lock namespace until they get dedicated
 * lock stores; this prevents same-attempt/target-ref races without introducing
 * one global lifecycle lock.
 */
export async function withOrderedTransitionResources<T>(
    projectRoot: string,
    resources: TransitionResource[],
    fn: () => Promise<T>,
): Promise<T> {
    const ordered = [...new Map(resources.map((resource) => [transitionResourceKey(resource), resource])).values()]
        .sort((a, b) => transitionResourceKey(a).localeCompare(transitionResourceKey(b)));
    const acquireAt = async (index: number): Promise<T> => {
        if (index >= ordered.length) return await fn();
        const resource = ordered[index];
        if (resource.kind === "catalog") return await withPlanCatalogLock(projectRoot, () => acquireAt(index + 1));
        const lockName = resource.kind === "plan"
            ? resource.id || "unknown"
            : `__${resource.kind}:${resource.id || "unknown"}`;
        return await withPlanLock(projectRoot, lockName, () => acquireAt(index + 1));
    };
    return await acquireAt(0);
}

export function getTransitionJournalDir(projectRoot: string): string {
    return join(projectRoot, RUNWIELD_DIR_NAME, PLAN_TRANSITIONS_DIR_NAME);
}

export function getTransitionJournalPath(projectRoot: string, transitionId: string): string {
    return join(getTransitionJournalDir(projectRoot), `${transitionId}.json`);
}

async function writeJournal(projectRoot: string, transitionId: string, record: Record<string, unknown>) {
    const path = getTransitionJournalPath(projectRoot, transitionId);
    await Deno.mkdir(dirname(path), { recursive: true });
    await atomicWriteTextFile(path, `${JSON.stringify(record, null, 2)}\n`);
}

async function removeJournal(projectRoot: string, transitionId: string) {
    await Deno.remove(getTransitionJournalPath(projectRoot, transitionId)).catch((error) => {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
    });
}

/**
 * Undo this transaction's own Plan write, but only when it can prove the write
 * was its own.
 *
 * The Plan lock keeps other RunWield writers out, but it cannot stop an editor,
 * a shell command, or a `git checkout` from touching the same file. So a changed
 * revision alone is not evidence of authorship, and blindly restoring would
 * silently destroy an outside edit.
 *
 * `getRecordedPlanWriteRevision` closes that gap: every RunWield Plan write goes
 * through one revision-checked writer that records what it wrote. If the file
 * still holds exactly those bytes, this transaction is the last writer and the
 * restore is safe. If it holds anything else, someone outside the lock wrote
 * last and we fail closed with a journal.
 *
 * @returns the restored revision, or null when restoring is not provably safe.
 */
async function restoreOwnPlanWrite(
    { projectRoot, planName, beforePlan, currentRevision }: {
        projectRoot: string;
        planName: string;
        beforePlan: NonNullable<PlanSnapshot>;
        currentRevision?: string;
    },
): Promise<string | null> {
    if (!currentRevision) return null;
    if (currentRevision !== getRecordedPlanWriteRevision(beforePlan.path)) return null;
    try {
        // Compare-and-set against the bytes we just proved are ours, so a writer
        // that slips in between the check and the write loses the race instead of
        // being overwritten.
        await writePlanMarkdownWithRevision(beforePlan.path, beforePlan.markdown, currentRevision);
    } catch {
        return null;
    }
    const restored = await loadPlan(projectRoot, planName).catch(() => null);
    const restoredRevision = restored?.revision;
    return restoredRevision && restoredRevision === beforePlan.revision ? restoredRevision : null;
}

/** One compensating action's outcome, as recorded during failure handling. */
interface RollbackResult {
    label: string;
    status: "rolled_back" | "failed";
    error?: string;
}

/** A durable effect the transition marked as completed before it failed. */
interface CompletedEffect {
    effect: string;
    proof?: Record<string, unknown>;
    completedAt: string;
}

/**
 * Decide whether a failed transition provably left nothing behind.
 *
 * The journal is a blocking record: while one exists, every later transition on
 * the same resources refuses to run. That is the right behavior for a genuinely
 * uncertain repository, and the wrong behavior for a failure that never got far
 * enough to change anything — a disallowed Plan Event, a stale review decision,
 * a failed precondition. Those must stay retryable.
 *
 * "Provably clean" therefore requires positive evidence, never an assumption:
 * the Plan file is byte-identical to what was read under the lock, no
 * irreversible effect was marked, and every marked effect was undone by a
 * compensation that itself succeeded.
 */
function classifyTransitionFailure(
    { beforeRevision, currentRevision, completedEffects, rollbackResults, irreversibleEffects }: {
        beforeRevision?: string;
        currentRevision?: string;
        completedEffects: CompletedEffect[];
        rollbackResults: RollbackResult[];
        irreversibleEffects: string[];
    },
): { provablyClean: boolean; reason?: string } {
    const completedEffectNames = new Set(completedEffects.map((effect) => effect.effect));
    const irreversible = irreversibleEffects.filter((effect) => completedEffectNames.has(effect));
    if (irreversible.length > 0) {
        return { provablyClean: false, reason: `irreversible_effect:${irreversible.join(",")}` };
    }
    const failedRollback = rollbackResults.find((result) => result.status === "failed");
    if (failedRollback) {
        return { provablyClean: false, reason: `rollback_failed:${failedRollback.label}` };
    }
    // Effects were marked but nothing was registered to undo them, so their
    // external state (Git refs, worktrees, registry rows) is unaccounted for.
    if (completedEffects.length > 0 && rollbackResults.length === 0) {
        return { provablyClean: false, reason: "effects_without_compensation" };
    }
    // Checked last because, unlike the conditions above, this one is repairable:
    // the caller can undo a Plan write it can prove it made and ask again.
    if (currentRevision !== beforeRevision) {
        return { provablyClean: false, reason: "plan_bytes_changed" };
    }
    return { provablyClean: true };
}

function planAction(planName: string) {
    return [
        {
            label: "Reload the Plan and retry",
            description: `Re-read plans/${planName}.md, then repeat the action so RunWield uses current Plan metadata.`,
        },
        {
            label: "Inspect with load-plan",
            description: "Open the Plan recovery flow for details and safe next actions.",
            command: `wld load-plan ${planName}`,
        },
    ];
}

/**
 * Run a semantic lifecycle transition across ordered resources with a durable
 * recovery journal. This is the boundary for operations that include Plan,
 * registry, Git/worktree, and target-ref effects.
 */
async function runSemanticTransition<T>(
    {
        projectRoot,
        planName,
        operation,
        resources,
        apply,
        expectedRevision,
        recoveryActions,
        postconditions = {},
        expectedEffects = [],
        verify,
        recordMetric = recordWorkflowMetric,
        irreversibleEffects = [],
        supersedesUnresolved = false,
    }: TransitionOptionsBase & {
        operation: string;
        resources: TransitionResource[];
        apply: (ctx: RollbackTransitionContext & { expectedRevision?: string }) => Promise<T>;
        recoveryActions?: TransitionRecoveryAction[];
        postconditions?: Record<string, unknown>;
        expectedEffects?: string[];
        verify?: (value: T) => Promise<Record<string, unknown> | void>;
        /**
         * Effects that cannot be compensated once marked (a moved target ref).
         * Marking one forces `needs_recovery` even if every rollback succeeded.
         */
        irreversibleEffects?: string[];
        /**
         * Set by operations whose purpose is to resolve an uncertain repository
         * (Plan Recovery). They must run despite an unresolved journal on their
         * own resources, otherwise the only recovery path is blocked by the very
         * record it exists to clear, and the Plan is stranded for good.
         */
        supersedesUnresolved?: boolean;
    },
): Promise<TransitionResult> {
    const transitionId = crypto.randomUUID();
    const completedEffects: Array<{ effect: string; proof?: Record<string, unknown>; completedAt: string }> = [];
    const rollbackActions: Array<{ label: string; run: () => Promise<void> }> = [];
    const writeState = async (state: string, extra: Record<string, unknown> = {}) =>
        await writeJournal(projectRoot, transitionId, {
            version: 1,
            transitionId,
            operation,
            planName,
            resources,
            state,
            intendedPostconditions: postconditions,
            completedEffects,
            updatedAt: new Date().toISOString(),
            ...extra,
        });
    const markEffect: MarkEffect = async (effect, proof) => {
        completedEffects.push({ effect, ...(proof ? { proof } : {}), completedAt: new Date().toISOString() });
        await writeState("applying");
    };
    const registerRollback: RegisterRollback = (label, run) => {
        rollbackActions.push({ label, run });
    };
    const actions = recoveryActions || planAction(planName);
    const parentActiveTransitions = activeSemanticTransitions.getStore();
    const activeTransitionIds = new Set(parentActiveTransitions || []);
    activeTransitionIds.add(transitionId);
    return await activeSemanticTransitions.run(
        activeTransitionIds,
        async () =>
            await withOrderedTransitionResources(projectRoot, resources, async () => {
                const strictBefore = await loadPlanStrict(projectRoot, planName);
                if (strictBefore.kind === "malformed") {
                    await writeState("needs_recovery", {
                        error: strictBefore.error.message,
                        recoveryActions: actions,
                    });
                    return {
                        status: "needs_recovery",
                        transitionId,
                        operation,
                        message: strictBefore.error.message,
                        recoveryActions: actions,
                    };
                }
                if (strictBefore.kind !== "loaded" && strictBefore.kind !== "not_found") {
                    const message = "message" in strictBefore
                        ? strictBefore.message
                        : "error" in strictBefore
                        ? strictBefore.error.message
                        : `Plan not found: ${planName}`;
                    await writeState("needs_recovery", {
                        error: message,
                        recoveryActions: actions,
                    });
                    return { status: "needs_recovery", transitionId, operation, message, recoveryActions: actions };
                }
                const beforePlan = strictBefore.kind === "loaded"
                    ? {
                        path: strictBefore.path,
                        markdown: strictBefore.markdown,
                        attrs: strictBefore.attrs,
                        body: strictBefore.body,
                        revision: strictBefore.revision,
                    }
                    : null;
                const existingRecoveryRecords = await listTransitionRecoveryRecords(projectRoot);
                const resourceKeys = new Set(resources.map(transitionResourceKey));
                const conflictingRecoveryRecord = existingRecoveryRecords.find((record) => {
                    if (
                        record.transitionId === transitionId ||
                        activeTransitionIds.has(String(record.transitionId || ""))
                    ) return false;
                    if (record.planName === planName) return true;
                    if (!Array.isArray(record.resources)) return false;
                    return record.resources.some((resource: unknown) => {
                        if (!resource || typeof resource !== "object") return false;
                        const { kind, id } = resource as JournaledResource;
                        if (typeof kind !== "string") return false;
                        return resourceKeys.has(`${kind}:${typeof id === "string" ? id : ""}`);
                    });
                });
                if (conflictingRecoveryRecord && !supersedesUnresolved) {
                    const message = `Unresolved lifecycle transition ${
                        conflictingRecoveryRecord.transitionId || "unknown"
                    } must be recovered before starting ${operation} for ${planName}.`;
                    return { status: "blocked", transitionId, operation, message, recoveryActions: actions };
                }
                const supersededRecords = supersedesUnresolved
                    ? existingRecoveryRecords.filter((record) =>
                        record.transitionId !== transitionId &&
                        !activeTransitionIds.has(String(record.transitionId || "")) &&
                        (record.planName === planName ||
                            (Array.isArray(record.resources) &&
                                record.resources.some((resource: unknown) => {
                                    if (!resource || typeof resource !== "object") return false;
                                    const { kind, id } = resource as JournaledResource;
                                    if (typeof kind !== "string") return false;
                                    return resourceKeys.has(`${kind}:${typeof id === "string" ? id : ""}`);
                                })))
                    )
                    : [];
                if (expectedRevision !== undefined && beforePlan?.revision !== expectedRevision) {
                    const message = beforePlan
                        ? `Stale transition precondition for ${planName}: expected ${expectedRevision}, found ${beforePlan.revision}.`
                        : `Stale transition precondition for ${planName}: expected ${expectedRevision}, but Plan is missing.`;
                    // Stale/precondition mismatches are typed caller outcomes, not partial lifecycle effects.
                    // Do not durably journal them: recovery scans treat any remaining journal as unresolved work.
                    return { status: "blocked", transitionId, operation, message, recoveryActions: actions };
                }
                const attemptBeforeFacts = await Promise.all(
                    resources
                        .filter((resource) => resource.kind === "attempt")
                        .map(async (resource) => {
                            if (!resource.id) return { id: "", entry: null };
                            const entry = await findWorktreeRegistryEntryById(projectRoot, resource.id).catch(() =>
                                null
                            );
                            return {
                                id: resource.id,
                                entry: entry
                                    ? {
                                        planName: entry.planName,
                                        planId: entry.planId,
                                        path: entry.path,
                                        branch: entry.branch,
                                        status: entry.status,
                                        executionBaselineTree: entry.executionBaselineTree,
                                        updatedAt: entry.updatedAt,
                                    }
                                    : null,
                            };
                        }),
                );
                await writeState("prepared", {
                    preparedAt: new Date().toISOString(),
                    beforeFacts: {
                        plan: beforePlan
                            ? { path: beforePlan.path, revision: beforePlan.revision, status: beforePlan.attrs.status }
                            : { missing: true },
                        ...(attemptBeforeFacts.length > 0 ? { worktreeRegistry: attemptBeforeFacts } : {}),
                    },
                });
                try {
                    await writeState("applying");
                    const value = await apply({
                        transitionId,
                        beforePlan,
                        expectedRevision: beforePlan?.revision,
                        markEffect,
                        registerRollback,
                    });
                    await writeState("verifying", { proof: value });
                    for (const expectedEffect of expectedEffects) {
                        if (!completedEffects.some((effect) => effect.effect === expectedEffect)) {
                            throw new Error(
                                `Transition ${operation} did not prove expected effect: ${expectedEffect}.`,
                            );
                        }
                    }
                    const afterPlan = await loadPlan(projectRoot, planName);
                    const verificationProof = verify ? await verify(value) : undefined;
                    await writeState("committed", {
                        committedAt: new Date().toISOString(),
                        proof: value,
                        afterFacts: afterPlan
                            ? {
                                plan: {
                                    path: afterPlan.path,
                                    revision: afterPlan.revision,
                                    status: afterPlan.attrs.status,
                                },
                            }
                            : { plan: { missing: true } },
                        ...(verificationProof ? { verificationProof } : {}),
                    });
                    await removeJournal(projectRoot, transitionId);
                    // The recovery just settled the uncertainty these records
                    // described, so retiring them here is what actually returns
                    // the Plan to normal operation.
                    for (const superseded of supersededRecords) {
                        const supersededId = String(superseded.transitionId || "");
                        if (supersededId) await removeJournal(projectRoot, supersededId);
                    }
                    await recordMetric({
                        category: "recovery",
                        event: "semantic_transition_committed",
                        planName,
                        details: { operation, resources: resources.map(transitionResourceKey) },
                    }, { cwd: projectRoot }).catch(() => {});
                    return { status: "committed", transitionId, operation, value };
                } catch (error) {
                    if (error instanceof SharedPlanLockError) throw error;
                    const message = compactError(error);
                    // Fail closed instead of restoring Plan bytes here. A logical RunWield
                    // lock does not prove that the current file revision belongs to this
                    // transition; an editor, Git checkout, or recovery operator may have
                    // changed the same bytes outside the lock. The journal keeps the
                    // before facts and completed effect proofs so doctor/recovery can make
                    // an explicit, evidence-based repair without overwriting uncertain work.
                    const rollbackResults: RollbackResult[] = [];
                    for (const rollback of rollbackActions.toReversed()) {
                        try {
                            await rollback.run();
                            rollbackResults.push({ label: rollback.label, status: "rolled_back" });
                        } catch (rollbackError) {
                            rollbackResults.push({
                                label: rollback.label,
                                status: "failed",
                                error: compactError(rollbackError),
                            });
                        }
                    }
                    const currentPlanRevision = (await loadPlan(projectRoot, planName).catch(() => null))?.revision;
                    const classify = (currentRevision?: string) =>
                        classifyTransitionFailure({
                            beforeRevision: beforePlan?.revision,
                            currentRevision,
                            completedEffects,
                            rollbackResults,
                            irreversibleEffects,
                        });
                    let outcome = classify(currentPlanRevision);
                    // Registered compensations already ran above; the Plan write is
                    // the one effect they cannot cover, so undo it here when this
                    // transaction can prove it was the writer. Only worth trying when
                    // nothing else is outstanding — otherwise the journal stays either
                    // way and restoring would just move bytes for no gain.
                    if (!outcome.provablyClean && outcome.reason === "plan_bytes_changed" && beforePlan) {
                        const restoredRevision = await restoreOwnPlanWrite({
                            projectRoot,
                            planName,
                            beforePlan,
                            currentRevision: currentPlanRevision,
                        });
                        if (restoredRevision) outcome = classify(restoredRevision);
                    }
                    // A journal blocks every later transition on these resources until
                    // something proves the repository safe, so only write one when this
                    // failure could actually have left durable state behind. A rejected
                    // precondition that never touched a byte must not strand the Plan.
                    if (outcome.provablyClean) {
                        await removeJournal(projectRoot, transitionId);
                        return { status: "rolled_back", transitionId, operation, message, recoveryActions: actions };
                    }
                    await writeState("needs_recovery", {
                        error: message,
                        currentPlanRevision,
                        uncertainty: outcome.reason,
                        ...(rollbackResults.length > 0 ? { rollbackResults } : {}),
                        recoveryActions: actions,
                    });
                    return { status: "needs_recovery", transitionId, operation, message, recoveryActions: actions };
                }
            }),
    );
}

/**
 * Prepare FEATURE execution as one semantic transition: worktree selection or
 * creation, Plan materialization, baseline capture, registry settlement, and
 * execution_started Plan Event recording must all happen while holding the Plan,
 * exact attempt, and target-ref resources.
 */
export async function runExecutionPreparationTransition<T>(
    {
        projectRoot,
        planName,
        planId: _planId,
        worktreeId,
        targetRef,
        expectedRevision,
        prepare,
        verifyPreparation,
        recordMetric,
    }: TransitionOptionsBase & {
        prepare: (ctx: RollbackTransitionContext) => Promise<T>;
        verifyPreparation?: (value: T, ctx: BaseTransitionContext) => Promise<unknown> | unknown;
    },
): Promise<TransitionResult> {
    const resources: TransitionResource[] = [{ kind: "plan", id: planName }];
    if (worktreeId) resources.push({ kind: "attempt", id: worktreeId });
    if (targetRef) resources.push({ kind: "target_ref", id: targetRef });
    return await runSemanticTransition({
        projectRoot,
        planName,
        operation: "execution_preparation",
        resources,
        expectedRevision,
        expectedEffects: ["execution_prepared"],
        apply: async (ctx) => {
            const value = await prepare(ctx);
            const preparationProof = verifyPreparation ? await verifyPreparation(value, ctx) : { planName };
            await ctx.markEffect(
                "execution_prepared",
                (preparationProof || { planName }) as Record<string, unknown>,
            );
            return value;
        },
        recordMetric,
        recoveryActions: [
            ...planAction(planName),
            {
                label: "Inspect execution worktree evidence",
                description:
                    "If worktree creation or registry settlement was interrupted, inspect the recorded worktree path/branch before deleting or recreating it.",
            },
        ],
    });
}

/**
 * Run one same-Plan transaction with a durable journal and conservative rollback.
 * The apply callback must perform only effects protected by the acquired Plan lock
 * unless it records its own external proof before mutating Git or registry state.
 */
async function runPlanTransition<T>(
    { projectRoot, planName, operation, apply, expectedRevision, recordMetric = recordWorkflowMetric }:
        & TransitionOptionsBase
        & { operation: string; apply: (ctx: BaseTransitionContext) => Promise<T> },
): Promise<TransitionResult> {
    const transitionId = crypto.randomUUID();
    return await withPlanLock(projectRoot, planName, async () => {
        const strictBefore = await loadPlanStrict(projectRoot, planName);
        if (strictBefore.kind === "malformed") {
            await writeJournal(projectRoot, transitionId, {
                version: 1,
                transitionId,
                operation,
                planName,
                state: "needs_recovery",
                error: strictBefore.error.message,
                recoveryActions: planAction(planName),
                updatedAt: new Date().toISOString(),
            });
            return {
                status: "needs_recovery",
                transitionId,
                operation,
                message: strictBefore.error.message,
                recoveryActions: planAction(planName),
            };
        }
        if (strictBefore.kind !== "loaded" && strictBefore.kind !== "not_found") {
            const message = "message" in strictBefore
                ? strictBefore.message
                : "error" in strictBefore
                ? strictBefore.error.message
                : `Plan not found: ${planName}`;
            await writeJournal(projectRoot, transitionId, {
                version: 1,
                transitionId,
                operation,
                planName,
                state: "needs_recovery",
                error: message,
                recoveryActions: planAction(planName),
                updatedAt: new Date().toISOString(),
            });
            return {
                status: "needs_recovery",
                transitionId,
                operation,
                message,
                recoveryActions: planAction(planName),
            };
        }
        const beforePlan = strictBefore.kind === "loaded"
            ? {
                path: strictBefore.path,
                markdown: strictBefore.markdown,
                attrs: strictBefore.attrs,
                body: strictBefore.body,
                revision: strictBefore.revision,
            }
            : null;
        const activeTransitionIds = activeSemanticTransitions.getStore() || new Set();
        const existingRecoveryRecords = await listTransitionRecoveryRecords(projectRoot);
        const conflictingRecoveryRecord = existingRecoveryRecords.find((record) => {
            if (record.transitionId === transitionId || activeTransitionIds.has(String(record.transitionId || ""))) {
                return false;
            }
            if (record.planName === planName) return true;
            if (!Array.isArray(record.resources)) return false;
            return record.resources.some((resource: unknown) => {
                if (!resource || typeof resource !== "object") return false;
                const { kind, id } = resource as JournaledResource;
                return kind === "plan" && id === planName;
            });
        });
        if (conflictingRecoveryRecord) {
            const message = `Unresolved lifecycle transition ${
                conflictingRecoveryRecord.transitionId || "unknown"
            } must be recovered before starting ${operation} for ${planName}.`;
            return { status: "blocked", transitionId, operation, message, recoveryActions: planAction(planName) };
        }
        if (expectedRevision !== undefined && beforePlan?.revision !== expectedRevision) {
            const message = beforePlan
                ? `Stale transition precondition for ${planName}: expected ${expectedRevision}, found ${beforePlan.revision}.`
                : `Stale transition precondition for ${planName}: expected ${expectedRevision}, but Plan is missing.`;
            // Stale/precondition mismatches are typed caller outcomes, not partial lifecycle effects.
            // Do not durably journal them: recovery scans treat any remaining journal as unresolved work.
            return { status: "blocked", transitionId, operation, message, recoveryActions: planAction(planName) };
        }
        await writeJournal(projectRoot, transitionId, {
            version: 1,
            transitionId,
            operation,
            planName,
            state: "prepared",
            preparedAt: new Date().toISOString(),
            before: beforePlan
                ? { path: beforePlan.path, revision: beforePlan.revision, status: beforePlan.attrs.status }
                : { missing: true },
        });
        try {
            await writeJournal(projectRoot, transitionId, {
                version: 1,
                transitionId,
                operation,
                planName,
                state: "applying",
                updatedAt: new Date().toISOString(),
            });
            const value = await apply({ transitionId, beforePlan });
            await writeJournal(projectRoot, transitionId, {
                version: 1,
                transitionId,
                operation,
                planName,
                state: "committed",
                committedAt: new Date().toISOString(),
            });
            await removeJournal(projectRoot, transitionId);
            await recordMetric({
                category: "recovery",
                event: "plan_transition_committed",
                planName,
                details: { operation },
            }, { cwd: projectRoot }).catch(() => {});
            return { status: "committed", transitionId, operation, value };
        } catch (error) {
            if (error instanceof SharedPlanLockError) throw error;
            const message = compactError(error);
            // Do not restore beforePlan bytes over the current file here. At this
            // layer we cannot prove whether a revision change is this transition's
            // partial write or an unmanaged external edit, so fail closed and keep
            // the journal for explicit recovery instead of overwriting another
            // writer's bytes.
            //
            // When the bytes are unchanged there is nothing to fail closed over:
            // this layer's only durable effect is the Plan write itself, so an
            // identical revision proves the write never landed. Rejections that
            // belong to normal operation reach here — a stale review decision is
            // the designed outcome of reviewing an edited Plan — and must leave
            // the Plan retryable rather than blocked.
            const currentPlanRevision = (await loadPlan(projectRoot, planName).catch(() => null))?.revision;
            // Undoing a partial write is the whole compensation at this layer: the
            // Plan file is the only durable thing `apply` may touch here. When the
            // bytes never changed, or when they changed and we can prove we were
            // the writer, the repository is provably back to its starting state
            // and the Plan must stay usable rather than be blocked by a journal.
            const restoredRevision = beforePlan && currentPlanRevision !== beforePlan.revision
                ? await restoreOwnPlanWrite({ projectRoot, planName, beforePlan, currentRevision: currentPlanRevision })
                : null;
            if (!beforePlan || currentPlanRevision === beforePlan.revision || restoredRevision) {
                await removeJournal(projectRoot, transitionId);
                return {
                    status: "rolled_back",
                    transitionId,
                    operation,
                    message,
                    recoveryActions: planAction(planName),
                };
            }
            await writeJournal(projectRoot, transitionId, {
                version: 1,
                transitionId,
                operation,
                planName,
                state: "needs_recovery",
                error: message,
                uncertainty: "plan_bytes_changed",
                beforeFacts: { plan: { revision: beforePlan.revision } },
                currentPlanRevision,
                recoveryActions: planAction(planName),
                updatedAt: new Date().toISOString(),
            });
            return {
                status: "needs_recovery",
                transitionId,
                operation,
                message,
                recoveryActions: planAction(planName),
            };
        }
    });
}

/**
 * Semantic boundary for lifecycle Plan Events owned by plan-lifecycle.js.
 */
export async function runPlanLifecycleEventTransition<T>(
    opts: TransitionOptionsBase & {
        event: string;
        resources?: TransitionResource[];
        record: (ctx: BaseTransitionContext) => Promise<T>;
    },
): Promise<TransitionResult> {
    if (opts.resources && opts.resources.length > 0) {
        return await runSemanticTransition({
            projectRoot: opts.projectRoot,
            planName: opts.planName,
            operation: `plan_event:${opts.event}`,
            resources: opts.resources,
            expectedRevision: opts.expectedRevision,
            expectedEffects: ["plan_event_recorded"],
            apply: async (ctx) => {
                const value = await opts.record(ctx);
                await ctx.markEffect("plan_event_recorded", { planName: opts.planName, event: opts.event });
                return value;
            },
        });
    }
    return await runPlanTransition({
        projectRoot: opts.projectRoot,
        planName: opts.planName,
        operation: `plan_event:${opts.event}`,
        expectedRevision: opts.expectedRevision,
        apply: opts.record,
    });
}

/**
 * Semantic boundary for applying a Plan review approval/feedback decision.
 */
export async function runPlanReviewDecisionTransition<T>(
    opts: TransitionOptionsBase & { approved: boolean; decide: (ctx: BaseTransitionContext) => Promise<T> },
): Promise<TransitionResult> {
    return await runPlanTransition({
        projectRoot: opts.projectRoot,
        planName: opts.planName,
        operation: opts.approved ? "plan_review_approved" : "plan_review_feedback",
        expectedRevision: opts.expectedRevision,
        apply: opts.decide,
    });
}

/**
 * Semantic boundary for reopening a Plan review and abandoning its recorded execution attempt.
 */
export async function runReviewReopenTransition<T>(
    opts: TransitionOptionsBase & { worktreeId: string; reopen: (ctx: EffectTransitionContext) => Promise<T> },
): Promise<TransitionResult> {
    return await runSemanticTransition({
        projectRoot: opts.projectRoot,
        planName: opts.planName,
        operation: "review_reopened",
        resources: [{ kind: "plan", id: opts.planName }, { kind: "attempt", id: opts.worktreeId }],
        expectedRevision: opts.expectedRevision,
        expectedEffects: ["worktree_registry_abandoned", "review_reopened_settled"],
        apply: async (ctx) => {
            const value = await opts.reopen(ctx);
            await ctx.markEffect("review_reopened_settled", { planName: opts.planName, worktreeId: opts.worktreeId });
            return value;
        },
    });
}

/**
 * Transactionally update Plan Front Matter and verify the requested fields.
 */
export async function runPlanFrontMatterTransition(
    { projectRoot, planName, operation, updates, recoveryAttrs = {}, expectedRevision }: {
        projectRoot: string;
        planName: string;
        operation: string;
        updates: Record<string, unknown>;
        recoveryAttrs?: Record<string, unknown>;
        expectedRevision?: string;
    },
) {
    return await runPlanTransition({
        projectRoot,
        planName,
        operation,
        expectedRevision,
        apply: async ({ beforePlan }) => {
            if (!beforePlan) throw new Error(`Plan not found: ${planName}`);
            const attrs = await updatePlanFrontMatter(projectRoot, planName, updates, recoveryAttrs, {
                expectedRevision: beforePlan.revision,
            });
            const after = await loadPlan(projectRoot, planName);
            if (!after) throw new Error(`Plan disappeared during ${operation}: ${planName}`);
            for (const [key, value] of Object.entries(updates)) {
                if (value === undefined) continue;
                const actual = (after.attrs as unknown as Record<string, unknown>)[key];
                if (JSON.stringify(actual ?? null) !== JSON.stringify(value ?? null)) {
                    throw new Error(`Plan transition ${operation} did not persist ${key}.`);
                }
            }
            return attrs;
        },
    });
}

/** Return unresolved transition journal records for diagnostics. */
export async function listTransitionRecoveryRecords(projectRoot: string) {
    const dir = getTransitionJournalDir(projectRoot);
    /** @type {Array<Record<string, unknown>>} */
    const records = [];
    try {
        for await (const entry of Deno.readDir(dir)) {
            if (!entry.isFile || !entry.name.endsWith(".json")) continue;
            try {
                records.push(JSON.parse(await Deno.readTextFile(join(dir, entry.name))));
            } catch (error) {
                records.push({ state: "needs_recovery", path: join(dir, entry.name), error: compactError(error) });
            }
        }
    } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    return records;
}

/** A journal record paired with whether it can be retired without a human. */
export interface TransitionReconciliation {
    transitionId: string;
    planName?: string;
    operation?: string;
    state?: string;
    /** True when repository facts prove the record describes no outstanding work. */
    resolvable: boolean;
    /** Why it is resolvable, or what remains uncertain. */
    reason: string;
    resolved?: boolean;
}

/**
 * Decide, from current repository facts, which unresolved journals are safe to
 * retire — and retire them when `apply` is set.
 *
 * Without this, a journal is written on failure but nothing ever removes one, so
 * a single interrupted transition blocks its Plan permanently and the only way
 * out is deleting a file by hand. RunWield owns this store, so it has to be able
 * to close its own records.
 *
 * A record is resolvable only on positive evidence: the transition already
 * committed (so only the cleanup delete was lost), or it marked no durable
 * effect and the Plan is byte-identical to what it read. Anything else — a
 * changed Plan, a marked effect, an irreversible Git move — stays for a human.
 */
export async function reconcileTransitionRecoveryRecords(
    projectRoot: string,
    { apply = false }: { apply?: boolean } = {},
): Promise<TransitionReconciliation[]> {
    const records = await listTransitionRecoveryRecords(projectRoot);
    const reconciliations: TransitionReconciliation[] = [];
    for (const record of records) {
        const transitionId = String(record.transitionId || "");
        const planName = typeof record.planName === "string" ? record.planName : undefined;
        const operation = typeof record.operation === "string" ? record.operation : undefined;
        const state = typeof record.state === "string" ? record.state : undefined;
        const base = { transitionId, planName, operation, state };

        if (!transitionId) {
            reconciliations.push({ ...base, resolvable: false, reason: "journal file is unreadable or has no id" });
            continue;
        }
        if (state === "committed") {
            reconciliations.push({
                ...base,
                resolvable: true,
                reason: "transition committed; only its journal cleanup was interrupted",
            });
            continue;
        }
        const completedEffects = Array.isArray(record.completedEffects) ? record.completedEffects : [];
        if (completedEffects.length > 0) {
            const names = completedEffects
                .map((effect: unknown) => (effect as CompletedEffect)?.effect)
                .filter(Boolean)
                .join(", ");
            reconciliations.push({
                ...base,
                resolvable: false,
                reason: `durable effects were recorded and need proof before closing: ${names}`,
            });
            continue;
        }
        if (!planName) {
            reconciliations.push({ ...base, resolvable: false, reason: "no Plan recorded; cannot prove Plan state" });
            continue;
        }
        const beforeFacts = (record.beforeFacts || {}) as { plan?: { revision?: unknown; missing?: unknown } };
        const journaledRevision = typeof beforeFacts.plan?.revision === "string"
            ? beforeFacts.plan.revision
            : undefined;
        const current = await loadPlan(projectRoot, planName).catch(() => null);
        if (journaledRevision === undefined && beforeFacts.plan?.missing !== true) {
            reconciliations.push({
                ...base,
                resolvable: false,
                reason: "journal recorded no Plan revision, so an unchanged Plan cannot be proven",
            });
            continue;
        }
        const unchanged = beforeFacts.plan?.missing === true ? !current : current?.revision === journaledRevision;
        reconciliations.push(
            unchanged
                ? { ...base, resolvable: true, reason: "no durable effect recorded and the Plan is unchanged" }
                : { ...base, resolvable: false, reason: "the Plan changed after this transition was journaled" },
        );
    }
    if (apply) {
        for (const reconciliation of reconciliations) {
            if (!reconciliation.resolvable) continue;
            await removeJournal(projectRoot, reconciliation.transitionId);
            reconciliation.resolved = true;
        }
    }
    return reconciliations;
}

/**
 * Apply reviewed Plan markdown atomically when the original revision still matches.
 */
export async function applyReviewedPlanMarkdown(
    { projectRoot, planName, reviewedMarkdown, expectedRevision }: {
        projectRoot: string;
        planName: string;
        reviewedMarkdown: string;
        expectedRevision?: string;
    },
) {
    return await runPlanTransition({
        projectRoot,
        planName,
        operation: "plan_review_write",
        apply: async ({ beforePlan }) => {
            if (!beforePlan) throw new Error(`Plan not found: ${planName}`);
            if (expectedRevision && beforePlan.revision !== expectedRevision) {
                throw new Error("Plan changed after review opened; reload the review before applying this decision.");
            }
            await writePlanMarkdownWithRevision(beforePlan.path, reviewedMarkdown, beforePlan.revision);
            return parsePlanFrontMatter(reviewedMarkdown).attrs;
        },
    });
}

/**
 * Semantic boundary for settling an implementation checkpoint. Callers provide
 * the already-captured checkpoint proof plus the bounded implementation effect;
 * the journal records the intended postcondition for recovery/doctor scans.
 */
export async function runImplementationCheckpointTransition<T>(
    opts: TransitionOptionsBase & {
        checkpointProof?: Record<string, unknown>;
        checkpoint: (ctx: EffectTransitionContext) => Promise<T>;
    },
): Promise<TransitionResult> {
    const resources: TransitionResource[] = [{ kind: "plan", id: opts.planName }];
    if (opts.worktreeId) resources.push({ kind: "attempt", id: opts.worktreeId });
    return await runSemanticTransition({
        projectRoot: opts.projectRoot,
        planName: opts.planName,
        operation: "implementation_checkpoint",
        resources,
        expectedRevision: opts.expectedRevision,
        expectedEffects: ["implementation_checkpoint_settled"],
        apply: async (ctx) => {
            const beforeCount = ctx.beforePlan ? 0 : 0;
            const value = await opts.checkpoint(ctx);
            if (beforeCount === 0) {
                await ctx.markEffect("implementation_checkpoint_settled", opts.checkpointProof || {});
            }
            return {
                checkpointProof: opts.checkpointProof || {},
                postconditions: { planEvent: "implementation_finished", registryStatus: "completed" },
                value,
            };
        },
    });
}

/**
 * Semantic boundary for validation pass/fail/retry outcomes.
 */
export async function runValidationOutcomeTransition<T>(
    opts: TransitionOptionsBase & {
        outcome: "passed" | "failed" | "retry" | "merge_failed";
        proof?: Record<string, unknown>;
        settle: (ctx: EffectTransitionContext) => Promise<T>;
    },
): Promise<TransitionResult> {
    const resources: TransitionResource[] = [{ kind: "catalog" }, { kind: "plan", id: opts.planName }];
    if (opts.worktreeId) resources.push({ kind: "attempt", id: opts.worktreeId });
    if (opts.targetRef) resources.push({ kind: "target_ref", id: opts.targetRef });
    return await runSemanticTransition({
        projectRoot: opts.projectRoot,
        planName: opts.planName,
        operation: `validation_${opts.outcome}`,
        resources,
        expectedRevision: opts.expectedRevision,
        expectedEffects: ["validation_outcome_settled"],
        apply: async (ctx) => {
            const value = await opts.settle(ctx);
            await ctx.markEffect("validation_outcome_settled", { outcome: opts.outcome, ...(opts.proof || {}) });
            return {
                proof: opts.proof || {},
                postconditions: { outcome: opts.outcome },
                value,
            };
        },
    });
}

/**
 * Semantic boundary for proof-bearing Direct Delivery publication.
 */
export async function runDirectDeliveryPublicationTransition<T>(
    opts: TransitionOptionsBase & {
        parentPlan?: string;
        siblingPlanNames?: string[];
        publicationProof?: Record<string, unknown>;
        publish: (ctx: RollbackTransitionContext) => Promise<T>;
    },
): Promise<TransitionResult> {
    const resources: TransitionResource[] = [{ kind: "catalog" }, { kind: "plan", id: opts.planName }];
    if (opts.parentPlan) resources.push({ kind: "plan", id: opts.parentPlan });
    for (const siblingName of opts.siblingPlanNames || []) resources.push({ kind: "plan", id: siblingName });
    if (opts.worktreeId) resources.push({ kind: "attempt", id: opts.worktreeId });
    if (opts.targetRef) resources.push({ kind: "target_ref", id: opts.targetRef });
    const recoveryActions = [
        ...planAction(opts.planName),
        {
            label: "Reconcile Direct Delivery publication",
            description:
                "Inspect the transition journal, Delivery Evidence, worktree branch, and target branch head; if the validated execution commit reached the target branch, retry settlement, otherwise repair or roll back the target branch before retrying validation.",
        },
    ];
    return await runSemanticTransition({
        projectRoot: opts.projectRoot,
        planName: opts.planName,
        operation: "direct_delivery_publication",
        resources,
        expectedRevision: opts.expectedRevision,
        recoveryActions,
        postconditions: {
            planEvent: "validation_passed",
            registryStatus: "merged",
            cleanup: "post_publication",
        },
        expectedEffects: ["direct_delivery_published"],
        irreversibleEffects: ["direct_delivery_target_ref_moved"],
        apply: async (ctx) => {
            const value = await opts.publish(ctx);
            await ctx.markEffect("direct_delivery_published", opts.publicationProof || {});
            return {
                publicationProof: opts.publicationProof || {},
                postconditions: {
                    planEvent: "validation_passed",
                    registryStatus: "merged",
                    cleanup: "post_publication",
                },
                value,
            };
        },
    });
}

/**
 * Semantic boundary for Epic decomposition finalization.
 */
export async function runEpicDecompositionFinalizeTransition<T>(
    opts: TransitionOptionsBase & {
        resources: TransitionResource[];
        finalize: (ctx: EffectTransitionContext) => Promise<T & { childNames?: string[]; alreadyReady?: boolean }>;
    },
): Promise<TransitionResult> {
    return await runSemanticTransition({
        projectRoot: opts.projectRoot,
        planName: opts.planName,
        operation: "epic_decomposition_finalize",
        resources: opts.resources,
        expectedRevision: opts.expectedRevision,
        expectedEffects: ["decomposition_finalized"],
        apply: async (ctx) => {
            const value = await opts.finalize(ctx);
            await ctx.markEffect("decomposition_finalized", {
                children: Array.isArray(value?.childNames) ? value.childNames : [],
                alreadyReady: Boolean(value?.alreadyReady),
            });
            return value;
        },
    });
}

/**
 * Semantic boundary for recovery/reset/recreate/abandon actions.
 */
export async function runRecoveryTransition<T>(
    opts: TransitionOptionsBase & {
        action: "recover" | "reset" | "recreate" | "abandon";
        recover: (ctx: RollbackTransitionContext) => Promise<T>;
    },
): Promise<TransitionResult> {
    const resources: TransitionResource[] = [{ kind: "plan", id: opts.planName }];
    if (opts.worktreeId) resources.push({ kind: "attempt", id: opts.worktreeId });
    return await runSemanticTransition({
        projectRoot: opts.projectRoot,
        planName: opts.planName,
        operation: `recovery_${opts.action}`,
        resources,
        supersedesUnresolved: true,
        expectedRevision: opts.expectedRevision,
        expectedEffects: [`recovery_${opts.action}_settled`],
        apply: async (ctx) => {
            const value = await opts.recover(ctx);
            await ctx.markEffect(`recovery_${opts.action}_settled`, { action: opts.action });
            return { postconditions: { action: opts.action }, value };
        },
    });
}

/**
 * Semantic boundary for archive/restore file movement.
 */
export async function runArchiveTransition<T>(
    opts: TransitionOptionsBase & { action: "archive" | "restore"; move: (ctx: BaseTransitionContext) => Promise<T> },
): Promise<TransitionResult> {
    return await runSemanticTransition({
        projectRoot: opts.projectRoot,
        planName: opts.planName,
        operation: `plan_${opts.action}`,
        resources: [{ kind: "catalog" }, { kind: "plan", id: opts.planName }],
        expectedRevision: opts.expectedRevision,
        expectedEffects: [`archive_${opts.action}_settled`],
        apply: async (ctx) => {
            const value = await opts.move(ctx);
            await ctx.markEffect(`archive_${opts.action}_settled`, { action: opts.action });
            return { postconditions: { action: opts.action }, value };
        },
    });
}
