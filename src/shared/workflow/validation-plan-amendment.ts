/**
 * @module shared/workflow/validation-plan-amendment
 * User-approved execution-worktree Plan amendments during Workflow Validation.
 */

import { join } from "@std/path";
import {
    buildPlanDefinitionProjection,
    getPlanRevisionForText,
    injectFrontMatter,
    loadPlan,
    loadPlanStrict,
    PLAN_AMENDMENT_DEFINITION_KEYS,
    PLAN_AMENDMENT_EXECUTION_SHAPING_KEYS,
    savePlan,
    writePlanMarkdownWithRevision,
} from "../../plan-store.js";
import {
    listTransitionRecoveryRecords,
    reconcileTransitionRecoveryRecords,
    runPlanAmendmentTransition,
} from "./state-transition.ts";
import {
    classifyObjectiveChecksBaseline,
    type ObjectiveCheck,
    runObjectiveChecks,
    summarizeObjectiveChecks,
} from "./objective-checks.ts";

export type PlanAmendmentDiff = {
    field: string;
    before: string;
    after: string;
};

export type PlanAmendmentProposal = {
    planName: string;
    primaryRevision?: string;
    executionRevision?: string;
    definitionChanged: boolean;
    objectiveChecksChanged: boolean;
    changedObjectiveChecks: ObjectiveCheck[];
    diffs: PlanAmendmentDiff[];
    summary: string;
};

type PlanFrontMatter = import("../../plan-store.js").PlanFrontMatter;
type LoadedPlan = NonNullable<Awaited<ReturnType<typeof loadPlan>>>;
type ExecutionPlanRollbackState = { revision?: string };

function stringify(value: PlanFrontMatter[keyof PlanFrontMatter] | string): string {
    if (typeof value === "string") return value;
    if (value === undefined) return "<absent>";
    return JSON.stringify(value, null, 2);
}

