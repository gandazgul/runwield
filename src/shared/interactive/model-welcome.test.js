import { assertEquals } from "@std/assert";
import { COMMAND_NAMES } from "../../cmd/registry.js";
import { initRunWieldTheme } from "../ui/theme.js";
import {
    detectModelAvailability,
    getConfiguredModelAvailability,
    getSelectedDefaultModelAvailability,
    maybeShowModelWelcome,
} from "./model-welcome.js";

/**
 * @param {Array<unknown>} available
 * @returns {{ getAvailable: () => Array<unknown>, find: (provider: string, id: string) => unknown }}
 */
function registryWithAvailable(available) {
    return {
        getAvailable: () => available,
        find: (provider, id) =>
            available.find((model) => {
                const item = /** @type {{ id?: string, provider?: string }} */ (model);
                return item.id === id && (!provider || item.provider === provider);
            }),
    };
}

/**
 * @param {string | null} selection
 * @param {boolean} [modelCommandSelectsDefault]
 */
function makeHarness(selection, modelCommandSelectsDefault = true) {
    /** @type {Array<string>} */
    const messages = [];
    /** @type {Array<{ name: string, argv: string[] }>} */
    const commands = [];
    let defaultModel = "";
    let defaultProvider = "";
    let rootBuilt = 0;
    let renders = 0;
    const editor = { disableSubmit: false, setText: () => {} };
    const tui = {
        requestRender: () => {
            renders++;
        },
        setFocus: () => {},
    };
    const uiAPI = {
        appendSystemMessage: (/** @type {string} */ message) => messages.push(message),
        promptSelect: () => Promise.resolve(selection),
    };
    const commandRegistry = {
        [COMMAND_NAMES.LOGIN]: {
            execute: (/** @type {string[]} */ argv) => {
                commands.push({ name: COMMAND_NAMES.LOGIN, argv });
                return Promise.resolve();
            },
        },
        [COMMAND_NAMES.MODEL]: {
            execute: (/** @type {string[]} */ argv) => {
                commands.push({ name: COMMAND_NAMES.MODEL, argv });
                if (modelCommandSelectsDefault) {
                    defaultModel = "model";
                    defaultProvider = "";
                }
                return Promise.resolve();
            },
        },
        [COMMAND_NAMES.QUIT]: {
            execute: (/** @type {string[]} */ argv) => {
                commands.push({ name: COMMAND_NAMES.QUIT, argv });
                return Promise.resolve();
            },
        },
    };

    return {
        messages,
        commands,
        editor,
        renders: () => renders,
        options: {
            uiAPI: /** @type {any} */ (uiAPI),
            editor: /** @type {any} */ (editor),
            tui: /** @type {any} */ (tui),
            sessionManager: /** @type {any} */ ({}),
            initialAgentInternalName: "router",
            commandRegistry: /** @type {any} */ (commandRegistry),
            getSettingsManager: () => ({
                getDefaultModel: () => defaultModel,
                getDefaultProvider: () => defaultProvider,
            }),
            ensureRootAgentSession: () => {
                rootBuilt++;
                return Promise.resolve();
            },
            hasModelWelcomeBeenShown: () => Promise.resolve(false),
            recordModelWelcomeShown: () => Promise.resolve(),
        },
        rootBuilt: () => rootBuilt,
    };
}

initRunWieldTheme();

Deno.test("detectModelAvailability treats at least one available model as usable", () => {
    assertEquals(detectModelAvailability(registryWithAvailable([])), { available: false, error: null });
    assertEquals(detectModelAvailability(registryWithAvailable([{ id: "model" }])), { available: true, error: null });
});

Deno.test("getConfiguredModelAvailability catches registry errors as no model", () => {
    const result = getConfiguredModelAvailability(() => {
        throw new Error("broken registry");
    });

    assertEquals(result, { available: false, error: "broken registry" });
});

Deno.test("getSelectedDefaultModelAvailability requires a persisted default model", () => {
    const result = getSelectedDefaultModelAvailability(
        () => registryWithAvailable([{ id: "model" }]),
        () => ({ getDefaultModel: () => "", getDefaultProvider: () => "" }),
    );

    assertEquals(result, { available: false, error: "No default model is selected." });
});

