import { assertEquals, assertRejects } from "@std/assert";
import { createAgentHandler as createAgentHandlerFn } from "./agent-handler.js";
import { HostedSession } from "./hosted-session.js";

/**
 * @param {string} [id]
 */
function makeHostedSession(id = `agent-handler-test-${crypto.randomUUID()}`) {
    return new HostedSession({ id, cwd: Deno.cwd() });
}

/**
 * @param {string} agentName
 * @param {any} [deps]
 */
function createAgentHandler(agentName, deps = {}) {
    const hostedSession =
        /** @type {import('./hosted-session.js').HostedSession} */ (deps.hostedSession || makeHostedSession());
    if (!hostedSession.getRootAgentName()) {
        hostedSession.setRootAgentName(agentName);
        hostedSession.setRootAgentSession(
            /** @type {any} */ ({ agent: { state: { messages: [] } }, dispose: () => {} }),
        );
    }
    return createAgentHandlerFn(agentName, {
        switchActiveAgent: (
            /** @type {unknown} */ _hostedSession,
            /** @type {{ agentName: string }} */ options,
        ) => Promise.resolve({ ok: true, agentName: options.agentName, changed: true }),
        ...deps,
        runRootTurn: deps.runRootTurn || (() => Promise.resolve([])),
        hostedSession,
    });
}

Deno.test("agent-handler dispatches triage_report from any agent", async () => {
    /** @type {import('../workflow/orchestrator.js').TriageOutcome} */
    const triage = {
        routingIntent: "FEATURE",
        classification: "FEATURE",
        complexity: "LOW",
        summary: "s",
        affectedPaths: ["src/a.js"],
    };
    /** @type {unknown} */
    let dispatchArgs = null;
    const sessionManager = /** @type {any} */ ({});
    const images = [{ base64: "abc", mimeType: "image/png" }];
    /** @type {any} */
    let runArgs = null;
    const handler = createAgentHandler("operator", {
        runRootTurn: (/** @type {any} */ opts) => {
            runArgs = opts;
            return Promise.resolve(/** @type {any} */ ([]));
        },
        readLatestTriageOutcome: () => triage,
        dispatchPostTriage: (/** @type {any} */ args) => {
            dispatchArgs = args;
            return Promise.resolve();
        },
        readLatestPlanOutcome: () => {
            throw new Error("triage_report should short-circuit later workflow outcomes");
        },
    });

    await handler("classify this", images, sessionManager);

    assertEquals(runArgs.agentName, "operator");
    const scopedDispatchArgs = /** @type {any} */ (dispatchArgs);
    assertEquals(scopedDispatchArgs.triage, triage);
    assertEquals(scopedDispatchArgs.userRequest, "classify this");
    assertEquals(scopedDispatchArgs.images, images);
    assertEquals("uiAPI" in scopedDispatchArgs, false);
    assertEquals(scopedDispatchArgs.sessionManager, sessionManager);
    assertEquals(scopedDispatchArgs.hostedSession instanceof HostedSession, true);
    assertEquals(typeof scopedDispatchArgs.__deps.createAgentHandler, "function");
});

Deno.test("agent-handler passes agent definition overrides and custom tools to root turns", async () => {
    /** @type {any} */
    let captured = null;
    const customTools = [
        /** @type {any} */ ({ name: "slicer_finalize_decomposition" }),
    ];
    const agentDef = /** @type {any} */ ({ displayName: "Slicer" });
    const hostedSession = makeHostedSession();
    hostedSession.setRootAgentName("slicer");
    const handler = createAgentHandler("slicer", {
        hostedSession,
        _agentDefOverride: agentDef,
        customTools,
        allowReturnToRouter: false,
        runRootTurn: (/** @type {any} */ opts) => {
            captured = opts;
            return Promise.resolve([]);
        },
        readLatestTriageOutcome: () => null,
        readLatestPlanOutcome: () => null,
        readLatestTaskCompletedOutcome: () => false,
    });

    await handler("write the drafts", [], /** @type {any} */ ({ id: "root-session" }));

    assertEquals(captured.agentName, "slicer");
    assertEquals(captured.allowReturnToRouter, false);
    assertEquals(captured._agentDefOverride, agentDef);
    assertEquals(captured.customTools, customTools);
});

Deno.test("agent-handler refuses to run when active handler drifts from root agent", async () => {
    let ranRouter = false;
    const hostedSession = makeHostedSession();
    hostedSession.setRootAgentName("planner");
    hostedSession.setRootAgentSession(
        /** @type {any} */ ({
            agent: { state: { messages: [] } },
        }),
    );
    const handler = createAgentHandler("router", {
        hostedSession,
        runRootTurn: () => {
            ranRouter = true;
            return Promise.resolve([]);
        },
    });

    await assertRejects(
        () => handler("follow-up", [], /** @type {any} */ ({})),
        Error,
        'active handler "router" does not match root agent "planner"',
    );
    assertEquals(ranRouter, false);
});

