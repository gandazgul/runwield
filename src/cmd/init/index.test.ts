import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { withRuntimeCommandFixture } from "../testing/runtime-command-fixture.ts";
import { __resetSettingsForTests } from "../../shared/settings.js";
import { SessionRuntime } from "../../shared/session/session-runtime.js";
import { RuntimeEventTypes } from "../../shared/session/session-runtime-events.js";
import { getCwdInitState } from "./init-state.ts";
import { runInitCommand } from "./index.ts";
import type { InteractiveSessionPort } from "../../ui/tui/interactive-session-port.ts";

interface InitUi {
    messages: Array<{ message: string; error?: boolean }>;
    uiAPI: Pick<import("../../ui/tui/types.js").UiAPI, "appendSystemMessage">;
}

const UNEXPECTED_SESSION_PORT: InteractiveSessionPort = {
    startInteractiveSession: () => Promise.reject(new Error("Unexpected interactive session in init command test")),
};

function createUi(): InitUi {
    const messages: Array<{ message: string; error?: boolean }> = [];
    return {
        messages,
        uiAPI: {
            appendSystemMessage: (message, error) => messages.push({ message, error }),
        },
    };
}

async function captureConsole(run: () => void | Promise<void>): Promise<{ logs: string[]; warnings: string[] }> {
    const logs: string[] = [];
    const warnings: string[] = [];
    const originalLog = console.log;
    const originalWarn = console.warn;
    console.log = (message = "") => logs.push(String(message));
    console.warn = (message = "") => warnings.push(String(message));
    try {
        await run();
    } finally {
        console.log = originalLog;
        console.warn = originalWarn;
    }
    return { logs, warnings };
}

Deno.test("init exercises real project state, assets, settings, and Agent runtime in an isolated home", async (test) => {
    await withRuntimeCommandFixture(
        "init-command-",
        async ({ alternateRoot, homeDir, projectRoot, settingsPath, setModelResponse }) => {
            const originalSettings = await Deno.readTextFile(settingsPath);

            await test.step("help comes from the real command registry before project inspection", async () => {
                const output = await captureConsole(() =>
                    runInitCommand(["--help"], { sessionPort: UNEXPECTED_SESSION_PORT })
                );
                assertStringIncludes(output.logs.join("\n"), "Usage (init):");
                assertStringIncludes(output.logs.join("\n"), "Runs a one-time agent");
            });

            await test.step("an empty fixture project remains uninitialized", async () => {
                Deno.chdir(alternateRoot);
                const ui = createUi();
                await runInitCommand([], { uiAPI: ui.uiAPI, sessionPort: UNEXPECTED_SESSION_PORT });

                assertStringIncludes(ui.messages[0].message, "Nothing to initialize yet");
                assertEquals(await getCwdInitState(), undefined);
            });

            await test.step("CLI init extracts real assets before delegating missing-model setup", async () => {
                const setupRoot = join(projectRoot, "model-setup-project");
                await Deno.mkdir(setupRoot);
                await Deno.writeTextFile(join(setupRoot, "README.md"), "# Model setup fixture\n");
                Deno.chdir(setupRoot);
                await Deno.writeTextFile(settingsPath, JSON.stringify({ notifications: { enabled: false } }));
                __resetSettingsForTests();
                let request: string | null = null;
                let agentName = "";

                await runInitCommand([], {
                    sessionPort: {
                        startInteractiveSession: (nextRequest, options) => {
                            request = nextRequest;
                            agentName = options.initialAgentName || "";
                            return Promise.resolve();
                        },
                    },
                });

                assertEquals(request, "/init");
                assertEquals(agentName, "router");
                assert(
                    (await Deno.stat(
                        join(
                            homeDir,
                            ".wld",
                            "bundled-agent-definitions",
                            "subagent-definitions",
                            "init-agent-prompt.md",
                        ),
                    )).isFile,
                );
                assert((await Deno.stat(join(homeDir, ".wld", "bundled-skills", "write-tests", "SKILL.md"))).isFile);
                assertEquals(await getCwdInitState(), undefined);

                await Deno.writeTextFile(settingsPath, originalSettings);
                __resetSettingsForTests();
            });

            await test.step("init runs the real isolated Agent and records completion", async () => {
                Deno.chdir(projectRoot);
                await Deno.writeTextFile(join(projectRoot, "mod.ts"), "export const fixture = true;\n");
                setModelResponse("Initialization inspection complete.");
                const ui = createUi();
                const runtime = new SessionRuntime();
                const created = await runtime.createInteractiveSession({ cwd: projectRoot, mode: "new" });
                const assistantText: string[] = [];
                const unsubscribe = runtime.subscribeSessionEvents(created.sessionId, (event) => {
                    if (event.type === RuntimeEventTypes.ASSISTANT_TEXT_DELTA) assistantText.push(event.delta);
                });
                try {
                    await runInitCommand([], {
                        uiAPI: ui.uiAPI,
                        sessionRuntime: runtime,
                        sessionId: created.sessionId,
                        sessionPort: UNEXPECTED_SESSION_PORT,
                    });

                    const state = await getCwdInitState();
                    assertEquals(state?.path, projectRoot);
                    assertEquals(state?.initOffered, true);
                    assertEquals(state?.initDone, true);
                    assertEquals(typeof state?.offeredAt, "string");
                    assertEquals(typeof state?.doneAt, "string");
                    assertStringIncludes(assistantText.join(""), "Initialization inspection complete.");
                    assertEquals(ui.messages, [{
                        message: "✅ Init complete. CONTEXT.md has been written to the project root.",
                        error: undefined,
                    }]);
                } finally {
                    unsubscribe();
                    runtime.closeSession(created.sessionId);
                }
            });

            await test.step("a second init reads the persisted guard and does not run another Agent", async () => {
                Deno.chdir(projectRoot);
                const ui = createUi();
                await runInitCommand([], { uiAPI: ui.uiAPI, sessionPort: UNEXPECTED_SESSION_PORT });

                assertEquals(ui.messages.length, 1);
                assertStringIncludes(ui.messages[0].message, "Init has already been run");
                assertStringIncludes(ui.messages[0].message, projectRoot);
                assertEquals((await getCwdInitState())?.initDone, true);
            });

            await test.step("the registered init command keeps both CLI and slash surfaces", async () => {
                const { getCommandDefinition, hasCommandSurface } = await import("../registry.js");
                const command = getCommandDefinition("init");
                assertEquals(command ? hasCommandSurface(command, "slash") : false, true);
                assertEquals(command ? hasCommandSurface(command, "cli") : false, true);
                assertEquals(command?.displayName, "Init");
            });
        },
    );
});
