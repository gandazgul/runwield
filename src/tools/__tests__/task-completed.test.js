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

Deno.test("task_completed description uses planned-change workflow terminology", () => {
    const hostedSession = new HostedSession({ id: "task-completed-description", cwd: Deno.cwd() });
    const tool = createTaskCompletedTool({ hostedSession, agentName: "engineer" });

    assertStringIncludes(tool.description || "", "For PLANNED_CHANGE and PROJECT workflows");
    assertEquals((tool.description || "").includes("For FEATURE and PROJECT workflows"), false);
});

Deno.test("task_completed records accepted completion on hosted session only after ownership checks", async () => {
    const hostedSession = new HostedSession({ id: "task-completed-records-accepted", cwd: Deno.cwd() });
    hostedSession.setActiveExecutionWorkflow({
        planName: "implementation-plan",
        triageMeta: { classification: "PLANNED_CHANGE" },
        executionAgent: "engineer",
    });
    const tool = createTaskCompletedTool({
        hostedSession,
        agentName: "Engineer",
        now: () => 1234,
        recordWorkflowMetric: () => Promise.resolve(/** @type {any} */ (null)),
    });

    const result = await /** @type {any} */ (tool.execute)("call", { message: "- Done." });
    const completion = hostedSession.consumePendingTaskCompletion(null);

    assertEquals(result.details, { outcome: "task_completed", message: "- Done." });
    assertEquals(completion, {
        agentName: "engineer",
        report: "- Done.",
        timestampMs: 1234,
        owningSession: null,
    });
    assertEquals(hostedSession.consumePendingTaskCompletion(null), null);

    hostedSession.setActiveExecutionWorkflow({
        planName: "frontend-plan",
        triageMeta: { classification: "PLANNED_CHANGE" },
        executionAgent: "frontend-engineer",
    });
    const rejectedTool = createTaskCompletedTool({ hostedSession, agentName: "Engineer" });

    const rejected = await /** @type {any} */ (rejectedTool.execute)("call", { message: "- Wrong owner." });

    assertEquals(rejected.details, { outcome: "rejected", reason: "wrong_execution_owner" });
    assertEquals(hostedSession.consumePendingTaskCompletion(null), null);
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
    assertStringIncludes(
        engineerTool.parameters.properties.message.description,
        "directly state each feedback item's disposition",
    );
    assertEquals(engineerTool.parameters.required, ["message"]);
    assertEquals(engineerTool.parameters.properties.message.minLength, 1);
    assertEquals(engineerTool.description.includes("Markdown bullet-point"), false);
    assertEquals(operatorTool.parameters.properties.message.description.includes("Markdown bullet-point"), false);
});

Deno.test("task_completed requires Frontend Engineer preflight outcome only", () => {
    const hostedSession = new HostedSession({ id: "task-completed-preflight-schema", cwd: Deno.cwd() });
    const frontendEngineerTool = createTaskCompletedTool({ hostedSession, agentName: "Frontend Engineer" });
    const engineerTool = createTaskCompletedTool({ hostedSession, agentName: "Engineer" });

    assertEquals(frontendEngineerTool.parameters.required, ["message", "browserPreflightOutcome"]);
    assertEquals(
        frontendEngineerTool.parameters.properties.browserPreflightOutcome.anyOf.map((/** @type {any} */ item) =>
            item.const
        ),
        [
            "succeeded",
            "failed",
            "externally_blocked",
        ],
    );
    assertStringIncludes(
        frontendEngineerTool.parameters.properties.message.description,
        "checkpoint acceptance is not verification evidence",
    );
    assertEquals(engineerTool.parameters.properties.browserPreflightOutcome, undefined);
});

