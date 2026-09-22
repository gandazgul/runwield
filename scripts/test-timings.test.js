import { assertEquals, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { parseRunnerArguments, selectTestShard } from "./run-tests.js";
import { mergeTestTimings, orderTestsByTiming, readTestTimings, writeTestTimings } from "./test-timings.js";

Deno.test("test runner parses scheduling controls without passing them to Deno", () => {
    const parsed = parseRunnerArguments([
        "--fail-fast",
        "--timings-file",
        ".ci-cache/golden-timings.json",
        "--isolated",
        "src/ui/tui/testing",
    ]);

    assertEquals(parsed.failFast, true);
    assertEquals(parsed.timingsFile?.endsWith(".ci-cache/golden-timings.json"), true);
    assertEquals(parsed.rest, ["--isolated", "src/ui/tui/testing"]);
});

Deno.test("historical timings schedule slow files first and place new files near the median", () => {
    const root = "/repo";
    const files = ["fast.test.ts", "new.test.ts", "slow.test.ts", "middle.test.ts"].map((file) => join(root, file));
    const ordered = orderTestsByTiming(files, root, {
        "fast.test.ts": { durationMs: 10, runs: 3 },
        "middle.test.ts": { durationMs: 50, runs: 3 },
        "slow.test.ts": { durationMs: 100, runs: 3 },
    });

    assertEquals(ordered.map((file) => file.slice(root.length + 1)), [
        "slow.test.ts",
        "middle.test.ts",
        "new.test.ts",
        "fast.test.ts",
    ]);
});

Deno.test("the first observation schedules slow files first without changing membership", () => {
    const root = "/repo";
    const files = ["a.test.ts", "b.test.ts"].map((file) => join(root, file));

    assertEquals(
        orderTestsByTiming(files, root, {
            "a.test.ts": { durationMs: 10, runs: 1 },
            "b.test.ts": { durationMs: 100, runs: 1 },
        }),
        [...files].reverse(),
    );
});

Deno.test("test timing history survives invalid cache data and merges recent observations", async () => {
    const root = await Deno.makeTempDir({ prefix: "runwield-test-timings-" });
    const path = join(root, "history.json");
    try {
        await Deno.writeTextFile(path, "not json");
        assertEquals(await readTestTimings(path), {});

        const merged = mergeTestTimings(
            { "a.test.ts": { durationMs: 100, runs: 3 } },
            [{ file: "a.test.ts", durationMs: 200 }, { file: "b.test.ts", durationMs: 40 }],
        );
        await writeTestTimings(path, merged);

        assertEquals(await readTestTimings(path), {
            "a.test.ts": { durationMs: 125, runs: 4 },
            "b.test.ts": { durationMs: 40, runs: 1 },
        });
    } finally {
        await Deno.remove(root, { recursive: true });
    }
});

Deno.test("release fail-fast stops scheduling new isolated test files", async () => {
    const root = await Deno.makeTempDir({ prefix: "runwield-fail-fast-" });
    const marker = join(root, "later-ran");
    try {
        await Deno.writeTextFile(
            join(root, "a-failure.test.js"),
            'Deno.test("fails", () => { throw new Error("stop"); });\n',
        );
        await Deno.writeTextFile(
            join(root, "b-later.test.js"),
            `Deno.test("later", async () => { await Deno.writeTextFile(${JSON.stringify(marker)}, "ran"); });\n`,
        );
        const output = await new Deno.Command(Deno.execPath(), {
            args: ["run", "-A", "scripts/run-tests.js", "--fail-fast", "--isolated", root],
            cwd: Deno.cwd(),
            env: { WLD_TEST_CONCURRENCY: "1" },
            stdout: "piped",
            stderr: "piped",
        }).output();

        assertEquals(output.success, false);
        assertEquals(await Deno.stat(marker).then(() => true).catch(() => false), false);
    } finally {
        await Deno.remove(root, { recursive: true });
    }
});

Deno.test("shards cover every file once regardless of discovery order or timing history", () => {
    const files = Array.from({ length: 37 }, (_, index) => `test-${index}.test.ts`);
    const shards = [1, 2, 3, 4].map((index) => selectTestShard([...files].reverse(), `${index}/4`));
    assertEquals(shards.flat().sort(), [...files].sort());
    assertEquals(new Set(shards.flat()).size, files.length);
    assertEquals(selectTestShard(files, "2/4"), shards[1]);
    assertEquals(selectTestShard([], "1/4"), []);
    for (const invalid of ["0/4", "5/4", "1/0", "1", "-1/2", "1/2.5"]) {
        assertThrows(() => selectTestShard(files, invalid), Error, "Invalid test shard");
    }
});
