import { assert, assertEquals } from "@std/assert";

export type ValidationWorkflowBranchId =
    | "mechanical:plan-amendment:approve"
    | "mechanical:plan-amendment:follow-up"
    | "mechanical:plan-amendment:stop"
    | "mechanical:plan-amendment:invalid-baseline"
    | "mechanical:ci:pass"
    | "mechanical:ci:repair-completed"
    | "mechanical:ci:repair-incomplete"
    | "mechanical:ci:cancel-retry"
    | "mechanical:ci:cancel-follow-up"
    | "mechanical:ci:cancel-stop"
    | "mechanical:ci:exhausted-retry"
    | "mechanical:ci:exhausted-follow-up"
    | "mechanical:ci:exhausted-stop"
    | "mechanical:objective:none"
    | "mechanical:objective:all-pass"
    | "mechanical:objective:mixed-waived"
    | "mechanical:objective:repair-completed"
    | "mechanical:objective:repair-incomplete"
    | "mechanical:objective:cancel-retry"
    | "mechanical:objective:cancel-follow-up"
    | "mechanical:objective:cancel-stop"
    | "mechanical:objective:exhausted-retry"
    | "mechanical:objective:exhausted-follow-up"
    | "mechanical:objective:exhausted-stop"
    | "mechanical:broken-objective:detected-waive"
    | "mechanical:broken-objective:detected-reject"
    | "mechanical:broken-objective:engineer-reported-waive"
    | "mechanical:broken-objective:engineer-reported-reject"
    | "mechanical:broken-objective:follow-up"
    | "mechanical:broken-objective:stop"
    | "mechanical:broken-objective:stale-report"
    | "semantic:approval:first-round"
    | "semantic:findings:repair-completed"
    | "semantic:repair-incomplete"
    | "semantic:nudge:missing-review-complete"
    | "semantic:nudge:missing-diff-inspection"
    | "semantic:nudge:omitted-prior-finding"
    | "semantic:reviewer-incomplete-pause"
    | "semantic:round-mode:discovery-to-verify"
    | "semantic:round-limit:continue"
    | "semantic:round-limit:human-review"
    | "semantic:round-limit:stop"
    | "semantic:resume:validated-ci"
    | "semantic:entry:non-git-skip"
    | "semantic:entry:empty-diff-skip"
    | "semantic:entry:plan-only-diff-fails"
    | "human-review:none"
    | "human-review:ask-skip"
    | "human-review:ask-open-approve"
    | "human-review:always-approve"
    | "human-review:no-answer-retry"
    | "human-review:no-answer-stop"
    | "human-review:feedback-repair-approve"
    | "publication:direct-success"
    | "publication:non-git-success"
    | "publication:dirty-retry"
    | "publication:dirty-stop-resume"
    | "publication:merge-conflict-repair-completed"
    | "publication:merge-conflict-repair-incomplete-retry"
    | "publication:merge-conflict-repair-incomplete-stop"
    | "publication:missing-target-branch"
    | "publication:stale-repair-worktree"
    | "publication:generic-git-failure"
    | "lifecycle:resume-implemented"
    | "lifecycle:resume-validated-ci"
    | "lifecycle:resume-validated-reviewer"
    | "lifecycle:ahead-status-keeps-canonical-progress"
    | "lifecycle:missing-plan-fails-closed"
    | "lifecycle:unsupported-status-fails-closed"
    | "lifecycle:malformed-front-matter-fails-closed"
    | "lifecycle:missing-execution-context-fails-closed"
    | "lifecycle:mismatched-worktree-identity-fails-closed";

export interface ValidationEvidenceRequirement {
    transcriptIncludes: string[];
    eventIncludes: string[];
    turnIncludes: string[];
    statePaths: string[];
}

export interface ValidationWorkflowBranch {
    id: ValidationWorkflowBranchId;
    phase: "mechanical" | "semantic" | "human-review" | "publication" | "lifecycle";
    owner: string;
    trigger: string;
    userVisibleResult: string;
    durableResult: string;
    evidence: ValidationEvidenceRequirement;
}

