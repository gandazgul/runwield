import { assertEquals, assertRejects } from "@std/assert";
import { runLoadPlanCommand } from "./index.js";

import { AGENTS } from "../../constants.js";
import { SESSION_COMPLETE_GUIDANCE } from "../../shared/workflow/plan-review-recovery.js";

import { addEntry as addRegistryEntry, findById as findRegistryEntryById } from "../../shared/worktree-registry.js";

import { makePlanProject, makeRuntimeContext, makeRuntimeFixture, makeUi } from "./load-plan-test-helpers.js";
import { loadPlan, savePlan, updatePlanFrontMatter } from "../../plan-store.js";

/** @typedef {import('../../plan-store.js').PlanFrontMatterInput} PlanFrontMatterInput */

/** The Plan shape most of these review journeys start from. */
const APPROVED_FEATURE = /** @type {PlanFrontMatterInput} */ ({
    classification: "FEATURE",
    complexity: "LOW",
    summary: "s",
    affectedPaths: [],
    status: "approved",
});

/** The Epic equivalent of {@link APPROVED_FEATURE}. */
const APPROVED_PROJECT = /** @type {PlanFrontMatterInput} */ ({
    classification: "PROJECT",
    complexity: "HIGH",
    summary: "s",
    affectedPaths: [],
    status: "approved",
});

/**
 * Write an approved PROJECT Epic that carries an execution policy it must not have.
 *
 * `savePlan` refuses to produce this state — `assertExecutionPolicyWriteAllowed`
 * rejects it — so the only way an Epic reaches load-plan carrying one is a
 * hand-edited Plan file, which is what the guard under test defends against.
 * Injecting a lifecycle writer hid that the state was unwritable at all.
 *
 * @param {string} planName
 * @param {string} policyLine
 */
async function makeEpicProjectWithHandEditedPolicy(planName, policyLine) {
    const { projectRoot, planPath } = await makePlanProject(planName, {
        classification: "PROJECT",
        complexity: "HIGH",
        summary: "s",
        affectedPaths: [],
        status: "approved",
    });
    const markdown = await Deno.readTextFile(planPath);
    const patched = markdown.replace(/^status: "approved"$/m, `status: "approved"\n${policyLine}`);
    if (patched === markdown) throw new Error(`Could not hand-edit the Front Matter of ${planPath}.`);
    await Deno.writeTextFile(planPath, patched);
    return { projectRoot };
}

Deno.test("runLoadPlanCommand non-approved plan kicks off planning agent", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("resume");
    let lifecycleCalled = false;

    await runLoadPlanCommand(["plan-b"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-b"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-b",
                    path: "plans/plan-b.md",
                    body: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "draft",
                    },
                }),
            runPlanningAgent: () => {
                lifecycleCalled = true;
                return Promise.resolve({ outcome: "saved", planName: "plan-b" });
            },
        }),
    });

    assertEquals(lifecycleCalled, true);
});

Deno.test("runLoadPlanCommand approved plan view then cancel", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("view", null);

    await runLoadPlanCommand(["plan-c"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-c"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-c",
                    path: "plans/plan-c.md",
                    body: "## Context\nThe quick brown fox.\n\n## Objective\nJump over.\n",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "approved",
                        worktreeBaseBranch: "feature-base",
                    },
                }),
        }),
    });

    assertEquals(messages.some((m) => m.includes("Target branch:  feature-base")), true);
    assertEquals(messages.some((m) => m.includes("The quick brown fox")), true);
    assertEquals(messages.some((m) => m.includes("Jump over")), true);
    assertEquals(messages.some((m) => m.includes("Load canceled")), false);
});

Deno.test("runLoadPlanCommand ready plan can go back to Planner for re-review", async () => {
    const { uiAPI, selections, prompts } = makeUi();
    selections.push("planner_re_review");
    const { projectRoot } = await makePlanProject("plan-ready-rereview", {
        ...APPROVED_FEATURE,
        status: "ready_for_work",
    });
    const fixture = makeRuntimeFixture({ cwd: projectRoot });
    /** @type {Array<Record<string, any>>} */
    const planningCalls = [];

    await runLoadPlanCommand(["plan-ready-rereview"], {
        ...fixture.context,
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-ready-rereview"] }),
            runPlanningAgent: (/** @type {Record<string, any>} */ args) => {
                planningCalls.push(args);
                return Promise.resolve({ outcome: "canceled" });
            },
        }),
    });

    assertEquals(prompts[0].options.slice(0, 3).map((option) => option.value), [
        "proceed",
        "planner_re_review",
        "review",
    ]);
    // The reopen is what puts the Plan back in front of the Planner, so the Plan on
    // disk carries it — the stand-in only recorded that it was asked to.
    assertEquals((await loadPlan(projectRoot, "plan-ready-rereview"))?.attrs.status, "feedback");
    assertEquals(planningCalls.length, 1);
    assertEquals(planningCalls[0].agentName, AGENTS.PLANNER);
    assertEquals(planningCalls[0].triageMeta.status, "feedback");
    assertEquals(
        String(planningCalls[0].initialRequest).includes("Plan Re-review Requested: plan-ready-rereview"),
        true,
    );
});

