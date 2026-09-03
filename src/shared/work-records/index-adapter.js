/**
 * @module shared/work-records/index-adapter
 * Derived Mnemoteca index for canonical Work Records.
 */

import { basename, dirname } from "@std/path";
import { listWorkRecords } from "./store.js";

const LOCATOR_PREFIX = "work-record:";
const REBUILD_GUIDANCE = "Run `wld wr index rebuild` to repair the derived Work Record index.";

/**
 * @typedef {Object} WorkRecordIndexOptions
 * @property {import('./mnemoteca-port.ts').WorkRecordMnemotecaPort} mnemotecaPort
 */

/**
 * @param {string} cwd
 * @returns {Promise<string>}
 */
async function resolveGitCommonDir(cwd) {
    try {
        const command = new Deno.Command("git", {
            args: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
            cwd,
            stdout: "piped",
            stderr: "piped",
        });
        const result = await command.output();
        if (result.code !== 0) return "";
        return decode(result.stdout);
    } catch {
        return "";
    }
}

/**
 * @param {string} cwd
 * @param {string} gitCommonDir
 */
function resolveWorkRecordIndexProjectName(cwd, gitCommonDir) {
    const rawName = gitCommonDir ? basename(dirname(gitCommonDir)) || basename(cwd) : basename(cwd);
    return rawName === "global" || !rawName ? "default" : rawName;
}

/** @param {string} cwd */
export async function getWorkRecordIndexCollectionName(cwd) {
    return `${resolveWorkRecordIndexProjectName(cwd, await resolveGitCommonDir(cwd))}:work-records`;
}

/** @param {import('./schema.js').WorkRecordResource} record */
export function getWorkRecordLocatorTag(record) {
    return `${LOCATOR_PREFIX}${record.attrs.recordId}`;
}

/** @param {string[]} tags */
export function recordIdFromTags(tags) {
    const tag = tags.find((candidate) => candidate.startsWith(LOCATOR_PREFIX));
    return tag ? tag.slice(LOCATOR_PREFIX.length) : "";
}

/** @param {import('./schema.js').WorkRecordResource} record */
export function buildWorkRecordIndexTags(record) {
    const tags = [
        `status:${record.attrs.status}`,
        `scope:${record.attrs.scope}`,
        ...(record.attrs.workKind ? [`workKind:${record.attrs.workKind}`] : []),
        `origin:${record.attrs.origin}`,
        `completion:${record.attrs.completionMode}`,
        `archived:${record.attrs.archivedAt ? "true" : "false"}`,
        `superseded:${record.attrs.status === "superseded" || record.attrs.supersededBy ? "true" : "false"}`,
        getWorkRecordLocatorTag(record),
    ];
    return [...new Set(tags)];
}

/** @param {import('./schema.js').WorkRecordResource} record */
export function buildWorkRecordIndexDocument(record) {
    const sourcePlans = record.attrs.provenance?.sourcePlans || [];
    const ticketUrls = (record.attrs.tickets || []).map((ticket) => ticket.url).filter(Boolean);
    return [
        `# ${record.title}`,
        "",
        `recordId: ${record.attrs.recordId}`,
        `status: ${record.attrs.status}`,
        `scope: ${record.attrs.scope}`,
        `origin: ${record.attrs.origin}`,
        `completionMode: ${record.attrs.completionMode}`,
        sourcePlans.length ? `sourcePlans: ${sourcePlans.join(", ")}` : "sourcePlans: none",
        ticketUrls.length ? `ticketUrls: ${ticketUrls.join(", ")}` : "ticketUrls: none",
        "",
        "## Summary",
        "",
        record.summary,
    ].join("\n").trim();
}

/** @param {Uint8Array} bytes */
function decode(bytes) {
    return new TextDecoder().decode(bytes || new Uint8Array()).trim();
}

/**
 * @param {string} cwd
 * @param {string[]} args
 * @param {WorkRecordIndexOptions} options
 */
export async function runMnemotecaWorkRecordCommand(cwd, args, options) {
    const mnemotecaPort = options.mnemotecaPort;
    let result;
    try {
        result = await mnemotecaPort.run(args, { cwd });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`mnemoteca ${args[0] || ""} failed: ${message}`);
    }
    if (!result.success) {
        const stderr = decode(result.stderr);
        const stdout = decode(result.stdout);
        throw new Error(stderr || stdout || `mnemoteca ${args[0] || ""} failed with exit code ${result.code}`);
    }
    return decode(result.stdout) || decode(result.stderr);
}

/**
 * @param {string} cwd
 * @param {WorkRecordIndexOptions} options
 */
export async function verifyMnemotecaUpdateAvailable(cwd, options) {
    const help = await runMnemotecaWorkRecordCommand(cwd, ["update", "--help"], options);
    if (!help.includes("update <id>") || !help.includes("--replace-tags")) {
        throw new Error("mnemoteca update prerequisite is unavailable or missing strict --replace-tags support.");
    }
    return true;
}

/**
 * @param {string} cwd
 * @param {WorkRecordIndexOptions} options
 */
