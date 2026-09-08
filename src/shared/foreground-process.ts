/**
 * @module shared/foreground-process
 *
 * Runs one RunWield-owned foreground command as an independently terminable
 * process tree.
 *
 * A validation or `!` command normally starts descendants of its own, so
 * killing only the wrapper shell leaves the real work running and can hold the
 * inherited output pipes open. This module makes the command process a
 * process-group leader on Unix-like systems (via `detached`) so cancellation
 * can signal the whole group, and uses `taskkill /T` on Windows. It also owns
 * the two termination triggers — a caller-supplied `AbortSignal` and an
 * optional timeout — so every caller gets the same race-safe behavior instead
 * of re-implementing listener and timer handling.
 *
 * This is RunWield-owned process machinery, not a dependency-injection seam.
 */

/** Inputs for one foreground direct command. */
export interface SpawnForegroundProcessOptions {
    /** Executable path or PATH-resolved command name. */
    command: string;
    /** Literal argument array. Arguments are never joined through a shell. */
    args?: string[];
    cwd: string;
    /** Extra environment merged over the inherited environment. */
    env?: Record<string, string>;
    /** Optional stdin text written to the child, then closed. */
    stdinText?: string;
    /** User cancellation trigger; aborting terminates the whole process tree. */
    signal?: AbortSignal;
    /** Optional timeout in milliseconds; expiry terminates the whole process tree. */
    timeoutMs?: number;
}

/** Inputs for one foreground shell command. */
export interface SpawnForegroundShellOptions {
    /** Command line passed to `sh -c` (Unix-like) or `cmd /c` (Windows). */
    command: string;
    cwd: string;
    /** Extra environment merged over the inherited environment. */
    env?: Record<string, string>;
    /** User cancellation trigger; aborting terminates the whole process tree. */
    signal?: AbortSignal;
    /** Optional timeout in milliseconds; expiry terminates the whole process tree. */
    timeoutMs?: number;
}

/** Which trigger ended the command early. */
export type ForegroundTermination = "abort" | "timeout";

/** How one foreground process finished. */
export interface ForegroundProcessOutcome {
    /** The process' real exit code, or `null` when its process tree was force-terminated. */
    exitCode: number | null;
    /** The trigger that terminated the tree, or `null` when the command exited on its own. */
    terminatedBy: ForegroundTermination | null;
}

/** How one foreground shell command finished. */
export type ForegroundShellOutcome = ForegroundProcessOutcome;

/** A running (or already-settled) foreground process. */
export interface ForegroundProcess {
    /** OS pid of the spawned process, or `null` when a pre-aborted signal prevented the spawn. */
    readonly pid: number | null;
    readonly stdout: ReadableStream<Uint8Array>;
    readonly stderr: ReadableStream<Uint8Array>;
    /** Force-terminate the process tree without changing a naturally settled outcome. */
    kill(): void;
    /**
     * Settles once the process has exited and the signal/timeout listeners are
     * detached. Callers must also drain `stdout`/`stderr` before publishing
     * final output or releasing Session interaction ownership.
     */
    readonly done: Promise<ForegroundProcessOutcome>;
}

/** A running (or already-settled) foreground shell command. */
export type ForegroundShell = ForegroundProcess;

function emptyClosedStream(): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
        start: (controller) => controller.close(),
    });
}

/**
 * Terminate the spawned process' entire process tree.
 *
 * The Unix group signal is only ever sent to a pid this module spawned with
 * `detached`, so the negative pid names exactly that command's group — never
 * RunWield's own. On Windows `taskkill` is fire-and-forget so a slow or
 * failing taskkill cannot hang cancellation; the direct-child kill afterward
 * is best-effort cleanup, not the tree guarantee.
 */
function terminateProcessTree(child: Deno.ChildProcess): void {
    if (Deno.build.os === "windows") {
        try {
            const killer = new Deno.Command("taskkill", {
                args: ["/F", "/T", "/PID", String(child.pid)],
                stdout: "null",
                stderr: "null",
            }).spawn();
            killer.status.then(() => {}, () => {});
        } catch {
            // taskkill itself failed to start; the direct kill below still applies.
        }
        try {
            child.kill();
        } catch {
            // The process may have exited between termination and the kill.
        }
        return;
    }
    try {
        Deno.kill(-child.pid, "SIGKILL");
    } catch {
        try {
            child.kill("SIGKILL");
        } catch {
            // The process may have exited between termination and the kill.
        }
    }
}

