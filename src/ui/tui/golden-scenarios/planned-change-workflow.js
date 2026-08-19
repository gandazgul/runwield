/**
 * @module ui/tui/golden-scenarios/planned-change-workflow
 * Composed Golden PLANNED_CHANGE workflow scenarios.
 */

import { assert, assertEquals } from "@std/assert";
import { assertEventIncludes, assertScreenIncludes } from "../testing/scenario-runner.js";
import { assertRuntimeEvent, assertsGoldenCoverage } from "../testing/portfolio-assertions.js";

/** @typedef {import('../testing/scenario-runner.js').GoldenScenarioResult} GoldenScenarioResult */

/**
 * @param {GoldenScenarioResult} result
 * @param {string} text
 * @returns {number}
 */
function countVisibleOccurrences(result, text) {
    const haystack = `${result.scrollbackText || ""}\n${result.screenText || ""}`;
    return haystack.split(text).length - 1;
}

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
    assertEventIncludes(result, "runtime:tool:start:write");
    assertEventIncludes(result, "runtime:tool:start:task_completed");
    assertEventIncludes(result, "runtime:tool:start:review_complete");
    assertEventIncludes(result, "runtime:tool:start:review_complete");
    assertScreenIncludes(result, "Running the tests in");
    assertEventIncludes(result, "runtime:tool:start:review_complete");
    assertScreenIncludes(result, "found no need for a fix");
    assertScreenIncludes(result, "adding the finished work");
    assertEventIncludes(result, "workflow:durability:delivery-checked");
    assertEventIncludes(result, "workflow:durability:registry-clean");
    assertEventIncludes(result, "workflow:durability:ancestry-checked");
    assertEventIncludes(result, "workflow:durability:evidence-recorded");
    assertEventIncludes(result, "workflow:durability:terminal-ready");
    const durability =
        /** @type {{ goldenFileExists?: boolean, trackedFiles?: string, deliveryLog?: string, deliveryEvidence?: string, status?: string, validatedExecutionCommit?: string, executionCommitPublished?: boolean, editorUsable?: boolean } | undefined} */ (result
            .state.workflowDurability);
    assert(durability?.goldenFileExists === true, "Expected delivered Golden file to exist after Workflow Validation.");
    assert(
        String(durability?.trackedFiles || "").includes("golden-planned-change.txt"),
        "Expected delivered file tracked in Git.",
    );
    assert(String(durability?.deliveryLog || "").length > 0, "Expected Git ancestry evidence for delivery commit.");
    assert(
        String(durability?.validatedExecutionCommit || "").length > 0,
        "Expected validated execution commit evidence.",
    );
    assert(
        durability?.executionCommitPublished === true,
        "Expected validated execution commit published to delivered HEAD.",
    );
    assert(
        String(durability?.deliveryEvidence || "").includes("golden"),
        "Expected recorded delivery evidence content.",
    );
    const statusLines = String(durability?.status || "").split("\n").filter(Boolean);
    assert(
        // Plus the Work Record the post-verification handoff writes under docs/, which
        // is a product output the user keeps or discards, not publication residue.
        statusLines.every((line) => {
            const path = line.slice(3).trim();
            return line.endsWith("docs/plans/plan.md") || line.endsWith(".wld/worktrees.json") ||
                line.endsWith("docs/") || line.includes("docs/work-records/") || path === ".gitignore" ||
                path === ".wld/settings.json";
        }),
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
    scriptedInteractions: [
        { type: "text", promptIncludes: "Enter the command that runs this project's tests", value: "true" },
    ],
    script: [
        {
            id: "planner-submit-feedback-round",
            agent: "planner",
            phase: "plan_review",
            ordinal: 1,
            requiredTools: ["plan_written"],
            thinking: "Submit draft for Plan Review feedback.",
            toolCalls: [{
                name: "plan_written",
                arguments: {
                    planName: "plan",
                    objectiveChecks: [{
                        id: "OC1",
                        command: "test -f golden-planned-change.txt",
                        rationale: "implementation creates the golden planned-change artifact",
                    }],
                },
            }],
        },
        {
            id: "planner-submit-approval-round",
            agent: "planner",
            phase: "plan_review",
            ordinal: 2,
            requiredTools: ["plan_written"],
            thinking: "Resubmit revised Plan for approval and execution.",
            toolCalls: [{
                name: "plan_written",
                arguments: {
                    planName: "plan",
                    objectiveChecks: [{
                        id: "OC1",
                        command: "test -f golden-planned-change.txt",
                        rationale: "implementation creates the golden planned-change artifact",
                    }],
                },
            }],
        },
        {
            id: "engineer-implements-plan",
            agent: "engineer",
            phase: "engineer",
            ordinal: 1,
            requiredTools: ["write"],
            thinking: "Implement the approved PLANNED_CHANGE in the execution worktree.",
            toolCalls: [{ name: "write", arguments: { path: "golden-planned-change.txt", content: "golden" } }],
        },
        {
            // `task_completed` terminates its Agent turn. Keeping it in the same
            // model response as a mutating tool lets the runtime cancel that sibling
            // while it has opened the file but not written it yet; under parallel CI
            // validation then checkpoints an empty implementation. A real completion
            // report comes after the implementation tool has settled, so the Golden
            // actor models that ordering in a separate turn too.
            id: "engineer-reports-plan-complete",
            agent: "engineer",
            phase: "engineer",
            ordinal: 2,
            requiredTools: ["task_completed"],
            thinking: "Report the completed and verified implementation.",
            toolCalls: [{
                name: "task_completed",
                arguments: { message: "- Implemented Golden PLANNED_CHANGE and verified with true." },
            }],
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
            requiredTools: ["write"],
            thinking: "Repair in the same active PLANNED_CHANGE workflow after reviewer rejection.",
            toolCalls: [{
                name: "write",
                arguments: { path: "golden-planned-change.txt", content: "goldenrepaired" },
            }],
        },
        {
            id: "engineer-reports-review-repair-complete",
            agent: "engineer",
            phase: "engineer",
            ordinal: 4,
            requiredTools: ["task_completed"],
            thinking: "Report the completed semantic-review repair.",
            toolCalls: [{
                name: "task_completed",
                arguments: { message: "- Repaired Golden PLANNED_CHANGE after Reviewer rejection." },
            }],
        },
        {
            // The isolated repair session runs until a turn answers without tool
            // calls; only then does Validation resume with round 2.
            id: "engineer-post-repair-turn-before-re-review",
            agent: "engineer",
            phase: "engineer",
            ordinal: 5,
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
            ordinal: 6,
            optional: true,
            text: "Engineer idle after delivery.",
        },
    ],
    actions: [
        {
            type: "writeProjectFile",
            path: "docs/plans/plan.md",
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
        { type: "waitForRemotePlanStatus", planName: "plan", statuses: ["validated"], timeoutMs: 240000 },
        { type: "waitForWorktreeRegistryStatus", planName: "plan", statuses: ["absent"], timeoutMs: 90000 },
        { type: "waitForIdle", timeoutMs: 90000 },
        { type: "assertWorkflowDurability" },
    ],
    assertions: [
        assertsGoldenCoverage("workflow:PLANNED_CHANGE", assertRealPlanReviewRevisionAndApproval),
        assertsGoldenCoverage("recovery:reviewer-rejection", (result) => {
            assertEventIncludes(result, "runtime:tool:start:review_complete");
            assertScreenIncludes(result, "found no need for a fix");
        }),
        assertsGoldenCoverage("recovery:workflow-validation", (result) => {
            assertScreenIncludes(result, "Running the tests in");
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
                /** @type {{ executionCommitPublished?: boolean } | undefined} */ (result.state.workflowDurability);
            assert(durability?.executionCommitPublished === true, "Expected validated commit publication.");
        }),
        assertRuntimeEvent("durable:registry-cleanup", "workflow:durability:registry-clean"),
        // The inline verdict block, asserted where it renders. `Reviewer:` is its own
        // header — the pinned panel titles the same report "Reviewer latest Review" —
        // and the verdict line is the body it exists to show.
        assertsGoldenCoverage("block:review-result", (result) => {
            assertScreenIncludes(result, "Reviewer:");
            assertScreenIncludes(result, "Semantic review rejected — issues found:");
        }),
        // The pinned panel, asserted on the screen it is supposed to be pinned to.
        // This capability used to be claimed by a runtime-event assertion, which is
        // why the panel could disappear from every PLANNED_CHANGE run — the status
        // lines stopped carrying `validationProgress` — with the matrix still green.
        assertsGoldenCoverage("block:validation-handoff", (result) => {
            // Both strings exist only inside the panel's own rendering. An earlier
            // attempt asserted "Workflow Validation", which the Engineer's handoff
            // line also contains — it passed with the panel fully disabled.
            assertScreenIncludes(result, "Workflow Validation verified");
            assertScreenIncludes(result, "Reviewer latest Review");
        }),
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
        { path: "golden-planned-change.txt", text: "committed baseline\n" },
    ],
    scriptedInteractions: [
        { type: "text", promptIncludes: "Enter the command that runs this project's tests", value: "true" },
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
            path: "docs/plans/plan.md",
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
                /** @type {{ executionCommitPublished?: boolean } | undefined} */ (result.state.workflowDurability);
            // And Retry finished the job in the same run: no second attempt from the
            // user, no Plan sent back to the beginning.
            assert(
                durability?.executionCommitPublished === true,
                "Expected Retry to publish after the user cleared the way.",
            );
        }),
        assertsGoldenCoverage("block:select", (result) => {
            const interactions = /** @type {Array<{ interaction?: { value?: string } }> | undefined} */ (result.state
                .scriptedInteractions);
            const retryInteractions = interactions?.filter((entry) => entry.interaction?.value === "retry") || [];
            assertEquals(
                retryInteractions.length,
                1,
                "Expected exactly one merge pause: RunWield asks once, then carries on.",
            );
        }),
    ],
};

