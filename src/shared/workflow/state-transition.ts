/**
 * @module shared/workflow/state-transition
 * Transaction boundary helpers for Plan Lifecycle mutations.
 */

import { dirname, join } from "@std/path";
import { AsyncLocalStorage } from "node:async_hooks";
import { PLAN_TRANSITIONS_DIR_NAME, RUNWIELD_DIR_NAME } from "../../constants.js";
import {
    atomicWriteTextFile,
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
        settleSuccessfulRollback = false,
        settleSuccessfulRollbackUnlessEffects = [],
        settleNoEffectFailure = false,
    }: TransitionOptionsBase & {
        operation: string;
        resources: TransitionResource[];
        apply: (ctx: RollbackTransitionContext & { expectedRevision?: string }) => Promise<T>;
        recoveryActions?: TransitionRecoveryAction[];
        postconditions?: Record<string, unknown>;
        expectedEffects?: string[];
        verify?: (value: T) => Promise<Record<string, unknown> | void>;
        settleSuccessfulRollback?: boolean;
        settleSuccessfulRollbackUnlessEffects?: string[];
        settleNoEffectFailure?: boolean;
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
                if (conflictingRecoveryRecord) {
                    const message = `Unresolved lifecycle transition ${
                        conflictingRecoveryRecord.transitionId || "unknown"
                    } must be recovered before starting ${operation} for ${planName}.`;
                    return { status: "blocked", transitionId, operation, message, recoveryActions: actions };
                }
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
                    /** @type {Array<{ label: string, status: "rolled_back"|"failed", error?: string }>} */
                    const rollbackResults = [];
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
                    const rollbackSucceeded = rollbackResults.length > 0 &&
                        rollbackResults.every((result) => result.status === "rolled_back");
                    const completedEffectNames = new Set(completedEffects.map((effect) => effect.effect));
                    const rollbackCanSettle = rollbackSucceeded &&
                        !settleSuccessfulRollbackUnlessEffects.some((effect) => completedEffectNames.has(effect));
                    if (
                        (settleNoEffectFailure && completedEffects.length === 0) ||
                        (settleSuccessfulRollback && rollbackCanSettle)
                    ) {
                        if (settleSuccessfulRollback && rollbackSucceeded) {
                            await writeState("rolled_back", {
                                error: message,
                                rolledBackAt: new Date().toISOString(),
                                rollbackResults,
                            });
                        }
                        await removeJournal(projectRoot, transitionId);
                        return { status: "rolled_back", transitionId, operation, message, recoveryActions: actions };
                    }
                    await writeState("needs_recovery", {
                        error: message,
                        currentPlanRevision: beforePlan
                            ? (await loadPlan(projectRoot, planName).catch(() => null))?.revision
                            : undefined,
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
            if (!beforePlan) {
                await removeJournal(projectRoot, transitionId);
            } else {
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
            }
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
        settleNoEffectFailure: true,
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
        settleSuccessfulRollback: true,
        settleSuccessfulRollbackUnlessEffects: ["direct_delivery_target_ref_moved"],
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
