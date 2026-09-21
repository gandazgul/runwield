/**
 * @module tools/edit
 *
 * Adapts the pi-coding-agent `edit` tool to RunWield's single-replacement schema.
 * Failed edits propagate the original error without appending file contents.
 *
 * Registered as a custom tool named "edit" which overrides the built-in
 * via pi-coding-agent's tool registry (custom tools take precedence).
 */

import { createEditToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
const singleEditSchema = Type.Object({
    path: Type.String({ description: "Path to the file to edit (relative or absolute)." }),
    oldText: Type.String({
        description: "Exact text to replace. It must match one unique region in the file.",
    }),
    newText: Type.String({ description: "Replacement text for oldText." }),
}, { additionalProperties: false });

/**
 * Accept a few stale/legacy argument shapes while advertising a single-edit schema.
 *
 * @param {unknown} input
 * @returns {{ path: string, oldText: string, newText: string }}
 */
function prepareSingleEditArguments(input) {
    if (!input || typeof input !== "object") {
        return /** @type {{ path: string, oldText: string, newText: string }} */ (input);
    }

    const args = /** @type {Record<string, unknown>} */ (input);
    const path = typeof args.path === "string"
        ? args.path
        : typeof args.file_path === "string"
        ? args.file_path
        : undefined;

    if (typeof path === "string" && typeof args.oldText === "string" && typeof args.newText === "string") {
        return { path, oldText: args.oldText, newText: args.newText };
    }

    if (typeof path === "string" && Array.isArray(args.edits) && args.edits.length === 1) {
        const edit = /** @type {{ oldText?: unknown, newText?: unknown }} */ (args.edits[0]);
        if (typeof edit?.oldText === "string" && typeof edit?.newText === "string") {
            return { path, oldText: edit.oldText, newText: edit.newText };
        }
    }

    return /** @type {{ path: string, oldText: string, newText: string }} */ (input);
}

/**
 * Create a single-replacement edit tool that preserves upstream errors.
 *
 * @param {string} cwd - Current working directory.
 * @returns {import('@earendil-works/pi-coding-agent').ToolDefinition<any, any>}
 */
export function createSingleEditToolDefinition(cwd) {
    const original = createEditToolDefinition(cwd);
    const originalExecute = original.execute;
    const tool = /** @type {import('@earendil-works/pi-coding-agent').ToolDefinition<any, any>} */ (original);

    tool.description =
        "Edit a single file by replacing one exact text block. Use multi_file_edit for multiple replacements or multiple files.";
    tool.promptSnippet = "Make one precise exact-text replacement in one file";
    tool.promptGuidelines = [
        "Use edit for a single replacement in a single file: path, oldText, newText",
        "Use multi_file_edit when you need more than one replacement or need to touch more than one file",
        "oldText must match exactly one location, including whitespace and newlines",
    ];
    tool.parameters = singleEditSchema;
    tool.prepareArguments = prepareSingleEditArguments;
    tool.execute = async (toolCallId, params, signal, onUpdate, ctx) => {
        const singleEditParams = /** @type {{ path: string, oldText: string, newText: string }} */ (
            /** @type {unknown} */ (params)
        );
        const editParams = {
            path: singleEditParams.path,
            edits: [{ oldText: singleEditParams.oldText, newText: singleEditParams.newText }],
        };
        return await originalExecute(toolCallId, editParams, signal, onUpdate, ctx);
    };

    return tool;
}
