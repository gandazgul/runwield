/**
 * @module shared/interactive/ui-api-overrides
 *
 * Wires chat-session-specific behavior onto the shared UiAPI: keeps the
 * active-agent / model state in sync with TUI renders, swaps the editor for
 * the model-selector overlay, and inlines pasted images into the message list.
 */

import { Image } from "@earendil-works/pi-tui";
import { ModelSelectorComponent } from "@earendil-works/pi-coding-agent";
import { getModelRegistry } from "../models/model-registry.js";
import { getSettingsManager } from "../settings.js";
import { getActiveModelState } from "../session/session-state.js";
import { imageTheme } from "../ui/theme.js";

/**
 * @param {{
 *   uiAPI: import('../ui/types.js').UiAPI,
 *   tui: import('@earendil-works/pi-tui').TUI,
 *   editor: import('@earendil-works/pi-tui').Editor,
 *   container: import('@earendil-works/pi-tui').Container,
 *   messageList: import('@earendil-works/pi-tui').Container,
 *   setActiveModel: (model: string, provider?: string) => Promise<void> | void,
 * }} deps
 */
export function installUiApiOverrides({ uiAPI, tui, editor, container, messageList, setActiveModel }) {
    uiAPI.disableInput = () => {
        if (editor) {
            // editor.disableSubmit = true;
            tui.requestRender();
        }
    };

    uiAPI.enableInput = () => {
        if (editor) {
            editor.disableSubmit = false;
            tui.requestRender();
        }
    };

    uiAPI.showModelSelector = () => {
        return new Promise((resolve) => {
            const settingsManager = getSettingsManager();
            const modelRegistry = getModelRegistry();
            const activeModelState = getActiveModelState();
            const currentModel = modelRegistry.find(activeModelState.provider, activeModelState.model);

            const editorIndex = container.children.indexOf(editor);

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

            const selector = new ModelSelectorComponent(
                tui,
                currentModel,
                settingsManager,
                modelRegistry,
                [], // No scoped models for now
                (model) => {
                    setActiveModel(model.id, model.provider);
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
        });
    };

    uiAPI.appendImage = (base64, mimeType) => {
        if (uiAPI.isOutputSuppressed?.()) return;
        const img = new Image(base64, mimeType, imageTheme, {
            maxWidthCells: 60,
            maxHeightCells: 20,
        });
        messageList.addChild(img);
        tui.requestRender();
    };
}
