import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { getHomeDir } from "../../constants.js";
import { HostedSession } from "./hosted-session.js";

Deno.test("an unwritable log location fails before spawning and frees the slot", async () => {
    const cwd = await Deno.makeTempDir();
    const id = crypto.randomUUID();
    const blocked = join(getHomeDir(), ".wld", "sessions", "local", id);
    await Deno.mkdir(join(getHomeDir(), ".wld", "sessions", "local"), { recursive: true });
    await Deno.writeTextFile(blocked, "not a directory");
    const session = new HostedSession({ id, cwd });
    try {
        const status = await session.backgroundTasks.wait(
            session.backgroundTasks.startShell({ command: "echo should-not-run", cwd }).task_id,
        );
        assertEquals(status.state, "failed");
        assertStringIncludes(status.error ?? "", "Task failed");
        assertEquals(session.backgroundTasks.activeCount, 0);
    } finally {
        await session.backgroundTasks.cancelAllAndSuppress();
        await Deno.remove(blocked);
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("background delegates respect synchronous reader leases and cancel independently", async () => {
    const cwd = await Deno.makeTempDir();
    const session = new HostedSession({ id: crypto.randomUUID(), cwd });
    const release = session.acquireDelegatedAgentLease("read");
    let resolve = () => {};
    const gate = new Promise<void>((done) => {
        resolve = done;
    });
    try {
        const ids = [
            session.backgroundTasks.startDelegate(async (signal) => {
                await Promise.race([
                    gate,
                    new Promise<void>((done) => signal.addEventListener("abort", () => done(), { once: true })),
                ]);
                return "done";
            }).task_id,
            session.backgroundTasks.startDelegate(async () => {
                await gate;
                return "done";
            }).task_id,
        ];
        try {
            session.backgroundTasks.startDelegate(async () => "extra");
            throw new Error("Fourth reader started");
        } catch (error) {
            assertStringIncludes(String(error), "maximum is 3");
        }
        assertEquals((await session.backgroundTasks.cancel(ids[0])).state, "cancelled");
        resolve();
        assertEquals((await session.backgroundTasks.wait(ids[1])).state, "completed");
        assertEquals(session.getDelegatedAgentLeaseState().readers, 1);
    } finally {
        resolve();
        release();
        await session.backgroundTasks.cancelAllAndSuppress();
        await Deno.remove(cwd, { recursive: true });
    }
});