export interface ValidationWorkflowScenarioLike {
    name: string;
    validationBranches?: ValidationWorkflowBranchId[];
    assertions?: Array<{ validationCoverage?: ValidationWorkflowBranchId[] }>;
}

export interface ValidationWorkflowResultLike {
    name: string;
    screenText?: string;
    scrollbackText?: string;
    events?: string[];
    state?: Record<string, ValidationStateValue>;
    actor?: { consumed?: string[]; remaining?: string[] };
}

type ValidationStateValue = string | number | boolean | null | ValidationStateValue[] | {
    [key: string]: ValidationStateValue;
};

export const EXPECTED_VALIDATION_WORKFLOW_BRANCH_IDS: readonly ValidationWorkflowBranchId[] = Object.freeze([
    "mechanical:plan-amendment:approve",
    "mechanical:plan-amendment:follow-up",
    "mechanical:plan-amendment:stop",
    "mechanical:plan-amendment:invalid-baseline",
    "mechanical:ci:pass",
    "mechanical:ci:repair-completed",
    "mechanical:ci:repair-incomplete",
    "mechanical:ci:cancel-retry",
    "mechanical:ci:cancel-follow-up",
    "mechanical:ci:cancel-stop",
    "mechanical:ci:exhausted-retry",
    "mechanical:ci:exhausted-follow-up",
    "mechanical:ci:exhausted-stop",
    "mechanical:objective:none",
    "mechanical:objective:all-pass",
    "mechanical:objective:mixed-waived",
    "mechanical:objective:repair-completed",
    "mechanical:objective:repair-incomplete",
    "mechanical:objective:cancel-retry",
    "mechanical:objective:cancel-follow-up",
    "mechanical:objective:cancel-stop",
    "mechanical:objective:exhausted-retry",
    "mechanical:objective:exhausted-follow-up",
    "mechanical:objective:exhausted-stop",
    "mechanical:broken-objective:detected-waive",
    "mechanical:broken-objective:detected-reject",
    "mechanical:broken-objective:engineer-reported-waive",
    "mechanical:broken-objective:engineer-reported-reject",
    "mechanical:broken-objective:follow-up",
    "mechanical:broken-objective:stop",
    "mechanical:broken-objective:stale-report",
    "semantic:approval:first-round",
    "semantic:findings:repair-completed",
    "semantic:repair-incomplete",
    "semantic:nudge:missing-review-complete",
    "semantic:nudge:missing-diff-inspection",
    "semantic:nudge:omitted-prior-finding",
    "semantic:reviewer-incomplete-pause",
    "semantic:round-mode:discovery-to-verify",
    "semantic:round-limit:continue",
    "semantic:round-limit:human-review",
    "semantic:round-limit:stop",
    "semantic:resume:validated-ci",
    "semantic:entry:non-git-skip",
    "semantic:entry:empty-diff-skip",
    "semantic:entry:plan-only-diff-fails",
    "human-review:none",
    "human-review:ask-skip",
    "human-review:ask-open-approve",
    "human-review:always-approve",
    "human-review:no-answer-retry",
    "human-review:no-answer-stop",
    "human-review:feedback-repair-approve",
    "publication:direct-success",
    "publication:non-git-success",
    "publication:dirty-retry",
    "publication:dirty-stop-resume",
    "publication:merge-conflict-repair-completed",
    "publication:merge-conflict-repair-incomplete-retry",
    "publication:merge-conflict-repair-incomplete-stop",
    "publication:missing-target-branch",
    "publication:stale-repair-worktree",
    "publication:generic-git-failure",
    "lifecycle:resume-implemented",
    "lifecycle:resume-validated-ci",
    "lifecycle:resume-validated-reviewer",
    "lifecycle:ahead-status-keeps-canonical-progress",
    "lifecycle:missing-plan-fails-closed",
    "lifecycle:unsupported-status-fails-closed",
    "lifecycle:malformed-front-matter-fails-closed",
    "lifecycle:missing-execution-context-fails-closed",
    "lifecycle:mismatched-worktree-identity-fails-closed",
]);

