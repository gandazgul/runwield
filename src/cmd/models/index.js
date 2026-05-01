/**
 * @module cmd/models
 * Handler for the model listing and switching command.
 */

import { setActiveModel } from "../../shared/chat-session.js";
import { getModelRegistry } from "../../shared/models/model-registry.js";
import { parseProviderModel } from "../../shared/models/model-validation.js";
export { getModelCompletions } from "./getArgumentCompletions.js";

/**
 * Handle the models command (`hns model` and `/model`).
 *
 * @param {string[]} argv
 * @param {import('../registry.js').CommandContext} [options]
 */
export async function runModelsCommand(argv, options = {}) {
    const { uiAPI, editor } = options;

    if (argv.length === 0) {
        if (uiAPI && editor) {
            const modelRegistry = getModelRegistry();
            const models = modelRegistry.getAvailable();

            if (models.length === 0) {
                uiAPI.appendSystemMessage("No models available.");
                editor.setText("");
                editor.disableSubmit = false;
                return;
            }

            const modelOptions = models
                .sort((modelA, modelB) => modelA.id.localeCompare(modelB.id))
                .map((model) => ({
                    value: `${model.provider}/${model.id}`,
                    label: `${model.provider}/${model.id}`,
                    description: model.name,
                }));

            const chosen = await uiAPI.promptSelect("Switch model:", modelOptions);
            if (!chosen) {
                editor.setText("");
                editor.disableSubmit = false;
                return;
            }

            const targetModel = chosen;
            const modelObj = models.find((model) =>
                `${model.provider}/${model.id}` === targetModel || model.id === targetModel
            );

            if (!modelObj) {
                uiAPI.appendSystemMessage(`Unknown model: ${targetModel}.`);
                editor.setText("");
                editor.disableSubmit = false;
                return;
            }

            setActiveModel(modelObj.id, modelObj.provider);
            uiAPI.appendSystemMessage(`Switched model to ${modelObj.provider}/${modelObj.id}`);
            editor.setText("");
            editor.disableSubmit = false;
            return;
        } else if (uiAPI) {
            uiAPI.appendSystemMessage("Usage: /model <provider>/<model_id>");
            return;
        }

        console.log("Usage: hns model <provider>/<model_id>");
        return;
    }

    const targetModel = argv[0].trim();
    const parsedArgs = parseProviderModel(targetModel);

    if (!parsedArgs.ok) {
        if (uiAPI) {
            uiAPI.appendSystemMessage("Invalid model format. Use /model to switch.");
        } else {
            console.log("Invalid model format. Use provider/id.");
        }
        return;
    }

    const modelRegistry = getModelRegistry();
    const modelObj = modelRegistry.find(parsedArgs.provider, parsedArgs.id);

    // Provide some feedback to the user on success/failure within the correct interface
    if (!modelObj) {
        if (uiAPI) {
            uiAPI.appendSystemMessage(`Unknown model: ${targetModel}. Use /model to switch.`);
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