Deno.test("runLoadPlanCommand approved review uses the Runtime review interaction", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("review");
    let submitCalled = false;
    let executed = false;
    const { projectRoot } = await makePlanProject("plan-d", { ...APPROVED_FEATURE });
    const fixture = makeRuntimeFixture({
        cwd: projectRoot,
        requestInteraction: () => {
            submitCalled = true;
            return { outcome: "accepted", _meta: { approved: true } };
        },
    });

    await runLoadPlanCommand(["plan-d"], {
        ...fixture.context,
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-d"] }),
            executePlan: () => {
                executed = true;
                return Promise.resolve(undefined);
            },
        }),
    });

    assertEquals(submitCalled, true);
    assertEquals(executed, false);
    // Approval clears the Readiness Gate on disk even though nothing executed.
    assertEquals((await loadPlan(projectRoot, "plan-d"))?.attrs.status, "ready_for_work");
});

Deno.test("runLoadPlanCommand approved review run action executes without post-approval prompt", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("review");
    let executed = false;
    const { projectRoot } = await makePlanProject("plan-run-now", { ...APPROVED_FEATURE });
    const fixture = makeRuntimeFixture({
        cwd: projectRoot,
        requestInteraction: () => ({ outcome: "accepted", _meta: { approved: true, approvalAction: "run" } }),
    });

    await runLoadPlanCommand(["plan-run-now"], {
        ...fixture.context,
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-run-now"] }),
            executePlan: () => {
                executed = true;
                return Promise.resolve({ repairRequired: false, executionComplete: true });
            },
            loadPlan: () =>
                Promise.resolve({
                    markdown: "markdown",
                    body: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "implemented",
                        executionMode: "non_git_in_place",
                    },
                }),
            runValidationLoop: () => Promise.resolve({ ok: true }),
        }),
    });

    assertEquals(executed, true);
});

Deno.test("runLoadPlanCommand checkpoints completed execution before validation", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("review");
    const { projectRoot } = await makePlanProject("plan-run-checkpoint", { ...APPROVED_FEATURE });
    const fixture = makeRuntimeFixture({
        cwd: projectRoot,
        requestInteraction: () => ({ outcome: "accepted", _meta: { approved: true, approvalAction: "run" } }),
    });
    let finalized = false;
    let validated = false;
    /** @type {any[]} */
    const finalizeCalls = [];
    const cwd = projectRoot;

    await runLoadPlanCommand(["plan-run-checkpoint"], {
        ...fixture.context,
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-run-checkpoint"] }),
            loadPlan: () =>
                Promise.resolve({
                    planName: "plan-run-checkpoint",
                    path: "plans/plan-run-checkpoint.md",
                    body: "fresh body",
                    markdown: "fresh markdown",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: finalized ? "implemented" : "ready_for_work",
                        executionMode: "non_git_in_place",
                    },
                }),
            executePlan: () =>
                Promise.resolve({
                    repairRequired: false,
                    executionComplete: true,
                    completionReport: "- Done.",
                    executionContext: {
                        planName: "plan-run-checkpoint",
                        triageMeta: { classification: "FEATURE", status: "ready_for_work" },
                        executionAgent: "engineer",
                        executionMode: "non_git_in_place",
                        projectRoot: cwd,
                        executionCwd: cwd,
                        nonGitInPlace: true,
                    },
                }),
            finalizePlanImplementation: (/** @type {any} */ args) => {
                finalizeCalls.push(args);
                assertEquals(validated, false);
                assertEquals(args.planName, "plan-run-checkpoint");
                assertEquals(args.executionReport, "- Done.");
                assertEquals(args.triageMeta.status, "ready_for_work");
                finalized = true;
                return Promise.resolve({});
            },
            resolveValidationExecutionContext: (/** @type {any} */ args) => {
                assertEquals(finalized, true);
                assertEquals(args.triageMeta.status, "implemented");
                return Promise.resolve({
                    kind: "ok",
                    context: {
                        executionMode: "non_git_in_place",
                        planName: "plan-run-checkpoint",
                        projectRoot: cwd,
                        executionCwd: cwd,
                        source: "test",
                    },
                });
            },
            runValidationLoop: (/** @type {any} */ args) => {
                validated = true;
                assertEquals(finalized, true);
                assertEquals(args.triageMeta.status, "implemented");
                assertEquals(args.executionContext.nonGitInPlace, true);
                return Promise.resolve({ ok: true });
            },
        }),
    });

    assertEquals(finalizeCalls.length, 1);
    assertEquals(validated, true);
});

