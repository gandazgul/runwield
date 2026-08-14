/**
 * @module shared/workflow/validation-plan-amendment
 * User-approved execution-worktree Plan amendments during Workflow Validation.
 */

import { join } from "@std/path";
import {
    buildPlanDefinitionProjection,
    getPlanRevisionForText,
    getStoredPlanPath,
    injectFrontMatter,
    loadPlan,
    PLAN_AMENDMENT_DEFINITION_KEYS,
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

function changedChecks(primaryChecks: ObjectiveCheck[] | undefined, executionChecks: ObjectiveCheck[] | undefined) {
    const primary = commandById(primaryChecks);
    return (executionChecks || []).filter((check) => primary.get(check.id) !== check.command);
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

export async function detectValidationPlanAmendment(
    projectRoot: string,
    executionCwd: string,
    planName: string,
): Promise<PlanAmendmentProposal | null> {
    if (projectRoot === executionCwd) return null;
    const primary = await loadPlan(projectRoot, planName);
    const execution = await loadPlan(executionCwd, planName);
    if (!primary || !execution) return null;
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
            const primaryCommands = commandById(primary.attrs.objectiveChecks);
            for (const check of execution.attrs.objectiveChecks || []) {
                const previous = primaryCommands.get(check.id);
                if (previous !== check.command) {
                    diffs.push({
                        field: `objectiveChecks.${check.id}.command`,
                        before: previous || "<absent>",
                        after: check.command,
                    });
                }
            }
            const executionIds = new Set((execution.attrs.objectiveChecks || []).map((check) => check.id));
            for (const check of primary.attrs.objectiveChecks || []) {
                if (!executionIds.has(check.id)) {
                    diffs.push({ field: `objectiveChecks.${check.id}`, before: check.command, after: "<removed>" });
                }
            }
        } else {
            diffs.push({ field: key, before: stringify(primaryValue), after: stringify(executionValue) });
        }
    }
    if (!diffs.length) return null;
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
    transitionId?: string;
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
): Promise<LoadedPlan> {
    const primary = await loadPlan(projectRoot, planName);
    const execution = await loadPlan(executionCwd, planName);
    if (!primary || !execution) throw new Error(`Plan disappeared while applying amendment: ${planName}`);
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
    const transition = await runPlanAmendmentTransition({
        projectRoot,
        planName,
        worktreeId: typeof primary.attrs.worktreeId === "string" ? primary.attrs.worktreeId : undefined,
        expectedRevision: primary.revision,
        apply: async ({ markEffect }) => {
            await markEffect("plan_amendment_sync_required", {
                executionCwd,
                primaryRevision: primary.revision,
                executionRevision: execution.revision,
                canonicalRevision,
                canonicalMarkdown,
            });
            await writePlanMarkdownWithRevision(primary.path, canonicalMarkdown, primary.revision);
            await markEffect("primary_plan_amended", { canonicalRevision });
            await writePlanMarkdownWithRevision(
                getStoredPlanPath(executionCwd, planName),
                canonicalMarkdown,
                execution.revision,
            );
            await markEffect("execution_plan_synchronized", { executionCwd, canonicalRevision });
            return { canonicalRevision };
        },
    });
    if (transition.status !== "committed") {
        throw new Error(transition.message || `Plan amendment needs recovery for ${planName}.`);
    }
    const canonical = await loadPlan(projectRoot, planName);
    const reconciled = await loadPlan(executionCwd, planName);
    if (!canonical || !reconciled) throw new Error(`Plan disappeared after applying amendment: ${planName}`);
    if (canonical.revision !== canonicalRevision || reconciled.revision !== canonicalRevision) {
        throw new Error(`Plan amendment synchronization did not produce matching Plan copies for ${planName}.`);
    }
    // Prove the canonical file is still under the expected docs/plans location. This catches path surprises early.
    if (
        !canonical.path.endsWith(join("docs", "plans", `${planName}.md`)) &&
        !canonical.path.includes(join("docs", "plans"))
    ) {
        throw new Error(`Plan amendment wrote an unexpected primary Plan path: ${canonical.path}`);
    }
    return canonical;
}
