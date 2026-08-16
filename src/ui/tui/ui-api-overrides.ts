/** Chat-session-specific input, model-selection, and pasted-image behavior. */

import { Image, Spacer } from "@earendil-works/pi-tui";
import type { Container, Editor, TUI } from "@earendil-works/pi-tui";
import { getModelRegistry } from "../../shared/models/model-registry.ts";
import { imageTheme } from "../theme/theme.js";
import { RunWieldModelSelectorComponent } from "./model-selector.ts";

interface ActiveModelState {
    model: string;
    provider?: string;
}

interface ModelActivationResult {
    status?: "active" | "deferred";
    message?: string;
}

interface InstallUiApiOverridesOptions {
    uiAPI: import("./types.js").UiAPI;
    tui: TUI;
    editor: Editor;
    container: Container;
    messageList: Container;
    getProjectRoot(): string;
    setActiveModel(
        model: string,
        provider?: string,
    ): Promise<ModelActivationResult | void> | ModelActivationResult | void;
    getActiveModelState?: () => ActiveModelState;
}

export function installUiApiOverrides({
    uiAPI,
    tui,
    editor,
    container,
    messageList,
    getProjectRoot: _getProjectRoot,
    setActiveModel,
    getActiveModelState = () => ({ model: "", provider: "" }),
}: InstallUiApiOverridesOptions): void {
    async function runWithInlinePrompt<Result>(openPrompt: () => Promise<Result>): Promise<Result> {
        const wasDisabled = editor.disableSubmit === true;
        const editorIndex = container.children.indexOf(editor);
        editor.disableSubmit = true;
        if (editorIndex !== -1) container.children.splice(editorIndex, 1);
        tui.requestRender();
        try {
            return await openPrompt();
        } finally {
            editor.disableSubmit = wasDisabled;
            if (editorIndex !== -1 && !container.children.includes(editor)) {
                container.children.splice(Math.min(editorIndex, container.children.length), 0, editor);
            }
            tui.requestRender();
        }
    }

    uiAPI.disableInput = () => {
        editor.disableSubmit = true;
        tui.requestRender();
    };

    uiAPI.enableInput = () => {
        editor.disableSubmit = false;
        tui.requestRender();
    };

    const basePromptSelect = uiAPI.promptSelect.bind(uiAPI);
    uiAPI.promptSelect = (...args) => runWithInlinePrompt(() => basePromptSelect(...args));

    const basePromptText = uiAPI.promptText.bind(uiAPI);
    uiAPI.promptText = (...args) => runWithInlinePrompt(() => basePromptText(...args));

    uiAPI.showModelSelector = (initialSearchInput?: string) => {
        return new Promise((resolve, reject) => {
            const modelRegistry = getModelRegistry();
            const activeModelState = getActiveModelState();
            const currentModel = modelRegistry.find(activeModelState.provider || "", activeModelState.model || "");
            const editorIndex = container.children.indexOf(editor);
            let selector: RunWieldModelSelectorComponent;
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

            try {
                selector = new RunWieldModelSelectorComponent({
                    tui,
                    currentModel,
                    modelRegistry,
                    onSelect: async (model) => {
                        try {
                            const activation = await setActiveModel(model.id, model.provider);
                            uiAPI.appendSystemMessage(
                                activation?.status === "deferred"
                                    ? activation.message ||
                                        `Saved ${model.provider}/${model.id} for later. The current Session was not switched.`
                                    : `Switched model to ${model.provider}/${model.id}`,
                                false,
                                "RunWield",
                            );
                            restoreSelector();
                        } catch (error) {
                            restoreSelector();
                            reject(error);
                        }
                    },
                    onCancel: restoreSelector,
                    initialSearchInput,
                });

                if (editorIndex !== -1) container.children.splice(editorIndex, 1, selector);
                else container.addChild(selector);
                tui.setFocus(selector);
                tui.requestRender();
            } catch (error) {
                reject(error);
            }
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
