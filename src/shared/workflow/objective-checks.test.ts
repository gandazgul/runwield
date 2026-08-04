import { assertEquals, assertMatch, assertStringIncludes } from "@std/assert";
import {
    classifyObjectiveChecksBaseline,
    objectiveChecksBaselineMatches,
    runObjectiveChecks,
    summarizeObjectiveChecks,
} from "./objective-checks.ts";

Deno.test("runObjectiveChecks classifies exit 0 as met", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        const [result] = await runObjectiveChecks({
            cwd,
            checks: [{ id: "OC1", command: "printf met", rationale: "prints stdout" }],
            timeoutMs: 5_000,
        });
        assertEquals(result.status, "met");
        assertEquals(result.exitCode, 0);
        assertEquals(result.stdout, "met");
        assertEquals(result.rationale, "prints stdout");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("runObjectiveChecks classifies non-zero commands that ran as unmet", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        const [result] = await runObjectiveChecks({
            cwd,
            checks: [{ id: "OC2", command: "printf nope >&2; exit 2" }],
            timeoutMs: 5_000,
        });
        assertEquals(result.status, "unmet");
        assertEquals(result.exitCode, 2);
        assertEquals(result.stderr, "nope");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("runObjectiveChecks classifies missing commands as broken", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        const [result] = await runObjectiveChecks({
            cwd,
            checks: [{ id: "OC3", command: "not-a-real-runwield-command" }],
            timeoutMs: 5_000,
        });
        assertEquals(result.status, "broken");
        assertEquals(result.exitCode, 127);
        assertStringIncludes(result.reason || "", "not found");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("runObjectiveChecks classifies timeouts as broken", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        const [result] = await runObjectiveChecks({
            cwd,
            checks: [{ id: "OC4", command: "sleep 5" }],
            timeoutMs: 10,
        });
        assertEquals(result.status, "broken");
        assertEquals(result.exitCode, null);
        assertStringIncludes(result.reason || "", "timed out");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("summarizeObjectiveChecks counts results and formats non-met output", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        const results = await runObjectiveChecks({
            cwd,
            checks: [
                { id: "PASS", command: "true" },
                { id: "FAIL", command: "printf details; exit 3", rationale: "must become true" },
            ],
            timeoutMs: 5_000,
        });
        const summary = summarizeObjectiveChecks(results);
        assertEquals(summary.met, 1);
        assertEquals(summary.unmet, 1);
        assertEquals(summary.broken, 0);
        assertStringIncludes(summary.block, "PASS: met");
        assertStringIncludes(summary.block, "FAIL: unmet");
        assertStringIncludes(summary.block, "command: printf details; exit 3");
        assertStringIncludes(summary.block, "details");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("classifyObjectiveChecksBaseline accepts only all-unmet baselines", () => {
    const unmet = {
        id: "OC1",
        command: "false",
        status: "unmet" as const,
        stdout: "",
        stderr: "",
        exitCode: 1,
        durationMs: 1,
        output: "",
    };
    const met = { ...unmet, id: "OC2", command: "true", status: "met" as const, exitCode: 0 };
    const broken = { ...unmet, id: "OC3", command: "missing", status: "broken" as const, exitCode: 127 };

    assertEquals(classifyObjectiveChecksBaseline([unmet]), { status: "all_unmet", offendingResults: [] });
    assertEquals(classifyObjectiveChecksBaseline([unmet, met]).status, "already_met");
    assertEquals(classifyObjectiveChecksBaseline([unmet, met]).offendingResults.map((result) => result.id), ["OC2"]);
    assertEquals(classifyObjectiveChecksBaseline([met, broken]).status, "broken");
    assertEquals(classifyObjectiveChecksBaseline([met, broken]).offendingResults.map((result) => result.id), ["OC3"]);
});

Deno.test("objectiveChecksBaselineMatches requires matching head, IDs, and commands", () => {
    const baseline = {
        recordedAt: "2026-01-01T00:00:00.000Z",
        head: "abc",
        results: [{
            id: "OC1",
            command: "grep needle file.txt",
            status: "unmet" as const,
            stdout: "",
            stderr: "",
            exitCode: 1,
            durationMs: 1,
            output: "",
        }],
    };

    assertEquals(
        objectiveChecksBaselineMatches(baseline, [{ id: "OC1", command: "grep needle file.txt" }], "abc"),
        true,
    );
    assertEquals(
        objectiveChecksBaselineMatches(baseline, [{ id: "OC1", command: "grep other file.txt" }], "abc"),
        false,
    );
    assertEquals(
        objectiveChecksBaselineMatches(baseline, [{ id: "OC1", command: "grep needle file.txt" }], "def"),
        false,
    );
    assertEquals(
        objectiveChecksBaselineMatches({ ...baseline, head: undefined }, [{
            id: "OC1",
            command: "grep needle file.txt",
        }], undefined),
        false,
    );
});

Deno.test("objective-checks module does not import validation modules", async () => {
    const source = await Deno.readTextFile(new URL("./objective-checks.ts", import.meta.url));
    assertEquals(/from\s+["'][^"']*validation|import\s*\(\s*["'][^"']*validation/.test(source), false);
    assertMatch(source, /process-output\.ts/);
});

const IS_WINDOWS = Deno.build.os === "windows";

function processAlive(pid: number): boolean {
    try {
        Deno.kill(pid, "SIGCONT");
        return true;
    } catch {
        return false;
    }
}

/**
 * Run one check whose descendant outlives a wrapper-only kill, and hand back
 * the descendant's pid once it is definitely running.
 */
async function runCheckWithDescendant(options: {
    signal?: AbortSignal;
    timeoutMs?: number;
}): Promise<
    {
        resultsPromise: Promise<import("./objective-checks.ts").ObjectiveCheckResult[]>;
        descendantPid: number;
        cwd: string;
    }
> {
    const cwd = await Deno.makeTempDir({ prefix: "runwield-oc-tree-" });
    const pidFile = `${cwd}/descendant.pid`;
    const resultsPromise = runObjectiveChecks({
        cwd,
        checks: [{ id: "OC-TREE", command: `sleep 30 & echo $! > ${pidFile}; wait` }],
        signal: options.signal,
        ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    });
    let descendantPid = 0;
    while (!descendantPid) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        descendantPid = Number(await Deno.readTextFile(pidFile).then((text) => text.trim(), () => "")) || 0;
    }
    return { resultsPromise, descendantPid, cwd };
}

Deno.test({
    name: "runObjectiveChecks abort kills descendant processes, not only the wrapper shell",
    ignore: IS_WINDOWS,
    fn: async () => {
        const abortController = new AbortController();
        const { resultsPromise, descendantPid, cwd } = await runCheckWithDescendant({
            signal: abortController.signal,
        });
        try {
            assertEquals(processAlive(descendantPid), true, "descendant should be running before abort");
            abortController.abort();
            const [result] = await resultsPromise;
            assertEquals(result.status, "broken");
            assertEquals(result.exitCode, null);
            assertEquals(processAlive(descendantPid), false, "abort must kill the check's whole process tree");
        } finally {
            if (processAlive(descendantPid)) Deno.kill(descendantPid, "SIGKILL");
            await Deno.remove(cwd, { recursive: true }).catch(() => {});
        }
    },
});

Deno.test({
    name: "runObjectiveChecks timeout kills descendant processes, not only the wrapper shell",
    ignore: IS_WINDOWS,
    fn: async () => {
        const { resultsPromise, descendantPid, cwd } = await runCheckWithDescendant({ timeoutMs: 50 });
        try {
            assertEquals(processAlive(descendantPid), true, "descendant should be running before the timeout");
            const [result] = await resultsPromise;
            assertEquals(result.status, "broken");
            assertEquals(result.exitCode, null);
            assertStringIncludes(result.reason || "", "timed out");
            assertEquals(processAlive(descendantPid), false, "timeout must kill the check's whole process tree");
        } finally {
            if (processAlive(descendantPid)) Deno.kill(descendantPid, "SIGKILL");
            await Deno.remove(cwd, { recursive: true }).catch(() => {});
        }
    },
});

Deno.test({
    name: "runObjectiveChecks does not start remaining checks after its signal aborts",
    ignore: IS_WINDOWS,
    fn: async () => {
        const cwd = await Deno.makeTempDir({ prefix: "runwield-oc-stop-" });
        const marker = `${cwd}/second-check-ran`;
        const abortController = new AbortController();
        try {
            const resultsPromise = runObjectiveChecks({
                cwd,
                checks: [
                    { id: "OC-FIRST", command: "sleep 30" },
                    { id: "OC-SECOND", command: `touch ${marker}` },
                ],
                signal: abortController.signal,
            });
            // Let the first check start, then cancel while it is running.
            await new Promise((resolve) => setTimeout(resolve, 100));
            abortController.abort();
            const results = await resultsPromise;
            assertEquals(results.length, 1, "the second check must not start after cancellation");
            assertEquals(results[0].id, "OC-FIRST");
            const markerExists = await Deno.stat(marker).then(() => true, () => false);
            assertEquals(markerExists, false);
        } finally {
            await Deno.remove(cwd, { recursive: true }).catch(() => {});
        }
    },
});
