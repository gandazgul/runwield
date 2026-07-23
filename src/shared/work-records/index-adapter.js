/**
 * @module shared/work-records/index-adapter
 * Derived Mnemosyne index for canonical Work Records.
 */

import { basename } from "@std/path";
import { listWorkRecords } from "./store.js";

const LOCATOR_PREFIX = "work-record:";
const REBUILD_GUIDANCE = "Run `wld wr index rebuild` to repair the derived Work Record index.";

/**
 * @typedef {Object} MnemosyneCommandResult
 * @property {boolean} success
 * @property {number} code
 * @property {Uint8Array} stdout
 * @property {Uint8Array} stderr
 */

/**
 * @typedef {Object} WorkRecordIndexDeps
 * @property {(command: string, args: string[], options?: { cwd?: string }) => Promise<MnemosyneCommandResult>} [commandOutput]
 * @property {typeof listWorkRecords} [listWorkRecords]
 */

/** @param {string} cwd */
export function getWorkRecordIndexCollectionName(cwd) {
    const rawName = basename(cwd) || "default";
    const projectName = rawName === "global" ? "default" : rawName;
    return `${projectName}:work-records`;
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
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string }} [options]
 */
async function defaultCommandOutput(command, args, options = {}) {
    return await new Deno.Command(command, {
        args,
        cwd: options.cwd,
        stdout: "piped",
        stderr: "piped",
    }).output();
}

/**
 * @param {string} cwd
 * @param {string[]} args
 * @param {WorkRecordIndexDeps} deps
 */
export async function runMnemosyneWorkRecordCommand(cwd, args, deps = {}) {
    const commandOutput = deps.commandOutput || defaultCommandOutput;
    let result;
    try {
        result = await commandOutput("mnemosyne", args, { cwd });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`mnemosyne ${args[0] || ""} failed: ${message}`);
    }
    if (!result.success) {
        const stderr = decode(result.stderr);
        const stdout = decode(result.stdout);
        throw new Error(stderr || stdout || `mnemosyne ${args[0] || ""} failed with exit code ${result.code}`);
    }
    return decode(result.stdout) || decode(result.stderr);
}

/**
 * @param {string} cwd
 * @param {WorkRecordIndexDeps} [deps]
 */
export async function verifyMnemosyneUpdateAvailable(cwd, deps = {}) {
    const help = await runMnemosyneWorkRecordCommand(cwd, ["update", "--help"], deps);
    if (!help.includes("update <id>") || !help.includes("--replace-tags")) {
        throw new Error("mnemosyne update prerequisite is unavailable or missing strict --replace-tags support.");
    }
    return true;
}

/**
 * @param {string} cwd
 * @param {WorkRecordIndexDeps} [deps]
 */
export async function initializeWorkRecordIndex(cwd, deps = {}) {
    await runMnemosyneWorkRecordCommand(cwd, ["init", "--name", getWorkRecordIndexCollectionName(cwd)], deps);
}

/** @param {string} output */
function isEmptyPlainListOutput(output) {
    const trimmed = String(output || "").trim();
    return !trimmed || /^no\s+documents\b/i.test(trimmed);
}

/**
 * @param {string} output
 * @param {{ recordId?: string, tolerateMalformed?: boolean }} [options]
 * @returns {number[]}
 */
function parsePlainListDocumentIds(output, options = {}) {
    if (isEmptyPlainListOutput(output)) return [];
    const ids = [];
    const malformedLines = [];
    for (const line of String(output || "").split("\n")) {
        if (!line.trim()) continue;
        const match = line.match(/^\s*\[(\d+)\]/);
        if (!match) {
            malformedLines.push(line.trim());
            continue;
        }
        ids.push(Number(match[1]));
    }
    if (!options.tolerateMalformed && malformedLines.length) {
        const target = options.recordId ? ` for ${options.recordId}` : "";
        throw new Error(
            `Work Record index locator listing${target} did not include a parseable Mnemosyne numeric document ID. ${REBUILD_GUIDANCE}`,
        );
    }
    return ids;
}

