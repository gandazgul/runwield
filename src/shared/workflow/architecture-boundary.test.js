import { assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "../../..");

/** @param {string} path */
function repoPath(path) {
    return join(REPO_ROOT, path);
}

const HIGH_LEVEL_FILES = [
    "src/shared/workflow/workflow.js",
    "src/shared/workflow/validation.js",
    "src/cmd/load-plan/index.js",
    "src/ui/workspace/server/plan-adapter.js",
];

/** @type {[string, RegExp][]} */
const RAW_LIFECYCLE_PATTERNS = [
    ["updatePlanStatus", /updatePlanStatus\s*\(/],
    ["unscoped updatePlanFrontMatter", /updatePlanFrontMatter\s*\(/],
];

/**
 * @param {string} text
 * @param {number} index
 */
function isInsideSemanticTransitionApply(text, index) {
    const window = text.slice(Math.max(0, index - 2000), index);
    return /run(?:Recovery|ValidationOutcome|DirectDeliveryPublication|ExecutionPreparation|ImplementationCheckpoint|Archive|PlanFrontMatter|ReviewReopen|PlanLifecycleEvent|PlanReviewDecision)Transition\s*\([\s\S]*(?:recover|settle|publish|prepare|checkpoint|move|reopen|record|decide|apply)\s*:\s*async/
        .test(
            window,
        );
}

Deno.test("high-level lifecycle callers use Plan Lifecycle APIs instead of raw Plan status writes", async () => {
    const offenders = [];
    for (const file of HIGH_LEVEL_FILES) {
        const text = await Deno.readTextFile(repoPath(file));
        for (const [label, pattern] of RAW_LIFECYCLE_PATTERNS) {
            for (const match of text.matchAll(new RegExp(pattern.source, "g"))) {
                if (label === "unscoped updatePlanFrontMatter") {
                    const priorLine = text.slice(Math.max(0, (match.index || 0) - 120), match.index || 0);
                    if (/updatePlanFrontMatter\s*!==\s*updatePlanFrontMatterFn/.test(priorLine)) continue;
                    if (isInsideSemanticTransitionApply(text, match.index || 0)) continue;
                }
                offenders.push(`${file}: ${label}`);
            }
        }
    }
    assertEquals(offenders, []);
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
        "runDirectDeliveryPublicationTransition",
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
