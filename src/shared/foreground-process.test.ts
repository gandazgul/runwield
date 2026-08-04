import { assert, assertEquals } from "@std/assert";
import { spawnForegroundShell } from "./foreground-process.ts";

const IS_WINDOWS = Deno.build.os === "windows";

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
    const reader = stream.getReader();
    let text = "";
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            text += new TextDecoder().decode(value);
        }
    } finally {
        reader.releaseLock();
    }
    return text;
}

/** True while the OS still has a process with this pid. */
function processAlive(pid: number): boolean {
    try {
        Deno.kill(pid, "SIGCONT");
        return true;
    } catch {
        return false;
    }
}

/**
 * Spawn a command whose descendant outlives a wrapper-only kill: the wrapper
 * records the descendant's pid, then waits on it.
 */
async function spawnTreeWithDescendant(options: {
    signal?: AbortSignal;
    timeoutMs?: number;
}): Promise<{ shell: ReturnType<typeof spawnForegroundShell>; descendantPid: number; cleanup: () => Promise<void> }> {
    const pidFile = await Deno.makeTempFile({ prefix: "runwield-fg-descendant-" });
    const shell = spawnForegroundShell({
        command: `sleep 30 & echo $! > ${pidFile}; wait`,
        cwd: Deno.cwd(),
        ...options,
    });
    let descendantPid = 0;
    while (!descendantPid) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        descendantPid = Number((await Deno.readTextFile(pidFile)).trim()) || 0;
    }
    return {
        shell,
        descendantPid,
        cleanup: async () => {
            if (processAlive(descendantPid)) Deno.kill(descendantPid, "SIGKILL");
            await Deno.remove(pidFile).catch(() => {});
        },
    };
}

Deno.test({
    name: "spawnForegroundShell reports the real exit status and separate streams",
    ignore: IS_WINDOWS,
    fn: async () => {
        const cwd = await Deno.makeTempDir({ prefix: "runwield-fg-cwd-" });
        try {
            const shell = spawnForegroundShell({ command: "printf out; printf err >&2; exit 3", cwd });
            const [outcome, stdout, stderr] = await Promise.all([
                shell.done,
                readAll(shell.stdout),
                readAll(shell.stderr),
            ]);
            assertEquals(outcome, { exitCode: 3, terminatedBy: null });
            assertEquals(stdout, "out");
            assertEquals(stderr, "err");
        } finally {
            await Deno.remove(cwd, { recursive: true });
        }
    },
});

Deno.test({
    name: "spawnForegroundShell abort kills the whole descendant tree",
    ignore: IS_WINDOWS,
    fn: async () => {
        const abortController = new AbortController();
        const { shell, descendantPid, cleanup } = await spawnTreeWithDescendant({ signal: abortController.signal });
        try {
            assert(processAlive(descendantPid), "descendant should be running before abort");
            abortController.abort();
            const outcome = await shell.done;
            assertEquals(outcome, { exitCode: null, terminatedBy: "abort" });
            assertEquals(processAlive(descendantPid), false, "abort must kill the descendant, not only the wrapper");
        } finally {
            await cleanup();
        }
    },
});

Deno.test({
    name: "spawnForegroundShell abort during startup still kills the spawned tree",
    ignore: IS_WINDOWS,
    fn: async () => {
        // The abort fires synchronously after the spawn call returns but before
        // `done` is awaited: the startup-race window the pre-spawn listener and
        // post-spawn check exist to close.
        const abortController = new AbortController();
        const { shell, descendantPid, cleanup } = await spawnTreeWithDescendant({ signal: abortController.signal });
        try {
            abortController.abort();
            const outcome = await shell.done;
            assertEquals(outcome.terminatedBy, "abort");
            assertEquals(processAlive(descendantPid), false);
        } finally {
            await cleanup();
        }
    },
});

Deno.test({
    name: "spawnForegroundShell timeout kills the whole descendant tree and stays distinguishable from abort",
    ignore: IS_WINDOWS,
    fn: async () => {
        const { shell, descendantPid, cleanup } = await spawnTreeWithDescendant({ timeoutMs: 50 });
        try {
            assert(processAlive(descendantPid), "descendant should be running before the timeout");
            const outcome = await shell.done;
            assertEquals(outcome, { exitCode: null, terminatedBy: "timeout" });
            assertEquals(processAlive(descendantPid), false, "timeout must kill the descendant, not only the wrapper");
        } finally {
            await cleanup();
        }
    },
});

Deno.test({
    name: "spawnForegroundShell skips the spawn entirely for an already-aborted signal",
    ignore: IS_WINDOWS,
    fn: async () => {
        const marker = await Deno.makeTempFile({ prefix: "runwield-fg-preabort-" });
        await Deno.remove(marker);
        const abortController = new AbortController();
        abortController.abort();
        const shell = spawnForegroundShell({
            command: `touch ${marker}`,
            cwd: Deno.cwd(),
            signal: abortController.signal,
        });
        const [outcome, stdout, stderr] = await Promise.all([
            shell.done,
            readAll(shell.stdout),
            readAll(shell.stderr),
        ]);
        assertEquals(shell.pid, null);
        assertEquals(outcome, { exitCode: null, terminatedBy: "abort" });
        assertEquals(stdout, "");
        assertEquals(stderr, "");
        await new Promise((resolve) => setTimeout(resolve, 50));
        const markerExists = await Deno.stat(marker).then(() => true, () => false);
        assertEquals(markerExists, false, "a pre-aborted signal must prevent the command from starting");
    },
});

Deno.test({
    name: "spawnForegroundShell tolerates an abort that arrives after natural exit",
    ignore: IS_WINDOWS,
    fn: async () => {
        const abortController = new AbortController();
        const shell = spawnForegroundShell({
            command: "printf done; exit 7",
            cwd: Deno.cwd(),
            signal: abortController.signal,
        });
        const outcome = await shell.done;
        abortController.abort();
        assertEquals(outcome, { exitCode: 7, terminatedBy: null });
        assertEquals(await shell.done, outcome, "done settles exactly once");
    },
});
