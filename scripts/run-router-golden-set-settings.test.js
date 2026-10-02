import { assertEquals } from "@std/assert";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { join } from "@std/path";
import { withRuntimeCommandFixture } from "../src/cmd/testing/runtime-command-fixture.ts";
import { main } from "./run-router-golden-set.js";

/**
 * @typedef {Object} RouterRequestSettings
 * @property {number} [temperature]
 * @property {string} [reasoning]
 */

for (
    const { level, temperature, expectedTemperature } of [
        { level: "medium", temperature: "0", expectedTemperature: 0 },
        { level: "low", temperature: "0.7", expectedTemperature: 0.7 },
        { level: "medium", temperature: undefined, expectedTemperature: 0.1 },
    ]
) {
    Deno.test(`router benchmark CLI applies ${level} thinking with temperature ${temperature ?? "default"}`, async () => {
        await withRuntimeCommandFixture(
            "router-benchmark-settings-",
            async ({ projectRoot, setModelResponseFactory }) => {
                const csv = join(projectRoot, "gold.csv");
                const out = join(projectRoot, "results.csv");
                await Deno.writeTextFile(csv, "decisionId,requestText,humanJudgement\nd1,hello,INQUIRY\n");
                /** @type {RouterRequestSettings[]} */
                const requests = [];
                setModelResponseFactory((_context, options) => {
                    requests.push({ temperature: options?.temperature, reasoning: options?.reasoning });
                    return requests.length === 1
                        ? fauxAssistantMessage(fauxToolCall("triage_report", {
                            routingIntent: "INQUIRY",
                            complexity: "LOW",
                            summary: "Greeting",
                            sessionName: "Greeting",
                        }))
                        : fauxAssistantMessage(fauxText("Done."));
                });
                await main([
                    "--csv",
                    csv,
                    "--out",
                    out,
                    "--cwd",
                    projectRoot,
                    "--model",
                    "runtime-command-fixture/fixture-model",
                    "--thinking-level",
                    level,
                    ...(temperature === undefined ? [] : ["--temperature", temperature]),
                    "--rerun",
                ]);
                assertEquals(requests.length > 0, true);
                for (const request of requests) {
                    assertEquals(request.temperature, expectedTemperature);
                    assertEquals(request.reasoning, level);
                }
                assertEquals((await Deno.readTextFile(out)).includes("ERROR:"), false);
            },
            { reasoning: true },
        );
    });
}
