import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { withRuntimeCommandFixture } from "../testing/runtime-command-fixture.ts";
import { GUIDED_REVIEW_EVENT_PREFIX } from "./protocol.ts";
import { runGuidedReviewCommand } from "./index.ts";

Deno.test("guided-review emits runtime usage frames on stderr and generated review JSON on stdout", async () => {
    await withRuntimeCommandFixture(
        "guided-review-command-usage-",
        async ({ projectRoot, setModelResponseFactory }) => {
            const reviewJson = JSON.stringify({
                schemaVersion: "1.0",
                title: "Fixture Guided Review",
                sections: [{ title: "Core", role: "core", blocks: [] }],
                everythingElse: [],
            });
            setModelResponseFactory(() => ({
                ...fauxAssistantMessage(fauxText(reviewJson)),
                usage: {
                    input: 12,
                    output: 4,
                    cacheRead: 3,
                    cacheWrite: 2,
                    totalTokens: 21,
                    cost: { input: 0.01, output: 0.02, cacheRead: 0.001, cacheWrite: 0.003, total: 0.034 },
                },
            }));
            Deno.chdir(projectRoot);
            let stdout = "";
            let stderr = "";

            const code = await runGuidedReviewCommand({
                readStdin: () => Promise.resolve("Generate the fixture Guided Review."),
                writeStdout: (text) => {
                    stdout += text;
                },
                writeStderr: (text) => {
                    stderr += text;
                },
            });

            assertEquals(code, 0);
            assertEquals(stdout, `${reviewJson}\n`);
            assertStringIncludes(stderr, GUIDED_REVIEW_EVENT_PREFIX);
            const frames = stderr.trim().split("\n").map((line) =>
                JSON.parse(line.slice(GUIDED_REVIEW_EVENT_PREFIX.length))
            );
            assertEquals(frames.length, 1);
            assertEquals(frames[0].version, 1);
            assertEquals(frames[0].type, "usage");
            assert(frames[0].usage.inputTokens > 0);
            assert(frames[0].usage.outputTokens > 0);
            assert(frames[0].usage.cacheWriteTokens > 0);
            assertEquals(typeof frames[0].usage.cacheReadTokens, "number");
            assertEquals(typeof frames[0].usage.costUsd, "number");
        },
    );
});
