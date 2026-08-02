import { assertEquals, assertRejects } from "@std/assert";
import { SessionRuntime } from "../../shared/session/session-runtime.js";
import { withRuntimeCommandFixture } from "../testing/runtime-command-fixture.ts";
import { runNewCommand } from "./index.ts";

async function captureErrors(run: () => Promise<void>): Promise<string[]> {
    const originalError = console.error;
    const errors: string[] = [];
    console.error = (message = "") => errors.push(String(message));
    try {
        await run();
    } finally {
        console.error = originalError;
    }
    return errors;
}

Deno.test("runNewCommand creates and names a real Router session in the active project", async () => {
    await withRuntimeCommandFixture("runwield-new-command-", async ({ projectRoot }) => {
        const runtime = new SessionRuntime();
        const current = await runtime.createInteractiveSession({ cwd: projectRoot, mode: "new" });
        let replacementId = "";
        let cleared = false;
        try {
            await runNewCommand(["build", "coverage"], {
                uiAPI: { clearMessages: () => cleared = true },
                sessionId: current.sessionId,
                sessionRuntime: runtime,
                replaceRuntimeSession: (sessionId) => replacementId = sessionId,
            });

            const replacement = runtime.getSessionSnapshot(replacementId);
            assertEquals(replacement?.cwd, projectRoot);
            assertEquals(replacement?.name, "build coverage");
            assertEquals(runtime.getRuntimeActiveAgentName(replacementId), "router");
            assertEquals(cleared, true);
            assertEquals(runtime.listSessions().length, 2);
        } finally {
            runtime.closeAllSessions();
        }
    });
});

Deno.test("runNewCommand uses the fixture cwd when there is no current session", async () => {
    await withRuntimeCommandFixture("runwield-new-command-", async ({ alternateRoot }) => {
        const runtime = new SessionRuntime();
        let replacementId = "";
        try {
            await runNewCommand([], {
                uiAPI: {},
                sessionRuntime: runtime,
                replaceRuntimeSession: (sessionId) => replacementId = sessionId,
            });

            const replacement = runtime.getSessionSnapshot(replacementId);
            assertEquals(replacement?.cwd, alternateRoot);
            assertEquals(replacement?.name, null);
            assertEquals(runtime.getRuntimeActiveAgentName(replacementId), "router");
        } finally {
            runtime.closeAllSessions();
        }
    });
});

Deno.test("runNewCommand reports unavailable interactive state", async () => {
    await withRuntimeCommandFixture("runwield-new-command-", async () => {
        const errors = await captureErrors(() => runNewCommand([]));
        assertEquals(errors, ["The /new command is only available inside an interactive session."]);

        await assertRejects(
            () => runNewCommand([], { uiAPI: {} }),
            Error,
            "/new requires the SessionRuntime surface.",
        );
    });
});
