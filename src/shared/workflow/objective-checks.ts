/**
 * @module shared/workflow/objective-checks
 * Run Plan-owned Objective-Failing Checks and classify their results.
 */

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
    block: string;
}

export interface RunObjectiveChecksOptions {
    checks: ObjectiveCheck[];
    cwd: string;
    signal?: AbortSignal;
    timeoutMs?: number;
}

const SHELL_NOT_FOUND_EXIT_CODES = new Set([126, 127]);
export const DEFAULT_OBJECTIVE_CHECK_TIMEOUT_MS = 60_000;

function shellCommand(command: string): { cmd: string; args: string[] } {
    if (Deno.build.os === "windows") return { cmd: "cmd", args: ["/c", command] };
    return { cmd: "sh", args: ["-c", command] };
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
    const { cmd, args } = shellCommand(check.command);
    const timeout = new AbortController();
    let child: Deno.ChildProcess | null = null;
    let timedOut = false;
    let aborted = false;
    const timeoutId = setTimeout(() => {
        timedOut = true;
        try {
            child?.kill("SIGKILL");
        } catch {
            // Process may already have exited.
        }
    }, timeoutMs);
    const abortChild = () => {
        aborted = true;
        try {
            child?.kill("SIGTERM");
        } catch {
            // Process may already have exited.
        }
    };
    signal?.addEventListener("abort", abortChild, { once: true });

    try {
        if (signal?.aborted) {
            aborted = true;
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
                reason: abortReason(signal),
            };
        }
        child = new Deno.Command(cmd, {
            args,
            cwd,
            stdout: "piped",
            stderr: "piped",
        }).spawn();
        const [status, stdout, stderr] = await Promise.all([
            child.status,
            captureProcessStreamTail(child.stdout, PROCESS_STREAM_OUTPUT_LIMIT_BYTES),
            captureProcessStreamTail(child.stderr, PROCESS_STREAM_OUTPUT_LIMIT_BYTES),
        ]);
        const output = formatCapturedProcessOutput(stdout, stderr);
        const exitCode = timedOut || aborted ? null : status.code;
        const resultStatus: ObjectiveCheckStatus = timedOut || aborted ? "broken" : statusForExitCode(status.code);
        const reason = timedOut
            ? `Objective check timed out after ${timeoutMs}ms.`
            : aborted
            ? abortReason(signal)
            : reasonForExitCode(status.code);
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
    } finally {
        clearTimeout(timeoutId);
        signal?.removeEventListener("abort", abortChild);
        timeout.abort();
    }
}

export async function runObjectiveChecks(
    { checks, cwd, signal, timeoutMs = DEFAULT_OBJECTIVE_CHECK_TIMEOUT_MS }: RunObjectiveChecksOptions,
): Promise<ObjectiveCheckResult[]> {
    if (!cwd) throw new Error("runObjectiveChecks: cwd is required");
    const results: ObjectiveCheckResult[] = [];
    for (const check of checks) {
        results.push(await runOneObjectiveCheck(check, cwd, signal, timeoutMs));
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

export function summarizeObjectiveChecks(results: ObjectiveCheckResult[]): ObjectiveCheckSummary {
    const met = results.filter((result) => result.status === "met").length;
    const unmet = results.filter((result) => result.status === "unmet").length;
    const broken = results.filter((result) => result.status === "broken").length;
    const statusLine =
        `Objective-Failing Checks: ${met} met, ${unmet} unmet, ${broken} broken (${results.length} total).`;
    const resultLines = results.map(formatResult).join("\n\n");
    const block = resultLines ? `${statusLine}\n\n${resultLines}` : statusLine;
    return { total: results.length, met, unmet, broken, block };
}
