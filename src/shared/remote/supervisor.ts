/* Runs in the remote executable, independently of the TUI process. The
 * launcher delivers the private header through a separate non-terminal SSH
 * channel into an owned Unix socket, never through the terminal or a file. */

import type { RemoteConnectionViewConfig } from "../../ui/tui/remote-connection-view.ts";
import { terminateOwnedLinuxGroup } from "../foreground-process.ts";

export interface RemoteSupervisorHeader {
    credential: string;
    port: number;
    buildId: string;
    protocol: number;
    view: RemoteConnectionViewConfig;
}

const encoder = new TextEncoder();
const PERIOD_MS = 5_000;

async function stty(...args: string[]): Promise<string> {
    const result = await new Deno.Command("stty", {
        args,
        stdin: "inherit",
        stdout: "piped",
        stderr: "null",
    }).output();
    if (!result.success) throw new Error("Remote supervisor requires a private SSH terminal");
    return new TextDecoder().decode(result.stdout).trim();
}

async function readHeader(connection: Deno.Conn): Promise<RemoteSupervisorHeader> {
    const bytes: number[] = [];
    const buffer = new Uint8Array(1);
    while (bytes.length < 16 * 1024) {
        if (await connection.read(buffer) === null) throw new Error("Missing remote supervisor header");
        if (buffer[0] === 10) {
            let header: RemoteSupervisorHeader;
            try {
                header = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes)));
            } catch {
                throw new Error("Invalid remote supervisor header");
            }
            if (
                !header || !/^[a-f0-9]{64}$/.test(header.credential) ||
                !/^[a-f0-9]{64}$/.test(header.buildId) ||
                !Number.isInteger(header.protocol) ||
                !Number.isInteger(header.port) || header.port < 1 || header.port > 65535 ||
                !header.view ||
                !["host", "cwd", "status", "trust", "readiness"].every((key) =>
                    typeof header.view[key as keyof RemoteConnectionViewConfig] === "string"
                )
            ) throw new Error("Invalid remote supervisor header");
            return header;
        }
        bytes.push(buffer[0]);
    }
    throw new Error("Remote supervisor header is too large");
}

