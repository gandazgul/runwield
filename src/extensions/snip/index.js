/**
 * @module extensions/snip
 * Optional Snip command prefix extension for Harns agent invocations.
 */

import { ensureHarnsSnipFilters } from "../../shared/snip-filters.js";

const SHELL_BUILTINS = new Set([
    ".",
    "alias",
    "bg",
    "break",
    "cd",
    "command",
    "continue",
    "eval",
    "exec",
    "exit",
    "export",
    "fg",
    "jobs",
    "popd",
    "pushd",
    "read",
    "return",
    "set",
    "shift",
    "source",
    "trap",
    "type",
    "ulimit",
    "umask",
    "unalias",
    "unset",
]);

/**
 * @param {string} value
 * @returns {string}
 */
function shellQuote(value) {
    if (/^[A-Za-z0-9_/:=.,@%+-]+$/.test(value)) return value;
    return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/**
 * @param {string} command
 * @returns {number}
 */
function findFirstSegmentEnd(command) {
    let quote = "";
    for (let i = 0; i < command.length; i++) {
        const char = command[i];
        if (quote) {
            if (char === "\\") {
                i++;
                continue;
            }
            if (char === quote) quote = "";
            continue;
        }
        if (char === "'" || char === '"') {
            quote = char;
            continue;
        }
        if (char === "\n" || char === ";" || char === "|") return i;
        if (char === "&" && command[i + 1] === "&") return i;
    }
    return command.length;
}

/**
 * @param {string} segment
 * @returns {string[]}
 */
function splitWords(segment) {
    const words = [];
    let current = "";
    let quote = "";
    for (let i = 0; i < segment.length; i++) {
        const char = segment[i];
        if (quote) {
            if (char === "\\") {
                current += char;
                if (i + 1 < segment.length) current += segment[++i];
                continue;
            }
            if (char === quote) {
                quote = "";
                current += char;
                continue;
            }
            current += char;
            continue;
        }
        if (char === "'" || char === '"') {
            quote = char;
            current += char;
            continue;
        }
        if (/\s/.test(char)) {
            if (current) {
                words.push(current);
                current = "";
            }
            continue;
        }
        current += char;
    }
    if (current) words.push(current);
    return words;
}

/**
 * @param {string} word
 * @returns {boolean}
 */
function isEnvAssignment(word) {
    return /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(word);
}

/**
 * @param {string} word
 * @returns {string}
 */
function baseCommand(word) {
    const cleaned = word.replace(/^['"]|['"]$/g, "");
    return cleaned.split(/[\\/]/).pop() || cleaned;
}

/**
 * @param {string} segment
 * @returns {{ envPrefix: string, commandText: string, commandName: string, hasSnipConfig: boolean } | null}
 */
function parseSimpleSegment(segment) {
    const leading = segment.match(/^\s*/)?.[0] || "";
    const trimmed = segment.trim();
    if (!trimmed) return null;

    const words = splitWords(trimmed);
    if (words.length === 0) return null;

    let index = 0;
    while (index < words.length && isEnvAssignment(words[index])) index++;
    if (index >= words.length) return null;

    const envWords = words.slice(0, index);
    const commandName = baseCommand(words[index]);
    const commandOffset = segment.indexOf(words[index]);
    if (commandOffset < 0) return null;

    return {
        envPrefix: leading + (envWords.length > 0 ? `${envWords.join(" ")} ` : ""),
        commandText: segment.slice(commandOffset),
        commandName,
        hasSnipConfig: envWords.some((word) => word.startsWith("SNIP_CONFIG=")),
    };
}

/**
 * @param {string} originalCommand
 * @param {string} configPath
 * @returns {string | null}
 */
function rewriteCommand(originalCommand, configPath) {
    const segmentEnd = findFirstSegmentEnd(originalCommand);
    const segment = originalCommand.slice(0, segmentEnd);
    const rest = originalCommand.slice(segmentEnd);
    const parsed = parseSimpleSegment(segment);
    if (!parsed) return null;
    if (parsed.commandName === "snip" || SHELL_BUILTINS.has(parsed.commandName)) return null;

    const configPrefix = parsed.hasSnipConfig ? "" : `SNIP_CONFIG=${shellQuote(configPath)} `;
    return `${parsed.envPrefix}${configPrefix}snip run -- ${parsed.commandText}${rest}`;
}

/**
 * Register Snip command prefixing for agent bash tool calls.
 *
 * @param {import('@earendil-works/pi-coding-agent').ExtensionAPI} pi
 * @param {{ ensureFilters?: typeof ensureHarnsSnipFilters }} [options]
 */
export default function snipExtension(pi, options = {}) {
    const ensureFilters = options.ensureFilters || ensureHarnsSnipFilters;
    let configPath = "";

    pi.on("session_start", async (_event, _ctx) => {
        try {
            const result = await ensureFilters();
            configPath = result.configPath;
        } catch {
            configPath = "";
        }
    });

    pi.on("tool_call", async (event, _ctx) => {
        if (event.toolName !== "bash") return;
        const input = event.input;
        if (!input || typeof input.command !== "string") return;

        const originalCommand = input.command.trim();
        if (!originalCommand) return;

        try {
            if (!configPath) {
                const result = await ensureFilters();
                configPath = result.configPath;
            }
            const rewritten = rewriteCommand(originalCommand, configPath);
            if (!rewritten || rewritten === originalCommand) return;
            input.command = rewritten;
        } catch {
            // Snip is optional and fail-open. If filter setup or rewriting fails, run the original command.
        }
    });
}

export const __testing = { findFirstSegmentEnd, parseSimpleSegment, rewriteCommand, shellQuote };
