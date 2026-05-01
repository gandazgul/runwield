/**
 * @module cmd/models
 * Handler for the model listing and switching command.
 */

import { setActiveModel } from "../../shared/chat-session.js";

/**
 * Handle the models command (`hns models` and `/model`).
 * @param {string[]} argv
 * @param {any} [options]
 */
export async function runModelsCommand(argv, options) {
    const { uiAPI } = options || {};

    if (argv.length === 0) {
        if (uiAPI) {
            uiAPI.appendSystemMessage("Usage: /model <model_id> (or <provider>/<model_id> optionally)");
        } else {
            console.log("Usage: hns models <model_id>");
        }
        return;
    }

    const targetModel = argv[0];

    const { ModelRegistry } = await import("@mariozechner/pi-coding-agent");
    const { AuthStorage } = await import("@mariozechner/pi-coding-agent");

    // Determine the standard pi agent directory to look for models.json and auth details
    const CWD = Deno.cwd();
    const HOME_DIR = Deno.env.get("HOME") || "";
    const agentDir = HOME_DIR ? `${HOME_DIR}/.pi/agent` : CWD;

    const authStorage = AuthStorage.create(`${agentDir}/auth.json`);
    const modelRegistry = ModelRegistry.create(authStorage, `${agentDir}/models.json`);
    const models = modelRegistry.getAll();

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

    setActiveModel(modelObj.id);

    if (uiAPI) {
        uiAPI.appendSystemMessage(`Switched model to ${modelObj.id} (${modelObj.provider})`);
    } else {
        console.log(`Switched model to ${modelObj.id} (${modelObj.provider})`);
    }
}
