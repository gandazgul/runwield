/**
 * @module shared/workflow/objective-checks
 * Run Plan-owned Objective-Failing Checks and classify their results.
 */

import { spawnForegroundShell } from "../foreground-process.ts";
import {
    captureProcessStreamTail,
    formatCapturedProcessOutput,
    PROCESS_STREAM_OUTPUT_LIMIT_BYTES,
} from "./process-output.ts";

export interface ObjectiveCheck {
    id: string;
    command: string;
    rationale?: string;
}

export type ObjectiveCheckStatus = "met" | "unmet" | "broken";

export interface BrokenObjectiveCheckReport {
    id: string;
    explanation: string;
    command?: string;
}

export interface ObjectiveCheckResult {
    id: string;
    command: string;
    rationale?: string;
    status: ObjectiveCheckStatus;
    stdout: string;
    stderr: string;
    exitCode: number | null;
    durationMs: number;
    output: string;
    reason?: string;
}

export interface ObjectiveCheckSummary {
    total: number;
    met: number;
    unmet: number;
    broken: number;
    compactBlock: string;
    block: string;
}

export interface ObjectiveChecksBaseline {
    recordedAt: string;
    head?: string;
    results: ObjectiveCheckResult[];
}

export interface ObjectiveChecksBaselineClassification {
    status: "all_unmet" | "already_met" | "broken";
    offendingResults: ObjectiveCheckResult[];
}

export interface RunObjectiveChecksOptions {
    checks: ObjectiveCheck[];
    cwd: string;
    signal?: AbortSignal;
    timeoutMs?: number;
}

const SHELL_NOT_FOUND_EXIT_CODES = new Set([126, 127]);
export const DEFAULT_OBJECTIVE_CHECK_TIMEOUT_MS = 120_000;

interface CaseInsensitivePathContradiction {
    negatedPath: string;
    requiredPath: string;
}

function shellTokenPattern(): string {
    return `(?:"([^"]+)"|'([^']+)'|([^\\s;&|]+))`;
}

function firstDefinedMatchGroup(match: RegExpExecArray): string {
    for (let index = 1; index < match.length; index += 1) {
        const value = match[index];
        if (value !== undefined) return value;
    }
    return "";
}

function collectCommandTokenMatches(command: string, pattern: RegExp): string[] {
    const matches: string[] = [];
    for (const match of command.matchAll(pattern)) {
        const token = firstDefinedMatchGroup(match);
        if (token) matches.push(token);
    }
    return matches;
}

function collectNegatedExistenceTokens(command: string): string[] {
    return collectCommandTokenMatches(command, new RegExp(`\\btest\\s+!\\s+-e\\s+${shellTokenPattern()}`, "g"));
}

function collectRequiredPathTokens(command: string): string[] {
    const token = shellTokenPattern();
    return [
        ...collectCommandTokenMatches(command, new RegExp(`\\bcat\\s+${token}`, "g")),
        ...collectCommandTokenMatches(command, new RegExp(`\\btest\\s+-[efs]\\s+${token}`, "g")),
        ...collectCommandTokenMatches(command, new RegExp(`[<>]{1,2}\\s*${token}`, "g")),
    ];
}

function findCaseInsensitivePathContradiction(command: string): CaseInsensitivePathContradiction | undefined {
    const negatedPaths = collectNegatedExistenceTokens(command);
    if (negatedPaths.length === 0) return undefined;
    const requiredPaths = collectRequiredPathTokens(command);
    for (const negatedPath of negatedPaths) {
        const foldedNegatedPath = negatedPath.toLocaleLowerCase();
        for (const requiredPath of requiredPaths) {
            if (requiredPath !== negatedPath && requiredPath.toLocaleLowerCase() === foldedNegatedPath) {
                return { negatedPath, requiredPath };
            }
        }
    }
    return undefined;
}

