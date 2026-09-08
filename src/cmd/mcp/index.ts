import { runAgyCliMcpSetupPrompt } from "../../shared/session/backends/agy-cli/mcp-setup.ts";
import { runRunWieldMcpStdioTransport } from "../../shared/session/bridged-tools/stdio-transport.ts";

function usageError(message: string): never {
    console.error(`[RunWield] ${message}`);
    console.error("Usage: wld mcp agy-cli [--setup]");
    Deno.exit(1);
}

function printMcpHelp(): void {
    console.log([
        "MCP",
        "",
        "Run a protocol-only MCP stdio adapter for an external CLI backend.",
        "",
        "Usage:",
        "  wld mcp agy-cli",
        "  wld mcp agy-cli --setup",
        "  wld mcp --help",
    ].join("\n"));
}

export async function runMcpCommand(argv: string[]): Promise<void> {
    const first = argv[0] || "";
    if (!first || first === "--help" || first === "-h" || first === "help") {
        printMcpHelp();
        return;
    }
    if (first !== "agy-cli") usageError(`Unknown MCP adapter: ${first}`);
    const options = argv.slice(1);
    if (options.length === 1 && options[0] === "--setup") {
        const code = await runAgyCliMcpSetupPrompt();
        if (code !== 0) Deno.exit(code);
        return;
    }
    if (options.length > 0) usageError(`Unknown MCP option: ${options[0]}`);
    await runRunWieldMcpStdioTransport();
}

export async function getMcpCompletions(argumentPrefix: string) {
    await Promise.resolve();
    const entries = [
        { value: "agy-cli", label: "agy-cli", description: "Run Antigravity CLI MCP stdio adapter" },
        { value: "--setup", label: "--setup", description: "Approve persistent Antigravity MCP setup" },
    ];
    return entries.filter((entry) => entry.value.startsWith(argumentPrefix));
}
