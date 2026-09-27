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