export async function initializeWorkRecordIndex(cwd, options) {
    await runMnemotecaWorkRecordCommand(cwd, ["init", "--name", await getWorkRecordIndexCollectionName(cwd)], options);
}

/** @param {string} output */
function isEmptyPlainListOutput(output) {
    const trimmed = String(output || "").trim();
    return !trimmed || /^no\s+documents\b/i.test(trimmed);
}

/** @param {string} line */
function isPlainListFooterLine(line) {
    return /^Showing\s+\d+\s+of\s+\d+\s+documents\b/i.test(line.trim());
}

/**
 * @param {string} output
 * @param {{ recordId?: string, tolerateMalformed?: boolean }} [options]
 * @returns {number[]}
 */
function parsePlainListDocumentIds(output, options = {}) {
    if (isEmptyPlainListOutput(output)) return [];
    const ids = [];
    for (const line of String(output || "").split("\n")) {
        if (!line.trim() || isPlainListFooterLine(line)) continue;
        const match = line.match(/^\s*\[(\d+)\]/);
        if (match) ids.push(Number(match[1]));
    }
    if (!options.tolerateMalformed && ids.length === 0) {
        const target = options.recordId ? ` for ${options.recordId}` : "";
        throw new Error(
            `Work Record index locator listing${target} did not include a parseable Mnemoteca numeric document ID. ${REBUILD_GUIDANCE}`,
        );
    }
    return ids;
}

/**
 * @param {string} cwd
 * @param {string} recordId
 * @param {WorkRecordIndexOptions} options
 */
export async function findIndexedDocumentIdsByRecordId(cwd, recordId, options) {
    const out = await runMnemotecaWorkRecordCommand(cwd, [
        "list",
        "--name",
        await getWorkRecordIndexCollectionName(cwd),
        "--format",
        "plain",
        "--limit",
        "1000",
        "--tag",
        `${LOCATOR_PREFIX}${recordId}`,
    ], options);
    return parsePlainListDocumentIds(out, { recordId });
}

/**
 * @param {string} cwd
 * @param {import('./schema.js').WorkRecordResource} record
 * @param {WorkRecordIndexOptions} options
 */
export async function syncWorkRecordToIndex(cwd, record, options) {
    await verifyMnemotecaUpdateAvailable(cwd, options);
    await initializeWorkRecordIndex(cwd, options);
    const collection = await getWorkRecordIndexCollectionName(cwd);
    const tags = buildWorkRecordIndexTags(record);
    const content = buildWorkRecordIndexDocument(record);
    const ids = await findIndexedDocumentIdsByRecordId(cwd, record.attrs.recordId, options);
    const tagArgs = tags.flatMap((tag) => ["--tag", tag]);
    if (ids.length > 1) {
        throw new Error(`Duplicate Work Record index entries for ${record.attrs.recordId}. ${REBUILD_GUIDANCE}`);
    }
    if (ids.length === 0) {
        await runMnemotecaWorkRecordCommand(cwd, ["add", "--name", collection, ...tagArgs, content], options);
        return { action: "added", recordId: record.attrs.recordId };
    }
    const id = ids[0];
    if (!Number.isFinite(id)) throw new Error(`Missing Mnemoteca numeric document ID for ${record.attrs.recordId}.`);
    await runMnemotecaWorkRecordCommand(cwd, [
        "update",
        String(id),
        "--name",
        collection,
        "--replace-tags",
        ...tagArgs,
        content,
    ], options);
    return { action: "updated", recordId: record.attrs.recordId, documentId: id };
}

/**
 * @param {string} cwd
 * @param {WorkRecordIndexOptions} options
 */
export async function isWorkRecordIndexEmpty(cwd, options) {
    try {
        const out = await runMnemotecaWorkRecordCommand(cwd, [
            "list",
            "--name",
            await getWorkRecordIndexCollectionName(cwd),
            "--format",
            "plain",
            "--limit",
            "1",
        ], options);
        return parsePlainListDocumentIds(out).length === 0;
    } catch {
        return true;
    }
}

/**
 * @param {string} cwd
 * @param {WorkRecordIndexOptions} options
 */
export async function rebuildWorkRecordIndex(cwd, options) {
    await verifyMnemotecaUpdateAvailable(cwd, options);
    const collection = await getWorkRecordIndexCollectionName(cwd);
    try {
        await runMnemotecaWorkRecordCommand(cwd, ["forget", "--name", collection, "--yes"], options);
    } catch {
        // Collection may not exist yet; init below is authoritative for rebuild bootstrap.
    }
    await initializeWorkRecordIndex(cwd, options);
    const records = await listWorkRecords(cwd, { createDir: false });
    const failures = [];
    let added = 0;
    for (const record of records) {
        try {
            const tags = buildWorkRecordIndexTags(record).flatMap((tag) => ["--tag", tag]);
            await runMnemotecaWorkRecordCommand(cwd, [
                "add",
                "--name",
                collection,
                ...tags,
                buildWorkRecordIndexDocument(record),
            ], options);
            added += 1;
        } catch (error) {
            failures.push({
                recordId: record.attrs.recordId,
                path: record.relativePath,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    return { collection, total: records.length, added, failed: failures.length, failures };
}
