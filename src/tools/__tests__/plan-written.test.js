import { assertEquals, assertMatch, assertStringIncludes } from "@std/assert";
import { createPlanWrittenTool } from "../plan-written.js";

const noopUiAPI = /** @type {any} */ ({ appendSystemMessage: () => {} });

/**
 * @param {{ planName: string }} params
 * @param {any} [opts]
 */
async function runTool(params, opts = {}) {
    const tool = createPlanWrittenTool({ uiAPI: noopUiAPI, ...opts });
    return await /** @type {any} */ (tool.execute)(
        "tool-call-1",
        params,
        new AbortController().signal,
        () => {},
        {},
    );
}

/**
 * Build a default deps object that mocks every external collaborator. Tests
 * override individual fields to exercise specific behaviors.
 *
 * @param {Partial<import("../plan-written.js").PlanWrittenDeps>} [overrides]
 */
function makeDeps(overrides = {}) {
    return {
        cwd: "/tmp/test",
        stat: () => Promise.resolve({ isFile: true }),
        submitPlanForReview: () => Promise.resolve({ approved: true }),
        askApprovalWithTasks: () => Promise.resolve("proceed"),
        askPostApproval: () => Promise.resolve("proceed"),
        askProjectDecompositionApproval: () => Promise.resolve("proceed"),
        ensureSlicerTasks: () => Promise.resolve({ ok: true, slicerInvoked: false }),
        runSlicerAgent: () => Promise.resolve({ ok: true }),
        recordPlanEvent: () => Promise.resolve(/** @type {any} */ ({})),
        ...overrides,
    };
}

Deno.test("createPlanWrittenTool exposes expected metadata", () => {
    const tool = createPlanWrittenTool({ uiAPI: noopUiAPI });
    assertEquals(tool.name, "plan_written");
    assertEquals(tool.label, "Plan Written");
    assertMatch(tool.description, /Declare the plan filename/i);
    assertEquals(typeof tool.execute, "function");
    assertEquals(typeof tool.parameters, "object");
});

Deno.test("createPlanWrittenTool returns guidance when planName is empty", async () => {
    const result = await runTool({ planName: "" });
    assertMatch(result.content[0]?.text ?? "", /planName is empty/);
});

Deno.test("createPlanWrittenTool returns guidance when plan file is missing", async () => {
    const result = await runTool(
        { planName: "definitely-does-not-exist-" + Math.random().toString(36).slice(2) },
        {
            __deps: {
                cwd: "/tmp/test",
                stat: () => Promise.reject(new Error("ENOENT")),
            },
        },
    );
    assertMatch(result.content[0]?.text ?? "", /not found/);
});

Deno.test("returns guidance when plan path exists but is not a file", async () => {
    const result = await runTool(
        { planName: "p" },
        { __deps: makeDeps({ stat: () => Promise.resolve({ isFile: false }) }) },
    );
    assertMatch(result.content[0]?.text ?? "", /is not a file/);
});

// ── Review lifecycle outcomes ────────────────────────────────────

Deno.test("returns canceled outcome when review is canceled", async () => {
    const result = await runTool(
        { planName: "p" },
        {
            __deps: makeDeps({
                submitPlanForReview: () => Promise.resolve({ canceled: true }),
            }),
        },
    );
    assertEquals(result.details.outcome, "canceled");
    assertEquals(result.terminate, true);
});

Deno.test("returns feedback outcome and revision request when user submits feedback", async () => {
    const result = await runTool(
        { planName: "p" },
        {
            __deps: makeDeps({
                submitPlanForReview: () => Promise.resolve({ approved: false, feedback: "rename the foo" }),
            }),
        },
    );
    assertEquals(result.details.outcome, "feedback");
    assertEquals(result.details.feedback, "rename the foo");
    assertStringIncludes(result.content[0]?.text ?? "", "rename the foo");
});

// ── PROJECT readiness ───────────────────────────────────────────

