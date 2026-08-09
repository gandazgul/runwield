import type { PreparedClaudeCliCommand } from "./command.ts";
import { ClaudeCliBackendError } from "./failure.ts";

export interface ClaudeCliProcessResult {
    success: boolean;
    code: number;
    stdout: ReadableStream<Uint8Array>;
    stderrText: Promise<string>;
    completed: Promise<Deno.CommandStatus>;
    kill(): void;
}

export class DenoClaudeCliProcessPort {
    run(
        command: PreparedClaudeCliCommand,
        stdinText: string,
        cwd: string,
        signal?: AbortSignal,
    ): ClaudeCliProcessResult {
        let child: Deno.ChildProcess;
        try {
            child = new Deno.Command(command.command, {
                args: command.args,
                cwd,
                stdin: "piped",
                stdout: "piped",
                stderr: "piped",
                env: command.env,
                signal,
            }).spawn();
        } catch (error) {
            if (error instanceof Deno.errors.NotFound) {
                throw new ClaudeCliBackendError("missing_executable");
            }
            throw error;
        }
        const writer = child.stdin.getWriter();
        const stdin = new TextEncoder().encode(stdinText);
        writer.write(stdin)
            .then(() => writer.close())
            .catch(() => undefined);
        const stderrText = new Response(child.stderr).text();
        return {
            success: true,
            code: 0,
            stdout: child.stdout,
            stderrText,
            completed: child.status,
            kill() {
                try {
                    child.kill("SIGKILL");
                } catch {
                    // The child may have already exited.
                }
            },
        };
    }
}
