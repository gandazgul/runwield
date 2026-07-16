/**
 * @module cmd/wr
 * List canonical Work Records.
 */

import { parseArgs as parseArgsFn } from "@std/cli/parse-args";
import { CWD } from "../../constants.js";
import { formatWorkRecordList, listWorkRecords as listWorkRecordsFn } from "../../shared/work-records/index.js";

/**
 * @typedef {Object} WorkRecordCommandDependencies
 * @property {typeof parseArgsFn} [parseArgs]
 * @property {typeof listWorkRecordsFn} [listWorkRecords]
 * @property {(commandName: string) => boolean} [printCommandHelp]
 */

/**
 * @param {string[]} argv
 * @param {import('../registry.js').CommandContext} [options]
 */
export async function runWorkRecordsCommand(argv, options = {}) {
    const deps = /** @type {WorkRecordCommandDependencies} */ (options.__testDeps || {});
    const parseArgs = deps.parseArgs || parseArgsFn;
    const listWorkRecords = deps.listWorkRecords || listWorkRecordsFn;
    const subcommand = argv[0] && !argv[0].startsWith("-") ? argv[0] : "list";
    const rest = subcommand === "list" && argv[0] === "list" ? argv.slice(1) : argv;

    if (subcommand !== "list") {
        if (subcommand === "help") {
            const printCommandHelp = deps.printCommandHelp || (await import("../help/" + "index.js")).printCommandHelp;
            printCommandHelp("wr");
            return;
        }
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
