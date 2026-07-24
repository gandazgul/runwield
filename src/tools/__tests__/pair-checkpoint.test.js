import { assertEquals, assertStringIncludes } from "@std/assert";
import { HostedSession } from "../../shared/session/hosted-session.js";
import { RuntimeEventTypes } from "../../shared/session/session-runtime-events.js";
import { createPairCheckpointTool } from "../pair-checkpoint.js";

/**
 * @param {import('../../shared/session/session-runtime-interactions.js').RuntimeInteractionResponse[]} responses
 * @param {Array<Record<string, unknown>>} [events]
 * @param {boolean} [supportsPairCheckpoint]
 */
function makePairSession(responses, events = [], supportsPairCheckpoint = true) {
    const session = new HostedSession({
        id: `pair-checkpoint-${crypto.randomUUID()}`,
        cwd: Deno.cwd(),
        interactionAdapter: {
            supportsInteraction: (type) => supportsPairCheckpoint && type === "pair_checkpoint",
            requestInteraction: () => responses.shift() || { outcome: "unsupported" },
        },
    });
    session.setEventSink({
        emit: (/** @type {unknown} */ event) => events.push(/** @type {Record<string, unknown>} */ (event)),
    });
    session.setActiveExecutionWorkflow({
        planName: "visual-plan",
        triageMeta: { classification: "FEATURE" },
        executionAgent: "frontend-engineer",
        collaborationStyle: "pair",
        collaborationRecommendation: "pair",
        pairCheckpointCount: 0,
        projectRoot: Deno.cwd(),
        executionCwd: Deno.cwd(),
    });
    return session;
}

const checkpointParams = {
    summary: "Rendered settings form",
    route: "/settings",
    state: "populated form",
    viewport: "1280x800",
    evidence: ["settings form visible"],
    diagnostics: "No console or network errors",
    nextIncrement: "Polish validation states",
};

/**
 * @param {ReturnType<typeof createPairCheckpointTool>} tool
 * @param {string} id
 */
function executeCheckpoint(tool, id) {
    return /** @type {any} */ (tool.execute)(id, checkpointParams, undefined, undefined, {});
}

Deno.test("pair_checkpoint schema requires only an increment summary", () => {
    const session = makePairSession([]);
    const tool = createPairCheckpointTool({ hostedSession: session });

    assertEquals(tool.parameters.required, ["summary"]);
    assertEquals(tool.parameters.additionalProperties, false);
    assertEquals(tool.parameters.properties.nextIncrement.type, "string");
});

Deno.test("pair_checkpoint continues and revises in one active workflow", async () => {
    const events = /** @type {Array<Record<string, unknown>>} */ ([]);
    const session = makePairSession([
        { outcome: "selected", value: "continue" },
        { outcome: "selected", value: "revise", _meta: { feedback: "Tighten the spacing" } },
    ], events);
    const tool = createPairCheckpointTool({ hostedSession: session });

    const continued = await executeCheckpoint(tool, "checkpoint-1");
    const revised = await executeCheckpoint(tool, "checkpoint-2");

    assertEquals(continued.details, { decision: "continue", checkpointNumber: 1 });
    assertEquals(continued.terminate, false);
    assertEquals(revised.details, {
        decision: "revise",
        feedback: "Tighten the spacing",
        checkpointNumber: 2,
    });
    assertStringIncludes(/** @type {any} */ (revised.content[0]).text, "Tighten the spacing");
    assertEquals(session.getActiveExecutionWorkflow()?.pairCheckpointCount, 2);
    assertEquals(session.getActiveExecutionWorkflow()?.collaborationStyle, "pair");
    assertEquals(
        events.map((event) => event.type),
        [
            RuntimeEventTypes.INTERACTION_REQUESTED,
            RuntimeEventTypes.INTERACTION_RESOLVED,
            RuntimeEventTypes.INTERACTION_REQUESTED,
            RuntimeEventTypes.INTERACTION_RESOLVED,
        ],
    );
});

