import { assertEquals, assertStringIncludes } from "@std/assert";
import { HostedSession } from "../shared/session/hosted-session.js";
import { createBackgroundTaskTool } from "./background-task.ts";

Deno.test("background_task starts real shell work and controls it through the owning Session", async () => {
    const cwd = await Deno.makeTempDir();
    const session = new HostedSession({ id: crypto.randomUUID(), cwd });
    const tool = createBackgroundTaskTool({ hostedSession: session, cwd, allowShellStart: true });
    try {
        const release = `${cwd}/release`;
        const marker = `${cwd}/completed`;
        const start = await tool.execute(
            "start",
            {
                action: "start",
                command:
                    `printf 'ready\\n'; while [ ! -f '${release}' ]; do sleep 0.02; done; printf complete > '${marker}'; printf complete`,
            },
            new AbortController().signal,
            () => {},
            {} as never,
        );
        assertEquals(start.details?.state, "running");
        const id = start.details?.task_id ?? "";
        const status = await tool.execute(
            "status",
            { action: "status", task_id: id },
            new AbortController().signal,
            () => {},
            {} as never,
        );
        assertEquals(status.details?.task_id, id);
        assertEquals(status.details?.state, "running");
        for (let index = 0; index < 100 && session.backgroundTasks.status(id).byte_count === 0; index++) {
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assertEquals(session.backgroundTasks.status(id).byte_count, 6);
        assertEquals(await Deno.stat(marker).then(() => true, () => false), false);
        await Deno.writeTextFile(release, "go");
        await session.backgroundTasks.wait(id);
        assertEquals(await Deno.readTextFile(marker), "complete");
        const result = await tool.execute(
            "status",
            { action: "status", task_id: id },
            new AbortController().signal,
            () => {},
            {} as never,
        );
        assertEquals(result.details?.output, "ready\ncomplete");
        assertEquals(result.details?.state, "completed");
    } finally {
        await session.backgroundTasks.cancelAllAndSuppress();
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("background_task denies shell start without effective bash authority but permits task controls", async () => {
    const cwd = await Deno.makeTempDir();
    const session = new HostedSession({ id: crypto.randomUUID(), cwd });
    const tool = createBackgroundTaskTool({ hostedSession: session, cwd, allowShellStart: false });
    try {
        const rejected = await tool.execute(
            "start",
            { action: "start", command: "echo forbidden" },
            new AbortController().signal,
            () => {},
            {} as never,
        );
        assertEquals(rejected.details, null);
        if (rejected.content[0].type !== "text") throw new Error("Expected text error");
        assertStringIncludes(rejected.content[0].text, "bash authority");
        const id = session.backgroundTasks.startShell({ command: "echo allowed", cwd }).task_id;
        await session.backgroundTasks.wait(id);
        assertEquals(
            (await tool.execute(
                "status",
                { action: "status", task_id: id },
                new AbortController().signal,
                () => {},
                {} as never,
            )).details?.state,
            "completed",
        );
        assertEquals(
            (await tool.execute(
                "cancel",
                { action: "cancel", task_id: id },
                new AbortController().signal,
                () => {},
                {} as never,
            )).details?.state,
            "completed",
        );
    } finally {
        await session.backgroundTasks.cancelAllAndSuppress();
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("restricted background starts share the foreground command policy without blocking controls", async () => {
    const cwd = await Deno.makeTempDir({ prefix: "runwield-bg-restricted-" });
    const session = new HostedSession({ id: crypto.randomUUID(), cwd });
    const tool = createBackgroundTaskTool({
        hostedSession: session,
        cwd,
        allowShellStart: true,
        allowedCommands: ["pwd"],
    });
    const call = (action: "start" | "status", command?: string, task_id?: string) =>
        tool.execute("task", { action, command, task_id }, new AbortController().signal, () => {}, {} as never);
    try {
        const denied = await call("start", "pwd && touch sentinel");
        assertEquals(denied.details, null);
        if (denied.content[0].type !== "text") throw new Error("Expected policy error");
        assertStringIncludes(denied.content[0].text, "report a blocker");
        assertEquals(await Deno.stat(`${cwd}/sentinel`).then(() => true, () => false), false);
        const started = await call("start", "pwd");
        const id = started.details?.task_id ?? "";
        await session.backgroundTasks.wait(id);
        assertStringIncludes((await call("status", undefined, id)).details?.output ?? "", cwd);
        const deniedAll = createBackgroundTaskTool({
            hostedSession: session,
            cwd,
            allowShellStart: true,
            allowedCommands: [],
        });
        const control = await deniedAll.execute(
            "control",
            { action: "status", task_id: id },
            new AbortController().signal,
            () => {},
            {} as never,
        );
        assertEquals(control.details?.state, "completed");
    } finally {
        await session.backgroundTasks.cancelAllAndSuppress();
        await Deno.remove(cwd, { recursive: true });
    }
});
