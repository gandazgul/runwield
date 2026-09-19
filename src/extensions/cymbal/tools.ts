import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { HelperBinaryExec } from "../helper-binary-exec.ts";

export interface CymbalToolHost {
    cwd: string;
    exec: HelperBinaryExec;
}

export const MAX_CODE_BATCH_OPERATIONS = 5;
export const MAX_CODE_BATCH_OUTPUT_CHARS = 50_000;

const codeBatchShowOperationSchema = Type.Object({
    op: Type.Literal("show"),
    target: Type.String({ description: "Symbol name or file path (e.g. file.js:10-20) to show." }),
}, { additionalProperties: false });
const codeBatchOutlineOperationSchema = Type.Object({
    op: Type.Literal("outline"),
    file: Type.String({ description: "File path to outline." }),
}, { additionalProperties: false });
const codeBatchOperationSchema = Type.Union([codeBatchShowOperationSchema, codeBatchOutlineOperationSchema]);
const codeBatchParametersSchema = Type.Object({
    operations: Type.Array(codeBatchOperationSchema, {
        minItems: 1,
        maxItems: MAX_CODE_BATCH_OPERATIONS,
        description:
            "One to five known code show/outline reads. Results follow request order. Search is not supported.",
    }),
}, { additionalProperties: false });

type CodeBatchOperation = { op: "show"; target: string } | { op: "outline"; file: string };
interface CodeBatchParams {
    operations: CodeBatchOperation[];
}
interface SearchParams {
    query: string;
    textSearch?: boolean;
}
interface SymbolParams {
    symbol: string;
}
interface TargetParams {
    target: string;
}
interface FileParams {
    file: string;
}
interface InputRecord {
    op?: string;
    target?: string;
    file?: string;
}

interface CymbalSourceLine {
    line: number;
    content: string;
}

interface CymbalOutlineSymbol {
    name: string;
    kind: string;
    start_line: number;
    end_line: number;
    depth?: number;
}

interface CymbalShowResult {
    error?: string;
    file?: string;
    lines?: CymbalSourceLine[];
    match_count?: number;
    also?: CymbalSymbolLocation[];
}

interface CymbalSymbolLocation extends CymbalOutlineSymbol {
    file: string;
    rel_path?: string;
}

type CymbalBatchEntry = CymbalShowResult | CymbalOutlineSymbol[] | null;

interface CymbalBatchResponse {
    results: Record<string, CymbalBatchEntry>;
}

function codeBatchTarget(operation: CodeBatchOperation): string {
    return operation.op === "show" ? operation.target : operation.file;
}

function formatNativeBatchEntry(entry: CymbalBatchEntry, op: CodeBatchOperation["op"]): string {
    if (entry === null) return "No results found.";
    if (typeof entry !== "object") throw new Error("Invalid result entry");
    if (!Array.isArray(entry) && typeof entry.error === "string") return `Error: ${entry.error}`;
    if (op === "outline" && Array.isArray(entry)) {
        return entry.map((symbol) => {
            if (
                !symbol || typeof symbol.name !== "string" || typeof symbol.kind !== "string" ||
                !Number.isInteger(symbol.start_line) || !Number.isInteger(symbol.end_line)
            ) throw new Error("Invalid outline symbol");
            const depth = Number.isInteger(symbol.depth) ? Math.max(0, Math.min(symbol.depth ?? 0, 20)) : 0;
            return `${"  ".repeat(depth)}${symbol.kind} ${symbol.name} (L${symbol.start_line}-${symbol.end_line})`;
        }).join("\n") || "No results found.";
    }
    if (op === "show" && !Array.isArray(entry) && typeof entry.file === "string" && Array.isArray(entry.lines)) {
        const lines = entry.lines.map((line) => {
            if (!line || !Number.isInteger(line.line) || typeof line.content !== "string") {
                throw new Error("Invalid source line");
            }
            return `${line.line}: ${line.content}`;
        });
        const result = [`file: ${entry.file}`, ...lines];
        if (typeof entry.match_count === "number" && entry.match_count > 1) {
            result.push(
                `\n${entry.match_count} matching definitions; showing the first. Use a file-qualified target to disambiguate.`,
            );
        }
        if (Array.isArray(entry.also)) {
            for (const symbol of entry.also) {
                if (!symbol || typeof symbol.file !== "string" || !Number.isInteger(symbol.start_line)) {
                    throw new Error("Invalid alternative definition");
                }
                result.push(`Also: ${symbol.rel_path || symbol.file}:${symbol.start_line}`);
            }
        }
        return result.join("\n");
    }
    throw new Error("Unexpected result shape");
}

