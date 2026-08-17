/**
 * @module scripts/run-router-golden-set
 *
 * Run the real Router against golden judgement rows and compare its
 * triage_report decision to humanJudgement.
 */

import { parseArgs } from "@std/cli/parse-args";
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { dirname, join } from "@std/path";
import { AGENTS, getHomeDir } from "../src/constants.js";
import { createSessionRuntime } from "../src/shared/session/session-runtime.js";
import { readLatestTriageOutcome as readLatestTriageOutcomeFn } from "../src/shared/workflow/orchestrator.ts";
import {
    parseCsv,
    ROUTER_JUDGEMENT_COLUMNS,
    scoreAgainstHuman,
    toCsv,
    withRouterJudgementMetrics,
} from "./router-eval-utils.js";

const ROUTER_EVAL_DIRNAME = "router-eval";
const DEFAULT_GOLDEN_CSV_NAME = "router-judgements.csv";
const DEFAULT_RESULT_CSV_NAME = "router-judgements-results.csv";
const DEFAULT_ROW_TIMEOUT_MS = 60_000;
const BENCHMARK_BASH_NUDGE = "bash is disabled in this run, and the command below was not executed.";

/**
 * @returns {string}
 */
export function getDefaultRouterEvalDir() {
    return join(getHomeDir(), ".wld", ROUTER_EVAL_DIRNAME);
}

/**
 * @returns {string}
 */
export function getDefaultRouterGoldenCsvPath() {
    return join(getDefaultRouterEvalDir(), DEFAULT_GOLDEN_CSV_NAME);
}

/**
 * @returns {string}
 */
export function getDefaultRouterResultCsvPath() {
    return join(getDefaultRouterEvalDir(), DEFAULT_RESULT_CSV_NAME);
}

const BENCHMARK_ROUTER_TOOLS = [
    "read",
    "grep",
    "find",
    "ls",
    "memory_recall",
    "code_search",
    "code_show",
    "code_outline",
    "code_refs",
    "code_impact",
    "code_trace",
    "code_investigate",
    "code_structure",
    "code_impls",
    "code_importers",
    "triage_report",
];

/**
 * @typedef {Object} RouterAgentRunOptions
 * @property {string} agentName
 * @property {string[]} toolNames
 * @property {string} userRequest
 * @property {import('../src/shared/session/types.js').ImageAttachment[]} images
 * @property {import('@earendil-works/pi-coding-agent').ToolDefinition[]} customTools
 * @property {string} [modelOverride]
 * @property {string} [cwd]
 */

/** @typedef {(options: RouterAgentRunOptions) => Promise<any[]>} RouterAgentRunner */

/**
 * @returns {import('@earendil-works/pi-coding-agent').ToolDefinition}
 */
export function createBenchmarkBashNudgeTool() {
    let callCount = 0;
    return defineTool({
        name: "bash",
        label: "Benchmark Bash Nudge",
        description:
            "Benchmark-only bash shim. It never executes commands. It explains that bash is disabled here and nudges Router to use read-only discovery tools or call triage_report.",
        parameters: Type.Object({
            command: Type.String({
                description: "The shell command Router wanted to use for discovery.",
            }),
        }),
        // deno-lint-ignore require-await
        async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
            callCount++;
            const command = typeof params?.command === "string" ? params.command : "";
            const repeatedCallNudge = callCount > 1
                ? `\n\nRepeated bash attempt #${callCount}: stop calling bash in this benchmark row. Call triage_report now unless one non-bash read tool is essential.`
                : "";
            return {
                content: [{
                    type: "text",
                    text: command
                        ? `${BENCHMARK_BASH_NUDGE}${repeatedCallNudge}\n\nRequested command: ${command}`
                        : `${BENCHMARK_BASH_NUDGE}${repeatedCallNudge}`,
                }],
                details: {
                    blocked: true,
                    callCount,
                    command,
                    reason: BENCHMARK_BASH_NUDGE,
                },
            };
        },
    });
}

/**
 * @param {Record<string, string>} row
 * @param {number} index
 * @returns {string}
 */
function getDecisionId(row, index) {
    return row.decisionId || `golden-${String(index + 1).padStart(4, "0")}`;
}

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} timeoutMs
 * @param {() => void} [onTimeout]
 * @returns {Promise<T>}
 */
