import { assertEquals } from "@std/assert";
import { prepareClaudeCliCommand, removeClaudeCliMcpConfigFile, removeClaudeCliPromptFile } from "./command.ts";

Deno.test("prepareClaudeCliCommand sets MCP tool idle timeout environment", async () => {
    const command = await prepareClaudeCliCommand({ selector: "sonnet", systemPrompt: "system" });
    try {
        assertEquals(Number(command.env.CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT) >= 600000, true);
    } finally {
        await removeClaudeCliPromptFile(command);
        await removeClaudeCliMcpConfigFile(command);
    }
});
