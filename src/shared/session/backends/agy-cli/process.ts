import type { PreparedAgyCliCommand } from "./command.ts";

export interface AgyCliProcessResult {
    stdout: ReadableStream<Uint8Array>;
    stderrText: Promise<string>;
    completed: Promise<Deno.CommandStatus>;
    kill(): void;
}

export class DenoAgyCliProcessPort {
    run(command: PreparedAgyCliCommand, cwd: string, signal?: AbortSignal): AgyCliProcessResult {
        let child: Deno.ChildProcess;
        try {
            child = new Deno.Command(command.command, {
                args: command.args,
                cwd,
                stdin: "null",
                stdout: "piped",
                stderr: "piped",
                env: command.env,
                signal,
            }).spawn();
        } catch (error) {
            if (error instanceof Deno.errors.NotFound) throw new Error("Agy executable was not found");
            throw error;
        }
        return {
            stdout: child.stdout,
            stderrText: new Response(child.stderr).text(),
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
