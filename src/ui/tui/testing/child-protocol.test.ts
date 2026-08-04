import { assertRejects } from "@std/assert";
import { join, toFileUrl } from "@std/path";
import { runGoldenScenarioChildProcess } from "./child-protocol.js";

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