/**
 * Reuse a turn from the main PLANNED_CHANGE script by name.
 *
 * @param {string} id
 */
function plannedChangeTurn(id) {
    const turn = plannedChangeReviewRepairValidationScenario.script.find((entry) => entry.id === id);
    if (!turn) throw new Error(`Golden PLANNED_CHANGE script has no turn "${id}".`);
    return turn;
}

/**
 * CI fails, the Engineer repairs it, and the workflow carries on from where it was.
 *
 * Every other scenario in this portfolio commits `verification_command: "true"`, so CI
 * has never once failed in a Golden run. That left the entire mechanical repair loop —
 * the most-used recovery path in the product — covered only by unit tests, while
 * `recovery:workflow-validation` was claimed by a scenario that exercises the *reviewer*
 * repair instead. This is the missing half.
 *
 * The question it answers is not "does the repair Agent run", which unit tests can show.
 * It is whether RunWield keeps its place: after a dispatched repair the loop has to
 * re-run CI, and only once CI passes may it move on to Semantic Review and delivery.
 * Losing that position is how a change reaches the target branch without ever having a
 * passing build.
 *
 * The failing command is `test -f ci-fix.txt`, so CI fails until the repair creates that
 * file and passes afterwards — the same command throughout, deciding differently because
 * the worktree changed. Nothing in the harness switches it.
 */
