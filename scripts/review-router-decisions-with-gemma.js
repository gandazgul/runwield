/**
 * @module scripts/review-router-decisions-with-gemma
 *
 * Ask Gemma to review extracted Router decisions and annotate disagreements.
 */

import { completeSimple } from "@earendil-works/pi-ai";
import { parseArgs } from "@std/cli/parse-args";
import { discoverProviderModel, getModelRegistry } from "../src/shared/models/model-registry.js";
import { parseProviderModel } from "../src/shared/models/model-validation.js";
import { ROUTING_INTENTS } from "../src/constants.js";
import { normalizeRoutingIntentCell, parseCsv } from "./router-eval-utils.js";

const DEFAULT_MODEL = "ollama-cloud/gemma4:31b-cloud";

/**
 * @typedef {Object} GemmaReview
 * @property {boolean} agrees
 * @property {string | null} routingIntent
 * @property {string | null} reason
 */

/**
 * @param {unknown} content
 * @returns {string}
 */
export function extractAssistantText(content) {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content.map((block) => {
        if (!block || typeof block !== "object") return "";
        const typed = /** @type {{ type?: string, text?: string }} */ (block);
        return typed.type === "text" ? typed.text || "" : "";
    }).filter(Boolean).join("\n").trim();
}

/**
 * @param {string} text
 * @returns {unknown}
 */
function parseJsonFromText(text) {
    const trimmed = text.trim();
    if (!trimmed) throw new Error("Gemma returned empty text.");
    try {
        return JSON.parse(trimmed);
    } catch {
        const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
        if (fenced) return JSON.parse(fenced[1]);
        const objectMatch = trimmed.match(/\{[\s\S]*\}/);
        if (objectMatch) return JSON.parse(objectMatch[0]);
        throw new Error(`Gemma returned non-JSON text: ${trimmed.slice(0, 200)}`);
    }
}

/**
 * @param {unknown} value
 * @returns {GemmaReview}
 */
export function parseGemmaReview(value) {
    const parsed = typeof value === "string" ? parseJsonFromText(value) : value;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Gemma review must be a JSON object.");
    }
    const record = /** @type {Record<string, unknown>} */ (parsed);
    if (typeof record.agrees !== "boolean") throw new Error("Gemma review missing boolean agrees.");

    const routingIntent = record.routingIntent;
    const reason = record.reason;
    if (record.agrees) {
        return { agrees: true, routingIntent: null, reason: null };
    }

    if (typeof routingIntent !== "string" || !ROUTING_INTENTS.includes(routingIntent)) {
        throw new Error("Gemma disagreement missing valid routingIntent.");
    }
    if (typeof reason !== "string" || !reason.trim()) {
        throw new Error("Gemma disagreement missing reason.");
    }

    return {
        agrees: false,
        routingIntent,
        reason: reason.trim().replace(/\s+/g, " "),
    };
}

/**
 * @param {Record<string, unknown>} decision
 * @returns {string}
 */
export function buildGemmaPrompt(decision) {
    const payload = {
        requestText: decision.requestText,
        routerDecision: {
            routingIntent: decision.routingIntent,
            complexity: decision.complexity,
            summary: decision.summary,
            affectedPaths: decision.affectedPaths,
        },
    };

    return [
        "You are reviewing whether a Harns Router triage decision chose the correct Routing Intent.",
        "",
        "Routing Intent definitions:",
        "- INQUIRY: Direct answer, explanation, repository guidance, or other non-materializing help.",
        "- IDEATION: Explicit brainstorming, research, interview, PRD, option analysis, or idea stress-testing.",
        "- QUICK_FIX: Small actionable edit or operational request: commit/status-style git operations, running commands, running or fixing CI/checks, simple config/docs edits, direct agent handoffs, or one-off operations affecting roughly 1-2 files.",
        "- FEATURE: Non-trivial implementation or multi-file behavior change that needs a FEATURE plan.",
        "- PROJECT: Large architectural shift, new subsystem, major refactor, or cross-cutting concern needing an Epic.",
        "",
        "Important: Operational commands such as 'commit the changes', 'run tests', 'run CI and fix failures', 'switch/take me to an agent', or other direct actions are QUICK_FIX, not INQUIRY, even when they may not require code edits.",
        "Review only the routing intent. Do not judge whether affectedPaths are complete unless they reveal the intent is wrong.",
        "If the Router decision is acceptable, agree. If it is wrong, choose the better Routing Intent and explain in exactly one sentence why the old decision is wrong and the new one is right.",
        "",
        "Return ONLY strict JSON with this exact shape:",
        '{"agrees":true,"routingIntent":null,"reason":null}',
        "or",
        '{"agrees":false,"routingIntent":"INQUIRY|IDEATION|QUICK_FIX|FEATURE|PROJECT","reason":"one sentence"}',
        "",
        "Decision to review:",
        JSON.stringify(payload, null, 2),
    ].join("\n");
}

/**
 * @param {string} modelRef
 * @param {ReturnType<typeof getModelRegistry>} modelRegistry
 * @returns {Promise<any>}
 */
export async function resolveReviewModel(modelRef, modelRegistry) {
    const parsed = parseProviderModel(modelRef);
    if (!parsed.ok) throw new Error(`Invalid model reference: ${modelRef}. Use provider/id.`);

    let model = modelRegistry.find(parsed.provider, parsed.id);
    if (!model) model = await discoverProviderModel(modelRegistry, parsed.provider, parsed.id);
    if (!model) throw new Error(`Unknown model: ${modelRef}`);
    if (!modelRegistry.hasConfiguredAuth(model)) throw new Error(`No API key configured for model: ${modelRef}`);
    return model;
}