function phaseFor(id: ValidationWorkflowBranchId): ValidationWorkflowBranch["phase"] {
    if (id.startsWith("semantic:")) return "semantic";
    if (id.startsWith("human-review:")) return "human-review";
    if (id.startsWith("publication:")) return "publication";
    if (id.startsWith("lifecycle:")) return "lifecycle";
    return "mechanical";
}

const VALIDATION_BRANCH_OWNERS: Record<ValidationWorkflowBranchId, string> = {
    "mechanical:plan-amendment:approve": "validation-tree-plan-amendment-approve",
    "mechanical:plan-amendment:follow-up": "validation-tree-plan-amendment-follow-up",
    "mechanical:plan-amendment:stop": "validation-tree-plan-amendment-stop",
    "mechanical:plan-amendment:invalid-baseline": "validation-tree-plan-amendment-invalid-baseline",
    "mechanical:ci:pass": "validation-tree-ci-loop",
    "mechanical:ci:repair-completed": "validation-tree-ci-loop",
    "mechanical:ci:repair-incomplete": "validation-tree-ci-repair-incomplete",
    "mechanical:ci:cancel-retry": "validation-tree-ci-cancel-retry",
    "mechanical:ci:cancel-follow-up": "validation-tree-ci-cancel-follow-up",
    "mechanical:ci:cancel-stop": "validation-tree-ci-cancel-stop",
    "mechanical:ci:exhausted-retry": "validation-tree-validation-exhausted-retry",
    "mechanical:ci:exhausted-follow-up": "validation-tree-validation-exhausted-follow-up",
    "mechanical:ci:exhausted-stop": "validation-tree-validation-exhausted-stop",
    "mechanical:objective:none": "validation-tree-objective-none",
    "mechanical:objective:all-pass": "validation-tree-objective-none",
    "mechanical:objective:mixed-waived": "validation-tree-objective-mixed-waived",
    "mechanical:objective:repair-completed": "validation-tree-objective-repair-completed",
    "mechanical:objective:repair-incomplete": "validation-tree-objective-repair-incomplete",
    "mechanical:objective:cancel-retry": "validation-tree-objective-cancel-retry",
    "mechanical:objective:cancel-follow-up": "validation-tree-objective-cancel-follow-up",
    "mechanical:objective:cancel-stop": "validation-tree-objective-cancel-stop",
    "mechanical:objective:exhausted-retry": "validation-tree-objective-exhausted-retry",
    "mechanical:objective:exhausted-follow-up": "validation-tree-objective-exhausted-follow-up",
    "mechanical:objective:exhausted-stop": "validation-tree-objective-exhausted-stop",
    "mechanical:broken-objective:detected-waive": "validation-tree-broken-objective-detected-waive",
    "mechanical:broken-objective:detected-reject": "validation-tree-broken-objective-detected-reject",
    "mechanical:broken-objective:engineer-reported-waive": "validation-tree-broken-objective-engineer-reported-waive",
    "mechanical:broken-objective:engineer-reported-reject": "validation-tree-broken-objective-engineer-reported-reject",
    "mechanical:broken-objective:follow-up": "validation-tree-broken-objective-follow-up",
    "mechanical:broken-objective:stop": "validation-tree-broken-objective-stop",
    "mechanical:broken-objective:stale-report": "validation-tree-broken-objective-stale-report",
    "semantic:approval:first-round": "validation-tree-ci-retry-success",
    "semantic:findings:repair-completed": "validation-tree-semantic-review-loop",
    "semantic:repair-incomplete": "validation-tree-semantic-repair-incomplete",
    "semantic:nudge:missing-review-complete": "validation-tree-semantic-nudge-missing-review-complete",
    "semantic:nudge:missing-diff-inspection": "validation-tree-semantic-nudge-missing-diff-inspection",
    "semantic:nudge:omitted-prior-finding": "validation-tree-semantic-nudge-omitted-prior-finding",
    "semantic:reviewer-incomplete-pause": "validation-tree-semantic-reviewer-incomplete-pause",
    "semantic:round-mode:discovery-to-verify": "validation-tree-semantic-round-mode-discovery-to-verify",
    "semantic:round-limit:continue": "validation-tree-semantic-round-limit-continue",
    "semantic:round-limit:human-review": "validation-tree-semantic-round-limit-human-review",
    "semantic:round-limit:stop": "validation-tree-semantic-round-limit-stop",
    "semantic:resume:validated-ci": "validation-tree-resume-validated-ci",
    "semantic:entry:non-git-skip": "validation-tree-non-git-delivery",
    "semantic:entry:empty-diff-skip": "validation-tree-empty-diff-skip",
    "semantic:entry:plan-only-diff-fails": "validation-tree-plan-only-diff-fails",
    "human-review:none": "validation-tree-human-review-ask-skip",
    "human-review:ask-skip": "validation-tree-human-review-ask-skip",
    "human-review:ask-open-approve": "validation-tree-human-review-ask-open-approve",
    "human-review:always-approve": "validation-tree-human-review-always-approve",
    "human-review:no-answer-retry": "validation-tree-human-review-no-answer-retry",
    "human-review:no-answer-stop": "validation-tree-human-review-no-answer-stop",
    "human-review:feedback-repair-approve": "validation-tree-human-review-feedback-repair-approve",
    "publication:direct-success": "validation-tree-publication-dirty-checkout",
    "publication:non-git-success": "validation-tree-non-git-delivery",
    "publication:dirty-retry": "validation-tree-publication-dirty-checkout",
    "publication:dirty-stop-resume": "validation-tree-publication-dirty-stop-resume",
    "publication:merge-conflict-repair-completed": "validation-tree-publication-merge-conflict-repair-completed",
    "publication:merge-conflict-repair-incomplete-retry":
        "validation-tree-publication-merge-conflict-repair-incomplete-retry",
    "publication:merge-conflict-repair-incomplete-stop":
        "validation-tree-publication-merge-conflict-repair-incomplete-stop",
    "publication:missing-target-branch": "validation-tree-publication-missing-target-branch",
    "publication:stale-repair-worktree": "validation-tree-publication-stale-repair-worktree",
    "publication:generic-git-failure": "validation-tree-publication-generic-git-failure",
    "lifecycle:resume-implemented": "validation-tree-resume-implemented",
    "lifecycle:resume-validated-ci": "validation-tree-resume-validated-ci",
    "lifecycle:resume-validated-reviewer": "validation-tree-resume-validated-reviewer",
    "lifecycle:ahead-status-keeps-canonical-progress": "validation-tree-ahead-status",
    "lifecycle:missing-plan-fails-closed": "validation-tree-missing-plan",
    "lifecycle:unsupported-status-fails-closed": "validation-tree-unsupported-status",
    "lifecycle:malformed-front-matter-fails-closed": "validation-tree-malformed-front-matter",
    "lifecycle:missing-execution-context-fails-closed": "validation-tree-missing-execution-context",
    "lifecycle:mismatched-worktree-identity-fails-closed": "validation-tree-mismatched-worktree-identity",
};