Deno.test("runLoadPlanCommand reapproval refreshes execution policy before readiness and execution", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("review");
    /** @type {any} */
    let executedTriageMeta = null;
    const { projectRoot } = await makePlanProject("plan-policy-refresh", {
        ...APPROVED_FEATURE,
        executionAgent: "engineer",
        collaborationRecommendation: "autonomous",
    });
    const refreshedPolicy = {
        classification: "FEATURE",
        complexity: "LOW",
        summary: "s",
        affectedPaths: [],
        status: "approved",
        executionAgent: "frontend-engineer",
        collaborationRecommendation: "pair",
    };
    const fixture = makeRuntimeFixture({
        cwd: projectRoot,
        // The real reviewer writes the approved policy to the Plan before returning
        // it, and the lifecycle write reads Front Matter back from disk under the
        // Plan lock. A reviewer that only returned the policy left the durable half
        // of this refresh untested.
        requestInteraction: async () => {
            const before = await loadPlan(projectRoot, "plan-policy-refresh");
            await updatePlanFrontMatter(
                projectRoot,
                "plan-policy-refresh",
                {
                    executionAgent: "frontend-engineer",
                    collaborationRecommendation: "pair",
                },
                {},
                { expectedRevision: before?.revision },
            );
            return {
                outcome: "accepted",
                _meta: { approved: true, approvalAction: "run", planAttrs: refreshedPolicy },
            };
        },
    });

    await runLoadPlanCommand(["plan-policy-refresh"], {
        ...fixture.context,
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-policy-refresh"] }),
            executePlan: (/** @type {any} */ options) => {
                executedTriageMeta = options.triageMeta;
                return Promise.resolve({ repairRequired: false, executionComplete: false });
            },
        }),
    });

    const refreshed = await loadPlan(projectRoot, "plan-policy-refresh");
    assertEquals(refreshed?.attrs.executionAgent, "frontend-engineer");
    assertEquals(refreshed?.attrs.collaborationRecommendation, "pair");
    assertEquals(executedTriageMeta.executionAgent, "frontend-engineer");
    assertEquals(executedTriageMeta.collaborationRecommendation, "pair");
});

Deno.test("runLoadPlanCommand reapproval refreshes edited Plan content before execution fallback validation", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("review");
    /** @type {string | null} */
    let validationPlanContent = null;
    const { projectRoot } = await makePlanProject("plan-content-refresh", {
        ...APPROVED_FEATURE,
        summary: "stale",
        executionAgent: "engineer",
        collaborationRecommendation: "autonomous",
    });
    const fixture = makeRuntimeFixture({
        cwd: projectRoot,
        requestInteraction: () => ({
            outcome: "accepted",
            _meta: {
                approved: true,
                approvalAction: "run",
                planAttrs: {
                    classification: "FEATURE",
                    complexity: "LOW",
                    summary: "updated",
                    affectedPaths: [],
                    status: "approved",
                    executionAgent: "frontend-engineer",
                    collaborationRecommendation: "pair",
                },
            },
        }),
    });

    await runLoadPlanCommand(["plan-content-refresh"], {
        ...fixture.context,
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-content-refresh"] }),
            executePlan: async () => {
                const current = await loadPlan(projectRoot, "plan-content-refresh");
                if (!current) throw new Error("fixture Plan disappeared before execution completed");
                await savePlan(projectRoot, "plan-content-refresh", "updated markdown", current.attrs, {
                    expectedRevision: current.revision,
                });
                return {
                    repairRequired: false,
                    executionComplete: true,
                    executionContext: {
                        planName: "plan-content-refresh",
                        executionMode: "non_git_in_place",
                        executionCwd: projectRoot,
                        nonGitInPlace: true,
                    },
                };
            },
            runValidationLoop: (/** @type {any} */ options) => {
                validationPlanContent = options.planContent;
                return Promise.resolve({ ok: true });
            },
        }),
    });

    const canonicalPlan = await loadPlan(projectRoot, "plan-content-refresh");
    assertEquals(validationPlanContent, canonicalPlan?.markdown);
    assertEquals(canonicalPlan?.body, "updated markdown");
});

