/**
 * @module shared/workflow/review-diff-tool
 * Read-only diff inspection custom tool for the semantic reviewer.
 * Parses unified diff text into per-file entries and exposes bounded
 * list/show operations so the reviewer can inspect changed files
 * without receiving the entire inline diff.
 */

import { StringEnum, Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";

/**
 * @typedef {Object} DiffFileEntry
 * @property {string} path - File path (from b/ side of diff header).
 * @property {"added" | "deleted" | "modified" | "renamed" | "copied"} changeType
 * @property {number} byteLength - Total byte length of this file's diff hunk.
 * @property {number} lineCount - Total line count of this file's diff hunk.
 * @property {{ added: number, removed: number }} hunkLines - Line counts per hunk type.
 * @property {string} text - The full diff text for this file.
 */

/**
 * Parse unified diff text into an array of per-file entries.
 * Handles standard diff --git headers, renames, copies, new/deleted files,
 * and binary files.
 *
 * @param {string} diffText - Raw unified diff output.
 * @returns {DiffFileEntry[]}
 */
export function parseDiffFiles(diffText) {
    if (!diffText || !diffText.trim()) return [];

    /** @type {DiffFileEntry[]} */
    const entries = [];
    const headerPattern = /^diff --git a\/(.+?) b\/(.+)$/gm;

    // Collect header positions manually to split the diff into per-file chunks
    /** @type {{ bPath: string, start: number }[]} */
    const headers = [];
    /** @type {RegExpExecArray | null} */
    let match;
    while ((match = headerPattern.exec(diffText)) !== null) {
        headers.push({ bPath: match[2], start: match.index });
    }

    if (headers.length === 0) {
        // No standard headers found; try simpler diff or return empty
        return [];
    }

    for (let i = 0; i < headers.length; i++) {
        const header = headers[i];
        const end = i + 1 < headers.length ? headers[i + 1].start : diffText.length;
        const chunk = diffText.slice(header.start, end);

        // Determine change type from diff headers within this chunk
        /** @type {"added" | "deleted" | "modified" | "renamed" | "copied"} */
        let changeType = "modified";
        if (/^new file mode /m.test(chunk)) changeType = "added";
        else if (/^deleted file mode /m.test(chunk)) changeType = "deleted";
        else if (/^rename from /m.test(chunk)) changeType = "renamed";
        else if (/^copy from /m.test(chunk)) changeType = "copied";

        // Check for binary files
        if (/^Binary files /m.test(chunk)) {
            changeType = changeType === "deleted" ? "deleted" : "modified";
        }

        // Count diff lines (lines starting with +, -, or @@)
        let added = 0;
        let removed = 0;
        const lines = chunk.split("\n");
        for (const line of lines) {
            const trimmed = line.trimEnd();
            if (trimmed.startsWith("+") && !trimmed.startsWith("+++")) added++;
            else if (trimmed.startsWith("-") && !trimmed.startsWith("---")) removed++;
        }

        entries.push({
            path: header.bPath,
            changeType,
            byteLength: new TextEncoder().encode(chunk).byteLength,
            lineCount: lines.length,
            hunkLines: { added, removed },
            text: chunk,
        });
    }

    return entries;
}

/**
 * Produce a human-readable summary line for a file change.
 *
 * @param {DiffFileEntry} entry
 * @returns {string}
 */
export function formatDiffFileSummary(entry) {
    const typeLabel = entry.changeType.charAt(0).toUpperCase() + entry.changeType.slice(1);
    const lineInfo = `${entry.hunkLines.added} added, ${entry.hunkLines.removed} removed`;
    const sizeInfo = `(${formatByteSize(entry.byteLength)})`;
    return `  ${typeLabel}: ${entry.path} — ${lineInfo} ${sizeInfo}`;
}

/**
 * @param {number} bytes
 * @returns {string}
 */
function formatByteSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Produce a markdown changed-file listing for the review prompt.
 *
 * @param {DiffFileEntry[]} entries
 * @returns {string}
 */
export function formatChangedFileList(entries) {
    if (entries.length === 0) return "(no changed files detected)";
    const totalBytes = entries.reduce((sum, e) => sum + e.byteLength, 0);
    const totalAdded = entries.reduce((sum, e) => sum + e.hunkLines.added, 0);
    const totalRemoved = entries.reduce((sum, e) => sum + e.hunkLines.removed, 0);
    const lines = [
        `**Total:** ${entries.length} file(s), ${
            formatByteSize(totalBytes)
        } diff, ${totalAdded} added, ${totalRemoved} removed lines.`,
        "",
    ];

    for (const entry of entries) {
        lines.push(formatDiffFileSummary(entry));
    }

    return lines.join("\n");
}

/**
 * @typedef {Object} DiffReviewStats
 * @property {number} changedFiles
 * @property {number} changedLines
 * @property {number} addedLines
 * @property {number} removedLines
 * @property {string[]} meaningfulAreas
 * @property {boolean} lowSignalOnly
 * @property {string[]} paths
 */

const LOW_REVIEW_SIGNAL_PATTERNS = [
    /^docs\//,
    /^plans\//,
    /^third_party\//,
    /(^|\/)deno\.lock$/,
    /(^|\/)package-lock\.json$/,
    /(^|\/)pnpm-lock\.yaml$/,
    /(^|\/)yarn\.lock$/,
    /(^|\/)dist\//,
    /(^|\/)generated\//,
    /\.md$/,
];

/**
 * Compute compact review-planning statistics from parsed diff entries.
 *
 * @param {DiffFileEntry[]} entries
 * @returns {DiffReviewStats}
 */
export function summarizeDiffForReview(entries) {
    const paths = entries.map((entry) => entry.path);
    const lowSignalOnly = entries.length > 0 &&
        entries.every((entry) => LOW_REVIEW_SIGNAL_PATTERNS.some((pattern) => pattern.test(entry.path)));
    const meaningfulAreas = [
        ...new Set(entries.flatMap((entry) => {
            if (LOW_REVIEW_SIGNAL_PATTERNS.some((pattern) => pattern.test(entry.path))) return [];
            const [first, second] = entry.path.split("/");
            return first === "src" && second ? [`src/${second}`] : [first || entry.path];
        })),
    ].sort();
    const addedLines = entries.reduce((sum, entry) => sum + entry.hunkLines.added, 0);
    const removedLines = entries.reduce((sum, entry) => sum + entry.hunkLines.removed, 0);
    return {
        changedFiles: entries.length,
        changedLines: addedLines + removedLines,
        addedLines,
        removedLines,
        meaningfulAreas,
        lowSignalOnly,
        paths,
    };
}

/**
 * @param {string} path - The requested file path.
 * @param {DiffFileEntry[]} entries
 * @param {{ offsetBytes?: number, maxBytes?: number }} [options]
 * @returns {{ found: true, entry: DiffFileEntry, content: string, truncated: boolean, remainingBytes: number } | { found: false, message: string }}
 */
export function getFileDiff(entries, path, options = {}) {
    const entry = entries.find((e) => e.path === path || e.path.endsWith(`/${path}`));
    if (!entry) {
        return { found: false, message: `File "${path}" not found in diff. Use "list" to see available files.` };
    }

    const offsetBytes = options.offsetBytes || 0;
    const maxBytes = options.maxBytes || (64 * 1024);

    if (offsetBytes >= entry.byteLength) {
        return {
            found: true,
            entry,
            content: "",
            truncated: false,
            remainingBytes: 0,
        };
    }

    const encoder = new TextEncoder();
    const fullBytes = encoder.encode(entry.text);
    const sliced = fullBytes.slice(offsetBytes, offsetBytes + maxBytes);
    const remainingBytes = Math.max(0, fullBytes.byteLength - (offsetBytes + sliced.byteLength));
    const truncated = remainingBytes > 0;

    return {
        found: true,
        entry,
        content: new TextDecoder().decode(sliced),
        truncated,
        remainingBytes,
    };
}

/**
 * Summary info for a single diff file.
 *
 * @typedef {Object} DiffFileSummary
 * @property {string} path
 * @property {string} changeType
 * @property {number} byteLength
 * @property {number} lineCount
 * @property {{ added: number, removed: number }} hunkLines
 * @property {boolean} truncated - True if the full diff exceeds the max inline display size.
 * @property {number | null} maxInlineBytes - The max inline display size, or null if not truncated.
 */

/**
 * Build a list of file summaries for display, with truncation metadata.
 *
 * @param {DiffFileEntry[]} entries
 * @param {number} [maxInlineBytes]
 * @returns {DiffFileSummary[]}
 */
export function listDiffFiles(entries, maxInlineBytes = 64 * 1024) {
    return entries.map((entry) => ({
        path: entry.path,
        changeType: entry.changeType,
        byteLength: entry.byteLength,
        lineCount: entry.lineCount,
        hunkLines: entry.hunkLines,
        truncated: entry.byteLength > maxInlineBytes,
        maxInlineBytes: entry.byteLength > maxInlineBytes ? maxInlineBytes : null,
    }));
}

/**
 * Create the review_diff custom tool for the semantic reviewer.
 * The tool provides bounded, read-only access to the workflow diff.
 *
 * @param {string} diffText - The captured workflow diff text.
 * @returns {ReturnType<typeof defineTool>}
 */
export function createReviewDiffTool(diffText) {
    const entries = parseDiffFiles(diffText);
    const MAX_INLINE_BYTES = 64 * 1024;
    const MAX_READ_BYTES = 64 * 1024;

    return defineTool({
        name: "review_diff",
        label: "Review Diff",
        description:
            "Bounded, read-only access to the current workflow diff. Use 'list' to see changed files with sizes, or 'show' to read the diff for a specific file path. Does not run git commands.",
        promptSnippet:
            "review_diff(list|show): List changed files or read the diff for one file. Prefer 'list' first to see what changed, then 'show <path>' to inspect specific files.",
        parameters: Type.Object({
            command: StringEnum(["list", "show"]),
            path: Type.Optional(Type.String({
                description:
                    "Required for 'show'. The file path to inspect. Accepts partial path matches for convenience.",
            })),
            offsetBytes: Type.Optional(Type.Integer({
                minimum: 0,
                description:
                    "Byte offset into the file's diff content. Use to page through large per-file diffs. Default: 0.",
            })),
            maxBytes: Type.Optional(Type.Integer({
                minimum: 256,
                maximum: MAX_READ_BYTES,
                description:
                    `Maximum bytes to return for this file's diff. Default: ${MAX_READ_BYTES}. Max: ${MAX_READ_BYTES}.`,
            })),
        }),
        execute(_toolCallId, rawParams) {
            /** @type {{ command: string, path?: string, offsetBytes?: number, maxBytes?: number }} */
            const params = /** @type {any} */ (rawParams);

            if (params.command === "list") {
                const summaries = listDiffFiles(entries, MAX_INLINE_BYTES);
                if (summaries.length === 0) {
                    return Promise.resolve({
                        content: [{ type: "text", text: "No changed files detected in the workflow diff." }],
                        details: /** @type {any} */ ({ command: "list", fileCount: 0 }),
                    });
                }

                const lines = [
                    `## Changed Files (${summaries.length} total)`,
                    "",
                    "| Path | Change | Added | Removed | Size | Full diff available |",
                    "|------|--------|-------|---------|------|---------------------|",
                ];
                for (const s of summaries) {
                    const status = s.truncated ? `Trucated (max ${formatByteSize(MAX_INLINE_BYTES)} shown)` : "Yes";
                    lines.push(
                        `| \`${s.path}\` | ${s.changeType} | ${s.hunkLines.added} | ${s.hunkLines.removed} | ${
                            formatByteSize(s.byteLength)
                        } | ${status} |`,
                    );
                }
                lines.push(
                    "",
                    'Use `review_diff(command: "show", path: "<file-path>")` to read the diff for a specific file.',
                );

                return Promise.resolve({
                    content: [{ type: "text", text: lines.join("\n") }],
                    details: /** @type {any} */ ({ command: "list", fileCount: summaries.length }),
                });
            }

            if (params.command === "show") {
                if (!params.path) {
                    return Promise.resolve({
                        content: [{ type: "text", text: "Error: 'path' is required for 'show' command." }],
                        isError: true,
                        details: /** @type {any} */ ({ command: "show" }),
                    });
                }

                const result = getFileDiff(entries, params.path, {
                    offsetBytes: params.offsetBytes,
                    maxBytes: params.maxBytes || MAX_READ_BYTES,
                });

                if (!result.found) {
                    return Promise.resolve({
                        content: [{ type: "text", text: result.message }],
                        isError: true,
                        details: /** @type {any} */ ({ command: "show", path: params.path, found: false }),
                    });
                }

                const content = [`## Diff: ${result.entry.path}`];
                if (result.entry.changeType !== "modified") {
                    content.push(`Change type: ${result.entry.changeType}`);
                }
                if (result.truncated) {
                    content.push(
                        "",
                        `[Diff truncated at ${formatByteSize(params.maxBytes || MAX_READ_BYTES)}. Use offsetBytes=${
                            (params.offsetBytes || 0) + (params.maxBytes || MAX_READ_BYTES)
                        } to read next chunk. ${formatByteSize(result.remainingBytes)} remaining.]`,
                    );
                }
                content.push("", "```diff", result.content, "```");

                return Promise.resolve({
                    content: [{ type: "text", text: content.join("\n") }],
                    details: /** @type {any} */ ({
                        command: "show",
                        path: result.entry.path,
                        truncated: result.truncated,
                        remainingBytes: result.remainingBytes,
                    }),
                });
            }

            return Promise.resolve({
                content: [{ type: "text", text: `Error: unknown command "${params.command}". Use 'list' or 'show'.` }],
                isError: true,
                details: /** @type {any} */ ({ command: params.command || "", error: "unknown_command" }),
            });
        },
    });
}

/**
 * Build a compact review packet summarizing a large diff without
 * including the full diff text inline.
 *
 * @param {import('../session/types.js').AgentDefinition} _reviewerAgentDef
 * @param {string} planContent
 * @param {string} diffText
 * @param {number} totalDiffBytes
 * @returns {string}
 */
export function buildLargeDiffReviewPrompt(_reviewerAgentDef, planContent, diffText, totalDiffBytes) {
    const entries = parseDiffFiles(diffText);
    const fileList = formatChangedFileList(entries);

    return [
        `The workflow diff is **${
            formatByteSize(totalDiffBytes)
        }** and was omitted from this prompt to avoid context overflow.`,
        "",
        "### Changed Files",
        "",
        fileList,
        "",
        "### How to Review",
        "",
        "1. Use the `review_diff` tool to inspect changed files.",
        `   - \`review_diff(command: "list")\` — see all changed files with sizes.`,
        `   - \`review_diff(command: "show", path: "<file>")\` — read the diff for one file.`,
        `   - Large file diffs are returned in bounded chunks; use \`offsetBytes\` to page through.`,
        "",
        "2. Use \`read\`, \`grep\`, \`find\`, and \`ls\` to inspect current file contents.",
        "   - Read files around the changed lines for context: \`read file.js\`.",
        "   - Search the codebase for patterns affected by the change.",
        "   - Look at test files, type definitions, or related modules that the diff touches.",
        "",
        "3. Focus on the most relevant changed files first:",
        "   - Files named in the plan.",
        "   - Files with substantive logic changes (large added/removed line counts).",
        "   - Edge cases called out by the plan.",
        "",
        "4. Compare each changed file's diff + current code against the plan requirements.",
        "",
        "### Original Plan",
        "",
        planContent,
    ].join("\n");
}
