export interface ClaudeCliCommandRequest {
    selector: string;
    systemPrompt: string;
}

export interface PreparedClaudeCliCommand {
    command: "claude";
    args: string[];
    promptFilePath: string;
}

export async function prepareClaudeCliCommand(request: ClaudeCliCommandRequest): Promise<PreparedClaudeCliCommand> {
    const selector = request.selector.trim();
    if (!selector) throw new Error("Claude CLI model selector is required");
    const promptFilePath = await Deno.makeTempFile({ prefix: "runwield-claude-system-", suffix: ".md" });
    await Deno.writeTextFile(promptFilePath, request.systemPrompt, { mode: 0o600 });
    try {
        await Deno.chmod(promptFilePath, 0o600);
    } catch {
        // Best effort on platforms without chmod support.
    }
    return {
        command: "claude",
        args: [
            "-p",
            "--model",
            selector,
            "--output-format",
            "stream-json",
            "--verbose",
            "--include-partial-messages",
            "--no-session-persistence",
            "--append-system-prompt-file",
            promptFilePath,
        ],
        promptFilePath,
    };
}

export async function removeClaudeCliPromptFile(command: PreparedClaudeCliCommand): Promise<void> {
    try {
        await Deno.remove(command.promptFilePath);
    } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
}
