import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import {
    beginSlicerContextPhase,
    buildSlicerRequest,
    createSlicerFinalizeTool,
    executePlan,
    extractAssistantOutput,
    finalizePlanImplementation,
    materializeSlicerDraft,
    openSlicerDecomposition,
    readLatestPlanOutcome,
    runSlicerAgent,
    startActiveExecutionWorkflow,
} from "./workflow.js";
import { HostedSession } from "../session/hosted-session.js";
import { runActiveAgentTurn } from "../session/agent-switching.js";
import { SessionManager } from "@earendil-works/pi-coding-agent";

/** @param {string} [id] */
function makeHostedSession(id = "workflow-test") {
    return new HostedSession({ id, cwd: Deno.cwd(), sessionManager: null });
}

Deno.test("HostedSession scopes active execution workflow independently", () => {
    const sessionA = new HostedSession({ id: "workflow-a", cwd: "/project-a" });
    const sessionB = new HostedSession({ id: "workflow-b", cwd: "/project-b" });
    const workflowA = /** @type {const} */ ({
        planName: "a",
        triageMeta: {},
        executionAgent: "engineer",
        executionCwd: "/work/a",
    });
    const workflowB = /** @type {const} */ ({
        planName: "b",
        triageMeta: {},
        executionAgent: "engineer",
        executionCwd: "/work/b",
    });

    sessionA.setActiveExecutionWorkflow(workflowA);
    sessionB.setActiveExecutionWorkflow(workflowB);
    sessionA.clearActiveExecutionWorkflow();

    assertEquals(sessionA.getActiveExecutionWorkflow(), null);
    assertEquals(sessionA.getActiveExecutionCwd(), "/project-a");
    assertEquals(sessionB.getActiveExecutionWorkflow(), workflowB);
    assertEquals(sessionB.getActiveExecutionCwd(), "/work/b");
});

Deno.test("startActiveExecutionWorkflow prepares targeted branch creation args", async () => {
    const hostedSession = makeHostedSession("targeted-workflow");
    /** @type {unknown[]} */
    const createCalls = [];
    /** @type {unknown[]} */
    const prepareCalls = [];
    const result = await startActiveExecutionWorkflow({
        planName: "targeted-plan",
        triageMeta: { worktreeBaseBranch: " feature-base " },
        currentStatus: "ready_for_work",
        hostedSession,
        __deps: {
            findReusableWorktree: () => Promise.resolve(null),
            prepareTargetBranchRef: (projectRoot, branch) => {
                prepareCalls.push({ projectRoot, branch });
                return Promise.resolve({ baseRef: "refs/heads/feature-base", baseBranch: "feature-base" });
            },
            createExecutionWorktree: (opts) => {
                createCalls.push(opts);
                return Promise.resolve(
                    /** @type {any} */ ({
                        id: "wt1",
                        path: "/tmp/wt1",
                        branch: "runwield/worktree/targeted-plan-wt1",
                        baseBranch: "feature-base",
                    }),
                );
            },
            captureWorktreeTree: () => Promise.resolve("tree1"),
            updateWorktreeRegistryEntry: () => Promise.resolve(null),
            recordPlanEvent: () => Promise.resolve(/** @type {any} */ ({})),
        },
    });

    assertEquals(prepareCalls.length, 1);
    assertEquals(/** @type {{ branch: string }} */ (prepareCalls[0]).branch, "feature-base");
    assertEquals(
        /** @type {{ baseRef: string, baseBranch: string }} */ (createCalls[0]).baseRef,
        "refs/heads/feature-base",
    );
    assertEquals(/** @type {{ baseRef: string, baseBranch: string }} */ (createCalls[0]).baseBranch, "feature-base");
    assertEquals(result.worktreeBaseBranch, "feature-base");
});

Deno.test("startActiveExecutionWorkflow keeps HEAD fallback for untargeted plans", async () => {
    const hostedSession = makeHostedSession("untargeted-workflow");
    /** @type {unknown[]} */
    const createCalls = [];
    let prepareCalls = 0;
    let reuseLookups = 0;
    await startActiveExecutionWorkflow({
        planName: "untargeted-plan",
        triageMeta: { worktreeStatus: "completed" },
        currentStatus: "ready_for_work",
        hostedSession,
        __deps: {
            findReusableWorktree: () => {
                reuseLookups++;
                return Promise.reject(new Error("fresh execution must not reuse by plan name"));
            },
            prepareTargetBranchRef: () => {
                prepareCalls++;
                return Promise.resolve({ baseRef: "refs/heads/nope", baseBranch: "nope" });
            },
            createExecutionWorktree: (opts) => {
                createCalls.push(opts);
                return Promise.resolve(
                    /** @type {any} */ ({
                        id: "wt2",
                        path: "/tmp/wt2",
                        branch: "runwield/worktree/untargeted-plan-wt2",
                        baseBranch: "HEAD",
                    }),
                );
            },
            captureWorktreeTree: () => Promise.resolve("tree2"),
            updateWorktreeRegistryEntry: () => Promise.resolve(null),
            recordPlanEvent: () => Promise.resolve(/** @type {any} */ ({})),
        },
    });

    assertEquals(prepareCalls, 0);
    assertEquals(reuseLookups, 0);
    assertEquals(/** @type {{ baseRef: string, baseBranch?: string }} */ (createCalls[0]).baseRef, "HEAD");
    assertEquals(/** @type {{ baseRef: string, baseBranch?: string }} */ (createCalls[0]).baseBranch, undefined);
});

Deno.test("startActiveExecutionWorkflow resolves implicit current branch before reusing a recorded worktree", async () => {
    const hostedSession = makeHostedSession("implicit-target-reuse-workflow");
    /** @type {unknown[]} */
    const reuseCalls = [];
    /** @type {unknown[]} */
    const registryUpdates = [];
    let createCalls = 0;
    const result = await startActiveExecutionWorkflow({
        planName: "untargeted-plan",
        triageMeta: { worktreeId: "wt-main" },
        currentStatus: "ready_for_work",
        hostedSession,
        __deps: {
            findReusableWorktree: (opts) => {
                reuseCalls.push(opts);
                return Promise.resolve(
                    /** @type {any} */ ({
                        id: "wt-main",
                        path: "/tmp/wt-main",
                        branch: "runwield/worktree/untargeted-plan-wt-main",
                        baseBranch: "main",
                    }),
                );
            },
            resolveCurrentCheckoutBranch: () => Promise.resolve("main"),
            createExecutionWorktree: () => {
                createCalls++;
                return Promise.reject(new Error("should reuse recorded worktree"));
            },
            captureWorktreeTree: () => Promise.resolve("tree-main"),
            updateWorktreeRegistryEntry: (projectRoot, id, updates) => {
                registryUpdates.push({ projectRoot, id, updates });
                return Promise.resolve(null);
            },
            recordPlanEvent: () => Promise.resolve(/** @type {any} */ ({})),
        },
    });

    assertEquals(reuseCalls, [{ projectRoot: Deno.cwd(), planName: "untargeted-plan", worktreeId: "wt-main" }]);
    assertEquals(createCalls, 0);
    assertEquals(result.worktreeBaseBranch, "main");
    assertEquals(registryUpdates, [{
        projectRoot: Deno.cwd(),
        id: "wt-main",
        updates: { status: "active", executionBaselineTree: "tree-main" },
    }]);
});

Deno.test("startActiveExecutionWorkflow rejects reusable worktree target mismatches", async () => {
    const hostedSession = makeHostedSession("mismatched-workflow");
    let prepareCalls = 0;
    await assertRejects(
        () =>
            startActiveExecutionWorkflow({
                planName: "targeted-plan",
                triageMeta: { worktreeId: "wt3", worktreeBaseBranch: "feature-base" },
                currentStatus: "ready_for_work",
                hostedSession,
                __deps: {
                    findReusableWorktree: () =>
                        Promise.resolve(
                            /** @type {any} */ ({
                                id: "wt3",
                                path: "/tmp/wt3",
                                branch: "runwield/worktree/targeted-plan-wt3",
                                baseBranch: "other-base",
                            }),
                        ),
                    prepareTargetBranchRef: () => {
                        prepareCalls++;
                        return Promise.resolve({ baseRef: "refs/heads/feature-base", baseBranch: "feature-base" });
                    },
                    createExecutionWorktree: () => Promise.reject(new Error("should not create")),
                    captureWorktreeTree: () => Promise.resolve("tree3"),
                    updateWorktreeRegistryEntry: () => Promise.resolve(null),
                    recordPlanEvent: () => Promise.resolve(/** @type {any} */ ({})),
                },
            }),
        Error,
        "Existing execution worktree targets other-base, but plan targets feature-base",
    );
    assertEquals(prepareCalls, 0);
});