Deno.test("PROJECT Epic asks before opening Slicer and can save ready_for_decomposition for later", async () => {
    let slicerCalled = false;
    let approvalWithTasksCalled = false;
    let decompositionApprovalCalled = false;
    /** @type {Array<{ planName: string, event: string, currentStatus: string }>} */
    const events = [];
    const result = await runTool(
        { planName: "p" },
        {
            triageMeta: { classification: "PROJECT", type: "epic", complexity: "LOW", summary: "x", affectedPaths: [] },
            __deps: makeDeps({
                runSlicerAgent: () => {
                    slicerCalled = true;
                    return Promise.resolve({ ok: true });
                },
                askProjectDecompositionApproval: () => {
                    decompositionApprovalCalled = true;
                    return Promise.resolve("save");
                },
                askApprovalWithTasks: () => {
                    approvalWithTasksCalled = true;
                    return Promise.resolve("proceed");
                },
                recordPlanEvent: ({ planName, event, currentStatus }) => {
                    events.push({ planName, event, currentStatus });
                    return Promise.resolve(/** @type {any} */ ({}));
                },
            }),
        },
    );

    assertEquals(slicerCalled, false);
    assertEquals(decompositionApprovalCalled, true);
    assertEquals(approvalWithTasksCalled, false);
    assertEquals(events, [{ planName: "p", event: "epic_readiness_passed", currentStatus: "approved" }]);
    assertEquals(result.details.outcome, "saved");
    assertEquals(result.terminate, true);
    assertStringIncludes(result.content[0]?.text ?? "", "saved for later decomposition");
});

Deno.test("PROJECT Epic starts Slicer only after decomposition approval", async () => {
    /** @type {string[]} */
    const calls = [];
    const result = await runTool(
        { planName: "p" },
        {
            triageMeta: { classification: "PROJECT", type: "epic", complexity: "LOW", summary: "x", affectedPaths: [] },
            __deps: makeDeps({
                askProjectDecompositionApproval: () => {
                    calls.push("prompt");
                    return Promise.resolve("proceed");
                },
                runSlicerAgent: () => {
                    calls.push("slicer");
                    return Promise.resolve({ ok: true });
                },
            }),
        },
    );

    assertEquals(calls, ["prompt", "slicer"]);
    assertEquals(result.details.outcome, "saved");
    assertStringIncludes(result.content[0]?.text ?? "", "Slicer decomposition started");
});

// ── PROJECT decomposition prompt integration ─────────────────────

Deno.test("PROJECT plan without type is saved as an Epic and asks before opening Slicer", async () => {
    /** @type {string[]} */
    const calls = [];
    /** @type {Array<{ planName: string, event: string, currentStatus: string, type?: string }>} */
    const events = [];
    const result = await runTool(
        { planName: "p" },
        {
            triageMeta: { classification: "PROJECT", complexity: "LOW", summary: "x", affectedPaths: [] },
            __deps: makeDeps({
                askProjectDecompositionApproval: () => {
                    calls.push("prompt");
                    return Promise.resolve("proceed");
                },
                runSlicerAgent: () => {
                    calls.push("slicer");
                    return Promise.resolve({ ok: true });
                },
                recordPlanEvent: ({ planName, event, currentStatus, details }) => {
                    events.push({ planName, event, currentStatus, type: details?.triageMeta?.type });
                    return Promise.resolve(/** @type {any} */ ({}));
                },
            }),
        },
    );
    assertEquals(calls, ["prompt", "slicer"]);
    assertEquals(events, [{ planName: "p", event: "epic_readiness_passed", currentStatus: "approved", type: "epic" }]);
    assertEquals(result.details.outcome, "saved");
    assertEquals(result.details.triageMeta.type, "epic");
});

Deno.test("PROJECT plan saves before invoking Slicer when decomposition is deferred", async () => {
    let slicerCalled = false;
    const result = await runTool(
        { planName: "p" },
        {
            triageMeta: { classification: "PROJECT", complexity: "LOW", summary: "x", affectedPaths: [] },
            __deps: makeDeps({
                askProjectDecompositionApproval: () => Promise.resolve("save"),
                runSlicerAgent: () => {
                    slicerCalled = true;
                    return Promise.resolve({ ok: true });
                },
            }),
        },
    );

    assertEquals(slicerCalled, false);
    assertEquals(result.details.outcome, "saved");
    assertEquals(result.details.triageMeta.type, "epic");
    assertStringIncludes(result.content[0]?.text ?? "", "saved for later decomposition");
});

Deno.test("PROJECT plan returns feedback outcome when Slicer fails to start", async () => {
    let events = 0;
    /** @type {any[]} */
    const metrics = [];
    const result = await runTool(
        { planName: "p" },
        {
            triageMeta: { classification: "PROJECT", complexity: "LOW", summary: "x", affectedPaths: [] },
            __deps: makeDeps({
                runSlicerAgent: () => Promise.resolve({ ok: false, error: "model timeout" }),
                recordPlanEvent: () => {
                    events++;
                    return Promise.resolve(/** @type {any} */ ({}));
                },
                recordWorkflowMetric: (metric) => {
                    metrics.push(metric);
                    return Promise.resolve(null);
                },
            }),
        },
    );
    assertEquals(result.details.outcome, "feedback");
    assertEquals(result.details.feedback, "model timeout");
    assertStringIncludes(result.content[0]?.text ?? "", "the slicer agent failed");
    // It is ready for decomposition, but Slicer did not start successfully.
    assertEquals(events, 1);
    assertEquals(
        metrics.some((metric) =>
            metric.category === "planning" && metric.event === "readiness_outcome" &&
            metric.details.outcome === "repair_required" && metric.details.stage === "slicer"
        ),
        true,
    );
});