export const plannedChangeCiRepairReentryScenario = {
    ...plannedChangeReviewRepairValidationScenario,
    name: "planned-change-ci-failure-repair-reentry",
    coverage: ["recovery:ci-repair"],
    committedProjectFiles: [
        {
            path: ".wld/settings.json",
            text: `${JSON.stringify({ verification_command: "test -f ci-fix.txt" }, null, 4)}\n`,
        },
    ],
    scriptedInteractions: [],
    // The Reviewer approves first time. Reviewer rejection already has its own scenario,
    // and mixing both would leave it ambiguous which loop re-entry the assertions prove.
    reviewDecisions: [
        { approved: false, feedback: "Reviewer-style feedback: narrow the implementation and resubmit." },
        { approved: true, feedback: "Approved to run.", approvalAction: "run" },
    ],
    script: [
        plannedChangeTurn("planner-submit-feedback-round"),
        plannedChangeTurn("planner-submit-approval-round"),
        plannedChangeTurn("engineer-implements-plan"),
        plannedChangeTurn("engineer-reports-plan-complete"),
        {
            // Dispatched by Mechanical Validation after the build fails. Creating
            // `ci-fix.txt` is what makes the next CI run pass.
            id: "engineer-repairs-failing-ci",
            agent: "engineer",
            phase: "engineer",
            ordinal: 3,
            requiredTools: ["write"],
            thinking: "Fix the failing build, then report the repair complete.",
            toolCalls: [{ name: "write", arguments: { path: "ci-fix.txt", content: "fixed" } }],
        },
        {
            id: "engineer-reports-ci-repair-complete",
            agent: "engineer",
            phase: "engineer",
            ordinal: 4,
            requiredTools: ["task_completed"],
            thinking: "Report the completed build repair.",
            toolCalls: [{ name: "task_completed", arguments: { message: "- Fixed the failing build." } }],
        },
        {
            id: "engineer-closes-ci-repair",
            agent: "engineer",
            phase: "engineer",
            ordinal: 5,
            text: "Engineer awaits re-validation of the build fix.",
        },
        {
            // Reached only if the loop re-entered Mechanical Validation, re-ran CI, and
            // passed. If it lost its place this turn is never requested.
            id: "semantic-reviewer-approves-after-ci-repair",
            agent: "reviewer",
            phase: "semantic_review",
            ordinal: 1,
            requiredTools: ["review_diff", "review_complete"],
            thinking: "Inspect the diff after the build was fixed, then approve.",
            toolCalls: [
                { name: "review_diff", arguments: { command: "list" } },
                { name: "review_complete", arguments: { approved: true, feedback: "Approved after the build fix." } },
            ],
        },
        {
            id: "semantic-reviewer-closes-after-ci-repair",
            agent: "reviewer",
            phase: "semantic_review",
            ordinal: 2,
            optional: true,
            text: "Reported the approved outcome.",
        },
        {
            id: "engineer-idle-after-ci-repair-delivery",
            agent: "engineer",
            phase: "engineer",
            ordinal: 6,
            optional: true,
            text: "Engineer idle after delivery.",
        },
    ],
    assertions: [
        assertsGoldenCoverage("recovery:ci-repair", (result) => {
            // CI really failed and the repair was really dispatched.
            assertScreenIncludes(result, "The build failed");
            // ...and then the loop went back and ran CI again, rather than moving on or
            // starting the Plan over.
            assertScreenIncludes(result, "Running the tests in");
            // Semantic Review is only reachable once Mechanical Validation passes, so
            // this is the proof that re-entry landed in the right place.
            assertScreenIncludes(result, "found no need for a fix");
            assertScreenIncludes(result, "adding the finished work");
            const durability =
                /** @type {{ goldenFileExists?: boolean, trackedFiles?: string, executionCommitPublished?: boolean } | undefined} */ (result
                    .state.workflowDurability);
            assert(
                durability?.executionCommitPublished === true,
                "Expected delivery only after a passing CI run and an approved review.",
            );
            // The repair's own work is part of what shipped, which is only true if the
            // run continued from the repair instead of restarting without it.
            assert(
                String(durability?.trackedFiles || "").includes("ci-fix.txt"),
                `Expected the build fix to be delivered; tracked=${durability?.trackedFiles}`,
            );
            assert(
                String(durability?.trackedFiles || "").includes("golden-planned-change.txt"),
                "Expected the original implementation to survive the repair.",
            );
        }),
    ],
};