/**
 * @param {Record<string, unknown>} decision
 * @param {{ model: any, modelRegistry: ReturnType<typeof getModelRegistry>, completeSimpleFn?: typeof completeSimple, signal?: AbortSignal }} options
 * @returns {Promise<Record<string, unknown>>}
 */
export async function reviewDecisionWithGemma(decision, options) {
    const auth = await options.modelRegistry.getApiKeyAndHeaders(options.model);
    if (!auth.ok) throw new Error(auth.error || "Unable to resolve model auth.");

    const completeSimpleFn = options.completeSimpleFn || completeSimple;
    const response = await completeSimpleFn(options.model, {
        messages: [{
            role: "user",
            content: [{ type: "text", text: buildGemmaPrompt(decision) }],
            timestamp: Date.now(),
        }],
    }, {
        signal: options.signal,
        apiKey: auth.apiKey,
        headers: auth.headers,
        maxTokens: 384,
    });

    if (response.stopReason === "error") {
        throw new Error(response.errorMessage || "Gemma review failed.");
    }

    const review = parseGemmaReview(extractAssistantText(response.content));
    return annotateDecision(decision, `${options.model.provider}/${options.model.id}`, review);
}

/**
 * @param {Record<string, unknown>} decision
 * @param {string} reviewModel
 * @param {GemmaReview} review
 * @returns {Record<string, unknown>}
 */
export function annotateDecision(decision, reviewModel, review) {
    if (review.agrees) {
        return {
            ...decision,
            gemmaReview: {
                model: reviewModel,
                agrees: true,
            },
        };
    }

    return {
        ...decision,
        gemmaReview: {
            model: reviewModel,
            agrees: false,
            routingIntent: review.routingIntent,
            reason: review.reason,
        },
    };
}

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
 * @param {Record<string, string>} row
 * @returns {Record<string, unknown>}
 */
export function buildDecisionFromJudgementCsvRow(row) {
    const routingIntent = normalizeRoutingIntentCell(row.routerDecision);
    if (!routingIntent) {
        throw new Error(`CSV row ${row.decisionId || "(unknown decision)"} is missing a valid routerDecision.`);
    }

    return {
        decisionId: row.decisionId,
        timestamp: row.timestamp,
        attribution: row.attribution,
        requestText: row.requestText,
        routingIntent,
        complexity: "",
        summary: "",
        affectedPaths: [],
    };
}

/**
 * @param {string} text
 * @returns {Record<string, unknown>[]}
 */
export function parseJudgementCsvRows(text) {
    return parseCsv(text).map(buildDecisionFromJudgementCsvRow);
}

/**
 * @param {unknown[]} rows
 * @returns {string}
 */
function toJsonl(rows) {
    return rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "");
}

/**
 * @returns {Promise<string>}
 */
async function readStdin() {
    return await new Response(Deno.stdin.readable).text();
}

/**
 * @param {string} text
 */
async function writeStdout(text) {
    await Deno.stdout.write(new TextEncoder().encode(text));
}

/**
 * @param {string | undefined} value
 * @returns {number | undefined}
 */
function parsePositiveInt(value) {
    if (!value) return undefined;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * @param {string[]} argv
 */
export async function main(argv) {
    const args = parseArgs(argv, {
        string: ["in", "out", "model", "limit"],
        boolean: ["help", "csv"],
        alias: { h: "help", i: "in", o: "out", m: "model" },
    });

    if (args.help) {
        console.log([
            "Usage: deno run -A scripts/review-router-decisions-with-gemma.js --in router.jsonl --out reviewed.jsonl",
            "",
            "Options:",
            `  --model, -m <provider/id>  Review model (default: ${DEFAULT_MODEL})`,
            "  --in, -i <path>            Extracted Router decisions JSONL. Defaults to stdin",
            "  --out, -o <path>           Reviewed JSONL output. Defaults to stdout",
            "  --csv                      Read router-judgements.csv format and review routerDecision",
            "  --limit <n>                Review at most n rows",
        ].join("\n"));
        return;
    }

    const input = args.in ? await Deno.readTextFile(args.in) : await readStdin();
    const rows = args.csv ? parseJudgementCsvRows(input) : parseJsonlRows(input);
    const limit = parsePositiveInt(args.limit);
    const selectedRows = limit ? rows.slice(0, limit) : rows;
    const modelRegistry = getModelRegistry();
    const model = await resolveReviewModel(args.model || DEFAULT_MODEL, modelRegistry);

    /** @type {Record<string, unknown>[]} */
    const reviewed = [];
    for (let index = 0; index < selectedRows.length; index++) {
        const row = selectedRows[index];
        const annotated = await reviewDecisionWithGemma(row, { model, modelRegistry });
        reviewed.push(annotated);
        console.error(`Reviewed ${index + 1}/${selectedRows.length}: ${row.decisionId || "(unknown decision)"}`);
    }

    const output = toJsonl(reviewed);
    if (args.out) await Deno.writeTextFile(args.out, output);
    else await writeStdout(output);
}

if (import.meta.main) {
    await main(Deno.args);
}
