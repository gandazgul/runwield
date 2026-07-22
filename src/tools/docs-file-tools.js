/**
 * @module tools/docs-file-tools
 *
 * Markdown-restricted adapters for file mutation tools. These tools preserve the
 * native write/edit interfaces while validating the target path before any
 * filesystem mutation is delegated to the underlying tool implementation.
 */

import { createWriteToolDefinition } from "@earendil-works/pi-coding-agent";
import { createEditWithFallbackToolDefinition } from "./edit-with-fallback.js";

/**
 * @param {unknown} path
 * @param {string} toolName
 * @returns {string | null}
 */
function validateMarkdownPath(path, toolName) {
    if (typeof path !== "string" || !path.trim()) {
        return `${toolName}: path is required and must end with .md.`;
    }

    const normalized = path.replace(/\\/g, "/");
    const fileName = normalized.split("/").pop() || "";
    if (!fileName.toLowerCase().endsWith(".md")) {
        return `${toolName}: only Markdown .md files can be modified. Received: ${path}`;
    }

    return null;
}

/**
 * @param {string} message
 * @returns {{ content: Array<{ type: "text", text: string }>, details: null, isError: true }}
 */
function blockedResult(message) {
    return {
        content: [{ type: "text", text: message }],
        details: null,
        isError: true,
    };
}

/**
 * Create a write tool that only accepts `.md` paths.
 *
 * @param {string} cwd
 * @returns {import('@earendil-works/pi-coding-agent').ToolDefinition<any, any>}
 */
export function createWriteDocsToolDefinition(cwd) {
    const original = createWriteToolDefinition(cwd);
    const originalExecute = /** @type {any} */ (original.execute);
    const tool = /** @type {import('@earendil-works/pi-coding-agent').ToolDefinition<any, any>} */ (original);

    tool.name = "write_docs";
    tool.label = "write_docs";
    tool.description =
        "Write Markdown documentation to a .md file. Creates the file if it doesn't exist, overwrites if it does, and rejects non-.md paths before mutation.";
    tool.promptSnippet = "Create or overwrite Markdown .md documentation files";
    tool.promptGuidelines = [
        "Use write_docs only for new Markdown documents or user-approved full rewrites",
        "The path must end with .md; .markdown, .mdx, extensionless, and non-document paths are rejected",
        "Prefer edit_docs for focused updates to an existing Markdown file",
    ];
    tool.execute = async (toolCallId, params, signal, onUpdate, ctx) => {
        const typedParams = /** @type {{ path?: unknown, content?: unknown }} */ (params);
        const validationError = validateMarkdownPath(typedParams.path, "write_docs");
        if (validationError) return blockedResult(validationError);
        return await originalExecute(toolCallId, params, signal, onUpdate, ctx);
    };

    return tool;
}

/**
 * Create an edit tool that only accepts `.md` paths.
 *
 * @param {string} cwd
 * @returns {import('@earendil-works/pi-coding-agent').ToolDefinition<any, any>}
 */
export function createEditDocsToolDefinition(cwd) {
    const original = createEditWithFallbackToolDefinition(cwd);
    const originalExecute = /** @type {any} */ (original.execute);
    const tool = /** @type {import('@earendil-works/pi-coding-agent').ToolDefinition<any, any>} */ (original);

    tool.name = "edit_docs";
    tool.label = "edit_docs";
    tool.description =
        "Edit a Markdown .md file by replacing one exact text block. Rejects non-.md paths before mutation and returns current file contents on edit failure.";
    tool.promptSnippet = "Make one precise exact-text replacement in a Markdown .md file";
    tool.promptGuidelines = [
        "Use edit_docs for focused updates to one Markdown file: path, oldText, newText",
        "The path must end with .md; .markdown, .mdx, extensionless, and non-document paths are rejected",
        "oldText must match exactly one location, including whitespace and newlines",
    ];
    tool.execute = async (toolCallId, params, signal, onUpdate, ctx) => {
        const typedParams = /** @type {{ path?: unknown }} */ (params);
        const validationError = validateMarkdownPath(typedParams.path, "edit_docs");
        if (validationError) return blockedResult(validationError);
        return await originalExecute(toolCallId, params, signal, onUpdate, ctx);
    };

    return tool;
}