Deno.test("agent-handler calls executePlan when outcome is approved_execute", async () => {
    /** @type {Array<unknown[]>} */
    const executeCalls = [];
    const handler = createAgentHandler("architect", {
        runRootTurn: () =>
            Promise.resolve(
                /** @type {any} */ ([{
                    role: "toolResult",
                    toolName: "plan_written",
                    details: {
                        outcome: "approved_execute",
                        planName: "my-plan",
                        triageMeta: { classification: "PROJECT", complexity: "LOW", summary: "x", affectedPaths: [] },
                        feedback: "Keep the selected command.",
                        images: [{ base64: "YXBwcm92ZWQ=", mimeType: "image/png" }],
                    },
                }]),
            ),
        readLatestPlanOutcome: (/** @type {any} */ msgs) => /** @type {any} */ (msgs[0]).details,
        executePlan: /** @type {any} */ ((/** @type {unknown[]} */ ...args) => {
            executeCalls.push(args);
            return Promise.resolve({ repairRequired: false, executionComplete: true });
        }),
        runValidationLoop: () => Promise.resolve(),
    });

    await handler("the request", [], /** @type {any} */ (undefined));
    assertEquals(executeCalls.length, 1);
    const executionOptions = /** @type {any} */ (executeCalls[0][0]);
    assertEquals(executionOptions.planName, "my-plan");
    assertEquals(executionOptions.reviewFeedback, "Keep the selected command.");
    assertEquals(executionOptions.reviewImages, [{
        base64: "YXBwcm92ZWQ=",
        mimeType: "image/png",
    }]);
});

Deno.test("agent-handler validates after approved_execute only when execution completed", async () => {
    let validationCount = 0;
    /** @type {string | undefined} */
    let finalAgentName;
    /** @type {any} */
    let validationExecutionContext;
    /** @type {any[]} */
    const metrics = [];
    const handler = createAgentHandler("planner", {
        runRootTurn: () => Promise.resolve(/** @type {any} */ ([])),
        readLatestPlanOutcome: () => /** @type {any} */ ({ outcome: "approved_execute", planName: "p" }),
        executePlan: /** @type {any} */ (() =>
            Promise.resolve({
                repairRequired: false,
                executionComplete: true,
                executionContext: { executionMode: "worktree", executionCwd: "/worktree", immutable: true },
            })),
        runValidationLoop: (/** @type {any} */ args) => {
            validationCount++;
            finalAgentName = /** @type {any} */ (args).finalAgentName;
            validationExecutionContext = /** @type {any} */ (args).executionContext;
            return Promise.resolve();
        },
        recordWorkflowMetric: (/** @type {any} */ metric) => {
            metrics.push(metric);
            return Promise.resolve(null);
        },
    });

    await handler("req", [], /** @type {any} */ (undefined));
    assertEquals(validationCount, 1);
    assertEquals(finalAgentName, "planner");
    assertEquals(validationExecutionContext, { executionMode: "worktree", executionCwd: "/worktree", immutable: true });
    assertEquals(
        metrics.some((metric) =>
            metric.category === "planning" && metric.event === "active_agent_transition" &&
            metric.details.transition === "execute_plan"
        ),
        true,
    );
    assertEquals(
        metrics.some((metric) =>
            metric.category === "execution" && metric.event === "active_agent_transition" &&
            metric.details.transition === "run_validation"
        ),
        true,
    );
});

Deno.test("agent-handler skips validation when approved_execute did not complete execution", async () => {
    let validationCount = 0;
    const handler = createAgentHandler("planner", {
        runRootTurn: () => Promise.resolve(/** @type {any} */ ([])),
        readLatestPlanOutcome: () => /** @type {any} */ ({ outcome: "approved_execute", planName: "p" }),
        executePlan: /** @type {any} */ (() => Promise.resolve({ repairRequired: false, executionComplete: false })),
        runValidationLoop: () => {
            validationCount++;
            return Promise.resolve();
        },
    });

    await handler("req", [], /** @type {any} */ (undefined));
    assertEquals(validationCount, 0);
});