function parseNativeBatchResults(output: string, targets: string[], op: CodeBatchOperation["op"]): Map<string, string> {
    const results = new Map<string, string>();
    let response: CymbalBatchResponse;
    try {
        response = JSON.parse(output);
        if (
            !response || typeof response !== "object" || !response.results ||
            typeof response.results !== "object" || Array.isArray(response.results)
        ) throw new Error("Missing results map");
    } catch {
        const message = output.startsWith("Error") ? output : "Error: Cymbal returned invalid batch JSON.";
        return new Map(targets.map((target) => [target, message]));
    }
    for (const target of targets) {
        if (!Object.hasOwn(response.results, target)) {
            results.set(target, "Error: Cymbal omitted this target from its batch response.");
            continue;
        }
        try {
            results.set(target, formatNativeBatchEntry(response.results[target], op));
        } catch {
            results.set(target, "Error: Cymbal returned an invalid result for this target.");
        }
    }
    return results;
}

export const codeSearchToolDef = defineTool({
    name: "code_search",
    label: "Code Search",
    description: "Search for symbols or full text using cymbal.",
    promptSnippet: "Search project code and symbols efficiently",
    parameters: Type.Object({
        query: Type.String({
            description: "Symbol name or search query. DO NOT use spaces unless you want an exact phrase match.",
        }),
        textSearch: Type.Optional(
            Type.Boolean({ description: "Set to true to perform a full-text regex grep instead of symbol search." }),
        ),
    }),
    execute() {
        throw new Error("Not implemented");
    },
});
export const codeStructureToolDef = defineTool({
    name: "code_structure",
    label: "Code Structure",
    description:
        "Show the structural shape of the indexed codebase (entry points, most referenced symbols, largest packages).",
    promptSnippet: "Show the structural shape of the codebase",
    parameters: Type.Object({}),
    execute() {
        throw new Error("Not implemented");
    },
});
export const codeImplsToolDef = defineTool({
    name: "code_impls",
    label: "Code Impls",
    description:
        "Find local types that declare themselves as implementing, conforming to, or extending the given symbol name.",
    promptSnippet: "Find implementations or subclasses of a type",
    parameters: Type.Object({ symbol: Type.String({ description: "Symbol name" }) }),
    execute() {
        throw new Error("Not implemented");
    },
});
export const codeImportersToolDef = defineTool({
    name: "code_importers",
    label: "Code Importers",
    description: "Find files that import a given file or package.",
    promptSnippet: "Find files that import a file or package",
    parameters: Type.Object({ target: Type.String({ description: "File path or package name" }) }),
    execute() {
        throw new Error("Not implemented");
    },
});
export const codeShowToolDef = defineTool({
    name: "code_show",
    label: "Code Show",
    description: "Read source code of a specific symbol or file.",
    promptSnippet: "Read source code of a specific symbol or file",
    parameters: Type.Object({ target: Type.String({ description: "Symbol name or file path (e.g. file.js:10-20)" }) }),
    execute() {
        throw new Error("Not implemented");
    },
});
export const codeOutlineToolDef = defineTool({
    name: "code_outline",
    label: "Code Outline",
    description: "Show symbols defined in a file.",
    promptSnippet: "Show symbols defined in a file",
    parameters: Type.Object({ file: Type.String({ description: "File path" }) }),
    execute() {
        throw new Error("Not implemented");
    },
});
export const codeBatchToolDef = defineTool({
    name: "code_batch",
    label: "Code Batch",
    description:
        "Batch multiple known Cymbal show and outline reads in one call. Supports only show and outline; use code_search separately for discovery.",
    promptSnippet: "Batch multiple known code_show/code_outline reads; search is not supported",
    parameters: codeBatchParametersSchema,
    execute() {
        throw new Error("Not implemented");
    },
});
export const codeRefsToolDef = defineTool({
    name: "code_refs",
    label: "Code Refs",
    description: "Find references to a symbol.",
    promptSnippet: "Find references to a symbol across indexed files",
    parameters: Type.Object({ symbol: Type.String({ description: "Symbol name" }) }),
    execute() {
        throw new Error("Not implemented");
    },
});
export const codeImpactToolDef = defineTool({
    name: "code_impact",
    label: "Code Impact",
    description: "Find the impact of changing a symbol.",
    promptSnippet: "Transitive impact analysis of a symbol",
    parameters: Type.Object({ symbol: Type.String({ description: "Symbol name" }) }),
    execute() {
        throw new Error("Not implemented");
    },
});
export const codeTraceToolDef = defineTool({
    name: "code_trace",
    label: "Code Trace",
    description: "Trace relationships for a symbol.",
    promptSnippet: "Trace symbol relationships as a graph",
    parameters: Type.Object({ symbol: Type.String({ description: "Symbol name" }) }),
    execute() {
        throw new Error("Not implemented");
    },
});
export const codeInvestigateToolDef = defineTool({
    name: "code_investigate",
    label: "Code Investigate",
    description: "Investigate a symbol in depth.",
    promptSnippet: "Investigate a symbol in depth",
    parameters: Type.Object({ symbol: Type.String({ description: "Symbol name" }) }),
    execute() {
        throw new Error("Not implemented");
    },
});

