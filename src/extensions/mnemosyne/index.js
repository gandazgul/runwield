/**
 * @module extensions/mnemosyne
 * Mnemosyne memory extension for Harns agent invocations.
 */

import { basename } from "@std/path";
import { Type } from "@sinclair/typebox";
import { defineTool } from "@mariozechner/pi-coding-agent";

const MISSING_BINARY_MSG =
    "Error: mnemosyne binary not found. Install it: https://github.com/gandazgul/mnemosyne#quick-start";

export const memoryRecallToolDef = defineTool({
    name: "memory_recall",
    label: "Memory Recall",
    description: "Search project memory for relevant context, past decisions, and preferences.",
    promptSnippet: "Search project memory for past context and decisions",
    parameters: Type.Object({
        query: Type.String({ description: "Semantic search query" }),
    }),
    execute() {
        throw new Error("Not implemented");
    },
});

export const memoryRecallGlobalToolDef = defineTool({
    name: "memory_recall_global",
    label: "Memory Recall Global",
    description: "Search global memory for cross-project preferences, decisions and patterns.",
    promptSnippet: "Search global memory for cross-project preferences",
    parameters: Type.Object({
        query: Type.String({ description: "Semantic search query" }),
    }),
    execute() {
        throw new Error("Not implemented");
    },
});

export const memoryStoreToolDef = defineTool({
    name: "memory_store",
    label: "Memory Store",
    description: "Store a project memory. Set core=true for critical always-in-context memory.",
    promptSnippet: "Store a project-scoped memory (decision, preference, context)",
    promptGuidelines: [
        "Use memory_store to save important decisions, preferences, and context for future sessions.",
        "Set core=true only for critical, always-relevant context. Keep core memories lean.",
    ],
    parameters: Type.Object({
        content: Type.String({ description: "Concise memory to store" }),
        core: Type.Optional(
            Type.Boolean({
                description: "If true, this memory is always injected into context. Use sparingly.",
            }),
        ),
    }),
    execute() {
        throw new Error("Not implemented");
    },
});

export const memoryStoreGlobalToolDef = defineTool({
    name: "memory_store_global",
    label: "Memory Store Global",
    description: "Store a global memory. Set core=true for critical cross-project context.",
    promptSnippet: "Store a cross-project memory (coding style, tool choices)",
    parameters: Type.Object({
        content: Type.String({ description: "Global memory to store" }),
        core: Type.Optional(
            Type.Boolean({
                description: "If true, this memory is always injected into context. Use sparingly.",
            }),
        ),
    }),
    execute() {
        throw new Error("Not implemented");
    },
});

export const memoryDeleteToolDef = defineTool({
    name: "memory_delete",
    label: "Memory Delete",
    description: "Delete an outdated or incorrect memory by its document ID.",
    promptSnippet: "Delete an outdated memory by its document ID",
    parameters: Type.Object({
        id: Type.Number({ description: "Document ID to delete" }),
    }),
    execute() {
        throw new Error("Not implemented");
    },
});

/**
 * Register Mnemosyne lifecycle hooks and memory tools.
 *
 * @param {import('@mariozechner/pi-coding-agent').ExtensionAPI} pi
 */
export default function mnemosyneExtension(pi) {
    let projectName = "default";
    let projectCwd = Deno.cwd();

    /**
     * @param {...string} args
     * @returns {Promise<string>}
     */
    async function mnemosyne(...args) {
        try {
            const result = await pi.exec("mnemosyne", args, { cwd: projectCwd });

            if (result.code !== 0) {
                const errMsg = result.stderr.trim() ||
                    `mnemosyne ${args[0]} failed (exit ${result.code})`;
                if (
                    result.code === 127 || errMsg.includes("not found") ||
                    errMsg.includes("ENOENT") || errMsg.includes("No such file")
                ) {
                    return MISSING_BINARY_MSG;
                }
                throw new Error(errMsg);
            }

            return result.stdout || result.stderr || "";
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            if (
                msg.includes("not found") || msg.includes("ENOENT") ||
                msg.includes("No such file")
            ) {
                return MISSING_BINARY_MSG;
            }
            throw error;
        }
    }

    pi.on("session_start", async (_event, ctx) => {
        projectCwd = ctx.cwd;

        const rawName = basename(projectCwd);
        projectName = rawName === "global" ? "default" : (rawName || "default");

        // Auto-init project collection (idempotent).
        try {
            await mnemosyne("init", "--name", projectName);
        } catch {
            // Best effort.
        }
    });

    pi.registerTool({
        ...memoryRecallToolDef,
        async execute(_toolCallId, params) {
            const safeQuery = `"${params.query.replaceAll('"', '""')}"`;
            const result = await mnemosyne(
                "search",
                "--name",
                projectName,
                "--format",
                "plain",
                safeQuery,
            );
            return {
                content: [{
                    type: "text",
                    text: result.trim() || "No memories found.",
                }],
                details: params,
            };
        },
    });

    pi.registerTool({
        ...memoryRecallGlobalToolDef,
        async execute(_toolCallId, params) {
            const safeQuery = `"${params.query.replaceAll('"', '""')}"`;
            const result = await mnemosyne(
                "search",
                "--global",
                "--format",
                "plain",
                safeQuery,
            );
            return {
                content: [{
                    type: "text",
                    text: result.trim() || "No global memories found.",
                }],
                details: params,
            };
        },
    });

    pi.registerTool({
        ...memoryStoreToolDef,
        async execute(_toolCallId, params) {
            const args = ["add", "--name", projectName];
            if (params.core) args.push("--tag", "core");
            args.push(params.content);

            const result = await mnemosyne(...args);

            return {
                content: [{ type: "text", text: result.trim() }],
                details: params,
                callMessage: `Storing project memory:\n\n${params.content}`,
            };
        },
    });

    pi.registerTool({
        ...memoryStoreGlobalToolDef,
        async execute(_toolCallId, params) {
            try {
                await mnemosyne("init", "--global");
            } catch {
                // Already initialized / best effort.
            }

            const args = ["add", "--global"];
            if (params.core) args.push("--tag", "core");
            args.push(params.content);

            const result = await mnemosyne(...args);

            return {
                content: [{ type: "text", text: result.trim() }],
                details: params,
                callMessage: `Storing global memory:\n\n${params.content}`,
            };
        },
    });

    pi.registerTool({
        ...memoryDeleteToolDef,
        async execute(_toolCallId, params) {
            const result = await mnemosyne("delete", String(params.id));

            return {
                content: [{ type: "text", text: result.trim() || "Memory deleted." }],
                details: params,
            };
        },
    });
}