async function control(
    header: RemoteSupervisorHeader,
    operation: string,
    body?: string,
    signal?: AbortSignal,
): Promise<boolean> {
    const response = await fetch(`http://127.0.0.1:${header.port}/${operation}`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${header.credential}`,
            ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body,
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(4_000)]) : AbortSignal.timeout(4_000),
    });
    if (!response.ok) throw new Error("Remote control refused connection");
    const answer: { shutdown: boolean } = await response.json();
    if (typeof answer.shutdown !== "boolean") throw new Error("Invalid remote control reply");
    return answer.shutdown;
}

async function stopChild(child: Deno.ChildProcess, label: string): Promise<void> {
    try {
        if (!await terminateOwnedLinuxGroup(child)) {
            console.error(`Remote ${label} termination is unconfirmed; no stale group was signalled.`);
        }
    } catch (error) {
        console.error(`Remote ${label} cleanup could not be confirmed:`, error);
    }
}

/**
 * Private --remote-supervisor entry. The launcher requests an SSH tty for
 * terminal data and uses a separate -T SSH channel for the private header.
 * Neither SSH command includes the credential. The tunnel uses -R
 * 127.0.0.1:<header.port>:127.0.0.1:<service.port>.
 */
export async function runRemoteSupervisor(): Promise<void> {
    if (!Deno.build.standalone || Deno.args.length !== 1 || Deno.args[0] !== "--remote-supervisor") {
        throw new Error("Remote supervisor requires its own compiled executable");
    }
    if (Deno.build.os !== "linux") throw new Error("Remote supervisor requires Linux");
    const originalMode = await stty("-g");
    await stty("-echo");
    const socketDirectory = await Deno.makeTempDir({ prefix: "wld-remote-" });
    const socketPath = `${socketDirectory}/control.sock`;
    let listener: Deno.Listener;
    try {
        listener = Deno.listen({ transport: "unix", path: socketPath });
    } catch (error) {
        await Deno.remove(socketDirectory, { recursive: true });
        await stty(originalMode).catch(() => undefined);
        throw error;
    }
    let child: Deno.ChildProcess | undefined;
    let inputPump: Deno.ChildProcess | undefined;
    let inputPumpStopped = false;
    let childStopped = false;
    let childExited = false;
    let connection: Deno.Conn | undefined;
    let interrupted = false;
    const onEarlyClosure = () => {
        interrupted = true;
        try {
            connection?.close();
        } catch { /* Read already settled. */ }
        try {
            listener.close();
        } catch { /* Already closed. */ }
    };
    for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"] as const) {
        Deno.addSignalListener(signal, onEarlyClosure);
    }
    try {
        // The marker contains only a locator in a mode-0700 temporary folder.
        // A banner cannot cause the terminal to echo a credential: the header
        // travels exclusively over the separate non-terminal SSH channel.
        console.log(`REMOTE_SUPERVISOR_READY:${socketPath}`);
        let header: RemoteSupervisorHeader;
        try {
            connection = await listener.accept();
            header = await readHeader(connection);
        } finally {
            try {
                connection?.close();
            } catch { /* Already closed. */ }
            try {
                listener.close();
            } catch { /* Already closed. */ }
            await Deno.remove(socketDirectory, { recursive: true });
        }
        if (interrupted) return;
        const { BUILD_ID, REMOTE_PROTOCOL_VERSION } = await import("../build-identity.js");
        if (header.buildId !== BUILD_ID || header.protocol !== REMOTE_PROTOCOL_VERSION) {
            throw new Error("Remote supervisor build identity mismatch");
        }
        if (
            await control(
                header,
                "handshake",
                JSON.stringify({ buildId: BUILD_ID, protocol: REMOTE_PROTOCOL_VERSION }),
            ) || interrupted
        ) {
            return;
        }
        // The tty supplies terminal bytes, while the child's stdin pipe supplies
        // one configuration line followed by live input. This preserves a
        // separate bootstrap channel and leaves the TUI free to consume input.
        await stty("raw", "-echo");
        child = new Deno.Command(Deno.execPath(), {
            args: ["--remote-view"],
            stdin: "piped",
            stdout: "inherit",
            stderr: "inherit",
            detached: true,
        }).spawn();
        const view = child;
        void view.status.then(() => {
            childExited = true;
        });
        const writer = view.stdin.getWriter();
        await writer.write(encoder.encode(JSON.stringify(header.view) + "\n"));
        let stopped = false;
        const healthAbort = new AbortController();
        let wake: (() => void) | undefined;
        const ending = new Promise<void>((resolve) => {
            wake = resolve;
        });
        const stop = () => {
            stopped = true;
            healthAbort.abort();
            wake?.();
        };
        const onSignal = () => stop();
        Deno.addSignalListener("SIGINT", onSignal);
        Deno.addSignalListener("SIGTERM", onSignal);
        Deno.addSignalListener("SIGHUP", onSignal);
        // A separate owned process reads the terminal. A blocked tty read in
        // this supervisor would otherwise keep it alive after the TUI exits.
        inputPump = new Deno.Command("cat", {
            stdin: "inherit",
            stdout: "piped",
            stderr: "null",
            detached: true,
        }).spawn();
        const pump = inputPump;
        const inputReader = pump.stdout.getReader();
        const input = (async () => {
            try {
                while (true) {
                    const { done, value } = await inputReader.read();
                    if (done) break;
                    await writer.write(value);
                }
            } catch {
                /* TUI or terminal closed. */
            } finally {
                inputReader.releaseLock();
                stop();
            }
        })();
        // Admit terminal input only after the pump is running. The launcher
        // waits for readiness before showing the view or forwarding input.
        if (await control(header, "readiness") || interrupted) stop();
        const monitor = (async () => {
            let misses = 0;
            let nextCheck = Date.now() + PERIOD_MS;
            while (!stopped) {
                await Promise.race([
                    new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, nextCheck - Date.now()))),
                    ending,
                ]);
                if (stopped) break;
                nextCheck += PERIOD_MS;
                try {
                    if (await control(header, "health", undefined, healthAbort.signal)) {
                        stop();
                        break;
                    }
                    misses = 0;
                } catch {
                    if (stopped) break;
                    if (++misses >= 3) {
                        stop();
                        break;
                    }
                }
            }
        })();
        try {
            await Promise.race([view.status, ending]);
        } finally {
            stop();
            await monitor;
            await stopChild(pump, "terminal input");
            inputPumpStopped = true;
            await writer.abort().catch(() => undefined);
            await inputReader.cancel().catch(() => undefined);
            await input;
            Deno.removeSignalListener("SIGINT", onSignal);
            Deno.removeSignalListener("SIGTERM", onSignal);
            Deno.removeSignalListener("SIGHUP", onSignal);
            if (!childExited) await stopChild(view, "TUI");
            childStopped = true;
            await control(header, "shutdown").catch(() => undefined);
        }
    } finally {
        if (child && !childStopped && !childExited) await stopChild(child, "TUI").catch(() => undefined);
        if (inputPump && !inputPumpStopped) await stopChild(inputPump, "terminal input").catch(() => undefined);
        for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"] as const) {
            Deno.removeSignalListener(signal, onEarlyClosure);
        }
        try {
            listener.close();
        } catch { /* Already closed after admission. */ }
        await Deno.remove(socketDirectory, { recursive: true }).catch(() => undefined);
        await stty(originalMode).catch(() => undefined);
    }
}
