import { assertEquals, assertStringIncludes } from "@std/assert";
import { HostedSession } from "../../shared/session/hosted-session.js";
import { RuntimeEventTypes } from "../../shared/session/session-runtime-events.js";
import { createTaskCompletedTool } from "../task-completed.js";

Deno.test("task_completed emits one semantic assistant message and terminates", async () => {
    const events = /** @type {any[]} */ ([]);
    const metrics = /** @type {any[]} */ ([]);
    const hostedSession = new HostedSession({ id: "task-completed", cwd: Deno.cwd() });
    hostedSession.setEventSink({ emit: (/** @type {any} */ event) => events.push(event) });
    const tool = createTaskCompletedTool({
        hostedSession,
        agentName: "engineer",
        recordWorkflowMetric: (metric) => {
            metrics.push(metric);
            return Promise.resolve(/** @type {any} */ (null));
        },
    });

    const result = await /** @type {any} */ (tool.execute)("call", { message: "- Implemented and tested." });

    assertEquals(result.terminate, true);
    assertEquals(result.details, { outcome: "task_completed", message: "- Implemented and tested." });
    assertEquals(events.length, 1);
    assertEquals(events[0].type, RuntimeEventTypes.ASSISTANT_TEXT_DELTA);
    assertEquals(events[0].agentName, "engineer");
    assertEquals(events[0].messageKind, "workflow");
    assertEquals(events[0].workflowMessage, "task_completed");
    assertEquals(events[0].delta, "**Task completed.**\n\n- Implemented and tested.");
    assertEquals(metrics[0].event, "task_completed");
});

Deno.test("task_completed rejects a mismatched active workflow owner without side effects", async () => {
    const events = /** @type {any[]} */ ([]);
    const metrics = /** @type {any[]} */ ([]);
    const hostedSession = new HostedSession({ id: "task-completed-wrong-owner", cwd: Deno.cwd() });
    hostedSession.setEventSink({ emit: (/** @type {any} */ event) => events.push(event) });
    hostedSession.setActiveExecutionWorkflow({
        planName: "visual-plan",
        triageMeta: { classification: "FEATURE" },
        executionAgent: "frontend-engineer",
    });
    const tool = createTaskCompletedTool({
        hostedSession,
        agentName: "engineer",
        recordWorkflowMetric: (metric) => {
            metrics.push(metric);
            return Promise.resolve(/** @type {any} */ (null));
        },
    });

    const result = await /** @type {any} */ (tool.execute)("call", { message: "- Done." });

    assertEquals(result.terminate, false);
    assertEquals(result.details, { outcome: "rejected", reason: "wrong_execution_owner" });
    assertEquals(events, []);
    assertEquals(metrics, []);
    assertEquals(hostedSession.getActiveExecutionWorkflow()?.executionAgent, "frontend-engineer");
});

Deno.test("task_completed rejects a provisional workflow before execution starts", async () => {
    const events = /** @type {any[]} */ ([]);
    const metrics = /** @type {any[]} */ ([]);
    const hostedSession = new HostedSession({ id: "task-completed-not-started", cwd: Deno.cwd() });
    hostedSession.setEventSink({ emit: (/** @type {any} */ event) => events.push(event) });
    hostedSession.setActiveExecutionWorkflow({
        planName: "visual-plan",
        triageMeta: { classification: "FEATURE" },
        executionAgent: "frontend-engineer",
        executionStarted: false,
        collaborationStyle: "autonomous",
    });
    const tool = createTaskCompletedTool({
        hostedSession,
        agentName: "Frontend Engineer",
        recordWorkflowMetric: (metric) => {
            metrics.push(metric);
            return Promise.resolve(/** @type {any} */ (null));
        },
    });

    const result = await /** @type {any} */ (tool.execute)("call", { message: "- Done." });

    assertEquals(result.terminate, false);
    assertEquals(result.details, { outcome: "rejected", reason: "execution_not_started" });
    assertEquals(events, []);
    assertEquals(metrics, []);
});

Deno.test("task_completed rejects a paused Pair turn without terminal side effects", async () => {
    const events = /** @type {any[]} */ ([]);
    const metrics = /** @type {any[]} */ ([]);
    const hostedSession = new HostedSession({ id: "task-completed-pair-paused", cwd: Deno.cwd() });
    hostedSession.setEventSink({ emit: (/** @type {any} */ event) => events.push(event) });
    hostedSession.setActiveExecutionWorkflow({
        planName: "visual-plan",
        triageMeta: { classification: "FEATURE" },
        executionAgent: "frontend-engineer",
        collaborationStyle: "pair",
        pairCheckpointCount: 1,
        pairPauseReason: "stop",
    });
    const tool = createTaskCompletedTool({
        hostedSession,
        agentName: "Frontend Engineer",
        recordWorkflowMetric: (metric) => {
            metrics.push(metric);
            return Promise.resolve(/** @type {any} */ (null));
        },
    });

    const result = await /** @type {any} */ (tool.execute)("call", { message: "- Done." });

    assertEquals(result.terminate, false);
    assertEquals(result.details, { outcome: "rejected", reason: "pair_execution_paused" });
    assertEquals(events, []);
    assertEquals(metrics, []);
});

Deno.test("task_completed message schema owns Engineer report format and accepts runtime display name", () => {
    const hostedSession = new HostedSession({ id: "task-completed-schema", cwd: Deno.cwd() });
    const engineerTool = createTaskCompletedTool({ hostedSession, agentName: "Engineer" });
    const frontendEngineerTool = createTaskCompletedTool({ hostedSession, agentName: "Frontend Engineer" });
    const operatorTool = createTaskCompletedTool({ hostedSession, agentName: "operator" });

    assertStringIncludes(
        engineerTool.parameters.properties.message.description,
        "Concise Markdown bullet-point success, failure, or blocked report",
    );
    assertStringIncludes(
        frontendEngineerTool.parameters.properties.message.description,
        "Concise Markdown bullet-point success, failure, or blocked report",
    );
    assertEquals(engineerTool.parameters.required, ["message"]);
    assertEquals(engineerTool.parameters.properties.message.minLength, 1);
    assertEquals(engineerTool.description.includes("Markdown bullet-point"), false);
    assertEquals(operatorTool.parameters.properties.message.description.includes("Markdown bullet-point"), false);
});
