/**
 * @module cmd/models
 * Handler for the model listing and switching command.
 */

import { setActiveModel } from "../../shared/chat-session.js";
import { getModelRegistry } from "../../shared/model-registry.js";
export { getModelCompletions } from "./getArgumentCompletions.js";

/**
 * Handle the models command (`hns model` and `/model`).
 *
 * @param {string[]} argv
 * @param {import('../registry.js').CommandContext} [options]
 */
export async function runModelsCommand(argv, options = {}) {
    const { uiAPI, editor, text, originalHandleInput } = options;

    if (argv.length === 0) {
        if (uiAPI && editor) {
            if (text?.trim() !== "/model") {
                uiAPI.appendSystemMessage("Model selection canceled.");
                editor.setText("");
                editor.disableSubmit = false;
                return;
            }

            editor.setText("/model ");
            editor.cursorCol = 7;
            editor.disableSubmit = false;

            // Trigger immediate render to show the new text
            if (options.tui) options.tui.requestRender();

            // Delay autocomplete request slightly to ensure it fires AFTER
            // the current submission cycle is fully resolved in the pi-tui loop.
            setTimeout(() => {
                if (typeof editor.requestAutocomplete === "function") {
                    try {
                        editor.requestAutocomplete({ force: true });
                    } catch (_e) {
                        if (originalHandleInput) {
                            originalHandleInput(" ");
                        }
                    }
                } else if (originalHandleInput) {
                    originalHandleInput(" ");
                }
                if (options.tui) options.tui.requestRender();
            }, 10);
            return;
        } else if (uiAPI) {
            uiAPI.appendSystemMessage("Usage: /model <provider>/<model_id>");
            return;
        }

        console.log("Usage: hns models <model_id>");
        return;
    }

    const targetModel = argv[0];

    const modelRegistry = getModelRegistry();
    const models = modelRegistry.getAvailable();

    // In pi, models are usually just the id, occasionally provider/id. For robustness, if they typed provider/id
    // let's try to match exactly, or fallback to matching just the id.
    const modelObj = models.find((m) => `${m.provider}/${m.id}` === targetModel || m.id === targetModel);

    // Provide some feedback to the user on success/failure within the correct interface
    if (!modelObj) {
        if (uiAPI) {
            uiAPI.appendSystemMessage(`Unknown model: ${targetModel}. Use tab to see available models.`);
        } else {
            console.log(`Unknown model: ${targetModel}`);
        }
        return;
    }

    setActiveModel(modelObj.id, modelObj.provider);

    if (uiAPI) {
        uiAPI.appendSystemMessage(`Switched model to ${modelObj.provider}/${modelObj.id}`);
    } else {
        console.log(`Switched model to ${modelObj.provider}/${modelObj.id}`);
    }

    await Promise.resolve();
}