Deno.test("agent-handler does not switch agents when pre-execution selection is canceled", async () => {
    /** @type {string[]} */
    const switchedAgents = [];
    /** @type {string[]} */
    const attentionAgents = [];
    const hostedSession = makeHostedSession("pre-execution-canceled");
    hostedSession.setRootAgentName("planner");
    hostedSession.setRootAgentSession(
        /** @type {any} */ ({ agent: { state: { messages: [] } }, dispose: () => {} }),
    );
    const handler = createAgentHandler("planner", {
        hostedSession,
        runRootTurn: () => Promise.resolve(/** @type {any} */ ([])),
        readLatestPlanOutcome: () => /** @type {any} */ ({
            outcome: "approved_execute",
            planName: "visual-plan",
            triageMeta: {
                classification: "FEATURE",
                executionAgent: "frontend-engineer",
                collaborationRecommendation: "pair",
            },
        }),
        executePlan: /** @type {any} */ (() =>
            Promise.resolve({
                repairRequired: false,
                executionComplete: false,
                canceled: true,
                error: "Collaboration style selection canceled before execution started.",
            })),
        switchActiveAgent: (
            /** @type {HostedSession} */ _hostedSession,
            /** @type {{ agentName: string }} */ options,
        ) => {
            switchedAgents.push(options.agentName);
            return Promise.resolve({ ok: true, agentName: options.agentName, changed: true });
        },
        requestAttention: (
            /** @type {HostedSession} */ _hostedSession,
            /** @type {string} */ _reason,
            /** @type {string} */ targetAgentName,
        ) => attentionAgents.push(targetAgentName),
    });

    await handler("req", [], /** @type {any} */ (undefined));

    assertEquals(switchedAgents, []);
    assertEquals(attentionAgents, ["planner"]);
    assertEquals(hostedSession.getRootAgentName(), "planner");
    assertEquals(hostedSession.getActiveExecutionWorkflow(), null);
});

Deno.test("agent-handler keeps Engineer active when approved_execute execution is incomplete", async () => {
    /** @type {string[]} */
    const restoredAgents = [];
    /** @type {string[]} */
    const attentionAgents = [];
    const handler = createAgentHandler("architect", {
        runRootTurn: () => Promise.resolve(/** @type {any} */ ([])),
        readLatestPlanOutcome: () => /** @type {any} */ ({ outcome: "approved_execute", planName: "p" }),
        executePlan: /** @type {any} */ (() => Promise.resolve({ repairRequired: false, executionComplete: false })),
        runValidationLoop: () => {
            throw new Error("should not validate incomplete execution");
        },
        switchActiveAgent: (
            /** @type {HostedSession} */ hostedSession,
            /** @type {{ agentName: string }} */ options,
        ) => {
            restoredAgents.push(options.agentName);
            hostedSession.setRootAgentName(options.agentName);
            return Promise.resolve({ ok: true, agentName: options.agentName, changed: true });
        },
        requestAttention: (
            /** @type {HostedSession} */ _hostedSession,
            /** @type {string} */ _reason,
            /** @type {string} */ targetAgentName,
        ) => attentionAgents.push(targetAgentName),
    });

    await handler("req", [], /** @type {any} */ (undefined));
    assertEquals(restoredAgents, ["engineer"]);
    assertEquals(attentionAgents, ["engineer"]);
});

Deno.test("agent-handler clears a transient Pair pause when the user resumes", async () => {
    const hostedSession = makeHostedSession("pair-resume");
    hostedSession.setRootAgentName("frontend-engineer");
    hostedSession.setRootAgentSession(
        /** @type {any} */ ({ agent: { state: { messages: [] } }, dispose: () => {} }),
    );
    hostedSession.setActiveExecutionWorkflow({
        planName: "visual-plan",
        triageMeta: { classification: "FEATURE" },
        executionAgent: "frontend-engineer",
        executionStarted: true,
        executionAttemptStartedAtMs: 6789,
        collaborationStyle: "pair",
        pairCheckpointCount: 1,
        pairPauseReason: "stop",
        pairStopRequested: true,
    });
    const handler = createAgentHandler("frontend-engineer", {
        hostedSession,
        runRootTurn: () => {
            assertEquals(hostedSession.getActiveExecutionWorkflow()?.pairPauseReason, undefined);
            assertEquals(hostedSession.getActiveExecutionWorkflow()?.pairStopRequested, undefined);
            return Promise.resolve([]);
        },
        readLatestPlanOutcome: () => null,
        readLatestTaskCompletedOutcome: () => false,
    });

    await handler("continue", [], /** @type {any} */ (undefined));

    assertEquals(hostedSession.getActiveExecutionWorkflow()?.collaborationStyle, "pair");
    assertEquals(hostedSession.getActiveExecutionWorkflow()?.pairCheckpointCount, 1);
    assertEquals(hostedSession.getActiveExecutionWorkflow()?.executionAttemptStartedAtMs, 6789);
});

