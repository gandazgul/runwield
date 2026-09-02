/**
 * @module ui/tui/model-welcome
 * No-model onboarding orchestration for the interactive TUI.
 *
 * Reads the real RunWield model registry, project-scoped settings, and the
 * canonical command registry directly. The only collaborators a caller may
 * supply are the runtime objects the interactive session already owns (UI,
 * editor, TUI, session), plus the project root that scopes settings.
 */

import { COMMAND_NAMES, commandRegistry } from "../../cmd/registry.js";
import {
    detectModelAvailability,
    getConfiguredModelAvailability,
    getConfiguredProviderAvailability,
    getSelectedDefaultModelAvailability,
    type ModelAvailability,
    type ModelAvailabilitySource,
    type ModelSummary,
} from "../../shared/session/model-readiness.ts";
import type { SessionRuntime } from "../../shared/session/session-runtime.js";
import type { Editor, TUI } from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.js";
import type { UiAPI } from "./types.js";

export {
    detectModelAvailability,
    getConfiguredModelAvailability,
    getConfiguredProviderAvailability,
    getSelectedDefaultModelAvailability,
};
export type { ModelAvailability, ModelAvailabilitySource, ModelSummary };

export interface MaybeShowModelWelcomeOptions {
    uiAPI: UiAPI;
    editor: Editor;
    tui: TUI;
    sessionId: string;
    sessionRuntime: SessionRuntime;
    initialAgentInternalName: string;
    initialAgentModel?: string;
    forceModelSelection?: boolean;
    /** Project root that scopes the settings manager used for defaults. */
    projectRoot: string;
    deferRootActivation?: boolean;
}

export interface ModelWelcomeResult {
    shown: boolean;
    suppressBootBanner: boolean;
    noModel: boolean;
    setupCompleted: boolean;
    availabilityError?: string | null;
}

function runCommandContext(options: MaybeShowModelWelcomeOptions) {
    return {
        uiAPI: options.uiAPI,
        editor: options.editor,
        tui: options.tui,
        sessionId: options.sessionId,
        sessionRuntime: options.sessionRuntime,
    };
}

/**
 * First-run model onboarding: availability check → login
 * (`skipPostLoginSetup: true`) → `/model` → root `switchAgent`. The boot banner
 * is suppressed whenever onboarding showed.
 *
 * @param options
 * @returns {Promise<ModelWelcomeResult>}
 */
export async function maybeShowModelWelcome(options: MaybeShowModelWelcomeOptions): Promise<ModelWelcomeResult> {
    const initialAvailability = getConfiguredModelAvailability();
    const selectedDefaultAvailability = getSelectedDefaultModelAvailability(options.projectRoot);
    if (initialAvailability.available && selectedDefaultAvailability.available && !options.forceModelSelection) {
        return { shown: false, suppressBootBanner: false, noModel: false, setupCompleted: false };
    }

    options.editor.disableSubmit = true;
    options.tui.requestRender();

    let afterLoginAvailability = initialAvailability;
    const providerAvailability = getConfiguredProviderAvailability();
    if (!afterLoginAvailability.available && providerAvailability.available) {
        afterLoginAvailability = { available: true, error: null };
    }

    const title = [
        theme.bold("Welcome to RunWield"),
        "",
        "Choose how you'd like to connect your model.",
        "RunWield needs a configured model before chat submissions can run.",
        initialAvailability.error ? `Model registry note: ${initialAvailability.error}` : "",
    ].filter(Boolean).join("\n");

    let modelSelectorAlreadyShown = false;
    while (!afterLoginAvailability.available) {
        const choice = await options.uiAPI.promptSelect(
            title,
            [
                {
                    value: "claude-cli",
                    label: "Use Claude Code CLI",
                    description:
                        "Select a Claude CLI alias. Requires Claude Code installed and signed in; no RunWield API key login.",
                },
                {
                    value: "subscription",
                    label: "Use a subscription login",
                    description: "Sign in with a supported provider account.",
                },
                {
                    value: "api-key",
                    label: "Use an API key",
                    description: "Paste a provider API key and store it in RunWield config.",
                },
            ],
            { hint: "↑↓ Navigate  Enter Select  Esc Quit" },
        );

        if (!choice) {
            options.uiAPI.appendSystemMessage("Model setup cancelled. Exiting RunWield.", false, "RunWield");
            await commandRegistry[COMMAND_NAMES.QUIT].execute([], runCommandContext(options));
            return { shown: true, suppressBootBanner: true, noModel: true, setupCompleted: false };
        }

        if (choice === "claude-cli") {
            if (options.uiAPI.showModelSelector) await options.uiAPI.showModelSelector("claude-cli/sonnet");
            else await commandRegistry[COMMAND_NAMES.MODEL].execute([], runCommandContext(options));
            modelSelectorAlreadyShown = true;
            afterLoginAvailability = getConfiguredModelAvailability();
            break;
        }

        const loginArg = choice === "subscription" ? "subscription" : "api-key";
        await commandRegistry[COMMAND_NAMES.LOGIN].execute([loginArg], {
            ...runCommandContext(options),
            skipPostLoginSetup: true,
        });

        afterLoginAvailability = getConfiguredModelAvailability();
    }

    if (!modelSelectorAlreadyShown) await commandRegistry[COMMAND_NAMES.MODEL].execute([], runCommandContext(options));

    const afterSelectionAvailability = getSelectedDefaultModelAvailability(options.projectRoot);
    if (!afterSelectionAvailability.available) {
        options.uiAPI.appendSystemMessage(
            "No model was selected. Run /model to choose a default model, run /login to configure credentials, or quit with /quit.",
            true,
            "RunWield",
        );
        options.editor.disableSubmit = false;
        options.tui.setFocus(options.editor);
        options.tui.requestRender();
        return {
            shown: true,
            suppressBootBanner: true,
            noModel: true,
            setupCompleted: false,
            availabilityError: afterSelectionAvailability.error,
        };
    }

    try {
        if (options.deferRootActivation) {
            const result = options.sessionRuntime.markPromptReadyAgent(options.sessionId, {
                agentName: options.initialAgentInternalName,
                model: options.initialAgentModel,
            });
            if (!result.ok) throw new Error(result.error || "prompt-ready metadata failed");
        }
        options.editor.disableSubmit = false;
        options.tui.setFocus(options.editor);
        options.tui.requestRender();
        return { shown: true, suppressBootBanner: true, noModel: false, setupCompleted: true };
    } catch (error) {
        options.editor.disableSubmit = false;
        options.tui.setFocus(options.editor);
        options.uiAPI.appendSystemMessage(
            `Failed to initialize root agent after model setup: ${
                error instanceof Error ? error.message : String(error)
            }. Run /model to choose another model, run /login to configure credentials, or quit with /quit.`,
            true,
            "RunWield",
        );
        options.tui.requestRender();
        return { shown: true, suppressBootBanner: true, noModel: true, setupCompleted: false };
    }
}
