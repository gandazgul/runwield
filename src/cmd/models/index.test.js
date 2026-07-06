import { assertEquals } from "@std/assert";
import { runModelsCommand } from "./index.js";

function makeUi() {
    /** @type {string[]} */
    const messages = [];
    /** @type {Array<string | null>} */
    const selections = [];

    const editor = /** @type {import('../../ui/tui/types.js').EditorAPI} */ ({
        disableSubmit: true,
        setText: () => {},
        setAutocompleteProvider: () => {},
        handleInput: () => {},
    });

    const uiAPI = /** @type {import('../../ui/tui/types.js').UiAPI} */ ({
        appendSystemMessage: (msg) => messages.push(String(msg)),
        appendAgentMessageStart: () => ({ appendText: () => {} }),
        requestRender: () => {},
        promptSelect: () => Promise.resolve(selections.shift() ?? null),
        promptText: () => Promise.resolve(null),
        showModelSelector: () => {
            // For tests, we mimic the promptSelect behavior when showModelSelector is called
            // but since runModelsCommand now uses showModelSelector, we need to handle it.
            // Actually, runModelsCommand only calls showModelSelector() and then returns.
            // The tests currently rely on promptSelect.
        },
    });

    return { messages, selections, uiAPI, editor };
}

Deno.test("runModelsCommand rejects bare model id in ui mode", async () => {
    /** @type {string[]} */
    const messages = [];
    await runModelsCommand(
        ["gpt-4.1"],
        /** @type {any} */ ({
            uiAPI: {
                appendSystemMessage: (/** @type {string} */ msg) => {
                    messages.push(msg);
                },
                appendAgentMessageStart: () => ({ appendText: () => {} }),
                requestRender: () => {},
                promptSelect: () => Promise.resolve(null),
                promptText: () => Promise.resolve(null),
                showModelSelector: () => {},
            },
            __testDeps: {
                getModelRegistry: () => ({
                    find: () => null,
                    getAvailable: () => [],
                }),
            },
        }),
    );

    assertEquals(messages.length, 1);
    assertEquals(messages[0], "Invalid model format. Use /model to switch.");
});

Deno.test("runModelsCommand tui with no available models", async () => {
    const { messages, uiAPI, editor } = makeUi();

    await runModelsCommand(
        [],
        /** @type {any} */ ({
            uiAPI,
            editor,
            __testDeps: /** @type {any} */ ({
                getModelRegistry: () => ({
                    getAvailable: () => [],
                    find: () => null,
                }),
            }),
        }),
    );

    assertEquals(messages[0], "No models available.");
});

Deno.test("runModelsCommand tui canceled selection", async () => {
    const { messages, uiAPI, editor } = makeUi();

    await runModelsCommand(
        [],
        /** @type {any} */ ({
            uiAPI,
            editor,
            __testDeps: /** @type {any} */ ({
                getModelRegistry: () => ({
                    getAvailable: () => [{ provider: "test", id: "model-a", name: "Model A" }],
                    find: () => null,
                }),
            }),
        }),
    );

    assertEquals(messages.length, 0);
});

Deno.test("runModelsCommand tui unknown selected model", async () => {
    const { messages, selections, uiAPI, editor } = makeUi();
    selections.push("test/model-b");

    await runModelsCommand(
        [],
        /** @type {any} */ ({
            uiAPI,
            editor,
            __testDeps: /** @type {any} */ ({
                getModelRegistry: () => ({
                    getAvailable: () => [{ provider: "test", id: "model-a", name: "Model A" }],
                    find: () => null,
                }),
            }),
        }),
    );

    assertEquals(messages.some((m) => m.includes("Unknown model: test/model-b.")), true);
});

Deno.test("runModelsCommand tui select and switch", async () => {
    const { messages, selections, uiAPI, editor } = makeUi();
    selections.push("test/model-a");
    let switched = "";

    await runModelsCommand(
        [],
        /** @type {any} */ ({
            uiAPI,
            editor,
            __testDeps: /** @type {any} */ ({
                getModelRegistry: () => ({
                    getAvailable: () => [{ provider: "test", id: "model-a", name: "Model A" }],
                    find: () => ({ provider: "test", id: "model-a" }),
                }),
                setActiveModel: (/** @type {string} */ id, /** @type {string} */ provider) => {
                    switched = `${provider}/${id}`;
                },
            }),
        }),
    );

    assertEquals(switched, "test/model-a");
    assertEquals(messages.some((m) => m.includes("Switched model to test/model-a")), true);
});

Deno.test("runModelsCommand cli usage when no arg", async () => {
    /** @type {string[]} */
    const logs = [];
    const orig = console.log;
    console.log = (msg) => logs.push(String(msg));
    try {
        await runModelsCommand(
            [],
            /** @type {any} */ ({
                __testDeps: {
                    getModelRegistry: () => ({
                        find: () => null,
                        getAvailable: () => [],
                    }),
                },
            }),
        );
    } finally {
        console.log = orig;
    }

    assertEquals(logs.some((m) => m.includes("Usage: wld model")), true);
});

Deno.test("runModelsCommand unknown model in cli", async () => {
    /** @type {string[]} */
    const logs = [];
    const orig = console.log;
    console.log = (msg) => logs.push(String(msg));
    try {
        await runModelsCommand(
            ["test/does-not-exist"],
            /** @type {any} */ ({
                __testDeps: /** @type {any} */ ({
                    parseProviderModel: () => ({ ok: true, provider: "test", id: "does-not-exist" }),
                    getModelRegistry: () => ({
                        find: () => null,
                        getAvailable: () => [],
                    }),
                }),
            }),
        );
    } finally {
        console.log = orig;
    }

    assertEquals(logs.some((m) => m.includes("Unknown model: test/does-not-exist")), true);
});