Deno.test("runLoadPlanCommand reapproval abandons the prior worktree generation", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("review");
    // The registry write is real now, so this needs a project of its own — the old
    // assertion recorded `projectRoot: Deno.cwd()`, which is to say the abandonment
    // would have been written into the developer's own checkout.
    const projectRoot = await Deno.realPath(await Deno.makeTempDir({ prefix: "runwield-reapproval-project-" }));
    await addRegistryEntry(
        projectRoot,
        /** @type {any} */ ({
            id: "old-worktree",
            planName: "plan-reapproval",
            planId: "plan-reapproval-id",
            baseBranch: "main",
            baseRef: "HEAD",
            baseCommit: "recorded",
            baseTree: "recorded-tree",
            branch: "runwield/worktree/plan-reapproval",
            path: `${projectRoot}/old-worktree`,
            status: "active",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
        }),
    );
    // Detaching the Plan from its execution generation belongs to the reviewer's
    // decision transaction, which commits the Plan write and the registry
    // abandonment together — see plan-review.test.ts. load-plan used to reopen a
    // second time here, with the status it captured before the review, which
    // clobbered the reviewer's decision. What it owes now is to leave both alone.
    await savePlan(projectRoot, "plan-reapproval", "# reapproval", {
        classification: "FEATURE",
        complexity: "LOW",
        summary: "s",
        affectedPaths: [],
        status: "ready_for_work",
        planId: "plan-reapproval-id",
        worktreeId: "old-worktree",
        worktreeStatus: "completed",
    });
    /** @type {any} */
    let reviewMeta = null;
    // This fixture stands in for the reviewer, so no decision transaction runs and
    // nothing should be detached. Any change here is load-plan reopening on its own.
    const fixture = makeRuntimeFixture({
        cwd: projectRoot,
        requestInteraction: (request) => {
            reviewMeta = request._meta?.triageMeta;
            return { outcome: "accepted", _meta: { approved: false, feedback: "needs another pass" } };
        },
    });

    await runLoadPlanCommand(["plan-reapproval"], {
        ...fixture.context,
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-reapproval"] }),
            findWorktreeById: () =>
                Promise.resolve({
                    id: "old-worktree",
                    planName: "plan-reapproval",
                    path: "/tmp/old-worktree",
                    branch: "runwield/worktree/plan-reapproval-old",
                    baseBranch: "main",
                    status: "completed",
                }),
            findWorktreeByPlanName: () =>
                Promise.resolve({
                    id: "old-worktree",
                    planName: "plan-reapproval",
                    path: "/tmp/old-worktree",
                    branch: "runwield/worktree/plan-reapproval-old",
                    baseBranch: "main",
                    status: "completed",
                }),
        }),
    });

    assertEquals((await findRegistryEntryById(projectRoot, "old-worktree"))?.status, "active");
    const afterReview = await loadPlan(projectRoot, "plan-reapproval");
    assertEquals(afterReview?.attrs.status, "ready_for_work");
    assertEquals(afterReview?.attrs.worktreeId, "old-worktree");
    assertEquals(reviewMeta.worktreeStatus, "completed");
    assertEquals(reviewMeta.worktreeBaseBranch, undefined);
});

Deno.test("runLoadPlanCommand review reopen blocks unmanaged physical worktree metadata", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("review");
    const { projectRoot } = await makePlanProject("plan-unmanaged-worktree", {
        ...APPROVED_FEATURE,
        status: "ready_for_work",
        worktreePath: "/tmp/unmanaged-worktree",
        worktreeBranch: "runwield/worktree/unmanaged",
        worktreeStatus: "completed",
    });
    const fixture = makeRuntimeFixture({
        cwd: projectRoot,
        requestInteraction: () => ({ outcome: "accepted", _meta: { approved: true } }),
    });

    await assertRejects(
        () =>
            runLoadPlanCommand(["plan-unmanaged-worktree"], {
                ...fixture.context,
                uiAPI,
                editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
                __testDeps: /** @type {any} */ ({
                    parseArgs: () => ({ help: false, _: ["plan-unmanaged-worktree"] }),
                    findWorktreeById: () => Promise.resolve(null),
                    findWorktreeByPlanName: () => Promise.resolve(null),
                }),
            }),
        Error,
        "lacks a registry id",
    );

    // Refusing means refusing to write: the Plan is untouched, not merely that a
    // stand-in went uncalled.
    assertEquals((await loadPlan(projectRoot, "plan-unmanaged-worktree"))?.attrs.status, "ready_for_work");
});

Deno.test("runLoadPlanCommand approved PROJECT Epic opens Slicer without executing", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("slicer");
    let slicerOpened = false;
    /** @type {import("./load-plan-test-helpers.js").SlicerRunArgs[]} */
    const slicerCalls = [];
    let executed = false;
    const { projectRoot } = await makePlanProject("epic-review", {
        classification: "PROJECT",
        complexity: "HIGH",
        summary: "s",
        affectedPaths: [],
        status: "approved",
    });

    await runLoadPlanCommand(["epic-review"], {
        ...makeRuntimeContext({ cwd: projectRoot }),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["epic-review"] }),
            findPlansByParent: () => Promise.resolve([]),
            runSlicerAgent: (/** @type {import("./load-plan-test-helpers.js").SlicerRunArgs} */ args) => {
                slicerOpened = true;
                slicerCalls.push(args);
                return Promise.resolve({ ok: true });
            },
            submitPlanForReview: () => Promise.resolve({ approved: true }),
            executePlan: () => {
                executed = true;
                return Promise.resolve({ repairRequired: false, executionComplete: true });
            },
        }),
    });

    assertEquals(slicerOpened, true);
    assertEquals(slicerCalls[0].planName, "epic-review");
    assertEquals(slicerCalls[0].triageMeta.status, "ready_for_decomposition");
    assertEquals(executed, false);
    // The Epic really cleared its readiness gate before the Slicer was handed it.
    assertEquals((await loadPlan(projectRoot, "epic-review"))?.attrs.status, "ready_for_decomposition");
    assertEquals(messages.some((message) => message.includes("not executable")), true);
});

