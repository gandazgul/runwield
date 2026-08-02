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
        `Expected every child worktree attempt to be terminal; live=${
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
            toolCalls: [{ name: "plan_written", arguments: { planName: "epic/01-child-one" } }],
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
            toolCalls: [{ name: "plan_written", arguments: { planName: "epic/02-child-two" } }],
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
        { type: "runSlicerDecomposition", planName: "epic" },
        // Decomposition leaves the Slicer active, so the next request would go to it.
        // `/agent` is the real user-facing way back to the Planner.
        { type: "type", text: "/agent planner" },
        { type: "enter" },
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
            timeoutMs: 90000,
        },
        {
            type: "waitForPlanStatus",
            planName: "epic/02-child-two",
            statuses: ["verified", "user_verified"],
            timeoutMs: 90000,
        },
        // No idle wait here: both children's terminal statuses above already prove
        // the Epic finished, and after the continuation replaced the Session the
        // composition tracks a Session the Runtime has closed, so idle never settles.
        // Give asynchronous post-validation registry cleanup a deterministic window
        // before the durability snapshot asserts the registry is fully drained.
        { type: "sleep", ms: 5000 },
        { type: "captureProjectDurability", planName: "epic" },
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
            const parent = projectState?.plans?.find((plan) => plan.name === "epic")?.attrs;
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
                    result.state.planReview?.attrs?.workRecord?.status === "generated" ||
                    (projectState?.workRecordNames || []).some((name) => name.startsWith("docs/work-records/")),
                `Expected Work Record storage evidence; got status=${
                    parent?.workRecord?.status || result.state.planReview?.attrs?.workRecord?.status
                } files=${(projectState?.workRecordNames || []).join(", ")}`,
            );
        }),
        assertsGoldenCoverage("durable:work-record", (result) => {
            const projectState = /** @type {{ workRecordNames?: string[] } | undefined} */ (result.state.projectState);
            const records = projectState?.workRecordNames || [];
            const recordedPath = String(result.state.planReview?.attrs?.workRecord?.path || "");
            assert(
                records.length >= 1 || recordedPath.startsWith("docs/work-records/"),
                "Expected the product lifecycle to record Work Record storage evidence after the Epic.",
            );
            assert(
                records.every((name) => name.startsWith("docs/work-records/") && name.endsWith(".md")) &&
                    (!recordedPath || recordedPath.endsWith(".md")),
                `Expected Work Records under docs/work-records/; got files=${records.join(", ")} path=${recordedPath}`,
            );
        }),
    ],
};

export const projectWorkflowScenarios = [projectPlanReviewScenario, twoChildProjectContinuationScenario];