Deno.test("agent-handler keeps a Pair pause for unrelated follow-up input", async () => {
    const hostedSession = makeHostedSession("pair-unrelated-follow-up");
    hostedSession.setRootAgentName("frontend-engineer");
    hostedSession.setRootAgentSession(
        /** @type {any} */ ({ agent: { state: { messages: [] } }, dispose: () => {} }),
    );
    hostedSession.setActiveExecutionWorkflow({
        planName: "visual-plan",
        triageMeta: { classification: "FEATURE" },
        executionAgent: "frontend-engineer",
        collaborationStyle: "pair",
        pairCheckpointCount: 1,
        pairPauseReason: "stop",
        pairStopRequested: true,
    });
    let validationCount = 0;
    const handler = createAgentHandler("frontend-engineer", {
        hostedSession,
        runRootTurn: () => {
            assertEquals(hostedSession.getActiveExecutionWorkflow()?.pairPauseReason, "stop");
            assertEquals(hostedSession.getActiveExecutionWorkflow()?.pairStopRequested, true);
            return Promise.resolve(
                /** @type {any} */ ([{
                    role: "toolResult",
                    toolName: "task_completed",
                    details: { outcome: "task_completed" },
                }]),
            );
        },
        readLatestPlanOutcome: () => null,
        readLatestTaskCompletedOutcome: () => true,
        runValidationLoop: () => {
            validationCount++;
            return Promise.resolve();
        },
    });

    await handler("what changed so far?", [], /** @type {any} */ (undefined));

    assertEquals(validationCount, 0);
    assertEquals(hostedSession.getActiveExecutionWorkflow()?.pairPauseReason, "stop");
    assertEquals(hostedSession.getActiveExecutionWorkflow()?.pairStopRequested, true);
});

Deno.test("agent-handler does not validate same-turn Task Completion after a Pair stop", async () => {
    const hostedSession = makeHostedSession("pair-stop-completion");
    hostedSession.setRootAgentName("frontend-engineer");
    hostedSession.setRootAgentSession(
        /** @type {any} */ ({ agent: { state: { messages: [] } }, dispose: () => {} }),
    );
    hostedSession.setActiveExecutionWorkflow({
        planName: "visual-plan",
        triageMeta: { classification: "FEATURE" },
        executionAgent: "frontend-engineer",
        collaborationStyle: "pair",
        pairCheckpointCount: 0,
    });
    let validationCount = 0;
    const handler = createAgentHandler("frontend-engineer", {
        hostedSession,
        runRootTurn: () => {
            const workflow = hostedSession.getActiveExecutionWorkflow();
            if (!workflow) throw new Error("expected active workflow");
            hostedSession.setActiveExecutionWorkflow({ ...workflow, pairPauseReason: "stop" });
            return Promise.resolve(
                /** @type {any} */ ([{
                    role: "toolResult",
                    toolName: "task_completed",
                    details: { outcome: "task_completed" },
                }]),
            );
        },
        readLatestPlanOutcome: () => null,
        readLatestTaskCompletedOutcome: () => true,
        runValidationLoop: () => {
            validationCount++;
            return Promise.resolve();
        },
    });

    await handler("implement", [], /** @type {any} */ (undefined));

    assertEquals(validationCount, 0);
    assertEquals(hostedSession.getActiveExecutionWorkflow()?.pairPauseReason, "stop");
});

Deno.test("agent-handler ignores Task Completion for execution that never started", async () => {
    const hostedSession = makeHostedSession("execution-not-started");
    hostedSession.setRootAgentName("frontend-engineer");
    hostedSession.setRootAgentSession(
        /** @type {any} */ ({ agent: { state: { messages: [] } }, dispose: () => {} }),
    );
    hostedSession.setActiveExecutionWorkflow({
        planName: "visual-plan",
        triageMeta: { classification: "FEATURE" },
        executionAgent: "frontend-engineer",
        executionStarted: false,
        collaborationStyle: "autonomous",
    });
    let validationCount = 0;
    const handler = createAgentHandler("frontend-engineer", {
        hostedSession,
        runRootTurn: () =>
            Promise.resolve(
                /** @type {any} */ ([{
                    role: "toolResult",
                    toolName: "task_completed",
                    details: { outcome: "task_completed" },
                }]),
            ),
        readLatestPlanOutcome: () => null,
        readLatestTaskCompletedOutcome: () => true,
        runValidationLoop: () => {
            validationCount++;
            return Promise.resolve();
        },
    });

    await handler("continue", [], /** @type {any} */ (undefined));

    assertEquals(validationCount, 0);
    assertEquals(hostedSession.getActiveExecutionWorkflow()?.executionStarted, false);
});

Deno.test("agent-handler does NOT call executePlan when outcome is saved", async () => {
    let executeCount = 0;
    const handler = createAgentHandler("planner", {
        runRootTurn: () => Promise.resolve(/** @type {any} */ ([])),
        readLatestPlanOutcome: () => ({ outcome: "saved", planName: "p" }),
        executePlan: /** @type {any} */ (() => {
            executeCount++;
            return Promise.resolve(undefined);
        }),
        runValidationLoop: () => Promise.resolve(),
    });

    await handler("req", [], /** @type {any} */ (undefined));
    assertEquals(executeCount, 0);
});

