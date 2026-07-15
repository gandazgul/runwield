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
    return createAgentHandlerFn(agentName, {
        switchActiveAgent: (
            /** @type {unknown} */ _hostedSession,
            /** @type {{ agentName: string }} */ options,
        ) => Promise.resolve({ ok: true, agentName: options.agentName, changed: true }),
        ...deps,
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
        runAgentSession: (/** @type {any} */ opts) => {
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

    assertEquals(runArgs.useRootSession, false);
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
        runAgentSession: () => {
            ranRouter = true;
            return Promise.resolve([]);
        },
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
        runAgentSession: () =>
            Promise.resolve(
                /** @type {any} */ ([{
                    role: "toolResult",
                    toolName: "plan_written",
                    details: {
                        outcome: "approved_execute",
                        planName: "my-plan",
                        triageMeta: { classification: "PROJECT", complexity: "LOW", summary: "x", affectedPaths: [] },
                        tasks: [{ task: 1, assignee: "engineer", dependencies: "none", description: "x" }],
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
    /** @type {any[]} */
    const metrics = [];
    const handler = createAgentHandler("planner", {
        runAgentSession: () => Promise.resolve(/** @type {any} */ ([])),
        readLatestPlanOutcome: () => /** @type {any} */ ({ outcome: "approved_execute", planName: "p" }),
        executePlan: /** @type {any} */ (() => Promise.resolve({ repairRequired: false, executionComplete: true })),
        runValidationLoop: (/** @type {any} */ args) => {
            validationCount++;
            finalAgentName = /** @type {any} */ (args).finalAgentName;
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
        runAgentSession: () => Promise.resolve(/** @type {any} */ ([])),
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

Deno.test("agent-handler keeps Engineer active when approved_execute execution is incomplete", async () => {
    /** @type {string[]} */
    const restoredAgents = [];
    const handler = createAgentHandler("architect", {
        runAgentSession: () => Promise.resolve(/** @type {any} */ ([])),
        readLatestPlanOutcome: () => /** @type {any} */ ({ outcome: "approved_execute", planName: "p" }),
        executePlan: /** @type {any} */ (() => Promise.resolve({ repairRequired: false, executionComplete: false })),
        runValidationLoop: () => {
            throw new Error("should not validate incomplete execution");
        },
        switchActiveAgent: (
            /** @type {unknown} */ _hostedSession,
            /** @type {{ agentName: string }} */ options,
        ) => {
            restoredAgents.push(options.agentName);
            return Promise.resolve({ ok: true, agentName: options.agentName, changed: true });
        },
    });

    await handler("req", [], /** @type {any} */ (undefined));
    assertEquals(restoredAgents, ["engineer"]);
});

Deno.test("agent-handler does NOT call executePlan when outcome is saved", async () => {
    let executeCount = 0;
    const handler = createAgentHandler("planner", {
        runAgentSession: () => Promise.resolve(/** @type {any} */ ([])),
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
        runAgentSession: () => Promise.resolve(/** @type {any} */ ([])),
        readLatestPlanOutcome: () => /** @type {any} */ ({
            outcome: "approved_decompose",
            planName: "epic-a",
            triageMeta: { classification: "PROJECT", type: "epic" },
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
    assertEquals(slicerArgs.triageMeta, { classification: "PROJECT", type: "epic" });
    assertEquals(slicerArgs.reviewFeedback, "Keep the approved boundary.");
    assertEquals(slicerArgs.reviewImages, [{ base64: "YXBwcm92ZWQ=", mimeType: "image/png" }]);
    assertEquals(slicerArgs.sessionManager, sessionManager);
});

Deno.test("agent-handler does NOT call executePlan when outcome is feedback", async () => {
    let executeCount = 0;
    const handler = createAgentHandler("architect", {
        runAgentSession: () => Promise.resolve(/** @type {any} */ ([])),
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
        runAgentSession: () => Promise.resolve(/** @type {any} */ ([])),
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
        runAgentSession: () => Promise.resolve(/** @type {any} */ ([])),
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

Deno.test("agent-handler passes triageMeta and tasks through to executePlan", async () => {
    /** @type {Array<unknown[]>} */
    const executeCalls = [];
    const triage = { classification: "FEATURE", complexity: "MEDIUM", summary: "y", affectedPaths: ["a"] };
    const tasks = [{ task: 1, assignee: "engineer", dependencies: "none", description: "x" }];

    const handler = createAgentHandler("planner", {
        runAgentSession: () => Promise.resolve(/** @type {any} */ ([])),
        readLatestPlanOutcome: () => /** @type {any} */ ({
            outcome: "approved_execute",
            planName: "p",
            triageMeta: triage,
            tasks,
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
    assertEquals(executionOptions.structuredTasks, tasks);
});

Deno.test("agent-handler uses empty triageMeta when outcome lacks one", async () => {
    /** @type {Array<unknown[]>} */
    const executeCalls = [];
    const handler = createAgentHandler("planner", {
        runAgentSession: () => Promise.resolve(/** @type {any} */ ([])),
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
        baselineTree: "baseline-tree",
    });

    const handler = createAgentHandler("engineer", {
        hostedSession,
        runAgentSession: () =>
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
        baselineTree: "baseline-tree",
    });
    assertEquals(events, ["implementation_finished", "validation_started"]);
});

Deno.test("agent-handler resumes validation continuation without recording implementation_finished again", async () => {
    /** @type {unknown} */
    let workflowDuringValidation = null;
    let recordCount = 0;
    const hostedSession = makeHostedSession();
    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        baselineTree: "baseline-tree",
        validationContinuation: true,
    });

    const handler = createAgentHandler("engineer", {
        hostedSession,
        runAgentSession: () =>
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
        baselineTree: "hosted-tree",
    });
    const handler = createAgentHandler("engineer", {
        hostedSession,
        runAgentSession: () =>
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
            baselineTree: "hosted-tree",
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
        executionCwd: "/quick-fix-repair",
        validationContinuation: true,
        manualQaName: "settings-fix",
        manualQaContext: "Fix and verify the settings save action.",
    });

    const handler = createAgentHandler("engineer", {
        hostedSession,
        runAgentSession: () =>
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
        executionCwd: "/quick-fix-repair",
        validationContinuation: true,
    });

    const handler = createAgentHandler("operator", {
        hostedSession,
        runAgentSession: () =>
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
        executionCwd: "/quick-fix-repair",
        validationContinuation: true,
    });
});

Deno.test("agent-handler requests attention when an ordinary turn returns control to the user", async () => {
    /** @type {Array<{ sessionId: string, reason: string, agentName: string }>} */
    const attentions = [];
    const handler = createAgentHandler("planner", {
        runAgentSession: () => Promise.resolve(/** @type {any} */ ([])),
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
        runAgentSession: () => Promise.resolve(/** @type {any} */ ([])),
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
        baselineTree: "baseline-tree",
    });
    const handler = createAgentHandler("engineer", {
        hostedSession,
        runAgentSession: () =>
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
        runAgentSession: () =>
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
