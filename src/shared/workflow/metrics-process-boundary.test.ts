import { assertEquals } from "@std/assert";
import { withWorkflowMetricsFixture } from "../../testing/workflow-metrics-fixture.ts";

Deno.test("a producer lost after a flushed call start leaves no fabricated terminal row", async () => {
    await withWorkflowMetricsFixture(async ({ projectRoot, readMetrics }) => {
        const metricsModule = new URL("./metrics.js", import.meta.url).href;
        const script = `const { recordWorkflowMetric, drainWorkflowMetrics } = await import(${
            JSON.stringify(metricsModule)
        });
            await recordWorkflowMetric({ v: 2, category: "tool_usage", event: "tool_call_started",
                recorderId: "crashed_execution", seq: 0, executionId: "crashed_execution",
                callId: "lost_call", toolName: "read" }, Deno.args[0]);
            await drainWorkflowMetrics();
            Deno.exit(0);`;
        const child = new Deno.Command(Deno.execPath(), {
            args: ["run", "-A", "--no-check", "-", projectRoot],
            stdin: "piped",
            stdout: "piped",
            stderr: "piped",
        }).spawn();
        const writer = child.stdin.getWriter();
        await writer.write(new TextEncoder().encode(script));
        await writer.close();
        const status = await child.output();
        assertEquals(status.success, true, new TextDecoder().decode(status.stderr));
        const rows = await readMetrics();
        assertEquals(rows.map((row) => [row.event, row.callId]), [["tool_call_started", "lost_call"]]);
    });
});

Deno.test("two local producers preserve saved observations and report lock budget skips", async () => {
    await withWorkflowMetricsFixture(async ({ projectRoot, readMetrics }) => {
        const metricsModule = new URL("./metrics.js", import.meta.url).href;
        const script = `const { recordWorkflowMetric, drainWorkflowMetrics } = await import(${
            JSON.stringify(metricsModule)
        });
            const outcomes = [];
            for (let seq = 0; seq < 15; seq++) {
                outcomes.push(await recordWorkflowMetric({ v: 2, category: "command", event: "command_started",
                    recorderId: Deno.args[1], commandId: Deno.args[1], seq, command: "help",
                    kind: "builtin", sourceSurface: "tui" }, Deno.args[0]));
            }
            await drainWorkflowMetrics();
            console.log(JSON.stringify(outcomes));`;
        const run = (id: string) =>
            new Deno.Command(Deno.execPath(), {
                args: ["run", "-A", "--no-check", "-", projectRoot, id],
                stdin: "piped",
                stdout: "piped",
                stderr: "piped",
            }).spawn();
        const children = [run("producer_one"), run("producer_two")];
        const results = await Promise.all(children.map(async (child) => {
            const input = child.stdin.getWriter();
            await input.write(new TextEncoder().encode(script));
            await input.close();
            return child.output();
        }));
        for (const result of results) assertEquals(result.success, true, new TextDecoder().decode(result.stderr));
        const outcomes = results.flatMap((result, index) => {
            const reported = JSON.parse(new TextDecoder().decode(result.stdout));
            assertEquals(reported.length, 15);
            for (const [seq, outcome] of reported.entries()) {
                assertEquals(outcome.recorderId, index === 0 ? "producer_one" : "producer_two");
                assertEquals(outcome.seq, seq);
                assertEquals(typeof outcome.persisted, "boolean");
                assertEquals(typeof outcome.eventId, "string");
                if (!outcome.persisted) assertEquals(outcome.reason, "lock_timeout");
            }
            return reported;
        });
        assertEquals(new Set(outcomes.map((outcome) => outcome.eventId)).size, 30);
        const saved = outcomes.filter((outcome) => outcome.persisted).map(({ persisted: _persisted, ...row }) => row);
        assertEquals(saved.length > 0, true);
        const rows = await readMetrics();
        assertEquals(rows.length, saved.length);
        for (const row of saved) assertEquals(rows.find((record) => record.eventId === row.eventId), row);
    });
});
