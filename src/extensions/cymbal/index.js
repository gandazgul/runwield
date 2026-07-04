/**
 * @module extensions/cymbal
 * Cymbal code search extension for RunWield agent invocations.
 */

import { Type } from "@sinclair/typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";

const MAX_CODE_BATCH_OPERATIONS = 5;
const MAX_CODE_BATCH_OUTPUT_CHARS = 50_000;

const codeBatchShowOperationSchema = Type.Object({
    op: Type.Literal("show"),
    target: Type.String({ description: "Symbol name or file path (e.g. file.js:10-20) to show." }),
}, { additionalProperties: false });

const codeBatchOutlineOperationSchema = Type.Object({
    op: Type.Literal("outline"),
    file: Type.String({ description: "File path to outline." }),
}, { additionalProperties: false });

const codeBatchOperationSchema = Type.Union([
    codeBatchShowOperationSchema,
    codeBatchOutlineOperationSchema,
]);

const codeBatchParametersSchema = Type.Object({
    operations: Type.Array(codeBatchOperationSchema, {
        minItems: 1,
        maxItems: MAX_CODE_BATCH_OPERATIONS,
        description: "One to five known code show/outline operations to run in order. Search is not supported.",
    }),
}, { additionalProperties: false });

/**
 * @typedef {{ op: "show", target: string } | { op: "outline", file: string }} CodeBatchOperation
 * @typedef {{ operations: CodeBatchOperation[] }} CodeBatchParams
 */

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
    parameters: Type.Object({
        symbol: Type.String({ description: "Symbol name" }),
    }),
    execute() {
        throw new Error("Not implemented");
    },
});

export const codeImportersToolDef = defineTool({
    name: "code_importers",
    label: "Code Importers",
    description: "Find files that import a given file or package.",
    promptSnippet: "Find files that import a file or package",
    parameters: Type.Object({
        target: Type.String({ description: "File path or package name" }),
    }),
    execute() {
        throw new Error("Not implemented");
    },
});

export const codeShowToolDef = defineTool({
    name: "code_show",
    label: "Code Show",
    description: "Read source code of a specific symbol or file.",
    promptSnippet: "Read source code of a specific symbol or file",
    parameters: Type.Object({
        target: Type.String({ description: "Symbol name or file path (e.g. file.js:10-20)" }),
    }),
    execute() {
        throw new Error("Not implemented");
    },
});

export const codeOutlineToolDef = defineTool({
    name: "code_outline",
    label: "Code Outline",
    description: "Show symbols defined in a file.",
    promptSnippet: "Show symbols defined in a file",
    parameters: Type.Object({
        file: Type.String({ description: "File path" }),
    }),
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
    parameters: Type.Object({
        symbol: Type.String({ description: "Symbol name" }),
    }),
    execute() {
        throw new Error("Not implemented");
    },
});

export const codeImpactToolDef = defineTool({
    name: "code_impact",
    label: "Code Impact",
    description: "Find the impact of changing a symbol.",
    promptSnippet: "Transitive impact analysis of a symbol",
    parameters: Type.Object({
        symbol: Type.String({ description: "Symbol name" }),
    }),
    execute() {
        throw new Error("Not implemented");
    },
});

export const codeTraceToolDef = defineTool({
    name: "code_trace",
    label: "Code Trace",
    description: "Trace relationships for a symbol.",
    promptSnippet: "Trace symbol relationships as a graph",
    parameters: Type.Object({
        symbol: Type.String({ description: "Symbol name" }),
    }),
    execute() {
        throw new Error("Not implemented");
    },
});

export const codeInvestigateToolDef = defineTool({
    name: "code_investigate",
    label: "Code Investigate",
    description: "Investigate a symbol in depth.",
    promptSnippet: "Investigate a symbol in depth",
    parameters: Type.Object({
        symbol: Type.String({ description: "Symbol name" }),
    }),
    execute() {
        throw new Error("Not implemented");
    },
});

