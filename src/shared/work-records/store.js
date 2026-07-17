/**
 * @module shared/work-records/store
 * Canonical Work Record filesystem store.
 */

import { basename, join, relative } from "@std/path";
import { WORK_RECORDS_DIR_NAME } from "../../constants.js";
import { formatWorkRecordMarkdown, parseWorkRecordMarkdown } from "./markdown.js";

/** @param {string} cwd */
export function getWorkRecordsDir(cwd) {
    return join(cwd, WORK_RECORDS_DIR_NAME);
}

/** @param {string} cwd */
export async function ensureWorkRecordsDir(cwd) {
    const dir = getWorkRecordsDir(cwd);
    await Deno.mkdir(dir, { recursive: true });
    return dir;
}

/** @param {string} title */
export function slugifyWorkRecordTitle(title) {
    return String(title || "work-record")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "work-record";
}

/**
 * @param {string} title
 * @param {Date} [date]
 */
export function buildWorkRecordFileName(title, date = new Date()) {
    return `${date.toISOString().slice(0, 10)}-${slugifyWorkRecordTitle(title)}.md`;
}

/**
 * @param {string} cwd
 * @param {string} fileName
 */
export function resolveWorkRecordPath(cwd, fileName) {
    const name = basename(String(fileName || "").replaceAll("\\", "/"));
    if (!name || name !== fileName || name === "." || name === ".." || !name.endsWith(".md")) {
        throw new Error(`Work Record path must be a flat Markdown filename under ${WORK_RECORDS_DIR_NAME}/.`);
    }
    return join(getWorkRecordsDir(cwd), name);
}

/**
 * @param {string} cwd
 * @param {string} filePath
 */
function relativeWorkRecordPath(cwd, filePath) {
    return relative(cwd, filePath).replaceAll("\\", "/");
}

/**
 * @param {string} cwd
 * @param {string} fileName
 */
export async function readWorkRecord(cwd, fileName) {
    const filePath = resolveWorkRecordPath(cwd, fileName);
    const markdown = await Deno.readTextFile(filePath);
    return parseWorkRecordMarkdown(markdown, {
        path: filePath,
        relativePath: relativeWorkRecordPath(cwd, filePath),
    });
}

/**
 * @param {string} cwd
 * @param {{ createDir?: boolean }} [options]
 * @returns {Promise<import('./schema.js').WorkRecordResource[]>}
 */
export async function listWorkRecords(cwd, options = {}) {
    const dir = options.createDir === false ? getWorkRecordsDir(cwd) : await ensureWorkRecordsDir(cwd);
    if (options.createDir === false) {
        try {
            const stat = await Deno.stat(dir);
            if (!stat.isDirectory) return [];
        } catch (error) {
            if (error instanceof Deno.errors.NotFound) return [];
            throw error;
        }
    }
    const records = [];
    for await (const entry of Deno.readDir(dir)) {
        if (!entry.isFile || !entry.name.endsWith(".md")) continue;
        const filePath = join(dir, entry.name);
        const markdown = await Deno.readTextFile(filePath);
        records.push(parseWorkRecordMarkdown(markdown, {
            path: filePath,
            relativePath: relativeWorkRecordPath(cwd, filePath),
        }));
    }
    return records.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

/**
 * @param {string} cwd
 * @param {string} recordId
 */
export async function findWorkRecordById(cwd, recordId) {
    const records = await listWorkRecords(cwd);
    return records.find((record) => record.attrs.recordId === recordId) || null;
}

/**
 * @param {string} cwd
 * @param {import('./schema.js').WorkRecordFrontMatter} attrs
 * @param {string} body
 * @param {{ fileName?: string }} [options]
 */
export async function writeWorkRecord(cwd, attrs, body, options = {}) {
    await ensureWorkRecordsDir(cwd);
    const title = body.match(/^#\s+(.+)$/m)?.[1] || attrs.recordId;
    const fileName = options.fileName || buildWorkRecordFileName(title);
    const filePath = resolveWorkRecordPath(cwd, fileName);
    const markdown = formatWorkRecordMarkdown(attrs, body);
    parseWorkRecordMarkdown(markdown, { path: filePath, relativePath: relativeWorkRecordPath(cwd, filePath) });
    const tempPath = `${filePath}.tmp-${crypto.randomUUID()}`;
    await Deno.writeTextFile(tempPath, markdown);
    await Deno.rename(tempPath, filePath);
    return parseWorkRecordMarkdown(markdown, { path: filePath, relativePath: relativeWorkRecordPath(cwd, filePath) });
}
