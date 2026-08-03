/** External Mnemosyne process capability used by Work Record indexing. */

export interface MnemosyneCommandResult {
    success: boolean;
    code: number;
    stdout: Uint8Array;
    stderr: Uint8Array;
}

export interface WorkRecordMnemosynePort {
    run(args: string[], options?: { cwd?: string }): Promise<MnemosyneCommandResult>;
}

export const SYSTEM_WORK_RECORD_MNEMOSYNE_PORT: WorkRecordMnemosynePort = {
    run: (args, options) =>
        new Deno.Command("mnemosyne", {
            args,
            cwd: options?.cwd,
            stdout: "piped",
            stderr: "piped",
        }).output(),
};
