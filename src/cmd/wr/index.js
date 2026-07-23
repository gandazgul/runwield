/**
 * @module cmd/wr
 * List, search, read, index, and backfill canonical Work Records.
 */

import { parseArgs as parseArgsFn } from "@std/cli/parse-args";
import { CWD } from "../../constants.js";
import {
    formatWorkRecordBackfillOutcomes,
    formatWorkRecordBackfillPreview,
    formatWorkRecordList,
    formatWorkRecordSearchResults,
    listWorkRecords as listWorkRecordsFn,
    previewWorkRecordBackfill as previewWorkRecordBackfillFn,
    readWorkRecordById as readWorkRecordByIdFn,
    rebuildWorkRecordIndex as rebuildWorkRecordIndexFn,
    runWorkRecordBackfill as runWorkRecordBackfillFn,
    searchWorkRecords as searchWorkRecordsFn,
} from "../../shared/work-records/index.js";
import { startArtifactReadSurface as startArtifactReadSurfaceFn } from "../../ui/review/review-launcher.js";

/**
 * @typedef {Object} WorkRecordCommandDependencies
 * @property {typeof parseArgsFn} [parseArgs]
 * @property {typeof listWorkRecordsFn} [listWorkRecords]
 * @property {typeof previewWorkRecordBackfillFn} [previewWorkRecordBackfill]
 * @property {typeof runWorkRecordBackfillFn} [runWorkRecordBackfill]
 * @property {typeof searchWorkRecordsFn} [searchWorkRecords]
 * @property {typeof readWorkRecordByIdFn} [readWorkRecordById]
 * @property {typeof rebuildWorkRecordIndexFn} [rebuildWorkRecordIndex]
 * @property {typeof startArtifactReadSurfaceFn} [startArtifactReadSurface]
 * @property {(message: string) => boolean|Promise<boolean>} [confirmBackfill]
 * @property {(commandName: string) => boolean} [printCommandHelp]
 */

/** @param {string} message */
function promptForBackfillConfirmation(message) {
    const answer = prompt(`${message}\nType BACKFILL to continue:`) || "";
    return answer.trim() === "BACKFILL";
}

/**
 * @param {Awaited<ReturnType<typeof readWorkRecordByIdFn>>} record
 * @param {WorkRecordCommandDependencies} deps
 */
async function openWorkRecordReadSurface(record, deps) {
    const startReadSurface = deps.startArtifactReadSurface || startArtifactReadSurfaceFn;
    const server = await startReadSurface({
        cwd: CWD,
        markdown: record.markdown,
        artifactKind: "work-record",
        title: record.title,
        path: record.path,
        notices: record.notices,
    });
    console.log(`[RunWield] Work Record read-only view: ${server.url}`);
    if (!server.opened) {
        console.log(
            "[RunWield] Could not open your browser automatically. Open the URL above, then choose Close when finished.",
        );
    }
    try {
        await server.waitForDecision();
    } finally {
        await stopReadSurface(server);
    }
    if (!deps.startArtifactReadSurface) Deno.exit(0);
}

/**
 * @param {{ stop: () => void | Promise<void> }} server
 */
