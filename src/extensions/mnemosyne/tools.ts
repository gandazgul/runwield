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
interface StoreParams {
    content: string;
    core?: boolean;
}
interface DeleteParams {
    id: number;
}

export const MISSING_BINARY_MSG =
    "Error: mnemosyne binary not found. Rerun the RunWield installer to install required runtime helpers: curl -fsSL https://raw.githubusercontent.com/gandazgul/runwield/main/install.sh | bash";

export const memoryRecallToolDef = defineTool({
    name: "memory_recall",
    label: "Memory Recall",
    description: "Search project memory for relevant context, past decisions, and preferences.",
    promptSnippet: "Search project memory for past context and decisions",
    parameters: Type.Object({ query: Type.String({ description: "Semantic search query" }) }),
    execute() {
        throw new Error("Not implemented");
    },
});

export const memoryRecallGlobalToolDef = defineTool({
    name: "memory_recall_global",
    label: "Memory Recall Global",
    description: "Search global memory for cross-project preferences, decisions and patterns.",
    promptSnippet: "Search global memory for cross-project preferences",
    parameters: Type.Object({ query: Type.String({ description: "Semantic search query" }) }),
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
            Type.Boolean({ description: "If true, this memory is always injected into context. Use sparingly." }),
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
            Type.Boolean({ description: "If true, this memory is always injected into context. Use sparingly." }),
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
    parameters: Type.Object({ id: Type.Number({ description: "Document ID to delete" }) }),
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

    return [
        {
            ...memoryRecallToolDef,
            async execute(_id, params, signal) {
                const typed = params as QueryParams;
                const name = await ensureProjectInitialized(signal);
                const safeQuery = `"${typed.query.replaceAll('"', '""')}"`;
                const result = await mnemosyne(["search", "--name", name, "--format", "plain", safeQuery], signal);
                return {
                    content: [{ type: "text" as const, text: result.trim() || "No memories found." }],
                    details: typed,
                };
            },
        },
        {
            ...memoryRecallGlobalToolDef,
            async execute(_id, params, signal) {
                const typed = params as QueryParams;
                const safeQuery = `"${typed.query.replaceAll('"', '""')}"`;
                const result = await mnemosyne(["search", "--global", "--format", "plain", safeQuery], signal);
                return {
                    content: [{ type: "text" as const, text: result.trim() || "No global memories found." }],
                    details: typed,
                };
            },
        },
        {
            ...memoryStoreToolDef,
            async execute(_id, params, signal) {
                const typed = params as StoreParams;
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
        {
            ...memoryStoreGlobalToolDef,
            async execute(_id, params, signal) {
                const typed = params as StoreParams;
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
            },
        },
        {
            ...memoryDeleteToolDef,
            async execute(_id, params, signal) {
                const typed = params as DeleteParams;
                const result = await mnemosyne(["delete", String(typed.id)], signal);
                return {
                    content: [{ type: "text" as const, text: result.trim() || "Memory deleted." }],
                    details: typed,
                };
            },
        },
    ];
}