function sameJson(
    left: PlanFrontMatter[keyof PlanFrontMatter],
    right: PlanFrontMatter[keyof PlanFrontMatter],
): boolean {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function commandById(checks: ObjectiveCheck[] | undefined): Map<string, string> {
    const result = new Map<string, string>();
    for (const check of checks || []) result.set(check.id, check.command);
    return result;
}

function checkById(checks: ObjectiveCheck[] | undefined): Map<string, ObjectiveCheck> {
    const result = new Map<string, ObjectiveCheck>();
    for (const check of checks || []) result.set(check.id, check);
    return result;
}

function changedChecks(primaryChecks: ObjectiveCheck[] | undefined, executionChecks: ObjectiveCheck[] | undefined) {
    const primary = commandById(primaryChecks);
    return (executionChecks || []).filter((check) => primary.get(check.id) !== check.command);
}

async function loadPlanForAmendment(cwd: string, planName: string, label: string): Promise<LoadedPlan> {
    const result = await loadPlanStrict(cwd, planName);
    if (result.kind === "loaded") return result;
    if (result.kind === "malformed") throw result.error;
    if (result.kind === "not_found") {
        throw new Error(`${label} Plan is missing and validation cannot safely continue: ${result.path}`);
    }
    if ("message" in result) throw new Error(result.message);
    if ("error" in result) throw new Error(result.error.message);
    throw new Error(`${label} Plan could not be loaded.`);
}

function summarizeDiffs(diffs: PlanAmendmentDiff[]): string {
    return diffs.map((diff) => {
        if (diff.field.startsWith("objectiveChecks.")) {
            return `- ${diff.field}:\n  before: ${diff.before}\n  after: ${diff.after}`;
        }
        return `- ${diff.field}: changed`;
    }).join("\n");
}

async function assertPlanFileSafe(plan: LoadedPlan, label: string): Promise<void> {
    const info = await Deno.lstat(plan.path);
    if (info.isSymlink) throw new Error(`${label} Plan file is a symlink and cannot be amended safely: ${plan.path}`);
}

function blockedExecutionShapingChanges(primary: LoadedPlan, execution: LoadedPlan): string[] {
    return PLAN_AMENDMENT_EXECUTION_SHAPING_KEYS.filter((key) =>
        !sameJson(
            primary.attrs[key as keyof PlanFrontMatter],
            execution.attrs[key as keyof PlanFrontMatter],
        )
    );
}

function assertMatchingPlanIdentity(primary: LoadedPlan, execution: LoadedPlan, planName: string): void {
    if (!primary.attrs.planId || !execution.attrs.planId) {
        throw new Error(
            `Execution-worktree Plan identity is missing for ${planName}; user review is required before a Plan amendment can be proposed.`,
        );
    }
    if (primary.attrs.planId !== execution.attrs.planId) {
        throw new Error(
            `Execution-worktree Plan identity does not match the primary Plan for ${planName}; user review is required.`,
        );
    }
}

export async function detectValidationPlanAmendment(
    projectRoot: string,
    executionCwd: string,
    planName: string,
): Promise<PlanAmendmentProposal | null> {
    if (projectRoot === executionCwd) return null;
    const primary = await loadPlanForAmendment(projectRoot, planName, "Primary");
    const execution = await loadPlanForAmendment(executionCwd, planName, "Execution-worktree");
    await assertPlanFileSafe(primary, "Primary");
    await assertPlanFileSafe(execution, "Execution-worktree");

    const diffs: PlanAmendmentDiff[] = [];
    if (primary.body !== execution.body) {
        diffs.push({ field: "body", before: primary.body, after: execution.body });
    }
    for (const key of PLAN_AMENDMENT_DEFINITION_KEYS) {
        const primaryValue = primary.attrs[key as keyof PlanFrontMatter];
        const executionValue = execution.attrs[key as keyof PlanFrontMatter];
        if (sameJson(primaryValue, executionValue)) continue;
        if (key === "objectiveChecks") {
            const primaryChecks = checkById(primary.attrs.objectiveChecks);
            for (const check of execution.attrs.objectiveChecks || []) {
                const previous = primaryChecks.get(check.id);
                if (!previous) {
                    diffs.push({ field: `objectiveChecks.${check.id}.id`, before: "<absent>", after: check.id });
                    diffs.push({
                        field: `objectiveChecks.${check.id}.command`,
                        before: "<absent>",
                        after: check.command,
                    });
                    if (check.rationale !== undefined) {
                        diffs.push({
                            field: `objectiveChecks.${check.id}.rationale`,
                            before: "<absent>",
                            after: check.rationale,
                        });
                    }
                    continue;
                }
                if (previous.command !== check.command) {
                    diffs.push({
                        field: `objectiveChecks.${check.id}.command`,
                        before: previous.command,
                        after: check.command,
                    });
                }
                if ((previous.rationale ?? null) !== (check.rationale ?? null)) {
                    diffs.push({
                        field: `objectiveChecks.${check.id}.rationale`,
                        before: previous.rationale ?? "<absent>",
                        after: check.rationale ?? "<absent>",
                    });
                }
            }
            const executionIds = new Set((execution.attrs.objectiveChecks || []).map((check) => check.id));
            for (const check of primary.attrs.objectiveChecks || []) {
                if (!executionIds.has(check.id)) {
                    diffs.push({
                        field: `objectiveChecks.${check.id}`,
                        before: stringify(check.command),
                        after: "<removed>",
                    });
                }
            }
        } else {
            diffs.push({ field: key, before: stringify(primaryValue), after: stringify(executionValue) });
        }
    }
    if (!diffs.length) return null;
    assertMatchingPlanIdentity(primary, execution, planName);
    const blocked = blockedExecutionShapingChanges(primary, execution);
    if (blocked.length) {
        throw new Error(
            `Execution-worktree Plan changed execution-shaping field(s) ${
                blocked.join(", ")
            }; fresh Plan review is required.`,
        );
    }
    const objectiveChanges = changedChecks(primary.attrs.objectiveChecks, execution.attrs.objectiveChecks);
    return {
        planName,
        primaryRevision: primary.revision,
        executionRevision: execution.revision,
        definitionChanged: true,
        objectiveChecksChanged: diffs.some((diff) => diff.field.startsWith("objectiveChecks.")),
        changedObjectiveChecks: objectiveChanges,
        diffs,
        summary: `Execution-worktree Plan amendment proposed for ${planName}:\n${summarizeDiffs(diffs)}`,
    };
}

async function materializeTreeCheckout(cwd: string, tree: string): Promise<string> {
    const temp = await Deno.makeTempDir({ prefix: "runwield-objective-baseline-" });
    const command = new Deno.Command("bash", {
        cwd,
        args: ["-lc", `set -euo pipefail; git archive ${tree} | tar -x -C "$1"`, "bash", temp],
        stdout: "piped",
        stderr: "piped",
    });
    const output = await command.output();
    if (output.code !== 0) {
        await Deno.remove(temp, { recursive: true }).catch(() => undefined);
        const decoder = new TextDecoder();
        throw new Error(`Could not materialize execution baseline tree ${tree}: ${decoder.decode(output.stderr)}`);
    }
    return temp;
}

export async function validateAmendedObjectiveChecksAgainstBaseline(
    executionCwd: string,
    baselineTree: string | undefined,
    checks: ObjectiveCheck[],
): Promise<void> {
    if (!checks.length) return;
    if (!baselineTree) throw new Error("Changed Objective-Failing Checks need a recorded execution baseline tree.");
    const baselineCwd = await materializeTreeCheckout(executionCwd, baselineTree);
    try {
        const results = await runObjectiveChecks({ checks, cwd: baselineCwd });
        const classification = classifyObjectiveChecksBaseline(results);
        if (classification.status !== "all_unmet") {
            const summary = summarizeObjectiveChecks(classification.offendingResults).block;
            throw new Error(
                `Changed Objective-Failing Checks are not red against the recorded execution baseline.\n\n${summary}`,
            );
        }
    } finally {
        await Deno.remove(baselineCwd, { recursive: true }).catch(() => undefined);
    }
}

function acceptedAttrs(primary: LoadedPlan, execution: LoadedPlan): PlanFrontMatter {
    const next = { ...primary.attrs } as PlanFrontMatter;
    const executionProjection = buildPlanDefinitionProjection(execution.attrs, execution.body);
    for (const key of PLAN_AMENDMENT_DEFINITION_KEYS) {
        const value = executionProjection.attrs[key];
        if (value === undefined) delete (next as Record<string, PlanFrontMatter[keyof PlanFrontMatter]>)[key];
        else {(next as Record<string, PlanFrontMatter[keyof PlanFrontMatter]>)[key] =
                value as PlanFrontMatter[keyof PlanFrontMatter];}
    }
    return next;
}

function filterWaiversForCurrentCommands(attrs: PlanFrontMatter): PlanFrontMatter["objectiveCheckWaivers"] {
    const currentCommands = commandById(attrs.objectiveChecks);
    return (attrs.objectiveCheckWaivers || []).filter((waiver) => currentCommands.get(waiver.id) === waiver.command);
}

type AmendmentSyncProof = {
    executionCwd?: string;
    primaryRevision?: string;
    executionRevision?: string;
    canonicalRevision?: string;
    canonicalMarkdown?: string;
};

type AmendmentJournalRecord = {
    operation?: string;
    planName?: string;
    completedEffects?: Array<{ effect?: string; proof?: AmendmentSyncProof }>;
};

/** Finish an accepted primary-to-execution write after process loss. */
export async function resumeValidationPlanAmendment(
    projectRoot: string,
    planName: string,
): Promise<boolean> {
    const records = await listTransitionRecoveryRecords(projectRoot) as AmendmentJournalRecord[];
    const record = records.find((candidate) =>
        candidate.operation === "validation_plan_amendment" && candidate.planName === planName
    );
    const intent = record?.completedEffects?.find((effect) => effect.effect === "plan_amendment_sync_required")?.proof;
    if (
        !record || !intent?.executionCwd || !intent.primaryRevision || !intent.executionRevision ||
        !intent.canonicalRevision || !intent.canonicalMarkdown
    ) return false;
    const executionCwd = intent.executionCwd;
    const primary = await loadPlan(projectRoot, planName);
    const execution = await loadPlan(executionCwd, planName);
    if (!primary || !execution) throw new Error(`Plan amendment recovery could not load ${planName}.`);
    if (primary.revision === intent.primaryRevision) {
        await writePlanMarkdownWithRevision(primary.path, intent.canonicalMarkdown, primary.revision);
    } else if (primary.revision !== intent.canonicalRevision) {
        throw new Error(`The primary Plan changed after its amendment was approved: ${planName}.`);
    }
    if (execution.revision === intent.executionRevision) {
        await writePlanMarkdownWithRevision(execution.path, intent.canonicalMarkdown, execution.revision);
    } else if (execution.revision !== intent.canonicalRevision) {
        throw new Error(`The execution Plan changed after its amendment was approved: ${planName}.`);
    }
    await reconcileTransitionRecoveryRecords(projectRoot, {
        apply: true,
        proveEffect: async (_effect, journal) => {
            if (journal.operation !== "validation_plan_amendment" || journal.planName !== planName) {
                return { settled: false, reason: "this repair owns another operation" };
            }
            const canonical = await loadPlan(projectRoot, planName);
            const copy = await loadPlan(executionCwd, planName);
            const settled = canonical?.revision === intent.canonicalRevision &&
                copy?.revision === intent.canonicalRevision;
            return { settled, reason: settled ? "both Plan copies match" : "Plan copies do not match" };
        },
    });
    return true;
}

export async function applyValidationPlanAmendment(
    projectRoot: string,
    executionCwd: string,
    planName: string,
    proposal: PlanAmendmentProposal,
    worktreeId?: string,
): Promise<LoadedPlan> {
    const transition = await runPlanAmendmentTransition<LoadedPlan>({
        projectRoot,
        planName,
        worktreeId,
        expectedRevision: proposal.primaryRevision,
        settle: async ({ markEffect, registerRollback }) => {
            const primary = await loadPlanForAmendment(projectRoot, planName, "Primary");
            const execution = await loadPlanForAmendment(executionCwd, planName, "Execution-worktree");
            await assertPlanFileSafe(primary, "Primary");
            await assertPlanFileSafe(execution, "Execution-worktree");
            if (proposal.primaryRevision && primary.revision !== proposal.primaryRevision) {
                throw new Error("Primary Plan changed while the amendment was awaiting approval. Review the new diff.");
            }
            if (proposal.executionRevision && execution.revision !== proposal.executionRevision) {
                throw new Error(
                    "Execution-worktree Plan changed while the amendment was awaiting approval. Review the new diff.",
                );
            }
            let nextAttrs = acceptedAttrs(primary, execution);
            if (proposal.objectiveChecksChanged) {
                nextAttrs = {
                    ...nextAttrs,
                    objectiveChecksBaseline: undefined,
                    objectiveCheckWaivers: filterWaiversForCurrentCommands(nextAttrs),
                };
            }
            const canonicalMarkdown = injectFrontMatter(execution.body, nextAttrs);
            const canonicalRevision = await getPlanRevisionForText(canonicalMarkdown);
            await markEffect("plan_amendment_sync_required", {
                executionCwd,
                primaryRevision: primary.revision,
                executionRevision: execution.revision,
                canonicalRevision,
                canonicalMarkdown,
            });
            await savePlan(projectRoot, planName, execution.body, nextAttrs, { expectedRevision: primary.revision });
            const canonical = await loadPlan(projectRoot, planName);
            if (!canonical) throw new Error(`Primary Plan disappeared after applying amendment: ${planName}`);
            await markEffect("primary_plan_amended", { revision: canonical.revision });
            const executionRollback: ExecutionPlanRollbackState = {};
            registerRollback("restore execution Plan before amendment synchronization", async () => {
                if (!executionRollback.revision) return;
                await savePlan(executionCwd, planName, execution.body, execution.attrs, {
                    expectedRevision: executionRollback.revision,
                });
            });
            await savePlan(executionCwd, planName, canonical.body, canonical.attrs, {
                expectedRevision: execution.revision,
            });
            const reconciled = await loadPlan(executionCwd, planName);
            if (!reconciled) throw new Error(`Execution Plan disappeared after applying amendment: ${planName}`);
            executionRollback.revision = reconciled.revision;
            if (
                canonical.body !== reconciled.body ||
                JSON.stringify(canonical.attrs) !== JSON.stringify(reconciled.attrs)
            ) {
                throw new Error(`Plan amendment synchronization did not produce matching Plan copies for ${planName}.`);
            }
            await markEffect("execution_plan_synchronized", { revision: reconciled.revision });
            // Prove the canonical file is still under the expected docs/plans location. This catches path surprises early.
            if (
                !canonical.path.endsWith(join("docs", "plans", `${planName}.md`)) &&
                !canonical.path.includes(join("docs", "plans"))
            ) {
                throw new Error(`Plan amendment wrote an unexpected primary Plan path: ${canonical.path}`);
            }
            return canonical;
        },
        verifyAmendment: (canonical) => ({ revision: canonical.revision || "" }),
    });
    if (transition.status !== "committed") {
        throw new Error(
            transition.status === "needs_recovery"
                ? `Plan Amendment needs recovery before validation can continue. ${
                    transition.message || "Inspect the transition journal with wld plans doctor."
                }`
                : transition.message || `Plan Amendment did not commit: ${transition.status}`,
        );
    }
    return transition.value as LoadedPlan;
}
