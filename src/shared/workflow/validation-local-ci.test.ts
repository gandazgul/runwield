import { assertEquals, assertStringIncludes } from "@std/assert";

import { HostedSession } from "../session/hosted-session.js";
import { setCustomSetting } from "../settings.js";
import { runLocalCI } from "./validation-local-ci.ts";

const IS_WINDOWS = Deno.build.os === "windows";

function processAlive(pid: number): boolean {
    try {
        Deno.kill(pid, "SIGCONT");
        return true;
    } catch {
        return false;
    }
}

async function makeCiProject(command: string): Promise<{ cwd: string; hostedSession: HostedSession }> {
    const cwd = await Deno.makeTempDir({ prefix: "runwield-local-ci-" });
    await setCustomSetting("verification_command", command, "project", cwd);
    return { cwd, hostedSession: new HostedSession({ id: "local-ci-test", cwd }) };
}

Deno.test("runLocalCI reports the real exit code and captured output", async () => {
    const { cwd, hostedSession } = await makeCiProject("printf ci-ok; exit 0");
    try {
        const result = await runLocalCI({ hostedSession, cwd });
        assertEquals(result.exitCode, 0);
        assertEquals(result.canceled, undefined);
        assertStringIncludes(result.output, "ci-ok");
    } finally {
        await Deno.remove(cwd, { recursive: true }).catch(() => {});
    }
});

Deno.test("runLocalCI keeps output bounded and says so when the tail is truncated", async () => {
    const { cwd, hostedSession } = await makeCiProject("yes ci-flood | head -c 1300000");
    try {
        const result = await runLocalCI({ hostedSession, cwd });
        assertEquals(result.exitCode, 0);
        assertStringIncludes(result.output, "[RunWield] stdout truncated;");
    } finally {
        await Deno.remove(cwd, { recursive: true }).catch(() => {});
    }
});

Deno.test({
    name: "runLocalCI cancellation through the HostedSession kills the whole CI process tree",
    ignore: IS_WINDOWS,
    fn: async () => {
        const cwd = await Deno.makeTempDir({ prefix: "runwield-local-ci-" });
        const pidFile = `${cwd}/descendant.pid`;
        await setCustomSetting("verification_command", `sleep 30 & echo $! > ${pidFile}; wait`, "project", cwd);
        const hostedSession = new HostedSession({ id: "local-ci-cancel-test", cwd });
        let descendantPid = 0;
        try {
            const resultPromise = runLocalCI({ hostedSession, cwd });
            while (!descendantPid) {
                await new Promise((resolve) => setTimeout(resolve, 10));
                descendantPid = Number(await Deno.readTextFile(pidFile).then((text) => text.trim(), () => "")) || 0;
            }
            assertEquals(processAlive(descendantPid), true, "CI descendant should be running before cancellation");

            hostedSession.cancelActiveInteractions();
            const result = await resultPromise;

            assertEquals(result.canceled, true);
            assertEquals(result.exitCode, 130);
            assertEquals(processAlive(descendantPid), false, "cancellation must kill CI's whole process tree");
            assertEquals(
                hostedSession.getActiveInteractions().size,
                0,
                "the active interaction is released once the tree has settled",
            );
        } finally {
            if (descendantPid && processAlive(descendantPid)) Deno.kill(descendantPid, "SIGKILL");
            await Deno.remove(cwd, { recursive: true }).catch(() => {});
        }
    },
});