async function filesystemTreatsCaseOnlyPathVariantsAsSame(cwd: string): Promise<boolean> {
    const probeDir = await Deno.makeTempDir({ dir: cwd, prefix: ".runwield-objective-case-probe-" });
    try {
        const lowerPath = `${probeDir}/case-probe`;
        const upperPath = `${probeDir}/CASE-PROBE`;
        await Deno.writeTextFile(lowerPath, "probe");
        return await Deno.stat(upperPath).then(() => true, () => false);
    } finally {
        await Deno.remove(probeDir, { recursive: true }).catch(() => {});
    }
}

async function caseInsensitivePathContradictionReason(command: string, cwd: string): Promise<string | undefined> {
    const contradiction = findCaseInsensitivePathContradiction(command);
    if (!contradiction) return undefined;
    const caseInsensitive = await filesystemTreatsCaseOnlyPathVariantsAsSame(cwd).catch(() => false);
    if (!caseInsensitive) return undefined;
    return `Objective check requires a case-sensitive filesystem path distinction that this filesystem cannot represent: ${contradiction.negatedPath} must not exist while ${contradiction.requiredPath} must exist.`;
}

function statusForExitCode(exitCode: number): ObjectiveCheckStatus {
    if (exitCode === 0) return "met";
    if (SHELL_NOT_FOUND_EXIT_CODES.has(exitCode)) return "broken";
    return "unmet";
}

function reasonForExitCode(exitCode: number): string | undefined {
    if (exitCode === 126) return "Command could not execute.";
    if (exitCode === 127) return "Command or interpreter was not found.";
    return undefined;
}

function abortReason(signal: AbortSignal | undefined): string {
    if (!signal) return "Objective check was aborted.";
    const reason = signal.reason;
    if (reason instanceof Error && reason.message) return reason.message;
    if (typeof reason === "string" && reason.trim()) return reason.trim();
    return "Objective check was aborted.";
}

async function runOneObjectiveCheck(
    check: ObjectiveCheck,
    cwd: string,
    signal: AbortSignal | undefined,
    timeoutMs: number,
): Promise<ObjectiveCheckResult> {
    const startedAt = Date.now();
    try {
        const contradictionReason = await caseInsensitivePathContradictionReason(check.command, cwd);
        if (contradictionReason) {
            return {
                id: check.id,
                command: check.command,
                ...(check.rationale ? { rationale: check.rationale } : {}),
                status: "broken",
                stdout: "",
                stderr: "",
                exitCode: null,
                durationMs: Date.now() - startedAt,
                output: "",
                reason: contradictionReason,
            };
        }
        // The foreground-process module owns the abort/timeout triggers and
        // kills the whole process tree — including a pre-aborted signal, which
        // skips the spawn entirely.
        const shell = spawnForegroundShell({ command: check.command, cwd, signal, timeoutMs });
        const [outcome, stdout, stderr] = await Promise.all([
            shell.done,
            captureProcessStreamTail(shell.stdout, PROCESS_STREAM_OUTPUT_LIMIT_BYTES),
            captureProcessStreamTail(shell.stderr, PROCESS_STREAM_OUTPUT_LIMIT_BYTES),
        ]);
        const timedOut = outcome.terminatedBy === "timeout";
        const aborted = outcome.terminatedBy === "abort";
        const output = aborted && outcome.exitCode === null && stdout.totalBytes === 0 && stderr.totalBytes === 0
            ? ""
            : formatCapturedProcessOutput(stdout, stderr);
        const exitCode = timedOut || aborted ? null : outcome.exitCode;
        const resultStatus: ObjectiveCheckStatus = timedOut || aborted
            ? "broken"
            : statusForExitCode(outcome.exitCode ?? 1);
        const reason = timedOut
            ? `Objective check timed out after ${timeoutMs}ms.`
            : aborted
            ? abortReason(signal)
            : reasonForExitCode(outcome.exitCode ?? 1);
        return {
            id: check.id,
            command: check.command,
            ...(check.rationale ? { rationale: check.rationale } : {}),
            status: resultStatus,
            stdout: stdout.text,
            stderr: stderr.text,
            exitCode,
            durationMs: Date.now() - startedAt,
            output,
            ...(reason ? { reason } : {}),
        };
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return {
            id: check.id,
            command: check.command,
            ...(check.rationale ? { rationale: check.rationale } : {}),
            status: "broken",
            stdout: "",
            stderr: "",
            exitCode: null,
            durationMs: Date.now() - startedAt,
            output: "",
            reason: `Failed to spawn objective check: ${reason}`,
        };
    }
}

