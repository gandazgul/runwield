import { spawnForegroundProcess } from "../../../foreground-process.ts";
import type { ForegroundTermination } from "../../../foreground-process.ts";
import type { PreparedAgyCliCommand } from "./command.ts";
import { AgyCliBackendError } from "./failure.ts";

export interface AgyCliProcessStatus {
    success: boolean;
    code: number | null;
    terminatedBy: ForegroundTermination | null;
}

export interface AgyCliProcessResult {
    pid: number | null;
    stdout: ReadableStream<Uint8Array>;
    stderrText: Promise<string>;
    completed: Promise<AgyCliProcessStatus>;
    kill(): void;
}

export class DenoAgyCliProcessPort {
    run(command: PreparedAgyCliCommand, cwd: string, signal?: AbortSignal): AgyCliProcessResult {
        const localAbort = new AbortController();
        const combinedSignal = signal ? AbortSignal.any([signal, localAbort.signal]) : localAbort.signal;
        let process: ReturnType<typeof spawnForegroundProcess>;
        try {
            process = spawnForegroundProcess({
                command: command.command,
                args: command.args,
                cwd,
                env: command.env,
                signal: combinedSignal,
                timeoutMs: command.timeoutMs,
            });
        } catch (error) {
            if (error instanceof Deno.errors.NotFound) throw new AgyCliBackendError("missing_executable");
            throw error;
        }
        return {
            pid: process.pid,
            stdout: process.stdout,
            stderrText: new Response(process.stderr).text(),
            completed: process.done.then((outcome) => ({
                success: outcome.terminatedBy === null && outcome.exitCode === 0,
                code: outcome.exitCode,
                terminatedBy: outcome.terminatedBy,
            })),
            kill() {
                localAbort.abort();
                process.kill();
            },
        };
    }
}