function asInputRecord(value: object): InputRecord {
    return value as InputRecord;
}

export function validateCodeBatchParams(params: CodeBatchParams): string | null {
    if (!params || typeof params !== "object") return "code_batch requires an operations array.";
    if (!Array.isArray(params.operations)) return "code_batch requires an operations array.";
    if (params.operations.length === 0) return "code_batch requires at least one operation.";
    if (params.operations.length > MAX_CODE_BATCH_OPERATIONS) {
        return `code_batch supports at most ${MAX_CODE_BATCH_OPERATIONS} operations per call.`;
    }
    for (let i = 0; i < params.operations.length; i++) {
        const operation = params.operations[i];
        if (!operation || typeof operation !== "object") return `operations[${i}] must be an object.`;
        const record = asInputRecord(operation);
        if (record.op === "show") {
            if (typeof record.target !== "string" || record.target.trim().length === 0) {
                return `operations[${i}].target must be a non-empty string for show.`;
            }
            continue;
        }
        if (record.op === "outline") {
            if (typeof record.file !== "string" || record.file.trim().length === 0) {
                return `operations[${i}].file must be a non-empty string for outline.`;
            }
            continue;
        }
        return `operations[${i}].op must be "show" or "outline".`;
    }
    return null;
}

export function getCodeBatchCymbalArgs(operation: CodeBatchOperation): string[] {
    return operation.op === "show" ? ["show", operation.target] : ["outline", operation.file];
}
export function getCodeBatchOperationLabel(operation: CodeBatchOperation): string {
    return operation.op === "show" ? `show ${operation.target}` : `outline ${operation.file}`;
}
export function formatCodeBatchSection(index: number, operation: CodeBatchOperation, result: string): string {
    const text = result.trim() || "No results found.";
    return [`## ${index + 1}. ${getCodeBatchOperationLabel(operation)}`, "", text].join("\n");
}
export function truncateCodeBatchOutput(text: string): { text: string; truncated: boolean } {
    if (text.length <= MAX_CODE_BATCH_OUTPUT_CHARS) return { text, truncated: false };
    const marker =
        `\n\n[code_batch output truncated at ${MAX_CODE_BATCH_OUTPUT_CHARS} characters. Use narrower code_show/code_outline calls for remaining content.]`;
    return { text: text.slice(0, MAX_CODE_BATCH_OUTPUT_CHARS) + marker, truncated: true };
}

