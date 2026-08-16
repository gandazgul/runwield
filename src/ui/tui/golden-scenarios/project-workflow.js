/**
 * @module ui/tui/golden-scenarios/project-workflow
 * Composed Golden PROJECT workflow scenarios.
 */

import { assert } from "@std/assert";
import { assertEventIncludes, assertScreenIncludes } from "../testing/scenario-runner.js";
import { assertRuntimeEvent, assertsGoldenCoverage } from "../testing/portfolio-assertions.js";

/** @typedef {import('../testing/scenario-runner.js').GoldenScenarioResult} GoldenScenarioResult */
/** @typedef {{ status?: string }} WorkRecordStatus */
/** @typedef {{ status?: string, epicCompletionMode?: string, workRecord?: WorkRecordStatus }} EpicCompletionAttrs */
/** @typedef {{ attrs?: { workRecord?: WorkRecordStatus } }} PlanReviewState */

/** @param {GoldenScenarioResult} result @param {string | undefined} capability */
function assertProjectPlanReviewJourney(result, capability) {
    assert(typeof capability === "string" && capability.length > 0, "Expected capability-specific PROJECT assertion.");
    assertEventIncludes(result, "interaction:PLAN_REVIEW:approved");
    assertEventIncludes(result, "review_approved");
    assertEventIncludes(result, "runtime:tool:start:plan_written");
    assertScreenIncludes(result, 'Plan "plan" approved');
    const planReview =
        /** @type {{ attrs?: Record<string, unknown>, plan?: string } | undefined} */ (result.state.planReview);
    assert(planReview?.attrs?.classification === "PROJECT", "Expected reviewed Plan to use PROJECT classification.");
    assert(
        String(planReview.plan || "").includes("Golden PROJECT revised content."),
        "Expected reviewed PROJECT content to persist.",
    );
}

/** @param {GoldenScenarioResult} result @param {string | undefined} capability */
function assertRuntimeSessionReplacementAndEpicEvidence(result, capability) {
    assert(typeof capability === "string" && capability.length > 0, "Expected capability-specific Epic assertion.");
    assertEventIncludes(result, "project:epic:status:ready_for_decomposition");
    assertEventIncludes(result, "runtime:tool:start:slicer_finalize_decomposition");
    assertEventIncludes(result, "runtime:tool:end:slicer_finalize_decomposition");
    assertEventIncludes(result, "project:slicer:materialized");
    assertEventIncludes(result, "runtime:session-replaced:epic_continuation");
    assertEventIncludes(result, "project:epic:evidence");

    // The Slicer materialized these through the real decomposition transaction, so
    // their shape is the product's output rather than fixture setup.
    const children =
        /** @type {Array<{ name?: string, status?: string, classification?: string, order?: unknown, parentPlan?: string }> | undefined} */ (result
            .state.projectChildren);
    assert(children?.length === 2, `Expected two materialized child Plans; got ${JSON.stringify(children)}`);
    assert(
        children.every((child) => child.classification === "PLANNED_CHANGE" && child.parentPlan === "epic"),
        `Expected canonical PLANNED_CHANGE children parented to the Epic; got ${JSON.stringify(children)}`,
    );
    assert(
        children.every((child) => child.status === "draft"),
        `Expected the Slicer to materialize child drafts; got ${JSON.stringify(children)}`,
    );

    const replacement =
        /** @type {{ previousSessionId?: string, currentSessionId?: string, reason?: string, childPlanName?: string } | undefined} */ (result
            .state.replacedSession);
    assert(replacement?.previousSessionId && replacement?.currentSessionId, "Expected previous/current Session IDs.");
    assert(
        replacement.previousSessionId !== replacement.currentSessionId,
        "Expected PROJECT continuation to replace Session.",
    );
    assert(replacement.reason === "epic_continuation", `Expected typed continuation reason; got ${replacement.reason}`);
    assert(
        replacement.childPlanName === children[1].name,
        `Expected continuation into the second child ${children[1].name}; got ${replacement.childPlanName}`,
    );

    const plans =
        /** @type {{ parent?: Record<string, unknown>, firstChild?: Record<string, unknown>, secondChild?: Record<string, unknown> } | undefined} */ (result
            .state.projectPlans);
    assert(plans?.parent?.classification === "PROJECT", "Expected parent Epic PROJECT metadata.");
    // Both children reached a terminal verified state through their own real
    // execution and Workflow Validation, not a harness status write.
    for (const [label, attrs] of [["first", plans?.firstChild], ["second", plans?.secondChild]]) {
        const childAttrs = /** @type {Record<string, unknown> | undefined} */ (attrs);
        assert(
            childAttrs?.classification === "PLANNED_CHANGE",
            `Expected ${label} child canonical PLANNED_CHANGE metadata.`,
        );
        assert(
            ["verified", "user_verified"].includes(String(childAttrs.status || "")),
            `Expected ${label} child to finish verified; got ${childAttrs.status}`,
        );
    }

    const durability =
        /** @type {{ trackedFiles?: string, deliveryLog?: string, liveRegistryEntries?: string[], registryEntryCount?: number } | undefined} */ (result
            .state.projectDurability);
    // Each child ran a real Engineer turn in a real worktree and a real Direct
    // Delivery merge, so its file has to be tracked on the delivered branch.
    for (const childFile of ["golden-child-one.txt", "golden-child-two.txt"]) {
        assert(
            String(durability?.trackedFiles || "").includes(childFile),
            `Expected ${childFile} tracked after child delivery; tracked=${durability?.trackedFiles}`,
        );
    }
    assert(String(durability?.deliveryLog || "").length > 0, "Expected Git ancestry evidence for child deliveries.");
    assert(
        (durability?.liveRegistryEntries || []).length === 0,
        `Expected every child worktree attempt to reach a terminal state; live=${
            (durability?.liveRegistryEntries || []).join(", ")
        }`,
    );
}

