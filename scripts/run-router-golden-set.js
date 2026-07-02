/**
 * @module scripts/run-router-golden-set
 *
 * Run the real Router against golden judgement rows and compare its
 * triage_report decision to humanJudgement.
 */

import { parseArgs } from "@std/cli/parse-args";
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { AGENTS } from "../src/constants.js";
import { abortActiveSession } from "../src/shared/session/session.js";
import { runAgentSession as runAgentSessionFn } from "../src/shared/session/session.js";
import { readLatestTriageOutcome as readLatestTriageOutcomeFn } from "../src/shared/workflow/orchestrator.js";
import {
    parseCsv,
    ROUTER_JUDGEMENT_COLUMNS,
    scoreAgainstHuman,
    toCsv,
    withRouterJudgementMetrics,
} from "./router-eval-utils.js";

const DEFAULT_CSV = "router-judgements.csv";
const DEFAULT_ROW_TIMEOUT_MS = 60_000;
const BENCHMARK_BASH_NUDGE =
    "Benchmark Router note: bash is disabled in this golden-set run, and the command below was not executed. Read-only shell commands such as git status, git diff, find, grep, ls, or deno task checks are valid discovery in the real Router, but this benchmark cannot provide bash output. Do not call bash again for this row. Use the available read/grep/find/ls/code tools for more discovery if needed, then call triage_report. If the request is operational, such as committing, running commands, dependency upgrades by explicit request, or checking git state, OPERATION is often the right routing intent; bounded no-plan code edits are QUICK_FIX. Do not try to complete the user's task in this benchmark.";
const BENCHMARK_ROUTER_TOOLS = [
    "read",
    "grep",
    "find",
    "ls",
    "memory_recall",
    "memory_recall_global",
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
 * @returns {import('../src/shared/workflow/workflow.js').UiAPI}
 */
function createQuietUiAPI() {
    return /** @type {import('../src/shared/workflow/workflow.js').UiAPI} */ (/** @type {unknown} */ ({
        appendSystemMessage: () => {},
        appendAgentMessageStart: () => ({ appendText: () => {} }),
        appendThinkingStart: () => ({ appendDelta: () => {}, end: () => {} }),
        isOutputSuppressed: () => true,
        promptSelect: () => Promise.resolve(null),
        promptText: () => Promise.resolve(null),
        requestRender: () => {},
        showModelSelector: () => Promise.resolve(null),
    }));
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
 * @returns {Promise<T>}
 */
function withAbortTimeout(promise, timeoutMs) {
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timeoutId;
    const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            abortActiveSession();
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
 * @param {string} requestText
 * @param {{
 *   cwd?: string,
 *   modelOverride?: string,
 *   rowTimeoutMs?: number,
 *   uiAPI?: import('../src/shared/workflow/workflow.js').UiAPI,
 *   runAgentSession?: typeof runAgentSessionFn,
 *   readLatestTriageOutcome?: typeof readLatestTriageOutcomeFn,
 *   customTools?: import('@earendil-works/pi-coding-agent').ToolDefinition[],
 * }} [options]
 * @returns {Promise<import('../src/shared/workflow/orchestrator.js').TriageOutcome>}
 */
export async function runRouterForGoldenRequest(requestText, options = {}) {
    const runAgentSession = options.runAgentSession || runAgentSessionFn;
    const readLatestTriageOutcome = options.readLatestTriageOutcome || readLatestTriageOutcomeFn;
    const messagesPromise = runAgentSession({
        agentName: AGENTS.ROUTER,
        toolNames: BENCHMARK_ROUTER_TOOLS,
        userRequest: requestText,
        images: [],
        uiAPI: options.uiAPI || createQuietUiAPI(),
        customTools: [createBenchmarkBashNudgeTool(), ...(options.customTools || [])],
        modelOverride: options.modelOverride,
        cwd: options.cwd,
        allowReturnToRouter: false,
    });
    const messages = options.rowTimeoutMs
        ? await withAbortTimeout(messagesPromise, options.rowTimeoutMs)
        : await messagesPromise;
    const triage = readLatestTriageOutcome(messages);
    if (!triage) throw new Error("Router did not call triage_report.");
    return triage;
}

/**
 * @param {Array<Record<string, string>>} rows
 * @param {{
 *   limit?: number,
 *   cwd?: string,
 *   modelOverride?: string,
 *   rowTimeoutMs?: number,
 *   runAgentSession?: typeof runAgentSessionFn,
 *   readLatestTriageOutcome?: typeof readLatestTriageOutcomeFn,
 *   onProgress?: (message: string) => void,
 *   onRowComplete?: (rows: Array<Record<string, unknown>>) => Promise<void> | void,
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
 *   runAgentSession?: typeof runAgentSessionFn,
 *   readLatestTriageOutcome?: typeof readLatestTriageOutcomeFn,
 *   onProgress?: (message: string) => void,
 *   onRowComplete?: (rows: Array<Record<string, unknown>>) => Promise<void> | void,
 * }} [options]
 * @returns {Promise<{ rows: Array<Record<string, unknown>>, selectedIndexes: number[] }>}
 */
export async function runRouterGoldenSetWithSelection(rows, options = {}) {
    const normalized = rows.map(normalizeGoldenRow);
    const runnableIndexes = normalized
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => shouldRunRow(/** @type {Record<string, string>} */ (row)));
    const selected = options.limit ? runnableIndexes.slice(0, options.limit) : runnableIndexes;
    const selectedIndexes = selected.map(({ index }) => index);

    for (const { row, index } of selected) {
        normalized[index] = withRouterJudgementMetrics({
            ...row,
            routerDecision: "",
            routerSummary: "",
            routerAffectedPaths: "",
        });
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
                routerAffectedPaths: (triage.affectedPaths || []).join("; "),
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
        boolean: ["help"],
        alias: { h: "help", o: "out", m: "model" },
    });

    if (args.help) {
        console.log([
            "Usage: deno run -A scripts/run-router-golden-set.js [options]",
            "",
            "Runs the real Router against labelled router-judgements.csv rows.",
            "",
            "Options:",
            `  --csv <path>          Golden CSV input (default: ${DEFAULT_CSV})`,
            "  --out, -o <path>     CSV output (default: same as --csv)",
            "  --limit <n>          Run only the first n labelled rows",
            "  --model, -m <ref>    Override Router model, e.g. provider/model",
            "  --cwd <path>         Cwd for Router discovery tools",
            `  --row-timeout-ms <n> Per-row timeout (default: ${DEFAULT_ROW_TIMEOUT_MS})`,
        ].join("\n"));
        return;
    }

    const csvPath = args.csv || DEFAULT_CSV;
    const outputPath = args.out || csvPath;
    const rows = parseCsv(await Deno.readTextFile(csvPath));
    const result = await runRouterGoldenSetWithSelection(rows, {
        limit: parsePositiveInt(args.limit),
        cwd: args.cwd,
        modelOverride: args.model,
        rowTimeoutMs: parsePositiveInt(args["row-timeout-ms"]) || DEFAULT_ROW_TIMEOUT_MS,
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
