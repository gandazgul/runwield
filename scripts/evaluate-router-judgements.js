/**
 * @module scripts/evaluate-router-judgements
 *
 * Score human-filled Router judgement CSV files.
 */

import { parseArgs } from "@std/cli/parse-args";
import { parseCsv, scoreAgainstHuman } from "./router-eval-utils.js";

const DEFAULT_CSV = "router-judgements.csv";

/**
 * @param {unknown} value
 * @returns {number | undefined}
 */
function parseNumber(value) {
    if (value === undefined || value === null || value === "") return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * @param {Array<Record<string, string>>} rows
 */
export function summarizeJudgements(rows) {
    const labelledRows = rows.filter((row) => row.humanJudgement?.trim()).length;
    const router = scoreAgainstHuman(rows, "routerDecision");
    const gemma = scoreAgainstHuman(rows, "gemmaJudgement");

    return {
        labelledRows,
        unlabelledRows: rows.length - labelledRows,
        router,
        gemma,
    };
}

/**
 * @param {ReturnType<typeof summarizeJudgements>} summary
 * @param {{ minGemmaAgreementRate?: number, maxGemmaMeanDistance?: number }} thresholds
 * @returns {string[]}
 */
export function checkThresholds(summary, thresholds) {
    /** @type {string[]} */
    const failures = [];
    if (
        thresholds.minGemmaAgreementRate !== undefined &&
        summary.gemma.agreementRate < thresholds.minGemmaAgreementRate
    ) {
        failures.push(
            `Gemma agreement ${summary.gemma.agreementRate} < threshold ${thresholds.minGemmaAgreementRate}`,
        );
    }
    if (
        thresholds.maxGemmaMeanDistance !== undefined &&
        summary.gemma.meanDistance > thresholds.maxGemmaMeanDistance
    ) {
        failures.push(
            `Gemma mean distance ${summary.gemma.meanDistance} > threshold ${thresholds.maxGemmaMeanDistance}`,
        );
    }
    return failures;
}

/**
 * @param {ReturnType<typeof summarizeJudgements>} summary
 * @param {string} csvPath
 * @returns {Record<string, unknown>}
 */
export function buildBaseline(summary, csvPath) {
    return {
        createdAt: new Date().toISOString(),
        csv: csvPath,
        labelledRows: summary.labelledRows,
        metrics: summary,
        thresholds: {
            minGemmaAgreementRate: Number(Math.max(0, summary.gemma.agreementRate - 0.05).toFixed(4)),
            maxGemmaMeanDistance: Number((summary.gemma.meanDistance + 0.1).toFixed(4)),
        },
    };
}

/**
 * @param {string[]} argv
 */
export async function main(argv) {
    const args = parseArgs(argv, {
        string: ["csv", "baseline", "baseline-out", "min-gemma-agreement", "max-gemma-mean-distance"],
        boolean: ["help"],
        alias: { h: "help" },
    });

    if (args.help) {
        console.log([
            "Usage: deno run -A scripts/evaluate-router-judgements.js [options]",
            "",
            "Fill humanJudgement in router-judgements.csv with one of:",
            "  INQUIRY, IDEATION, QUICK_FIX, FEATURE, PROJECT",
            "",
            "Options:",
            `  --csv <path>                       Judgement CSV (default: ${DEFAULT_CSV})`,
            "  --baseline <path>                  Read thresholds from a previous baseline JSON",
            "  --baseline-out <path>              Write current metrics and suggested thresholds",
            "  --min-gemma-agreement <number>     Fail if Gemma agreement is below this rate, e.g. 0.80",
            "  --max-gemma-mean-distance <number> Fail if Gemma mean distance is above this value",
        ].join("\n"));
        return;
    }

    const csvPath = args.csv || DEFAULT_CSV;
    const rows = parseCsv(await Deno.readTextFile(csvPath));
    const summary = summarizeJudgements(rows);

    /** @type {{ minGemmaAgreementRate?: number, maxGemmaMeanDistance?: number }} */
    const thresholds = {
        minGemmaAgreementRate: parseNumber(args["min-gemma-agreement"]),
        maxGemmaMeanDistance: parseNumber(args["max-gemma-mean-distance"]),
    };

    if (args.baseline) {
        const baseline = JSON.parse(await Deno.readTextFile(args.baseline));
        const baselineThresholds = baseline?.thresholds || {};
        thresholds.minGemmaAgreementRate ??= parseNumber(baselineThresholds.minGemmaAgreementRate);
        thresholds.maxGemmaMeanDistance ??= parseNumber(baselineThresholds.maxGemmaMeanDistance);
    }

    const failures = checkThresholds(summary, thresholds);
    const report = {
        summary,
        thresholds,
        passed: failures.length === 0,
        failures,
    };

    if (args["baseline-out"]) {
        await Deno.writeTextFile(args["baseline-out"], `${JSON.stringify(buildBaseline(summary, csvPath), null, 2)}\n`);
    }

    console.log(JSON.stringify(report, null, 2));
    if (failures.length > 0) Deno.exit(1);
}

if (import.meta.main) {
    await main(Deno.args);
}
