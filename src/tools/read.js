/**
 * @module tools/read
 *
 * Wraps the pi-coding-agent `read` tool with RunWield presentation safety so
 * binary/control-byte text does not get projected into terminal output.
 */

import { createReadToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

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
 * @returns {boolean}
 */
function resultLooksUnsafeForDisplay(result) {
    const content = /** @type {{ content?: Array<{ type?: string, text?: string }> }} */ (result)?.content;
    if (!Array.isArray(content)) return false;

    for (const part of content) {
        if (part?.type === "text" && typeof part.text === "string" && containsUnsafeDisplayText(part.text)) {
            return true;
        }
    }
    return false;
}

/**
 * @param {string} cwd
 * @returns {import('@earendil-works/pi-coding-agent').ToolDefinition<any, any>}
 */
export function createRunWieldReadToolDefinition(cwd) {
    const original = createReadToolDefinition(cwd);
    const originalRenderResult = /** @type {any} */ (original.renderResult);
    const tool = /** @type {import('@earendil-works/pi-coding-agent').ToolDefinition<any, any>} */ (original);

    tool.description =
        `${original.description} Suppresses binary/control-byte text in terminal rendering while preserving the tool result.`;
    tool.promptGuidelines = [
        ...(original.promptGuidelines || []),
        "Use read for files you need to inspect; terminal rendering may hide binary/control-byte output.",
    ];
    tool.renderResult = (result, _options, _theme, context) => {
        const text =
            /** @type {Text} */ (context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0));
        if (resultLooksUnsafeForDisplay(result)) {
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
