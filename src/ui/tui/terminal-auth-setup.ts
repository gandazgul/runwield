/**
 * @module ui/tui/terminal-auth-setup
 * Setup-only terminal authentication flow for ACP Terminal Auth and `wld login`.
 */

import { runLoginCommand } from "../../cmd/auth/index.ts";
import { getCwd } from "../../constants.js";
import { setDefaultModelSelection } from "../../shared/session/model-selection.ts";
import { getSettingsManager } from "../../shared/settings.js";
import { getSelectedDefaultModelAvailability } from "../../shared/session/model-readiness.ts";
import { createChatView } from "./chat-view.ts";
import { initTUI, stopTUI } from "./tui.ts";

export type TerminalAuthSetupStatus = "ready" | "canceled" | "failed";

export interface TerminalAuthSetupResult {
    status: TerminalAuthSetupStatus;
    message: string;
}

function getActiveDefaultModel(projectRoot: string): { model: string; provider?: string } {
    const settings = getSettingsManager(projectRoot);
    return {
        model: settings.getDefaultModel?.() || "",
        provider: settings.getDefaultProvider?.() || "",
    };
}

/**
 * Run the Login command in a terminal UI without creating a RunWield Session.
 */
export async function runTerminalAuthSetup(argv: string[] = []): Promise<TerminalAuthSetupResult> {
    const projectRoot = getCwd();
    const tui = initTUI();
    let modelSelectorOpened = false;
    let modelSelected = false;
    try {
        const view = await createChatView({
            tui,
            sessionRuntime: {
                getSessionSnapshot: () => ({
                    name: "Login",
                    cwd: projectRoot,
                    activeModel: getActiveDefaultModel(projectRoot),
                }),
            },
            getSessionId: () => "terminal-auth-setup",
            suppressStartupHeader: false,
            setActiveModel: async (model, provider) => {
                await setDefaultModelSelection(projectRoot, model, provider);
                modelSelected = true;
                return {
                    status: "deferred",
                    message: `Saved ${provider ? `${provider}/${model}` : model} as the default model.`,
                };
            },
        });
        const baseShowModelSelector = view.uiAPI.showModelSelector.bind(view.uiAPI);
        view.uiAPI.showModelSelector = async (initialSearchInput?: string) => {
            modelSelectorOpened = true;
            await baseShowModelSelector(initialSearchInput);
        };
        const outcome = await runLoginCommand(argv, { uiAPI: view.uiAPI });
        if (outcome.status === "canceled") {
            return { status: "canceled", message: "Login canceled." };
        }
        if (outcome.status === "failed") {
            return { status: "failed", message: outcome.message };
        }
        const readiness = getSelectedDefaultModelAvailability(projectRoot);
        if (!readiness.available) {
            return { status: "failed", message: readiness.error || "No usable default model is selected." };
        }
        if (modelSelectorOpened && !modelSelected) {
            return { status: "canceled", message: "Model selection canceled." };
        }
        return { status: "ready", message: "RunWield login complete." };
    } catch (error) {
        return { status: "failed", message: error instanceof Error ? error.message : String(error) };
    } finally {
        stopTUI();
    }
}