export const projectPlanReviewScenario = {
    name: "project-plan-review-approval-journey",
    composedTui: true,
    initialAgentName: "planner",
    terminal: { columns: 100, rows: 30 },
    coverage: ["workflow:PROJECT", "durable:plan-lifecycle"],
    reviewDecisions: [{ approved: true, feedback: "PROJECT approved for later.", approvalAction: "later" }],
    reviewedPlan: "# Golden PROJECT\n\nGolden PROJECT revised content.\n",
    script: [{
        id: "planner-submit-project-for-review",
        agent: "planner",
        phase: "plan_review",
        ordinal: 1,
        requiredTools: ["plan_written"],
        thinking: "Submit PROJECT Plan for real Plan Review approval.",
        toolCalls: [{ name: "plan_written", arguments: { planName: "plan" } }],
    }],
    actions: [
        {
            type: "writeProjectFile",
            path: "docs/plans/plan.md",
            text:
                "---\nclassification: PROJECT\ncomplexity: MEDIUM\nsummary: Golden PROJECT\naffectedPaths: []\nstatus: draft\n---\n# Golden PROJECT\n\nDraft PROJECT content.\n",
        },
        { type: "type", text: "submit the project plan for review" },
        { type: "enter" },
        { type: "waitForIdle", timeoutMs: 12000 },
    ],
    assertions: [
        assertsGoldenCoverage(
            "workflow:PROJECT",
            (result) => assertProjectPlanReviewJourney(result, "workflow:PROJECT"),
        ),
        assertsGoldenCoverage("durable:plan-lifecycle", (result) => {
            assertEventIncludes(result, "review_approved");
            const planReview = /** @type {{ attrs?: Record<string, unknown> } | undefined} */ (result.state.planReview);
            assert(
                ["approved", "ready_for_decomposition"].includes(String(planReview?.attrs?.status || "")),
                "Expected PROJECT Plan Review approval lifecycle state.",
            );
        }),
    ],
};

