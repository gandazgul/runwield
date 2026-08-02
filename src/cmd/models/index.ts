/**
 * @module cmd/models
 * Handler for the model listing and switching command.
 */

import { getModelRegistry } from "../../shared/models/model-registry.js";
import { parseProviderModel } from "../../shared/models/model-validation.js";
import { COMMAND_NAMES } from "../registry.js";
import { printCommandHelp } from "../help/index.js";
export { getModelCompletions } from "./getArgumentCompletions.js";

interface ModelSelectItem {
    value: string;
    label: string;
}

interface ModelsCommandUi {
    appendSystemMessage(message: string): void;
    promptSelect(title: string, options: ModelSelectItem[]): Promise<string | null>;
    showModelSelector?(): Promise<void> | void;
}

interface ModelsCommandEditor {
    disableSubmit: boolean;
    setText(text: string): void;
}

interface ModelsCommandOptions {
    uiAPI?: ModelsCommandUi;
    editor?: ModelsCommandEditor;
    setActiveModel?(model: string, provider?: string): Promise<void> | void;
}

export async function runModelsCommand(argv: string[], options: ModelsCommandOptions = {}): Promise<void> {
    const { uiAPI, editor } = options;
    const setActiveModel = options.setActiveModel || (() => {});
    const firstArg = argv[0]?.trim();

    if (firstArg === "help" || firstArg === "--help" || firstArg === "-h") {
        printCommandHelp(COMMAND_NAMES.MODEL);
        return;
    }

    const modelRegistry = getModelRegistry();
    await modelRegistry.getRuntime();

    if (!firstArg) {
        if (!uiAPI || !editor) {
            console.log("Usage: wld model <provider>/<model_id>");
            return;
        }

        if (uiAPI.showModelSelector) {
            await uiAPI.showModelSelector();
        } else {
            const available = modelRegistry.getAvailable();
            if (available.length === 0) {
                uiAPI.appendSystemMessage("No models available.");
            } else {
                const selection = await uiAPI.promptSelect(
                    "Select model",
                    available.map((model) => ({ value: `${model.provider}/${model.id}`, label: model.name })),
                );
                if (selection) {
                    const parsed = parseProviderModel(selection);
                    if (parsed.ok) {
                        const found = modelRegistry.find(parsed.provider, parsed.id);
                        if (found) {
                            await setActiveModel(found.id, found.provider);
                            uiAPI.appendSystemMessage(`Switched model to ${found.provider}/${found.id}`);
                        } else {
                            uiAPI.appendSystemMessage(`Unknown model: ${selection}. Use /model to switch.`);
                        }
                    }
                }
            }
        }
        editor.setText("");
        editor.disableSubmit = false;
        return;
    }

    const parsedArgs = parseProviderModel(firstArg);
    if (!parsedArgs.ok) {
        if (uiAPI) uiAPI.appendSystemMessage("Invalid model format. Use /model to switch.");
        else console.log("Invalid model format. Use provider/id.");
        return;
    }

    const targetModel = modelRegistry.find(parsedArgs.provider, parsedArgs.id);
    if (!targetModel) {
        if (uiAPI) uiAPI.appendSystemMessage(`Unknown model: ${firstArg}. Use /model to switch.`);
        else console.log(`Unknown model: ${firstArg}`);
        return;
    }

    await setActiveModel(targetModel.id, targetModel.provider);
    if (uiAPI) uiAPI.appendSystemMessage(`Switched model to ${targetModel.provider}/${targetModel.id}`);
    else console.log(`Switched model to ${targetModel.provider}/${targetModel.id}`);
}
