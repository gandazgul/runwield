import { assertEquals, assertMatch, assertStringIncludes } from "@std/assert";
import { createPlanWrittenTool } from "../plan-written.js";
import { HostedSession } from "../../shared/session/hosted-session.js";

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

Deno.test("valid plan declaration records workflow plan name after validation", async () => {
    /** @type {string[]} */
    const recorded = [];
    const hostedSession = new HostedSession({ id: "plan-workflow" });
    hostedSession.setWorkflowPlanName = (planName) => {
        recorded.push(String(planName));
    };

    const result = await runTool(
        { planName: "plans/my-plan.md" },
        {
            hostedSession,
            __deps: makeDeps(),
        },
    );

    assertEquals(recorded, ["my-plan"]);
    assertEquals(result.details.outcome, "approved_execute");
});

Deno.test("valid plan declaration remains fail-open when workflow plan recording throws", async () => {
    const hostedSession = new HostedSession({ id: "plan-workflow-throws" });
    hostedSession.setWorkflowPlanName = () => {
        throw new Error("persistence failed");
    };

    const result = await runTool(
        { planName: "my-plan" },
        {
            hostedSession,
            __deps: makeDeps(),
        },
    );

    assertEquals(result.details.outcome, "approved_execute");
});

Deno.test("invalid plan declaration does not replace workflow plan name", async () => {
    /** @type {string[]} */
    const recorded = [];
    const hostedSession = new HostedSession({ id: "invalid-plan-workflow" });
    hostedSession.setWorkflowPlanName = (planName) => {
        recorded.push(String(planName));
    };

    await runTool(
        { planName: "missing" },
        {
            hostedSession,
            __deps: makeDeps({ stat: () => Promise.reject(new Error("ENOENT")) }),
        },
    );

    assertEquals(recorded, []);
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
    let decompositionApprovalCalled = false;
    /** @type {Array<{ planName: string, event: string, currentStatus: string }>} */
    const events = [];
    const result = await runTool(
        { planName: "p" },
        {
            triageMeta: { classification: "PROJECT", type: "epic", complexity: "LOW", summary: "x", affectedPaths: [] },
            __deps: makeDeps({
                askProjectDecompositionApproval: () => {
                    decompositionApprovalCalled = true;
                    return Promise.resolve("save");
                },
                recordPlanEvent: ({ planName, event, currentStatus }) => {
                    events.push({ planName, event, currentStatus });
                    return Promise.resolve(/** @type {any} */ ({}));
                },
            }),
        },
    );

    assertEquals(decompositionApprovalCalled, true);
    assertEquals(events, [{ planName: "p", event: "epic_readiness_passed", currentStatus: "approved" }]);
    assertEquals(result.details.outcome, "saved");
    assertEquals(result.terminate, true);
    assertStringIncludes(result.content[0]?.text ?? "", "saved for later decomposition");
});

Deno.test("PROJECT Epic returns a post-turn Slicer dispatch outcome after decomposition approval", async () => {
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
            }),
        },
    );

    assertEquals(calls, ["prompt"]);
    assertEquals(result.details.outcome, "approved_decompose");
    assertStringIncludes(result.content[0]?.text ?? "", "approved for Slicer decomposition");
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
                recordPlanEvent: ({ planName, event, currentStatus, details }) => {
                    events.push({ planName, event, currentStatus, type: details?.triageMeta?.type });
                    return Promise.resolve(/** @type {any} */ ({}));
                },
            }),
        },
    );
    assertEquals(calls, ["prompt"]);
    assertEquals(events, [{ planName: "p", event: "epic_readiness_passed", currentStatus: "approved", type: "epic" }]);
    assertEquals(result.details.outcome, "approved_decompose");
    assertEquals(result.details.triageMeta.type, "epic");
});

Deno.test("PROJECT plan saves before invoking Slicer when decomposition is deferred", async () => {
    const result = await runTool(
        { planName: "p" },
        {
            triageMeta: { classification: "PROJECT", complexity: "LOW", summary: "x", affectedPaths: [] },
            __deps: makeDeps({
                askProjectDecompositionApproval: () => Promise.resolve("save"),
            }),
        },
    );

    assertEquals(result.details.outcome, "saved");
    assertEquals(result.details.triageMeta.type, "epic");
    assertStringIncludes(result.content[0]?.text ?? "", "saved for later decomposition");
});

Deno.test("PROJECT plan records decomposition request before the workflow dispatcher starts Slicer", async () => {
    let events = 0;
    /** @type {any[]} */
    const metrics = [];
    const result = await runTool(
        { planName: "p" },
        {
            triageMeta: { classification: "PROJECT", complexity: "LOW", summary: "x", affectedPaths: [] },
            __deps: makeDeps({
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
    assertEquals(result.details.outcome, "approved_decompose");
    assertEquals(events, 1);
    assertEquals(
        metrics.some((metric) =>
            metric.category === "planning" && metric.event === "review_outcome" &&
            metric.details.outcome === "approved_decompose" &&
            metric.details.projectAction === "decomposition_requested"
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
    let postApprovalCalled = false;
    const result = await runTool(
        { planName: "p" },
        {
            triageMeta: { classification: "FEATURE", complexity: "LOW", summary: "x", affectedPaths: [] },
            __deps: makeDeps({
                askPostApproval: () => {
                    postApprovalCalled = true;
                    return Promise.resolve("proceed");
                },
            }),
        },
    );
    assertEquals(postApprovalCalled, true);
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

Deno.test("ACP plan_written shares review link and skips local review lifecycle", async () => {
    const hostedSession = new HostedSession({ id: "acp-plan" });
    hostedSession.setInteractionAdapter(null, { kind: "acp", acpSessionId: "acp-1" });
    /** @type {unknown[]} */
    const emitted = [];
    hostedSession.setEventSink({ emit: (/** @type {unknown} */ event) => emitted.push(event) });
    let localReviewCalled = false;
    let recordCalled = false;

    const result = await runTool(
        { planName: "p" },
        {
            hostedSession,
            triageMeta: { classification: "FEATURE", complexity: "LOW", summary: "x", affectedPaths: [] },
            __deps: makeDeps({
                submitPlanForReview: () => {
                    localReviewCalled = true;
                    return Promise.resolve({ approved: true });
                },
                recordPlanEvent: () => {
                    recordCalled = true;
                    return Promise.resolve(/** @type {any} */ ({}));
                },
                sharePlanForReview: () =>
                    Promise.resolve({
                        planName: "p",
                        planId: "plan-1",
                        reviewerUrl: "https://plans.example/#key=review&cap=reviewer&role=reviewer",
                        maintainerUrl: "https://plans.example/#key=maint&cap=maintainer&role=maintainer",
                        serverUrl: "https://plans.example",
                        spaceId: "space-1",
                        revision: 1,
                        reused: false,
                    }),
            }),
        },
    );

    assertEquals(result.details.outcome, "saved");
    assertEquals(result.details.remoteReview, true);
    assertEquals(result.details.spaceId, "space-1");
    assertEquals(result.terminate, true);
    assertEquals(localReviewCalled, false);
    assertEquals(recordCalled, false);
    assertEquals(/** @type {any} */ (emitted[0]).type, "plan_review_link");
    assertEquals(JSON.stringify(emitted).includes("maintainer"), false);
});