Deno.test("pair_checkpoint switches the active workflow to autonomous", async () => {
    const session = makePairSession([{ outcome: "selected", value: "autonomous" }]);
    const tool = createPairCheckpointTool({ hostedSession: session });

    const switched = await executeCheckpoint(tool, "checkpoint-1");
    const inactive = await executeCheckpoint(tool, "checkpoint-2");

    assertEquals(switched.details, { decision: "switch_to_autonomous", checkpointNumber: 1 });
    assertEquals(session.getActiveExecutionWorkflow()?.collaborationStyle, "autonomous");
    assertEquals(session.getActiveExecutionWorkflow()?.pairSwitchedToAutonomous, true);
    assertEquals(inactive.details, { decision: "inactive", reason: "pair_execution_inactive" });
    assertEquals(session.getActiveExecutionWorkflow()?.pairCheckpointCount, 1);
});

Deno.test("pair_checkpoint keeps explicit stop distinct from cancellation", async () => {
    const stoppedSession = makePairSession([{ outcome: "selected", value: "stop" }]);
    const canceledSession = makePairSession([{ outcome: "canceled" }]);

    const stopped = await executeCheckpoint(
        createPairCheckpointTool({ hostedSession: stoppedSession }),
        "checkpoint-stop",
    );
    const canceled = await executeCheckpoint(
        createPairCheckpointTool({ hostedSession: canceledSession }),
        "checkpoint-cancel",
    );

    assertEquals(stopped.details, { decision: "stop", checkpointNumber: 1 });
    assertEquals(stopped.terminate, true);
    assertEquals(stoppedSession.getActiveExecutionWorkflow()?.pairPauseReason, "stop");
    assertEquals(canceled.details, {
        decision: "canceled",
        checkpointNumber: 1,
        reason: "checkpoint_interaction_canceled",
    });
    assertEquals(canceled.terminate, true);
    assertEquals(canceledSession.getActiveExecutionWorkflow()?.pairPauseReason, "canceled");
    assertEquals(canceledSession.getActiveExecutionWorkflow()?.collaborationStyle, "pair");
});

Deno.test("pair_checkpoint does not clear an existing Pair pause", async () => {
    const session = makePairSession([{ outcome: "selected", value: "continue" }]);
    const workflow = session.getActiveExecutionWorkflow();
    if (!workflow) throw new Error("expected active workflow");
    session.setActiveExecutionWorkflow({
        ...workflow,
        pairCheckpointCount: 1,
        pairPauseReason: "stop",
        pairStopRequested: true,
    });

    const result = await executeCheckpoint(
        createPairCheckpointTool({ hostedSession: session }),
        "checkpoint-paused",
    );

    assertEquals(result.details, { decision: "inactive", reason: "pair_execution_paused" });
    assertEquals(result.terminate, true);
    assertEquals(session.getActiveExecutionWorkflow()?.pairCheckpointCount, 1);
    assertEquals(session.getActiveExecutionWorkflow()?.pairPauseReason, "stop");
    assertEquals(session.getActiveExecutionWorkflow()?.pairStopRequested, true);
});

for (const outcome of /** @type {Array<"unsupported"|"blocked">} */ (["unsupported", "blocked"])) {
    Deno.test(`pair_checkpoint falls back to autonomous when interaction is ${outcome}`, async () => {
        const session = makePairSession([{ outcome }]);
        const result = await executeCheckpoint(
            createPairCheckpointTool({ hostedSession: session }),
            "checkpoint-capability",
        );

        assertEquals(result.details, {
            decision: "switch_to_autonomous",
            checkpointNumber: 1,
            reason: "pair_capability_lost",
        });
        assertEquals(session.getActiveExecutionWorkflow()?.collaborationStyle, "autonomous");
        assertEquals(session.getActiveExecutionWorkflow()?.pairCapabilityLost, true);
        assertStringIncludes(
            /** @type {any} */ (result.content[0]).text,
            "do not treat this increment as user-approved",
        );
    });
}

Deno.test("pair_checkpoint re-checks explicit adapter capability before prompting", async () => {
    const events = /** @type {Array<Record<string, unknown>>} */ ([]);
    const session = makePairSession([{ outcome: "selected", value: "continue" }], events, false);
    const result = await executeCheckpoint(
        createPairCheckpointTool({ hostedSession: session }),
        "checkpoint-capability-loss",
    );

    assertEquals(result.details, {
        decision: "switch_to_autonomous",
        checkpointNumber: 1,
        reason: "pair_capability_lost",
    });
    assertEquals(session.getActiveExecutionWorkflow()?.collaborationStyle, "autonomous");
    assertEquals(session.getActiveExecutionWorkflow()?.pairCapabilityLost, true);
    assertEquals(session.getActiveExecutionWorkflow()?.pairCheckpointCount, 1);
    assertEquals(events.map((event) => event.type), []);
});

