/**
 * @module ui/tui/ui-api-overrides
 *
 * Wires chat-session-specific input behavior onto the shared UiAPI: swaps the
 * editor for the model-selector overlay and inlines pasted images into the
 * message list. Runtime snapshots remain authoritative for footer state.
 */

import { Image, Spacer } from "@earendil-works/pi-tui";
import { ModelSelectorComponent } from "@earendil-works/pi-coding-agent";
import { getModelRegistry, getModelRuntime } from "../../shared/models/model-registry.js";
import { getSettingsManager } from "../../shared/settings.js";
import { imageTheme } from "../theme/theme.js";

/**
 * @param {{
 *   uiAPI: import('./types.js').UiAPI,
 *   tui: import('@earendil-works/pi-tui').TUI,
 *   editor: import('@earendil-works/pi-tui').Editor,
 *   container: import('@earendil-works/pi-tui').Container,
 *   messageList: import('@earendil-works/pi-tui').Container,
 *   setActiveModel: (model: string, provider?: string) => Promise<void> | void,
 *   getActiveModelState?: () => { model: string, provider?: string },
 *   __deps?: {
 *     Image?: typeof Image,
 *     ModelSelectorComponent?: typeof ModelSelectorComponent,
 *     getModelRegistry?: typeof getModelRegistry,
 *     getModelRuntime?: typeof getModelRuntime,
 *     getSettingsManager?: typeof getSettingsManager,
 *     getActiveModelState?: () => { model: string, provider?: string },
 *   },
 * }} deps
 */
export function installUiApiOverrides({
    uiAPI,
    tui,
    editor,
    container,
    messageList,
    setActiveModel,
    getActiveModelState,
    __deps,
}) {
    const ImageImpl = __deps?.Image || Image;
    const ModelSelectorComponentImpl = __deps?.ModelSelectorComponent || ModelSelectorComponent;
    const getModelRegistryImpl = __deps?.getModelRegistry || getModelRegistry;
    const getModelRuntimeImpl = __deps?.getModelRuntime || getModelRuntime;
    const getSettingsManagerImpl = __deps?.getSettingsManager || getSettingsManager;
    const getActiveModelStateImpl = getActiveModelState || __deps?.getActiveModelState ||
        (() => ({ model: "", provider: "" }));

    uiAPI.disableInput = () => {
        if (editor) {
            editor.disableSubmit = true;
            tui.requestRender();
        }
    };

    uiAPI.enableInput = () => {
        if (editor) {
            editor.disableSubmit = false;
            tui.requestRender();
        }
    };

    const basePromptSelect = uiAPI.promptSelect?.bind(uiAPI);
    if (basePromptSelect) {
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
    }

    const basePromptText = uiAPI.promptText?.bind(uiAPI);
    if (basePromptText) {
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
    }

    uiAPI.showModelSelector = () => {
        return new Promise((resolve, reject) => {
            const settingsManager = getSettingsManagerImpl();
            const modelRegistry = getModelRegistryImpl();
            const activeModelState = getActiveModelStateImpl();
            const currentModel = modelRegistry.find(activeModelState.provider || "", activeModelState.model || "");

            const editorIndex = container.children.indexOf(editor);
            /** @type {any} */
            let selector;

            let settled = false;
            const restoreSelector = () => {
                if (settled) return;
                settled = true;
                const selectorIndex = container.children.indexOf(selector);
                if (selectorIndex !== -1) {
                    container.children.splice(selectorIndex, 1, editor);
                } else {
                    container.addChild(editor);
                }
                tui.setFocus(editor);
                tui.requestRender();
                resolve();
            };

            getModelRuntimeImpl().then((modelRuntime) => {
                selector = new ModelSelectorComponentImpl(
                    /** @type {any} */ (tui),
                    currentModel,
                    settingsManager,
                    modelRuntime,
                    [], // No scoped models for now
                    async (model) => {
                        await setActiveModel(model.id, model.provider);
                        restoreSelector();
                    },
                    () => {
                        restoreSelector();
                    },
                );

                if (editorIndex !== -1) {
                    container.children.splice(editorIndex, 1, selector);
                } else {
                    container.addChild(selector);
                }
                tui.setFocus(selector);
                tui.requestRender();
            }).catch(reject);
        });
    };

    uiAPI.appendImage = (base64, mimeType) => {
        if (uiAPI.isOutputSuppressed?.()) return;
        const img = new ImageImpl(base64, mimeType, imageTheme, {
            maxWidthCells: 60,
            maxHeightCells: 20,
        });
        messageList.addChild(img);
        messageList.addChild(new Spacer(1));
        tui.requestRender();
    };
}
