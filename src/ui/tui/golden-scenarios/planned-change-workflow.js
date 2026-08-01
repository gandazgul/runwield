/**
 * @module ui/tui/golden-scenarios/planned-change-workflow
 * Composed Golden PLANNED_CHANGE workflow scenarios.
 */

import { assert, assertEquals } from "@std/assert";
import { assertEventIncludes, assertScreenIncludes } from "../testing/scenario-runner.js";
import { assertRuntimeEvent, assertsGoldenCoverage } from "../testing/portfolio-assertions.js";

/** @typedef {import('../testing/scenario-runner.js').GoldenScenarioResult} GoldenScenarioResult */

/** @param {GoldenScenarioResult} result */
function assertRealPlanReviewRevisionAndApproval(result) {
    assertEventIncludes(result, "interaction:PLAN_REVIEW:feedback");
    assertEventIncludes(result, "interaction:PLAN_REVIEW:approved");
    assertEventIncludes(result, "review_feedback");
    assertEventIncludes(result, "review_approved");
    const planReview =
        /** @type {{ lifecycleEvents?: Array<{ event: string, status?: unknown }>, plan?: string } | undefined} */ (result
            .state.planReview);
    assert(planReview, "Expected production Plan Review transaction state.");
    assert(
        planReview.lifecycleEvents?.map((event) => `${event.event}:${event.status}`).join(",") ===
            "review_feedback:feedback,review_approved:approved",
        `Expected persisted feedback then approval; got ${JSON.stringify(planReview.lifecycleEvents)}`,
    );
    assert(
        String(planReview.plan || "").includes("Golden PLANNED_CHANGE revised content."),
        "Expected reviewed revised Plan content to persist.",
    );
    assertScreenIncludes(result, 'Plan "plan" approved');
    assertEventIncludes(result, "runtime:tool:start:bash");
    assertEventIncludes(result, "runtime:tool:start:task_completed");
    assertEventIncludes(result, "runtime:tool:start:review_complete");
    assertEventIncludes(result, "runtime:tool:start:review_complete");
    assertScreenIncludes(result, "Running CI Validation");
    assertEventIncludes(result, "runtime:tool:start:review_complete");
    assertScreenIncludes(result, "Semantic Code Review Approved");
    assertScreenIncludes(result, "Merging validated worktree branch");
    assertEventIncludes(result, "workflow:durability:delivery-checked");
    assertEventIncludes(result, "workflow:durability:registry-clean");
    assertEventIncludes(result, "workflow:durability:ancestry-checked");
    assertEventIncludes(result, "workflow:durability:evidence-recorded");
    assertEventIncludes(result, "workflow:durability:terminal-ready");
    const durability =
        /** @type {{ goldenFileExists?: boolean, trackedFiles?: string, deliveryLog?: string, deliveryEvidence?: string, status?: string, worktreeBranch?: string, validatedWorktreeHead?: string, worktreeBranchPublished?: boolean, editorUsable?: boolean } | undefined} */ (result
            .state.workflowDurability);
    assert(durability?.goldenFileExists === true, "Expected delivered Golden file to exist after Workflow Validation.");
    assert(
        String(durability?.trackedFiles || "").includes("golden-planned-change.txt"),
        "Expected delivered file tracked in Git.",
    );
    assert(String(durability?.deliveryLog || "").length > 0, "Expected Git ancestry evidence for delivery commit.");
    assert(String(durability?.worktreeBranch || "").length > 0, "Expected validated worktree branch metadata.");
    assert(
        String(durability?.validatedWorktreeHead || "").length > 0,
        "Expected validated worktree branch head evidence.",
    );
    assert(
        durability?.worktreeBranchPublished === true,
        "Expected validated worktree branch head published to delivered HEAD.",
    );
    assert(
        String(durability?.deliveryEvidence || "").includes("golden"),
        "Expected recorded delivery evidence content.",
    );
    const statusLines = String(durability?.status || "").split("\n").filter(Boolean);
    assert(
        // Plus the Work Record the post-verification handoff writes under docs/, which
        // is a product output the user keeps or discards, not publication residue.
        statusLines.every((line) =>
            line.endsWith("plans/plan.md") || line.endsWith(".wld/worktrees.json") || line.endsWith("docs/") ||
            line.includes("docs/work-records/")
        ),
        `Expected only lifecycle/registry status after Direct Delivery publication; got ${statusLines.join("; ")}`,
    );
    assert(durability?.editorUsable === true, "Expected terminal/editor ready after verification.");
}

