/**
 * @module scripts/router-eval-utils
 *
 * Shared utilities for Router evaluation CSV generation and scoring.
 */

import { ROUTING_INTENTS } from "../src/constants.js";

const ROUTING_INTENT_ORDER = new Map(ROUTING_INTENTS.map((intent, index) => [intent, index]));
const NON_MATERIALIZING = new Set(["INQUIRY", "IDEATION"]);
const MATERIALIZING = new Set(["QUICK_FIX", "FEATURE", "PROJECT"]);

/**
 * @param {unknown} value
 * @returns {string}
 */
export function oneLine(value) {
    return value == null ? "" : String(value).replace(/\s+/g, " ").trim();
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function toCsvCell(value) {
    const text = oneLine(value);
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * @param {string[]} columns
 * @param {Array<Record<string, unknown>>} rows
 * @returns {string}
 */
export function toCsv(columns, rows) {
    const lines = [columns.join(",")];
    for (const row of rows) {
        lines.push(columns.map((column) => toCsvCell(row[column])).join(","));
    }
    return `${lines.join("\n")}\n`;
}

/**
 * @param {string} text
 * @returns {Array<Record<string, string>>}
 */
export function parseCsv(text) {
    /** @type {string[][]} */
    const records = [];
    /** @type {string[]} */
    let record = [];
    let field = "";
    let quoted = false;

    for (let index = 0; index < text.length; index++) {
        const char = text[index];
        if (quoted) {
            if (char === '"') {
                if (text[index + 1] === '"') {
                    field += '"';
                    index++;
                } else {
                    quoted = false;
                }
            } else {
                field += char;
            }
            continue;
        }

        if (char === '"') {
            quoted = true;
        } else if (char === ",") {
            record.push(field);
            field = "";
        } else if (char === "\n") {
            record.push(field);
            field = "";
            if (record.some((cell) => cell.length > 0)) records.push(record);
            record = [];
        } else if (char !== "\r") {
            field += char;
        }
    }

    if (field.length > 0 || record.length > 0) {
        record.push(field);
        if (record.some((cell) => cell.length > 0)) records.push(record);
    }

    const [header, ...body] = records;
    if (!header) return [];
    return body.map((cells) => {
        /** @type {Record<string, string>} */
        const row = {};
        header.forEach((column, index) => {
            row[column] = cells[index] || "";
        });
        return row;
    });
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeRoutingIntentCell(value) {
    const text = oneLine(value).toUpperCase();
    return ROUTING_INTENTS.includes(text) ? text : "";
}

/**
 * @param {unknown} left
 * @param {unknown} right
 * @returns {number | null}
 */
export function routingIntentDistance(left, right) {
    const a = normalizeRoutingIntentCell(left);
    const b = normalizeRoutingIntentCell(right);
    if (!a || !b) return null;
    return Math.abs((ROUTING_INTENT_ORDER.get(a) ?? 0) - (ROUTING_INTENT_ORDER.get(b) ?? 0));
}

/**
 * @param {unknown} from
 * @param {unknown} to
 * @returns {string}
 */
export function classifyRoutingIntentDisagreement(from, to) {
    const a = normalizeRoutingIntentCell(from);
    const b = normalizeRoutingIntentCell(to);
    if (!a || !b) return "invalid";
    if (a === b) return "exact";

    if (a === "QUICK_FIX" && b === "INQUIRY") return "legacy_quick_fix_to_inquiry";
    if (a === "INQUIRY" && b === "QUICK_FIX") return "inquiry_to_quick_fix";
    if ((a === "INQUIRY" && b === "IDEATION") || (a === "IDEATION" && b === "INQUIRY")) {
        return "inquiry_ideation_boundary";
    }
    if (
        (NON_MATERIALIZING.has(a) && MATERIALIZING.has(b)) ||
        (MATERIALIZING.has(a) && NON_MATERIALIZING.has(b))
    ) {
        return "answer_action_boundary";
    }
    if (a === "QUICK_FIX" && (b === "FEATURE" || b === "PROJECT")) return "scope_underestimated";
    if ((a === "FEATURE" || a === "PROJECT") && b === "QUICK_FIX") return "scope_overestimated";
    if ((a === "FEATURE" && b === "PROJECT") || (a === "PROJECT" && b === "FEATURE")) {
        return "feature_project_boundary";
    }
    if (a === "IDEATION" || b === "IDEATION") return "ideation_boundary";
    return "other";
}

/**
 * @param {Array<Record<string, string>>} rows
 * @returns {Map<string, Record<string, string>>}
 */
export function indexRowsByDecisionId(rows) {
    const indexed = new Map();
    for (const row of rows) {
        if (row.decisionId) indexed.set(row.decisionId, row);
    }
    return indexed;
}

/**
 * @param {Array<Record<string, string>>} rows
 * @param {string} candidateColumn
 * @returns {{ total: number, agreementCount: number, agreementRate: number, meanDistance: number, invalidRows: number, corrections: Record<string, number> }}
 */
export function scoreAgainstHuman(rows, candidateColumn) {
    let total = 0;
    let agreementCount = 0;
    let distanceSum = 0;
    let invalidRows = 0;
    /** @type {Record<string, number>} */
    const corrections = {};

    for (const row of rows) {
        const human = normalizeRoutingIntentCell(row.humanJudgement);
        const candidate = normalizeRoutingIntentCell(row[candidateColumn]);
        if (!human) continue;
        total++;
        if (!candidate) {
            invalidRows++;
            continue;
        }
        if (human === candidate) agreementCount++;
        const distance = routingIntentDistance(candidate, human);
        if (distance != null) distanceSum += distance;
        if (human !== candidate) {
            const key = `${candidate}->${human}`;
            corrections[key] = (corrections[key] || 0) + 1;
        }
    }

    return {
        total,
        agreementCount,
        agreementRate: total ? Number((agreementCount / total).toFixed(4)) : 0,
        meanDistance: total ? Number((distanceSum / total).toFixed(4)) : 0,
        invalidRows,
        corrections: Object.fromEntries(Object.entries(corrections).sort((a, b) => b[1] - a[1])),
    };
}
