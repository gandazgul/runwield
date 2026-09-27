import { assert, assertEquals } from "@std/assert";
import { HostedSession } from "./hosted-session.js";

Deno.test({
    name: "cancelling a shell background task stops its descendant",
    ignore: Deno.build.os === "windows",
    async fn() {
        const cwd = await Deno.makeTempDir();
        const session = new HostedSession({ id: crypto.randomUUID(), cwd });
        const pidFile = `${cwd}/descendant.pid`;
        const task = session.backgroundTasks.startShell({ command: `sleep 30 & echo $! > '${pidFile}'; wait`, cwd });
        try {
            let pid = 0;
            const deadline = Date.now() + 5000;
            while (Date.now() < deadline) {
                pid = Number((await Deno.readTextFile(pidFile).catch(() => "")).trim());
                if (pid) break;
                await new Promise((resolve) => setTimeout(resolve, 20));
            }
            assert(pid > 0, "shell did not start a descendant");
            assertEquals((await session.backgroundTasks.cancel(task.task_id)).state, "cancelled");
            let alive = true;
            const exitDeadline = Date.now() + 5000;
            while (Date.now() < exitDeadline) {
                try {
                    Deno.kill(pid, "SIGCONT");
                } catch {
                    alive = false;
                    break;
                }
                await new Promise((resolve) => setTimeout(resolve, 20));
            }
            assertEquals(alive, false, "descendant survived task cancellation");
        } finally {
            await session.backgroundTasks.cancelAllAndSuppress();
            await Deno.remove(cwd, { recursive: true });
        }
    },
});
