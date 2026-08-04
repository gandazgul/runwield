/**
 * @module cmd/models
 * Handler for the model listing and switching command.
 */

import { getModelRegistry } from "../../shared/models/model-registry.ts";
import { parseProviderModel } from "../../shared/models/model-validation.ts";
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

interface ModelActivationResult {
    status?: "active" | "deferred";
    message?: string;
}

interface ModelsCommandOptions {
    uiAPI?: ModelsCommandUi;
    editor?: ModelsCommandEditor;
    setActiveModel?(
        model: string,
        provider?: string,
    ): Promise<ModelActivationResult | void> | ModelActivationResult | void;
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
                            const activation = await setActiveModel(found.id, found.provider);
                            uiAPI.appendSystemMessage(
                                activation?.status === "deferred"
                                    ? activation.message ||
                                        `Saved ${found.provider}/${found.id} for later. The current Session was not switched.`
                                    : `Switched model to ${found.provider}/${found.id}`,
                            );
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

    const activation = await setActiveModel(targetModel.id, targetModel.provider);
    const message = activation?.status === "deferred"
        ? activation.message ||
            `Saved ${targetModel.provider}/${targetModel.id} for later. The current Session was not switched.`
        : `Switched model to ${targetModel.provider}/${targetModel.id}`;
    if (uiAPI) uiAPI.appendSystemMessage(message);
    else console.log(message);
}
