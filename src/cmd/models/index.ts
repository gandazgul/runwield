/**
 * @module cmd/models
 * Handler for the model listing and switching command.
 */

import { getModelRegistry } from "../../shared/models/model-registry.ts";
import { parseProviderModel } from "../../shared/models/model-validation.ts";
import { setActiveSessionModel, setDefaultModelSelection } from "../../shared/session/model-selection.ts";
import type { SessionRuntime } from "../../shared/session/session-runtime.js";
import { getCwd } from "../../constants.js";
import { COMMAND_NAMES } from "../registry.js";
import { printCommandHelp } from "../help/index.js";
export { getModelCompletions } from "./getArgumentCompletions.js";

interface ModelSelectItem {
    value: string;
    label: string;
}

interface ModelSelectorResult {
    selected: boolean;
}

interface ModelsCommandUi {
    appendSystemMessage(message: string, isError?: boolean): void;
    promptSelect(title: string, options: ModelSelectItem[]): Promise<string | null>;
    showModelSelector?(): Promise<ModelSelectorResult | void> | ModelSelectorResult | void;
}

interface ModelsCommandEditor {
    disableSubmit: boolean;
    setText(text: string): void;
}

interface ModelsCommandOptions {
    uiAPI?: ModelsCommandUi;
    editor?: ModelsCommandEditor;
    sessionId?: string;
    sessionRuntime?: SessionRuntime;
}

const INTERACTIVE_SESSION_REQUIRED = "Model switching requires an interactive RunWield session.";

async function activateModel(
    options: ModelsCommandOptions,
    model: string,
    provider: string,
) {
    if (!options.sessionRuntime || !options.sessionId) return null;
    return await setActiveSessionModel(options.sessionRuntime, options.sessionId, model, provider);
}

export async function runModelsCommand(argv: string[], options: ModelsCommandOptions = {}): Promise<void> {
    const { uiAPI, editor } = options;
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
                            const activation = await activateModel(options, found.id, found.provider);
                            if (!activation) {
                                uiAPI.appendSystemMessage(INTERACTIVE_SESSION_REQUIRED);
                                editor.setText("");
                                editor.disableSubmit = false;
                                return;
                            }
                            uiAPI.appendSystemMessage(
                                activation?.status === "deferred"
                                    ? activation.message ||
                                        `Saved ${found.provider}/${found.id} for later. The current Session was not switched.`
                                    : `Switched model to ${found.provider}/${found.id}`,
                            );
                        } else {
                            uiAPI.appendSystemMessage(`Unknown model: ${selection}. Use /model to switch.`, true);
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
        if (uiAPI) uiAPI.appendSystemMessage("Invalid model format. Use /model to switch.", true);
        else console.log("Invalid model format. Use provider/id.");
        return;
    }

    const targetModel = modelRegistry.find(parsedArgs.provider, parsedArgs.id);
    if (!targetModel) {
        if (uiAPI) uiAPI.appendSystemMessage(`Unknown model: ${firstArg}. Use /model to switch.`, true);
        else console.log(`Unknown model: ${firstArg}`);
        return;
    }

    const activation = await activateModel(options, targetModel.id, targetModel.provider);
    if (!activation) {
        if (uiAPI) {
            uiAPI.appendSystemMessage(INTERACTIVE_SESSION_REQUIRED);
        } else {
            await setDefaultModelSelection(getCwd(), targetModel.id, targetModel.provider);
            console.log(`Set default model to ${targetModel.provider}/${targetModel.id}`);
        }
        return;
    }
    const message = activation?.status === "deferred"
        ? activation.message ||
            `Saved ${targetModel.provider}/${targetModel.id} for later. The current Session was not switched.`
        : `Switched model to ${targetModel.provider}/${targetModel.id}`;
    if (uiAPI) uiAPI.appendSystemMessage(message);
    else console.log(message);
}
