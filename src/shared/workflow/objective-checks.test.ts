import { assertEquals, assertMatch, assertStringIncludes } from "@std/assert";
import { runObjectiveChecks, summarizeObjectiveChecks } from "./objective-checks.ts";

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

Deno.test("objective-checks module does not import validation modules", async () => {
    const source = await Deno.readTextFile(new URL("./objective-checks.ts", import.meta.url));
    assertEquals(/from\s+["'][^"']*validation|import\s*\(\s*["'][^"']*validation/.test(source), false);
    assertMatch(source, /process-output\.ts/);
});