function ownerFor(id: ValidationWorkflowBranchId): string {
    return VALIDATION_BRANCH_OWNERS[id];
}

function transcriptRequirementFor(id: ValidationWorkflowBranchId): string[] {
    if (id === "lifecycle:missing-plan-fails-closed") return ["Plan not found: missing-plan"];
    if (id === "lifecycle:malformed-front-matter-fails-closed") return ["Plan not found: broken"];
    if (
        id === "lifecycle:resume-implemented" || id === "lifecycle:resume-validated-ci" ||
        id === "lifecycle:resume-validated-reviewer" || id === "lifecycle:ahead-status-keeps-canonical-progress"
    ) return ["Workflow Validation verified"];
    if (id === "lifecycle:missing-execution-context-fails-closed") {
        return ["Validation blocked: RunWield cannot tell where"];
    }
    if (id === "lifecycle:mismatched-worktree-identity-fails-closed") {
        return ["Validation blocked: RunWield has worktree metadata"];
    }
    if (id === "lifecycle:unsupported-status-fails-closed") return ["Plan has unknown status: sideways"];
    if (id.includes("plan-amendment")) return ["Plan amendment"];
    if (id.includes(":ci:")) return ["CI"];
    if (id.includes(":objective:")) return ["Objective"];
    if (id.includes("broken-objective")) return ["Objective-Failing Check"];
    if (id.startsWith("semantic:round-limit:")) return ["Look once more, read it, or stop."];
    if (id.startsWith("semantic:nudge:")) return ["The reviewer needs more time"];
    if (id === "semantic:entry:non-git-skip") return ["Review skipped"];
    if (id === "semantic:entry:empty-diff-skip") return ["Review skipped"];
    if (id === "semantic:entry:plan-only-diff-fails") return ["No implementation changes detected"];
    if (id.startsWith("semantic:")) return ["Code review"];
    if (id === "human-review:ask-skip" || id === "human-review:none") return ["Workflow Validation verified"];
    if (id === "human-review:no-answer-retry" || id === "human-review:no-answer-stop") {
        return ["Pick Retry to open it again"];
    }
    if (id.startsWith("human-review:")) return ["Waiting for your code review"];
    if (id === "publication:non-git-success") return ["done and on its target branch"];
    if (id === "publication:dirty-retry" || id === "publication:dirty-stop-resume") {
        return ["changes you have not saved to git yet"];
    }
    if (id === "publication:direct-success") return ["done and on its target branch"];
    if (id === "publication:missing-target-branch") return ["fatal: ambiguous argument 'refs/heads/main'"];
    if (id === "publication:merge-conflict-repair-completed") return ["The merge for", "engineer will fix the merge"];
    if (
        id === "publication:merge-conflict-repair-incomplete-retry" ||
        id === "publication:merge-conflict-repair-incomplete-stop"
    ) return ["could not combine"];
    if (id === "publication:stale-repair-worktree") return ["checked Plan copy", "done and on its target branch"];
    if (id === "publication:generic-git-failure") return ["could not add", "merge stopped"];
    if (id.startsWith("publication:")) return ["Publication"];
    return ["Plan recovery"];
}