Deno.test("runLoadPlanCommand approved PROJECT Epic rejects execution policy before readiness", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("slicer");
    let slicerOpened = false;
    const { projectRoot } = await makeEpicProjectWithHandEditedPolicy(
        "epic-invalid-policy",
        'executionAgent: "frontend-engineer"',
    );

    await runLoadPlanCommand(["epic-invalid-policy"], {
        ...makeRuntimeContext({ cwd: projectRoot }),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["epic-invalid-policy"] }),
            findPlansByParent: () => Promise.resolve([]),
            runSlicerAgent: () => {
                slicerOpened = true;
                return Promise.resolve({ ok: true });
            },
        }),
    });

    assertEquals(slicerOpened, false);
    // Rejecting the policy leaves the Epic where it was, gate uncleared.
    assertEquals((await loadPlan(projectRoot, "epic-invalid-policy"))?.attrs.status, "approved");
    assertEquals(messages.some((message) => message.includes("PROJECT Epics are non-executable")), true);
});

Deno.test("runLoadPlanCommand post-review PROJECT Epic rejects execution policy before readiness", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("review");
    const { projectRoot } = await makeEpicProjectWithHandEditedPolicy(
        "epic-review-invalid-policy",
        'collaborationRecommendation: "pair"',
    );
    const fixture = makeRuntimeFixture({
        cwd: projectRoot,
        requestInteraction: () => ({ outcome: "accepted", _meta: { approved: true } }),
    });
    let slicerOpened = false;

    await runLoadPlanCommand(["epic-review-invalid-policy"], {
        ...fixture.context,
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["epic-review-invalid-policy"] }),
            askProjectDecompositionApproval: () => Promise.resolve("proceed"),
            runSlicerAgent: () => {
                slicerOpened = true;
                return Promise.resolve({ ok: true });
            },
        }),
    });

    assertEquals(slicerOpened, false);
    assertEquals((await loadPlan(projectRoot, "epic-review-invalid-policy"))?.attrs.status, "approved");
    assertEquals(messages.some((message) => message.includes("PROJECT Epics are non-executable")), true);
});

Deno.test("runLoadPlanCommand legacy in-progress PROJECT Epic opens Slicer instead of recovery", async () => {
    const { uiAPI, selections, prompts } = makeUi();
    selections.push("slicer");
    let slicerOpened = false;
    let executed = false;

    await runLoadPlanCommand(["epic-in-progress"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["epic-in-progress"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "epic-in-progress",
                    path: "plans/epic-in-progress.md",
                    body: "body",
                    markdown: "markdown",
                    attrs: {
                        classification: "PROJECT",
                        complexity: "HIGH",
                        summary: "s",
                        affectedPaths: [],
                        status: "in_progress",
                    },
                }),
            findPlansByParent: () => Promise.resolve([]),
            runSlicerAgent: () => {
                slicerOpened = true;
                return Promise.resolve({ ok: true });
            },
            executePlan: () => {
                executed = true;
                return Promise.resolve({ repairRequired: false, executionComplete: true });
            },
        }),
    });

    const epicPrompt = prompts.find((prompt) => prompt.prompt === "What would you like to do with this Epic?");
    assertEquals(epicPrompt?.options.map((option) => option.value), [
        "slicer",
        "user_verify",
        "hold",
        "view",
        "cancel",
    ]);
    assertEquals(slicerOpened, true);
    assertEquals(executed, false);
});

Deno.test("runLoadPlanCommand ready_for_decomposition PROJECT Epic does not execute", async () => {
    const { uiAPI, messages } = makeUi();
    let executed = false;

    await runLoadPlanCommand(["epic-ready"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["epic-ready"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "epic-ready",
                    path: "plans/epic-ready.md",
                    body: "body",
                    markdown: "markdown",
                    attrs: {
                        classification: "PROJECT",
                        complexity: "HIGH",
                        summary: "s",
                        affectedPaths: [],
                        status: "ready_for_decomposition",
                    },
                }),
            findPlansByParent: () => Promise.resolve([]),
            executePlan: () => {
                executed = true;
                return Promise.resolve({ repairRequired: false, executionComplete: true });
            },
        }),
    });

    assertEquals(executed, false);
    assertEquals(messages.some((message) => message.includes("no child plans")), true);
});