export const plannedChangeReviewRepairValidationScenario = {
    name: "planned-change-review-repair-validation-delivery",
    composedTui: true,
    initialAgentName: "planner",
    terminal: { columns: 100, rows: 30 },
    // The whole journey — real Git, real transactions, real Agent turns — takes ~55s on
    // its own. `deno task ci` runs 12 files at a time, and this bounds the child process,
    // so it is sized for the contended case rather than the standalone one.
    timeoutMs: 420000,
    coverage: [
        "workflow:PLANNED_CHANGE",
        "recovery:reviewer-rejection",
        "recovery:workflow-validation",
        "durable:plan-lifecycle",
        "durable:worktree-publication",
        "durable:registry-cleanup",
        "block:review-result",
        "block:validation-handoff",
    ],
    reviewDecisions: [
        { approved: false, feedback: "Reviewer-style feedback: narrow the implementation and resubmit." },
        { approved: true, feedback: "Approved to run.", approvalAction: "run" },
    ],
    reviewedPlan: "# Golden PLANNED_CHANGE\n\nGolden PLANNED_CHANGE revised content.\n",
    // A real Project commits its validation command. Committing it here keeps
    // Workflow Validation from writing project `.wld/settings.json` mid-run in both
    // the primary checkout and the execution worktree, which is what made Direct
    // Delivery refuse the merge for overlapping uncommitted changes. The
    // validation-command prompt itself stays covered by the QUICK_FIX role journey.
    committedProjectFiles: [
        { path: ".wld/settings.json", text: `${JSON.stringify({ verification_command: "true" }, null, 4)}\n` },
    ],
    script: [
        {
            id: "planner-submit-feedback-round",
            agent: "planner",
            phase: "plan_review",
            ordinal: 1,
            requiredTools: ["plan_written"],
            thinking: "Submit draft for Plan Review feedback.",
            toolCalls: [{ name: "plan_written", arguments: { planName: "plan" } }],
        },
        {
            id: "planner-submit-approval-round",
            agent: "planner",
            phase: "plan_review",
            ordinal: 2,
            requiredTools: ["plan_written"],
            thinking: "Resubmit revised Plan for approval and execution.",
            toolCalls: [{ name: "plan_written", arguments: { planName: "plan" } }],
        },
        {
            id: "engineer-implements-plan",
            agent: "engineer",
            phase: "engineer",
            ordinal: 1,
            requiredTools: ["bash", "task_completed"],
            thinking: "Implement the approved PLANNED_CHANGE in the execution worktree.",
            toolCalls: [
                { name: "bash", arguments: { command: "printf golden > golden-planned-change.txt" } },
                {
                    name: "task_completed",
                    arguments: { message: "- Implemented Golden PLANNED_CHANGE and verified with true." },
                },
            ],
        },
        {
            id: "engineer-post-completion-turn-before-validation",
            agent: "engineer",
            phase: "engineer",
            ordinal: 2,
            text: "Engineer awaits Workflow Validation.",
        },
        {
            id: "semantic-reviewer-rejects-implementation",
            agent: "reviewer",
            phase: "semantic_review",
            ordinal: 1,
            // Workflow Validation rejects a verdict reached without opening the
            // diff, so the scripted Reviewer must read it exactly as a real one
            // does before calling review_complete.
            requiredTools: ["review_diff", "review_complete"],
            thinking: "Inspect the diff, then reject the first implementation during semantic review.",
            toolCalls: [
                { name: "review_diff", arguments: { command: "list" } },
                {
                    name: "review_complete",
                    arguments: { approved: false, feedback: "Repair required: add durable evidence." },
                },
            ],
        },
        {
            id: "engineer-repairs-after-reviewer-rejection",
            agent: "engineer",
            phase: "engineer",
            ordinal: 3,
            requiredTools: ["bash", "task_completed"],
            thinking: "Repair in the same active PLANNED_CHANGE workflow after reviewer rejection.",
            toolCalls: [
                { name: "bash", arguments: { command: "printf repaired >> golden-planned-change.txt" } },
                {
                    name: "task_completed",
                    arguments: { message: "- Repaired Golden PLANNED_CHANGE after Reviewer rejection." },
                },
            ],
        },
        {
            // Closes the repair session the same way
            // engineer-post-completion-turn-before-validation closes the first
            // implementation: the agent loop runs until a turn answers without
            // tool calls, and only then does Validation resume with round 2.
            id: "engineer-post-repair-turn-before-re-review",
            agent: "engineer",
            phase: "engineer",
            ordinal: 4,
            text: "Engineer awaits re-review of the repair.",
        },
        {
            // The Reviewer's isolated session runs until the model answers without
            // tool calls, so each review round is two turns: the inspect/decide
            // turn above, then this text-only turn that closes the round. Without
            // it the loop would consume the next round's scripted decision early.
            id: "semantic-reviewer-closes-rejection-round",
            agent: "reviewer",
            phase: "semantic_review",
            ordinal: 2,
            text: "Reported the round 1 findings for repair.",
        },
        {
            id: "semantic-reviewer-approves-repair",
            agent: "reviewer",
            phase: "semantic_review",
            ordinal: 3,
            requiredTools: ["review_diff", "review_complete"],
            thinking: "Inspect the repair diff, then approve the repaired implementation.",
            toolCalls: [
                { name: "review_diff", arguments: { command: "list" } },
                { name: "review_complete", arguments: { approved: true, feedback: "Approved after repair." } },
            ],
        },
        {
            id: "semantic-reviewer-closes-approval-round",
            agent: "reviewer",
            phase: "semantic_review",
            ordinal: 4,
            text: "Reported the approved repair outcome.",
        },
        {
            id: "engineer-closes-after-delivery",
            agent: "engineer",
            phase: "engineer",
            ordinal: 5,
            optional: true,
            text: "Engineer idle after delivery.",
        },
    ],
    actions: [
        {
            type: "writeProjectFile",
            path: "plans/plan.md",
            text:
                "---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Golden PLANNED_CHANGE\naffectedPaths: []\nstatus: draft\n---\n# Golden PLANNED_CHANGE\n\nDraft content.\n",
        },
        { type: "type", text: "submit the planned change for review" },
        { type: "enter" },
        // The whole PLANNED_CHANGE journey runs inside these waits: plan review,
        // execution, CI, two semantic rounds with a repair between them, the merge,
        // and the post-verification handoffs. It takes about 60s on its own, and the 12s
        // budget it used to carry only ever fit because the run died at the repair.
        //
        // The budget is deliberately several times the standalone cost. `deno task ci`
        // runs 12 files at a time, and a scenario this heavy — real Git worktrees, real
        // transactions, real agent turns — stretches by more than 50% under that load. A
        // ceiling sized to the standalone run fails on contention rather than on defects.
        { type: "waitForIdle", timeoutMs: 240000 },
        { type: "waitForEvent", event: "runtime:tool:start:task_completed", timeoutMs: 60000 },
        { type: "waitForIdle", timeoutMs: 240000 },
        { type: "assertWorkflowDurability" },
    ],
    assertions: [
        assertsGoldenCoverage("workflow:PLANNED_CHANGE", assertRealPlanReviewRevisionAndApproval),
        assertsGoldenCoverage("recovery:reviewer-rejection", (result) => {
            assertEventIncludes(result, "runtime:tool:start:review_complete");
            assertScreenIncludes(result, "Semantic Code Review Approved");
        }),
        assertsGoldenCoverage("recovery:workflow-validation", (result) => {
            assertScreenIncludes(result, "Running CI Validation");
            assertEventIncludes(result, "workflow:durability:terminal-ready");
        }),
        assertsGoldenCoverage("durable:plan-lifecycle", (result) => {
            const planReview =
                /** @type {{ lifecycleEvents?: Array<{ event: string, status?: unknown }> } | undefined} */ (result
                    .state.planReview);
            assert(planReview?.lifecycleEvents?.some((event) => event.event === "review_feedback"));
            assert(planReview?.lifecycleEvents?.some((event) => event.event === "review_approved"));
        }),
        assertsGoldenCoverage("durable:worktree-publication", (result) => {
            const durability =
                /** @type {{ worktreeBranchPublished?: boolean } | undefined} */ (result.state.workflowDurability);
            assert(durability?.worktreeBranchPublished === true, "Expected validated branch publication.");
        }),
        assertRuntimeEvent("durable:registry-cleanup", "workflow:durability:registry-clean"),
        assertRuntimeEvent("block:review-result", "runtime:tool:start:review_complete"),
        assertRuntimeEvent("block:validation-handoff", "workflow:durability:terminal-ready"),
    ],
};

