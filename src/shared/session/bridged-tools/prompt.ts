import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { mcpAliasFor } from "./mcp-bridge.ts";

export function buildBridgedToolPromptAppendix(
    bridgedTools: ToolDefinition[],
    hostName: "Claude Code" | "Antigravity CLI",
    declaredTools?: string[],
): string {
    const eligibleAliases = bridgedTools.map((tool) => mcpAliasFor(tool.name));
    let nativeTools = "";
    if (hostName === "Antigravity CLI") {
        if (!declaredTools) {
            nativeTools =
                "\n\nAntigravity native tools differ from RunWield's tool names: use run_command for bash/shell commands, " +
                "write_to_file to create new files (not multi_file_edit), view_file to read, and " +
                "replace_file_content to edit. Run tests with run_command when it is available. " +
                "Before reporting a missing capability, check the native tools declared for this turn; " +
                "RunWield MCP multi_file_edit only changes existing files.";
        } else {
            const declared = new Set(declaredTools);
            const clauses: string[] = [];
            if (declared.has("bash") || declared.has("run_command")) {
                clauses.push("use run_command for bash/shell commands");
            }
            if (declared.has("write") || declared.has("write_docs") || declared.has("write_to_file")) {
                clauses.push("write_to_file to create new files (not multi_file_edit)");
            }
            if (declared.has("read") || declared.has("view") || declared.has("view_file")) {
                clauses.push("view_file to read");
            }
            if (
                declared.has("edit") || declared.has("edit_docs") || declared.has("multi_file_edit") ||
                declared.has("replace_file_content")
            ) {
                clauses.push("replace_file_content to edit");
            }
            if (clauses.length === 0) clauses.push("view_file to read");
            const testNote = declared.has("bash") || declared.has("run_command")
                ? " Run tests with run_command when it is available."
                : "";
            nativeTools =
                `\n\nAntigravity native tools differ from RunWield's tool names: ${clauses.join(", ")}.${testNote} ` +
                "Before reporting a missing capability, check the native tools declared for this turn; " +
                "RunWield MCP multi_file_edit only changes existing files.";
        }
    }
    if (eligibleAliases.length === 0) return nativeTools;
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
        "",
        "If a task is blocked by missing credentials, permissions, or unavailable services, report the blocker in text " +
        "instead of calling a lifecycle completion tool.",
    ];
    if (eligibleAliases.includes("runwield_review_complete")) {
        const inspectionTools = eligibleAliases.includes("review_diff")
            ? "review_diff and the host's native file tools"
            : `${hostName} native file, search, and shell tools`;
        lines.push("", `Before calling runwield_review_complete, inspect the implementation with ${inspectionTools}.`);
    }
    return lines.join("\n") + nativeTools;
}
