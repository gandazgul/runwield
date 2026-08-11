import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { AGENTS } from "../../constants.js";
import { openOwnerCoordinationStore } from "../../shared/owner-coordination/index.js";
import { createSessionRuntime } from "../../shared/session/session-runtime.js";
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

interface ResumeSelectHooks {
    layout?: {
        maxPrimaryColumnWidth?: number;
        truncatePrimary?(context: { text: string; maxWidth: number }): string;
    };
}

interface SeededSession {
    id: string;
    path: string;
}

interface ResumeSelectOffer {
    title: string;
    options: ResumeSelectItem[];
    hooks?: ResumeSelectHooks;
}

interface ResumeUiFixture {
    clears: number;
    editor: {
        disableSubmit: boolean;
        setText(text: string): void;
    };
    messages: string[];
    prompts: string[];
    selectOffers: ResumeSelectOffer[];
    uiAPI: {
        appendSystemMessage(message: string): void;
        clearMessages(): void;
        promptSelect(
            title: string,
            options: ResumeSelectItem[],
            hooks?: ResumeSelectHooks,
        ): Promise<string | null>;
    };
}

function makeUi(selections: string[]): ResumeUiFixture {
    const fixture: ResumeUiFixture = {
        clears: 0,
        messages: [],
        prompts: [],
        selectOffers: [],
        editor: {
            disableSubmit: true,
            setText: () => {},
        },
        uiAPI: {
            appendSystemMessage: (message) => fixture.messages.push(message),
            clearMessages: () => fixture.clears += 1,
            promptSelect: (title, options, hooks) => {
                fixture.prompts.push(title);
                fixture.selectOffers.push({ title, options, hooks });
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
    await withRuntimeCommandFixture("runwield-resume-command-", async ({ homeDir, projectRoot }) => {
        const seeded = seedPersistedSession(projectRoot);
        const store = openOwnerCoordinationStore({ dbPath: `${homeDir}/owner.sqlite3` });
        const runtime = createSessionRuntime({ ownerCoordinationStore: store });
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
            assertEquals(runtime.getRuntimeActiveAgentName(replacementId), AGENTS.ROUTER);
            assertEquals(ui.clears, 1);
            assertEquals(ui.messages, [`Resumed session: ${seeded.id}`]);
        } finally {
            runtime.closeAllSessions();
            store.close();
        }
    });
});

Deno.test("runResumeCommand offers full session names with date-only descriptions", async () => {
    await withRuntimeCommandFixture("runwield-resume-command-", async ({ homeDir, projectRoot }) => {
        const longMessage = "inspect the workspace sidebar rendering path ".repeat(4).trim();
        const seeded = seedPersistedSession(projectRoot, longMessage);
        const store = openOwnerCoordinationStore({ dbPath: `${homeDir}/owner.sqlite3` });
        const runtime = createSessionRuntime({ ownerCoordinationStore: store });
        const current = await runtime.createInteractiveSession({ cwd: projectRoot, mode: "new" });
        const ui = makeUi([]);
        try {
            await runResumeCommand([], {
                uiAPI: ui.uiAPI,
                editor: ui.editor,
                sessionId: current.sessionId,
                sessionRuntime: runtime,
                replaceRuntimeSession: () => {},
            });

            const offer = ui.selectOffers[0];
            const item = offer?.options.find((option) => option.value === seeded.path);
            assertEquals(item?.label, longMessage);
            assert(!item?.description?.includes("Modified:"));
            assertStringIncludes(item?.description ?? "", "| Messages: 2");

            const layout = offer?.hooks?.layout;
            assertEquals(typeof layout?.maxPrimaryColumnWidth, "number");
            assert(layout?.truncatePrimary);
            assertEquals(layout.truncatePrimary({ text: "abcdefghij", maxWidth: 5 }), "abcd…");
        } finally {
            runtime.closeAllSessions();
            store.close();
        }
    });
});

Deno.test("runResumeCommand offers compaction from real transcript size and fixture settings", async () => {
    await withRuntimeCommandFixture(
        "runwield-resume-command-",
        async ({ homeDir, projectRoot, settingsPath }) => {
            await writeResumeThreshold(settingsPath, 1);
            const seeded = seedPersistedSession(projectRoot, "large fixture context ".repeat(2000));
            const store = openOwnerCoordinationStore({ dbPath: `${homeDir}/owner.sqlite3` });
            const runtime = createSessionRuntime({ ownerCoordinationStore: store });
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

                assertEquals(ui.prompts.length, 2);
                assertEquals(typeof replacementId, "string");
            } finally {
                runtime.closeAllSessions();
                store.close();
            }
        },
    );
});

Deno.test("runResumeCommand compacts a real loaded session through the faux model boundary", async () => {
    await withRuntimeCommandFixture(
        "runwield-resume-command-",
        async ({ homeDir, projectRoot, setModelResponse, settingsPath }) => {
            await writeResumeThreshold(settingsPath, 1);
            setModelResponse("Summary of the fixture session.");
            const seeded = seedPersistedSession(projectRoot, "compaction fixture context ".repeat(24000));
            const store = openOwnerCoordinationStore({ dbPath: `${homeDir}/owner.sqlite3` });
            const runtime = createSessionRuntime({ ownerCoordinationStore: store });
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
                assertStringIncludes(ui.messages.at(-1) || "", `Resumed (compacted) session: ${seeded.id}`);
            } finally {
                runtime.closeAllSessions();
                store.close();
            }
        },
    );
});