export const twoChildProjectContinuationScenario = {
    name: "project-two-child-continuation-epic-evidence",
    composedTui: true,
    initialAgentName: "planner",
    terminal: { columns: 100, rows: 30 },
    // Two full child journeys, each with real Git, real transactions and real Agent
    // turns. CI runs several files at a time, and this is the outer cap, so it has to
    // clear the contended case or the inner budgets never apply.
    timeoutMs: 600000,
    coverage: ["durable:session-replaced", "durable:epic-evidence", "durable:work-record", "durable:epic-completion"],
    // Three real Plan Reviews: the Architect defers the Epic, then each child is
    // approved for execution. The second child's review is reached only through the
    // Runtime's own Epic continuation.
    reviewDecisions: [
        { approved: true, feedback: "Architect approved the two-child PROJECT.", approvalAction: "later" },
        { approved: true, feedback: "First child approved to run.", approvalAction: "run" },
        { approved: true, feedback: "Second child approved to run.", approvalAction: "run" },
    ],
    // A real Project commits its validation command, so Workflow Validation does not
    // write project `.wld/settings.json` in both the checkout and each child worktree
    // and make Direct Delivery refuse the merge. See planned-change-workflow.
    committedProjectFiles: [
        { path: ".wld/settings.json", text: `${JSON.stringify({ verification_command: "true" }, null, 4)}\n` },
    ],
    script: [
        {
            id: "architect-approves-epic-plan",
            agent: "planner",
            phase: "plan_review",
            ordinal: 1,
            requiredTools: ["plan_written"],
            thinking: "Submit the PROJECT Epic for Architect Plan Review approval.",
            toolCalls: [{ name: "plan_written", arguments: { planName: "epic" } }],
        },
        {
            // Served through the faux provider like every other turn, so the real
            // slicer_finalize_decomposition tool and the Epic decomposition
            // transaction do the materializing.
            id: "slicer-materializes-two-children",
            agent: "slicer",
            phase: "slicer",
            ordinal: 1,
            requiredTools: ["slicer_finalize_decomposition"],
            thinking: "Materialize two real child PLANNED_CHANGE plans for the approved Epic.",
            toolCalls: [{
                name: "slicer_finalize_decomposition",
                arguments: {
                    confirmation: "User confirmed the two-child decomposition.",
                    children: [
                        {
                            title: "Child one",
                            order: 1,
                            summary: "First child lifecycle",
                            dependencies: [],
                            affectedPaths: [],
                            executionAgent: "engineer",
                            collaborationRecommendation: "autonomous",
                            content: "# Child one\n\nFirst Golden child.",
                        },
                        {
                            title: "Child two",
                            order: 2,
                            summary: "Second child lifecycle",
                            dependencies: [],
                            affectedPaths: [],
                            executionAgent: "engineer",
                            collaborationRecommendation: "autonomous",
                            content: "# Child two\n\nSecond Golden child.",
                        },
                    ],
                },
            }],
        },
        {
            // The Slicer's agent loop, like every other, runs until a turn answers
            // without tool calls.
            id: "slicer-closes-decomposition",
            agent: "slicer",
            phase: "slicer",
            ordinal: 2,
            text: "Decomposition finalized with two child Planned Changes.",
        },
        {
            id: "planner-submits-first-child",
            agent: "planner",
            phase: "plan_review",
            ordinal: 2,
            requiredTools: ["plan_written"],
            thinking: "Finalize the first child Planned Change and submit it for review.",
            toolCalls: [{
                name: "plan_written",
                arguments: {
                    planName: "epic/01-child-one",
                    objectiveChecks: [{ id: "OC1", command: "test -f golden-child-one.txt" }],
                },
            }],
        },
        {
            id: "engineer-implements-first-child",
            agent: "engineer",
            phase: "engineer",
            planName: "epic/01-child-one",
            ordinal: 1,
            requiredTools: ["bash", "task_completed"],
            thinking: "Implement the first child in its execution worktree.",
            toolCalls: [
                { name: "bash", arguments: { command: "printf one > golden-child-one.txt" } },
                { name: "task_completed", arguments: { message: "- Implemented the first Golden child." } },
            ],
        },
        {
            id: "engineer-closes-first-child",
            agent: "engineer",
            phase: "engineer",
            planName: "epic/01-child-one",
            ordinal: 2,
            text: "First child awaits Workflow Validation.",
        },
        {
            id: "reviewer-approves-first-child",
            agent: "reviewer",
            phase: "semantic_review",
            planName: "epic/01-child-one",
            ordinal: 1,
            requiredTools: ["review_diff", "review_complete"],
            thinking: "Inspect the first child diff, then approve it.",
            toolCalls: [
                { name: "review_diff", arguments: { command: "list" } },
                { name: "review_complete", arguments: { approved: true, feedback: "First child approved." } },
            ],
        },
        {
            id: "reviewer-closes-first-child-round",
            agent: "reviewer",
            phase: "semantic_review",
            planName: "epic/01-child-one",
            ordinal: 2,
            text: "Reported the approved first child outcome.",
        },
        {
            // Everything from here is driven by the Runtime's real Epic continuation
            // after the first child verifies: a fresh Session, the Planner on the
            // second child, its own review, execution and validation.
            id: "planner-submits-second-child",
            agent: "planner",
            phase: "plan_review",
            ordinal: 3,
            requiredTools: ["plan_written"],
            thinking: "Finalize the second child Planned Change and submit it for review.",
            toolCalls: [{
                name: "plan_written",
                arguments: {
                    planName: "epic/02-child-two",
                    objectiveChecks: [{ id: "OC1", command: "test -f golden-child-two.txt" }],
                },
            }],
        },
        {
            id: "engineer-implements-second-child",
            agent: "engineer",
            phase: "engineer",
            planName: "epic/02-child-two",
            ordinal: 1,
            requiredTools: ["bash", "task_completed"],
            thinking: "Implement the second child in its execution worktree.",
            toolCalls: [
                { name: "bash", arguments: { command: "printf two > golden-child-two.txt" } },
                { name: "task_completed", arguments: { message: "- Implemented the second Golden child." } },
            ],
        },
        {
            id: "engineer-closes-second-child",
            agent: "engineer",
            phase: "engineer",
            planName: "epic/02-child-two",
            ordinal: 2,
            text: "Second child awaits Workflow Validation.",
        },
        {
            id: "reviewer-approves-second-child",
            agent: "reviewer",
            phase: "semantic_review",
            planName: "epic/02-child-two",
            ordinal: 1,
            requiredTools: ["review_diff", "review_complete"],
            thinking: "Inspect the second child diff, then approve it.",
            toolCalls: [
                { name: "review_diff", arguments: { command: "list" } },
                { name: "review_complete", arguments: { approved: true, feedback: "Second child approved." } },
            ],
        },
        {
            // Optional: whether a round needs a closing text turn depends on how the
            // Reviewer session settles after review_complete, which varies by one turn.
            id: "reviewer-closes-second-child-round",
            agent: "reviewer",
            phase: "semantic_review",
            planName: "epic/02-child-two",
            ordinal: 2,
            optional: true,
            text: "Reported the approved second child outcome.",
        },
    ],
    actions: [
        {
            type: "writeProjectFile",
            path: "docs/plans/epic.md",
            text:
                "---\nclassification: PROJECT\ncomplexity: MEDIUM\nsummary: Golden Epic\naffectedPaths: []\nstatus: draft\n---\n# Golden Epic\n\nDraft PROJECT content.\n",
        },
        { type: "type", text: "submit the epic project plan for architect review" },
        { type: "enter" },
        {
            // `approvalAction: "later"` settles the Epic at ready_for_decomposition.
            // Accepting the transient `approved` here let the scenario race ahead of
            // the lifecycle and act on a status the Plan had already left.
            type: "waitForPlanStatus",
            planName: "epic",
            statuses: ["ready_for_decomposition"],
            timeoutMs: 12000,
        },
        { type: "runSlicerDecomposition", planName: "epic" },
        { type: "waitForIdle", timeoutMs: 15000 },
        // Decomposition leaves the Slicer active, so the next request would go to it.
        // `/agent` is the real user-facing way back to the Planner.
        // Wait for the third Planner event so this does not match startup's stale events.
        { type: "type", text: "/agent planner" },
        { type: "enter" },
        { type: "waitForEventCount", event: "runtime:agent:planner", count: 3, timeoutMs: 45000 },
        { type: "waitForIdle", timeoutMs: 15000 },
        // Explicit launch of the first child, as a real user message: Epic approval is
        // not Epic execution. Its Plan Review, execution and validation all run for
        // real, and the Runtime continues into the second child on its own.
        { type: "type", text: "finalize and submit the first child planned change for review" },
        { type: "enter" },
        {
            type: "waitForPlanStatus",
            planName: "epic/01-child-one",
            statuses: ["verified", "user_verified"],
            // Two full child journeys run inside these two waits, each with real Git,
            // real transactions and real Agent turns. It takes ~95s on its own, and
            // `deno task ci` runs 12 files at a time, so the budget is sized for that
            // contention rather than for a standalone run.
            timeoutMs: 240000,
        },
        {
            type: "waitForPlanStatus",
            planName: "epic/02-child-two",
            statuses: ["verified", "user_verified"],
            timeoutMs: 240000,
        },
        // No idle wait here: both children's terminal statuses above already prove
        // the Epic finished, and after the continuation replaced the Session the
        // composition tracks a Session the Runtime has closed, so idle never settles.
        { type: "captureProjectDurability", planName: "epic" },
        { type: "generateWorkRecord", planName: "epic/02-child-two" },
        { type: "captureProjectState", planNames: ["epic", "epic/01-child-one", "epic/02-child-two"] },
    ],
    assertions: [
        assertsGoldenCoverage("durable:session-replaced", (result) => {
            assertRuntimeEvent("durable:session-replaced", "runtime:session-replaced:epic_continuation")(result);
            const replacement =
                /** @type {{ previousSessionId?: string, currentSessionId?: string } | undefined} */ (result.state
                    .replacedSession);
            assert(
                replacement?.previousSessionId !== replacement?.currentSessionId,
                "Expected typed Session replacement identity.",
            );
        }),
        assertsGoldenCoverage("durable:epic-evidence", (result) => {
            assertEventIncludes(result, "project:epic:evidence");
            assertRuntimeSessionReplacementAndEpicEvidence(result, "durable:epic-evidence");
        }),
        assertsGoldenCoverage("durable:epic-completion", (result) => {
            const projectState =
                /** @type {{ plans?: Array<{ name?: string, attrs?: Record<string, unknown> | null }>, registryEntries?: unknown[], nonTerminalRegistryEntries?: unknown[], workRecordNames?: string[] } | undefined} */ (result
                    .state.projectState);
            const parent = /** @type {EpicCompletionAttrs | undefined} */ (
                projectState?.plans?.find((plan) => plan.name === "epic")?.attrs || undefined
            );
            const planReview = /** @type {PlanReviewState | undefined} */ (result.state.planReview);
            assert(parent?.status === "verified", `Expected parent Epic verified; got ${parent?.status}`);
            assert(
                parent?.epicCompletionMode === "done_enough",
                `Expected parent Epic done_enough; got ${parent?.epicCompletionMode}`,
            );
            assert(
                (projectState?.registryEntries || []).length === 0,
                `Expected fully drained project registry; got ${JSON.stringify(projectState?.registryEntries)}`,
            );
            assert(
                (projectState?.nonTerminalRegistryEntries || []).length === 0,
                `Expected no live project registry entries; got ${
                    JSON.stringify(projectState?.nonTerminalRegistryEntries)
                }`,
            );
            assert(
                parent?.workRecord?.status === "generated" ||
                    planReview?.attrs?.workRecord?.status === "generated" ||
                    (projectState?.workRecordNames || []).some((name) => name.startsWith("docs/work-records/")),
                `Expected Work Record storage evidence; got status=${
                    parent?.workRecord?.status || planReview?.attrs?.workRecord?.status
                } files=${(projectState?.workRecordNames || []).join(", ")}`,
            );
        }),
        assertsGoldenCoverage("durable:work-record", (result) => {
            const workRecord =
                /** @type {{ status?: string, path?: string, error?: string, recordNames?: string[] } | undefined} */ (result
                    .state.workRecord);
            // "skipped" is a real outcome, not a miss: the Epic's completed work
            // already had a record, and generating a second one for the same source
            // is what the generator exists to prevent. What must be true either way
            // is that the real store now holds a real record on disk.
            assert(
                workRecord?.status === "generated" || workRecord?.status === "skipped",
                `Expected the Work Record generator to run against the verified child; got ${workRecord?.status} ${
                    workRecord?.error || ""
                }`,
            );
            const records = workRecord.recordNames || [];
            assert(records.length >= 1, "Expected the real Work Record store to hold a record after the Epic.");
            assert(
                records.every((name) => name.startsWith("docs/work-records/") && name.endsWith(".md")),
                `Expected Work Records under docs/work-records/; got ${records.join(", ")}`,
            );
        }),
    ],
};