Deno.test("agent-handler starts Slicer after Architect returns approved_decompose", async () => {
    /** @type {any} */
    let slicerArgs = null;
    const sessionManager = /** @type {any} */ ({ id: "root-history" });
    const handler = createAgentHandler("architect", {
        runRootTurn: () => Promise.resolve(/** @type {any} */ ([])),
        readLatestPlanOutcome: () => /** @type {any} */ ({
            outcome: "approved_decompose",
            planName: "epic-a",
            triageMeta: { classification: "PROJECT" },
            feedback: "Keep the approved boundary.",
            images: [{ base64: "YXBwcm92ZWQ=", mimeType: "image/png" }],
        }),
        runSlicerAgent: (/** @type {any} */ args) => {
            slicerArgs = args;
            return Promise.resolve({ ok: true });
        },
    });

    await handler("req", [], sessionManager);

    assertEquals(slicerArgs.planName, "epic-a");
    assertEquals(slicerArgs.triageMeta, { classification: "PROJECT" });
    assertEquals(slicerArgs.reviewFeedback, "Keep the approved boundary.");
    assertEquals(slicerArgs.reviewImages, [{ base64: "YXBwcm92ZWQ=", mimeType: "image/png" }]);
    assertEquals(slicerArgs.sessionManager, sessionManager);
});

Deno.test("agent-handler does NOT call executePlan when outcome is feedback", async () => {
    let executeCount = 0;
    const handler = createAgentHandler("architect", {
        runRootTurn: () => Promise.resolve(/** @type {any} */ ([])),
        readLatestPlanOutcome: () => ({ outcome: "feedback", planName: "p", feedback: "redo" }),
        executePlan: /** @type {any} */ (() => {
            executeCount++;
            return Promise.resolve(undefined);
        }),
        runValidationLoop: () => Promise.resolve(),
    });

    await handler("req", [], /** @type {any} */ (undefined));
    assertEquals(executeCount, 0);
});

Deno.test("agent-handler does NOT call executePlan when no plan_written outcome present", async () => {
    let executeCount = 0;
    const handler = createAgentHandler("operator", {
        runRootTurn: () => Promise.resolve(/** @type {any} */ ([])),
        readLatestPlanOutcome: () => null,
        executePlan: /** @type {any} */ (() => {
            executeCount++;
            return Promise.resolve(undefined);
        }),
        runValidationLoop: () => Promise.resolve(),
    });

    await handler("req", [], /** @type {any} */ (undefined));
    assertEquals(executeCount, 0);
});

Deno.test("agent-handler does NOT call executePlan when planName missing on approved_execute", async () => {
    // Defensive: even if outcome is approved_execute but planName is absent, don't dispatch.
    let executeCount = 0;
    const handler = createAgentHandler("planner", {
        runRootTurn: () => Promise.resolve(/** @type {any} */ ([])),
        readLatestPlanOutcome: () => /** @type {any} */ ({ outcome: "approved_execute" }),
        executePlan: /** @type {any} */ (() => {
            executeCount++;
            return Promise.resolve(undefined);
        }),
        runValidationLoop: () => Promise.resolve(),
    });

    await handler("req", [], /** @type {any} */ (undefined));
    assertEquals(executeCount, 0);
});

Deno.test("agent-handler passes triageMeta through to executePlan", async () => {
    /** @type {Array<unknown[]>} */
    const executeCalls = [];
    const triage = { classification: "FEATURE", complexity: "MEDIUM", summary: "y", affectedPaths: ["a"] };
    const handler = createAgentHandler("planner", {
        runRootTurn: () => Promise.resolve(/** @type {any} */ ([])),
        readLatestPlanOutcome: () => /** @type {any} */ ({
            outcome: "approved_execute",
            planName: "p",
            triageMeta: triage,
        }),
        executePlan: /** @type {any} */ ((/** @type {unknown[]} */ ...args) => {
            executeCalls.push(args);
            return Promise.resolve(undefined);
        }),
        runValidationLoop: () => Promise.resolve(),
    });

    await handler("req", [], /** @type {any} */ (undefined));
    const executionOptions = /** @type {any} */ (executeCalls[0][0]);
    assertEquals(executionOptions.planName, "p");
    assertEquals(executionOptions.triageMeta, triage);
});

Deno.test("agent-handler uses empty triageMeta when outcome lacks one", async () => {
    /** @type {Array<unknown[]>} */
    const executeCalls = [];
    const handler = createAgentHandler("planner", {
        runRootTurn: () => Promise.resolve(/** @type {any} */ ([])),
        readLatestPlanOutcome: () => /** @type {any} */ ({ outcome: "approved_execute", planName: "p" }),
        executePlan: /** @type {any} */ ((/** @type {unknown[]} */ ...args) => {
            executeCalls.push(args);
            return Promise.resolve(undefined);
        }),
        runValidationLoop: () => Promise.resolve(),
    });

    await handler("req", [], /** @type {any} */ (undefined));
    assertEquals(/** @type {any} */ (executeCalls[0][0]).triageMeta, {});
});