export async function runObjectiveChecks(
    { checks, cwd, signal, timeoutMs = DEFAULT_OBJECTIVE_CHECK_TIMEOUT_MS }: RunObjectiveChecksOptions,
): Promise<ObjectiveCheckResult[]> {
    if (!cwd) throw new Error("runObjectiveChecks: cwd is required");
    const results: ObjectiveCheckResult[] = [];
    for (const check of checks) {
        if (signal?.aborted) break;
        results.push(await runOneObjectiveCheck(check, cwd, signal, timeoutMs));
        // Stop scheduling remaining checks once cancellation lands: later checks
        // must not start new work after the user has stopped this phase.
        if (signal?.aborted) break;
    }
    return results;
}

function formatResult(result: ObjectiveCheckResult): string {
    const lines = [
        `- ${result.id}: ${result.status}`,
        `  command: ${result.command}`,
    ];
    if (result.rationale) lines.push(`  rationale: ${result.rationale}`);
    lines.push(`  exitCode: ${result.exitCode === null ? "none" : String(result.exitCode)}`);
    if (result.reason) lines.push(`  reason: ${result.reason}`);
    const output = result.output.trim();
    if (output) lines.push(`  output:\n${output.split("\n").map((line) => `    ${line}`).join("\n")}`);
    return lines.join("\n");
}

function formatCompactResult(result: ObjectiveCheckResult): string {
    const detail = result.reason || result.output.trim();
    const firstLine = detail.split("\n", 1)[0]?.trim();
    return `- ${result.id}: ${result.status}${firstLine ? ` — ${firstLine}` : ""}`;
}

export function summarizeObjectiveChecks(results: ObjectiveCheckResult[]): ObjectiveCheckSummary {
    const met = results.filter((result) => result.status === "met").length;
    const unmet = results.filter((result) => result.status === "unmet").length;
    const broken = results.filter((result) => result.status === "broken").length;
    const statusLine =
        `Objective-Failing Checks: ${met} met, ${unmet} unmet, ${broken} broken (${results.length} total).`;
    const compactResultLines = results.map(formatCompactResult).join("\n");
    const compactBlock = compactResultLines ? `${statusLine}\n\n${compactResultLines}` : statusLine;
    const resultLines = results.map(formatResult).join("\n\n");
    const block = resultLines ? `${statusLine}\n\n${resultLines}` : statusLine;
    return { total: results.length, met, unmet, broken, compactBlock, block };
}

export function classifyObjectiveChecksBaseline(
    results: ObjectiveCheckResult[],
): ObjectiveChecksBaselineClassification {
    const brokenResults = results.filter((result) => result.status === "broken");
    if (brokenResults.length > 0) return { status: "broken", offendingResults: brokenResults };
    const metResults = results.filter((result) => result.status === "met");
    if (metResults.length > 0) return { status: "already_met", offendingResults: metResults };
    return { status: "all_unmet", offendingResults: [] };
}

export function objectiveChecksBaselineMatches(
    baseline: ObjectiveChecksBaseline | undefined,
    checks: ObjectiveCheck[],
    head: string | undefined,
): boolean {
    if (!baseline) return false;
    if (!head || baseline.head !== head) return false;
    if (baseline.results.length !== checks.length) return false;
    return checks.every((check, index) => {
        const result = baseline.results[index];
        return result?.id === check.id && result.command === check.command;
    });
}
