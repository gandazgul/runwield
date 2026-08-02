/** Chat-session-specific input, model-selection, and pasted-image behavior. */

import { Image, Spacer } from "@earendil-works/pi-tui";
import type { Container, Editor, TUI } from "@earendil-works/pi-tui";
import { ModelSelectorComponent } from "@earendil-works/pi-coding-agent";
import { getModelRegistry, getModelRuntime } from "../../shared/models/model-registry.js";
import { getSettingsManager } from "../../shared/settings.js";
import { imageTheme } from "../theme/theme.js";

interface ActiveModelState {
    model: string;
    provider?: string;
}

interface InstallUiApiOverridesOptions {
    uiAPI: import("./types.js").UiAPI;
    tui: TUI;
    editor: Editor;
    container: Container;
    messageList: Container;
    getProjectRoot(): string;
    setActiveModel(model: string, provider?: string): Promise<void> | void;
    getActiveModelState?: () => ActiveModelState;
}

export function installUiApiOverrides({
    uiAPI,
    tui,
    editor,
    container,
    messageList,
    getProjectRoot,
    setActiveModel,
    getActiveModelState = () => ({ model: "", provider: "" }),
}: InstallUiApiOverridesOptions): void {
    uiAPI.disableInput = () => {
        editor.disableSubmit = true;
        tui.requestRender();
    };

    uiAPI.enableInput = () => {
        editor.disableSubmit = false;
        tui.requestRender();
    };

    const basePromptSelect = uiAPI.promptSelect.bind(uiAPI);
    uiAPI.promptSelect = async (...args) => {
        const wasDisabled = editor.disableSubmit === true;
        editor.disableSubmit = true;
        tui.requestRender();
        try {
            return await basePromptSelect(...args);
        } finally {
            editor.disableSubmit = wasDisabled;
            tui.requestRender();
        }
    };

    const basePromptText = uiAPI.promptText.bind(uiAPI);
    uiAPI.promptText = async (...args) => {
        const wasDisabled = editor.disableSubmit === true;
        editor.disableSubmit = true;
        tui.requestRender();
        try {
            return await basePromptText(...args);
        } finally {
            editor.disableSubmit = wasDisabled;
            tui.requestRender();
        }
    };

    uiAPI.showModelSelector = () => {
        return new Promise((resolve, reject) => {
            const settingsManager = getSettingsManager(getProjectRoot());
            const modelRegistry = getModelRegistry();
            const activeModelState = getActiveModelState();
            const currentModel = modelRegistry.find(activeModelState.provider || "", activeModelState.model || "");
            const editorIndex = container.children.indexOf(editor);
            let selector: ModelSelectorComponent;
            let settled = false;

            const restoreSelector = () => {
                if (settled) return;
                settled = true;
                const selectorIndex = container.children.indexOf(selector);
                if (selectorIndex !== -1) container.children.splice(selectorIndex, 1, editor);
                else container.addChild(editor);
                tui.setFocus(editor);
                tui.requestRender();
                resolve();
            };

            getModelRuntime().then((modelRuntime) => {
                selector = new ModelSelectorComponent(
                    tui,
                    currentModel,
                    settingsManager,
                    modelRuntime,
                    [],
                    async (model) => {
                        await setActiveModel(model.id, model.provider);
                        restoreSelector();
                    },
                    restoreSelector,
                );

                if (editorIndex !== -1) container.children.splice(editorIndex, 1, selector);
                else container.addChild(selector);
                tui.setFocus(selector);
                tui.requestRender();
            }).catch(reject);
        });
    };

    uiAPI.appendImage = (base64, mimeType) => {
        if (uiAPI.isOutputSuppressed?.()) return;
        messageList.addChild(
            new Image(base64, mimeType, imageTheme, {
                maxWidthCells: 60,
                maxHeightCells: 20,
            }),
        );
        messageList.addChild(new Spacer(1));
        tui.requestRender();
    };
}