function spawnOwnedProcess(options: SpawnForegroundProcessOptions): ForegroundProcess {
    const { command, args = [], cwd, env, stdinText, signal, timeoutMs } = options;

    if (signal?.aborted) {
        return {
            pid: null,
            stdout: emptyClosedStream(),
            stderr: emptyClosedStream(),
            kill() {},
            done: Promise.resolve({ exitCode: null, terminatedBy: "abort" }),
        };
    }

    let child: Deno.ChildProcess | null = null;
    let terminatedBy: ForegroundTermination | null = null;
    let killSent = false;
    const terminate = (reason: ForegroundTermination): void => {
        if (!terminatedBy) terminatedBy = reason;
        if (!child || killSent) return;
        killSent = true;
        terminateProcessTree(child);
    };
    const onAbort = (): void => terminate("abort");
    signal?.addEventListener("abort", onAbort, { once: true });
    const timeoutId = timeoutMs === undefined ? undefined : setTimeout(() => terminate("timeout"), timeoutMs);

    let spawned: Deno.ChildProcess;
    try {
        spawned = new Deno.Command(command, {
            args,
            cwd,
            env,
            stdin: stdinText === undefined ? "null" : "piped",
            stdout: "piped",
            stderr: "piped",
            // Group leadership is what makes the whole tree terminable on
            // Unix-like systems; Windows uses taskkill /T instead.
            ...(Deno.build.os === "windows" ? {} : { detached: true }),
        }).spawn();
    } catch (error) {
        signal?.removeEventListener("abort", onAbort);
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        throw error;
    }
    child = spawned;
    if (stdinText !== undefined) {
        const writer = spawned.stdin.getWriter();
        const stdin = new TextEncoder().encode(stdinText);
        writer.write(stdin).then(() => writer.close()).catch(() => undefined);
    }
    // Close the pre-spawn race: if the abort fired while `child` was still null,
    // `terminatedBy` is already set and this call sends the kill exactly once.
    if (signal?.aborted) terminate("abort");

    const done: Promise<ForegroundProcessOutcome> = (async () => {
        try {
            const status = await spawned.status;
            return {
                exitCode: terminatedBy ? null : status.code,
                terminatedBy,
            };
        } finally {
            if (timeoutId !== undefined) clearTimeout(timeoutId);
            signal?.removeEventListener("abort", onAbort);
        }
    })();

    return { pid: spawned.pid, stdout: spawned.stdout, stderr: spawned.stderr, kill: () => terminate("abort"), done };
}

/**
 * Spawn a foreground direct command in its own terminable process tree.
 *
 * Arguments stay literal. This is the API for external CLIs whose command line
 * is assembled by RunWield and must not pass through shell parsing.
 */
export function spawnForegroundProcess(options: SpawnForegroundProcessOptions): ForegroundProcess {
    return spawnOwnedProcess(options);
}

/**
 * Spawn a foreground shell command in its own terminable process tree.
 *
 * Cancellation ordering is closed at both ends: the abort listener is attached
 * before spawn, and the post-spawn aborted-state check catches an abort that
 * fired while the child handle was not yet assigned. A pre-aborted signal
 * skips the spawn entirely. Termination is forceful on purpose — a command
 * that traps graceful signals must not keep the Session busy — and every
 * ordering settles exactly once with listeners and timers detached.
 */
export function spawnForegroundShell(options: SpawnForegroundShellOptions): ForegroundShell {
    const { command, cwd, env, signal, timeoutMs } = options;
    const isWindows = Deno.build.os === "windows";
    return spawnOwnedProcess({
        command: isWindows ? "cmd" : "sh",
        args: [isWindows ? "/c" : "-c", command],
        cwd,
        env,
        signal,
        timeoutMs,
    });
}