/**
 * The same journey, interrupted by the one thing RunWield cannot decide: the user's
 * own uncommitted work sitting in the files this change touches.
 *
 * This is the failure people actually hit, and until now it existed only in unit
 * tests. What those cannot show is the part that matters — that the pause reaches the
 * screen as a real menu, that answering it resumes the same run, and that the merge
 * completes afterwards rather than starting the Plan over.
 */
export const plannedChangeBlockedMergePauseScenario = {
    ...plannedChangeReviewRepairValidationScenario,
    name: "planned-change-uncommitted-work-blocks-merge",
    coverage: ["recovery:user-pause", "block:select"],
    committedProjectFiles: [
        ...plannedChangeReviewRepairValidationScenario.committedProjectFiles,
        { path: "golden-planned-change.txt", text: "committed baseline\n" },
    ],
    scriptedInteractions: [
        {
            type: "select",
            promptIncludes: "have not saved to git yet",
            // The user reads the message, clears what it named, and picks Retry —
            // restoring the committed content is what `git checkout --` would do.
            userFixesFirst: { path: "golden-planned-change.txt", text: "committed baseline\n" },
            value: "retry",
        },
    ],
    actions: [
        {
            type: "writeProjectFile",
            path: "plans/plan.md",
            text:
                "---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Golden PLANNED_CHANGE\naffectedPaths: []\nstatus: draft\n---\n# Golden PLANNED_CHANGE\n\nDraft content.\n",
        },
        // Left dirty on purpose, in the same file the Agent is about to change. Git
        // refuses to merge over it, which is correct: it is the user's work.
        { type: "writeProjectFile", path: "golden-planned-change.txt", text: "my own unsaved edit\n" },
        { type: "type", text: "submit the planned change for review" },
        { type: "enter" },
        // Same budget rationale as the scenario above: sized for 12-way parallel CI, not
        // for a standalone run.
        { type: "waitForIdle", timeoutMs: 240000 },
        { type: "waitForEvent", event: "runtime:tool:start:task_completed", timeoutMs: 60000 },
        { type: "waitForIdle", timeoutMs: 240000 },
        { type: "assertWorkflowDurability" },
    ],
    assertions: [
        assertsGoldenCoverage("recovery:user-pause", (result) => {
            // The pause reached the screen in words a person can act on, naming the
            // file and what to do about it — not a status name or a git error.
            assertScreenIncludes(result, "have not saved to git yet");
            assertScreenIncludes(result, "golden-planned-change.txt");
            const durability =
                /** @type {{ worktreeBranchPublished?: boolean } | undefined} */ (result.state.workflowDurability);
            // And Retry finished the job in the same run: no second attempt from the
            // user, no Plan sent back to the beginning.
            assert(
                durability?.worktreeBranchPublished === true,
                "Expected Retry to publish after the user cleared the way.",
            );
        }),
        assertsGoldenCoverage("block:select", (result) => {
            const interactions = /** @type {Array<{ interaction?: { value?: string } }> | undefined} */ (result.state
                .scriptedInteractions);
            assertEquals(interactions?.length, 1, "Expected exactly one pause: RunWield asks once, then carries on.");
            assertEquals(interactions?.[0]?.interaction?.value, "retry");
        }),
    ],
};

export const plannedChangeWorkflowScenarios = [
    plannedChangeReviewRepairValidationScenario,
    plannedChangeBlockedMergePauseScenario,
];
