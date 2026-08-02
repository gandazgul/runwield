import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { assertEquals, assertStringIncludes } from "@std/assert";
import { SessionRuntime } from "../../shared/session/session-runtime.js";
import { getRunWieldSessionDir } from "../../shared/session/root-session.js";
import { __resetSettingsForTests } from "../../shared/settings.js";
import { withRuntimeCommandFixture } from "../testing/runtime-command-fixture.ts";
import { runResumeCommand } from "./index.ts";

const FIXTURE_PROVIDER = "runtime-command-fixture";
const FIXTURE_MODEL = "fixture-model";

interface ResumeSelectItem {
    value: string;
    label: string;
    description?: string;
}

interface SeededSession {
    id: string;
    path: string;
}

interface ResumeUiFixture {
    clears: number;
    editor: {
        disableSubmit: boolean;
        setText(text: string): void;
    };
    messages: string[];
    prompts: string[];
    uiAPI: {
        appendSystemMessage(message: string): void;
        clearMessages(): void;
        promptSelect(title: string, options: ResumeSelectItem[]): Promise<string | null>;
    };
}

function makeUi(selections: string[]): ResumeUiFixture {
    const fixture: ResumeUiFixture = {
        clears: 0,
        messages: [],
        prompts: [],
        editor: {
            disableSubmit: true,
            setText: () => {},
        },
        uiAPI: {
            appendSystemMessage: (message) => fixture.messages.push(message),
            clearMessages: () => fixture.clears += 1,
            promptSelect: (title, options) => {
                fixture.prompts.push(title);
                const selection = selections.shift() ?? null;
                if (selection && !options.some((option) => option.value === selection)) {
                    throw new Error(`Fixture selection was not offered: ${selection}`);
                }
                return Promise.resolve(selection);
            },
        },
    };
    return fixture;
}

function userMessage(text: string) {
    return {
        role: "user" as const,
        timestamp: Date.now(),
        content: [{ type: "text" as const, text }],
    };
}

function seedPersistedSession(projectRoot: string, content = "continue the fixture work"): SeededSession {
    const id = crypto.randomUUID();
    const manager = SessionManager.create(projectRoot, getRunWieldSessionDir(projectRoot), { id });
    manager.appendModelChange(FIXTURE_PROVIDER, FIXTURE_MODEL);
    manager.appendCustomEntry("runwield.active_agent", { agentName: "Router" });
    const chunks = content.match(/[\s\S]{1,12000}/g) || [content];
    for (const chunk of chunks) {
        manager.appendMessage(userMessage(chunk));
        manager.appendMessage(fauxAssistantMessage(fauxText("fixture response")));
    }
    const path = manager.getSessionFile();
    if (!path) throw new Error("Fixture session was not persisted");
    return { id, path };
}

async function writeResumeThreshold(settingsPath: string, threshold: number): Promise<void> {
    const settings = JSON.parse(await Deno.readTextFile(settingsPath));
    settings.compactOnResumeThresholdPercent = threshold;
    await Deno.writeTextFile(settingsPath, JSON.stringify(settings));
    __resetSettingsForTests();
}

Deno.test("runResumeCommand loads, replaces, and replays a real persisted session", async () => {
    await withRuntimeCommandFixture("runwield-resume-command-", async ({ projectRoot }) => {
        const seeded = seedPersistedSession(projectRoot);
        const runtime = new SessionRuntime();
        const current = await runtime.createInteractiveSession({ cwd: projectRoot, mode: "new" });
        const ui = makeUi([seeded.path]);
        let replacementId = "";
        try {
            await runResumeCommand([], {
                uiAPI: ui.uiAPI,
                editor: ui.editor,
                sessionId: current.sessionId,
                sessionRuntime: runtime,
                replaceRuntimeSession: (sessionId) => replacementId = sessionId,
            });

            assertEquals(runtime.getSessionSnapshot(replacementId)?.sessionManagerId, seeded.id);
            assertEquals(runtime.getRuntimeActiveAgentName(replacementId), "Router");
            assertEquals(ui.clears, 1);
            assertEquals(ui.messages, [`Resumed session: ${seeded.id}`]);
        } finally {
            runtime.closeAllSessions();
        }
    });
});

Deno.test("runResumeCommand offers compaction from real transcript size and fixture settings", async () => {
    await withRuntimeCommandFixture(
        "runwield-resume-command-",
        async ({ projectRoot, settingsPath }) => {
            await writeResumeThreshold(settingsPath, 1);
            const seeded = seedPersistedSession(projectRoot, "large fixture context ".repeat(2000));
            const runtime = new SessionRuntime();
            const current = await runtime.createInteractiveSession({ cwd: projectRoot, mode: "new" });
            const ui = makeUi([seeded.path, "cancel"]);
            let replacementId = "";
            try {
                await runResumeCommand([], {
                    uiAPI: ui.uiAPI,
                    editor: ui.editor,
                    sessionId: current.sessionId,
                    sessionRuntime: runtime,
                    replaceRuntimeSession: (sessionId) => replacementId = sessionId,
                });

                assertEquals(ui.prompts, [
                    "Select a session to resume:",
                    "Session is large — how would you like to resume?",
                ]);
                assertEquals(replacementId, "");
                assertEquals(ui.editor.disableSubmit, false);
            } finally {
                runtime.closeAllSessions();
            }
        },
    );
});

Deno.test("runResumeCommand compacts a real loaded session through the faux model boundary", async () => {
    await withRuntimeCommandFixture(
        "runwield-resume-command-",
        async ({ projectRoot, setModelResponse, settingsPath }) => {
            await writeResumeThreshold(settingsPath, 1);
            setModelResponse("Summary of the fixture session.");
            const seeded = seedPersistedSession(projectRoot, "compaction fixture context ".repeat(24000));
            const runtime = new SessionRuntime();
            const current = await runtime.createInteractiveSession({ cwd: projectRoot, mode: "new" });
            const ui = makeUi([seeded.path, "compact"]);
            let replacementId = "";
            try {
                await runResumeCommand([], {
                    uiAPI: ui.uiAPI,
                    editor: ui.editor,
                    sessionId: current.sessionId,
                    sessionRuntime: runtime,
                    replaceRuntimeSession: (sessionId) => replacementId = sessionId,
                });

                assertEquals(runtime.getSessionSnapshot(replacementId)?.sessionManagerId, seeded.id);
                assertEquals(ui.messages[0], "Compacting session before resume... (Esc to cancel)");
                assertStringIncludes(ui.messages.at(-1) || "", `Resumed (compacted) session: ${seeded.id}`);
            } finally {
                runtime.closeAllSessions();
            }
        },
    );
});
