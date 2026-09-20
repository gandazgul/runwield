/**
 * @module extensions/cymbal
 * Cymbal code search extension for RunWield agent invocations.
 */

import { createCymbalTools } from "./tools.ts";
export {
    codeBatchToolDef,
    codeImpactToolDef,
    codeImplsToolDef,
    codeImportersToolDef,
    codeInvestigateToolDef,
    codeOutlineToolDef,
    codeRefsToolDef,
    codeSearchToolDef,
    codeShowToolDef,
    codeStructureToolDef,
    codeTraceToolDef,
} from "./tools.ts";

/**
 * Register Cymbal lifecycle hooks and tools.
 *
 * @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi
 */
export default function cymbalExtension(pi) {
    const failedToolCalls = new Set();
    const host = {
        cwd: Deno.cwd(),
        /**
         * @param {string} command
         * @param {string[]} args
         * @param {{ cwd: string, signal?: AbortSignal }} options
         */
        exec(command, args, options) {
            return pi.exec(command, args, options);
        },
    };

    pi.on("session_start", (_event, ctx) => {
        host.cwd = ctx.cwd;
        failedToolCalls.clear();
    });

    for (const tool of createCymbalTools(host)) {
        pi.registerTool({
            ...tool,
            async execute(toolCallId, params, signal, onUpdate, ctx) {
                failedToolCalls.delete(toolCallId);
                const result = await tool.execute(toolCallId, params, signal, onUpdate, ctx);
                // Pi reads error status from its result hook; external hosts read the returned flag.
                if ("isError" in result && result.isError === true) failedToolCalls.add(toolCallId);
                return result;
            },
        });
    }

    // Intercept bash and grep to inject cymbal nudges. This stays Pi-only
    // because RunWield does not ingest Claude Code's native tool loop.
    pi.on("tool_result", async (event, _ctx) => {
        if (failedToolCalls.delete(event.toolCallId)) return { isError: true };
        let commandToInspect = null;
        if (event.toolName === "bash" && event.input?.command) {
            commandToInspect = String(event.input.command);
        } else if (event.toolName === "grep" && event.input?.pattern) {
            const pathArgs = Array.isArray(event.input.path) ? event.input.path.join(" ") : (event.input.path || ".");
            commandToInspect = `grep "${event.input.pattern}" ${pathArgs}`;
        }

        if (commandToInspect) {
            try {
                const hookResult = await pi.exec(
                    "cymbal",
                    [["--no", "federate"].join("-"), "hook", "nudge", "--format=text", "--", commandToInspect],
                    { cwd: host.cwd },
                );
                const nudgeText = hookResult.stderr.trim();
                if (nudgeText) {
                    const newContent = [...(event.content || [])];
                    newContent.push({ type: "text", text: `\n\n${nudgeText}` });
                    return { content: newContent };
                }
            } catch (_err) {
                // Ignore hook errors.
            }
        }
    });
}