Deno.test("runLoadPlanCommand approved review proceed keeps plan owner without transient operator switch", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("review");
    const { projectRoot } = await makePlanProject("plan-project-review", { ...APPROVED_PROJECT });
    const fixture = makeRuntimeFixture({
        cwd: projectRoot,
        requestInteraction: () => ({ outcome: "accepted", _meta: { approved: true } }),
    });

    await runLoadPlanCommand(["plan-project-review"], {
        ...fixture.context,
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-project-review"] }),
            executePlan: () => Promise.resolve({ repairRequired: false, executionComplete: true }),
            runValidationLoop: () => Promise.resolve(),
        }),
    });

    assertEquals(fixture.state.agentHistory, [AGENTS.ARCHITECT]);
});

Deno.test("runLoadPlanCommand approved PROJECT review decompose action starts Slicer", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("review");
    let slicerCalled = false;
    const { projectRoot } = await makePlanProject("plan-project-decompose", { ...APPROVED_PROJECT });
    const fixture = makeRuntimeFixture({
        cwd: projectRoot,
        requestInteraction: () => ({ outcome: "accepted", _meta: { approved: true, approvalAction: "decompose" } }),
    });

    await runLoadPlanCommand(["plan-project-decompose"], {
        ...fixture.context,
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-project-decompose"] }),
            runSlicerAgent: () => {
                slicerCalled = true;
                return Promise.resolve({ ok: true });
            },
        }),
    });

    assertEquals(slicerCalled, true);
    assertEquals((await loadPlan(projectRoot, "plan-project-decompose"))?.attrs.status, "ready_for_decomposition");
});

Deno.test("runLoadPlanCommand approved review kicks off planner on denial", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("review");
    let plannerCalled = false;
    const fixture = makeRuntimeFixture({
        requestInteraction: () => ({
            outcome: "accepted",
            _meta: { approved: false, feedback: "missing tests" },
        }),
    });

    await runLoadPlanCommand(["plan-d2"], {
        ...fixture.context,
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-d2"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-d2",
                    path: "plans/plan-d2.md",
                    body: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "approved",
                    },
                }),
            runPlanningAgent: () => {
                plannerCalled = true;
                return Promise.resolve({ outcome: "saved", planName: "plan-d2" });
            },
        }),
    });

    assertEquals(plannerCalled, true);
});

Deno.test("runLoadPlanCommand planning approval forwards feedback images to execution", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("resume");
    const reviewImages = [{ base64: "planning-approved", mimeType: "image/png" }];
    /** @type {any} */
    let executeRequest = null;

    await runLoadPlanCommand(["plan-planning-approved"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-planning-approved"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-planning-approved",
                    path: "plans/plan-planning-approved.md",
                    body: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "draft",
                    },
                }),
            runPlanningAgent: () =>
                Promise.resolve({
                    outcome: "approved_execute",
                    planName: "plan-planning-approved",
                    triageMeta: { classification: "FEATURE", affectedPaths: [] },
                    feedback: "Carry these approved notes into execution.",
                    images: reviewImages,
                }),
            executePlan: (/** @type {any} */ request) => {
                executeRequest = request;
                return Promise.resolve({ repairRequired: false, executionComplete: false });
            },
        }),
    });

    assertEquals(executeRequest.reviewFeedback, "Carry these approved notes into execution.");
    assertEquals(executeRequest.reviewImages, reviewImages);
});

Deno.test("runLoadPlanCommand planning PROJECT approval forwards feedback images to Slicer", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("review");
    const reviewImages = [{ base64: "planning-project", mimeType: "image/png" }];
    /** @type {any} */
    let slicerRequest = null;

    await runLoadPlanCommand(["project-planning-approved"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["project-planning-approved"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "project-planning-approved",
                    path: "plans/project-planning-approved.md",
                    body: "body",
                    markdown: "markdown",
                    attrs: {
                        classification: "PROJECT",
                        complexity: "HIGH",
                        summary: "s",
                        affectedPaths: [],
                        status: "draft",
                    },
                }),
            runPlanningAgent: () =>
                Promise.resolve({
                    outcome: "approved_decompose",
                    planName: "project-planning-approved",
                    triageMeta: { classification: "PROJECT", affectedPaths: [] },
                    feedback: "Carry these approved notes into slicing.",
                    images: reviewImages,
                }),
            runSlicerAgent: (/** @type {any} */ request) => {
                slicerRequest = request;
                return Promise.resolve({ ok: true });
            },
        }),
    });

    assertEquals(slicerRequest.reviewFeedback, "Carry these approved notes into slicing.");
    assertEquals(slicerRequest.reviewImages, reviewImages);
});