Deno.test("agent-handler records delayed implementation finish before continuation validation", async () => {
    /** @type {unknown} */
    let workflowDuringValidation = null;
    /** @type {string[]} */
    const events = [];
    const hostedSession = makeHostedSession();
    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        executionAgent: "engineer",
        executionMode: "non_git_in_place",
        baselineTree: "baseline-tree",
        projectRoot: Deno.cwd(),
        executionCwd: Deno.cwd(),
        nonGitInPlace: true,
    });

    const handler = createAgentHandler("engineer", {
        hostedSession,
        runRootTurn: () =>
            Promise.resolve(
                /** @type {any} */ ([{
                    role: "toolResult",
                    toolName: "task_completed",
                    details: { outcome: "task_completed" },
                }]),
            ),
        readLatestPlanOutcome: () => null,
        readLatestTaskCompletedOutcome: () => true,
        recordPlanEvent: (/** @type {any} */ args) => {
            events.push(args.event);
            assertEquals(args.currentStatus, "in_progress");
            assertEquals(args.details.triageMeta, { classification: "FEATURE" });
            return Promise.resolve(/** @type {any} */ ({}));
        },
        runValidationLoop: () => {
            events.push("validation_started");
            workflowDuringValidation = hostedSession.getActiveExecutionWorkflow();
            hostedSession.clearActiveExecutionWorkflow();
            return Promise.resolve();
        },
    });

    await handler("continue", [], /** @type {any} */ (undefined));

    assertEquals(workflowDuringValidation, {
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        executionAgent: "engineer",
        executionMode: "non_git_in_place",
        baselineTree: "baseline-tree",
        projectRoot: Deno.cwd(),
        executionCwd: Deno.cwd(),
        nonGitInPlace: true,
    });
    assertEquals(events, ["implementation_finished", "validation_started"]);
});

Deno.test("agent-handler preserves workflow and skips validation when delayed checkpoint fails", async () => {
    let validationCount = 0;
    const hostedSession = makeHostedSession();
    /** @type {import('./hosted-session.js').ActiveExecutionWorkflow} */
    const workflow = {
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        executionAgent: "engineer",
        executionMode: "worktree",
        projectRoot: Deno.cwd(),
        executionCwd: "/worktree",
        worktreeId: "wt-1",
        worktreeBranch: "runwield/worktree/p-wt-1",
    };
    hostedSession.setActiveExecutionWorkflow(workflow);

    const handler = createAgentHandler("engineer", {
        hostedSession,
        runRootTurn: () =>
            Promise.resolve(
                /** @type {any} */ ([{
                    role: "toolResult",
                    toolName: "task_completed",
                    details: { outcome: "task_completed" },
                }]),
            ),
        readLatestPlanOutcome: () => null,
        readLatestTaskCompletedOutcome: () => true,
        finalizePlanImplementation: () => Promise.reject(new Error("checkpoint rejected")),
        runValidationLoop: () => {
            validationCount++;
            return Promise.resolve();
        },
    });

    await handler("continue", [], /** @type {any} */ (undefined));

    assertEquals(validationCount, 0);
    assertEquals(hostedSession.getActiveExecutionWorkflow(), workflow);
});

Deno.test("agent-handler resumes validation continuation without recording implementation_finished again", async () => {
    /** @type {unknown} */
    let workflowDuringValidation = null;
    let recordCount = 0;
    const hostedSession = makeHostedSession();
    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        executionAgent: "engineer",
        baselineTree: "baseline-tree",
        validationContinuation: true,
    });

    const handler = createAgentHandler("engineer", {
        hostedSession,
        runRootTurn: () =>
            Promise.resolve(
                /** @type {any} */ ([{
                    role: "toolResult",
                    toolName: "task_completed",
                    details: { outcome: "task_completed" },
                }]),
            ),
        readLatestPlanOutcome: () => null,
        readLatestTaskCompletedOutcome: () => true,
        recordPlanEvent: () => {
            recordCount++;
            return Promise.resolve(/** @type {any} */ ({}));
        },
        runValidationLoop: () => {
            workflowDuringValidation = hostedSession.getActiveExecutionWorkflow();
            hostedSession.clearActiveExecutionWorkflow();
            return Promise.resolve();
        },
    });

    await handler("continue", [], /** @type {any} */ (undefined));

    assertEquals(recordCount, 0);
    assertEquals(workflowDuringValidation, {
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        executionAgent: "engineer",
        baselineTree: "baseline-tree",
        validationContinuation: true,
    });
});