Deno.test("startActiveExecutionWorkflow matches explicit remote target to recorded local reusable target", async () => {
    const hostedSession = makeHostedSession("remote-reusable-workflow");
    let createCalls = 0;
    let prepareCalls = 0;
    const result = await startActiveExecutionWorkflow({
        planName: "targeted-plan",
        triageMeta: { worktreeId: "wt4", worktreeBaseBranch: "origin/feature-base" },
        currentStatus: "ready_for_work",
        hostedSession,
        __deps: {
            findReusableWorktree: () =>
                Promise.resolve(
                    /** @type {any} */ ({
                        id: "wt4",
                        path: "/tmp/wt4",
                        branch: "runwield/worktree/targeted-plan-wt4",
                        baseBranch: "feature-base",
                    }),
                ),
            resolveTargetBranchName: () => Promise.resolve("feature-base"),
            prepareTargetBranchRef: () => {
                prepareCalls++;
                return Promise.resolve({ baseRef: "refs/heads/feature-base", baseBranch: "feature-base" });
            },
            createExecutionWorktree: () => {
                createCalls++;
                return Promise.reject(new Error("should not create"));
            },
            captureWorktreeTree: () => Promise.resolve("tree4"),
            updateWorktreeRegistryEntry: () => Promise.resolve(null),
            recordPlanEvent: () => Promise.resolve(/** @type {any} */ ({})),
        },
    });

    assertEquals(createCalls, 0);
    assertEquals(prepareCalls, 0);
    assertEquals(result.worktreeBaseBranch, "feature-base");
});

Deno.test("startActiveExecutionWorkflow does not let plan target overwrite unknown active worktree target", async () => {
    const hostedSession = makeHostedSession("unknown-active-target-workflow");
    hostedSession.setActiveExecutionWorkflow({
        planName: "targeted-plan",
        triageMeta: {},
        executionAgent: "engineer",
        baselineTree: "tree4",
        projectRoot: "/repo",
        executionCwd: "/tmp/wt4",
        worktreeId: "wt4",
        worktreeBranch: "runwield/worktree/targeted-plan-wt4",
    });
    let prepareCalls = 0;

    await assertRejects(
        () =>
            startActiveExecutionWorkflow({
                planName: "targeted-plan",
                triageMeta: { worktreeBaseBranch: "feature-base" },
                currentStatus: "ready_for_work",
                hostedSession,
                __deps: {
                    findReusableWorktree: () => Promise.reject(new Error("should use active workflow")),
                    prepareTargetBranchRef: () => {
                        prepareCalls++;
                        return Promise.resolve({ baseRef: "refs/heads/feature-base", baseBranch: "feature-base" });
                    },
                    createExecutionWorktree: () => Promise.reject(new Error("should not create")),
                    captureWorktreeTree: () => Promise.resolve("tree4"),
                    updateWorktreeRegistryEntry: () => Promise.resolve(null),
                    recordPlanEvent: () => Promise.resolve(/** @type {any} */ ({})),
                },
            }),
        Error,
        "Existing execution worktree targets HEAD/current checkout, but plan targets feature-base",
    );
    assertEquals(prepareCalls, 0);
});

Deno.test("startActiveExecutionWorkflow prompts once and uses CWD for non-Git in-place execution", async () => {
    const hostedSession = makeHostedSession("non-git-feature-workflow");
    /** @type {string[]} */
    const prompts = [];
    /** @type {any[]} */
    const events = [];
    const result = await startActiveExecutionWorkflow({
        planName: "non-git-plan",
        triageMeta: { classification: "FEATURE" },
        currentStatus: "ready_for_work",
        hostedSession,
        __deps: {
            probeGitRepository: () => Promise.resolve({ ok: false, state: "not_git", cwd: Deno.cwd() }),
            hasNonGitExecutionConsent: () => false,
            confirmNonGitFeaturePlanExecution: (_session, projectRoot) => {
                const prompt = `non git prompt:${projectRoot}`;
                prompts.push(prompt);
                return Promise.resolve(true);
            },
            findReusableWorktree: () => Promise.reject(new Error("should not inspect worktrees")),
            createExecutionWorktree: () => Promise.reject(new Error("should not create worktree")),
            captureWorktreeTree: () => Promise.reject(new Error("should not capture git tree")),
            updateWorktreeRegistryEntry: () => Promise.resolve(null),
            recordPlanEvent: (event) => {
                events.push(event);
                return Promise.resolve(/** @type {any} */ ({}));
            },
        },
    });

    assertEquals(prompts, [`non git prompt:${Deno.cwd()}`]);
    assertEquals(result.executionCwd, Deno.cwd());
    assertEquals(result.nonGitInPlace, true);
    assertEquals(result.worktreeId, undefined);
    assertEquals(hostedSession.getActiveExecutionWorkflow()?.nonGitInPlace, true);
    assertEquals(hostedSession.getActiveExecutionWorkflow()?.executionStarted, true);
    assertEquals(/** @type {any} */ (events[0]).details.nonGitInPlace, true);
});

Deno.test("startActiveExecutionWorkflow cancels non-Git execution without consent", async () => {
    const hostedSession = makeHostedSession("non-git-feature-cancel-workflow");
    await assertRejects(
        () =>
            startActiveExecutionWorkflow({
                planName: "non-git-plan",
                triageMeta: { classification: "FEATURE" },
                currentStatus: "ready_for_work",
                hostedSession,
                __deps: {
                    probeGitRepository: () => Promise.resolve({ ok: false, state: "not_git", cwd: Deno.cwd() }),
                    hasNonGitExecutionConsent: () => false,
                    confirmNonGitFeaturePlanExecution: () => Promise.resolve(false),
                    recordPlanEvent: () => Promise.reject(new Error("should not record execution_started")),
                },
            }),
        Error,
        "in-place execution was not approved",
    );
    assertEquals(hostedSession.getActiveExecutionWorkflow(), {
        planName: "non-git-plan",
        triageMeta: { classification: "FEATURE" },
        executionAgent: "engineer",
        executionStarted: false,
        collaborationStyle: "autonomous",
        collaborationRecommendation: "autonomous",
        pairCheckpointCount: 0,
        projectRoot: Deno.cwd(),
        executionCwd: Deno.cwd(),
    });
});

Deno.test("startActiveExecutionWorkflow stores Frontend Engineer owner before non-Git consent failure", async () => {
    const hostedSession = makeHostedSession("frontend-non-git-cancel-workflow");
    await assertRejects(
        () =>
            startActiveExecutionWorkflow({
                planName: "visual-plan",
                triageMeta: { classification: "FEATURE", executionAgent: "frontend-engineer" },
                currentStatus: "ready_for_work",
                hostedSession,
                __deps: {
                    probeGitRepository: () => Promise.resolve({ ok: false, state: "not_git", cwd: Deno.cwd() }),
                    hasNonGitExecutionConsent: () => false,
                    confirmNonGitFeaturePlanExecution: () => Promise.resolve(false),
                    recordPlanEvent: () => Promise.reject(new Error("should not record execution_started")),
                },
            }),
        Error,
        "in-place execution was not approved",
    );

    assertEquals(hostedSession.getActiveExecutionWorkflow()?.executionAgent, "frontend-engineer");
    assertEquals(hostedSession.getActiveExecutionWorkflow()?.executionStarted, false);
});

Deno.test("readLatestPlanOutcome returns the latest plan_written outcome", () => {
    const messages = [
        /** @type {any} */ ({
            role: "toolResult",
            toolName: "plan_written",
            details: { planName: "first", outcome: "feedback" },
        }),
        /** @type {any} */ ({
            role: "toolResult",
            toolName: "plan_written",
            content: [
                { type: "text", text: "approved" },
                { type: "image", data: "YXBwcm92ZWQ=", mimeType: "image/png" },
            ],
            details: {
                planName: "first",
                outcome: "approved_execute",
                triageMeta: { classification: "FEATURE" },
                feedback: "Keep the selected command.",
            },
        }),
    ];
    assertEquals(readLatestPlanOutcome(messages), {
        outcome: "approved_execute",
        planName: "first",
        triageMeta: { classification: "FEATURE" },
        feedback: "Keep the selected command.",
        images: [{ base64: "YXBwcm92ZWQ=", mimeType: "image/png" }],
    });
});

Deno.test("readLatestPlanOutcome returns null when no plan_written tool result is present", () => {
    assertEquals(readLatestPlanOutcome([]), null);
});

