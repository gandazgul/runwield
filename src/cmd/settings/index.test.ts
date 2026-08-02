import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { SessionRuntime } from "../../shared/session/session-runtime.js";
import { getSettingsManager } from "../../shared/settings.js";
import { withRuntimeCommandFixture } from "../testing/runtime-command-fixture.ts";
import { runSettingsCommand } from "./index.ts";

interface SelectItem {
    value: string;
    label: string;
    description?: string;
}

interface TextOptions {
    defaultValue: string;
    placeholder: string;
    allowEmpty: boolean;
}

interface SettingsUiHarness {
    editor: {
        disableSubmit: boolean;
        text: string;
        setText(text: string): void;
    };
    messages: string[];
    uiAPI: {
        appendSystemMessage(message: string): void;
        promptSelect(title: string, options: SelectItem[]): Promise<string | null>;
        promptText(title: string, options: TextOptions): Promise<string | null>;
        requestRender(): void;
    };
}

function makeUiHarness(
    selections: Array<string | null> = [],
    textInputs: Array<string | null> = [],
): SettingsUiHarness {
    const pendingSelections = [...selections];
    const pendingTextInputs = [...textInputs];
    const messages: string[] = [];
    const editor = {
        disableSubmit: true,
        text: "draft",
        setText(text: string) {
            editor.text = text;
        },
    };
    return {
        editor,
        messages,
        uiAPI: {
            appendSystemMessage: (message) => messages.push(message),
            promptSelect: () => Promise.resolve(pendingSelections.shift() ?? null),
            promptText: () => Promise.resolve(pendingTextInputs.shift() ?? null),
            requestRender: () => {},
        },
    };
}

async function createPromptReadyRuntime(projectRoot: string): Promise<{ runtime: SessionRuntime; sessionId: string }> {
    const runtime = new SessionRuntime();
    const sessionId = await runtime.createPromptReadySession({ cwd: projectRoot, agentName: "router" });
    return { runtime, sessionId };
}

async function captureConsole(run: () => Promise<void>): Promise<{ logs: string[]; errors: string[] }> {
    const originalLog = console.log;
    const originalError = console.error;
    const logs: string[] = [];
    const errors: string[] = [];
    console.log = (message = "") => logs.push(String(message));
    console.error = (message = "") => errors.push(String(message));
    try {
        await run();
    } finally {
        console.log = originalLog;
        console.error = originalError;
    }
    return { logs, errors };
}

Deno.test("runSettingsCommand prints real command help", async () => {
    await withRuntimeCommandFixture("runwield-settings-command-", async () => {
        const output = await captureConsole(() => runSettingsCommand(["help"]));

        assertEquals(output.errors, []);
        assertEquals(output.logs.length, 1);
        assertStringIncludes(output.logs[0], "Usage (settings):");
    });
});

Deno.test("runSettingsCommand exits a cancelled menu and restores the real editor surface", async () => {
    await withRuntimeCommandFixture("runwield-settings-command-", async ({ projectRoot }) => {
        const { runtime, sessionId } = await createPromptReadyRuntime(projectRoot);
        const harness = makeUiHarness([null]);
        try {
            await runSettingsCommand([], {
                uiAPI: harness.uiAPI,
                editor: harness.editor,
                sessionRuntime: runtime,
                sessionId,
            });

            assertEquals(harness.messages, []);
            assertEquals(harness.editor.text, "");
            assertEquals(harness.editor.disableSubmit, false);
        } finally {
            runtime.closeAllSessions();
        }
    });
});

Deno.test("runSettingsCommand persists numeric compaction settings in the fixture home", async () => {
    await withRuntimeCommandFixture(
        "runwield-settings-command-",
        async ({ projectRoot, settingsPath }) => {
            const { runtime, sessionId } = await createPromptReadyRuntime(projectRoot);
            const harness = makeUiHarness(
                ["compaction", "reserve", "keep-recent", "back", "done"],
                ["12,000", "34000"],
            );
            try {
                await runSettingsCommand([], {
                    uiAPI: harness.uiAPI,
                    editor: harness.editor,
                    sessionRuntime: runtime,
                    sessionId,
                });

                const settings = getSettingsManager(projectRoot).getCompactionSettings();
                assertEquals(settings.reserveTokens, 12000);
                assertEquals(settings.keepRecentTokens, 34000);
                assert(harness.messages.includes("Reserve tokens set to 12,000."));
                assert(harness.messages.includes("Keep recent tokens set to 34,000."));
                const persisted = await Deno.readTextFile(settingsPath);
                assertStringIncludes(persisted, '"reserveTokens": 12000');
                assertStringIncludes(persisted, '"keepRecentTokens": 34000');
            } finally {
                runtime.closeAllSessions();
            }
        },
    );
});

