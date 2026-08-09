import { assertEquals } from "@std/assert";
import { withProcessGlobalTestLock } from "../../../../testing/process-global-lock.js";
import { prepareClaudeCliCommand, removeClaudeCliMcpConfigFile, removeClaudeCliPromptFile } from "./command.ts";

async function disposePreparedCommand(command: Awaited<ReturnType<typeof prepareClaudeCliCommand>>): Promise<void> {
    await removeClaudeCliPromptFile(command);
    await removeClaudeCliMcpConfigFile(command);
}

Deno.test("prepareClaudeCliCommand sets MCP tool idle timeout environment", async () => {
    await withProcessGlobalTestLock(async () => {
        const prior = Deno.env.get("CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT");
        Deno.env.delete("CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT");
        const command = await prepareClaudeCliCommand({ selector: "sonnet", systemPrompt: "system" });
        try {
            assertEquals(Number(command.env.CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT) >= 600000, true);
        } finally {
            await disposePreparedCommand(command);
            if (prior === undefined) Deno.env.delete("CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT");
            else Deno.env.set("CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT", prior);
        }
    });
});

Deno.test("prepareClaudeCliCommand preserves a longer inherited MCP tool idle timeout", async () => {
    await withProcessGlobalTestLock(async () => {
        const prior = Deno.env.get("CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT");
        Deno.env.set("CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT", "900000");
        const command = await prepareClaudeCliCommand({ selector: "sonnet", systemPrompt: "system" });
        try {
            assertEquals(command.env.CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT, "900000");
        } finally {
            await disposePreparedCommand(command);
            if (prior === undefined) Deno.env.delete("CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT");
            else Deno.env.set("CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT", prior);
        }
    });
});
