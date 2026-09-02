/**
 * @module ui/tui/terminal-auth-setup
 * Setup-only terminal authentication flow for ACP Terminal Auth and `wld login`.
 */

import { getCwd } from "../../constants.js";
import { setDefaultModelSelection } from "../../shared/session/model-selection.ts";
import { getSettingsManager } from "../../shared/settings.js";
import { type ChatView, createChatView } from "./chat-view.ts";
import { runSharedModelSetup } from "./model-setup.ts";
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
    let view: ChatView | null = null;
    try {
        view = await createChatView({
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
                return {
                    status: "deferred",
                    message: `Saved ${provider ? `${provider}/${model}` : model} as the default model.`,
                };
            },
        });
        const result = await runSharedModelSetup({
            uiAPI: view.uiAPI,
            projectRoot,
            argv,
            title: [
                "Welcome to RunWield",
                "",
                "Choose how you'd like to connect your model.",
                "RunWield needs a configured model before chat submissions can run.",
            ].join("\n"),
        });
        return { status: result.status, message: result.message };
    } catch (error) {
        return { status: "failed", message: error instanceof Error ? error.message : String(error) };
    } finally {
        view?.dispose();
        stopTUI();
    }
}
