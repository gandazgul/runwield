/**
 * @module tools/plan-safe-file-tools
 * Safety wrappers for Agent file tools that touch canonical Plan markdown.
 */

import { dirname, isAbsolute, join, relative } from "@std/path";
import {
    atomicWriteTextFileIfAbsent,
    getPlanRevisionForText,
    withPlanCatalogLock,
    withPlanLock,
    writePlanMarkdownWithRevisionLocked,
} from "../plan-store.js";

/** @param {unknown} value */
function stringValue(value) {
    return typeof value === "string" && value.trim() ? value.trim() : "";
}

/**
 * @param {string} cwd
 * @param {string} path
 */
export function isCanonicalPlanMarkdownPath(cwd, path) {
    const absolute = isAbsolute(path) ? path : join(cwd, path);
    const rel = relative(cwd, absolute).replaceAll("\\", "/");
    return rel.startsWith("plans/") && rel.endsWith(".md") && !rel.startsWith("plans/archived/");
}

/**
 * @param {string} cwd
 * @param {string} path
 * @returns {string}
 */
function planNameFromCanonicalMarkdownPath(cwd, path) {
    const absolute = isAbsolute(path) ? path : join(cwd, path);
    const rel = relative(cwd, absolute).replaceAll("\\", "/");
    if (!rel.startsWith("plans/") || !rel.endsWith(".md") || rel.startsWith("plans/archived/")) {
        throw new Error(`Not a canonical Plan markdown path: ${path}`);
    }
    return rel.slice("plans/".length, -".md".length);
}

/**
 * @param {string} content
 * @param {string} oldText
 * @param {string} newText
 * @param {string} path
 */
function applySingleExactEdit(content, oldText, newText, path) {
    if (!oldText) throw new Error(`oldText must not be empty for ${path}.`);
    const first = content.indexOf(oldText);
    if (first === -1) throw new Error(`oldText was not found in ${path}. It must match exactly.`);
    if (content.indexOf(oldText, first + 1) !== -1) {
        throw new Error(`oldText was found multiple times in ${path}. Add more context.`);
    }
    const next = content.slice(0, first) + newText + content.slice(first + oldText.length);
    if (next === content) throw new Error(`No changes made to ${path}. The replacement produced identical content.`);
    return next;
}

/**
 * Wrap a Pi file tool with conservative Plan-file overwrite protection.
 * Exact-text edit tools for canonical Plans are applied through Plan CAS so an
 * edit loaded from stale bytes cannot silently overwrite concurrent metadata.
 * Whole-file write must create a new Plan rather than overwrite an existing one.
 *
 * @param {import('@earendil-works/pi-coding-agent').ToolDefinition} tool
 * @param {{ cwd: string, mode: "write"|"edit" }} opts
 */
export function wrapPlanSafeFileTool(tool, { cwd, mode }) {
    const originalExecute = /** @type {any} */ (tool.execute);
    return {
        ...tool,
        async execute(
            /** @type {string} */ toolCallId,
            /** @type {any} */ params,
            /** @type {AbortSignal|undefined} */ signal,
            /** @type {unknown} */ onUpdate,
            /** @type {unknown} */ ctx,
        ) {
            const path = stringValue(params?.path ?? params?.file_path);
            if (path && isCanonicalPlanMarkdownPath(cwd, path)) {
                const absolute = isAbsolute(path) ? path : join(cwd, path);
                if (mode === "write") {
                    try {
                        const stat = await Deno.stat(absolute);
                        if (stat.isFile) {
                            return {
                                content: [{
                                    type: "text",
                                    text:
                                        "Refusing to overwrite an existing Plan with the write tool. Re-read the Plan and use exact-text edit or multi_file_edit so RunWield can preserve concurrent Plan changes.",
                                }],
                                isError: true,
                            };
                        }
                    } catch (error) {
                        if (!(error instanceof Deno.errors.NotFound)) throw error;
                    }
                    const content = typeof params?.content === "string"
                        ? params.content
                        : typeof params?.text === "string"
                        ? params.text
                        : undefined;
                    if (content === undefined) {
                        return {
                            content: [{ type: "text", text: "Plan creation requires string content." }],
                            isError: true,
                        };
                    }
                    try {
                        await withPlanCatalogLock(
                            cwd,
                            async () =>
                                await withPlanLock(cwd, planNameFromCanonicalMarkdownPath(cwd, path), async () => {
                                    try {
                                        await Deno.stat(absolute);
                                        throw new Error(`Plan already exists: ${path}`);
                                    } catch (error) {
                                        if (!(error instanceof Deno.errors.NotFound)) throw error;
                                    }
                                    await Deno.mkdir(dirname(absolute), { recursive: true });
                                    await atomicWriteTextFileIfAbsent(absolute, content);
                                }),
                        );
                        return {
                            content: [{ type: "text", text: `Successfully created Plan ${path}.` }],
                            details: null,
                        };
                    } catch (error) {
                        return {
                            content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
                            isError: true,
                        };
                    }
                }
                if (mode === "edit") {
                    try {
                        const oldText = typeof params?.oldText === "string" ? params.oldText : undefined;
                        const newText = typeof params?.newText === "string" ? params.newText : undefined;
                        if (oldText === undefined || newText === undefined) {
                            throw new Error("Plan edit requires path, oldText, and newText.");
                        }
                        const current = await Deno.readTextFile(absolute);
                        const expectedRevision = await getPlanRevisionForText(current);
                        const next = applySingleExactEdit(current, oldText, newText, path);
                        await writePlanMarkdownWithRevisionLocked(
                            cwd,
                            planNameFromCanonicalMarkdownPath(cwd, path),
                            absolute,
                            next,
                            expectedRevision,
                        );
                        return {
                            content: [{ type: "text", text: `Successfully edited Plan ${path}.` }],
                            details: null,
                        };
                    } catch (error) {
                        return {
                            content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
                            isError: true,
                        };
                    }
                }
            }
            return await originalExecute.call(tool, toolCallId, params, signal, onUpdate, ctx);
        },
    };
}