Deno.test("extractAssistantOutput falls back to task_completed message details", () => {
    const messages = [
        /** @type {any} */ ({
            role: "assistant",
            content: [{
                type: "tool_use",
                name: "task_completed",
                input: { message: "Implemented isolated worktree setup." },
            }],
        }),
        /** @type {any} */ ({
            role: "toolResult",
            toolName: "task_completed",
            details: {
                outcome: "task_completed",
                message: "Implemented isolated worktree setup.",
            },
        }),
    ];

    assertEquals(extractAssistantOutput(messages), "Implemented isolated worktree setup.");
});

Deno.test("extractAssistantOutput handles legacy assistant text shapes", () => {
    assertEquals(
        extractAssistantOutput([
            /** @type {any} */ ({ role: "assistant", content: "Plain legacy summary." }),
        ]),
        "Plain legacy summary.",
    );
    assertEquals(
        extractAssistantOutput([
            /** @type {any} */ ({ role: "assistant", content: [{ contentText: "Content text summary." }] }),
        ]),
        "Content text summary.",
    );
});

Deno.test("executePlan refuses to execute PROJECT Epic containers", async () => {
    /** @type {string[]} */
    const messages = [];
    const hostedSession = makeHostedSession("epic-execution");
    hostedSession.setEventSink((/** @type {{ message?: string }} */ event) => {
        if (event.message) messages.push(event.message);
    });
    let engineerCalled = false;
    const result = await executePlan({
        planName: "epic-plan",
        triageMeta: { classification: "PROJECT" },
        hostedSession,
        __deps: {
            loadPlan: () =>
                Promise.resolve(
                    /** @type {any} */ ({
                        attrs: { status: "ready_for_work", classification: "PROJECT" },
                        body: "## Epic",
                        markdown: "## Epic",
                    }),
                ),
            executeSingleEngineerPlan: () => {
                engineerCalled = true;
                return Promise.resolve({ repairRequired: false, executionComplete: true });
            },
        },
    });

    assertEquals(result.executionComplete, false);
    assertEquals(engineerCalled, false);
    assertStringIncludes(result.error || "", "PROJECT Epic container");
    assertEquals(messages.some((message) => message.includes("cannot be executed directly")), true);
});

Deno.test("executePlan refuses persisted Epic containers even when triage meta overrides classification", async () => {
    let engineerCalled = false;
    const result = await executePlan({
        planName: "epic-plan",
        triageMeta: { classification: "FEATURE" },
        hostedSession: makeHostedSession("persisted-epic-execution"),
        __deps: {
            loadPlan: () =>
                Promise.resolve(
                    /** @type {any} */ ({
                        attrs: { status: "ready_for_work", classification: "PROJECT" },
                        body: "## Epic",
                        markdown: "## Epic",
                    }),
                ),
            executeSingleEngineerPlan: () => {
                engineerCalled = true;
                return Promise.resolve({ repairRequired: false, executionComplete: true });
            },
        },
    });

    assertEquals(result.executionComplete, false);
    assertEquals(engineerCalled, false);
    assertStringIncludes(result.error || "", "PROJECT Epic container");
});

Deno.test("finalizePlanImplementation checkpoints worktree changes before lifecycle completion", async () => {
    /** @type {string[]} */
    const order = [];
    const executionContext = /** @type {const} */ ({
        planName: "feature-plan",
        triageMeta: { classification: "FEATURE" },
        executionAgent: "engineer",
        executionMode: "worktree",
        projectRoot: "/project",
        executionCwd: "/worktree",
        baselineTree: "attempt-tree",
        worktreeId: "wt-1",
        worktreeBranch: "runwield/worktree/feature-plan",
    });

    const result = await finalizePlanImplementation({
        projectRoot: "/project",
        planName: "feature-plan",
        triageMeta: { classification: "FEATURE", summary: "Preserve completed implementation work." },
        executionContext,
        executionReport: "- Implemented.",
        __deps: {
            checkpointExecutionWorktree: (options) => {
                order.push(`checkpoint:${options.worktreePath}:${options.branch}`);
                return Promise.resolve({ executionCommit: "a".repeat(40) });
            },
            recordPlanEvent: (event) => {
                order.push(`event:${event.event}`);
                assertEquals(/** @type {any} */ (event.details).executionReport, "- Implemented.");
                assertEquals(/** @type {any} */ (event.details).executionBaselineTree, "attempt-tree");
                assertEquals(/** @type {any} */ (event.details).worktreeId, "wt-1");
                return Promise.resolve(/** @type {any} */ ({}));
            },
            markActiveWorktreeStatus: (status, /** @type {any} */ options) => {
                order.push(`registry:${status}:${options.workflow?.worktreeId}`);
                return Promise.resolve();
            },
            recordWorkflowMetric: (/** @type {any} */ metric) => {
                order.push(`metric:${metric.event}:${metric.details.checkpointCommitted}`);
                return Promise.resolve(null);
            },
        },
    });

    assertEquals(result, { implementationCommit: "a".repeat(40) });
    assertEquals(order, [
        "checkpoint:/worktree:runwield/worktree/feature-plan",
        "event:implementation_finished",
        "registry:completed:wt-1",
        "metric:implementation_finished:true",
    ]);
});

Deno.test("finalizePlanImplementation fails closed without durable execution context", async () => {
    let lifecycleMutated = false;
    await assertRejects(
        () =>
            finalizePlanImplementation({
                projectRoot: "/project",
                planName: "feature-plan",
                triageMeta: { classification: "FEATURE" },
                executionContext: null,
                __deps: {
                    recordPlanEvent: () => {
                        lifecycleMutated = true;
                        return Promise.resolve(/** @type {any} */ ({}));
                    },
                },
            }),
        Error,
        "durable execution context is missing",
    );
    assertEquals(lifecycleMutated, false);
});

Deno.test("executePlan does not mark implementation complete when checkpointing fails", async () => {
    let lifecycleMutated = false;
    const executionContext = /** @type {const} */ ({
        planName: "feature-plan",
        triageMeta: { classification: "FEATURE" },
        executionAgent: "engineer",
        executionMode: "worktree",
        projectRoot: Deno.cwd(),
        executionCwd: "/worktree",
        worktreeId: "wt-1",
        worktreeBranch: "runwield/worktree/feature-plan",
    });
    const result = await executePlan({
        planName: "feature-plan",
        triageMeta: { classification: "FEATURE" },
        hostedSession: makeHostedSession("checkpoint-failure"),
        __deps: {
            loadPlan: () =>
                Promise.resolve(
                    /** @type {any} */ ({
                        attrs: { status: "ready_for_work", classification: "FEATURE" },
                        body: "## Feature",
                    }),
                ),
            executeSingleEngineerPlan: () =>
                Promise.resolve({
                    repairRequired: false,
                    executionComplete: true,
                    executionContext,
                }),
            checkpointExecutionWorktree: () => Promise.reject(new Error("checkpoint rejected")),
            recordPlanEvent: () => {
                lifecycleMutated = true;
                return Promise.resolve(/** @type {any} */ ({}));
            },
            recordWorkflowMetric: () => Promise.resolve(null),
        },
    });

    assertEquals(result.executionComplete, false);
    assertEquals(result.repairRequired, true);
    assertStringIncludes(result.error || "", "checkpoint rejected");
    assertEquals(result.executionContext, executionContext);
    assertEquals(lifecycleMutated, false);
});

Deno.test("executePlan still executes ready FEATURE plans", async () => {
    let engineerCalled = false;
    /** @type {string[]} */
    const events = [];
    /** @type {any[]} */
    const planEventDetails = [];
    /** @type {any[]} */
    const metrics = [];
    const executionContext = /** @type {const} */ ({
        planName: "feature-plan",
        triageMeta: { classification: "FEATURE" },
        executionAgent: "engineer",
        executionMode: "non_git_in_place",
        projectRoot: Deno.cwd(),
        executionCwd: Deno.cwd(),
        nonGitInPlace: true,
    });
    const result = await executePlan({
        planName: "feature-plan",
        triageMeta: { classification: "FEATURE" },
        hostedSession: makeHostedSession("feature-execution"),
        reviewFeedback: "Keep the selected command.",
        reviewImages: [{ base64: "YXBwcm92ZWQ=", mimeType: "image/png" }],
        __deps: {
            loadPlan: () =>
                Promise.resolve(
                    /** @type {any} */ ({
                        attrs: { status: "ready_for_work", classification: "FEATURE" },
                        body: "## Feature",
                        markdown: "## Feature",
                    }),
                ),
            executeSingleEngineerPlan: (/** @type {any} */ { triageMeta, reviewFeedback, reviewImages }) => {
                engineerCalled = true;
                assertEquals(triageMeta.classification, "FEATURE");
                assertEquals(reviewFeedback, "Keep the selected command.");
                assertEquals(reviewImages, [{ base64: "YXBwcm92ZWQ=", mimeType: "image/png" }]);
                return Promise.resolve({
                    repairRequired: false,
                    executionComplete: true,
                    executionContext,
                    completionReport: "- Implemented.\n- Verified.",
                });
            },
            recordPlanEvent: (/** @type {any} */ { event, details }) => {
                events.push(event);
                planEventDetails.push(details);
                return Promise.resolve(/** @type {any} */ ({}));
            },
            markActiveWorktreeStatus: () => Promise.resolve(),
            recordWorkflowMetric: (/** @type {any} */ metric) => {
                metrics.push(metric);
                return Promise.resolve(null);
            },
        },
    });

    assertEquals(result, {
        repairRequired: false,
        executionComplete: true,
        executionContext,
        completionReport: "- Implemented.\n- Verified.",
    });
    assertEquals(engineerCalled, true);
    assertEquals(events, ["implementation_finished"]);
    assertEquals(planEventDetails[0].executionReport, "- Implemented.\n- Verified.");
    assertEquals(
        metrics.some((metric) =>
            metric.category === "execution" && metric.event === "plan_execution_started" &&
            metric.planName === "feature-plan"
        ),
        true,
    );
    assertEquals(
        metrics.some((metric) =>
            metric.category === "execution" && metric.event === "plan_execution_result" &&
            metric.details.executionComplete === true
        ),
        true,
    );
    assertEquals(
        metrics.some((metric) => metric.category === "execution" && metric.event === "implementation_finished"),
        true,
    );
});

