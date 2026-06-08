import { assertEquals } from "@std/assert";
import { createDirectAgentHandler } from "./direct-agent.js";

Deno.test("direct-agent calls executePlan when outcome is approved_execute", async () => {
    /** @type {Array<unknown[]>} */
    const executeCalls = [];
    const handler = createDirectAgentHandler("architect", {
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

Deno.test("direct-agent does NOT call executePlan when outcome is saved", async () => {
    let executeCount = 0;
    const handler = createDirectAgentHandler("planner", {
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

Deno.test("direct-agent does NOT call executePlan when outcome is feedback", async () => {
    let executeCount = 0;
    const handler = createDirectAgentHandler("architect", {
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

Deno.test("direct-agent does NOT call executePlan when no plan_written outcome present", async () => {
    let executeCount = 0;
    const handler = createDirectAgentHandler("operator", {
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

Deno.test("direct-agent does NOT call executePlan when planName missing on approved_execute", async () => {
    // Defensive: even if outcome is approved_execute but planName is absent, don't dispatch.
    let executeCount = 0;
    const handler = createDirectAgentHandler("planner", {
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

Deno.test("direct-agent passes triageMeta and tasks through to executePlan", async () => {
    /** @type {Array<unknown[]>} */
    const executeCalls = [];
    const triage = { classification: "FEATURE", complexity: "MEDIUM", summary: "y", affectedPaths: ["a"] };
    const tasks = [{ task: 1, assignee: "engineer", dependencies: "none", description: "x" }];

    const handler = createDirectAgentHandler("planner", {
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

Deno.test("direct-agent falls back to empty triageMeta when outcome lacks one", async () => {
    /** @type {Array<unknown[]>} */
    const executeCalls = [];
    const handler = createDirectAgentHandler("planner", {
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
