import type { PreparedClaudeCliCommand } from "./command.ts";

export interface ClaudeCliProcessResult {
    success: boolean;
    code: number;
    stdout: ReadableStream<Uint8Array>;
    stderrText: Promise<string>;
    completed: Promise<Deno.CommandStatus>;
}

export class DenoClaudeCliProcessPort {
    run(
        command: PreparedClaudeCliCommand,
        stdinText: string,
        cwd: string,
        signal?: AbortSignal,
    ): ClaudeCliProcessResult {
        const child = new Deno.Command(command.command, {
            args: command.args,
            cwd,
            stdin: "piped",
            stdout: "piped",
            stderr: "piped",
            signal,
        }).spawn();
        const writer = child.stdin.getWriter();
        const stdin = new TextEncoder().encode(stdinText);
        const stdinClosed = writer.write(stdin).then(() => writer.close());
        const stderrText = new Response(child.stderr).text();
        const completed = stdinClosed.then(() => child.status);
        return {
            success: true,
            code: 0,
            stdout: child.stdout,
            stderrText,
            completed,
        };
    }
}
