/**
 * @module cmd/wr
 * List and backfill canonical Work Records.
 */

import { parseArgs as parseArgsFn } from "@std/cli/parse-args";
import { CWD } from "../../constants.js";
import {
    formatWorkRecordBackfillOutcomes,
    formatWorkRecordBackfillPreview,
    formatWorkRecordList,
    listWorkRecords as listWorkRecordsFn,
    previewWorkRecordBackfill as previewWorkRecordBackfillFn,
    runWorkRecordBackfill as runWorkRecordBackfillFn,
} from "../../shared/work-records/index.js";

/**
 * @typedef {Object} WorkRecordCommandDependencies
 * @property {typeof parseArgsFn} [parseArgs]
 * @property {typeof listWorkRecordsFn} [listWorkRecords]
 * @property {typeof previewWorkRecordBackfillFn} [previewWorkRecordBackfill]
 * @property {typeof runWorkRecordBackfillFn} [runWorkRecordBackfill]
 * @property {(message: string) => boolean|Promise<boolean>} [confirmBackfill]
 * @property {(commandName: string) => boolean} [printCommandHelp]
 */

/** @param {string} message */
function promptForBackfillConfirmation(message) {
    const answer = prompt(`${message}\nType BACKFILL to continue:`) || "";
    return answer.trim() === "BACKFILL";
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

    if (subcommand !== "list") {
        throw new Error(`Unknown Work Records command: ${subcommand}. Try wld wr --help.`);
    }

    const parsed = parseArgs(rest, {
        boolean: ["help", "all"],
        alias: { h: "help" },
    });

    if (parsed.help) {
        const printCommandHelp = deps.printCommandHelp || (await import("../help/" + "index.js")).printCommandHelp;
        printCommandHelp("wr");
        return;
    }

    const records = await listWorkRecords(CWD);
    console.log(formatWorkRecordList(records, { includeAll: Boolean(parsed.all) }));
}