/** @type {import('../testing/scenario-runner.js').GoldenScenario} */
export const plannedChangeNonGitInPlaceScenario = {
    name: "planned-change-non-git-in-place-delivery",
    composedTui: true,
    initialAgentName: "planner",
    terminal: { columns: 100, rows: 30 },
    timeoutMs: 150000,
    nonGitProject: true,
    coverage: ["durable:non-git-in-place"],
    reviewDecisions: [{ approved: true, feedback: "Approved for non-Git execution.", approvalAction: "run" }],
    reviewedPlan: "# Non-Git PLANNED_CHANGE\n\nGolden non-Git content.\n",
    initialProjectFiles: [
        { path: "deno.json", text: '{"tasks":{"test":"deno eval \\"true\\""}}\n' },
    ],
    scriptedInteractions: [
        { type: "select", promptIncludes: "Git is not available for this project", value: "proceed" },
        { type: "text", promptIncludes: "Enter the command that runs this project's tests", value: "deno task test" },
    ],
    script: [
        {
            id: "planner-submit-non-git-plan",
            agent: "planner",
            phase: "plan_review",
            ordinal: 1,
            requiredTools: ["plan_written"],
            thinking: "Submit non-Git Plan for approval.",
            toolCalls: [{
                name: "plan_written",
                arguments: {
                    planName: "non-git-plan",
                    objectiveChecks: [{ id: "OC1", command: "test -f golden-non-git.txt" }],
                },
            }],
        },
        {
            id: "engineer-implements-non-git-plan",
            agent: "engineer",
            phase: "engineer",
            ordinal: 1,
            requiredTools: ["bash", "task_completed"],
            thinking: "Implement directly in the non-Git project root.",
            toolCalls: [
                { name: "bash", arguments: { command: "printf non-git > golden-non-git.txt" } },
                { name: "task_completed", arguments: { message: "- Implemented non-Git Golden change." } },
            ],
        },
        {
            id: "engineer-closes-non-git-plan",
            agent: "engineer",
            phase: "engineer",
            ordinal: 2,
            text: "Non-Git implementation awaits validation.",
        },
    ],
    actions: [
        {
            type: "writeProjectFile",
            path: "docs/plans/non-git-plan.md",
            text:
                "---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Golden non-Git PLANNED_CHANGE\naffectedPaths: []\nstatus: draft\n---\n# Non-Git PLANNED_CHANGE\n\nDraft content.\n",
        },
        { type: "type", text: "submit the non-git planned change for review" },
        { type: "enter" },
        {
            type: "waitForPlanStatus",
            planName: "non-git-plan",
            statuses: ["validated", "user_verified"],
            timeoutMs: 70000,
        },
        { type: "assertProjectFile", path: "golden-non-git.txt", exists: true },
        { type: "captureProjectFileText", path: "golden-non-git.txt", key: "nonGitDeliveredFileText" },
        { type: "captureProjectState", planNames: ["non-git-plan"] },
    ],
    assertions: [
        assertsGoldenCoverage("durable:non-git-in-place", (result) => {
            const interactions = /** @type {Array<{ interaction?: { value?: string } }> | undefined} */ (result.state
                .scriptedInteractions);
            assert(
                interactions?.some((entry) => entry.interaction?.value === "proceed"),
                "Expected non-Git execution prompt to be handled through production interaction.",
            );
            const projectState =
                /** @type {{ plans?: Array<{ attrs?: Record<string, unknown> | null }>, registryEntries?: unknown[] } | undefined} */ (result
                    .state.projectState);
            const attrs = projectState?.plans?.[0]?.attrs;
            assert(
                attrs?.executionMode === "non_git_in_place",
                `Expected non_git_in_place; got ${attrs?.executionMode}`,
            );
            const deliveryEvidence = /** @type {{ mode?: string } | undefined} */ (attrs?.deliveryEvidence);
            assert(deliveryEvidence?.mode === "non_git_in_place", "Expected non-Git Delivery Evidence.");
            assert(
                result.state.nonGitDeliveredFileText === "non-git",
                `Expected delivered non-Git file contents; got ${result.state.nonGitDeliveredFileText}`,
            );
            assert((projectState?.registryEntries || []).length === 0, "Expected no worktree registry entries.");
        }),
    ],
};