Deno.test("runSettingsCommand toggles auto-compaction through the real Runtime session", async () => {
    await withRuntimeCommandFixture("runwield-settings-command-", async ({ projectRoot, settingsPath }) => {
        const { runtime, sessionId } = await createPromptReadyRuntime(projectRoot);
        const before = runtime.getSessionSnapshot(sessionId)?.autoCompactionEnabled;
        const harness = makeUiHarness(["compaction", "toggle", "back", "done"]);
        try {
            await runSettingsCommand([], {
                uiAPI: harness.uiAPI,
                editor: harness.editor,
                sessionRuntime: runtime,
                sessionId,
            });

            assertEquals(runtime.getSessionSnapshot(sessionId)?.autoCompactionEnabled, !before);
            assert(harness.messages.includes(`Auto-compact ${!before ? "enabled" : "disabled"}.`));
            assertStringIncludes(await Deno.readTextFile(settingsPath), `"enabled": ${String(!before)}`);
        } finally {
            runtime.closeAllSessions();
        }
    });
});

Deno.test("runSettingsCommand reports real compaction behavior", async () => {
    await withRuntimeCommandFixture("runwield-settings-command-", async ({ projectRoot }) => {
        const { runtime, sessionId } = await createPromptReadyRuntime(projectRoot);
        const settings = getSettingsManager(projectRoot).getCompactionSettings();
        const harness = makeUiHarness(["compaction", "summary", "back", "done"]);
        try {
            await runSettingsCommand([], {
                uiAPI: harness.uiAPI,
                sessionRuntime: runtime,
                sessionId,
            });

            const summary = harness.messages.join("\n");
            assertStringIncludes(summary, "Compaction behavior");
            assertStringIncludes(summary, "Reserve tokens:");
            assertStringIncludes(summary, settings.reserveTokens.toLocaleString());
            assertStringIncludes(summary, "Keep recent tokens:");
            assertStringIncludes(summary, settings.keepRecentTokens.toLocaleString());
        } finally {
            runtime.closeAllSessions();
        }
    });
});

Deno.test("runSettingsCommand rejects invalid numeric input without changing persisted settings", async () => {
    await withRuntimeCommandFixture("runwield-settings-command-", async ({ projectRoot, settingsPath }) => {
        const { runtime, sessionId } = await createPromptReadyRuntime(projectRoot);
        const before = getSettingsManager(projectRoot).getCompactionSettings().reserveTokens;
        const persistedBefore = await Deno.readTextFile(settingsPath);
        const harness = makeUiHarness(["compaction", "reserve", "back", "done"], ["nope"]);
        try {
            await runSettingsCommand([], {
                uiAPI: harness.uiAPI,
                sessionRuntime: runtime,
                sessionId,
            });

            assertEquals(harness.messages, ["Reserve tokens must be a positive integer."]);
            assertEquals(getSettingsManager(projectRoot).getCompactionSettings().reserveTokens, before);
            assertEquals(await Deno.readTextFile(settingsPath), persistedBefore);
        } finally {
            runtime.closeAllSessions();
        }
    });
});

Deno.test("runSettingsCommand reports unavailable interactive state", async () => {
    await withRuntimeCommandFixture("runwield-settings-command-", async () => {
        const output = await captureConsole(() => runSettingsCommand([]));
        assertEquals(output.errors, ["The /settings command is only available inside an interactive session."]);

        const harness = makeUiHarness();
        await assertRejects(
            () => runSettingsCommand([], { uiAPI: harness.uiAPI }),
            Error,
            "Settings require an active runtime session.",
        );
    });
});