export function createCymbalTools(host: CymbalToolHost): ToolDefinition[] {
    async function runCymbal(args: string[], signal?: AbortSignal): Promise<string> {
        try {
            const result = await host.exec("cymbal", ["--no-federate", ...args], { cwd: host.cwd, signal });
            if (result.code !== 0) {
                const errText = result.stderr.trim() || result.stdout.trim();
                const cleanErr = errText.split("\nUsage:")[0].trim();
                return `Error (exit ${result.code}): ${cleanErr}`;
            }
            return result.stdout || result.stderr || "";
        } catch (error) {
            return `Error running cymbal: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
    const text = (value: string) => value.trim() || "No results found.";
    return [
        {
            ...codeSearchToolDef,
            async execute(_id, params, signal) {
                const typed = params as SearchParams;
                const args = ["search"];
                if (typed.textSearch) args.push("--text");
                args.push(typed.query);
                return {
                    content: [{ type: "text" as const, text: text(await runCymbal(args, signal)) }],
                    details: typed,
                };
            },
        },
        {
            ...codeStructureToolDef,
            async execute(_id, params, signal) {
                return {
                    content: [{ type: "text" as const, text: text(await runCymbal(["structure"], signal)) }],
                    details: params,
                };
            },
        },
        {
            ...codeImplsToolDef,
            async execute(_id, params, signal) {
                const typed = params as SymbolParams;
                return {
                    content: [{ type: "text" as const, text: text(await runCymbal(["impls", typed.symbol], signal)) }],
                    details: typed,
                };
            },
        },
        {
            ...codeImportersToolDef,
            async execute(_id, params, signal) {
                const typed = params as TargetParams;
                return {
                    content: [{
                        type: "text" as const,
                        text: text(await runCymbal(["importers", typed.target], signal)),
                    }],
                    details: typed,
                };
            },
        },
        {
            ...codeShowToolDef,
            async execute(_id, params, signal) {
                const typed = params as TargetParams;
                return {
                    content: [{ type: "text" as const, text: text(await runCymbal(["show", typed.target], signal)) }],
                    details: typed,
                };
            },
        },
        {
            ...codeOutlineToolDef,
            async execute(_id, params, signal) {
                const typed = params as FileParams;
                return {
                    content: [{ type: "text" as const, text: text(await runCymbal(["outline", typed.file], signal)) }],
                    details: typed,
                };
            },
        },
        {
            ...codeBatchToolDef,
            async execute(_id, params, signal) {
                const typed = params as CodeBatchParams;
                const validationError = validateCodeBatchParams(typed);
                if (validationError) {
                    return {
                        content: [{ type: "text" as const, text: validationError }],
                        details: { operationCount: 0, truncated: false },
                        isError: true,
                    };
                }
                const groups = new Map<CodeBatchOperation["op"], CodeBatchOperation[]>();
                for (const operation of typed.operations) {
                    const group = groups.get(operation.op) ?? [];
                    group.push(operation);
                    groups.set(operation.op, group);
                }
                const results = new Map<CodeBatchOperation["op"], Map<string, string>>();
                for (const [op, operations] of groups) {
                    signal?.throwIfAborted();
                    const targets = [...new Set(operations.map(codeBatchTarget))];
                    if (targets.length === 1) {
                        results.set(
                            op,
                            new Map([[
                                targets[0],
                                await runCymbal(getCodeBatchCymbalArgs(operations[0]), signal),
                            ]]),
                        );
                    } else {
                        const output = await runCymbal(["--json", op, "--", ...targets], signal);
                        results.set(op, parseNativeBatchResults(output, targets, op));
                    }
                    signal?.throwIfAborted();
                }
                const sections = typed.operations.map((operation, index) =>
                    formatCodeBatchSection(
                        index,
                        operation,
                        results.get(operation.op)!.get(codeBatchTarget(operation))!,
                    )
                );
                const { text: batchText, truncated } = truncateCodeBatchOutput(sections.join("\n\n---\n\n"));
                return {
                    content: [{ type: "text" as const, text: batchText }],
                    details: { operationCount: typed.operations.length, truncated },
                };
            },
        },
        {
            ...codeRefsToolDef,
            async execute(_id, params, signal) {
                const typed = params as SymbolParams;
                return {
                    content: [{ type: "text" as const, text: text(await runCymbal(["refs", typed.symbol], signal)) }],
                    details: typed,
                };
            },
        },
        {
            ...codeImpactToolDef,
            async execute(_id, params, signal) {
                const typed = params as SymbolParams;
                return {
                    content: [{ type: "text" as const, text: text(await runCymbal(["impact", typed.symbol], signal)) }],
                    details: typed,
                };
            },
        },
        {
            ...codeTraceToolDef,
            async execute(_id, params, signal) {
                const typed = params as SymbolParams;
                return {
                    content: [{ type: "text" as const, text: text(await runCymbal(["trace", typed.symbol], signal)) }],
                    details: typed,
                };
            },
        },
        {
            ...codeInvestigateToolDef,
            async execute(_id, params, signal) {
                const typed = params as SymbolParams;
                return {
                    content: [{
                        type: "text" as const,
                        text: text(await runCymbal(["investigate", typed.symbol], signal)),
                    }],
                    details: typed,
                };
            },
        },
    ];
}
