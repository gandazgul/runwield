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

Deno.test("two local producers leave complete JSONL and unique observation IDs", async () => {
    await withWorkflowMetricsFixture(async ({ projectRoot, readMetrics }) => {
        const metricsModule = new URL("./metrics.js", import.meta.url).href;
        const script = `const { recordWorkflowMetric, drainWorkflowMetrics } = await import(${
            JSON.stringify(metricsModule)
        });
            for (let seq = 0; seq < 15; seq++) {
                await recordWorkflowMetric({ v: 2, category: "command", event: "command_started",
                    recorderId: Deno.args[1], commandId: Deno.args[1], seq, command: "help",
                    kind: "builtin", sourceSurface: "tui" }, Deno.args[0]);
            }
            await drainWorkflowMetrics();`;
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
        const rows = await readMetrics();
        assertEquals(rows.length, 30);
        assertEquals(new Set(rows.map((row) => row.eventId)).size, 30);
        for (const id of ["producer_one", "producer_two"]) {
            assertEquals(
                rows.filter((row) => row.recorderId === id).map((row) => typeof row.seq === "number" ? row.seq : -1)
                    .sort((a, b) => a - b),
                Array.from({ length: 15 }, (_, index) => index),
            );
        }
    });
});
