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
    | "lifecycle:ahead-status-heals-to-implemented"
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
    "lifecycle:ahead-status-heals-to-implemented",
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

function ownerFor(id: ValidationWorkflowBranchId): string {
    if (id === "publication:non-git-success" || id === "semantic:entry:non-git-skip") {
        return "validation-tree-non-git-delivery";
    }
    if (id === "publication:dirty-retry" || id === "publication:dirty-stop-resume") {
        return "validation-tree-publication-dirty-checkout";
    }
    if (id.includes("ci:")) return "validation-tree-ci-loop";
    if (id.includes("objective") || id.includes("broken-objective")) return "validation-tree-objective-check-loop";
    if (id.startsWith("semantic:")) return "validation-tree-semantic-review-loop";
    if (id.startsWith("human-review:")) return "validation-tree-human-review-loop";
    if (id.startsWith("publication:")) return "validation-tree-publication-recovery";
    if (id.startsWith("lifecycle:")) return "validation-tree-lifecycle-resume";
    return "validation-tree-mechanical-plan-amendment";
}

function evidenceFor(id: ValidationWorkflowBranchId): ValidationEvidenceRequirement {
    const phase = phaseFor(id);
    const baseState = ["projectState.plans.0.attrs.status"];
    if (phase === "mechanical") {
        return {
            transcriptIncludes: [id.includes("ci") ? "Running CI Validation" : "Objective"],
            eventIncludes: ["project:state:captured"],
            turnIncludes: id.includes("repair") || id.includes("follow-up") ? ["engineer"] : [],
            statePaths: id.includes("ci")
                ? [...baseState, "projectState.plans.0.attrs.validationCiAttempts"]
                : baseState,
        };
    }
    if (phase === "semantic") {
        return {
            transcriptIncludes: [id.includes("plan-only") ? "No implementation changes detected" : "Semantic"],
            eventIncludes: ["project:state:captured"],
            turnIncludes: id.includes("non-git") || id.includes("empty-diff") ? [] : ["reviewer:semantic_review"],
            statePaths: [...baseState, "projectState.plans.0.attrs.validationSemanticRounds"],
        };
    }
    if (phase === "human-review") {
        return {
            transcriptIncludes: ["Code Review"],
            eventIncludes: ["human-review:captured"],
            turnIncludes: id.includes("feedback") ? ["engineer"] : [],
            statePaths: [...baseState, "projectState.plans.0.attrs.humanReviewDecision"],
        };
    }
    if (phase === "publication") {
        return {
            transcriptIncludes: [
                id.includes("dirty") ? "have not saved to git yet" : "Merging validated worktree branch",
            ],
            eventIncludes: ["project:state:captured"],
            turnIncludes: id.includes("repair") ? ["engineer"] : [],
            statePaths: [...baseState, "projectState.registryEntries"],
        };
    }
    return {
        transcriptIncludes: [id.includes("malformed") ? "Plan Front Matter" : "Plan Recovery"],
        eventIncludes: ["project:state:captured"],
        turnIncludes: [],
        statePaths: baseState,
    };
}

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

    for (const id of EXPECTED_VALIDATION_WORKFLOW_BRANCH_IDS) {
        const branch = VALIDATION_WORKFLOW_BRANCHES.find((entry) => entry.id === id);
        assert(branch, `Missing validation branch ${id}.`);
        assertEquals(owners.get(id), [branch.owner], `Branch ${id} must have exactly one primary Golden owner.`);
    }

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
        assert(
            (result.state?.turnSequence as string[] | undefined || result.actor?.consumed || []).some((turn) =>
                String(turn).includes(required)
            ),
            `Branch ${id} missing Agent or phase turn evidence: ${required}`,
        );
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