/** @type {import('../testing/scenario-runner.js').GoldenScenario} */
export const plannedChangeValidationFailureRetryScenario = {
    name: "planned-change-validation-ci-failure-repair-retry-success",
    composedTui: true,
    initialAgentName: "planner",
    terminal: { columns: 100, rows: 30 },
    timeoutMs: 180000,
    coverage: ["recovery:validation-failure-retry"],
    committedProjectFiles: [
        {
            path: ".wld/settings.json",
            text: `${
                JSON.stringify(
                    { verification_command: 'test "$(cat golden-validation-retry.txt)" = repaired' },
                    null,
                    4,
                )
            }\n`,
        },
    ],
    reviewDecisions: [{ approved: true, feedback: "Approved for retry coverage.", approvalAction: "run" }],
    reviewedPlan: "# Validation retry\n\nGolden validation retry content.\n",
    script: [
        {
            id: "planner-submits-validation-retry-plan",
            agent: "planner",
            phase: "plan_review",
            ordinal: 1,
            requiredTools: ["plan_written"],
            toolCalls: [{
                name: "plan_written",
                arguments: {
                    planName: "validation-retry",
                    objectiveChecks: [{ id: "OC1", command: "test -f golden-validation-retry.txt" }],
                },
            }],
        },
        {
            id: "engineer-implements-validation-retry-failing",
            agent: "engineer",
            phase: "engineer",
            planName: "validation-retry",
            ordinal: 1,
            requiredTools: ["bash", "task_completed"],
            toolCalls: [
                { name: "bash", arguments: { command: "printf broken > golden-validation-retry.txt" } },
                {
                    name: "task_completed",
                    arguments: { message: "- Implemented retry fixture with a failing CI state." },
                },
            ],
        },
        {
            id: "engineer-closes-validation-retry-first",
            agent: "engineer",
            phase: "engineer",
            planName: "validation-retry",
            ordinal: 2,
            text: "Awaiting CI.",
        },
        {
            id: "engineer-repairs-validation-retry",
            agent: "engineer",
            phase: "engineer",
            planName: "validation-retry",
            ordinal: 3,
            requiredTools: ["bash", "task_completed"],
            toolCalls: [
                { name: "bash", arguments: { command: "printf repaired > golden-validation-retry.txt" } },
                { name: "task_completed", arguments: { message: "- Repaired retry fixture after CI failure." } },
            ],
        },
        {
            id: "engineer-closes-validation-retry-repair",
            agent: "engineer",
            phase: "engineer",
            planName: "validation-retry",
            ordinal: 4,
            text: "Awaiting retry validation.",
        },
        {
            id: "reviewer-approves-validation-retry",
            agent: "reviewer",
            phase: "semantic_review",
            planName: "validation-retry",
            ordinal: 1,
            requiredTools: ["review_diff", "review_complete"],
            toolCalls: [
                { name: "review_diff", arguments: { command: "list" } },
                { name: "review_complete", arguments: { approved: true, feedback: "Retry repair approved." } },
            ],
        },
        {
            id: "reviewer-closes-validation-retry",
            agent: "reviewer",
            phase: "semantic_review",
            planName: "validation-retry",
            ordinal: 2,
            text: "Approved retry repair.",
        },
    ],
    actions: [
        {
            type: "writeProjectFile",
            path: "docs/plans/validation-retry.md",
            text:
                "---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Validation retry\naffectedPaths: []\nstatus: draft\n---\n# Validation retry\n\nDraft content.\n",
        },
        { type: "type", text: "submit validation retry plan for review" },
        { type: "enter" },
        { type: "waitForEvent", event: "runtime:tool:start:task_completed", timeoutMs: 60000 },
        {
            type: "waitForExecutionPlanStatus",
            planName: "validation-retry",
            statuses: ["implemented"],
            timeoutMs: 90000,
        },
        { type: "waitForEvent", event: "runtime:tool:start:task_completed", timeoutMs: 90000 },
        { type: "waitForRemotePlanStatus", planName: "validation-retry", statuses: ["validated"], timeoutMs: 90000 },
        {
            type: "waitForWorktreeRegistryStatus",
            planName: "validation-retry",
            statuses: ["absent"],
            timeoutMs: 90000,
        },
        { type: "capturePublicationState", planName: "validation-retry", deliveredPath: "ci-fix.txt" },
    ],
    assertions: [
        assertsGoldenCoverage("recovery:validation-failure-retry", (result) => {
            assertScreenIncludes(result, "Running the tests in");
            assertScreenIncludes(result, "will fix it now");
            const publication =
                /** @type {{ remotePlanAttrs?: Record<string, unknown>, registryEntries?: Array<unknown> }} */ (result
                    .state.publication);
            const attrs = publication.remotePlanAttrs;
            const ciRuns = countVisibleOccurrences(result, "Running the tests in");
            assert(ciRuns >= 2, `Expected failed CI plus retry CI; saw ${ciRuns} CI runs.`);
            const completedTurns = result.events.filter((event) =>
                event === "runtime:tool:start:task_completed"
            ).length;
            assert(
                completedTurns >= 2,
                `Expected initial implementation and repair task_completed turns; saw ${completedTurns}.`,
            );
            assert(
                attrs?.status === "validated",
                `Expected retry scenario validated after repair; got ${attrs?.status}`,
            );
            assert(attrs?.planId, "Expected Plan identity to remain populated after validation retry.");
            assert(
                Number(attrs?.validationCiAttempts || 0) === 0,
                `Expected CI attempts reset after success; got ${attrs?.validationCiAttempts}`,
            );
            assertEquals(publication.registryEntries?.length, 0, "Expected successful publication cleanup.");
        }),
    ],
};