Deno.test("runLoadPlanCommand ready review decline preserves pre-attempt status", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("review", "no");
    const { projectRoot } = await makePlanProject("ready-review-cancel", {
        ...APPROVED_FEATURE,
        status: "ready_for_work",
        worktreeId: "wt-1",
        worktreePath: "/tmp/ready-review-cancel",
        worktreeBranch: "runwield/worktree/ready-review-cancel",
        worktreeStatus: "active",
    });
    const fixture = makeRuntimeFixture({
        cwd: projectRoot,
        requestInteraction: () => ({
            outcome: "canceled",
            _meta: { canceled: true, feedback: "Cancelled by user (Esc)" },
        }),
    });
    fixture.state.workflow = { planName: "ready-review-cancel", worktreeId: "wt-1", ownerAgent: AGENTS.ENGINEER };
    const preReviewWorkflow = fixture.state.workflow;

    await runLoadPlanCommand(["ready-review-cancel"], {
        ...fixture.context,
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["ready-review-cancel"] }),
            findWorktreeById: () =>
                Promise.resolve({
                    id: "wt-1",
                    planName: "ready-review-cancel",
                    path: "/tmp/ready-review-cancel",
                    branch: "runwield/worktree/ready-review-cancel",
                    status: "active",
                }),
        }),
    });

    // "Preserves pre-attempt status" is a claim about the Plan, so the Plan answers
    // it: declining the review leaves both the status and the worktree attempt alone.
    const declined = await loadPlan(projectRoot, "ready-review-cancel");
    assertEquals(declined?.attrs.status, "ready_for_work");
    assertEquals(declined?.attrs.worktreeId, "wt-1");
    assertEquals(declined?.attrs.worktreeStatus, "active");
    assertEquals(fixture.state.workflow, preReviewWorkflow);
});

Deno.test("runLoadPlanCommand Esc-canceled review completes without retry prompt", async () => {
    const { uiAPI, selections, prompts, messages } = makeUi();
    selections.push("review");
    const { projectRoot } = await makePlanProject("review-runtime-cancel", { ...APPROVED_FEATURE });
    const fixture = makeRuntimeFixture({
        cwd: projectRoot,
        requestInteraction: () => ({ outcome: "canceled" }),
    });

    await runLoadPlanCommand(["review-runtime-cancel"], {
        ...fixture.context,
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["review-runtime-cancel"] }),
        }),
    });

    assertEquals(prompts.map((prompt) => prompt.prompt), ["What would you like to do?"]);
    assertEquals(messages.some((message) => message.includes("Plan review ended without an answer")), true);
    assertEquals(messages.some((message) => message.includes(SESSION_COMPLETE_GUIDANCE)), true);
});

Deno.test("runLoadPlanCommand approved review preserves remote review outcome", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("review");
    let planningCalled = false;
    const { projectRoot } = await makePlanProject("remote-review-plan", { ...APPROVED_FEATURE });
    const fixture = makeRuntimeFixture({
        cwd: projectRoot,
        requestInteraction: () => ({
            outcome: "accepted",
            message: "Plan saved for remote review.",
            _meta: { remoteReview: true, reviewerUrl: "https://review.example/plan", approved: false },
        }),
    });

    await runLoadPlanCommand(["remote-review-plan"], {
        ...fixture.context,
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["remote-review-plan"] }),
            runPlanningAgent: () => {
                planningCalled = true;
                return Promise.resolve({ outcome: "no_call" });
            },
        }),
    });

    assertEquals(planningCalled, false);
    assertEquals(messages.some((message) => message.includes("remote review")), true);
    assertEquals(messages.some((message) => message.includes(SESSION_COMPLETE_GUIDANCE)), false);
});

Deno.test("runLoadPlanCommand approved FEATURE review run forwards approval feedback images", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("review");
    const reviewImages = [{ base64: "approved", mimeType: "image/png" }];
    /** @type {any} */
    let executeRequest = null;
    const { projectRoot } = await makePlanProject("plan-run-with-images", { ...APPROVED_FEATURE });
    const fixture = makeRuntimeFixture({
        cwd: projectRoot,
        requestInteraction: () => ({
            outcome: "accepted",
            _meta: {
                approved: true,
                approvalAction: "run",
                feedback: "Use this screenshot during implementation.",
                images: reviewImages,
            },
        }),
    });

    await runLoadPlanCommand(["plan-run-with-images"], {
        ...fixture.context,
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-run-with-images"] }),
            executePlan: (/** @type {any} */ request) => {
                executeRequest = request;
                return Promise.resolve({ repairRequired: false, executionComplete: false });
            },
        }),
    });

    assertEquals(executeRequest.reviewFeedback, "Use this screenshot during implementation.");
    assertEquals(executeRequest.reviewImages, reviewImages);
});