async function stopReadSurface(server) {
    await Promise.race([
        Promise.resolve(server.stop()),
        new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
}

/**
 * @param {{ _: unknown[], [key: string]: unknown }} parsed
 * @param {string[]} [allowedFlags]
 */
function rejectUnknownFlags(parsed, allowedFlags = []) {
    const allowed = new Set(["_", "help", "h", ...allowedFlags]);
    for (const key of Object.keys(parsed)) {
        if (!allowed.has(key)) {
            throw new Error(`Unsupported flag: --${key}`);
        }
    }
}

/** @param {Awaited<ReturnType<typeof rebuildWorkRecordIndexFn>>} result */
function formatRebuildResult(result) {
    const lines = [
        `[RunWield] Rebuilt Work Record index: ${result.collection}`,
        `  canonical records: ${result.total}`,
        `  indexed: ${result.added}`,
        `  failed: ${result.failed}`,
    ];
    for (const failure of result.failures || []) {
        lines.push(`  WARNING: ${failure.recordId} (${failure.path}): ${failure.error}`);
    }
    return lines.join("\n");
}

/**
 * @param {string[]} argv
 * @param {{ __testDeps?: WorkRecordCommandDependencies }} [options]
 */
export async function runWorkRecordsCommand(argv, options = {}) {
    const deps = /** @type {WorkRecordCommandDependencies} */ (options.__testDeps || {});
    const parseArgs = deps.parseArgs || parseArgsFn;
    const listWorkRecords = deps.listWorkRecords || listWorkRecordsFn;
    const previewWorkRecordBackfill = deps.previewWorkRecordBackfill || previewWorkRecordBackfillFn;
    const runWorkRecordBackfill = deps.runWorkRecordBackfill || runWorkRecordBackfillFn;
    const searchWorkRecords = deps.searchWorkRecords || searchWorkRecordsFn;
    const readWorkRecordById = deps.readWorkRecordById || readWorkRecordByIdFn;
    const rebuildWorkRecordIndex = deps.rebuildWorkRecordIndex || rebuildWorkRecordIndexFn;
    const subcommand = argv[0] && !argv[0].startsWith("-") ? argv[0] : "list";
    const rest = subcommand === "list" ? (argv[0] === "list" ? argv.slice(1) : argv) : argv.slice(1);

    if (subcommand === "help") {
        const printCommandHelp = deps.printCommandHelp || (await import("../help/" + "index.js")).printCommandHelp;
        printCommandHelp("wr");
        return;
    }

    if (subcommand === "backfill") {
        const parsed = parseArgs(rest, {
            boolean: ["help", "yes", "dry-run"],
            alias: { h: "help", y: "yes" },
        });
        if (parsed.help) {
            const printCommandHelp = deps.printCommandHelp || (await import("../help/" + "index.js")).printCommandHelp;
            printCommandHelp("wr");
            return;
        }
        if (parsed.yes && parsed["dry-run"]) throw new Error("Cannot combine --yes with --dry-run.");
        const preview = await previewWorkRecordBackfill(CWD);
        console.log(formatWorkRecordBackfillPreview(preview));
        if (parsed["dry-run"]) {
            console.log("[RunWield] Dry run only; no Work Records or Plan backlinks were written.");
            return;
        }
        if (!preview.eligible.length) return;
        const confirmed = parsed.yes || await (deps.confirmBackfill || promptForBackfillConfirmation)(
            `[RunWield] Backfill will process ${preview.eligible.length} eligible source(s).`,
        );
        if (!confirmed) {
            console.log("[RunWield] Backfill canceled; no Work Records or Plan backlinks were written.");
            return;
        }
        const result = await runWorkRecordBackfill(CWD);
        console.log(formatWorkRecordBackfillOutcomes(result.outcomes));
        return;
    }

    if (subcommand === "search") {
        const parsed = parseArgs(rest, { boolean: ["help", "all"], alias: { h: "help" } });
        if (parsed.help) {
            const printCommandHelp = deps.printCommandHelp || (await import("../help/" + "index.js")).printCommandHelp;
            printCommandHelp("wr");
            return;
        }
        rejectUnknownFlags(parsed, ["all"]);
        const query = parsed._.map(String).join(" ").trim();
        if (!query) throw new Error("Usage: wld wr search <query> [--all]");
        console.log(
            formatWorkRecordSearchResults(await searchWorkRecords(CWD, query, { includeAll: Boolean(parsed.all) })),
        );
        return;
    }

    if (subcommand === "read") {
        const parsed = parseArgs(rest, { boolean: ["help"], alias: { h: "help" } });
        if (parsed.help) {
            const printCommandHelp = deps.printCommandHelp || (await import("../help/" + "index.js")).printCommandHelp;
            printCommandHelp("wr");
            return;
        }
        rejectUnknownFlags(parsed);
        if (parsed._.length !== 1) throw new Error("Usage: wld wr read <recordId>");
        await openWorkRecordReadSurface(
            await readWorkRecordById(CWD, String(parsed._[0]), { accessMode: "all" }),
            deps,
        );
        return;
    }

    if (subcommand === "index") {
        const action = rest[0] || "";
        if (action !== "rebuild") throw new Error("Usage: wld wr index rebuild");
        const parsed = parseArgs(rest.slice(1), { boolean: ["help"], alias: { h: "help" } });
        if (parsed.help) {
            const printCommandHelp = deps.printCommandHelp || (await import("../help/" + "index.js")).printCommandHelp;
            printCommandHelp("wr");
            return;
        }
        rejectUnknownFlags(parsed);
        if (parsed._.length) throw new Error("Usage: wld wr index rebuild");
        console.log(formatRebuildResult(await rebuildWorkRecordIndex(CWD)));
        return;
    }

    if (subcommand !== "list") throw new Error(`Unknown Work Records command: ${subcommand}. Try wld wr --help.`);

    const parsed = parseArgs(rest, { boolean: ["help", "all"], alias: { h: "help" } });
    if (parsed.help) {
        const printCommandHelp = deps.printCommandHelp || (await import("../help/" + "index.js")).printCommandHelp;
        printCommandHelp("wr");
        return;
    }
    rejectUnknownFlags(parsed, ["all"]);
    if (parsed._.length) throw new Error("Usage: wld wr list [--all]");
    const records = await listWorkRecords(CWD);
    console.log(formatWorkRecordList(records, { includeAll: Boolean(parsed.all) }));
}
