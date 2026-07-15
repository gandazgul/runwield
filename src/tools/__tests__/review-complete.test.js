import { assertEquals } from "@std/assert";
import { HostedSession } from "../../shared/session/hosted-session.js";
import { RuntimeEventTypes } from "../../shared/session/session-runtime-events.js";
import { createReviewCompletedTool } from "../review-complete.js";

for (const approved of [true, false]) {
    Deno.test(`review_complete emits one semantic result when approved=${approved}`, async () => {
        const events = /** @type {any[]} */ ([]);
        const metrics = /** @type {any[]} */ ([]);
        const hostedSession = new HostedSession({ id: `review-${approved}`, cwd: Deno.cwd() });
        hostedSession.setEventSink({ emit: (/** @type {any} */ event) => events.push(event) });
        const tool = createReviewCompletedTool({
            hostedSession,
            agentName: "reviewer",
            recordWorkflowMetric: (metric) => {
                metrics.push(metric);
                return Promise.resolve(/** @type {any} */ (null));
            },
        });

        const result = await /** @type {any} */ (tool.execute)("call", {
            approved,
            feedback: approved ? "ship it" : "fix the boundary",
        });

        assertEquals(result.terminate, true);
        assertEquals(result.details.approved, approved);
        assertEquals(events.length, 1);
        assertEquals(events[0].type, RuntimeEventTypes.ASSISTANT_TEXT_DELTA);
        assertEquals(events[0]._meta.reviewResult, true);
        assertEquals(events[0]._meta.approved, approved);
        assertEquals(metrics[0].event, "review_complete");
    });
}
