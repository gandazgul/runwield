import { assertRejects } from "@std/assert";
import { join, toFileUrl } from "@std/path";
import { runGoldenScenarioChildProcess } from "./child-protocol.js";
import { GOLDEN_CHILD_READY_MARKER } from "./subprocess-runner.js";

Deno.test("Golden scenarios reject a timeout even after the child reports success", async () => {
    const fixtureRoot = await Deno.makeTempDir({ prefix: "golden-success-then-hang-" });
    const scenarioPath = join(fixtureRoot, "hanging-scenario.ts");
    try {
        await Deno.writeTextFile(
            scenarioPath,
            [
                `console.log(${JSON.stringify(GOLDEN_CHILD_READY_MARKER)});`,
                "console.log(JSON.stringify({ ok: true, result: { actor: { remaining: [] } } }));",
                "await new Promise((resolve) => setTimeout(resolve, 60_000));",
                "export const hangingScenario = {};",
                "",
            ].join("\n"),
        );
        await assertRejects(
            () =>
                runGoldenScenarioChildProcess({
                    scenarioModule: toFileUrl(scenarioPath).href,
                    exportName: "hangingScenario",
                    timeoutMs: 1000,
                }),
            Error,
            "Golden child failed (timeout)",
        );
    } finally {
        await Deno.remove(fixtureRoot, { recursive: true });
    }
});

Deno.test("expected-clean-exit scenarios reject a nonzero child exit after the pre-exit report", async () => {
    const fixtureRoot = await Deno.makeTempDir({ prefix: "golden-clean-exit-crash-" });
    const scenarioPath = join(fixtureRoot, "crashing-scenario.ts");
    try {
        await Deno.writeTextFile(
            scenarioPath,
            [
                'if (Deno.env.get("WLD_GOLDEN_TUI_CHILD") === "1") {',
                '    console.log(JSON.stringify({ ok: true, expectedCleanExit: true, result: { name: "crash", state: {}, events: [], actor: { remaining: [] } } }));',
                "    Deno.exit(7);",
                "}",
                'export const crashingScenario = { name: "crash", expectedCleanExit: true, assertions: [] };',
                "",
            ].join("\n"),
        );

        await assertRejects(
            () =>
                runGoldenScenarioChildProcess({
                    scenarioModule: toFileUrl(scenarioPath).href,
                    exportName: "crashingScenario",
                    timeoutMs: 10_000,
                }),
            Error,
            "Golden child failed",
        );
    } finally {
        await Deno.remove(fixtureRoot, { recursive: true });
    }
});