Deno.test("available models bypass the first-run welcome", async () => {
    const harness = makeHarness("subscription");
    const result = await maybeShowModelWelcome({
        ...harness.options,
        getModelRegistry: () => registryWithAvailable([{ id: "model" }]),
    });

    assertEquals(result, { shown: false, suppressBootBanner: false, noModel: false, setupCompleted: false });
    assertEquals(harness.commands, []);
    assertEquals(harness.editor.disableSubmit, false);
});

Deno.test("second no-model start does not suppress the boot banner", async () => {
    const harness = makeHarness("subscription");
    const result = await maybeShowModelWelcome({
        ...harness.options,
        getModelRegistry: () => registryWithAvailable([]),
        hasModelWelcomeBeenShown: () => Promise.resolve(true),
    });

    assertEquals(result, {
        shown: false,
        suppressBootBanner: false,
        noModel: true,
        setupCompleted: false,
        availabilityError: null,
    });
    assertEquals(harness.commands, []);
});

Deno.test("first no-model start records shown, suppresses the boot banner, and Esc quits", async () => {
    const harness = makeHarness(null);
    let recorded = 0;
    let quitCalled = 0;
    const result = await maybeShowModelWelcome({
        ...harness.options,
        getModelRegistry: () => registryWithAvailable([]),
        recordModelWelcomeShown: () => {
            recorded++;
            return Promise.resolve();
        },
        quit: () => {
            quitCalled++;
            return Promise.resolve();
        },
    });

    assertEquals(result, { shown: true, suppressBootBanner: true, noModel: true, setupCompleted: false });
    assertEquals(recorded, 1);
    assertEquals(quitCalled, 1);
    assertEquals(harness.commands, []);
    assertEquals(harness.editor.disableSubmit, true);
});

Deno.test("subscription setup runs login, opens model selection, and builds the root session", async () => {
    const harness = makeHarness("subscription");
    let availabilityChecks = 0;
    const result = await maybeShowModelWelcome({
        ...harness.options,
        getModelRegistry: () => registryWithAvailable(availabilityChecks++ === 0 ? [] : [{ id: "model" }]),
    });

    assertEquals(result, { shown: true, suppressBootBanner: true, noModel: false, setupCompleted: true });
    assertEquals(harness.commands, [
        { name: COMMAND_NAMES.LOGIN, argv: ["subscription"] },
        { name: COMMAND_NAMES.MODEL, argv: [] },
    ]);
    assertEquals(harness.rootBuilt(), 1);
    assertEquals(harness.editor.disableSubmit, false);
});

Deno.test("root initialization failure returns control to the editor for recovery", async () => {
    const harness = makeHarness("subscription");
    let availabilityChecks = 0;
    const result = await maybeShowModelWelcome({
        ...harness.options,
        getModelRegistry: () => registryWithAvailable(availabilityChecks++ === 0 ? [] : [{ id: "model" }]),
        ensureRootAgentSession: () => Promise.reject(new Error("boom")),
    });

    assertEquals(result.noModel, true);
    assertEquals(result.setupCompleted, false);
    assertEquals(harness.editor.disableSubmit, false);
});

Deno.test("API key setup dispatches the API key login command", async () => {
    const harness = makeHarness("api-key");
    let availabilityChecks = 0;
    await maybeShowModelWelcome({
        ...harness.options,
        getModelRegistry: () => registryWithAvailable(availabilityChecks++ === 0 ? [] : [{ id: "model" }]),
    });

    assertEquals(harness.commands[0], { name: COMMAND_NAMES.LOGIN, argv: ["api-key"] });
});

Deno.test("failed setup returns control to the editor so recovery slash commands can run", async () => {
    const harness = makeHarness("subscription");
    const result = await maybeShowModelWelcome({
        ...harness.options,
        getModelRegistry: () => registryWithAvailable([]),
    });

    assertEquals(result.noModel, true);
    assertEquals(result.suppressBootBanner, true);
    assertEquals(harness.editor.disableSubmit, false);
    assertEquals(harness.rootBuilt(), 0);
});

Deno.test("cancelled model selection does not build the root session without a selected default", async () => {
    const harness = makeHarness("subscription", false);
    let availabilityChecks = 0;
    const result = await maybeShowModelWelcome({
        ...harness.options,
        getModelRegistry: () => registryWithAvailable(availabilityChecks++ === 0 ? [] : [{ id: "model" }]),
    });

    assertEquals(result.noModel, true);
    assertEquals(result.setupCompleted, false);
    assertEquals(harness.editor.disableSubmit, false);
    assertEquals(harness.rootBuilt(), 0);
});
