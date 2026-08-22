#!/usr/bin/env -S deno run -A

export const PRE_TEST_TASKS = [
    "submodules:check",
    "snip:check",
    "check",
    "workspace:check",
    "lint",
    "language-policy:check",
    "seams:check",
    "doc-links:check",
] as const;

export type CiTaskName = typeof PRE_TEST_TASKS[number] | "test";

export interface CiTaskResult {
    name: CiTaskName;
    code: number;
    elapsedMs?: number;
}

export interface CiResult {
    exitCode: number;
    failures: CiTaskResult[];
}

export type ExecuteCiTask = (taskName: CiTaskName) => Promise<CiTaskResult>;

function failedStartResult(taskName: CiTaskName): CiTaskResult {
    return { name: taskName, code: 1 };
}

async function settleTask(taskName: CiTaskName, executeTask: ExecuteCiTask): Promise<CiTaskResult> {
    try {
        return await executeTask(taskName);
    } catch {
        return failedStartResult(taskName);
    }
}

function failedTasks(results: CiTaskResult[]): CiTaskResult[] {
    return results.filter((result) => result.code !== 0);
}

function printFailureSummary(failures: CiTaskResult[]): void {
    if (failures.length === 0) return;
    console.error("CI failed tasks:");
    for (const failure of failures) {
        console.error(`- ${failure.name}: exit ${failure.code}`);
    }
}

export async function runCi(executeTask: ExecuteCiTask): Promise<CiResult> {
    const preTestRuns = PRE_TEST_TASKS.map((taskName) => settleTask(taskName, executeTask));
    const preTestResults = await Promise.all(preTestRuns);
    const preTestFailures = failedTasks(preTestResults);

    if (preTestFailures.length > 0) {
        printFailureSummary(preTestFailures);
        return { exitCode: 1, failures: preTestFailures };
    }

    const testResult = await settleTask("test", executeTask);
    const testFailures = failedTasks([testResult]);
    printFailureSummary(testFailures);
    return { exitCode: testResult.code, failures: testFailures };
}

async function executeDenoTask(taskName: CiTaskName): Promise<CiTaskResult> {
    const start = performance.now();
    console.error(`[ci] start ${taskName}`);
    let child: Deno.ChildProcess;
    try {
        child = new Deno.Command(Deno.execPath(), {
            args: ["task", "-q", taskName],
            stdin: "inherit",
            stdout: "inherit",
            stderr: "inherit",
        }).spawn();
    } catch {
        const elapsedMs = performance.now() - start;
        console.error(`[ci] failed to start ${taskName} (${formatElapsed(elapsedMs)})`);
        return { name: taskName, code: 1, elapsedMs };
    }

    const status = await child.status;
    const elapsedMs = performance.now() - start;
    console.error(`[ci] done ${taskName}: exit ${status.code} (${formatElapsed(elapsedMs)})`);
    return { name: taskName, code: status.code, elapsedMs };
}

function formatElapsed(elapsedMs: number): string {
    if (elapsedMs < 1000) return `${Math.round(elapsedMs)}ms`;
    return `${(elapsedMs / 1000).toFixed(1)}s`;
}

if (import.meta.main) {
    const result = await runCi(executeDenoTask);
    Deno.exit(result.exitCode);
}
