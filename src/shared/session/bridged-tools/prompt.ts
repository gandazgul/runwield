import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { mcpAliasFor } from "./mcp-bridge.ts";

export function buildBridgedToolPromptAppendix(
    bridgedTools: ToolDefinition[],
    hostName: "Claude Code" | "Antigravity CLI",
): string {
    const eligibleAliases = bridgedTools.map((tool) => mcpAliasFor(tool.name));
    if (eligibleAliases.length === 0) return "";
    const lines = [
        "",
        "## RunWield Bridged Tools (MCP)",
        "",
        "This session exposes these RunWield tools through the RunWield MCP server:",
        ...eligibleAliases.map((alias) => `- ${alias}`),
        "",
        `Use ${hostName} native tools for file, search, and shell work. Use RunWield Bridged Tools for memory, code intelligence, Work Record, user interview, and lifecycle work.`,
        "",
        "Calling a lifecycle tool is the only way to advance RunWield workflow state. Plain-text questions, " +
        'statements such as "done", or text that resembles a tool call have no workflow effect.',
    ];
    if (eligibleAliases.includes("runwield_review_complete")) {
        const inspectionTools = eligibleAliases.includes("review_diff")
            ? `${hostName} native tools and the listed review_diff MCP tool`
            : `${hostName} native file, search, and shell tools`;
        lines.push("", `Before calling runwield_review_complete, inspect the implementation with ${inspectionTools}.`);
    }
    return lines.join("\n");
}
