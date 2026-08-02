import { assertEquals, assertStringIncludes } from "@std/assert";
import { withRuntimeCommandFixture } from "../testing/runtime-command-fixture.ts";
import { runModelsCommand } from "./index.ts";

const FIXTURE_MODEL = "runtime-command-fixture/fixture-model";

interface ModelSelectItem {
    value: string;
    label: string;
}

interface ModelsUiFixture {
    editor: {
        disableSubmit: boolean;
        setText(text: string): void;
    };
    messages: string[];
    uiAPI: {
        appendSystemMessage(message: string): void;
        promptSelect(title: string, options: ModelSelectItem[]): Promise<string | null>;
        showModelSelector?: () => Promise<void> | void;
    };
}

function makeUi(selection: string | null = null): ModelsUiFixture {
    const messages: string[] = [];
    return {
        messages,
        editor: {
            disableSubmit: true,
            setText: () => {},
        },
        uiAPI: {
            appendSystemMessage: (message) => messages.push(message),
            promptSelect: (_title, options) => {
                if (selection && !options.some((option) => option.value === selection)) {
                    throw new Error(`Fixture model was not offered: ${selection}`);
                }
                return Promise.resolve(selection);
            },
        },
    };
}

async function captureLogs(run: () => Promise<void>): Promise<string[]> {
    const originalLog = console.log;
    const logs: string[] = [];
    console.log = (message = "") => logs.push(String(message));
    try {
        await run();
    } finally {
        console.log = originalLog;
    }
    return logs;
}

Deno.test("runModelsCommand switches an explicit configured model through the real registry", async () => {
    await withRuntimeCommandFixture("runwield-model-command-", async () => {
        const ui = makeUi();
        let activeModel = "";

        await runModelsCommand([FIXTURE_MODEL], {
            uiAPI: ui.uiAPI,
            setActiveModel: (model, provider) => {
                activeModel = `${provider}/${model}`;
            },
        });

        assertEquals(activeModel, FIXTURE_MODEL);
        assertEquals(ui.messages, [`Switched model to ${FIXTURE_MODEL}`]);
    });
});

Deno.test("runModelsCommand fallback selector lists and switches real configured models", async () => {
    await withRuntimeCommandFixture("runwield-model-command-", async () => {
        const ui = makeUi(FIXTURE_MODEL);
        let activeModel = "";

        await runModelsCommand([], {
            uiAPI: ui.uiAPI,
            editor: ui.editor,
            setActiveModel: (model, provider) => {
                activeModel = `${provider}/${model}`;
            },
        });

        assertEquals(activeModel, FIXTURE_MODEL);
        assertEquals(ui.messages, [`Switched model to ${FIXTURE_MODEL}`]);
        assertEquals(ui.editor.disableSubmit, false);
    });
});

Deno.test("runModelsCommand delegates the interactive picker and restores the editor", async () => {
    await withRuntimeCommandFixture("runwield-model-command-", async () => {
        const ui = makeUi();
        let selectorShown = false;
        ui.uiAPI.showModelSelector = () => {
            selectorShown = true;
        };

        await runModelsCommand([], { uiAPI: ui.uiAPI, editor: ui.editor });

        assertEquals(selectorShown, true);
        assertEquals(ui.editor.disableSubmit, false);
    });
});

Deno.test("runModelsCommand validates and resolves model references with real machinery", async () => {
    await withRuntimeCommandFixture("runwield-model-command-", async () => {
        const ui = makeUi();

        await runModelsCommand(["fixture-model"], { uiAPI: ui.uiAPI });
        await runModelsCommand(["runtime-command-fixture/missing"], { uiAPI: ui.uiAPI });

        assertEquals(ui.messages, [
            "Invalid model format. Use /model to switch.",
            "Unknown model: runtime-command-fixture/missing. Use /model to switch.",
        ]);
    });
});

Deno.test("runModelsCommand reports CLI usage without reading user configuration", async () => {
    await withRuntimeCommandFixture("runwield-model-command-", async () => {
        const logs = await captureLogs(() => runModelsCommand([]));
        assertEquals(logs.length, 1);
        assertStringIncludes(logs[0], "Usage: wld model");
    });
});