Deno.test("executePlan dispatches explicit Frontend Engineer from loaded Plan metadata", async () => {
    let dispatchedAgent = "";
    const result = await executePlan({
        planName: "visual-feature",
        triageMeta: { classification: "FEATURE", executionAgent: "engineer" },
        hostedSession: makeHostedSession("frontend-execution"),
        __deps: {
            loadPlan: () =>
                Promise.resolve(
                    /** @type {any} */ ({
                        attrs: {
                            status: "ready_for_work",
                            classification: "FEATURE",
                            executionAgent: "frontend-engineer",
                            collaborationRecommendation: "pair",
                        },
                        body: "## Visual Feature",
                        markdown: "## Visual Feature",
                    }),
                ),
            runActiveAgentTurn: (/** @type {any} */ opts) => {
                dispatchedAgent = opts.agentName;
                return Promise.resolve(
                    /** @type {any} */ ([{
                        role: "toolResult",
                        toolName: "task_completed",
                        details: { outcome: "task_completed" },
                    }]),
                );
            },
            probeGitRepository: () => Promise.resolve({ ok: false, state: "git_missing", cwd: Deno.cwd() }),
            hasNonGitExecutionConsent: () => true,
            recordPlanEvent: () => Promise.resolve(/** @type {any} */ ({})),
            markActiveWorktreeStatus: () => Promise.resolve(),
            recordWorkflowMetric: () => Promise.resolve(null),
        },
    });

    assertEquals(result.executionComplete, true);
    assertEquals(dispatchedAgent, "frontend-engineer");
});

Deno.test("executePlan uses the Plan Pair recommendation and injects one workflow checkpoint tool", async () => {
    const hostedSession = makeHostedSession("pair-execution");
    /** @type {any} */
    let activeTurn = null;
    hostedSession.setInteractionAdapter({
        supportsInteraction: (type) => type === "pair_checkpoint",
        requestInteraction: () => {
            throw new Error("approve & run must not prompt for collaboration style");
        },
    });

    const result = await executePlan({
        planName: "visual-feature",
        triageMeta: { classification: "FEATURE" },
        hostedSession,
        __deps: {
            loadPlan: () =>
                Promise.resolve(
                    /** @type {any} */ ({
                        attrs: {
                            status: "ready_for_work",
                            classification: "FEATURE",
                            executionAgent: "frontend-engineer",
                            collaborationRecommendation: "pair",
                        },
                        body: "## Visual Feature",
                    }),
                ),
            runActiveAgentTurn: (/** @type {any} */ opts) => {
                activeTurn = opts;
                return Promise.resolve(
                    /** @type {any} */ ([{
                        role: "toolResult",
                        toolName: "task_completed",
                        details: { outcome: "task_completed", message: "- Done." },
                    }]),
                );
            },
            probeGitRepository: () => Promise.resolve({ ok: false, state: "git_missing", cwd: Deno.cwd() }),
            hasNonGitExecutionConsent: () => true,
            recordPlanEvent: () => Promise.resolve(/** @type {any} */ ({})),
            markActiveWorktreeStatus: () => Promise.resolve(),
            recordWorkflowMetric: () => Promise.resolve(null),
        },
    });

    assertEquals(result.executionComplete, true);
    assertEquals(activeTurn.agentName, "frontend-engineer");
    assertEquals(activeTurn.customTools.map((/** @type {any} */ tool) => tool.name), ["pair_checkpoint"]);
    assertStringIncludes(activeTurn.userRequest, "Pair Execution is active");
    assertEquals(hostedSession.getActiveExecutionWorkflow()?.collaborationStyle, "pair");
    assertEquals(hostedSession.getActiveExecutionWorkflow()?.pairCheckpointCount, 0);
});

Deno.test("executePlan runs autonomously when Plan recommends autonomous without prompting", async () => {
    const hostedSession = makeHostedSession("frontend-autonomous-recommendation");
    hostedSession.setInteractionAdapter({
        supportsInteraction: (type) => type === "pair_checkpoint",
        requestInteraction: () => {
            throw new Error("approve & run must not prompt for collaboration style");
        },
    });
    /** @type {any} */
    let executionArgs = null;

    const result = await executePlan({
        planName: "visual-feature",
        triageMeta: { classification: "FEATURE" },
        hostedSession,
        __deps: {
            loadPlan: () =>
                Promise.resolve(
                    /** @type {any} */ ({
                        attrs: {
                            status: "ready_for_work",
                            classification: "FEATURE",
                            executionAgent: "frontend-engineer",
                            collaborationRecommendation: "autonomous",
                        },
                        body: "## Visual Feature",
                    }),
                ),
            executeSingleEngineerPlan: (args) => {
                executionArgs = args;
                return Promise.resolve({ repairRequired: false, executionComplete: false });
            },
            recordWorkflowMetric: () => Promise.resolve(null),
        },
    });

    assertEquals(result.executionComplete, false);
    assertEquals(result.canceled, undefined);
    assertEquals(executionArgs.collaborationStyle, "autonomous");
    assertEquals(executionArgs.collaborationRecommendation, "autonomous");
});

Deno.test("executePlan falls back to autonomous without an interaction adapter", async () => {
    const hostedSession = makeHostedSession("pair-no-adapter");
    /** @type {string[]} */
    const messages = [];
    hostedSession.setEventSink((/** @type {{ message?: string }} */ event) => {
        if (event.message) messages.push(event.message);
    });
    /** @type {any} */
    let executionArgs = null;

    const result = await executePlan({
        planName: "visual-feature",
        triageMeta: { classification: "FEATURE" },
        hostedSession,
        __deps: {
            loadPlan: () =>
                Promise.resolve(
                    /** @type {any} */ ({
                        attrs: {
                            status: "ready_for_work",
                            classification: "FEATURE",
                            executionAgent: "frontend-engineer",
                            collaborationRecommendation: "pair",
                        },
                        body: "## Visual Feature",
                    }),
                ),
            executeSingleEngineerPlan: (args) => {
                executionArgs = args;
                return Promise.resolve({ repairRequired: false, executionComplete: false });
            },
            recordWorkflowMetric: () => Promise.resolve(null),
        },
    });

    assertEquals(result.executionComplete, false);
    assertEquals(executionArgs.collaborationStyle, "autonomous");
    assertEquals(executionArgs.collaborationRecommendation, "pair");
    assertEquals(
        messages.filter((message) => message.includes("Pair Execution is recommended by the Plan")),
        [
            "Pair Execution is recommended by the Plan but unavailable in this host; continuing with autonomous Frontend Engineer execution.",
        ],
    );
});

Deno.test("executePlan falls back to autonomous when the adapter withholds Pair capability", async () => {
    const hostedSession = makeHostedSession("pair-unsupported-adapter");
    let interactionRequested = false;
    hostedSession.setInteractionAdapter({
        supportsInteraction: () => false,
        requestInteraction: () => {
            interactionRequested = true;
            return Promise.resolve({ outcome: "selected", value: "continue" });
        },
    });
    /** @type {any} */
    let executionArgs = null;

    await executePlan({
        planName: "visual-feature",
        triageMeta: { classification: "FEATURE" },
        hostedSession,
        __deps: {
            loadPlan: () =>
                Promise.resolve(
                    /** @type {any} */ ({
                        attrs: {
                            status: "ready_for_work",
                            classification: "FEATURE",
                            executionAgent: "frontend-engineer",
                            collaborationRecommendation: "pair",
                        },
                        body: "## Visual Feature",
                    }),
                ),
            executeSingleEngineerPlan: (args) => {
                executionArgs = args;
                return Promise.resolve({ repairRequired: false, executionComplete: false });
            },
            recordWorkflowMetric: () => Promise.resolve(null),
        },
    });

    assertEquals(interactionRequested, false);
    assertEquals(executionArgs.collaborationStyle, "autonomous");
});

