/**
 * @module shared/workflow/validation-plan-amendment
 * User-approved execution-worktree Plan amendments during Workflow Validation.
 */

import {
    getPlanRevisionForText,
    loadPlan,
    loadPlanStrict,
    parsePlanFrontMatter,
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

function summarizeProposal(planName: string, diffs: PlanAmendmentDiff[]): string {
    return [
        `The Engineer offered a Plan amendment for ${planName}:`,
        diffs.map((diff) => `- ${diff.field}: changed`).join("\n"),
    ].join("\n\n");
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
            `The Plan identity changed during this execution attempt; user review is required for ${planName}.`,
        );
    }
}

export async function detectValidationPlanAmendment(
    projectRoot: string,
    executionCwd: string,
    planName: string,
    baselineCommit?: string,
): Promise<PlanAmendmentProposal | null> {
    if (projectRoot === executionCwd) return null;
    const execution = await loadPlanForAmendment(executionCwd, planName, "Execution-worktree");
    await assertPlanFileSafe(execution, "Execution-worktree");
    let primary: LoadedPlan;
    if (baselineCommit) {
        const relativePath = `docs/plans/${planName}.md`;
        const output = await new Deno.Command("git", {
            cwd: executionCwd,
            args: ["show", `${baselineCommit}:${relativePath}`],
            stdout: "piped",
            stderr: "piped",
        }).output();
        if (output.code !== 0) {
            throw new Error(`The execution Plan baseline is unavailable for ${planName}.`);
        }
        const markdown = new TextDecoder().decode(output.stdout);
        const parsed = parsePlanFrontMatter(markdown);
        primary = {
            ...execution,
            attrs: parsed.attrs,
            body: parsed.body,
            markdown,
            revision: await getPlanRevisionForText(markdown),
        };
    } else {
        primary = await loadPlanForAmendment(projectRoot, planName, "Plan baseline");
    }

    const diffs: PlanAmendmentDiff[] = [];
    if (primary.body !== execution.body) {
        diffs.push({ field: "body", before: primary.body, after: execution.body });
    }
    for (const key of PLAN_AMENDMENT_DEFINITION_KEYS) {
        const primaryValue = primary.attrs[key as keyof PlanFrontMatter];
        const executionValue = execution.attrs[key as keyof PlanFrontMatter];
        if (sameJson(primaryValue, executionValue)) continue;
        diffs.push({ field: key, before: stringify(primaryValue), after: stringify(executionValue) });
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
    return {
        planName,
        primaryRevision: primary.revision,
        executionRevision: execution.revision,
        definitionChanged: true,
        diffs,
        summary: summarizeProposal(planName, diffs),
    };
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

/** Finish a legacy accepted amendment in the execution worktree after process loss. */
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
        !record || !intent?.executionCwd || !intent.executionRevision ||
        !intent.canonicalRevision || !intent.canonicalMarkdown
    ) return false;
    const executionCwd = intent.executionCwd;
    const execution = await loadPlan(executionCwd, planName);
    if (!execution) throw new Error(`Plan amendment recovery could not load ${planName}.`);
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
            const copy = await loadPlan(executionCwd, planName);
            const settled = copy?.revision === intent.canonicalRevision;
            return { settled, reason: settled ? "execution Plan matches" : "execution Plan does not match" };
        },
    });
    return true;
}

export async function applyValidationPlanAmendment(
    _projectRoot: string,
    executionCwd: string,
    planName: string,
    proposal: PlanAmendmentProposal,
    worktreeId?: string,
): Promise<LoadedPlan> {
    const transition = await runPlanAmendmentTransition<LoadedPlan>({
        projectRoot: executionCwd,
        planName,
        worktreeId,
        expectedRevision: proposal.executionRevision,
        settle: async ({ markEffect }) => {
            const execution = await loadPlanForAmendment(executionCwd, planName, "Execution-worktree");
            await assertPlanFileSafe(execution, "Execution-worktree");
            if (proposal.executionRevision && execution.revision !== proposal.executionRevision) {
                throw new Error(
                    "Execution-worktree Plan changed while the amendment was awaiting approval. Review the new diff.",
                );
            }
            await savePlan(executionCwd, planName, execution.body, execution.attrs, {
                expectedRevision: execution.revision,
            });
            const reconciled = await loadPlan(executionCwd, planName);
            if (!reconciled) throw new Error(`Execution Plan disappeared after applying amendment: ${planName}`);
            await markEffect("execution_plan_amended", { revision: reconciled.revision });
            return reconciled;
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
