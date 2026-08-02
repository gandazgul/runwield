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
