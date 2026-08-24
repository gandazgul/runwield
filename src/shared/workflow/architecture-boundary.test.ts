import { assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "../../..");

function repoPath(path: string): string {
    return join(REPO_ROOT, path);
}

const PLAN_RECOVERY_FILES = [
    "src/cmd/load-plan/plan-recovery-flow.ts",
    "src/cmd/load-plan/plan-recovery-actions.ts",
    "src/cmd/load-plan/plan-recovery-reset.ts",
];

const HIGH_LEVEL_FILES = [
    "src/shared/workflow/workflow.js",
    "src/shared/workflow/execution-start.ts",
    "src/shared/workflow/implementation-checkpoint.ts",
    "src/shared/workflow/plan-executor.ts",
    "src/shared/workflow/validation.ts",
    "src/shared/workflow/validation-engine.ts",
    "src/shared/workflow/validation-mechanical.ts",
    "src/shared/workflow/validation-semantic.ts",
    "src/shared/workflow/validation-human-review.ts",
    "src/shared/workflow/validation-publication.ts",
    "src/shared/workflow/validation-merge-repair.ts",
    "src/cmd/load-plan/index.ts",
    ...PLAN_RECOVERY_FILES,
    "src/ui/workspace/server/plan-adapter.js",
];

const RAW_LIFECYCLE_PATTERNS: [string, RegExp][] = [
    ["updatePlanStatus", /updatePlanStatus\s*\(/],
    ["unscoped updatePlanFrontMatter", /updatePlanFrontMatter\s*\(/],
];

function isInsideSemanticTransitionApply(text: string, index: number): boolean {
    const window = text.slice(Math.max(0, index - 5000), index);
    return /run(?:Recovery|ValidationOutcome|ExecutionPreparation|ImplementationCheckpoint|Archive|PlanFrontMatter|ReviewReopen|PlanLifecycleEvent|PlanReviewDecision)Transition\s*\([\s\S]*(?:recover|settle|prepare|checkpoint|move|reopen|record|decide|apply)\s*:\s*async/
        .test(
            window,
        );
}

Deno.test("high-level lifecycle callers use Plan Lifecycle APIs instead of raw Plan status writes", async () => {
    const offenders: string[] = [];
    for (const file of HIGH_LEVEL_FILES) {
        const text = await Deno.readTextFile(repoPath(file));
        for (const [label, pattern] of RAW_LIFECYCLE_PATTERNS) {
            for (const match of text.matchAll(new RegExp(pattern.source, "g"))) {
                const index = match.index ?? 0;
                if (label === "unscoped updatePlanFrontMatter") {
                    const priorLine = text.slice(Math.max(0, index - 120), index);
                    if (/updatePlanFrontMatter\s*!==\s*updatePlanFrontMatterFn/.test(priorLine)) continue;
                    if (isInsideSemanticTransitionApply(text, index)) continue;
                }
                offenders.push(`${file}: ${label}`);
            }
        }
    }
    assertEquals(offenders, []);
});

Deno.test("Git publication uses the durable publication machine instead of recovery actions", async () => {
    const publication = await Deno.readTextFile(repoPath("src/shared/workflow/validation-publication.ts"));
    const recovery = (await Promise.all(PLAN_RECOVERY_FILES.map((file) => Deno.readTextFile(repoPath(file))))).join(
        "\n",
    );
    assertEquals(publication.includes("startPublicationAttempt"), true);
    assertEquals(publication.includes("advanceStoredPublication"), true);
    assertEquals(publication.includes("reconcileStoredPublication"), true);
    assertEquals(recovery.includes("mergeExecutionWorktree("), false);
});

Deno.test("transition wrappers expose expected revision preconditions for lifecycle writers", async () => {
    const text = await Deno.readTextFile(repoPath("src/shared/workflow/state-transition.ts"));
    const wrappers = [
        "runPlanLifecycleEventTransition",
        "runPlanReviewDecisionTransition",
        "runReviewReopenTransition",
        "runPlanFrontMatterTransition",
        "runExecutionPreparationTransition",
        "runValidationOutcomeTransition",
        "runRecoveryTransition",
        "runArchiveTransition",
    ];
    const offenders = wrappers.filter((name) => {
        const start = text.indexOf(`export async function ${name}`);
        if (start === -1) return true;
        const body = text.slice(start, text.indexOf("\n}\n", start) + 3);
        return !/expectedRevision/.test(body);
    });
    assertEquals(offenders, []);
});

Deno.test("Agent Plan creation uses create-if-absent instead of rename-over writes", async () => {
    const text = await Deno.readTextFile(repoPath("src/tools/plan-safe-file-tools.ts"));
    assertEquals(/atomicWriteTextFileIfAbsent\s*\(/.test(text), true);
    assertEquals(/atomicWriteTextFile\s*\(/.test(text), false);
});