function turnRequirementFor(id: ValidationWorkflowBranchId): string[] {
    const objectiveSuccess = id === "mechanical:objective:none" || id === "mechanical:objective:all-pass" ||
        id === "mechanical:objective:mixed-waived";
    if (objectiveSuccess) return ["reviewer"];
    if (id.startsWith("publication:merge-conflict-repair")) return ["engineer"];
    if (id.startsWith("publication:")) return [];
    if (id.includes("follow-up") || id.includes("repair") || id.includes("feedback")) return ["engineer"];
    if (id.startsWith("semantic:entry:")) return [];
    if (id.startsWith("semantic:")) return ["reviewer"];
    return [];
}

function statePathsFor(id: ValidationWorkflowBranchId): string[] {
    if (id === "lifecycle:missing-plan-fails-closed" || id === "lifecycle:malformed-front-matter-fails-closed") {
        return ["projectState.plans.0.name"];
    }
    if (
        id === "publication:merge-conflict-repair-completed" ||
        id === "publication:merge-conflict-repair-incomplete-stop"
    ) {
        return ["projectState.plans.0.name", "projectState.registryEntries"];
    }
    const paths = ["projectState.plans.0.attrs.status"];
    if (id.includes(":ci:")) paths.push("projectState.plans.0.attrs.validationCiAttempts");
    if (id.startsWith("semantic:")) paths.push("projectState.plans.0.attrs.validationSemanticRounds");
    if (id.startsWith("human-review:")) paths.push("projectState.plans.0.attrs.humanReviewDecision");
    if (id.startsWith("publication:")) paths.push("projectState.registryEntries");
    return paths;
}

