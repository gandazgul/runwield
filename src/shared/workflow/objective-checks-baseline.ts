// @ts-nocheck: extracted from checked JSDoc workflow.js; tightening types is out of scope for this structural split.
import { runPlanFrontMatterTransition } from "./state-transition.ts";
import {
    classifyObjectiveChecksBaseline,
    objectiveChecksBaselineMatches,
    runObjectiveChecks,
    summarizeObjectiveChecks,
} from "./objective-checks.ts";

export class ObjectiveChecksBaselineRejectionError extends Error {
    /**
     * @param {{ kind: "already_met"|"broken", checkIds: string[], feedback: string }} options
     */
    constructor(options) {
        super(options.feedback);
        this.name = "ObjectiveChecksBaselineRejectionError";
        this.kind = options.kind;
        this.checkIds = options.checkIds;
        this.feedback = options.feedback;
    }
}

/**
 * @param {string} planName
 * @param {import('./objective-checks.ts').ObjectiveCheckResult[]} results
 * @param {"already_met"|"broken"} kind
 * @returns {string}
 */
export function buildObjectiveChecksBaselineFeedback(planName, results, kind) {
    const ids = results.map((result) => result.id).join(", ");
    const summary = summarizeObjectiveChecks(results).block;
    const reason = kind === "already_met"
        ? `The following Objective-Failing Check(s) are already satisfied before implementation: ${ids}. An already-green check cannot discriminate whether Plan ${planName}'s objective was achieved. Revise the check(s) so they fail against the unmodified tree and pass only after the objective is implemented.`
        : `The following Objective-Failing Check(s) could not run cleanly before implementation: ${ids}. A broken check cannot prove the objective is unmet, so revise the command(s) before execution starts.`;
    return `${reason}\n\n${summary}`;
}

/**
 * @param {string} planName
 * @param {import('./objective-checks.ts').ObjectiveCheckResult[]} results
 * @param {"already_met"|"broken"} kind
 * @throws {ObjectiveChecksBaselineRejectionError}
 */
function throwObjectiveChecksBaselineRejection(planName, results, kind) {
    throw new ObjectiveChecksBaselineRejectionError({
        kind,
        checkIds: results.map((result) => result.id),
        feedback: buildObjectiveChecksBaselineFeedback(planName, results, kind),
    });
}

/**
 * @param {import('../../plan-store.js').PlanFrontMatter} attrs
 * @param {import('./objective-checks.ts').ObjectiveCheck[]} checks
 * @param {string|undefined} head
 * @returns {import('./objective-checks.ts').ObjectiveCheckResult[]|undefined}
 */
function trustedObjectiveChecksBaselineResults(attrs, checks, head) {
    if (!objectiveChecksBaselineMatches(attrs.objectiveChecksBaseline, checks, head)) return undefined;
    return attrs.objectiveChecksBaseline?.results;
}

/**
 * @param {{ projectRoot: string, planName: string, attrs: import('../../plan-store.js').PlanFrontMatter, revision: string|undefined, checks: import('./objective-checks.ts').ObjectiveCheck[], cwd: string, head?: string }} options
 * @returns {Promise<void>}
 */
export async function ensureObjectiveChecksBaseline(options) {
    if (options.checks.length === 0) return;
    const trustedResults = trustedObjectiveChecksBaselineResults(options.attrs, options.checks, options.head);
    const results = trustedResults || await runObjectiveChecks({ checks: options.checks, cwd: options.cwd });
    const classification = classifyObjectiveChecksBaseline(results);
    if (classification.status === "already_met") {
        throwObjectiveChecksBaselineRejection(options.planName, classification.offendingResults, "already_met");
    }
    if (classification.status === "broken") {
        throwObjectiveChecksBaselineRejection(options.planName, classification.offendingResults, "broken");
    }
    if (!trustedResults) {
        const transition = await runPlanFrontMatterTransition({
            projectRoot: options.projectRoot,
            planName: options.planName,
            operation: "objective_checks_baseline_record",
            updates: {
                objectiveChecksBaseline: {
                    recordedAt: new Date().toISOString(),
                    ...(options.head ? { head: options.head } : {}),
                    results,
                },
            },
            expectedRevision: options.revision,
        });
        if (transition.status !== "committed") {
            throw new Error(
                transition.message || `Could not persist Objective-Failing Check baseline for ${options.planName}.`,
            );
        }
    }
}
