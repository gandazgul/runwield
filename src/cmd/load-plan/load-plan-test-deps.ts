/**
 * @module cmd/load-plan/load-plan-test-deps
 * The collaborators `runLoadPlanCommand` accepts stand-ins for.
 *
 * Everything here is *environment*: argument parsing, agent invocations,
 * read-only queries, and Git inspection. RunWield's own state — Plan writes,
 * lifecycle transitions, registry writes, locks — is deliberately absent, and
 * `scripts/check-injection-seams.js` fails the build if any of it reappears.
 */

import type { parseArgs as parseArgsFn } from "@std/cli/parse-args";
import type { printCommandHelp as printCommandHelpFn } from "../help/index.js";
import type {
    archivePlan as archivePlanFn,
    findPlansByParent as findPlansByParentFn,
    loadPlan as loadPlanFn,
    PlanFrontMatter,
    resolvePlan as resolvePlanFn,
    resolveSiblingChildPlanDependencies as resolveSiblingChildPlanDependenciesFn,
} from "../../plan-store.js";
import type { startInteractiveSession as startInteractiveSessionFn } from "../../ui/tui/chat-session.js";
import type { setTerminalTitleForName as setTerminalTitleForNameFn } from "../../ui/tui/terminal-title.js";
import type { probeGitRepository as probeGitRepositoryFn } from "../../shared/git.js";
import type { shouldCleanupMergedWorktrees as shouldCleanupMergedWorktreesFn } from "../../shared/settings.js";
import type {
    decidePostExecution as decidePostExecutionFn,
    decidePostPlanning as decidePostPlanningFn,
} from "../../shared/workflow/decisions.js";
import type { finalizePlanImplementation as finalizePlanImplementationFn } from "../../shared/workflow/workflow.js";
import type {
    getWorkflowDiff as getWorkflowDiffFn,
    listCommitsTouchingPathsSince as listCommitsTouchingPathsSinceFn,
    restoreWorktreeTree as restoreWorktreeTreeFn,
} from "../../shared/workflow/git-snapshot.js";
import type { resolveValidationExecutionContext } from "../../shared/workflow/execution-context.ts";
import type { recordWorkflowMetric } from "../../shared/workflow/metrics.js";
import type {
    getBranchHead,
    getWorktreeStatus as getWorktreeStatusFn,
    inspectExecutionWorktreeMergeRisk as inspectExecutionWorktreeMergeRiskFn,
    isCommitAncestorOfBranch,
} from "../../shared/worktree.js";
import type {
    findById as findWorktreeByIdFn,
    findByPlanName as findWorktreeByPlanNameFn,
} from "../../shared/worktree-registry.js";
import type { autoGenerateWorkRecordForCompletedPlan as autoGenerateWorkRecordForCompletedPlanFn } from "../../shared/work-records/auto-generation.js";
import type { PlanSessionSurface } from "./plan-session-types.ts";

/** A Plan as the catalogue lists it, with Front Matter possibly partial. */
export interface ListedPlanSummary {
    name: string;
    attrs: Partial<PlanFrontMatter>;
}

export interface LoadPlanTestDeps {
    parseArgs?: typeof parseArgsFn;
    printCommandHelp?: typeof printCommandHelpFn;
    startInteractiveSession?: typeof startInteractiveSessionFn;
    resolvePlan?: typeof resolvePlanFn;
    executePlan?: PlanSessionSurface["executePlan"];
    runPlanningAgent?: PlanSessionSurface["runPlanningAgent"];
    decidePostPlanning?: typeof decidePostPlanningFn;
    decidePostExecution?: typeof decidePostExecutionFn;
    runValidationLoop?: PlanSessionSurface["runValidation"];
    runSlicerAgent?: PlanSessionSurface["runSlicerAgent"];
    finalizePlanImplementation?: typeof finalizePlanImplementationFn;
    loadPlan?: typeof loadPlanFn;
    archivePlan?: typeof archivePlanFn;
    getWorkflowDiff?: typeof getWorkflowDiffFn;
    listCommitsTouchingPathsSince?: typeof listCommitsTouchingPathsSinceFn;
    restoreWorktreeTree?: typeof restoreWorktreeTreeFn;
    getRootAgentName?: () => string | null;
    listPlans?: (cwd: string) => Promise<ListedPlanSummary[]>;
    findPlansByParent?: typeof findPlansByParentFn;
    resolveSiblingChildPlanDependencies?: typeof resolveSiblingChildPlanDependenciesFn;
    findWorktreeById?: typeof findWorktreeByIdFn;
    findWorktreeByPlanName?: typeof findWorktreeByPlanNameFn;
    getWorktreeStatus?: typeof getWorktreeStatusFn;
    inspectExecutionWorktreeMergeRisk?: typeof inspectExecutionWorktreeMergeRiskFn;
    getBranchHead?: typeof getBranchHead;
    isCommitAncestorOfBranch?: typeof isCommitAncestorOfBranch;
    shouldCleanupMergedWorktrees?: typeof shouldCleanupMergedWorktreesFn;
    recordWorkflowMetric?: typeof recordWorkflowMetric;
    probeGitRepository?: typeof probeGitRepositoryFn;
    setTerminalTitleForName?: typeof setTerminalTitleForNameFn;
    autoGenerateWorkRecordForCompletedPlan?: typeof autoGenerateWorkRecordForCompletedPlanFn;
    resolveValidationExecutionContext?: typeof resolveValidationExecutionContext;
}