Deno.test("agent-handler ignores stale task_completed outcomes from earlier root turns", async () => {
    let validationCount = 0;
    let recordCount = 0;
    const staleCompletion = {
        role: "toolResult",
        toolName: "task_completed",
        details: { outcome: "task_completed" },
    };
    const hostedSession = makeHostedSession();
    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        executionAgent: "engineer",
        baselineTree: "baseline-tree",
    });
    hostedSession.setRootAgentName("engineer");
    hostedSession.setRootAgentSession(
        /** @type {any} */ ({
            agent: { state: { messages: [staleCompletion] } },
        }),
    );

    const handler = createAgentHandler("engineer", {
        hostedSession,
        runRootTurn: () =>
            Promise.resolve(
                /** @type {any} */ ([
                    staleCompletion,
                    { role: "assistant", content: [{ type: "text", text: "Still working." }] },
                ]),
            ),
        readLatestTriageOutcome: () => null,
        readLatestPlanOutcome: () => null,
        recordPlanEvent: () => {
            recordCount++;
            return Promise.resolve(/** @type {any} */ ({}));
        },
        runValidationLoop: () => {
            validationCount++;
            return Promise.resolve();
        },
    });

    try {
        await handler("continue", [], /** @type {any} */ (undefined));

        assertEquals(recordCount, 0);
        assertEquals(validationCount, 0);
        assertEquals(hostedSession.getActiveExecutionWorkflow(), {
            planName: "p",
            triageMeta: { classification: "FEATURE" },
            executionAgent: "engineer",
            baselineTree: "baseline-tree",
        });
    } finally {
        hostedSession.setRootAgentName(null);
        hostedSession.setRootAgentSession(null);
        hostedSession.clearActiveExecutionWorkflow();
    }
});

Deno.test("agent-handler validates task_completed against hosted workflow", async () => {
    /** @type {unknown} */
    let validationWorkflow = null;
    const hostedSession = makeHostedSession();
    hostedSession.setActiveExecutionWorkflow({
        planName: "hosted-plan",
        triageMeta: { classification: "FEATURE" },
        executionAgent: "engineer",
        executionMode: "non_git_in_place",
        baselineTree: "hosted-tree",
        projectRoot: Deno.cwd(),
        executionCwd: Deno.cwd(),
        nonGitInPlace: true,
    });
    const handler = createAgentHandler("engineer", {
        hostedSession,
        runRootTurn: () =>
            Promise.resolve(
                /** @type {any} */ ([{
                    role: "toolResult",
                    toolName: "task_completed",
                    details: { outcome: "task_completed" },
                }]),
            ),
        readLatestPlanOutcome: () => null,
        readLatestTaskCompletedOutcome: () => true,
        recordPlanEvent: () => Promise.resolve(/** @type {any} */ ({})),
        runValidationLoop: (/** @type {{ hostedSession: HostedSession }} */ args) => {
            validationWorkflow = args.hostedSession.getActiveExecutionWorkflow();
            args.hostedSession.clearActiveExecutionWorkflow();
            return Promise.resolve();
        },
    });

    try {
        await handler("continue", [], /** @type {any} */ (undefined));

        assertEquals(validationWorkflow, {
            planName: "hosted-plan",
            triageMeta: { classification: "FEATURE" },
            executionAgent: "engineer",
            executionMode: "non_git_in_place",
            baselineTree: "hosted-tree",
            projectRoot: Deno.cwd(),
            executionCwd: Deno.cwd(),
            nonGitInPlace: true,
        });
    } finally {
        hostedSession.clearActiveExecutionWorkflow();
    }
});

Deno.test("agent-handler resumes QUICK_FIX mechanical validation after repair task_completed", async () => {
    let mechanicalValidationCount = 0;
    const hostedSession = makeHostedSession();
    hostedSession.setActiveExecutionWorkflow({
        planName: "quick-fix",
        triageMeta: { classification: "QUICK_FIX" },
        executionAgent: "engineer",
        executionCwd: "/quick-fix-repair",
        validationContinuation: true,
        manualQaName: "settings-fix",
        manualQaContext: "Fix and verify the settings save action.",
    });

    const handler = createAgentHandler("engineer", {
        hostedSession,
        runRootTurn: () =>
            Promise.resolve(
                /** @type {any} */ ([{
                    role: "toolResult",
                    toolName: "task_completed",
                    details: { outcome: "task_completed" },
                }]),
            ),
        readLatestPlanOutcome: () => null,
        readLatestTaskCompletedOutcome: () => true,
        runMechanicalValidation: (/** @type {any} */ args) => {
            mechanicalValidationCount++;
            assertEquals(args.cwd, "/quick-fix-repair");
            assertEquals(args.hostedSession, hostedSession);
            assertEquals(args.manualQaName, "settings-fix");
            assertEquals(args.manualQaContext, "Fix and verify the settings save action.");
            assertEquals(hostedSession.getActiveExecutionWorkflow(), null);
            return Promise.resolve({ passed: true, attempts: 0 });
        },
        runValidationLoop: () => {
            throw new Error("plan validation should not run for quick-fix mechanical continuation");
        },
    });

    await handler("answer", [], /** @type {any} */ (undefined));

    assertEquals(mechanicalValidationCount, 1);
    assertEquals(hostedSession.getActiveExecutionWorkflow(), null);
});

