import { basename, dirname, isAbsolute, join, normalize } from "@std/path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { HelperBinaryExec } from "../helper-binary-exec.ts";

export interface MnemosyneToolHost {
    cwd: string;
    exec: HelperBinaryExec;
}

interface QueryParams {
    query: string;
}
interface WriteParams {
    action: "store" | "delete";
    content?: string;
    scope?: "project" | "global";
    core?: boolean;
    id?: number;
}

interface SearchSuccess {
    status: "success";
    text: string;
}

interface SearchFailure {
    status: "failure";
    message: string;
}

type SearchResult = SearchSuccess | SearchFailure;

export const MISSING_BINARY_MSG =
    "Error: mnemosyne binary not found. Rerun the RunWield installer to install required runtime helpers: curl -fsSL https://raw.githubusercontent.com/gandazgul/runwield/main/install.sh | bash";

export const memoryRecallToolDef = defineTool({
    name: "memory_recall",
    label: "Memory Recall",
    description:
        "Search project and global memory together. Results are grouped by provenance; project memories take precedence over conflicting global memories.",
    promptSnippet: "Search project and global memory for past context and decisions",
    parameters: Type.Object({ query: Type.String({ description: "Semantic search query" }) }),
    execute() {
        throw new Error("Not implemented");
    },
});

export const memoryWriteToolDef = defineTool({
    name: "memory_write",
    label: "Memory Write",
    description: "Store a project or global memory, or delete an outdated memory by document ID.",
    promptSnippet: "Store or delete memories; project scope is the default for store actions",
    promptGuidelines: [
        "Use memory_write with action=store to save important decisions, preferences, and context for future sessions.",
        "Store defaults to project scope. Set scope=global only for cross-project preferences and patterns.",
        "Use memory_write with action=delete only for outdated or incorrect memories, by document ID.",
        "Set core=true only for critical, always-relevant context. Keep core memories lean.",
    ],
    parameters: Type.Object({
        action: Type.Union([
            Type.Literal("store"),
            Type.Literal("delete"),
        ], { description: "Memory write action" }),
        content: Type.Optional(Type.String({ description: "Concise memory to store; required for action=store" })),
        scope: Type.Optional(Type.Union([
            Type.Literal("project"),
            Type.Literal("global"),
        ], { description: "Store scope. Defaults to project. Not used for delete." })),
        core: Type.Optional(
            Type.Boolean({ description: "If true, this memory is always injected into context. Use sparingly." }),
        ),
        id: Type.Optional(Type.Number({ description: "Document ID to delete; required for action=delete" })),
    }),
    execute() {
        throw new Error("Not implemented");
    },
});

export function normalizedProjectCollectionName(rawName: string): string {
    return rawName === "global" ? "default" : (rawName || "default");
}

export async function resolveProjectCollectionName(host: MnemosyneToolHost): Promise<string> {
    const cwd = host.cwd;
    const fallback = normalizedProjectCollectionName(basename(cwd));
    try {
        const result = await host.exec("git", ["rev-parse", "--git-common-dir"], { cwd });
        if (result.code !== 0) return fallback;
        const commonDir = result.stdout.trim().split(/\r?\n/).at(-1) || "";
        if (!commonDir) return fallback;
        const absoluteCommonDir = normalize(isAbsolute(commonDir) ? commonDir : join(cwd, commonDir));
        if (basename(absoluteCommonDir) !== ".git") return fallback;
        return normalizedProjectCollectionName(basename(dirname(absoluteCommonDir)));
    } catch {
        return fallback;
    }
}

