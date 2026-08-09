export interface ClaudeCliCommandRequest {
    selector: string;
    systemPrompt: string;
    /** JSON content of the additive Claude MCP config (mcpServers map). */
    mcpConfig?: string;
    /** Claude Code tool names pre-authorized for this non-interactive turn. */
    allowedToolNames?: readonly string[];
}

export interface PreparedClaudeCliCommand {
    command: "claude";
    args: string[];
    promptFilePath: string;
    env: Record<string, string>;
    /** Owner-only temporary MCP config file path, when mcpConfig was supplied. */
    mcpConfigPath?: string;
}

const CLAUDE_CLI_PROJECT_TOOL_NAMES = [
    "Read",
    "Write",
    "Edit",
    "MultiEdit",
    "Bash",
    "Glob",
    "Grep",
    "LS",
    "TodoWrite",
    "Task",
    "WebFetch",
    "WebSearch",
    "NotebookRead",
    "NotebookEdit",
    "EnterWorktree",
];

async function writeOwnerOnlyTempFile(prefix: string, suffix: string, content: string): Promise<string> {
    const path = await Deno.makeTempFile({ prefix, suffix });
    await Deno.writeTextFile(path, content, { mode: 0o600 });
    try {
        await Deno.chmod(path, 0o600);
    } catch {
        // Best effort on platforms without chmod support.
    }
    return path;
}

export async function prepareClaudeCliCommand(request: ClaudeCliCommandRequest): Promise<PreparedClaudeCliCommand> {
    const selector = request.selector.trim();
    if (!selector) throw new Error("Claude CLI model selector is required");
    const promptFilePath = await writeOwnerOnlyTempFile("runwield-claude-system-", ".md", request.systemPrompt);
    const args = [
        "-p",
        "--model",
        selector,
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--no-session-persistence",
        "--permission-mode",
        "acceptEdits",
        "--append-system-prompt-file",
        promptFilePath,
    ];
    let mcpConfigPath: string | undefined;
    if (request.mcpConfig) {
        mcpConfigPath = await writeOwnerOnlyTempFile("runwield-claude-mcp-", ".json", request.mcpConfig);
        // Additive on purpose: user/project MCP servers must stay available, so
        // `--strict-mcp-config` is deliberately never passed.
        args.push("--mcp-config", mcpConfigPath);
    }
    const allowedToolNames = [
        ...new Set([
            ...CLAUDE_CLI_PROJECT_TOOL_NAMES,
            ...(request.allowedToolNames || []),
        ]),
    ].filter((name) => name.trim().length > 0);
    args.push("--allowedTools", ...allowedToolNames);
    return {
        command: "claude",
        args,
        promptFilePath,
        env: { CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT: "600000" },
        ...(mcpConfigPath ? { mcpConfigPath } : {}),
    };
}

export async function removeClaudeCliPromptFile(command: PreparedClaudeCliCommand): Promise<void> {
    try {
        await Deno.remove(command.promptFilePath);
    } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
}

export async function removeClaudeCliMcpConfigFile(command: PreparedClaudeCliCommand): Promise<void> {
    if (!command.mcpConfigPath) return;
    try {
        await Deno.remove(command.mcpConfigPath);
    } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
}