function withAbortTimeout(promise, timeoutMs, onTimeout = () => {}) {
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timeoutId;
    const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            onTimeout();
            reject(new Error(`Router golden row timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
    });
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
 * @param {Record<string, string>} row
 * @param {number} index
 * @returns {Record<string, unknown>}
 */
export function normalizeGoldenRow(row, index) {
    return withRouterJudgementMetrics({
        decisionId: getDecisionId(row, index),
        timestamp: row.timestamp || "",
        attribution: row.attribution || "golden_fixture",
        requestText: row.requestText || "",
        routerDecision: row.routerDecision || "",
        humanJudgement: row.humanJudgement || "",
        humanNotes: row.humanNotes || "",
        routerSummary: row.routerSummary || "",
        routerAffectedPaths: row.routerAffectedPaths || "",
    });
}

/**
 * @param {Record<string, string>} row
 * @returns {boolean}
 */
function shouldRunRow(row) {
    return Boolean(row.requestText?.trim() && row.humanJudgement?.trim());
}

/**
 * @param {Record<string, unknown>} row
 * @returns {boolean}
 */
function hasCompletedRouterDecision(row) {
    return Boolean(String(row.routerDecision || "").trim());
}

/**
 * @param {Array<Record<string, string>>} goldenRows
 * @param {Array<Record<string, string>>} resultRows
 * @returns {Array<Record<string, string>>}
 */
export function mergeGoldenRowsWithResultRows(goldenRows, resultRows) {
    const resultById = new Map(resultRows.map((row) => [row.decisionId, row]));
    return goldenRows.map((goldenRow, index) => {
        const decisionId = getDecisionId(goldenRow, index);
        const resultRow = resultById.get(decisionId);
        return {
            ...goldenRow,
            decisionId,
            routerDecision: resultRow?.routerDecision || goldenRow.routerDecision || "",
            routerSummary: resultRow?.routerSummary || goldenRow.routerSummary || "",
            routerAffectedPaths: resultRow?.routerAffectedPaths || goldenRow.routerAffectedPaths || "",
        };
    });
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
 * @param {string} requestText
 * @param {{
 *   cwd?: string,
 *   modelOverride?: string,
 *   rowTimeoutMs?: number,
 *   runAgentSession?: RouterAgentRunner,
 *   readLatestTriageOutcome?: typeof readLatestTriageOutcomeFn,
 *   customTools?: import('@earendil-works/pi-coding-agent').ToolDefinition[],
 * }} [options]
 * @returns {Promise<import('../src/shared/workflow/orchestrator.ts').TriageOutcome>}
 */
export async function runRouterForGoldenRequest(requestText, options = {}) {
    const readLatestTriageOutcome = options.readLatestTriageOutcome || readLatestTriageOutcomeFn;
    const agentOptions = /** @type {RouterAgentRunOptions} */ ({
        agentName: AGENTS.ROUTER,
        toolNames: BENCHMARK_ROUTER_TOOLS,
        userRequest: requestText,
        images: [],
        customTools: [createBenchmarkBashNudgeTool(), ...(options.customTools || [])],
        modelOverride: options.modelOverride,
    });

    /** @type {() => void} */
    let cancel = () => {};
    /** @type {() => Promise<void>} */
    let close = () => Promise.resolve();
    let messagesPromise;
    if (options.runAgentSession) {
        messagesPromise = options.runAgentSession({ ...agentOptions, cwd: options.cwd });
    } else {
        const runtime = createSessionRuntime();
        const created = await runtime.createInteractiveSession({ cwd: options.cwd || Deno.cwd() });
        cancel = () => {
            runtime.cancelSession(created.sessionId);
        };
        close = async () => {
            await runtime.closeSessionWhenIdle(created.sessionId);
        };
        messagesPromise = runtime.runIsolatedAgent(created.sessionId, agentOptions);
    }

    try {
        const messages = options.rowTimeoutMs
            ? await withAbortTimeout(messagesPromise, options.rowTimeoutMs, cancel)
            : await messagesPromise;
        const triage = readLatestTriageOutcome(messages);
        if (!triage) throw new Error("Router did not call triage_report.");
        return triage;
    } finally {
        await close();
    }
}

/**
 * @param {Array<Record<string, string>>} rows
 * @param {{
 *   limit?: number,
 *   cwd?: string,
 *   modelOverride?: string,
 *   rowTimeoutMs?: number,
 *   runAgentSession?: RouterAgentRunner,
 *   readLatestTriageOutcome?: typeof readLatestTriageOutcomeFn,
 *   onProgress?: (message: string) => void,
 *   onRowComplete?: (rows: Array<Record<string, unknown>>) => Promise<void> | void,
 *   resume?: boolean,
 * }} [options]
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
export async function runRouterGoldenSet(rows, options = {}) {
    const result = await runRouterGoldenSetWithSelection(rows, options);
    return result.rows;
}

/**
 * @param {Array<Record<string, string>>} rows
 * @param {{
 *   limit?: number,
 *   cwd?: string,
 *   modelOverride?: string,
 *   rowTimeoutMs?: number,
 *   runAgentSession?: RouterAgentRunner,
 *   readLatestTriageOutcome?: typeof readLatestTriageOutcomeFn,
 *   onProgress?: (message: string) => void,
 *   onRowComplete?: (rows: Array<Record<string, unknown>>) => Promise<void> | void,
 *   resume?: boolean,
 * }} [options]
 * @returns {Promise<{ rows: Array<Record<string, unknown>>, selectedIndexes: number[] }>}
 */
export async function runRouterGoldenSetWithSelection(rows, options = {}) {
    const normalized = rows.map(normalizeGoldenRow);
    const runnableIndexes = normalized
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => shouldRunRow(/** @type {Record<string, string>} */ (row)))
        .filter(({ row }) => !options.resume || !hasCompletedRouterDecision(row));
    const selected = options.limit ? runnableIndexes.slice(0, options.limit) : runnableIndexes;
    const selectedIndexes = selected.map(({ index }) => index);

    if (!options.resume) {
        for (const { row, index } of selected) {
            normalized[index] = withRouterJudgementMetrics({
                ...row,
                routerDecision: "",
                routerSummary: "",
                routerAffectedPaths: "",
            });
        }
    }

    for (let selectedIndex = 0; selectedIndex < selected.length; selectedIndex++) {
        const { row, index } = selected[selectedIndex];
        try {
            const triage = await runRouterForGoldenRequest(String(row.requestText || ""), {
                cwd: options.cwd,
                modelOverride: options.modelOverride,
                rowTimeoutMs: options.rowTimeoutMs,
                runAgentSession: options.runAgentSession,
                readLatestTriageOutcome: options.readLatestTriageOutcome,
            });
            normalized[index] = withRouterJudgementMetrics({
                ...row,
                routerDecision: triage.routingIntent,
                routerSummary: triage.summary || "",
                // Triage no longer collects affected paths, so the benchmark column stays empty.
                routerAffectedPaths: "",
            });
        } catch (error) {
            normalized[index] = withRouterJudgementMetrics({
                ...row,
                routerDecision: "",
                routerSummary: `ERROR: ${error instanceof Error ? error.message : String(error)}`,
                routerAffectedPaths: "",
            });
        }
        await options.onRowComplete?.(normalized);
        options.onProgress?.(
            `Routed ${selectedIndex + 1}/${selected.length}: ${normalized[index].decisionId || "(unknown decision)"}`,
        );
    }

    return { rows: normalized, selectedIndexes };
}

/**
 * @param {Array<Record<string, unknown>>} rows
 * @returns {Record<string, unknown>}
 */
export function buildRouterGoldenReport(rows) {
    const labelledRows = rows.filter((row) => String(row.humanJudgement || "").trim()).length;
    const router = scoreAgainstHuman(
        rows.map((row) => /** @type {Record<string, string>} */ (row)),
        "routerDecision",
    );
    return {
        labelledRows,
        unlabelledRows: rows.length - labelledRows,
        router,
    };
}

/**
 * @param {string[]} argv
 */
export async function main(argv) {
    const args = parseArgs(argv, {
        string: ["csv", "out", "limit", "model", "cwd", "row-timeout-ms"],
        boolean: ["help", "rerun"],
        alias: { h: "help", o: "out", m: "model" },
    });

    if (args.help) {
        console.log([
            "Usage: deno run -A scripts/run-router-golden-set.js [options]",
            "",
            "Runs the real Router against labelled Router judgement rows.",
            "",
            "Options:",
            `  --csv <path>          Golden CSV input (default: ${getDefaultRouterGoldenCsvPath()})`,
            `  --out, -o <path>     CSV output (default: ${getDefaultRouterResultCsvPath()})`,
            "  --limit <n>          Run only the first n selected rows",
            "  --model, -m <ref>    Override Router model, e.g. provider/model",
            "  --cwd <path>         Cwd for Router discovery tools",
            `  --row-timeout-ms <n> Per-row timeout (default: ${DEFAULT_ROW_TIMEOUT_MS})`,
            "  --rerun              Rerun selected rows instead of resuming unfinished rows",
        ].join("\n"));
        return;
    }

    const csvPath = args.csv || getDefaultRouterGoldenCsvPath();
    const outputPath = args.out || getDefaultRouterResultCsvPath();
    const resume = !args.rerun;
    const goldenRows = parseCsv(await Deno.readTextFile(csvPath));
    const priorResultRows = resume ? await readExistingCsv(outputPath) : [];
    const rows = resume ? mergeGoldenRowsWithResultRows(goldenRows, priorResultRows) : goldenRows;
    await Deno.mkdir(dirname(outputPath), { recursive: true });
    const result = await runRouterGoldenSetWithSelection(rows, {
        limit: parsePositiveInt(args.limit),
        cwd: args.cwd,
        modelOverride: args.model,
        rowTimeoutMs: parsePositiveInt(args["row-timeout-ms"]) || DEFAULT_ROW_TIMEOUT_MS,
        resume,
        onRowComplete: async (checkpointRows) => {
            await Deno.writeTextFile(outputPath, toCsv(ROUTER_JUDGEMENT_COLUMNS, checkpointRows));
        },
        onProgress: (message) => console.error(message),
    });
    const resultRows = result.rows;

    await Deno.writeTextFile(outputPath, toCsv(ROUTER_JUDGEMENT_COLUMNS, resultRows));
    const scoredRows = args.limit ? result.selectedIndexes.map((index) => resultRows[index]) : resultRows;
    console.log(JSON.stringify(buildRouterGoldenReport(scoredRows), null, 2));
}

if (import.meta.main) {
    await main(Deno.args);
}
