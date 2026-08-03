/**
 * @module tools/read
 *
 * Wraps the pi-coding-agent `read` tool with RunWield presentation safety so
 * binary/control-byte text does not get projected into terminal output.
 */

import { createReadToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { isAbsolute, resolve as resolvePath } from "node:path";

const BINARY_DISPLAY_SAMPLE_BYTES = 8192;
const binaryDisplayResults = new WeakSet();

/**
 * @typedef {{ type?: string, text?: string }} ToolContentPart
 * @typedef {{ content?: ToolContentPart[] }} ToolResult
 * @typedef {{ path?: string }} ReadToolArgs
 */

/**
 * @param {string} text
 * @returns {boolean}
 */
function containsUnsafeDisplayText(text) {
    for (const char of text) {
        const code = char.charCodeAt(0);
        if (code < 32 && code !== 9 && code !== 10 && code !== 13) return true;
        if (code === 127 || code === 0xfffd) return true;
    }
    return false;
}

/**
 * @param {unknown} result
 * @returns {ToolContentPart[]}
 */
function getResultContent(result) {
    const content = /** @type {ToolResult | undefined} */ (result)?.content;
    return Array.isArray(content) ? content : [];
}

/**
 * @param {unknown} result
 * @returns {boolean}
 */
function resultHasImageContent(result) {
    return getResultContent(result).some((part) => part?.type === "image");
}

/**
 * @param {unknown} result
 * @returns {boolean}
 */
function resultLooksUnsafeForDisplay(result) {
    for (const part of getResultContent(result)) {
        if (part?.type === "text" && typeof part.text === "string" && containsUnsafeDisplayText(part.text)) {
            return true;
        }
    }
    return false;
}

/**
 * @param {Uint8Array} bytes
 * @returns {boolean}
 */
function bytesLookBinaryForDisplay(bytes) {
    if (bytes.length === 0) return false;
    for (const byte of bytes) {
        if (byte === 0) return true;
        if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) return true;
        if (byte === 127) return true;
    }

    try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        return containsUnsafeDisplayText(text);
    } catch {
        return true;
    }
}

/**
 * @param {string} absolutePath
 * @returns {Promise<Uint8Array>}
 */
async function readDisplaySampleBytes(absolutePath) {
    const file = await Deno.open(absolutePath, { read: true });
    try {
        const buffer = new Uint8Array(BINARY_DISPLAY_SAMPLE_BYTES);
        const bytesRead = await file.read(buffer);
        return buffer.slice(0, bytesRead ?? 0);
    } finally {
        file.close();
    }
}

/**
 * @param {string} cwd
 * @param {unknown} args
 * @returns {Promise<boolean>}
 */
async function fileLooksBinaryForDisplay(cwd, args) {
    const path = /** @type {ReadToolArgs | undefined} */ (args)?.path;
    if (typeof path !== "string" || path.length === 0) return false;

    try {
        const absolutePath = isAbsolute(path) ? path : resolvePath(cwd, path);
        const bytes = await readDisplaySampleBytes(absolutePath);
        return bytesLookBinaryForDisplay(bytes);
    } catch {
        return false;
    }
}

/**
 * @param {string} cwd
 * @returns {import('@earendil-works/pi-coding-agent').ToolDefinition<any, any>}
 */
export function createRunWieldReadToolDefinition(cwd) {
    const original = createReadToolDefinition(cwd);
    const originalExecute = /** @type {any} */ (original.execute);
    const originalRenderResult = /** @type {any} */ (original.renderResult);
    const tool = /** @type {import('@earendil-works/pi-coding-agent').ToolDefinition<any, any>} */ (original);

    tool.description =
        `${original.description} Suppresses binary/control-byte text in terminal rendering while preserving the tool result.`;
    tool.promptGuidelines = [
        ...(original.promptGuidelines || []),
        "Use read for files you need to inspect; terminal rendering may hide binary/control-byte output.",
    ];
    tool.execute = async (toolCallId, args, signal, onUpdate, context) => {
        const result = await originalExecute(toolCallId, args, signal, onUpdate, context);
        if (
            typeof result === "object" && result !== null && !resultHasImageContent(result) &&
            (resultLooksUnsafeForDisplay(result) || await fileLooksBinaryForDisplay(cwd, args))
        ) {
            binaryDisplayResults.add(result);
        }
        return result;
    };
    tool.renderResult = (result, _options, _theme, context) => {
        const text =
            /** @type {Text} */ (context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0));
        if (
            binaryDisplayResults.has(result) || (!resultHasImageContent(result) && resultLooksUnsafeForDisplay(result))
        ) {
            text.setText("");
            return text;
        }
        return originalRenderResult?.(result, _options, _theme, context) ?? text;
    };

    return tool;
}

export const __test = {
    containsUnsafeDisplayText,
    resultLooksUnsafeForDisplay,
};