Deno.test("executePlan clears unusable Pair style when execution setup fails", async () => {
    const hostedSession = makeHostedSession("pair-setup-failed");
    hostedSession.setInteractionAdapter({
        supportsInteraction: (type) => type === "pair_checkpoint",
        requestInteraction: () => Promise.resolve({ outcome: "selected", value: "pair" }),
    });
    let activeTurnStarted = false;

    const result = await executePlan({
        planName: "visual-feature",
        triageMeta: { classification: "FEATURE" },
        hostedSession,
        __deps: {
            loadPlan: () =>
                Promise.resolve(
                    /** @type {any} */ ({
                        attrs: {
                            status: "ready_for_work",
                            classification: "FEATURE",
                            executionAgent: "frontend-engineer",
                            collaborationRecommendation: "pair",
                        },
                        body: "## Visual Feature",
                    }),
                ),
            probeGitRepository: () => Promise.resolve({ ok: false, state: "git_missing", cwd: Deno.cwd() }),
            hasNonGitExecutionConsent: () => false,
            confirmNonGitFeaturePlanExecution: () => Promise.resolve(false),
            runActiveAgentTurn: () => {
                activeTurnStarted = true;
                return Promise.resolve([]);
            },
            recordWorkflowMetric: () => Promise.resolve(null),
        },
    });

    assertEquals(result.executionComplete, false);
    assertEquals(activeTurnStarted, false);
    assertEquals(hostedSession.getActiveExecutionWorkflow()?.executionAgent, "frontend-engineer");
    assertEquals(hostedSession.getActiveExecutionWorkflow()?.collaborationStyle, "autonomous");
    assertEquals(hostedSession.getActiveExecutionWorkflow()?.executionStarted, false);
});

Deno.test("executePlan keeps legacy frontend execution autonomous without prompting", async () => {
    const hostedSession = makeHostedSession("legacy-frontend-autonomous");
    hostedSession.setInteractionAdapter({
        supportsInteraction: (type) => type === "pair_checkpoint",
        requestInteraction: () => {
            throw new Error("legacy frontend must not prompt");
        },
    });
    /** @type {any} */
    let executionArgs = null;

    const result = await executePlan({
        planName: "legacy-visual-feature",
        triageMeta: { classification: "FEATURE" },
        hostedSession,
        __deps: {
            loadPlan: () =>
                Promise.resolve(
                    /** @type {any} */ ({
                        attrs: { status: "ready_for_work", classification: "FEATURE", frontend: true },
                        body: "## Legacy Visual Feature",
                    }),
                ),
            executeSingleEngineerPlan: (args) => {
                executionArgs = args;
                return Promise.resolve({ repairRequired: false, executionComplete: false });
            },
            recordWorkflowMetric: () => Promise.resolve(null),
        },
    });

    assertEquals(result.executionComplete, false);
    assertEquals(executionArgs.collaborationStyle, "autonomous");
    assertEquals(executionArgs.triageMeta.executionAgent, "frontend-engineer");
});

Deno.test("executePlan rejects invalid loaded policy before dispatch or lifecycle mutation", async () => {
    let dispatched = false;
    let lifecycleMutated = false;
    /** @type {any[]} */
    const metrics = [];
    const result = await executePlan({
        planName: "bad-feature",
        triageMeta: { classification: "FEATURE", executionAgent: "frontend-engineer" },
        hostedSession: makeHostedSession("bad-feature-execution"),
        __deps: {
            loadPlan: () =>
                Promise.resolve(
                    /** @type {any} */ ({
                        attrs: {
                            status: "ready_for_work",
                            classification: "FEATURE",
                            executionAgent: "unknown-owner",
                            frontend: true,
                        },
                        body: "## Bad Feature",
                        markdown: "## Bad Feature",
                    }),
                ),
            executeSingleEngineerPlan: () => {
                dispatched = true;
                return Promise.resolve({ repairRequired: false, executionComplete: true });
            },
            recordPlanEvent: () => {
                lifecycleMutated = true;
                return Promise.resolve(/** @type {any} */ ({}));
            },
            recordWorkflowMetric: (/** @type {any} */ metric) => {
                metrics.push(metric);
                return Promise.resolve(null);
            },
        },
    });

    assertEquals(result.executionComplete, false);
    assertStringIncludes(result.error || "", "Invalid executionAgent: unknown-owner");
    assertEquals(dispatched, false);
    assertEquals(lifecycleMutated, false);
    assertEquals(metrics.some((metric) => metric.event === "plan_execution_started"), false);
});

Deno.test("executePlan treats incomplete Engineer execution as resumable", async () => {
    /** @type {string[]} */
    const events = [];
    /** @type {Array<string | null | undefined>} */
    const worktreeStatuses = [];
    const result = await executePlan({
        planName: "feature-plan",
        triageMeta: { classification: "FEATURE" },
        hostedSession: makeHostedSession("incomplete-feature-execution"),
        __deps: {
            loadPlan: () =>
                Promise.resolve(
                    /** @type {any} */ ({
                        attrs: { status: "ready_for_work", classification: "FEATURE" },
                        body: "## Feature",
                        markdown: "## Feature",
                    }),
                ),
            executeSingleEngineerPlan: () =>
                Promise.resolve({
                    repairRequired: false,
                    executionComplete: false,
                    error: "API failed",
                }),
            recordPlanEvent: (/** @type {any} */ { event }) => {
                events.push(event);
                return Promise.resolve(/** @type {any} */ ({}));
            },
            markActiveWorktreeStatus: (/** @type {any} */ status) => {
                worktreeStatuses.push(status);
                return Promise.resolve();
            },
        },
    });

    assertEquals(result, { repairRequired: false, executionComplete: false, error: "API failed" });
    assertEquals(events, []);
    assertEquals(worktreeStatuses, []);
});

Deno.test("executePlan keeps Engineer active when the implementation turn is interrupted", async () => {
    const hostedSession = makeHostedSession("interrupted-feature-execution");
    const plannerHandler = () => Promise.resolve({ kind: "complete" });
    const engineerHandler = () => Promise.resolve({ kind: "complete" });
    const order = /** @type {string[]} */ ([]);
    hostedSession.setRootAgentName("planner");
    hostedSession.setRootAgentSession(/** @type {any} */ ({ dispose: () => {} }));
    hostedSession.setActiveOnMessage(plannerHandler);

    const result = await executePlan({
        planName: "feature-plan",
        triageMeta: { classification: "FEATURE" },
        hostedSession,
        __deps: /** @type {any} */ ({
            loadPlan: () =>
                Promise.resolve(
                    /** @type {any} */ ({
                        attrs: { status: "ready_for_work", classification: "FEATURE" },
                        body: "## Feature",
                        markdown: "## Feature",
                    }),
                ),
            probeGitRepository: () => Promise.resolve({ ok: false, state: "not_git" }),
            hasNonGitExecutionConsent: () => true,
            confirmNonGitFeaturePlanExecution: () => {
                throw new Error("consent should already be recorded");
            },
            recordPlanEvent: () => Promise.resolve({}),
            recordWorkflowMetric: () => Promise.resolve(null),
            runActiveAgentTurn: (/** @type {any} */ options) =>
                runActiveAgentTurn(options, {
                    switchActiveAgent: /** @type {any} */ ((
                        /** @type {HostedSession} */ session,
                        /** @type {any} */ switchOptions,
                    ) => {
                        order.push("switch");
                        assertEquals(switchOptions.agentName, "engineer");
                        assertEquals(switchOptions.cwd, Deno.cwd());
                        session.setRootAgentName("engineer");
                        session.setRootAgentSession(
                            /** @type {any} */ ({ agent: { state: { messages: [] } }, dispose: () => {} }),
                        );
                        session.setActiveOnMessage(engineerHandler);
                        return Promise.resolve({ ok: true, agentName: "engineer", changed: true });
                    }),
                    runRootTurn: /** @type {any} */ (() => {
                        order.push("turn");
                        assertEquals(hostedSession.getActiveOnMessage(), engineerHandler);
                        return Promise.reject(new Error("interrupted by user question"));
                    }),
                }),
        }),
    });

    assertEquals(result.repairRequired, false);
    assertEquals(result.executionComplete, false);
    assertEquals(result.error, "interrupted by user question");
    assertEquals(result.executionContext?.executionMode, "non_git_in_place");
    assertEquals(result.executionContext?.executionCwd, Deno.cwd());
    assertEquals(order, ["switch", "turn"]);
    assertEquals(hostedSession.getRootAgentName(), "engineer");
    assertEquals(hostedSession.getActiveOnMessage(), engineerHandler);
});

