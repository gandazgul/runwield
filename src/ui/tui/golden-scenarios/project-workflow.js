/**
 * @module ui/tui/golden-scenarios/project-workflow
 * Composed Golden PROJECT workflow scenarios.
 */

import { assert } from "@std/assert";
import { assertEventIncludes, assertScreenIncludes } from "../testing/scenario-runner.js";
import { assertRuntimeEvent, assertsGoldenCoverage } from "../testing/portfolio-assertions.js";

/** @typedef {import('../testing/scenario-runner.js').GoldenScenarioResult} GoldenScenarioResult */

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
    assertEventIncludes(result, "project:architect:approved");
    assertEventIncludes(result, "runtime:tool:start:slicer_finalize_decomposition");
    assertEventIncludes(result, "project:slicer:materialized");
    assertEventIncludes(result, "runtime:session-replaced:epic_continuation");
    assertEventIncludes(result, "project:child:first-lifecycle");
    assertEventIncludes(result, "project:child:second-lifecycle");
    assertEventIncludes(result, "project:child:PLANNED_CHANGE");
    assertEventIncludes(result, "project:epic:evidence");
    const replacement =
        /** @type {{ previousSessionId?: string, currentSessionId?: string } | undefined} */ (result.state
            .replacedSession);
    assert(replacement?.previousSessionId && replacement?.currentSessionId, "Expected previous/current Session IDs.");
    assert(
        replacement.previousSessionId !== replacement.currentSessionId,
        "Expected PROJECT continuation to replace Session.",
    );
    const plans =
        /** @type {{ parent?: Record<string, unknown>, firstChild?: Record<string, unknown>, secondChild?: Record<string, unknown> } | undefined} */ (result
            .state.projectPlans);
    assert(plans?.parent?.classification === "PROJECT", "Expected parent Epic PROJECT metadata.");
    assert(
        plans?.firstChild?.classification === "PLANNED_CHANGE",
        "Expected first child canonical PLANNED_CHANGE metadata.",
    );
    assert(
        plans?.secondChild?.classification === "PLANNED_CHANGE",
        "Expected second child canonical PLANNED_CHANGE metadata.",
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
            path: "plans/plan.md",
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
    timeoutMs: 180000,
    coverage: ["durable:session-replaced", "durable:epic-evidence", "durable:work-record"],
    reviewDecisions: [{
        approved: true,
        feedback: "Architect approved the two-child PROJECT.",
        approvalAction: "later",
    }],
    reviewedPlan: "# Golden Epic\n\nGolden Epic approved by Architect.",
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
                            title: "Done child",
                            order: 1,
                            summary: "First child lifecycle",
                            dependencies: [],
                            affectedPaths: [],
                            executionAgent: "engineer",
                            collaborationRecommendation: "autonomous",
                            content: "# Done child\n\nFirst Golden child.",
                        },
                        {
                            title: "Next child",
                            order: 2,
                            summary: "Second child lifecycle",
                            dependencies: ["epic/01-done-child"],
                            affectedPaths: [],
                            executionAgent: "engineer",
                            collaborationRecommendation: "autonomous",
                            content: "# Next child\n\nSecond Golden child.",
                        },
                    ],
                },
            }],
        },
    ],
    actions: [
        {
            type: "writeProjectFile",
            path: "plans/epic.md",
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
        { type: "runProjectChildLifecycles", timeoutMs: 120000 },
        { type: "waitForIdle", timeoutMs: 3000 },
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
        assertsGoldenCoverage("durable:work-record", (result) => {
            assertEventIncludes(result, "project:epic:work-record");
        }),
    ],
};

export const projectWorkflowScenarios = [projectPlanReviewScenario, twoChildProjectContinuationScenario];
