import { assertEquals } from "@std/assert";
import { runSettingsCommand } from "./index.js";
import { HostedSession } from "../../shared/session/hosted-session.js";
import { initRunWieldTheme } from "../../ui/theme/theme.js";

initRunWieldTheme();

/**
 * @param {{ selections?: Array<string | null>, textInputs?: Array<string | null> }} [opts]
 */
function makeHarness(opts = {}) {
    const selections = [...(opts.selections || [])];
    const textInputs = [...(opts.textInputs || [])];
    /** @type {string[]} */
    const messages = [];
    /** @type {Array<{ title: string, options: Array<{ value: string, label: string, description?: string }> }>} */
    const prompts = [];
    const editor = { disableSubmit: true, text: "", setText: (/** @type {string} */ text) => editor.text = text };
    return {
        messages,
        prompts,
        editor,
        uiAPI: {
            appendSystemMessage: (/** @type {string} */ message) => messages.push(message),
            promptSelect: (/** @type {string} */ title, /** @type {any[]} */ options) => {
                prompts.push({ title, options });
                return Promise.resolve(selections.shift() ?? null);
            },
            promptText: () => Promise.resolve(textInputs.shift() ?? null),
            requestRender: () => {},
        },
    };
}

function makeSettingsManager() {
    const settings = { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 };
    return {
        settings,
        manager: {
            getCompactionSettings: () => ({ ...settings }),
            setCompactionEnabled: (/** @type {boolean} */ enabled) => {
                settings.enabled = enabled;
            },
            flush: () => Promise.resolve(),
            reload: () => Promise.resolve(),
            getProjectSettings: () => ({}),
        },
    };
}

Deno.test("runSettingsCommand reports missing interactive prompts", async () => {
    /** @type {string[]} */
    const errors = [];
    const originalError = console.error;
    console.error = (/** @type {unknown} */ message) => errors.push(String(message));
    try {
        await runSettingsCommand([], {});
    } finally {
        console.error = originalError;
    }

    assertEquals(errors, ["The /settings command is only available inside an interactive session."]);
});

Deno.test("runSettingsCommand exits quietly when the main menu is cancelled", async () => {
    const harness = makeHarness({ selections: [null] });
    const { manager } = makeSettingsManager();

    await runSettingsCommand([], {
        uiAPI: /** @type {any} */ (harness.uiAPI),
        editor: /** @type {any} */ (harness.editor),
        __testDeps: {
            getSettingsManager: () => manager,
            getRootAgentSession: () => null,
        },
    });

    assertEquals(harness.messages, []);
    assertEquals(harness.editor.disableSubmit, false);
});

Deno.test("runSettingsCommand reads the active session from the supplied HostedSession", async () => {
    const harness = makeHarness({ selections: ["compaction", "summary", "back", "done"] });
    const { manager } = makeSettingsManager();
    const hostedSession = new HostedSession({ id: "settings-command-hosted", cwd: Deno.cwd() });
    hostedSession.setRootAgentSession(
        /** @type {any} */ ({
            getContextUsage: () => ({ tokens: 64000, contextWindow: 128000, percent: 50 }),
        }),
    );

    await runSettingsCommand([], {
        uiAPI: /** @type {any} */ (harness.uiAPI),
        hostedSession,
        __testDeps: {
            getSettingsManager: () => manager,
        },
    });

    assertEquals(harness.messages.join("\n").includes("64,000/128,000 tokens (50.0%)"), true);
});

Deno.test("runSettingsCommand toggles auto-compaction on the active session", async () => {
    const harness = makeHarness({ selections: ["compaction", "toggle", "back", "done"] });
    const { settings, manager } = makeSettingsManager();
    const session = {
        settingsManager: manager,
        setAutoCompactionEnabled: (/** @type {boolean} */ enabled) => {
            settings.enabled = enabled;
        },
        getContextUsage: () => ({ tokens: 50000, contextWindow: 128000, percent: 39.0625 }),
    };

    await runSettingsCommand([], {
        uiAPI: /** @type {any} */ (harness.uiAPI),
        editor: /** @type {any} */ (harness.editor),
        __testDeps: {
            getSettingsManager: () => manager,
            getRootAgentSession: () => session,
        },
    });

    assertEquals(settings.enabled, false);
    assertEquals(harness.messages.includes("Auto-compact disabled."), true);
    assertEquals(harness.editor.disableSubmit, false);
});

Deno.test("runSettingsCommand edits numeric compaction settings", async () => {
    const harness = makeHarness({
        selections: ["compaction", "reserve", "keep-recent", "back", "done"],
        textInputs: ["12000", "34000"],
    });
    const { settings, manager } = makeSettingsManager();

    await runSettingsCommand([], {
        uiAPI: /** @type {any} */ (harness.uiAPI),
        editor: /** @type {any} */ (harness.editor),
        __testDeps: {
            getSettingsManager: () => manager,
            getRootAgentSession: () => null,
            setCompactionReserveTokens: (/** @type {number} */ value) => {
                settings.reserveTokens = value;
                return Promise.resolve();
            },
            setCompactionKeepRecentTokens: (/** @type {number} */ value) => {
                settings.keepRecentTokens = value;
                return Promise.resolve();
            },
        },
    });

    assertEquals(settings.reserveTokens, 12000);
    assertEquals(settings.keepRecentTokens, 34000);
    assertEquals(harness.messages.includes("Reserve tokens set to 12,000."), true);
    assertEquals(harness.messages.includes("Keep recent tokens set to 34,000."), true);
});

Deno.test("runSettingsCommand rejects invalid numeric input", async () => {
    const harness = makeHarness({ selections: ["compaction", "reserve", "back", "done"], textInputs: ["nope"] });
    const { settings, manager } = makeSettingsManager();
    let setterCalled = false;

    await runSettingsCommand([], {
        uiAPI: /** @type {any} */ (harness.uiAPI),
        __testDeps: {
            getSettingsManager: () => manager,
            getRootAgentSession: () => null,
            setCompactionReserveTokens: () => {
                setterCalled = true;
                return Promise.resolve();
            },
        },
    });

    assertEquals(settings.reserveTokens, 16384);
    assertEquals(setterCalled, false);
    assertEquals(harness.messages, ["Reserve tokens must be a positive integer."]);
});

Deno.test("runSettingsCommand prints behavior summary", async () => {
    const harness = makeHarness({ selections: ["compaction", "summary", "back", "done"] });
    const { manager } = makeSettingsManager();

    await runSettingsCommand([], {
        uiAPI: /** @type {any} */ (harness.uiAPI),
        __testDeps: {
            getSettingsManager: () => manager,
            getRootAgentSession: () => ({
                getContextUsage: () => ({ tokens: 100000, contextWindow: 128000, percent: 78.125 }),
            }),
        },
    });

    const plain = harness.messages.join("\n");
    assertEquals(plain.includes("Compaction behavior"), true);
    assertEquals(plain.includes("111,616 / 128,000 tokens"), true);
    assertEquals(plain.includes("100,000/128,000 tokens (78.1%)"), true);
});