Deno.test("executePlan uses single-plan execution for child FEATURE plans", async () => {
    let engineerCalled = false;
    const executionContext = /** @type {const} */ ({
        planName: "epic-a/01-child-feature",
        triageMeta: { classification: "FEATURE", parentPlan: "epic-a" },
        executionAgent: "engineer",
        executionMode: "non_git_in_place",
        projectRoot: Deno.cwd(),
        executionCwd: Deno.cwd(),
        nonGitInPlace: true,
    });
    const result = await executePlan({
        planName: "epic-a/01-child-feature",
        triageMeta: { classification: "FEATURE", parentPlan: "epic-a" },
        hostedSession: makeHostedSession("child-feature-execution"),
        __deps: {
            loadPlan: () =>
                Promise.resolve(
                    /** @type {any} */ ({
                        attrs: {
                            status: "ready_for_work",
                            classification: "FEATURE",
                            parentPlan: "epic-a",
                        },
                        body: "## Child FEATURE",
                        markdown: "## Child FEATURE",
                    }),
                ),
            executeSingleEngineerPlan: (/** @type {any} */ { triageMeta }) => {
                engineerCalled = true;
                assertEquals(triageMeta.parentPlan, "epic-a");
                return Promise.resolve({ repairRequired: false, executionComplete: true, executionContext });
            },
            recordPlanEvent: () => Promise.resolve(/** @type {any} */ ({})),
            markActiveWorktreeStatus: () => Promise.resolve(),
        },
    });

    assertEquals(result, { repairRequired: false, executionComplete: true, executionContext });
    assertEquals(engineerCalled, true);
});

Deno.test("buildSlicerRequest includes plan name and base instructions", () => {
    const text = buildSlicerRequest("my-plan", undefined);
    assertStringIncludes(text, "Slice Plan: my-plan");
    assertStringIncludes(text, "plans/my-plan.md");
    assertStringIncludes(text, "system prompt");
    // Without triage meta, the report block must not appear.
    assertEquals(text.includes("Triage Report"), false);
});

Deno.test("buildSlicerRequest includes triage report fields when present", () => {
    const text = buildSlicerRequest("my-plan", {
        classification: "PROJECT",
        complexity: "HIGH",
        summary: "Initialize RunWield",
        affectedPaths: ["src/foo.js", "src/bar.js"],
    });
    assertStringIncludes(text, "Triage Report");
    assertStringIncludes(text, "Classification: PROJECT");
    assertStringIncludes(text, "Complexity: HIGH");
    assertStringIncludes(text, "Summary: Initialize RunWield");
    assertStringIncludes(text, "src/foo.js, src/bar.js");
});

Deno.test("buildSlicerRequest omits empty affectedPaths", () => {
    const text = buildSlicerRequest("p", {
        classification: "PROJECT",
        complexity: "LOW",
        summary: "x",
        affectedPaths: [],
    });
    assertEquals(text.includes("Affected paths"), false);
});

// ── runSlicerAgent ─────────────────────────────────────────────────

/**
 * @returns {{ loadPlan: () => Promise<any>, findPlansByParent: () => Promise<any[]> }}
 */
function slicerPlanDeps() {
    return {
        loadPlan: () =>
            Promise.resolve({
                attrs: { classification: "PROJECT", status: "approved" },
                markdown: "# Epic",
                body: "# Epic",
            }),
        findPlansByParent: () => Promise.resolve([]),
    };
}

Deno.test("beginSlicerContextPhase persists a clean model-context boundary", () => {
    const manager = SessionManager.inMemory(Deno.cwd());
    manager.appendMessage({
        role: "user",
        content: [{ type: "text", text: "architect sausage making" }],
        timestamp: Date.now(),
    });
    manager.appendMessage({
        role: "assistant",
        content: [{ type: "text", text: "architecture deliberation" }],
        api: "test",
        provider: "test",
        model: "test",
        usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.now(),
    });
    const hostedSession = makeHostedSession();
    hostedSession.setRootAgentName("architect");
    hostedSession.setRootSessionManager(manager);

    const boundary = beginSlicerContextPhase({ planName: "epic-a", hostedSession, sessionManager: manager });
    assertEquals(boundary?.manager, manager);
    const boundaryContext = manager.buildSessionContext().messages;
    assertEquals(boundaryContext.length, 1);
    assertEquals(boundaryContext[0].role, "compactionSummary");
    assertEquals(JSON.stringify(boundaryContext).includes("architect sausage making"), false);

    manager.appendMessage({
        role: "user",
        content: [{ type: "text", text: "authoritative Epic handoff" }],
        timestamp: Date.now(),
    });
    const slicerContext = manager.buildSessionContext().messages;
    assertEquals(slicerContext.length, 2);
    assertEquals(JSON.stringify(slicerContext).includes("authoritative Epic handoff"), true);
    assertEquals(JSON.stringify(slicerContext).includes("architecture deliberation"), false);

    hostedSession.setRootAgentName("slicer");
    assertEquals(beginSlicerContextPhase({ planName: "epic-a", hostedSession, sessionManager: manager }), null);
    assertEquals(manager.buildContextEntries().filter((entry) => entry.type === "compaction").length, 1);
});

Deno.test("runSlicerAgent returns ok=true when session resolves", async () => {
    let captured = /** @type {any} */ (null);
    /** @type {string[]} */
    const loadedPaths = [];
    /** @type {any[]} */
    const boundaries = [];
    /** @type {string[]} */
    const order = [];
    const sessionManager = /** @type {any} */ ({
        buildSessionContext: () => ({ messages: [{ role: "user", content: "architect history" }] }),
        getLeafId: () => "architect-leaf",
        appendCompaction: (/** @type {any[]} */ ...args) => boundaries.push(args),
    });
    const hostedSession = makeHostedSession();
    hostedSession.setRootAgentName("architect");
    hostedSession.setRootSessionManager(sessionManager);
    const result = await runSlicerAgent({
        planName: "my-plan",
        triageMeta: { classification: "PROJECT", complexity: "LOW", summary: "x", affectedPaths: [] },
        reviewFeedback: "Keep the approved boundary.",
        reviewImages: [{ base64: "YXBwcm92ZWQ=", mimeType: "image/png" }],
        hostedSession,
        __deps: {
            ...slicerPlanDeps(),
            ensureBundledAgentDefFile: (relativePath) =>
                Promise.resolve(`/tmp/bundled-agent-definitions/${relativePath}`),
            loadAgentDefFromPath: (path, opts) => {
                loadedPaths.push(`${path}:${opts?.agentName}`);
                return Promise.resolve(/** @type {any} */ ({ displayName: "Slicer" }));
            },
            runActiveAgentTurn: (/** @type {any} */ opts) => {
                order.push("activeTurn");
                captured = opts;
                return Promise.resolve([]);
            },
        },
    });
    assertEquals(result.ok, true);
    assertEquals(order, ["activeTurn"]);
    assertEquals(loadedPaths, ["/tmp/bundled-agent-definitions/workflow-prompts/slicer-prompt.md:slicer"]);
    assertEquals(captured.agentName, "slicer");
    assertEquals(captured.allowReturnToRouter, false);
    assertEquals(captured.sessionManager, sessionManager);
    assertEquals(captured.images, [{ base64: "YXBwcm92ZWQ=", mimeType: "image/png" }]);
    assertStringIncludes(captured.userRequest, "Keep the approved boundary.");
    assertEquals(boundaries.length, 1);
    assertEquals(boundaries[0][1], "");
    assertEquals(boundaries[0][3], {
        kind: "agent_context_boundary",
        agentName: "slicer",
        planName: "my-plan",
    });
    assertStringIncludes(
        boundaries[0][0],
        "Earlier Router, Architect, and other-agent conversation was intentionally omitted",
    );
    /** @param {{ name: string }} tool */
    function getToolName(tool) {
        return tool.name;
    }
    assertEquals(captured.customTools.map(getToolName), ["slicer_finalize_decomposition"]);
    assertStringIncludes(captured.userRequest, "my-plan");
});

