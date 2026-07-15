import { assertEquals } from "@std/assert";
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

    const result = await /** @type {any} */ (tool.execute)("call", { message: "Implemented and tested." });

    assertEquals(result.terminate, true);
    assertEquals(result.details, { outcome: "task_completed", message: "Implemented and tested." });
    assertEquals(events.length, 1);
    assertEquals(events[0].type, RuntimeEventTypes.ASSISTANT_TEXT_DELTA);
    assertEquals(events[0]._meta.agentName, "engineer");
    assertEquals(events[0].delta, "**Task completed.**\n\nImplemented and tested.");
    assertEquals(metrics[0].event, "task_completed");
});