function evidenceFor(id: ValidationWorkflowBranchId): ValidationEvidenceRequirement {
    return {
        transcriptIncludes: transcriptRequirementFor(id),
        eventIncludes: ["project:state:captured"],
        turnIncludes: turnRequirementFor(id),
        statePaths: statePathsFor(id),
    };
}

export const VALIDATION_INTERACTION_OPTION_BRANCHES: Readonly<Record<string, readonly ValidationWorkflowBranchId[]>> =
    Object.freeze({
        retry: [
            "mechanical:ci:cancel-retry",
            "mechanical:objective:cancel-retry",
            "human-review:no-answer-retry",
            "publication:dirty-retry",
        ],
        stop: [
            "mechanical:ci:cancel-stop",
            "mechanical:objective:cancel-stop",
            "semantic:round-limit:stop",
            "human-review:no-answer-stop",
            "publication:dirty-stop-resume",
        ],
        engineer_follow_up: [
            "mechanical:ci:cancel-follow-up",
            "mechanical:objective:cancel-follow-up",
            "mechanical:broken-objective:follow-up",
        ],
        waive: ["mechanical:broken-objective:detected-waive", "mechanical:broken-objective:engineer-reported-waive"],
        waive_defective_checks: ["mechanical:broken-objective:engineer-reported-waive"],
        approve_amendment: ["mechanical:plan-amendment:approve"],
        reject: ["mechanical:broken-objective:detected-reject", "mechanical:broken-objective:engineer-reported-reject"],
        open: ["human-review:ask-open-approve"],
        skip: ["human-review:ask-skip"],
        continue: ["semantic:round-limit:continue"],
        code_review: ["semantic:round-limit:human-review"],
        confirm: ["mechanical:plan-amendment:approve"],
        later: ["mechanical:plan-amendment:follow-up"],
    });

export const VALIDATION_WORKFLOW_BRANCHES: readonly ValidationWorkflowBranch[] = Object.freeze(
    EXPECTED_VALIDATION_WORKFLOW_BRANCH_IDS.map((id) => ({
        id,
        phase: phaseFor(id),
        owner: ownerFor(id),
        trigger: id,
        userVisibleResult: `${id} is visible in the TUI transcript.`,
        durableResult: `${id} is backed by captured Plan, registry, or Git state.`,
        evidence: evidenceFor(id),
    })),
);

export function assertValidationBranchInventory(scenarios: readonly ValidationWorkflowScenarioLike[]): void {
    const expected = [...EXPECTED_VALIDATION_WORKFLOW_BRANCH_IDS].sort();
    const actual = VALIDATION_WORKFLOW_BRANCHES.map((branch) => branch.id).sort();
    assertEquals(actual, expected, "Validation branch inventory must match the independent expected branch set.");

    const invented = actual.filter((id) => !EXPECTED_VALIDATION_WORKFLOW_BRANCH_IDS.includes(id));
    assertEquals(invented, [], "Validation branch inventory must not invent branch IDs.");

    const owners = new Map<ValidationWorkflowBranchId, string[]>();
    for (const scenario of scenarios) {
        for (const id of scenario.validationBranches || []) {
            owners.set(id, [...(owners.get(id) || []), scenario.name]);
        }
    }

    const ownerMismatches: string[] = [];
    for (const id of EXPECTED_VALIDATION_WORKFLOW_BRANCH_IDS) {
        const branch = VALIDATION_WORKFLOW_BRANCHES.find((entry) => entry.id === id);
        assert(branch, `Missing validation branch ${id}.`);
        const actualOwners = owners.get(id) || [];
        const expectedOwners = [branch.owner];
        if (JSON.stringify(actualOwners) !== JSON.stringify(expectedOwners)) {
            ownerMismatches.push(
                `${id}: expected ${expectedOwners.join(", ")}; got ${actualOwners.join(", ") || "none"}`,
            );
        }
    }
    assertEquals(ownerMismatches, [], "Each validation branch must have exactly one primary Golden owner.");

    for (const scenario of scenarios) {
        const asserted = new Set(
            (scenario.assertions || []).flatMap((assertion) => assertion.validationCoverage || []),
        );
        for (const id of scenario.validationBranches || []) {
            assert(asserted.has(id), `${scenario.name} declares ${id} but has no tagged validation assertion.`);
        }
    }
}

