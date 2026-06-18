import { assertEquals } from "@std/assert";
import { createAgentHandler } from "./agent-handler.js";
import {
    clearActiveExecutionWorkflow,
    getActiveExecutionWorkflow,
    setActiveExecutionWorkflow,
    setRootAgentName,
} from "./session-state.js";

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
    const uiAPI = /** @type {any} */ ({});
    const sessionManager = /** @type {any} */ ({});
    const images = [{ base64: "abc", mimeType: "image/png" }];
    const handler = createAgentHandler("operator", {
        runAgentSession: () => Promise.resolve(/** @type {any} */ ([])),
        readLatestTriageOutcome: () => triage,
        dispatchPostTriage: (args) => {
            dispatchArgs = args;
            return Promise.resolve();
        },
        readLatestPlanOutcome: () => {
            throw new Error("triage_report should short-circuit later workflow outcomes");
        },
    });

    await handler("classify this", images, uiAPI, sessionManager);

    assertEquals(dispatchArgs, {
        triage,
        userRequest: "classify this",
        images,
        uiAPI,
        sessionManager,
        __deps: {
            createAgentHandler,
        },
    });
});

Deno.test("agent-handler passes agent definition overrides and custom tools to root turns", async () => {
    /** @type {any} */
    let captured = null;
    const customTools = [
        /** @type {any} */ ({ name: "slicer_write_feature_drafts" }),
        /** @type {any} */ ({ name: "slicer_finalize_decomposition" }),
    ];
    const agentDef = /** @type {any} */ ({ displayName: "Slicer" });
    const handler = createAgentHandler("slicer", {
        _agentDefOverride: agentDef,
        customTools,
        allowReturnToRouter: false,
        runRootTurn: (opts) => {
            captured = opts;
            return Promise.resolve([]);
        },
        readLatestTriageOutcome: () => null,
        readLatestPlanOutcome: () => null,
        readLatestTaskCompletedOutcome: () => false,
    });

    setRootAgentName("slicer");
    try {
        await handler("write the drafts", [], /** @type {any} */ ({}), /** @type {any} */ ({ id: "root-session" }));
    } finally {
        setRootAgentName(null);
    }

    assertEquals(captured.agentName, "slicer");
    assertEquals(captured.allowReturnToRouter, false);
    assertEquals(captured._agentDefOverride, agentDef);
    assertEquals(captured.customTools, customTools);
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
                    },
                }]),
            ),
        readLatestPlanOutcome: (msgs) => /** @type {any} */ (msgs[0]).details,
        executePlan: /** @type {any} */ ((/** @type {unknown[]} */ ...args) => {
            executeCalls.push(args);
            return Promise.resolve(undefined);
        }),
        runValidationLoop: () => Promise.resolve(),
    });

    await handler("the request", [], /** @type {any} */ (undefined), /** @type {any} */ (undefined));
    assertEquals(executeCalls.length, 1);
    assertEquals(executeCalls[0][0], "my-plan");
});

Deno.test("agent-handler validates after approved_execute only when execution completed", async () => {
    let validationCount = 0;
    /** @type {string | undefined} */
    let finalAgentName;
    const handler = createAgentHandler("planner", {
        runAgentSession: () => Promise.resolve(/** @type {any} */ ([])),
        readLatestPlanOutcome: () => /** @type {any} */ ({ outcome: "approved_execute", planName: "p" }),
        executePlan: /** @type {any} */ (() => Promise.resolve({ repairRequired: false, executionComplete: true })),
        runValidationLoop: (args) => {
            validationCount++;
            finalAgentName = /** @type {any} */ (args).finalAgentName;
            return Promise.resolve();
        },
    });

    await handler("req", [], /** @type {any} */ (undefined), /** @type {any} */ (undefined));
    assertEquals(validationCount, 1);
    assertEquals(finalAgentName, "planner");
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

    await handler("req", [], /** @type {any} */ (undefined), /** @type {any} */ (undefined));
    assertEquals(validationCount, 0);
});

Deno.test("agent-handler restores invoking agent when approved_execute execution is incomplete", async () => {
    /** @type {string[]} */
    const restoredAgents = [];
    const uiAPI = /** @type {any} */ ({});
    const handler = createAgentHandler("architect", {
        runAgentSession: () => Promise.resolve(/** @type {any} */ ([])),
        readLatestPlanOutcome: () => /** @type {any} */ ({ outcome: "approved_execute", planName: "p" }),
        executePlan: /** @type {any} */ (() => Promise.resolve({ repairRequired: false, executionComplete: false })),
        runValidationLoop: () => {
            throw new Error("should not validate incomplete execution");
        },
        setActiveAgent: (
            /** @type {string} */ name,
            /** @type {unknown} */ _handler,
            /** @type {any} */ actualUiAPI,
        ) => {
            restoredAgents.push(name);
            assertEquals(actualUiAPI, uiAPI);
        },
    });

    await handler("req", [], uiAPI, /** @type {any} */ (undefined));
    assertEquals(restoredAgents, ["architect"]);
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

    await handler("req", [], /** @type {any} */ (undefined), /** @type {any} */ (undefined));
    assertEquals(executeCount, 0);
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

    await handler("req", [], /** @type {any} */ (undefined), /** @type {any} */ (undefined));
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

    await handler("req", [], /** @type {any} */ (undefined), /** @type {any} */ (undefined));
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

    await handler("req", [], /** @type {any} */ (undefined), /** @type {any} */ (undefined));
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

    await handler("req", [], /** @type {any} */ (undefined), /** @type {any} */ (undefined));
    assertEquals(executeCalls[0][0], "p");
    assertEquals(executeCalls[0][1], triage);
    assertEquals(executeCalls[0][3], tasks);
});

Deno.test("agent-handler falls back to empty triageMeta when outcome lacks one", async () => {
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

    await handler("req", [], /** @type {any} */ (undefined), /** @type {any} */ (undefined));
    // Empty object — not undefined — preserves the executePlan signature.
    assertEquals(executeCalls[0][1], {});
});

Deno.test("agent-handler preserves active workflow baseline until continuation validation starts", async () => {
    /** @type {unknown} */
    let workflowDuringValidation = null;
    setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        baselineTree: "baseline-tree",
    });

    const handler = createAgentHandler("engineer", {
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
            workflowDuringValidation = getActiveExecutionWorkflow();
            clearActiveExecutionWorkflow();
            return Promise.resolve();
        },
    });

    await handler("continue", [], /** @type {any} */ ({}), /** @type {any} */ (undefined));

    assertEquals(workflowDuringValidation, {
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        baselineTree: "baseline-tree",
    });
});

Deno.test("agent-handler skips validation and clears workflow marker for QUICK_FIX completion", async () => {
    let validationCount = 0;
    setActiveExecutionWorkflow({
        planName: "quick-fix",
        triageMeta: { classification: "QUICK_FIX" },
        baselineTree: "baseline-tree",
    });

    const handler = createAgentHandler("operator", {
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
            validationCount++;
            return Promise.resolve();
        },
    });

    await handler("answer", [], /** @type {any} */ ({}), /** @type {any} */ (undefined));

    assertEquals(validationCount, 0);
    assertEquals(getActiveExecutionWorkflow(), null);
});