/**
 * @param {string} cwd
 * @param {string} recordId
 * @param {WorkRecordIndexDeps} [deps]
 */
export async function findIndexedDocumentIdsByRecordId(cwd, recordId, deps = {}) {
    const out = await runMnemosyneWorkRecordCommand(cwd, [
        "list",
        "--name",
        getWorkRecordIndexCollectionName(cwd),
        "--format",
        "plain",
        "--limit",
        "1000",
        "--tag",
        `${LOCATOR_PREFIX}${recordId}`,
    ], deps);
    return parsePlainListDocumentIds(out, { recordId });
}

/**
 * @param {string} cwd
 * @param {import('./schema.js').WorkRecordResource} record
 * @param {WorkRecordIndexDeps} [deps]
 */
export async function syncWorkRecordToIndex(cwd, record, deps = {}) {
    await verifyMnemosyneUpdateAvailable(cwd, deps);
    await initializeWorkRecordIndex(cwd, deps);
    const collection = getWorkRecordIndexCollectionName(cwd);
    const tags = buildWorkRecordIndexTags(record);
    const content = buildWorkRecordIndexDocument(record);
    const ids = await findIndexedDocumentIdsByRecordId(cwd, record.attrs.recordId, deps);
    const tagArgs = tags.flatMap((tag) => ["--tag", tag]);
    if (ids.length > 1) {
        throw new Error(`Duplicate Work Record index entries for ${record.attrs.recordId}. ${REBUILD_GUIDANCE}`);
    }
    if (ids.length === 0) {
        await runMnemosyneWorkRecordCommand(cwd, ["add", "--name", collection, ...tagArgs, content], deps);
        return { action: "added", recordId: record.attrs.recordId };
    }
    const id = ids[0];
    if (!Number.isFinite(id)) throw new Error(`Missing Mnemosyne numeric document ID for ${record.attrs.recordId}.`);
    await runMnemosyneWorkRecordCommand(cwd, [
        "update",
        String(id),
        "--name",
        collection,
        "--replace-tags",
        ...tagArgs,
        content,
    ], deps);
    return { action: "updated", recordId: record.attrs.recordId, documentId: id };
}

/**
 * @param {string} cwd
 * @param {WorkRecordIndexDeps} [deps]
 */
export async function isWorkRecordIndexEmpty(cwd, deps = {}) {
    try {
        const out = await runMnemosyneWorkRecordCommand(cwd, [
            "list",
            "--name",
            getWorkRecordIndexCollectionName(cwd),
            "--format",
            "plain",
            "--limit",
            "1",
        ], deps);
        return parsePlainListDocumentIds(out).length === 0;
    } catch {
        return true;
    }
}

/**
 * @param {string} cwd
 * @param {WorkRecordIndexDeps} [deps]
 */
export async function rebuildWorkRecordIndex(cwd, deps = {}) {
    await verifyMnemosyneUpdateAvailable(cwd, deps);
    const collection = getWorkRecordIndexCollectionName(cwd);
    try {
        await runMnemosyneWorkRecordCommand(cwd, ["forget", "--name", collection, "--yes"], deps);
    } catch {
        // Collection may not exist yet; init below is authoritative for rebuild bootstrap.
    }
    await initializeWorkRecordIndex(cwd, deps);
    const records = await (deps.listWorkRecords || listWorkRecords)(cwd, { createDir: false });
    const failures = [];
    let added = 0;
    for (const record of records) {
        try {
            const tags = buildWorkRecordIndexTags(record).flatMap((tag) => ["--tag", tag]);
            await runMnemosyneWorkRecordCommand(cwd, [
                "add",
                "--name",
                collection,
                ...tags,
                buildWorkRecordIndexDocument(record),
            ], deps);
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
