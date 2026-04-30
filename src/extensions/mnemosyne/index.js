/**
 * @module extensions/mnemosyne
 * Mnemosyne memory extension for Harns agent invocations.
 */

import { basename } from "@std/path";
import { Type } from "@sinclair/typebox";

const MISSING_BINARY_MSG =
    "Error: mnemosyne binary not found. Install it: https://github.com/gandazgul/mnemosyne#quick-start";

/**
 * Register Mnemosyne lifecycle hooks and memory tools.
 *
 * @param {import('@mariozechner/pi-coding-agent').ExtensionAPI} pi
 */
export default function mnemosyneExtension(pi) {
    let projectName = "default";
    let projectCwd = Deno.cwd();

    let cachedCoreBlock = "";
    let cacheValid = false;

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

    /** @returns {Promise<string>} */
    async function fetchCoreMemories() {
        const sections = [];

        try {
            const localCore = await mnemosyne(
                "list",
                "--name",
                projectName,
                "--tag",
                "core",
                "--format",
                "plain",
            );
            const trimmed = localCore.trim();
            if (
                trimmed && !trimmed.startsWith("No documents") &&
                !trimmed.startsWith("Error:")
            ) {
                sections.push(`Project Core Memories (${projectName}):\n\n${trimmed}`);
            }
        } catch {
            // Best effort.
        }

        try {
            const globalCore = await mnemosyne(
                "list",
                "--global",
                "--tag",
                "core",
                "--format",
                "plain",
            );
            const trimmed = globalCore.trim();
            if (
                trimmed && !trimmed.startsWith("No documents") &&
                !trimmed.startsWith("Error:")
            ) {
                sections.push(`Global Core Memories:\n\n${trimmed}`);
            }
        } catch {
            // Best effort.
        }

        const memoriesBlock = sections.length > 0 ? `\n\n${sections.join("\n\n")}` : "";

        return `\n\n${memoriesBlock}

When to use memory:
- Search memory when past context would help answer the user's request.
- Store concise summaries of important decisions, preferences, and patterns.
- Delete outdated or incorrect memories by their ID (shown in [brackets] in recall/list output).
- Use **core** for facts that should always be in context (project architecture, key conventions, user preferences).
- Use **global** variants for cross-project preferences (coding style, tool choices).
- At the end of a conversation, store any relevant memories for future use.`;
    }

    /** @returns {Promise<void>} */
    async function ensureCacheValid() {
        if (cacheValid) return;
        cachedCoreBlock = await fetchCoreMemories();
        cacheValid = true;
    }

    function invalidateCache() {
        cacheValid = false;
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

        invalidateCache();
        await ensureCacheValid();
    });

    pi.on("before_agent_start", async (event) => {
        await ensureCacheValid();

        return {
            systemPrompt: event.systemPrompt + cachedCoreBlock,
        };
    });

    pi.registerTool({
        name: "memory_recall",
        label: "Memory Recall",
        description: "Search project memory for relevant context, past decisions, and preferences.",
        promptSnippet: "Search project memory for past context and decisions",
        parameters: Type.Object({
            query: Type.String({ description: "Semantic search query" }),
        }),
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
        name: "memory_recall_global",
        label: "Memory Recall Global",
        description: "Search global memory for cross-project preferences, decisions and patterns.",
        promptSnippet: "Search global memory for cross-project preferences",
        parameters: Type.Object({
            query: Type.String({ description: "Semantic search query" }),
        }),
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
        async execute(_toolCallId, params) {
            const args = ["add", "--name", projectName];
            if (params.core) args.push("--tag", "core");
            args.push(params.content);

            const result = await mnemosyne(...args);
            if (params.core) invalidateCache();

            return {
                content: [{ type: "text", text: result.trim() }],
                details: params,
                callMessage: `Storing project memory:\n\n${params.content}`,
            };
        },
    });

    pi.registerTool({
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
            if (params.core) invalidateCache();

            return {
                content: [{ type: "text", text: result.trim() }],
                details: params,
                callMessage: `Storing global memory:\n\n${params.content}`,
            };
        },
    });

    pi.registerTool({
        name: "memory_delete",
        label: "Memory Delete",
        description: "Delete an outdated or incorrect memory by its document ID.",
        promptSnippet: "Delete an outdated memory by its document ID",
        parameters: Type.Object({
            id: Type.Number({ description: "Document ID to delete" }),
        }),
        async execute(_toolCallId, params) {
            const result = await mnemosyne("delete", String(params.id));
            invalidateCache();

            return {
                content: [{ type: "text", text: result.trim() || "Memory deleted." }],
                details: params,
            };
        },
    });
}
