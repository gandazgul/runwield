/**
 * @module extensions/cymbal
 * Cymbal code search extension for Harns agent invocations.
 */

import { Type } from "@sinclair/typebox";
import { defineTool } from "@mariozechner/pi-coding-agent";

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
 * Register Cymbal lifecycle hooks and tools.
 *
 * @param {import('@mariozechner/pi-coding-agent').ExtensionAPI} pi
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
        async execute(_toolCallId, params) {
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
        async execute(_toolCallId, params) {
            const result = await runCymbal("structure");
            return {
                content: [{ type: "text", text: result.trim() || "No results found." }],
                details: params,
            };
        },
    });

    pi.registerTool({
        ...codeImplsToolDef,
        async execute(_toolCallId, params) {
            const result = await runCymbal("impls", params.symbol);
            return {
                content: [{ type: "text", text: result.trim() || "No results found." }],
                details: params,
            };
        },
    });

    pi.registerTool({
        ...codeImportersToolDef,
        async execute(_toolCallId, params) {
            const result = await runCymbal("importers", params.target);
            return {
                content: [{ type: "text", text: result.trim() || "No results found." }],
                details: params,
            };
        },
    });

    pi.registerTool({
        ...codeShowToolDef,
        async execute(_toolCallId, params) {
            const result = await runCymbal("show", params.target);
            return {
                content: [{ type: "text", text: result.trim() || "No results found." }],
                details: params,
            };
        },
    });

    pi.registerTool({
        ...codeOutlineToolDef,
        async execute(_toolCallId, params) {
            const result = await runCymbal("outline", params.file);
            return {
                content: [{ type: "text", text: result.trim() || "No results found." }],
                details: params,
            };
        },
    });

    pi.registerTool({
        ...codeRefsToolDef,
        async execute(_toolCallId, params) {
            const result = await runCymbal("refs", params.symbol);
            return {
                content: [{ type: "text", text: result.trim() || "No results found." }],
                details: params,
            };
        },
    });

    pi.registerTool({
        ...codeImpactToolDef,
        async execute(_toolCallId, params) {
            const result = await runCymbal("impact", params.symbol);
            return {
                content: [{ type: "text", text: result.trim() || "No results found." }],
                details: params,
            };
        },
    });

    pi.registerTool({
        ...codeTraceToolDef,
        async execute(_toolCallId, params) {
            const result = await runCymbal("trace", params.symbol);
            return {
                content: [{ type: "text", text: result.trim() || "No results found." }],
                details: params,
            };
        },
    });

    pi.registerTool({
        ...codeInvestigateToolDef,
        async execute(_toolCallId, params) {
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