Deno.test("runSlicerAgent includes existing child Ticket References in resumed handoff", async () => {
    let userRequest = "";
    const sessionManager = /** @type {any} */ ({
        buildSessionContext: () => ({ messages: [] }),
        getLeafId: () => "architect-leaf",
        appendCompaction: () => {},
    });
    const hostedSession = makeHostedSession();
    hostedSession.setRootAgentName("architect");
    hostedSession.setRootSessionManager(sessionManager);

    const result = await runSlicerAgent({
        planName: "epic-a",
        hostedSession,
        __deps: {
            loadPlan: () =>
                Promise.resolve({
                    path: "/tmp/epic-a.md",
                    attrs: {
                        classification: "PROJECT",
                        status: "approved",
                        complexity: "HIGH",
                        summary: "Epic",
                        affectedPaths: [],
                        createdAt: "2026-01-01T00:00:00.000Z",
                    },
                    markdown: "# Epic",
                    body: "# Epic",
                }),
            findPlansByParent: () =>
                Promise.resolve([{
                    name: "epic-a/01-child",
                    path: "/tmp/epic-a/01-child.md",
                    attrs: {
                        classification: "FEATURE",
                        status: "draft",
                        complexity: "MEDIUM",
                        order: 1,
                        summary: "Child slice",
                        affectedPaths: [],
                        createdAt: "2026-01-01T00:00:00.000Z",
                        tickets: [{ url: "https://tracker.example/TICKET-1" }],
                    },
                }]),
            ensureBundledAgentDefFile: (relativePath) => Promise.resolve(`/tmp/${relativePath}`),
            loadAgentDefFromPath: () => Promise.resolve(/** @type {any} */ ({ displayName: "Slicer" })),
            runActiveAgentTurn: (/** @type {any} */ opts) => {
                userRequest = opts.userRequest;
                return Promise.resolve([]);
            },
        },
    });

    assertEquals(result.ok, true);
    assertStringIncludes(userRequest, "Direct Ticket references: https://tracker.example/TICKET-1");
});

Deno.test("runSlicerAgent restores the prior session leaf when isolated Slicer startup fails", async () => {
    /** @type {string[]} */
    const restoredLeaves = [];
    const sessionManager = /** @type {any} */ ({
        buildSessionContext: () => ({ messages: [{ role: "user", content: "architect history" }] }),
        getLeafId: () => "architect-leaf",
        appendCompaction: () => {},
        branch: (/** @type {string} */ leafId) => restoredLeaves.push(leafId),
    });
    const hostedSession = makeHostedSession();
    hostedSession.setRootAgentName("architect");
    hostedSession.setRootSessionManager(sessionManager);

    const result = await runSlicerAgent({
        planName: "p",
        hostedSession,
        __deps: {
            ...slicerPlanDeps(),
            runActiveAgentTurn: () => {
                throw new Error("boom");
            },
        },
    });

    assertEquals(result, { ok: false, error: "boom" });
    assertEquals(restoredLeaves, ["architect-leaf"]);
});

Deno.test("runSlicerAgent surfaces session errors as { ok:false, error }", async () => {
    const result = await runSlicerAgent({
        planName: "p",
        hostedSession: makeHostedSession(),
        __deps: {
            ...slicerPlanDeps(),
            runActiveAgentTurn: () => {
                throw new Error("boom");
            },
        },
    });
    assertEquals(result.ok, false);
    assertEquals(result.error, "boom");
});

Deno.test("runSlicerAgent surfaces non-Error throws as string", async () => {
    const result = await runSlicerAgent({
        planName: "p",
        hostedSession: makeHostedSession(),
        __deps: {
            ...slicerPlanDeps(),
            runActiveAgentTurn: () => {
                throw "string failure";
            },
        },
    });
    assertEquals(result.ok, false);
    assertEquals(result.error, "string failure");
});

Deno.test("runSlicerAgent completes through an event-only HostedSession", async () => {
    const result = await runSlicerAgent({
        planName: "p",
        hostedSession: makeHostedSession(),
        __deps: {
            ...slicerPlanDeps(),
            runActiveAgentTurn: () => Promise.resolve([]),
        },
    });
    assertEquals(result.ok, true);
});

Deno.test("runSlicerAgent reports failure through a system-status event", async () => {
    /** @type {string[]} */
    const messages = [];
    const target = makeHostedSession();
    target.setEventSink((/** @type {{ type?: string, message?: string }} */ event) => {
        if (event.type === "system_status") messages.push(String(event.message || ""));
    });
    await runSlicerAgent({
        planName: "p",
        hostedSession: target,
        __deps: {
            ...slicerPlanDeps(),
            runActiveAgentTurn: () => {
                throw new Error("kaboom");
            },
        },
    });
    assertEquals(messages.some((m) => m.includes("Slicer failed: kaboom")), true);
});

Deno.test("createSlicerFinalizeTool writes draft child FEATURE plans before finalizing approved Epic", async () => {
    /** @type {any} */
    let recorded = null;
    /** @type {Array<{ cwd: string, epicPlanName: string, children: unknown[], parentWorktreeBaseBranch?: string }>} */
    const materializeCalls = [];
    const childDescriptors = [{
        order: 1,
        title: "Child",
        summary: "Child summary",
        affectedPaths: ["src/a.js"],
        dependencies: [],
        content: "# Child",
    }];
    const writeResults = [{
        name: "epic-a/01-child",
        path: "/repo/plans/epic-a/01-child.md",
        title: "Child",
        action: "created",
        dependencies: [],
        metadata: { classification: "FEATURE", status: "draft", parentPlan: "epic-a" },
    }];
    const tool = createSlicerFinalizeTool({
        planName: "epic-a",
        cwd: "/repo",
        __deps: {
            loadPlan: () =>
                Promise.resolve(
                    /** @type {any} */ ({
                        attrs: {
                            classification: "PROJECT",
                            status: "approved",
                            worktreeBaseBranch: "feature-base",
                        },
                    }),
                ),
            materializeSlicerDraft: (args) => {
                materializeCalls.push(args);
                return Promise.resolve(/** @type {any} */ (writeResults));
            },
            findPlansByParent: () =>
                Promise.resolve([
                    /** @type {any} */ ({
                        name: "epic-a/01-child",
                        attrs: { classification: "FEATURE", status: "draft" },
                    }),
                ]),
            recordPlanEvent: (args) => {
                recorded = args;
                return Promise.resolve(/** @type {any} */ ({ status: "ready_for_work" }));
            },
        },
    });

    const result = await tool.execute(
        "call-1",
        { confirmation: "yes, finalize", children: childDescriptors },
        new AbortController().signal,
        () => {},
        /** @type {any} */ ({}),
    );

    assertEquals(materializeCalls, [{
        cwd: "/repo",
        epicPlanName: "epic-a",
        children: childDescriptors,
        parentWorktreeBaseBranch: "feature-base",
    }]);
    assertEquals(recorded.event, "decomposition_finalized");
    assertEquals(recorded.currentStatus, "approved");
    assertEquals(result.details, {
        status: "ready_for_work",
        children: ["epic-a/01-child"],
        writeResults,
        error: "",
    });
});

Deno.test("createSlicerFinalizeTool can finalize existing child FEATURE plans without writing", async () => {
    /** @type {any} */
    let recorded = null;
    const tool = createSlicerFinalizeTool({
        planName: "epic-a",
        cwd: "/repo",
        __deps: {
            loadPlan: () =>
                Promise.resolve(
                    /** @type {any} */ ({
                        attrs: { classification: "PROJECT", status: "ready_for_decomposition" },
                    }),
                ),
            findPlansByParent: () =>
                Promise.resolve([
                    /** @type {any} */ ({
                        name: "epic-a/01-child",
                        attrs: { classification: "FEATURE", status: "draft" },
                    }),
                ]),
            recordPlanEvent: (args) => {
                recorded = args;
                return Promise.resolve(/** @type {any} */ ({ status: "ready_for_work" }));
            },
        },
    });

    const result = await tool.execute(
        "call-1",
        { confirmation: "yes, finalize" },
        new AbortController().signal,
        () => {},
        /** @type {any} */ ({}),
    );

    assertEquals(recorded.event, "decomposition_finalized");
    assertEquals(result.details, {
        status: "ready_for_work",
        children: ["epic-a/01-child"],
        writeResults: [],
        error: "",
    });
});

Deno.test("createSlicerFinalizeTool leaves already finalized Epics ready without recording another lifecycle event", async () => {
    let recordCount = 0;
    const tool = createSlicerFinalizeTool({
        planName: "epic-a",
        cwd: "/repo",
        __deps: {
            loadPlan: () =>
                Promise.resolve(
                    /** @type {any} */ ({
                        attrs: { classification: "PROJECT", status: "ready_for_work" },
                    }),
                ),
            findPlansByParent: () =>
                Promise.resolve([
                    /** @type {any} */ ({
                        name: "epic-a/01-child",
                        attrs: { classification: "FEATURE", status: "draft" },
                    }),
                ]),
            recordPlanEvent: () => {
                recordCount++;
                return Promise.resolve(/** @type {any} */ ({ status: "ready_for_work" }));
            },
        },
    });

    const result = await tool.execute(
        "call-1",
        { confirmation: "yes, finalize" },
        new AbortController().signal,
        () => {},
        /** @type {any} */ ({}),
    );

    assertEquals(recordCount, 0);
    assertEquals(result.details, {
        status: "ready_for_work",
        children: ["epic-a/01-child"],
        writeResults: [],
        error: "",
    });
});