Deno.test("PROJECT plan propagates readiness recording failure", async () => {
    let rejected = false;
    try {
        await runTool(
            { planName: "p" },
            {
                triageMeta: { classification: "PROJECT", complexity: "LOW", summary: "x", affectedPaths: [] },
                __deps: makeDeps({
                    recordPlanEvent: () => Promise.reject(new Error("disk full")),
                }),
            },
        );
    } catch {
        rejected = true;
    }
    assertEquals(rejected, true);
});

Deno.test("FEATURE plan records readiness without invoking slicer", async () => {
    /** @type {string[]} */
    const events = [];
    /** @type {any[]} */
    const metrics = [];
    const result = await runTool(
        { planName: "p" },
        {
            triageMeta: { classification: "FEATURE", complexity: "LOW", summary: "x", affectedPaths: [] },
            __deps: makeDeps({
                recordPlanEvent: ({ event }) => {
                    events.push(event);
                    return Promise.resolve(/** @type {any} */ ({}));
                },
                recordWorkflowMetric: (metric) => {
                    metrics.push(metric);
                    return Promise.resolve(null);
                },
            }),
        },
    );
    assertEquals(result.details.outcome, "approved_execute");
    assertEquals(events, ["readiness_passed"]);
    assertEquals(
        metrics.some((metric) =>
            metric.category === "planning" && metric.event === "readiness_outcome" &&
            metric.details.lifecycleEvent === "readiness_passed"
        ),
        true,
    );
});

// ── FEATURE / non-PROJECT path ──────────────────────────────────

Deno.test("FEATURE plan does NOT invoke slicer and uses askPostApproval", async () => {
    let slicerCalled = false;
    let postApprovalCalled = false;
    let approvalWithTasksCalled = false;
    const result = await runTool(
        { planName: "p" },
        {
            triageMeta: { classification: "FEATURE", complexity: "LOW", summary: "x", affectedPaths: [] },
            __deps: makeDeps({
                ensureSlicerTasks: () => {
                    slicerCalled = true;
                    return Promise.resolve({ ok: true, slicerInvoked: false });
                },
                askPostApproval: () => {
                    postApprovalCalled = true;
                    return Promise.resolve("proceed");
                },
                askApprovalWithTasks: () => {
                    approvalWithTasksCalled = true;
                    return Promise.resolve("proceed");
                },
            }),
        },
    );
    assertEquals(slicerCalled, false);
    assertEquals(postApprovalCalled, true);
    assertEquals(approvalWithTasksCalled, false);
    assertEquals(result.details.outcome, "approved_execute");
});

// ── Save vs. proceed ────────────────────────────────────────────

Deno.test("returns saved outcome when user picks save instead of proceed", async () => {
    const result = await runTool(
        { planName: "p" },
        {
            __deps: makeDeps({
                askPostApproval: () => Promise.resolve("save"),
            }),
        },
    );
    assertEquals(result.details.outcome, "saved");
    assertEquals(result.details.planName, "p");
    assertEquals(result.terminate, true);
});

Deno.test("returns approved_execute outcome with planName + triageMeta on proceed", async () => {
    const triage = {
        classification: /** @type {const} */ ("FEATURE"),
        complexity: /** @type {const} */ ("LOW"),
        summary: "x",
        affectedPaths: [],
    };
    const result = await runTool(
        { planName: "p" },
        {
            triageMeta: triage,
            __deps: makeDeps(),
        },
    );
    assertEquals(result.details.outcome, "approved_execute");
    assertEquals(result.details.planName, "p");
    assertEquals(result.details.triageMeta.classification, "FEATURE");
});

Deno.test("strips trailing .md from planName before processing", async () => {
    /** @type {string[]} */
    const seenPlanNames = [];
    await runTool(
        { planName: "my-plan.md" },
        {
            __deps: makeDeps({
                submitPlanForReview: ({ planName }) => {
                    seenPlanNames.push(planName);
                    return Promise.resolve({ approved: true });
                },
            }),
        },
    );
    assertEquals(seenPlanNames, ["my-plan"]);
});