Deno.test("runLoadPlanCommand approved FEATURE review later action shows session-complete guidance", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("review");
    let executed = false;
    const { projectRoot } = await makePlanProject("plan-save-later", { ...APPROVED_FEATURE });
    const fixture = makeRuntimeFixture({
        cwd: projectRoot,
        requestInteraction: () => ({ outcome: "accepted", _meta: { approved: true, approvalAction: "later" } }),
    });

    await runLoadPlanCommand(["plan-save-later"], {
        ...fixture.context,
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-save-later"] }),
            executePlan: () => {
                executed = true;
                return Promise.resolve({ repairRequired: false, executionComplete: true });
            },
        }),
    });

    assertEquals(executed, false);
    // Saving for later still clears the Readiness Gate, so resuming does not re-run it.
    assertEquals((await loadPlan(projectRoot, "plan-save-later"))?.attrs.status, "ready_for_work");
    assertEquals(messages.some((message) => message.includes("Plan saved. Resume later")), true);
    assertEquals(messages.some((message) => message.includes(SESSION_COMPLETE_GUIDANCE)), true);
});

Deno.test("runLoadPlanCommand approved PROJECT review decompose action starts Slicer with approval images", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("review");
    let slicerCalled = false;
    /** @type {any} */
    let slicerRequest = null;
    const reviewImages = [{ base64: "approved", mimeType: "image/png" }];
    const { projectRoot } = await makePlanProject("plan-project-decompose", { ...APPROVED_PROJECT });
    const fixture = makeRuntimeFixture({
        cwd: projectRoot,
        requestInteraction: () => ({
            outcome: "accepted",
            _meta: {
                approved: true,
                approvalAction: "decompose",
                feedback: "Use this screenshot while slicing.",
                images: reviewImages,
            },
        }),
    });

    await runLoadPlanCommand(["plan-project-decompose"], {
        ...fixture.context,
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-project-decompose"] }),
            runSlicerAgent: (/** @type {any} */ request) => {
                slicerCalled = true;
                slicerRequest = request;
                return Promise.resolve({ ok: true });
            },
        }),
    });

    assertEquals(slicerCalled, true);
    assertEquals(slicerRequest.reviewFeedback, "Use this screenshot while slicing.");
    assertEquals(slicerRequest.reviewImages, reviewImages);
});

Deno.test("runLoadPlanCommand approved PROJECT review later action shows session-complete guidance", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("review");
    let slicerCalled = false;
    const { projectRoot } = await makePlanProject("plan-project-save-later", { ...APPROVED_PROJECT });
    const fixture = makeRuntimeFixture({
        cwd: projectRoot,
        requestInteraction: () => ({ outcome: "accepted", _meta: { approved: true, approvalAction: "later" } }),
    });

    await runLoadPlanCommand(["plan-project-save-later"], {
        ...fixture.context,
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-project-save-later"] }),
            runSlicerAgent: () => {
                slicerCalled = true;
                return Promise.resolve({ ok: true });
            },
        }),
    });

    assertEquals(slicerCalled, false);
    assertEquals((await loadPlan(projectRoot, "plan-project-save-later"))?.attrs.status, "ready_for_decomposition");
    assertEquals(messages.some((message) => message.includes("Plan saved. Resume later")), true);
    assertEquals(messages.some((message) => message.includes(SESSION_COMPLETE_GUIDANCE)), true);
});

Deno.test("runLoadPlanCommand approved review kicks off planner on denial with images", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("review");
    let plannerCalled = false;
    /** @type {any[] | undefined} */
    let plannerImages;
    const reviewImages = [{ base64: "abc", mimeType: "image/png" }];
    const fixture = makeRuntimeFixture({
        requestInteraction: () => ({
            outcome: "accepted",
            _meta: { approved: false, feedback: "missing tests", images: reviewImages },
        }),
    });

    await runLoadPlanCommand(["plan-d2"], {
        ...fixture.context,
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-d2"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-d2",
                    path: "plans/plan-d2.md",
                    body: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "approved",
                    },
                }),
            runPlanningAgent: (/** @type {any} */ request) => {
                plannerCalled = true;
                plannerImages = request.images;
                return Promise.resolve({ outcome: "saved", planName: "plan-d2" });
            },
        }),
    });

    assertEquals(plannerCalled, true);
    assertEquals(plannerImages, reviewImages);
});

Deno.test("runLoadPlanCommand approved PROJECT review feedback returns images to Architect", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("review");
    /** @type {any} */
    let plannerRequest = null;
    const reviewImages = [{ base64: "project-feedback", mimeType: "image/png" }];
    const { projectRoot } = await makePlanProject("project-feedback-images", { ...APPROVED_PROJECT });
    const fixture = makeRuntimeFixture({
        cwd: projectRoot,
        requestInteraction: () => ({
            outcome: "accepted",
            _meta: { approved: false, feedback: "Revise the Epic.", images: reviewImages },
        }),
    });

    await runLoadPlanCommand(["project-feedback-images"], {
        ...fixture.context,
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["project-feedback-images"] }),
            runPlanningAgent: (/** @type {any} */ request) => {
                plannerRequest = request;
                return Promise.resolve({ outcome: "saved", planName: "project-feedback-images" });
            },
        }),
    });

    assertEquals(plannerRequest.agentName, AGENTS.ARCHITECT);
    assertEquals(plannerRequest.images, reviewImages);
});