Deno.test("materializeSlicerDraft delegates child FEATURE draft writes", async () => {
    /** @type {Array<{ cwd: string, epicPlanName: string, descriptors: unknown[] }>} */
    const calls = [];
    const children = [{
        sequence: 1,
        title: "Draft child",
        summary: "Draft summary",
        affectedPaths: ["src/plan-store.js"],
        dependencies: [],
        content: "# Draft child",
    }];
    const result = await materializeSlicerDraft({
        cwd: "/repo",
        epicPlanName: "epic-a",
        children,
        parentWorktreeBaseBranch: "feature-base",
        __deps: {
            saveChildFeaturePlans: (cwd, epicPlanName, descriptors) => {
                calls.push({ cwd, epicPlanName, descriptors });
                return Promise.resolve([{
                    name: "epic-a/01-draft-child",
                    path: "/repo/plans/epic-a/01-draft-child.md",
                    title: "Draft child",
                    action: "created",
                    dependencies: [],
                    metadata: {
                        classification: "FEATURE",
                        status: "draft",
                        parentPlan: "epic-a",
                        affectedPaths: ["src/plan-store.js"],
                    },
                }]);
            },
        },
    });

    assertEquals(calls, [{
        cwd: "/repo",
        epicPlanName: "epic-a",
        descriptors: [{ ...children[0], worktreeBaseBranch: "feature-base" }],
    }]);
    assertEquals(result[0].name, "epic-a/01-draft-child");
});

// ── openSlicerDecomposition ──────────────────────────────────────────────

Deno.test("openSlicerDecomposition opens decomposition when persisted plan is an Epic", async () => {
    let slicerCalls = 0;
    const result = await openSlicerDecomposition({
        planName: "epic-a",
        planPath: "/tmp/epic-a.md",
        hostedSession: makeHostedSession(),
        __deps: {
            readTextFile: () =>
                Promise.resolve([
                    "---",
                    "classification: PROJECT",
                    "status: approved",
                    "---",
                    "# Epic",
                ].join("\n")),
            runSlicerAgent: (opts) => {
                slicerCalls++;
                assertEquals(opts.triageMeta?.classification, "PROJECT");
                return Promise.resolve({ ok: true });
            },
        },
    });

    assertEquals(result, { ok: true, slicerInvoked: true });
    assertEquals(slicerCalls, 1);
});

Deno.test("openSlicerDecomposition returns persisted Epic slicer throws as slicer failure", async () => {
    let slicerCalls = 0;
    const result = await openSlicerDecomposition({
        planName: "epic-a",
        planPath: "/tmp/epic-a.md",
        hostedSession: makeHostedSession(),
        __deps: {
            readTextFile: () =>
                Promise.resolve([
                    "---",
                    "classification: PROJECT",
                    "status: approved",
                    "---",
                    "# Epic",
                ].join("\n")),
            runSlicerAgent: () => {
                slicerCalls++;
                throw new Error("agent definition unavailable");
            },
        },
    });

    assertEquals(result, { ok: false, error: "agent definition unavailable", stage: "slicer" });
    assertEquals(slicerCalls, 1);
});

Deno.test("openSlicerDecomposition returns { ok:false, stage:'slicer' } when epic slicer fails", async () => {
    const result = await openSlicerDecomposition({
        planName: "p",
        planPath: "/tmp/p.md",
        hostedSession: makeHostedSession(),
        __deps: {
            readTextFile: () =>
                Promise.resolve([
                    "---",
                    "classification: PROJECT",
                    "status: approved",
                    "---",
                    "# Epic",
                ].join("\n")),
            runSlicerAgent: () => Promise.resolve({ ok: false, error: "model timeout" }),
        },
    });
    assertEquals(result.ok, false);
    assertEquals(/** @type {any} */ (result).stage, "slicer");
    assertEquals(/** @type {any} */ (result).error, "model timeout");
});

Deno.test("openSlicerDecomposition reports slicer failure when error is missing from result", async () => {
    const result = await openSlicerDecomposition({
        planName: "p",
        planPath: "/tmp/p.md",
        hostedSession: makeHostedSession(),
        __deps: {
            readTextFile: () =>
                Promise.resolve([
                    "---",
                    "classification: PROJECT",
                    "status: approved",
                    "---",
                    "# Epic",
                ].join("\n")),
            runSlicerAgent: () => Promise.resolve({ ok: false }),
        },
    });
    assertEquals(result.ok, false);
    assertEquals(/** @type {any} */ (result).stage, "slicer");
    assertEquals(/** @type {any} */ (result).error, "slicer failed");
});

Deno.test("startActiveExecutionWorkflow records attempt timestamp only after execution starts", async () => {
    const hostedSession = makeHostedSession("attempt-clock-workflow");
    const result = await startActiveExecutionWorkflow({
        planName: "clock-plan",
        triageMeta: { classification: "FEATURE" },
        currentStatus: "ready_for_work",
        hostedSession,
        __deps: {
            now: () => 4242,
            probeGitRepository: () => Promise.resolve({ ok: false, state: "not_git", cwd: Deno.cwd() }),
            hasNonGitExecutionConsent: () => true,
            recordPlanEvent: () => Promise.resolve(/** @type {any} */ ({})),
            recordWorkflowMetric: () => Promise.resolve(null),
        },
    });

    assertEquals(result.executionStarted, true);
    assertEquals(result.executionAttemptStartedAtMs, 4242);
    assertEquals(hostedSession.getActiveExecutionWorkflow()?.executionAttemptStartedAtMs, 4242);
});

Deno.test("executePlan records content-free runtime-style metrics", async () => {
    const cases = [
        {
            id: "canonical-pair-capable",
            attrs: {
                status: "ready_for_work",
                classification: "FEATURE",
                executionAgent: "frontend-engineer",
                collaborationRecommendation: "pair",
            },
            supportsPair: true,
            expected: {
                policySource: "canonical",
                recommendation: "pair",
                runtimeStyle: "pair",
                pairCapable: true,
                resolutionReason: "canonical_pair_capable",
            },
        },
        {
            id: "canonical-autonomous",
            attrs: {
                status: "ready_for_work",
                classification: "FEATURE",
                executionAgent: "frontend-engineer",
                collaborationRecommendation: "autonomous",
            },
            supportsPair: true,
            expected: {
                policySource: "canonical",
                recommendation: "autonomous",
                runtimeStyle: "autonomous",
                pairCapable: true,
                resolutionReason: "canonical_autonomous",
            },
        },
        {
            id: "canonical-pair-unavailable",
            attrs: {
                status: "ready_for_work",
                classification: "FEATURE",
                executionAgent: "frontend-engineer",
                collaborationRecommendation: "pair",
            },
            supportsPair: false,
            expected: {
                policySource: "canonical",
                recommendation: "pair",
                runtimeStyle: "autonomous",
                pairCapable: false,
                resolutionReason: "canonical_pair_unavailable",
            },
        },
        {
            id: "legacy-frontend",
            attrs: { status: "ready_for_work", classification: "FEATURE", frontend: true },
            supportsPair: true,
            expected: {
                policySource: "legacy_frontend",
                recommendation: "autonomous",
                runtimeStyle: "autonomous",
                pairCapable: true,
                resolutionReason: "legacy_autonomous",
            },
        },
    ];

    for (const testCase of cases) {
        const hostedSession = makeHostedSession(`runtime-style-${testCase.id}`);
        hostedSession.setInteractionAdapter({
            supportsInteraction: (type) => testCase.supportsPair && type === "pair_checkpoint",
            requestInteraction: () => Promise.resolve({ outcome: "selected", value: "continue" }),
        });
        const metrics = /** @type {any[]} */ ([]);
        await executePlan({
            planName: `visual-${testCase.id}`,
            triageMeta: { classification: "FEATURE" },
            hostedSession,
            __deps: {
                loadPlan: () => Promise.resolve(/** @type {any} */ ({ attrs: testCase.attrs, body: "## Visual" })),
                executeSingleEngineerPlan: () => Promise.resolve({ repairRequired: false, executionComplete: false }),
                recordWorkflowMetric: (metric) => {
                    metrics.push(metric);
                    return Promise.resolve(null);
                },
            },
        });
        assertEquals(
            metrics.find((metric) => metric.event === "frontend_runtime_style_resolved")?.details,
            testCase.expected,
        );
    }
});