/**
 * Reuse a turn from the two-child Epic script by name.
 *
 * Looked up rather than copied so the shared opening — Epic approval, real Slicer
 * decomposition, the first child's Plan Review — cannot drift between the scenario
 * where children verify and the one where a child does not.
 *
 * @param {string} id
 */
function epicTurn(id) {
    const turn = twoChildProjectContinuationScenario.script.find((entry) => entry.id === id);
    if (!turn) throw new Error(`Golden PROJECT script has no turn "${id}".`);
    return turn;
}

/**
 * An Epic child whose Objective-Failing Check is never satisfied, stopped by the user.
 *
 * The two-child scenario proves the happy path: children verify and the Runtime
 * continues into the next one by itself. The question it cannot answer is what happens
 * when a child *does not* verify — the case where a Project has the most to lose,
 * because a stalled Epic strands every child behind it.
 *
 * Objective-Failing Checks are the mechanism that decides this. The Engineer reports
 * success, the check disagrees, and RunWield repairs and re-checks until it runs out of
 * automatic rounds. What has to be true at that point is the product promise: RunWield
 * pauses rather than halting, says what happened and what to do next in plain English,
 * and leaves the user somewhere they can act. Choosing Stop must end the run visibly and
 * leave the terminal usable — not continue into the next child as though the first one
 * had passed, and not sit there forever.
 */
