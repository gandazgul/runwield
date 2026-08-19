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

type ObjectiveCheckFeedback = {
    id: string;
    added?: boolean;
    deleted?: boolean;
    commandBefore?: string;
    commandAfter?: string;
    rationaleBefore?: string;
    rationaleAfter?: string;
};

function summarizeObjectiveCheckFeedback(diffs: PlanAmendmentDiff[]): string[] {
    const feedback = new Map<string, ObjectiveCheckFeedback>();
    for (const diff of diffs) {
        const match = /^objectiveChecks\.([^.]+)(?:\.(id|command|rationale))?$/.exec(diff.field);
        if (!match) continue;
        const [, id, field] = match;
        const item = feedback.get(id) || { id };
        if (!field && diff.after === "<removed>") {
            item.deleted = true;
            item.commandBefore = diff.before;
        } else if (field === "id" && diff.before === "<absent>") {
            item.added = true;
        } else if (field === "command") {
            item.commandBefore = diff.before;
            item.commandAfter = diff.after;
        } else if (field === "rationale") {
            item.rationaleBefore = diff.before;
            item.rationaleAfter = diff.after;
        }
        feedback.set(id, item);
    }
    return [...feedback.values()].flatMap((item) => {
        if (item.deleted) {
            return [`- Delete ${item.id}\n  current command: ${item.commandBefore || "<unknown>"}`];
        }
        if (item.added) {
            return [`- Add ${item.id}\n  proposed command: ${item.commandAfter || "<unknown>"}`];
        }
        const lines = [`- Change ${item.id}`];
        if (item.commandBefore !== undefined || item.commandAfter !== undefined) {
            lines.push(`  before command: ${item.commandBefore || "<unknown>"}`);
            lines.push(`  after command: ${item.commandAfter || "<unknown>"}`);
        }
        if (item.rationaleBefore !== undefined || item.rationaleAfter !== undefined) {
            lines.push(`  before rationale: ${item.rationaleBefore || "<absent>"}`);
            lines.push(`  after rationale: ${item.rationaleAfter || "<absent>"}`);
        }
        return [lines.join("\n")];
    });
}

function summarizeProposal(planName: string, diffs: PlanAmendmentDiff[]): string {
    const objectiveFeedback = summarizeObjectiveCheckFeedback(diffs);
    const otherFields = diffs.filter((diff) => !diff.field.startsWith("objectiveChecks."));
    const sections: string[] = [];
    if (objectiveFeedback.length) {
        sections.push(
            `The Engineer gave feedback about the Objective-Failing Checks for ${planName}:`,
            objectiveFeedback.join("\n"),
        );
    }
    if (otherFields.length) {
        sections.push(
            `The Engineer also offered a Plan amendment for ${planName}:`,
            otherFields.map((diff) => `- ${diff.field}: changed`).join("\n"),
        );
    }
    return sections.join("\n\n");
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
        summary: summarizeProposal(planName, diffs),
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
            let nextAttrs = { ...execution.attrs };
            if (proposal.objectiveChecksChanged) {
                nextAttrs = {
                    ...nextAttrs,
                    objectiveChecksBaseline: undefined,
                    objectiveCheckWaivers: filterWaiversForCurrentCommands(nextAttrs),
                };
            }
            await savePlan(executionCwd, planName, execution.body, nextAttrs, {
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
