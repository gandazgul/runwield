import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { HostedSession } from "./hosted-session.js";
import { BackgroundTasks } from "./background-tasks.ts";
import { createRunWieldReadToolDefinition } from "../../tools/read.js";

async function fixture() {
    const cwd = await Deno.makeTempDir();
    const session = new HostedSession({ id: crypto.randomUUID(), cwd });
    return {
        cwd,
        session,
        tasks: session.backgroundTasks as BackgroundTasks,
        cleanup: async () => {
            await session.backgroundTasks.cancelAllAndSuppress();
            await Deno.remove(cwd, { recursive: true });
        },
    };
}

Deno.test("shell start returns before exit and publishes a final result after its logs close", async () => {
    const f = await fixture();
    try {
        const task = f.tasks.startShell({ command: "echo ready; sleep 0.3; echo done >&2", cwd: f.cwd });
        assertEquals(task.state, "running");
        const final = await f.tasks.wait(task.task_id);
        assertEquals(final.state, "completed");
        assertEquals(final.exit_code, 0);
        assertEquals(final.byte_count, 11);
        assertEquals(final.line_count, 2);
        assertStringIncludes(final.output ?? "", "ready");
        assertStringIncludes(final.output ?? "", "done");
        assertEquals(await Deno.readTextFile(final.log_path), "ready\n");
        assertEquals(await Deno.readTextFile(final.err_log_path), "done\n");
        assertEquals(f.tasks.pendingCompletions().length, 1);
        f.tasks.acknowledge(task.task_id);
        assertEquals(f.tasks.pendingCompletions().length, 0);
    } finally {
        await f.cleanup();
    }
});

Deno.test("five running tasks hold slots until settlement; other Sessions cannot control them", async () => {
    const a = await fixture();
    const b = await fixture();
    try {
        const starts = Array.from({ length: 5 }, () => a.tasks.startShell({ command: "sleep 20", cwd: a.cwd }));
        assertEquals(a.tasks.activeCount, 5);
        try {
            a.tasks.startShell({ command: "echo extra", cwd: a.cwd });
            throw new Error("Sixth start succeeded");
        } catch (error) {
            assertStringIncludes(String(error), "maximum is 5");
        }
        await assertRejects(() => b.tasks.cancel(starts[0].task_id), Error, "Unknown background task");
        const cancelled = await a.tasks.cancel(starts[0].task_id);
        assertEquals(cancelled.state, "cancelled");
        assertEquals((await a.tasks.cancel(starts[0].task_id)).state, "cancelled");
        assertEquals(a.tasks.activeCount, 4);
        assertEquals(
            (await b.tasks.wait(b.tasks.startShell({ command: "echo independent", cwd: b.cwd }).task_id)).state,
            "completed",
        );
    } finally {
        await a.cleanup();
        await b.cleanup();
    }
});

Deno.test("another host process has its own slots and cannot control this process's task ID", async () => {
    const f = await fixture();
    const script = `${f.cwd}/another-host.ts`;
    try {
        const parents = Array.from({ length: 5 }, () => f.tasks.startShell({ command: "sleep 20", cwd: f.cwd }));
        const hostedSessionUrl = new URL("./hosted-session.js", import.meta.url).href;
        await Deno.writeTextFile(
            script,
            `
import { HostedSession } from ${JSON.stringify(hostedSessionUrl)};
const [id, cwd, foreignId] = Deno.args;
const session = new HostedSession({ id, cwd });
try {
    let refused = false;
    try { session.backgroundTasks.status(foreignId); } catch { refused = true; }
    const own = session.backgroundTasks.startShell({ command: "printf child", cwd });
    const result = await session.backgroundTasks.wait(own.task_id);
    console.log(JSON.stringify({ refused, output: result.output, state: result.state }));
} finally { await session.dispose(); }
`,
        );
        const output = await new Deno.Command(Deno.execPath(), {
            args: [
                "run",
                "-A",
                "--config",
                new URL("../../../deno.json", import.meta.url).pathname,
                script,
                f.session.id,
                f.cwd,
                parents[0].task_id,
            ],
            cwd: f.cwd,
        }).output();
        assertEquals(output.success, true, new TextDecoder().decode(output.stderr));
        assertEquals(JSON.parse(new TextDecoder().decode(output.stdout)), {
            refused: true,
            output: "child",
            state: "completed",
        });
        assertEquals(f.tasks.activeCount, 5);
    } finally {
        await f.cleanup();
    }
});

Deno.test("output at exactly 8192 UTF-8 bytes is inline and empty output is explicit", async () => {
    const f = await fixture();
    try {
        const exact = await f.tasks.wait(
            f.tasks.startShell({ command: "printf 'é'; head -c 8190 /dev/zero | tr '\\0' x", cwd: f.cwd }).task_id,
        );
        assertEquals(exact.byte_count, 8192);
        assertEquals(exact.output?.length, 8191);
        assertEquals(exact.output?.startsWith("é"), true);
        const empty = await f.tasks.wait(f.tasks.startShell({ command: "true", cwd: f.cwd }).task_id);
        assertEquals(empty.output, "(No output.)");
    } finally {
        await f.cleanup();
    }
});

Deno.test("presented output removes terminal control bytes without changing its log", async () => {
    const f = await fixture();
    try {
        const final = await f.tasks.wait(
            f.tasks.startShell({ command: "printf '\\033[31mred\\033[0m\\n'", cwd: f.cwd }).task_id,
        );
        assertEquals(final.output, "red\n");
        assertEquals(await Deno.readTextFile(final.log_path), "\u001b[31mred\u001b[0m\n");
    } finally {
        await f.cleanup();
    }
});

Deno.test("large UTF-8 output uses the complete log; a final unterminated line counts", async () => {
    const f = await fixture();
    try {
        const final = await f.tasks.wait(
            f.tasks.startShell({ command: "printf 'é'; head -c 8191 /dev/zero | tr '\\0' x", cwd: f.cwd }).task_id,
        );
        assertEquals(final.byte_count, 8193);
        assertEquals(final.line_count, 1);
        assertEquals(final.output, undefined);
        assertEquals((await Deno.readTextFile(final.log_path)).length, 8192);
        const read = createRunWieldReadToolDefinition(f.cwd);
        const displayed = await read.execute(
            "read-task-log",
            { path: final.log_path },
            new AbortController().signal,
            () => {},
            {} as never,
        );
        const text = displayed.content.find((block) => block.type === "text");
        assertStringIncludes(text?.text || "", "x".repeat(8191));
    } finally {
        await f.cleanup();
    }
});

Deno.test("timeout and nonzero exit release slots", async () => {
    const f = await fixture();
    try {
        const timed = await f.tasks.wait(
            f.tasks.startShell({ command: "sleep 20", cwd: f.cwd, timeoutMs: 30 }).task_id,
        );
        assertEquals(timed.state, "timed_out");
        const failed = await f.tasks.wait(f.tasks.startShell({ command: "exit 7", cwd: f.cwd }).task_id);
        assertEquals(failed.state, "failed");
        assertEquals(failed.exit_code, 7);
        assertEquals(f.tasks.activeCount, 0);
    } finally {
        await f.cleanup();
    }
});