/** @type {import('../testing/scenario-runner.js').GoldenScenario} */
export const plannedChangeValidationExhaustedScenario = {
    name: "planned-change-validation-ci-exhausted-recoverable",
    composedTui: true,
    initialAgentName: "planner",
    terminal: { columns: 100, rows: 30 },
    timeoutMs: 180000,
    coverage: ["recovery:validation-exhausted"],
    committedProjectFiles: [
        { path: ".wld/settings.json", text: `${JSON.stringify({ verification_command: "false" }, null, 4)}\n` },
    ],
    reviewDecisions: [{
        approved: true,
        feedback: "Approved for exhausted validation coverage.",
        approvalAction: "run",
    }],
    reviewedPlan: "# Validation exhausted\n\nGolden exhausted validation content.\n",
    scriptedInteractions: [{ type: "select", promptIncludes: "tests for", value: "stop" }],
    script: [
        {
            id: "planner-submits-validation-exhausted-plan",
            agent: "planner",
            phase: "plan_review",
            ordinal: 1,
            requiredTools: ["plan_written"],
            toolCalls: [{
                name: "plan_written",
                arguments: {
                    planName: "validation-exhausted",
                    objectiveChecks: [{ id: "OC1", command: "test -f golden-validation-exhausted.txt" }],
                },
            }],
        },
        // The first pair is the implementation Engineer. The next three pairs
        // are the three focused CI repair cycles.
        ...[1, 2, 3, 4].flatMap((attempt) => [
            {
                id: `engineer-validation-exhausted-attempt-${attempt}`,
                agent: "engineer",
                phase: "engineer",
                planName: "validation-exhausted",
                ordinal: attempt * 2 - 1,
                requiredTools: ["bash", "task_completed"],
                toolCalls: [
                    {
                        name: "bash",
                        arguments: { command: `printf attempt-${attempt} > golden-validation-exhausted.txt` },
                    },
                    { name: "task_completed", arguments: { message: `- Attempt ${attempt} still cannot satisfy CI.` } },
                ],
            },
            {
                id: `engineer-validation-exhausted-closes-${attempt}`,
                agent: "engineer",
                phase: "engineer",
                planName: "validation-exhausted",
                ordinal: attempt * 2,
                text: `Attempt ${attempt} awaits CI.`,
            },
        ]),
    ],
    actions: [
        {
            type: "writeProjectFile",
            path: "docs/plans/validation-exhausted.md",
            text:
                "---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Validation exhausted\naffectedPaths: []\nstatus: draft\n---\n# Validation exhausted\n\nDraft content.\n",
        },
        { type: "type", text: "submit validation exhausted plan for review" },
        { type: "enter" },
        { type: "waitForEvent", event: "runtime:tool:start:task_completed", timeoutMs: 60000 },
        {
            type: "waitForExecutionPlanStatus",
            planName: "validation-exhausted",
            statuses: ["implemented"],
            timeoutMs: 90000,
        },
        { type: "waitForEventCount", event: "runtime:tool:start:task_completed", count: 4, timeoutMs: 150000 },
        { type: "waitForEventCount", event: "runtime:interaction_resolved", count: 2, timeoutMs: 150000 },
        {
            type: "waitForExecutionPlanStatus",
            planName: "validation-exhausted",
            statuses: ["implemented"],
            timeoutMs: 90000,
        },
        { type: "sleep", ms: 1000 },
        { type: "captureExecutionPlanState", planName: "validation-exhausted" },
    ],
    assertions: [
        assertsGoldenCoverage("recovery:validation-exhausted", (result) => {
            assertScreenIncludes(result, "The build failed");
            assertScreenIncludes(result, "tests for");
            const executionPlan =
                /** @type {{ attrs?: Record<string, unknown> | null, registryEntry?: { status?: string } | null }} */ (result
                    .state.executionPlan);
            const attrs = executionPlan.attrs;
            const completedTurns = result.events.filter((event) =>
                event === "runtime:tool:start:task_completed"
            ).length;
            assert(
                completedTurns >= 4,
                `Expected all exhausted implementation attempts before recoverability capture; saw ${completedTurns}.`,
            );
            assert(
                attrs?.status === "implemented",
                `Expected exhausted validation to remain implemented/recoverable; got ${attrs?.status}`,
            );
            assert(
                String(executionPlan.registryEntry?.status || "") === "completed",
                `Expected the completed worktree to remain available for validation recovery; got ${executionPlan.registryEntry?.status}`,
            );
            assert(attrs?.planId, "Expected exhausted recoverable state to preserve Plan identity.");
            const ciRuns = countVisibleOccurrences(result, "Running the tests in");
            assert(ciRuns >= 3, `Expected exhausted scenario to show at least three CI attempts; saw ${ciRuns}.`);
        }),
    ],
};

export const plannedChangeWorkflowScenarios = [
    plannedChangeReviewRepairValidationScenario,
    plannedChangeCiRepairReentryScenario,
    plannedChangeNonGitInPlaceScenario,
    plannedChangeValidationFailureRetryScenario,
    plannedChangeValidationExhaustedScenario,
];