Deno.test("pair_checkpoint requires non-empty revision feedback", async () => {
    const session = makePairSession([{ outcome: "selected", value: "revise", _meta: { feedback: "  " } }]);
    const result = await executeCheckpoint(
        createPairCheckpointTool({ hostedSession: session }),
        "checkpoint-revise",
    );

    assertEquals(result.details, {
        decision: "canceled",
        checkpointNumber: 1,
        reason: "revision_feedback_required",
    });
    assertEquals(session.getActiveExecutionWorkflow()?.pairPauseReason, "canceled");
});

Deno.test("pair_checkpoint records content-free decision metrics with cwd", async () => {
    const metrics = /** @type {any[]} */ ([]);
    const session = makePairSession([
        { outcome: "selected", value: "continue" },
        { outcome: "selected", value: "revise", _meta: { feedback: "Use the private screenshot path /tmp/shot.png" } },
        { outcome: "selected", value: "autonomous" },
    ]);
    const tool = createPairCheckpointTool({
        hostedSession: session,
        recordWorkflowMetric: (metric, deps) => {
            metrics.push({ metric, deps });
            return Promise.resolve(/** @type {any} */ (null));
        },
    });

    await executeCheckpoint(tool, "metric-continue");
    await executeCheckpoint(tool, "metric-revise");
    await executeCheckpoint(tool, "metric-switch");

    assertEquals(metrics.map((entry) => entry.deps), [{ cwd: Deno.cwd() }, { cwd: Deno.cwd() }, { cwd: Deno.cwd() }]);
    assertEquals(metrics.map((entry) => entry.metric), [
        {
            category: "execution",
            event: "pair_checkpoint_decided",
            details: { checkpointNumber: 1, decision: "continue", reason: undefined },
        },
        {
            category: "execution",
            event: "pair_checkpoint_decided",
            details: { checkpointNumber: 2, decision: "revise", reason: undefined },
        },
        {
            category: "execution",
            event: "pair_checkpoint_decided",
            details: { checkpointNumber: 3, decision: "switch_to_autonomous", reason: undefined },
        },
    ]);
    const serialized = JSON.stringify(metrics);
    assertEquals(serialized.includes("private screenshot"), false);
    assertEquals(serialized.includes("/settings"), false);
    assertEquals(serialized.includes("No console"), false);
});

Deno.test("pair_checkpoint records normalized cancellation and capability reasons", async () => {
    const metrics = /** @type {any[]} */ ([]);
    const recordWorkflowMetric = (/** @type {any} */ metric, /** @type {any} */ deps) => {
        metrics.push({ metric, deps });
        return Promise.resolve(/** @type {any} */ (null));
    };

    await executeCheckpoint(
        createPairCheckpointTool({
            hostedSession: makePairSession([{ outcome: "canceled" }]),
            recordWorkflowMetric,
        }),
        "metric-canceled",
    );
    await executeCheckpoint(
        createPairCheckpointTool({
            hostedSession: makePairSession([{ outcome: "selected", value: "revise", _meta: { feedback: " " } }]),
            recordWorkflowMetric,
        }),
        "metric-missing-feedback",
    );
    await executeCheckpoint(
        createPairCheckpointTool({
            hostedSession: makePairSession([{ outcome: "blocked" }]),
            recordWorkflowMetric,
        }),
        "metric-blocked",
    );
    await executeCheckpoint(
        createPairCheckpointTool({
            hostedSession: makePairSession([{ outcome: "selected", value: "surprise" }]),
            recordWorkflowMetric,
        }),
        "metric-invalid",
    );

    assertEquals(metrics.map((entry) => entry.metric.details), [
        { checkpointNumber: 1, decision: "canceled", reason: "checkpoint_interaction_canceled" },
        { checkpointNumber: 1, decision: "canceled", reason: "revision_feedback_required" },
        { checkpointNumber: 1, decision: "switch_to_autonomous", reason: "pair_capability_lost" },
        { checkpointNumber: 1, decision: "switch_to_autonomous", reason: "invalid_checkpoint_response" },
    ]);
});
