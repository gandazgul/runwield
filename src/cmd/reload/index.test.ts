import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { createSessionRuntime } from "../../shared/session/session-runtime.ts";
import { isMascotEnabled } from "../../shared/settings.js";
import { withRuntimeCommandFixture } from "../testing/runtime-command-fixture.ts";
import { runReloadCommand } from "./index.ts";

Deno.test("successful reload applies manual mascot settings edits to an open Session", async () => {
    await withRuntimeCommandFixture("reload-mascot-", async ({ projectRoot }) => {
        const runtime = createSessionRuntime();
        const sessionId = await runtime.createPromptReadySession({ cwd: projectRoot, agentName: "router" });
        const messages: string[] = [];
        try {
            assertEquals(isMascotEnabled(projectRoot), true);
            const path = join(projectRoot, ".wld", "settings.json");
            await Deno.mkdir(join(projectRoot, ".wld"), { recursive: true });
            await Deno.writeTextFile(path, JSON.stringify({ mascot: false }));
            assertEquals(isMascotEnabled(projectRoot), true);
            await runReloadCommand([], {
                sessionRuntime: runtime,
                sessionId,
                uiAPI: {
                    appendSystemMessage: (message: string) => {
                        messages.push(message);
                    },
                    appendAgentMessageStart: () => ({ appendText: () => {} }),
                    requestRender: () => {},
                    promptSelect: () => Promise.resolve(null),
                    promptText: () => Promise.resolve(null),
                    showModelSelector: () => {},
                    abortActivePrompt: () => {},
                },
            });
            assertStringIncludes(messages.join("\n"), "Successfully reloaded");
            assertEquals(isMascotEnabled(projectRoot), false);
        } finally {
            await runtime.closeAllSessions();
        }
    });
});
