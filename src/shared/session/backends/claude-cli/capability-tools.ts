import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createCymbalTools } from "../../../../extensions/cymbal/tools.ts";
import { denoHelperBinaryExec } from "../../../../extensions/helper-binary-exec.ts";
import { createKetchTools } from "../../../../extensions/ketch/tools.ts";
import { createMnemosyneTools } from "../../../../extensions/mnemosyne/tools.ts";

export const CLAUDE_CLI_CAPABILITY_TOOL_NAMES = [
    "memory",
    "code_search",
    "code_structure",
    "code_impls",
    "code_importers",
    "code_show",
    "code_outline",
    "code_batch",
    "code_refs",
    "code_impact",
    "code_trace",
    "code_investigate",
    "web_search",
    "web_fetch",
    "web_code_search",
    "web_docs_search",
] as const;

export function createClaudeCliCapabilityTools(options: { cwd: string }): ToolDefinition[] {
    const host = { cwd: options.cwd, exec: denoHelperBinaryExec };
    const tools = [...createMnemosyneTools(host), ...createCymbalTools(host), ...createKetchTools(host)];
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    return CLAUDE_CLI_CAPABILITY_TOOL_NAMES.map((name) => {
        const tool = byName.get(name);
        if (!tool) throw new Error(`missing Claude CLI capability tool: ${name}`);
        return tool;
    });
}
