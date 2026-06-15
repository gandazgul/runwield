/**
 * @module tools/multi_file_edit
 *
 * Custom tool for performing multiple exact-text replacements across one or more
 * files. Each edit item carries its own path so the schema is distinct from
 * the single-file `edit` tool.
 */

import { defineTool, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { isAbsolute, join } from "@std/path";

const fileEditSchema = Type.Object({
    path: Type.String({ description: "Path to the file for this replacement, relative to root or the session cwd." }),
    oldText: Type.String({
        description: "Exact text to replace in this file. It must match one unique, non-overlapping region.",
    }),
    newText: Type.String({ description: "Replacement text for oldText." }),
}, { additionalProperties: false });

const toolParams = Type.Object({
    root: Type.Optional(Type.String({
        description: "Optional base directory for relative edit paths. Defaults to the session working directory.",
    })),
    edits: Type.Array(fileEditSchema, {
        minItems: 1,
        description: "One or more replacements. Use edit instead when there is exactly one replacement in one file.",
    }),
}, { additionalProperties: false });

/**
 * @typedef {{ path: string, oldText: string, newText: string }} MultiFileEdit
 * @typedef {{ root?: string, edits: MultiFileEdit[] }} MultiFileEditParams
 */

/**
 * Strip UTF-8 BOM if present.
 *
 * @param {string} content
 * @returns {{ bom: string, text: string }}
 */
function stripBom(content) {
    if (content.startsWith("\uFEFF")) {
        return { bom: "\uFEFF", text: content.slice(1) };
    }
    return { bom: "", text: content };
}

/**
 * @param {string} text
 * @returns {string}
 */
function normalizeToLF(text) {
    return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * @param {string} text
 * @param {string} ending
 * @returns {string}
 */
function restoreLineEndings(text, ending) {
    if (ending === "\r\n") return text.replace(/\n/g, "\r\n");
    return text;
}

/**
 * @param {string} content
 * @returns {string}
 */
function detectLineEnding(content) {
    const crlfIdx = content.indexOf("\r\n");
    const lfIdx = content.indexOf("\n");
    if (lfIdx === -1 || crlfIdx === -1) return "\n";
    return crlfIdx < lfIdx ? "\r\n" : "\n";
}

/**
 * @param {string} targetPath
 * @param {string} baseDir
 * @returns {string}
 */
function resolveToBaseDir(targetPath, baseDir) {
    const expanded = targetPath.startsWith("~") ? (Deno.env.get("HOME") || "") + targetPath.slice(1) : targetPath;
    if (isAbsolute(expanded)) return expanded;
    return join(baseDir, expanded);
}

/**
 * @param {string} root
 * @param {string} cwd
 * @returns {string}
 */
function resolveRoot(root, cwd) {
    const trimmed = root.trim();
    if (!trimmed) return cwd;
    return resolveToBaseDir(trimmed, cwd);
}

/**
 * @param {string} oldContent
 * @param {string} newContent
 * @returns {{ diff: string, firstChangedLine: number | undefined }}
 */
function generateDiffString(oldContent, newContent) {
    const oldLines = oldContent.split("\n");
    const newLines = newContent.split("\n");
    const maxLen = Math.max(oldLines.length, newLines.length);
    const pad = String(maxLen).length;
    const result = [];
    let firstChangedLine;

    for (let i = 0; i < maxLen; i++) {
        const oldLine = i < oldLines.length ? oldLines[i] : undefined;
        const newLine = i < newLines.length ? newLines[i] : undefined;

        if (oldLine !== newLine) {
            if (firstChangedLine === undefined) firstChangedLine = i + 1;
            if (oldLine !== undefined) result.push(`-${String(i + 1).padStart(pad)} ${oldLine}`);
            if (newLine !== undefined) result.push(`+${String(i + 1).padStart(pad)} ${newLine}`);
        } else {
            result.push(` ${String(i + 1).padStart(pad)} ${oldLine}`);
        }
    }

    return { diff: result.join("\n"), firstChangedLine };
}

/**
 * @param {string} normalizedContent
 * @param {MultiFileEdit[]} edits
 * @param {string} path
 * @returns {{ baseContent: string, newContent: string }}
 */
function applyEdits(normalizedContent, edits, path) {
    const normalizedEdits = edits.map((edit) => ({
        oldText: normalizeToLF(edit.oldText),
        newText: normalizeToLF(edit.newText),
    }));

    for (let i = 0; i < normalizedEdits.length; i++) {
        if (normalizedEdits[i].oldText.length === 0) {
            throw new Error(`edits[${i}].oldText must not be empty for ${path}.`);
        }
    }

    /** @type {Array<{ index: number, length: number, newText: string, editIdx: number }>} */
    const matches = [];
    for (let i = 0; i < normalizedEdits.length; i++) {
        const { oldText } = normalizedEdits[i];
        const idx = normalizedContent.indexOf(oldText);
        if (idx === -1) {
            throw new Error(`edits[${i}].oldText was not found in ${path}. It must match exactly.`);
        }
        if (normalizedContent.indexOf(oldText, idx + 1) !== -1) {
            throw new Error(`edits[${i}].oldText was found multiple times in ${path}. Add more context.`);
        }
        matches.push({ index: idx, length: oldText.length, newText: normalizedEdits[i].newText, editIdx: i });
    }

    matches.sort((a, b) => a.index - b.index);
    for (let i = 1; i < matches.length; i++) {
        const prev = matches[i - 1];
        const curr = matches[i];
        if (prev.index + prev.length > curr.index) {
            throw new Error(`edits[${prev.editIdx}] and edits[${curr.editIdx}] overlap in ${path}.`);
        }
    }

    let newContent = normalizedContent;
    for (let i = matches.length - 1; i >= 0; i--) {
        const match = matches[i];
        newContent = newContent.substring(0, match.index) + match.newText +
            newContent.substring(match.index + match.length);
    }

    if (normalizedContent === newContent) {
        throw new Error(`No changes made to ${path}. The replacement(s) produced identical content.`);
    }

    return { baseContent: normalizedContent, newContent };
}

/**
 * @param {unknown} input
 * @returns {MultiFileEditParams}
 */
function prepareMultiFileEditArguments(input) {
    if (!input || typeof input !== "object") return /** @type {MultiFileEditParams} */ (input);

    const args = /** @type {Record<string, unknown>} */ (input);
    const topLevelPath = typeof args.path === "string"
        ? args.path
        : typeof args.file_path === "string"
        ? args.file_path
        : undefined;

    if (Array.isArray(args.edits)) {
        const edits = args.edits.map((rawEdit) => {
            const edit = /** @type {Record<string, unknown>} */ (rawEdit);
            const editPath = typeof edit.path === "string"
                ? edit.path
                : typeof edit.file_path === "string"
                ? edit.file_path
                : topLevelPath;
            return {
                path: editPath,
                oldText: edit.oldText,
                newText: edit.newText,
            };
        });
        return {
            ...(typeof args.root === "string" ? { root: args.root } : {}),
            edits: /** @type {MultiFileEdit[]} */ (edits),
        };
    }

    if (topLevelPath && typeof args.oldText === "string" && typeof args.newText === "string") {
        return {
            ...(typeof args.root === "string" ? { root: args.root } : {}),
            edits: [{ path: topLevelPath, oldText: args.oldText, newText: args.newText }],
        };
    }

    return /** @type {MultiFileEditParams} */ (input);
}

/**
 * @param {MultiFileEdit[]} edits
 * @returns {Map<string, MultiFileEdit[]>}
 */
function groupEditsByPath(edits) {
    const grouped = new Map();
    for (const edit of edits) {
        const existing = grouped.get(edit.path) || [];
        existing.push(edit);
        grouped.set(edit.path, existing);
    }
    return grouped;
}

/**
 * @param {string} cwd
 * @returns {import('@earendil-works/pi-coding-agent').ToolDefinition}
 */
export function createMultiFileEditTool(cwd) {
    return defineTool({
        name: "multi_file_edit",
        label: "multi_file_edit",
        description:
            "Edit one or more files by applying multiple exact-text replacements. Each edits[] item includes its own path, oldText, and newText. Use edit for a single replacement in a single file.",
        promptSnippet:
            "Apply multiple exact-text replacements across one or more files with edits[].path, edits[].oldText, and edits[].newText",
        promptGuidelines: [
            "Use multi_file_edit when a task needs multiple replacements or touches multiple files",
            "Each edits[] item must include path, oldText, and newText",
            "Use edit instead for exactly one replacement in one file",
            "Within each file, oldText entries are matched against the original file content and must not overlap",
        ],
        parameters: toolParams,
        prepareArguments: prepareMultiFileEditArguments,
        async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
            const typedParams = /** @type {MultiFileEditParams} */ (params);
            const baseDir = typedParams.root ? resolveRoot(typedParams.root, cwd) : cwd;
            const groupedEdits = groupEditsByPath(typedParams.edits);
            /** @type {string[]} */
            const diffSections = [];
            /** @type {number | undefined} */
            let firstChangedLine;
            let replacementCount = 0;

            try {
                for (const [filePath, fileEdits] of groupedEdits) {
                    const absolutePath = resolveToBaseDir(filePath, baseDir);
                    await withFileMutationQueue(absolutePath, async () => {
                        try {
                            await Deno.stat(absolutePath);
                        } catch (err) {
                            const error = /** @type {Error} */ (err);
                            const msg = error instanceof Deno.errors.NotFound
                                ? `Could not find file: ${filePath}`
                                : `Could not access file: ${filePath}. ${error.message}`;
                            throw new Error(msg);
                        }

                        const rawContent = await Deno.readTextFile(absolutePath);
                        const { bom, text: content } = stripBom(rawContent);
                        const originalEnding = detectLineEnding(content);
                        const normalizedContent = normalizeToLF(content);
                        const { baseContent, newContent } = applyEdits(normalizedContent, fileEdits, filePath);
                        const finalContent = bom + restoreLineEndings(newContent, originalEnding);

                        await Deno.writeTextFile(absolutePath, finalContent);

                        const diffResult = generateDiffString(baseContent, newContent);
                        diffSections.push(`--- ${filePath}\n${diffResult.diff}`);
                        if (firstChangedLine === undefined) firstChangedLine = diffResult.firstChangedLine;
                        replacementCount += fileEdits.length;
                    });
                }

                const fileCount = groupedEdits.size;
                const replacementNoun = replacementCount === 1 ? "replacement" : "replacements";
                const fileNoun = fileCount === 1 ? "file" : "files";
                return {
                    content: [{
                        type: "text",
                        text:
                            `Successfully applied ${replacementCount} ${replacementNoun} across ${fileCount} ${fileNoun}.`,
                    }],
                    details: { diff: diffSections.join("\n\n"), firstChangedLine },
                };
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                return {
                    content: [{ type: "text", text: message }],
                    details: /** @type {any} */ (null),
                    isError: true,
                };
            }
        },
    });
}
