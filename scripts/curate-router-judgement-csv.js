/**
 * @module scripts/curate-router-judgement-csv
 *
 * Apply deterministic fixture-curation rules to Router judgement CSV files.
 */

import { parseArgs } from "@std/cli/parse-args";
import { parseCsv, toCsv } from "./router-eval-utils.js";
import { JUDGEMENT_COLUMNS } from "./write-router-judgement-csv.js";

const DEFAULT_CSV = "router-judgements.csv";

const PURE_GREETING_REQUESTS = new Set([
    "hi",
    "hello",
    "hey",
    "hi there",
    "hello there",
    "hi there how are you doing?",
    "hi there how are you doing",
]);

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeRequest(value) {
    return value == null ? "" : String(value).replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * @param {Record<string, string>} row
 * @returns {boolean}
 */
export function isPureGreetingRow(row) {
    return PURE_GREETING_REQUESTS.has(normalizeRequest(row.requestText));
}

/**
 * Seed only cases that are clear under the current six-intent contract.
 *
 * @param {Record<string, string>} row
 * @returns {{ intent: string, note: string } | null}
 */
export function getUnambiguousHumanSeed(row) {
    const request = normalizeRequest(row.requestText);

    if (isPureGreetingRow(row)) {
        return {
            intent: "INQUIRY",
            note: "Seeded: representative greeting collapsed from duplicate legacy greeting rows.",
        };
    }

    if (request === "who are you?" || request === "who are you" || request === "hello there who are you?") {
        return { intent: "INQUIRY", note: "Seeded: direct identity question." };
    }

    if (request === "list your skills and tools") {
        return { intent: "INQUIRY", note: "Seeded: direct capability question." };
    }

    if (/^is .+ used anywhere\??$/.test(request) || /^is it possible to /.test(request)) {
        return { intent: "INQUIRY", note: "Seeded: direct informational question." };
    }

    if (request === "commit the changes") {
        return { intent: "OPERATION", note: "Seeded: commit request is a direct repository operation." };
    }

    if (request === "take me to the operator") {
        return { intent: "OPERATION", note: "Seeded: direct handoff/operation request." };
    }

    return null;
}

/**
 * @param {Array<Record<string, string>>} rows
 * @returns {{ rows: Array<Record<string, string>>, removedGreetings: number, seededHumanJudgements: number }}
 */
export function curateRows(rows) {
    let keptGreeting = false;
    let removedGreetings = 0;
    let seededHumanJudgements = 0;
    /** @type {Array<Record<string, string>>} */
    const curated = [];

    for (const original of rows) {
        const row = { ...original };
        if (isPureGreetingRow(row)) {
            if (keptGreeting) {
                removedGreetings++;
                continue;
            }
            keptGreeting = true;
        }

        const seed = getUnambiguousHumanSeed(row);
        if (seed && !row.humanJudgement?.trim()) {
            row.humanJudgement = seed.intent;
            row.humanNotes = row.humanNotes?.trim() || seed.note;
            seededHumanJudgements++;
        }

        curated.push(row);
    }

    return { rows: curated, removedGreetings, seededHumanJudgements };
}

/**
 * @param {string[]} argv
 */
export async function main(argv) {
    const args = parseArgs(argv, {
        string: ["in", "out"],
        boolean: ["help"],
        alias: { h: "help", i: "in", o: "out" },
    });

    if (args.help) {
        console.log([
            "Usage: deno run -A scripts/curate-router-judgement-csv.js [options]",
            "",
            "Options:",
            `  --in, -i <path>   CSV to curate (default: ${DEFAULT_CSV})`,
            "  --out, -o <path>  Curated CSV output (default: same as --in)",
        ].join("\n"));
        return;
    }

    const inputPath = args.in || DEFAULT_CSV;
    const outputPath = args.out || inputPath;
    const result = curateRows(parseCsv(await Deno.readTextFile(inputPath)));
    await Deno.writeTextFile(outputPath, toCsv(JUDGEMENT_COLUMNS, result.rows));
    console.log(JSON.stringify(
        {
            output: outputPath,
            rows: result.rows.length,
            removedGreetings: result.removedGreetings,
            seededHumanJudgements: result.seededHumanJudgements,
        },
        null,
        2,
    ));
}

if (import.meta.main) {
    await main(Deno.args);
}
