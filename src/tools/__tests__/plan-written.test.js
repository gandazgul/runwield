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
        ensureSlicerTasks: () => Promise.resolve({ ok: true, slicerInvoked: false }),
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

Deno.test("PROJECT Epic records decomposition readiness without invoking slicer or execution prompt", async () => {
    let slicerCalled = false;
    let approvalWithTasksCalled = false;
    /** @type {Array<{ planName: string, event: string, currentStatus: string }>} */
    const events = [];
    const result = await runTool(
        { planName: "p" },
        {
            triageMeta: { classification: "PROJECT", type: "epic", complexity: "LOW", summary: "x", affectedPaths: [] },
            __deps: makeDeps({
                ensureSlicerTasks: () => {
                    slicerCalled = true;
                    return Promise.resolve({ ok: true, slicerInvoked: false });
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
    assertEquals(approvalWithTasksCalled, false);
    assertEquals(events, [{ planName: "p", event: "epic_readiness_passed", currentStatus: "approved" }]);
    assertEquals(result.details.outcome, "saved");
    assertEquals(result.terminate, true);
    assertStringIncludes(result.content[0]?.text ?? "", "not directly executable");
});

// ── Legacy PROJECT slicer integration ────────────────────────────

Deno.test("PROJECT plan invokes ensureSlicerTasks and records readiness on success", async () => {
    let slicerCalled = false;
    /** @type {Array<{ planName: string, event: string, currentStatus: string }>} */
    const events = [];
    const result = await runTool(
        { planName: "p" },
        {
            triageMeta: { classification: "PROJECT", complexity: "LOW", summary: "x", affectedPaths: [] },
            __deps: makeDeps({
                ensureSlicerTasks: () => {
                    slicerCalled = true;
                    return Promise.resolve({ ok: true, slicerInvoked: true });
                },
                recordPlanEvent: ({ planName, event, currentStatus }) => {
                    events.push({ planName, event, currentStatus });
                    return Promise.resolve(/** @type {any} */ ({}));
                },
            }),
        },
    );
    assertEquals(slicerCalled, true);
    assertEquals(events, [{ planName: "p", event: "readiness_passed", currentStatus: "approved" }]);
    assertEquals(result.details.outcome, "approved_execute");
});

Deno.test("PROJECT plan returns feedback outcome when slicer fails", async () => {
    let events = 0;
    const result = await runTool(
        { planName: "p" },
        {
            triageMeta: { classification: "PROJECT", complexity: "LOW", summary: "x", affectedPaths: [] },
            __deps: makeDeps({
                ensureSlicerTasks: () => Promise.resolve({ ok: false, error: "model timeout", stage: "slicer" }),
                recordPlanEvent: () => {
                    events++;
                    return Promise.resolve(/** @type {any} */ ({}));
                },
            }),
        },
    );
    assertEquals(result.details.outcome, "feedback");
    assertEquals(result.details.feedback, "model timeout");
    assertStringIncludes(result.content[0]?.text ?? "", "the slicer agent failed");
    // Readiness must NOT be recorded on slicer failure.
    assertEquals(events, 0);
});

Deno.test("PROJECT plan returns feedback outcome when slicer output is unparseable", async () => {
    const result = await runTool(
        { planName: "p" },
        {
            triageMeta: { classification: "PROJECT", complexity: "LOW", summary: "x", affectedPaths: [] },
            __deps: makeDeps({
                ensureSlicerTasks: () => Promise.resolve({ ok: false, error: "malformed table", stage: "validation" }),
            }),
        },
    );
    assertEquals(result.details.outcome, "feedback");
    assertStringIncludes(result.content[0]?.text ?? "", "Tasks table is not parseable");
});

Deno.test("PROJECT plan with already-present tasks skips slicer (slicerInvoked=false)", async () => {
    let slicerCalled = false;
    const result = await runTool(
        { planName: "p" },
        {
            triageMeta: { classification: "PROJECT", complexity: "LOW", summary: "x", affectedPaths: [] },
            __deps: makeDeps({
                ensureSlicerTasks: () => {
                    slicerCalled = true;
                    // ensureSlicerTasks returns ok:true with slicerInvoked:false when tasks exist.
                    return Promise.resolve({ ok: true, slicerInvoked: false });
                },
            }),
        },
    );
    assertEquals(slicerCalled, true);
    assertEquals(result.details.outcome, "approved_execute");
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
    const result = await runTool(
        { planName: "p" },
        {
            triageMeta: { classification: "FEATURE", complexity: "LOW", summary: "x", affectedPaths: [] },
            __deps: makeDeps({
                recordPlanEvent: ({ event }) => {
                    events.push(event);
                    return Promise.resolve(/** @type {any} */ ({}));
                },
            }),
        },
    );
    assertEquals(result.details.outcome, "approved_execute");
    assertEquals(events, ["readiness_passed"]);
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