export function createMnemosyneTools(host: MnemosyneToolHost): ToolDefinition[] {
    let collectionName: string | null = null;
    let initPromise: Promise<void> | null = null;

    async function projectName(): Promise<string> {
        if (collectionName) return collectionName;
        collectionName = await resolveProjectCollectionName(host);
        return collectionName;
    }

    async function mnemosyne(args: string[], signal?: AbortSignal): Promise<string> {
        try {
            const result = await host.exec("mnemosyne", args, { cwd: host.cwd, signal });
            if (result.code !== 0) {
                const errMsg = result.stderr.trim() || `mnemosyne ${args[0]} failed (exit ${result.code})`;
                if (
                    result.code === 127 || errMsg.includes("not found") || errMsg.includes("ENOENT") ||
                    errMsg.includes("No such file")
                ) {
                    return MISSING_BINARY_MSG;
                }
                throw new Error(errMsg);
            }
            return result.stdout || result.stderr || "";
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            if (msg.includes("not found") || msg.includes("ENOENT") || msg.includes("No such file")) {
                return MISSING_BINARY_MSG;
            }
            throw error;
        }
    }

    async function ensureProjectInitialized(signal?: AbortSignal): Promise<string> {
        const name = await projectName();
        initPromise ??= mnemosyne(["init", "--name", name], signal).then(() => undefined).catch(() => undefined);
        await initPromise;
        return name;
    }

    async function searchProject(name: string, safeQuery: string, signal?: AbortSignal): Promise<SearchResult> {
        try {
            const text = await mnemosyne(["search", "--name", name, "--format", "plain", safeQuery], signal);
            return { status: "success", text: text.trim() };
        } catch (error) {
            return { status: "failure", message: error instanceof Error ? error.message : String(error) };
        }
    }

    async function searchGlobal(safeQuery: string, signal?: AbortSignal): Promise<SearchResult> {
        try {
            const text = await mnemosyne(["search", "--global", "--format", "plain", safeQuery], signal);
            return { status: "success", text: text.trim() };
        } catch (error) {
            return { status: "failure", message: error instanceof Error ? error.message : String(error) };
        }
    }

    function formatMergedRecall(name: string, project: SearchResult, global: SearchResult): string {
        if (
            (project.status === "success" && project.text === MISSING_BINARY_MSG) ||
            (global.status === "success" && global.text === MISSING_BINARY_MSG)
        ) {
            return MISSING_BINARY_MSG;
        }

        const projectText = project.status === "success" ? project.text : "";
        const globalText = global.status === "success" ? global.text : "";
        if (project.status === "success" && global.status === "success" && !projectText && !globalText) {
            return "No memories found.";
        }

        const sections: string[] = [];
        if (project.status === "success") {
            sections.push(
                `Project memories (${name}) — these take precedence over global memories:\n${projectText || "None."}`,
            );
        } else {
            sections.push(`Project memory search failed: ${project.message}`);
        }
        if (global.status === "success") {
            sections.push(`Global memories (cross-project defaults):\n${globalText || "None."}`);
        } else {
            sections.push(`Global memory search failed: ${global.message}`);
        }
        return sections.join("\n\n");
    }

    function errorResult(message: string, details: WriteParams) {
        return { content: [{ type: "text" as const, text: `Error: ${message}` }], details };
    }

    return [
        {
            ...memoryRecallToolDef,
            async execute(_id, params, signal) {
                const typed = params as QueryParams;
                const name = await ensureProjectInitialized(signal);
                const safeQuery = `"${typed.query.replaceAll('"', '""')}"`;
                const [project, global] = await Promise.all([
                    searchProject(name, safeQuery, signal),
                    searchGlobal(safeQuery, signal),
                ]);
                return {
                    content: [{ type: "text" as const, text: formatMergedRecall(name, project, global) }],
                    details: typed,
                };
            },
        },
        {
            ...memoryWriteToolDef,
            async execute(_id, params, signal) {
                const typed = params as WriteParams;
                if (typed.action === "delete") {
                    if (typeof typed.id !== "number") return errorResult("id is required for delete.", typed);
                    const result = await mnemosyne(["delete", String(typed.id)], signal);
                    return {
                        content: [{ type: "text" as const, text: result.trim() || "Memory deleted." }],
                        details: typed,
                    };
                }

                if (typed.action !== "store") return errorResult("action must be store or delete.", typed);
                if (!typed.content) return errorResult("content is required for store.", typed);

                if (typed.scope === "global") {
                    await mnemosyne(["init", "--global"], signal).catch(() => "");
                    const args = ["add", "--global"];
                    if (typed.core) args.push("--tag", "core");
                    args.push(typed.content);
                    const result = await mnemosyne(args, signal);
                    return {
                        content: [{ type: "text" as const, text: result.trim() }],
                        details: typed,
                        callMessage: `Storing global memory:\n\n${typed.content}`,
                    };
                }

                const name = await ensureProjectInitialized(signal);
                const args = ["add", "--name", name];
                if (typed.core) args.push("--tag", "core");
                args.push(typed.content);
                const result = await mnemosyne(args, signal);
                return {
                    content: [{ type: "text" as const, text: result.trim() }],
                    details: typed,
                    callMessage: `Storing project memory:\n\n${typed.content}`,
                };
            },
        },
    ];
}
