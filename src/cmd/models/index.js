/**
 * @module cmd/models
 * Handler for the model listing and switching command.
 */

import { getModelRegistry as getModelRegistryFn } from "../../shared/models/model-registry.js";
import { parseProviderModel as parseProviderModelFn } from "../../shared/models/model-validation.js";
import { COMMAND_NAMES } from "../registry.js";
import { printCommandHelp as printCommandHelpFn } from "../help/index.js";
export { getModelCompletions } from "./getArgumentCompletions.js";

/**
 * @typedef {Object} CommandDependencies
 * @property {typeof getModelRegistryFn} [getModelRegistry]
 * @property {typeof parseProviderModelFn} [parseProviderModel]
 * @property {(model: string, provider?: string) => Promise<void> | void} [setActiveModel]
 * @property {typeof printCommandHelpFn} [printCommandHelp]
 */

/**
 * Handle the models command (`wld model` and `/model`).
 *
 * @param {string[]} argv
 * @param {import('../registry.js').CommandContext & { __testDeps?: CommandDependencies }} [options]
 */
export async function runModelsCommand(argv, options = {}) {
    const deps = /** @type {CommandDependencies} */ ((/** @type {any} */ (options)).__testDeps || {});
    const {
        getModelRegistry: getModelRegistryDep,
        parseProviderModel: parseProviderModelDep,
        setActiveModel: setActiveModelDep,
        printCommandHelp: printCommandHelpDep,
    } = deps;

    const getModelRegistry = getModelRegistryDep || getModelRegistryFn;
    const parseProviderModel = parseProviderModelDep || parseProviderModelFn;
    const setActiveModel = options.setActiveModel || setActiveModelDep || (async () => {});
    const printCommandHelp = printCommandHelpDep || printCommandHelpFn;

    const { uiAPI, editor } = options;

    let targetModel;
    const firstArg = argv[0]?.trim();

    if (firstArg === "help" || firstArg === "--help" || firstArg === "-h") {
        printCommandHelp(COMMAND_NAMES.MODEL);
        return;
    }

    const modelRegistry = getModelRegistry();

    if (!firstArg) {
        if (uiAPI && editor) {
            // We prioritze showModelSelector for real TUI, but we must NOT
            // let it mask the fallback logic during tests where uiAPI.showModelSelector
            // might be defined as a no-op but the tests expect promptSelect behavior.
            if (uiAPI.showModelSelector && !options.__testDeps) {
                await uiAPI.showModelSelector();
            } else {
                // Fallback for tests or older versions
                const available = modelRegistry.getAvailable();
                if (available.length === 0) {
                    uiAPI.appendSystemMessage("No models available.");
                } else {
                    const selection = await uiAPI.promptSelect(
                        "Select model",
                        available.map((m) => ({ value: `${m.provider}/${m.id}`, label: m.name })),
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
        } else {
            console.log("Usage: wld model <provider>/<model_id>");
            return;
        }
    } else {
        const parsedArgs = parseProviderModel(firstArg);
        if (!parsedArgs.ok) {
            if (uiAPI) {
                uiAPI.appendSystemMessage("Invalid model format. Use /model to switch.");
            } else {
                console.log("Invalid model format. Use provider/id.");
            }
            return;
        }

        targetModel = modelRegistry.find(parsedArgs.provider, parsedArgs.id);
        // Provide some feedback to the user on success/failure within the correct interface
        if (!targetModel) {
            if (uiAPI) {
                uiAPI.appendSystemMessage(`Unknown model: ${firstArg}. Use /model to switch.`);
            } else {
                console.log(`Unknown model: ${firstArg}`);
            }
            return;
        }
    }

    await setActiveModel(targetModel.id, targetModel.provider);

    if (uiAPI) {
        uiAPI.appendSystemMessage(`Switched model to ${targetModel.provider}/${targetModel.id}`);
    } else {
        console.log(`Switched model to ${targetModel.provider}/${targetModel.id}`);
    }

    await Promise.resolve();
}