Deno.test("agent-handler ignores operator task_completed while an Engineer workflow is active", async () => {
    let mechanicalValidationCount = 0;
    let planValidationCount = 0;
    let attentionRequests = 0;
    const hostedSession = makeHostedSession();
    hostedSession.setActiveExecutionWorkflow({
        planName: "quick-fix",
        triageMeta: { classification: "QUICK_FIX" },
        executionAgent: "engineer",
        executionCwd: "/quick-fix-repair",
        validationContinuation: true,
    });

    const handler = createAgentHandler("operator", {
        hostedSession,
        runRootTurn: () =>
            Promise.resolve(
                /** @type {any} */ ([{
                    role: "toolResult",
                    toolName: "task_completed",
                    details: { outcome: "task_completed" },
                }]),
            ),
        readLatestPlanOutcome: () => null,
        readLatestTaskCompletedOutcome: () => true,
        runMechanicalValidation: () => {
            mechanicalValidationCount++;
            return Promise.resolve({ passed: true, attempts: 0 });
        },
        runValidationLoop: () => {
            planValidationCount++;
            return Promise.resolve();
        },
        requestAttention: () => {
            attentionRequests++;
        },
    });

    await handler("commit", [], /** @type {any} */ (undefined));

    assertEquals(mechanicalValidationCount, 0);
    assertEquals(planValidationCount, 0);
    assertEquals(attentionRequests, 1);
    assertEquals(hostedSession.getActiveExecutionWorkflow(), {
        planName: "quick-fix",
        triageMeta: { classification: "QUICK_FIX" },
        executionAgent: "engineer",
        executionCwd: "/quick-fix-repair",
        validationContinuation: true,
    });
});

Deno.test("agent-handler requests attention when an ordinary turn returns control to the user", async () => {
    /** @type {Array<{ sessionId: string, reason: string, agentName: string }>} */
    const attentions = [];
    const handler = createAgentHandler("planner", {
        runRootTurn: () => Promise.resolve(/** @type {any} */ ([])),
        readLatestTriageOutcome: () => null,
        readLatestPlanOutcome: () => null,
        readLatestTaskCompletedOutcome: () => false,
        requestAttention: (
            /** @type {HostedSession} */ hostedSession,
            /** @type {string} */ reason,
            /** @type {string} */ agentName,
        ) => {
            attentions.push({ sessionId: hostedSession.id, reason, agentName });
        },
    });

    await handler(
        "answer",
        [],
        /** @type {any} */ ({ getSessionName: () => "ordinary session" }),
    );

    assertEquals(attentions.length, 1);
    assertEquals(attentions[0].reason, "agentStopped");
    assertEquals(attentions[0].agentName, "planner");
});

Deno.test("agent-handler does not request agent-stopped attention before triage dispatch", async () => {
    let attentionCount = 0;
    const handler = createAgentHandler("router", {
        runRootTurn: () => Promise.resolve(/** @type {any} */ ([])),
        readLatestTriageOutcome: () => /** @type {any} */ ({ routingIntent: "INQUIRY" }),
        dispatchPostTriage: () => Promise.resolve(),
        readLatestPlanOutcome: () => {
            throw new Error("triage should short-circuit");
        },
        requestAttention: () => {
            attentionCount++;
        },
    });

    await handler("route", [], /** @type {any} */ ({}));

    assertEquals(attentionCount, 0);
});

Deno.test("agent-handler requests attention after validation completes", async () => {
    /** @type {string[]} */
    const events = [];
    const hostedSession = makeHostedSession();
    hostedSession.setActiveExecutionWorkflow({
        planName: "quick-fix",
        triageMeta: { classification: "FEATURE" },
        executionAgent: "engineer",
        baselineTree: "baseline-tree",
    });
    const handler = createAgentHandler("engineer", {
        hostedSession,
        runRootTurn: () =>
            Promise.resolve(
                /** @type {any} */ ([{
                    role: "toolResult",
                    toolName: "task_completed",
                    details: { outcome: "task_completed" },
                }]),
            ),
        readLatestPlanOutcome: () => null,
        readLatestTaskCompletedOutcome: () => true,
        runValidationLoop: () => {
            events.push("validation");
            return Promise.resolve();
        },
        requestAttention: () => {
            events.push("attention");
        },
    });

    await handler("done", [], /** @type {any} */ (undefined));

    assertEquals(events, ["validation", "attention"]);
});

Deno.test("agent-handler does not request agent-stopped attention after plan_written saved outcome", async () => {
    let attentionCount = 0;
    const handler = createAgentHandler("planner", {
        runRootTurn: () =>
            Promise.resolve(
                /** @type {any} */ ([{
                    role: "toolResult",
                    toolName: "plan_written",
                    details: { outcome: "saved", planName: "p" },
                }]),
            ),
        readLatestTriageOutcome: () => null,
        readLatestPlanOutcome: (/** @type {any} */ msgs) => /** @type {any} */ (msgs[0]).details,
        readLatestTaskCompletedOutcome: () => false,
        requestAttention: () => {
            attentionCount++;
        },
    });

    await handler("plan", [], /** @type {any} */ (undefined));

    assertEquals(attentionCount, 0);
});
