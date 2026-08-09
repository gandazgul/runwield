export interface HelperBinaryExecResult {
    code: number;
    stdout: string;
    stderr: string;
}

export interface HelperBinaryExecOptions {
    cwd: string;
    signal?: AbortSignal;
}

export type HelperBinaryExec = (
    command: string,
    args: string[],
    options: HelperBinaryExecOptions,
) => Promise<HelperBinaryExecResult>;

export const denoHelperBinaryExec: HelperBinaryExec = async (command, args, options) => {
    try {
        const output = await new Deno.Command(command, {
            args,
            cwd: options.cwd,
            stdout: "piped",
            stderr: "piped",
            signal: options.signal,
        }).output();
        const decoder = new TextDecoder();
        return {
            code: output.code,
            stdout: decoder.decode(output.stdout),
            stderr: decoder.decode(output.stderr),
        };
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
            return {
                code: 127,
                stdout: "",
                stderr: `${command}: command not found`,
            };
        }
        throw error;
    }
};