for (const outcome of /** @type {const} */ (["succeeded", "failed", "externally_blocked"])) {
    Deno.test(`task_completed records Frontend Engineer completion preflight outcome ${outcome}`, async () => {
        const metrics = /** @type {any[]} */ ([]);
        const hostedSession = new HostedSession({ id: `task-completed-${outcome}`, cwd: Deno.cwd() });
        hostedSession.setActiveExecutionWorkflow({
            planName: "visual-plan",
            triageMeta: { classification: "FEATURE" },
            executionAgent: "frontend-engineer",
            executionStarted: true,
            executionAttemptStartedAtMs: 1000,
            collaborationStyle: "pair",
            pairCheckpointCount: 2,
            pairSwitchedToAutonomous: true,
            pairCapabilityLost: false,
        });
        const tool = createTaskCompletedTool({
            hostedSession,
            agentName: "Frontend Engineer",
            now: () => 1750,
            recordWorkflowMetric: (metric, deps) => {
                metrics.push({ metric, deps });
                return Promise.resolve(/** @type {any} */ (null));
            },
        });

        const result = await /** @type {any} */ (tool.execute)("call", {
            message: "- URL: http://localhost:5173/private\n- Screenshot: /tmp/secret.png",
            browserPreflightOutcome: outcome,
        });

        assertEquals(result.terminate, true);
        assertEquals(result.details.browserPreflightOutcome, outcome);
        assertEquals(metrics, [
            {
                metric: {
                    category: "execution",
                    event: "task_completed",
                    agentName: "Frontend Engineer",
                    details: { hasMessage: true },
                },
                deps: { cwd: Deno.cwd() },
            },
            {
                metric: {
                    category: "execution",
                    event: "frontend_execution_completed",
                    details: {
                        phase: "implementation",
                        runtimeStyle: "pair",
                        checkpointCount: 2,
                        switchedToAutonomous: true,
                        capabilityLost: false,
                        browserPreflightOutcome: outcome,
                        elapsedMs: 750,
                    },
                },
                deps: { cwd: Deno.cwd() },
            },
        ]);
        assertEquals(JSON.stringify(metrics).includes("localhost"), false);
        assertEquals(JSON.stringify(metrics).includes("secret.png"), false);
    });
}

Deno.test("task_completed labels validation repair Frontend Engineer completion", async () => {
    const metrics = /** @type {any[]} */ ([]);
    const hostedSession = new HostedSession({ id: "task-completed-repair", cwd: Deno.cwd() });
    hostedSession.setActiveExecutionWorkflow({
        planName: "visual-plan",
        triageMeta: { classification: "FEATURE" },
        executionAgent: "frontend-engineer",
        executionStarted: true,
        executionAttemptStartedAtMs: 500,
        validationContinuation: true,
        collaborationStyle: "autonomous",
        pairCheckpointCount: 0,
    });
    const tool = createTaskCompletedTool({
        hostedSession,
        agentName: "frontend-engineer",
        now: () => 900,
        recordWorkflowMetric: (metric, deps) => {
            metrics.push({ metric, deps });
            return Promise.resolve(/** @type {any} */ (null));
        },
    });

    await /** @type {any} */ (tool.execute)("call", {
        message: "- Repair complete.",
        browserPreflightOutcome: "succeeded",
    });

    assertEquals(metrics[1].metric.details.phase, "validation_repair");
    assertEquals(metrics[1].metric.details.elapsedMs, 400);
});

Deno.test("task_completed accepts the Reviewer-Feedback Engineer completing on the owner's behalf", async () => {
    // Validation keeps the execution owner on the active workflow while a repair agent
    // works, so an owner check alone rejects the completion the loop is waiting for and
    // the repair round can never finish.
    const events = /** @type {any[]} */ ([]);
    const hostedSession = new HostedSession({ id: "task-completed-repair-agent", cwd: Deno.cwd() });
    hostedSession.setEventSink({ emit: (/** @type {any} */ event) => events.push(event) });
    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "PLANNED_CHANGE" },
        executionAgent: "engineer",
        validationContinuation: true,
    });
    const tool = createTaskCompletedTool({
        hostedSession,
        agentName: "reviewer-feedback-engineer",
        recordWorkflowMetric: () => Promise.resolve(/** @type {any} */ (null)),
    });

    const result = await /** @type {any} */ (tool.execute)("call", { message: "- Repaired the finding." });

    assertEquals(result.details.outcome, "task_completed");
    assertEquals(
        hostedSession.getActiveExecutionWorkflow()?.executionAgent,
        "engineer",
        "the execution owner is unchanged by a repair completion",
    );
});