export const projectChildObjectiveCheckStopScenario = {
    ...twoChildProjectContinuationScenario,
    name: "project-child-objective-check-unmet-stops",
    coverage: ["recovery:objective-check-unmet", "durable:epic-child-halted"],
    // Only two reviews are reached: the Epic, then the first child. The child never
    // gets to Semantic Review, because Mechanical Validation never lets it through.
    reviewDecisions: [
        { approved: true, feedback: "Architect approved the two-child PROJECT.", approvalAction: "later" },
        { approved: true, feedback: "First child approved to run.", approvalAction: "run" },
    ],
    scriptedInteractions: [
        {
            type: "select",
            // The words the user actually reads when the automatic rounds run out.
            promptIncludes: "still unmet",
            value: "stop",
        },
    ],
    script: [
        epicTurn("architect-approves-epic-plan"),
        epicTurn("slicer-materializes-two-children"),
        epicTurn("slicer-closes-decomposition"),
        // Carries the `test -f golden-child-one.txt` Objective-Failing Check that the
        // Engineer below never satisfies.
        epicTurn("planner-submits-first-child"),
        {
            // Writes a real file and reports real success. The Engineer believes it is
            // done; only the Objective-Failing Check knows otherwise, which is the whole
            // reason the check exists.
            id: "engineer-implements-first-child-incorrectly",
            agent: "engineer",
            phase: "engineer",
            planName: "epic/01-child-one",
            ordinal: 1,
            requiredTools: ["bash", "task_completed"],
            thinking: "Implement the first child.",
            toolCalls: [
                { name: "bash", arguments: { command: "printf one > golden-child-one-draft.txt" } },
                { name: "task_completed", arguments: { message: "- Implemented the first Golden child." } },
            ],
        },
        {
            id: "engineer-closes-first-child-attempt",
            agent: "engineer",
            phase: "engineer",
            planName: "epic/01-child-one",
            ordinal: 2,
            text: "First child awaits Mechanical Validation.",
        },
        {
            // Repair round one. Still the wrong file: a repair that cannot see why the
            // check fails is exactly the situation the round limit exists for.
            id: "engineer-first-objective-check-repair",
            agent: "engineer",
            phase: "engineer",
            planName: "epic/01-child-one",
            ordinal: 3,
            requiredTools: ["bash", "task_completed"],
            thinking: "Repair the first child after the Objective-Failing Check reported it unmet.",
            toolCalls: [
                { name: "bash", arguments: { command: "printf repaired >> golden-child-one-draft.txt" } },
                { name: "task_completed", arguments: { message: "- Attempted a repair for the first Golden child." } },
            ],
        },
        {
            id: "engineer-closes-first-objective-check-repair",
            agent: "engineer",
            phase: "engineer",
            planName: "epic/01-child-one",
            ordinal: 4,
            text: "First repair awaits re-validation.",
        },
        {
            id: "engineer-second-objective-check-repair",
            agent: "engineer",
            phase: "engineer",
            planName: "epic/01-child-one",
            ordinal: 5,
            requiredTools: ["bash", "task_completed"],
            thinking: "Repair the first child again after the Objective-Failing Check is still unmet.",
            toolCalls: [
                { name: "bash", arguments: { command: "printf again >> golden-child-one-draft.txt" } },
                { name: "task_completed", arguments: { message: "- Attempted a second repair." } },
            ],
        },
        {
            id: "engineer-closes-second-objective-check-repair",
            agent: "engineer",
            phase: "engineer",
            planName: "epic/01-child-one",
            ordinal: 6,
            optional: true,
            text: "Second repair awaits re-validation.",
        },
    ],
    actions: [
        {
            type: "writeProjectFile",
            path: "docs/plans/epic.md",
            text:
                "---\nclassification: PROJECT\ncomplexity: MEDIUM\nsummary: Golden Epic\naffectedPaths: []\nstatus: draft\n---\n# Golden Epic\n\nDraft PROJECT content.\n",
        },
        { type: "type", text: "submit the epic project plan for architect review" },
        { type: "enter" },
        {
            type: "waitForPlanStatus",
            planName: "epic",
            statuses: ["ready_for_decomposition"],
            timeoutMs: 12000,
        },
        { type: "runSlicerDecomposition", planName: "epic" },
        { type: "waitForIdle", timeoutMs: 15000 },
        // Wait for the third Planner event so this does not match startup's stale events.
        { type: "type", text: "/agent planner" },
        { type: "enter" },
        { type: "waitForEventCount", event: "runtime:agent:planner", count: 3, timeoutMs: 45000 },
        { type: "waitForIdle", timeoutMs: 15000 },
        { type: "type", text: "finalize and submit the first child planned change for review" },
        { type: "enter" },
        // Two repair rounds and three validation passes run inside this wait, and it
        // ends at the Retry/Stop menu the scripted interaction above answers with Stop.
        { type: "waitForIdle", timeoutMs: 240000 },
        { type: "captureProjectDurability", planName: "epic" },
    ],
    assertions: [
        assertsGoldenCoverage("recovery:objective-check-unmet", (result) => {
            // The pause has to reach the screen as something a person can act on:
            // what happened, what to do next, and a menu — not a stack trace.
            assertScreenIncludes(result, "still unmet");
            // The menu was really put to the user and really answered, rather than the
            // run simply ending. `objective_checks_attempt` is a Plan lifecycle event,
            // not a runtime one, so it is not in this stream.
            assertEventIncludes(result, "runtime:interaction_requested");
            assertEventIncludes(result, "runtime:interaction_resolved");
            const children =
                /** @type {Array<{ name?: string, status?: string }> | undefined} */ (result.state.projectChildren);
            const firstChild = children?.find((child) => String(child.name || "").includes("01-child-one"));
            assert(
                firstChild && !["verified", "user_verified"].includes(String(firstChild.status || "")),
                `Expected the first child to stop short of verified; got ${firstChild?.status}`,
            );
        }),
        assertsGoldenCoverage("durable:epic-child-halted", (result) => {
            // The Epic must not walk past a child that never passed. Continuing here
            // would deliver a second child on top of an unverified first one, which is
            // the failure this scenario exists to catch.
            const children =
                /** @type {Array<{ name?: string, status?: string }> | undefined} */ (result.state.projectChildren);
            const secondChild = children?.find((child) => String(child.name || "").includes("02-child-two"));
            assert(
                secondChild && !["verified", "user_verified"].includes(String(secondChild.status || "")),
                `Expected the Epic not to continue past an unverified child; second child was ${secondChild?.status}`,
            );
            const durability = /** @type {{ trackedFiles?: string } | undefined} */ (result.state.projectDurability);
            assert(
                !String(durability?.trackedFiles || "").includes("golden-child-two.txt"),
                "Expected no second-child delivery after the first child stopped.",
            );
            // Stopped, not stranded: the run ends somewhere the user can keep working.
            assert(
                !String(durability?.trackedFiles || "").includes("golden-child-one-draft.txt"),
                "Expected the unverified child's work to stay in its worktree rather than reach the checkout.",
            );
        }),
    ],
};

export const projectWorkflowScenarios = [
    projectPlanReviewScenario,
    twoChildProjectContinuationScenario,
    projectChildObjectiveCheckStopScenario,
];
