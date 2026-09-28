import { assert, assertEquals } from "@std/assert";
import { withWorkflowMetricsFixture } from "../../testing/workflow-metrics-fixture.ts";
import { recordSlashCommandMetric, SlashCommandMetricsTracker } from "./command-metrics.ts";

Deno.test("recordSlashCommandMetric records direct start and finish observations", async () => {
    await withWorkflowMetricsFixture(async ({ projectRoot, readMetrics }) => {
        const invocationId = "inv-direct-1";

        // Record start
        await recordSlashCommandMetric({
            invocationId,
            command: "plan-review",
            kind: "builtin",
            surface: "workspace",
            projectRoot,
            sessionId: "session-abc",
            phase: "start",
        });

        // Record finish
        await recordSlashCommandMetric({
            invocationId,
            command: "plan-review",
            kind: "builtin",
            surface: "workspace",
            projectRoot,
            sessionId: "session-abc",
            phase: "finish",
            outcome: "succeeded",
            durationMs: 42,
        });

        const records = await readMetrics();
        assertEquals(records.length, 2);

        const start = records[0];
        assertEquals(start.v, 2);
        assertEquals(start.category, "command");
        assertEquals(start.event, "command_started");
        assertEquals(start.commandId, invocationId);
        assertEquals(start.command, "plan-review");
        assertEquals(start.kind, "builtin");
        assertEquals(start.sourceSurface, "workspace");
        assertEquals(start.sessionId, "session-abc");

        const finish = records[1];
        assertEquals(finish.v, 2);
        assertEquals(finish.category, "command");
        assertEquals(finish.event, "command_finished");
        assertEquals(finish.commandId, invocationId);
        assertEquals(finish.command, "plan-review");
        assertEquals(finish.outcome, "succeeded");
        assertEquals(finish.durationMs, 42);
    });
});

Deno.test("SlashCommandMetricsTracker measures duration and emits linked start/finish events", async () => {
    await withWorkflowMetricsFixture(async ({ projectRoot, readMetrics }) => {
        const tracker = new SlashCommandMetricsTracker({
            command: "tdd",
            alias: "test-driven-dev",
            kind: "skill",
            surface: "tui",
            projectRoot,
            sessionId: "session-xyz",
            requestId: "req-99",
        });

        await tracker.recordStart();

        // Simulate work
        await new Promise((resolve) => setTimeout(resolve, 15));

        await tracker.recordFinish({
            outcome: "succeeded",
            executionId: "exec-child-42",
        });

        const records = await readMetrics();
        assertEquals(records.length, 2);

        const start = records[0];
        assertEquals(start.event, "command_started");
        assertEquals(start.command, "tdd");
        assertEquals(start.alias, "test-driven-dev");
        assertEquals(start.kind, "skill");
        assertEquals(start.sourceSurface, "tui");
        assertEquals(start.commandId, tracker.invocationId);

        const finish = records[1];
        assertEquals(finish.event, "command_finished");
        assertEquals(finish.commandId, tracker.invocationId);
        assertEquals(finish.outcome, "succeeded");
        assertEquals(finish.executionId, "exec-child-42");
        assert(typeof finish.durationMs === "number" && (finish.durationMs as number) >= 10);
    });
});

Deno.test("SlashCommandMetricsTracker records failures with reason codes", async () => {
    await withWorkflowMetricsFixture(async ({ projectRoot, readMetrics }) => {
        const tracker = new SlashCommandMetricsTracker({
            command: "unknown-cmd",
            kind: "builtin",
            surface: "acp",
            projectRoot,
        });

        await tracker.recordStart();
        await tracker.recordFinish({
            outcome: "failed",
            errorReason: "unknown_command",
        });

        const records = await readMetrics();
        assertEquals(records.length, 2);
        const finish = records[1];
        assertEquals(finish.event, "command_finished");
        assertEquals(finish.outcome, "failed");
        assertEquals(finish.errorReason, "unknown_command");
    });
});