/**
 * @param {unknown} params
 * @returns {string | null}
 */
function validateCodeBatchParams(params) {
    if (!params || typeof params !== "object") return "code_batch requires an operations array.";
    const operations = /** @type {{ operations?: unknown }} */ (params).operations;
    if (!Array.isArray(operations)) return "code_batch requires an operations array.";
    if (operations.length === 0) return "code_batch requires at least one operation.";
    if (operations.length > MAX_CODE_BATCH_OPERATIONS) {
        return `code_batch supports at most ${MAX_CODE_BATCH_OPERATIONS} operations per call.`;
    }

    for (let i = 0; i < operations.length; i++) {
        const operation = operations[i];
        if (!operation || typeof operation !== "object") return `operations[${i}] must be an object.`;
        const record = /** @type {Record<string, unknown>} */ (operation);
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

/**
 * @param {CodeBatchOperation} operation
 * @returns {string[]}
 */
function getCodeBatchCymbalArgs(operation) {
    if (operation.op === "show") return ["show", operation.target];
    return ["outline", operation.file];
}

/**
 * @param {CodeBatchOperation} operation
 * @returns {string}
 */
function getCodeBatchOperationLabel(operation) {
    if (operation.op === "show") return `show ${operation.target}`;
    return `outline ${operation.file}`;
}

/**
 * @param {number} index
 * @param {CodeBatchOperation} operation
 * @param {string} result
 * @returns {string}
 */
function formatCodeBatchSection(index, operation, result) {
    const text = result.trim() || "No results found.";
    return [`## ${index + 1}. ${getCodeBatchOperationLabel(operation)}`, "", text].join("\n");
}

/**
 * @param {string} text
 * @returns {{ text: string, truncated: boolean }}
 */
function truncateCodeBatchOutput(text) {
    if (text.length <= MAX_CODE_BATCH_OUTPUT_CHARS) return { text, truncated: false };
    const marker =
        `\n\n[code_batch output truncated at ${MAX_CODE_BATCH_OUTPUT_CHARS} characters. Use narrower code_show/code_outline calls for remaining content.]`;
    return { text: text.slice(0, MAX_CODE_BATCH_OUTPUT_CHARS) + marker, truncated: true };
}

/**
 * Register Cymbal lifecycle hooks and tools.
 *
 * @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi
 */
export default function cymbalExtension(pi) {
    let projectCwd = Deno.cwd();

    pi.on("session_start", (_event, ctx) => {
        projectCwd = ctx.cwd;
    });

    /**
     * Helper to run cymbal commands.
     * @param {...string} args
     * @returns {Promise<string>}
     */
    async function runCymbal(...args) {
        try {
            const result = await pi.exec("cymbal", args, { cwd: projectCwd });
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

    // Tools
    pi.registerTool({
        ...codeSearchToolDef,
        async execute(_toolCallId, /** @type {any} */ params) {
            const args = ["search"];
            if (params.textSearch) {
                args.push("--text");
            }
            args.push(params.query);

            const result = await runCymbal(...args);
            return {
                content: [{ type: "text", text: result.trim() || "No results found." }],
                details: params,
            };
        },
    });

    pi.registerTool({
        ...codeStructureToolDef,
        async execute(_toolCallId, /** @type {any} */ params) {
            const result = await runCymbal("structure");
            return {
                content: [{ type: "text", text: result.trim() || "No results found." }],
                details: params,
            };
        },
    });

    pi.registerTool({
        ...codeImplsToolDef,
        async execute(_toolCallId, /** @type {any} */ params) {
            const result = await runCymbal("impls", params.symbol);
            return {
                content: [{ type: "text", text: result.trim() || "No results found." }],
                details: params,
            };
        },
    });

    pi.registerTool({
        ...codeImportersToolDef,
        async execute(_toolCallId, /** @type {any} */ params) {
            const result = await runCymbal("importers", params.target);
            return {
                content: [{ type: "text", text: result.trim() || "No results found." }],
                details: params,
            };
        },
    });

    pi.registerTool({
        ...codeShowToolDef,
        async execute(_toolCallId, /** @type {any} */ params) {
            const result = await runCymbal("show", params.target);
            return {
                content: [{ type: "text", text: result.trim() || "No results found." }],
                details: params,
            };
        },
    });

    pi.registerTool({
        ...codeOutlineToolDef,
        async execute(_toolCallId, /** @type {any} */ params) {
            const result = await runCymbal("outline", params.file);
            return {
                content: [{ type: "text", text: result.trim() || "No results found." }],
                details: params,
            };
        },
    });

    pi.registerTool({
        ...codeBatchToolDef,
        async execute(_toolCallId, /** @type {any} */ params) {
            const validationError = validateCodeBatchParams(params);
            if (validationError) {
                return {
                    content: [{ type: "text", text: validationError }],
                    details: { operationCount: 0, truncated: false },
                    isError: true,
                };
            }

            const typedParams = /** @type {CodeBatchParams} */ (params);
            /** @type {string[]} */
            const sections = [];
            for (let i = 0; i < typedParams.operations.length; i++) {
                const operation = typedParams.operations[i];
                const result = await runCymbal(...getCodeBatchCymbalArgs(operation));
                sections.push(formatCodeBatchSection(i, operation, result));
            }

            const { text, truncated } = truncateCodeBatchOutput(sections.join("\n\n---\n\n"));
            return {
                content: [{ type: "text", text }],
                details: { operationCount: typedParams.operations.length, truncated },
            };
        },
    });

    pi.registerTool({
        ...codeRefsToolDef,
        async execute(_toolCallId, /** @type {any} */ params) {
            const result = await runCymbal("refs", params.symbol);
            return {
                content: [{ type: "text", text: result.trim() || "No results found." }],
                details: params,
            };
        },
    });

    pi.registerTool({
        ...codeImpactToolDef,
        async execute(_toolCallId, /** @type {any} */ params) {
            const result = await runCymbal("impact", params.symbol);
            return {
                content: [{ type: "text", text: result.trim() || "No results found." }],
                details: params,
            };
        },
    });

    pi.registerTool({
        ...codeTraceToolDef,
        async execute(_toolCallId, /** @type {any} */ params) {
            const result = await runCymbal("trace", params.symbol);
            return {
                content: [{ type: "text", text: result.trim() || "No results found." }],
                details: params,
            };
        },
    });

    pi.registerTool({
        ...codeInvestigateToolDef,
        async execute(_toolCallId, /** @type {any} */ params) {
            const result = await runCymbal("investigate", params.symbol);
            return {
                content: [{ type: "text", text: result.trim() || "No results found." }],
                details: params,
            };
        },
    });

    // Intercept bash and grep to inject cymbal nudges
    pi.on("tool_result", async (event, _ctx) => {
        let commandToInspect = null;
        if (event.toolName === "bash" && event.input?.command) {
            commandToInspect = String(event.input.command);
        } else if (event.toolName === "grep" && event.input?.pattern) {
            const pathArgs = Array.isArray(event.input.path) ? event.input.path.join(" ") : (event.input.path || ".");
            commandToInspect = `grep "${event.input.pattern}" ${pathArgs}`;
        }

        if (commandToInspect) {
            try {
                // Execute cymbal hook nudge --format=text -- <command>
                const hookResult = await pi.exec("cymbal", ["hook", "nudge", "--format=text", "--", commandToInspect], {
                    cwd: projectCwd,
                });

                // cymbal nudge output goes to stderr
                const nudgeText = hookResult.stderr.trim();

                if (nudgeText) {
                    const newContent = [...(event.content || [])];
                    newContent.push({ type: "text", text: `\n\n${nudgeText}` });
                    return { content: newContent };
                }
            } catch (_err) {
                // Ignore hook errors
            }
        }
    });
}