function transcript(result: ValidationWorkflowResultLike): string {
    return `${result.screenText || ""}\n${result.scrollbackText || ""}`;
}

function stateValue(result: ValidationWorkflowResultLike, path: string): ValidationStateValue | undefined {
    let current: ValidationStateValue | undefined = result.state;
    for (const part of path.split(".")) {
        if (current === null || current === undefined) return undefined;
        if (Array.isArray(current)) {
            const index = Number(part);
            if (!Number.isInteger(index)) return undefined;
            current = current[index];
            continue;
        }
        if (typeof current !== "object") return undefined;
        current = current[part];
    }
    return current;
}

export function assertValidationBranchEvidence(
    id: ValidationWorkflowBranchId,
    result: ValidationWorkflowResultLike,
): void {
    const branch = VALIDATION_WORKFLOW_BRANCHES.find((entry) => entry.id === id);
    assert(branch, `Unknown validation branch ${id}.`);
    assertEquals(result.name, branch.owner, `Branch ${id} evidence came from the wrong scenario.`);

    const text = transcript(result);
    for (const required of branch.evidence.transcriptIncludes) {
        assert(text.includes(required), `Branch ${id} missing visible transcript text: ${required}`);
    }
    for (const required of branch.evidence.eventIncludes) {
        assert(
            (result.events || []).some((event) => event.includes(required)),
            `Branch ${id} missing event: ${required}`,
        );
    }
    for (const required of branch.evidence.turnIncludes) {
        const hasTurnEvidence = (result.state?.turnSequence as string[] | undefined || result.actor?.consumed || [])
            .some((turn) => String(turn).includes(required));
        assert(hasTurnEvidence, `Branch ${id} missing Agent or phase turn evidence: ${required}`);
    }
    for (const required of branch.evidence.statePaths) {
        assert(stateValue(result, required) !== undefined, `Branch ${id} missing durable state path: ${required}`);
    }
}

export function assertValidationEvidenceRejectsCounterfeits(
    id: ValidationWorkflowBranchId,
    result: ValidationWorkflowResultLike,
): void {
    assertValidationBranchEvidence(id, result);
    const withoutText: ValidationWorkflowResultLike = { ...result, screenText: "", scrollbackText: "" };
    assertThrowsForEvidence(id, withoutText, "transcript");
    const withoutRouting: ValidationWorkflowResultLike = {
        ...result,
        events: [],
        state: { ...(result.state || {}), turnSequence: [] },
        actor: { consumed: [], remaining: result.actor?.remaining || [] },
    };
    assertThrowsForEvidence(id, withoutRouting, "routing");
    const withoutState: ValidationWorkflowResultLike = { ...result, state: {} };
    assertThrowsForEvidence(id, withoutState, "state");
}

function assertThrowsForEvidence(
    id: ValidationWorkflowBranchId,
    result: ValidationWorkflowResultLike,
    label: string,
): void {
    let failed = false;
    try {
        assertValidationBranchEvidence(id, result);
    } catch {
        failed = true;
    }
    assert(failed, `Branch ${id} evidence check must reject ${label}-removed result.`);
}

export function validationEvidenceAssertion(id: ValidationWorkflowBranchId) {
    const assertion = (result: ValidationWorkflowResultLike): void => assertValidationBranchEvidence(id, result);
    assertion.validationCoverage = [id];
    return assertion;
}
