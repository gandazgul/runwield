import { assertEquals } from "@std/assert";
import { Spacer } from "@earendil-works/pi-tui";
import { installUiApiOverrides } from "./ui-api-overrides.js";

class FakeImage {
    /**
     * @param {string} base64
     * @param {string} mimeType
     * @param {unknown} theme
     * @param {unknown} opts
     */
    constructor(base64, mimeType, theme, opts) {
        this.base64 = base64;
        this.mimeType = mimeType;
        this.theme = theme;
        this.opts = opts;
    }
}

class FakeModelSelector {
    /**
     * @param {unknown} tui
     * @param {unknown} currentModel
     * @param {unknown} settingsManager
     * @param {unknown} modelRegistry
     * @param {unknown[]} scopedModels
     * @param {(model: { id: string, provider: string }) => void} onSelect
     * @param {() => void} onCancel
     */
    constructor(tui, currentModel, settingsManager, modelRegistry, scopedModels, onSelect, onCancel) {
        this.tui = tui;
        this.currentModel = currentModel;
        this.settingsManager = settingsManager;
        this.modelRegistry = modelRegistry;
        this.scopedModels = scopedModels;
        this.onSelect = onSelect;
        this.onCancel = onCancel;
    }
}

/**
 * @returns {any}
 */
function makeHarness() {
    const editor = { disableSubmit: true, name: "editor" };
    let focus = /** @type {unknown} */ (null);
    let renders = 0;
    /** @type {Array<{ id: string, provider: string }>} */
    const selectedModels = [];
    const container = {
        children: /** @type {unknown[]} */ ([editor]),
        /** @param {unknown} child */
        addChild(child) {
            this.children.push(child);
        },
    };
    const messageList = {
        children: /** @type {unknown[]} */ ([]),
        /** @param {unknown} child */
        addChild(child) {
            this.children.push(child);
        },
    };
    const uiAPI = {
        isOutputSuppressed: () => false,
    };
    const registry = {
        find: (/** @type {string} */ provider, /** @type {string} */ id) => ({ provider, id }),
    };
    const settingsManager = { id: "settings" };
    return {
        editor,
        container,
        messageList,
        uiAPI,
        selectedModels,
        registry,
        settingsManager,
        tui: {
            requestRender: () => {
                renders++;
            },
            setFocus: (/** @type {unknown} */ target) => {
                focus = target;
            },
        },
        deps: {
            Image: FakeImage,
            ModelSelectorComponent: FakeModelSelector,
            getModelRegistry: () => registry,
            getSettingsManager: () => settingsManager,
            getActiveModelState: () => ({ provider: "current", model: "model" }),
        },
        setActiveModel: (/** @type {string} */ id, /** @type {string} */ provider) => {
            selectedModels.push({ id, provider });
        },
        stats: {
            get focus() {
                return focus;
            },
            get renders() {
                return renders;
            },
        },
    };
}

Deno.test("installUiApiOverrides disables and enables editor submission", () => {
    const harness = makeHarness();
    harness.editor.disableSubmit = false;
    installUiApiOverrides({ ...harness, __deps: harness.deps });

    harness.uiAPI.disableInput();
    assertEquals(harness.editor.disableSubmit, true);

    harness.uiAPI.enableInput();
    assertEquals(harness.editor.disableSubmit, false);
    assertEquals(harness.stats.renders, 2);
});

Deno.test("installUiApiOverrides appends images unless output is suppressed", () => {
    const harness = makeHarness();
    installUiApiOverrides({ ...harness, __deps: harness.deps });

    harness.uiAPI.appendImage("abc", "image/png");
    assertEquals(harness.messageList.children.length, 2);
    assertEquals(harness.messageList.children[0] instanceof FakeImage, true);
    assertEquals(harness.messageList.children[1] instanceof Spacer, true);
    assertEquals(harness.stats.renders, 1);

    harness.uiAPI.isOutputSuppressed = () => true;
    harness.uiAPI.appendImage("hidden", "image/png");
    assertEquals(harness.messageList.children.length, 2);
});

Deno.test("installUiApiOverrides replaces editor with selector and restores after model select", async () => {
    const harness = makeHarness();
    installUiApiOverrides({ ...harness, __deps: harness.deps });

    const promise = harness.uiAPI.showModelSelector();
    const selector = harness.container.children[0];
    assertEquals(selector instanceof FakeModelSelector, true);
    assertEquals(harness.stats.focus, selector);
    assertEquals(selector.currentModel, { provider: "current", id: "model" });
    assertEquals(selector.settingsManager, harness.settingsManager);
    assertEquals(selector.modelRegistry, harness.registry);

    selector.onSelect({ id: "next", provider: "test" });
    await promise;

    assertEquals(harness.selectedModels, [{ id: "next", provider: "test" }]);
    assertEquals(harness.container.children, [harness.editor]);
    assertEquals(harness.stats.focus, harness.editor);
});

Deno.test("installUiApiOverrides restores editor after selector cancel even when editor was absent", async () => {
    const harness = makeHarness();
    harness.container.children = [];
    installUiApiOverrides({ ...harness, __deps: harness.deps });

    const promise = harness.uiAPI.showModelSelector();
    const selector = harness.container.children[0];
    selector.onCancel();
    await promise;
    selector.onCancel();

    assertEquals(harness.container.children, [harness.editor]);
    assertEquals(harness.selectedModels, []);
});
