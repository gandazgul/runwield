/**
 * @module scripts/write-router-judgement-csv
 *
 * Generate a human-reviewable Router judgement CSV from Gemma-reviewed JSONL.
 */

import { parseArgs } from "@std/cli/parse-args";
import {
    classifyRoutingIntentDisagreement,
    indexRowsByDecisionId,
    parseCsv,
    routingIntentDistance,
    toCsv,
} from "./router-eval-utils.js";

const DEFAULT_INPUT = "/private/tmp/harns-router-decisions-reviewed.jsonl";
const DEFAULT_OUTPUT = "router-judgements.csv";

export const JUDGEMENT_COLUMNS = [
    "decisionId",
    "timestamp",
    "attribution",
    "requestText",
    "routerDecision",
    "humanJudgement",
    "humanNotes",
    "gemmaJudgement",
    "gemmaAgreesWithRouter",
    "gemmaCorrection",
    "gemmaDistanceFromRouter",
    "gemmaDisagreementKind",
    "gemmaReason",
];

/**
 * @param {string} text
 * @returns {Record<string, unknown>[]}
 */
export function parseJsonlRows(text) {
    return text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => /** @type {Record<string, unknown>} */ (JSON.parse(line)));
}

/**
 * @param {Record<string, unknown>} row
 * @param {Record<string, string> | undefined} existing
 * @returns {Record<string, unknown>}
 */
export function buildJudgementCsvRow(row, existing) {
    const review = row.gemmaReview && typeof row.gemmaReview === "object"
        ? /** @type {{ agrees?: boolean, routingIntent?: string, reason?: string }} */ (row.gemmaReview)
        : {};
    const routerDecision = typeof row.routingIntent === "string" ? row.routingIntent : "";
    const gemmaJudgement = review.agrees === true ? routerDecision : review.routingIntent || "";
    const gemmaAgreesWithRouter = review.agrees === true;
    const gemmaCorrection = gemmaAgreesWithRouter ? "" : `${routerDecision}->${gemmaJudgement}`;

    return {
        decisionId: row.decisionId,
        timestamp: row.timestamp,
        attribution: row.attribution,
        requestText: row.requestText,
        routerDecision,
        humanJudgement: existing?.humanJudgement || "",
        humanNotes: existing?.humanNotes || "",
        gemmaJudgement,
        gemmaAgreesWithRouter: gemmaAgreesWithRouter ? "TRUE" : "FALSE",
        gemmaCorrection,
        gemmaDistanceFromRouter: routingIntentDistance(routerDecision, gemmaJudgement) ?? "",
        gemmaDisagreementKind: classifyRoutingIntentDisagreement(routerDecision, gemmaJudgement),
        gemmaReason: gemmaAgreesWithRouter ? "" : review.reason || "",
    };
}

/**
 * @param {Record<string, unknown>[]} reviewedRows
 * @param {Array<Record<string, string>>} [existingRows]
 * @returns {string}
 */
export function buildJudgementCsv(reviewedRows, existingRows = []) {
    const existingById = indexRowsByDecisionId(existingRows);
    const rows = reviewedRows.map((row) => buildJudgementCsvRow(row, existingById.get(String(row.decisionId || ""))));
    return toCsv(JUDGEMENT_COLUMNS, rows);
}

/**
 * @param {string} path
 * @returns {Promise<Array<Record<string, string>>>}
 */
async function readExistingCsv(path) {
    try {
        return parseCsv(await Deno.readTextFile(path));
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return [];
        throw error;
    }
}

/**
 * @param {string[]} argv
 */
export async function main(argv) {
    const args = parseArgs(argv, {
        string: ["in", "out"],
        boolean: ["help", "no-preserve"],
        alias: { h: "help", i: "in", o: "out" },
    });

    if (args.help) {
        console.log([
            "Usage: deno run -A scripts/write-router-judgement-csv.js --in reviewed.jsonl --out router-judgements.csv",
            "",
            "Options:",
            `  --in, -i <path>       Gemma-reviewed JSONL (default: ${DEFAULT_INPUT})`,
            `  --out, -o <path>      CSV output (default: ${DEFAULT_OUTPUT})`,
            "  --no-preserve         Do not preserve existing humanJudgement/humanNotes values from the output CSV",
        ].join("\n"));
        return;
    }

    const inputPath = args.in || DEFAULT_INPUT;
    const outputPath = args.out || DEFAULT_OUTPUT;
    const reviewedRows = parseJsonlRows(await Deno.readTextFile(inputPath));
    const existingRows = args["no-preserve"] ? [] : await readExistingCsv(outputPath);
    await Deno.writeTextFile(outputPath, buildJudgementCsv(reviewedRows, existingRows));
    console.log(`Wrote ${reviewedRows.length} row(s) to ${outputPath}.`);
}

if (import.meta.main) {
    await main(Deno.args);
}
