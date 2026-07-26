/**
 * @module tools/read
 *
 * Wraps the pi-coding-agent `read` tool with RunWield safety checks so
 * binary/control-byte files do not get projected into terminal output.
 */

import { createReadToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { extname, isAbsolute, join, relative } from "@std/path";

const BINARY_SCAN_BYTES = 8192;
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"]);

/**
 * @typedef {{
 *   path: string,
 *   offset?: number,
 *   limit?: number,
 * }} ReadParams
 */

/**
 * @param {string} path
 * @param {string} cwd
 * @returns {string}
 */
function resolveToCwd(path, cwd) {
    const expanded = path.startsWith("~/") ? join(Deno.env.get("HOME") || "", path.slice(2)) : path;
    const stripped = expanded.startsWith("@") ? expanded.slice(1) : expanded;
    return isAbsolute(stripped) ? stripped : join(cwd, stripped);
}

/**
 * @param {string} path
 * @returns {boolean}
 */
function isSupportedImagePath(path) {
    return IMAGE_EXTENSIONS.has(extname(path).toLowerCase());
}

/**
 * @param {string} absolutePath
 * @param {string} cwd
 * @returns {string}
 */
function displayPath(absolutePath, cwd) {
    const rel = relative(cwd, absolutePath).replace(/\\/g, "/");
    if (rel && !rel.startsWith("..")) return rel;
    return absolutePath.replace(/\\/g, "/");
}

/**
 * @param {string} path
 * @returns {{ content: Array<{ type: "text", text: string }>, details: { blocked: true, reason: "binary-content", path: string } }}
 */
function blockedReadResult(path) {
    return {
        content: [{
            type: "text",
            text:
                `Read of ${path} was blocked because the file does not appear to be safe UTF-8 text or a supported image. Use a purpose-built command instead of raw read output if you need to inspect this file.`,
        }],
        details: { blocked: true, reason: "binary-content", path },
    };
}

/**
 * @param {Uint8Array} bytes
 * @returns {boolean}
 */
function containsUnsafeTextBytes(bytes) {
    if (bytes.includes(0)) return true;

    for (const byte of bytes) {
        if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) return true;
        if (byte === 127) return true;
    }

    try {
        new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        return false;
    } catch {
        return true;
    }
}

/**
 * @param {string} absolutePath
 * @returns {Promise<boolean>}
 */
async function fileLooksUnsafeForTextRead(absolutePath) {
    const file = await Deno.open(absolutePath, { read: true });
    try {
        const buffer = new Uint8Array(BINARY_SCAN_BYTES);
        const read = await file.read(buffer);
        if (!read) return false;
        return containsUnsafeTextBytes(buffer.subarray(0, read));
    } finally {
        file.close();
    }
}

/**
 * @param {string} cwd
 * @returns {import('@earendil-works/pi-coding-agent').ToolDefinition<any, any>}
 */
export function createRunWieldReadToolDefinition(cwd) {
    const original = createReadToolDefinition(cwd);
    const originalExecute = /** @type {any} */ (original.execute);
    const tool = /** @type {import('@earendil-works/pi-coding-agent').ToolDefinition<any, any>} */ (original);

    tool.description =
        `${original.description} Blocks binary/control-byte files before raw output reaches the interface.`;
    tool.promptGuidelines = [
        ...(original.promptGuidelines || []),
        "Use read for UTF-8 text files and supported images; use purpose-built commands for binary formats.",
    ];
    tool.execute = async (toolCallId, params, signal, onUpdate, ctx) => {
        const readParams = /** @type {ReadParams} */ (params);
        const absolutePath = resolveToCwd(readParams.path, cwd);
        const shownPath = displayPath(absolutePath, cwd);

        if (!isSupportedImagePath(absolutePath) && await fileLooksUnsafeForTextRead(absolutePath)) {
            return blockedReadResult(shownPath);
        }

        return await originalExecute(toolCallId, params, signal, onUpdate, ctx);
    };
    tool.renderResult = (result, _options, _theme, context) => {
        const text =
            /** @type {Text} */ (context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0));
        if (result?.details?.blocked) {
            text.setText("");
            return text;
        }
        return /** @type {any} */ (original.renderResult)?.(result, _options, _theme, context) ?? text;
    };

    return tool;
}

export const __test = {
    containsUnsafeTextBytes,
};
