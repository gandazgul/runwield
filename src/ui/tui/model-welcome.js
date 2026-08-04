/**
 * @module ui/tui/model-welcome
 * No-model onboarding orchestration for the interactive TUI.
 */

import { COMMAND_NAMES, commandRegistry as defaultCommandRegistry } from "../../cmd/registry.js";
import { getModelRegistry as getModelRegistryFn } from "../../shared/models/model-registry.ts";
import { getSettingsManager as getSettingsManagerFn } from "../../shared/settings.js";
import { theme } from "../theme/theme.js";

/**
 * @typedef {Object} ModelAvailability
 * @property {boolean} available
 * @property {string | null} error
 */

/**
 * @typedef {Object} ModelActivationResult
 * @property {"active" | "deferred"} [status]
 * @property {string} [message]
 *
 * @typedef {Object} MaybeShowModelWelcomeOptions
 * @property {import('./types.js').UiAPI} uiAPI
 * @property {import('@earendil-works/pi-tui').Editor} editor
 * @property {import('@earendil-works/pi-tui').TUI} tui
 * @property {string} sessionId
 * @property {import('../../shared/session/session-runtime.js').SessionRuntime} sessionRuntime
 * @property {string} initialAgentInternalName
 * @property {string} [initialAgentModel]
 * @property {(model: string, provider?: string) => Promise<ModelActivationResult | void> | ModelActivationResult | void} [setActiveModel]
 * @property {Record<string, { execute: (argv: string[], options?: import('../../cmd/registry.js').CommandContext) => Promise<void> }>} [commandRegistry]
 * @property {() => { getAvailable?: () => Array<unknown>, find?: (provider: string, id: string) => unknown, getRegisteredProviderIds?: () => readonly string[] }} [getModelRegistry]
 * @property {() => { getDefaultModel?: () => string | undefined, getDefaultProvider?: () => string | undefined }} [getSettingsManager]
 * @property {(options?: import('../../cmd/registry.js').CommandContext) => Promise<void>} [quit]
 * @property {boolean} [forceModelSelection]
 */

/**
 * @typedef {Object} ModelWelcomeResult
 * @property {boolean} shown
 * @property {boolean} suppressBootBanner
 * @property {boolean} noModel
 * @property {boolean} setupCompleted
 * @property {string | null} [availabilityError]
 */

/**
 * @param {{ getAvailable?: () => Array<unknown> }} registry
 * @returns {ModelAvailability}
 */
export function detectModelAvailability(registry) {
    try {
        return { available: (registry.getAvailable?.() || []).length > 0, error: null };
    } catch (error) {
        return { available: false, error: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * @param {() => { getAvailable?: () => Array<unknown> }} getModelRegistry
 * @returns {ModelAvailability}
 */
export function getConfiguredModelAvailability(getModelRegistry = getModelRegistryFn) {
    try {
        return detectModelAvailability(getModelRegistry());
    } catch (error) {
        return { available: false, error: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * @param {() => { getRegisteredProviderIds?: () => readonly string[] }} getModelRegistry
 * @returns {ModelAvailability}
 */
export function getConfiguredProviderAvailability(getModelRegistry = getModelRegistryFn) {
    try {
        return { available: (getModelRegistry().getRegisteredProviderIds?.() || []).length > 0, error: null };
    } catch (error) {
        return { available: false, error: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * @param {() => { find?: (provider: string, id: string) => unknown, getAvailable?: () => Array<unknown> }} getModelRegistry
 * @param {() => { getDefaultModel?: () => string | undefined, getDefaultProvider?: () => string | undefined }} getSettingsManager
 * @returns {ModelAvailability}
 */
/**
 * @param {unknown} value
 * @returns {value is { provider?: string, id?: string, executionBackend?: string }}
 */
function isRegistryModelSummary(value) {
    return Boolean(value && typeof value === "object");
}

/**
 * @param {(() => { find?: (provider: string, id: string) => unknown, getAvailable?: () => Array<unknown> }) | undefined} getModelRegistry
 * @param {(() => { getDefaultModel?: () => string | undefined, getDefaultProvider?: () => string | undefined }) | undefined} getSettingsManager
 * @returns {ModelAvailability}
 */
export function getSelectedDefaultModelAvailability(
    getModelRegistry,
    getSettingsManager,
) {
    try {
        const resolveModelRegistry = getModelRegistry || getModelRegistryFn;
        const resolveSettingsManager = getSettingsManager || getSettingsManagerFn;
        const settingsManager = resolveSettingsManager();
        const defaultModel = settingsManager.getDefaultModel?.()?.trim();
        const defaultProvider = settingsManager.getDefaultProvider?.()?.trim();
        if (!defaultModel) {
            return { available: false, error: "No default model is selected." };
        }

        const registry = resolveModelRegistry();
        if (!registry.find) return { available: true, error: null };
        const found = registry.find(defaultProvider || "", defaultModel);
        const foundModel = isRegistryModelSummary(found) ? found : null;
        /** @type {Array<unknown>} */
        const availableModels = registry.getAvailable?.() || [];
        const runnable = availableModels.some((model) => {
            if (!isRegistryModelSummary(model)) return false;
            return model.provider === (defaultProvider || foundModel?.provider) &&
                model.id === (foundModel?.id || defaultModel);
        });
        if (foundModel && runnable) return { available: true, error: null };

        if (foundModel?.executionBackend === "claude-cli" || defaultProvider === "claude-cli") {
            return {
                available: false,
                error:
                    `Selected default model is deferred until the Claude CLI execution backend is installed: claude-cli/${defaultModel}`,
            };
        }

        return {
            available: false,
            error: defaultProvider
                ? `Selected default model is unavailable: ${defaultProvider}/${defaultModel}`
                : `Selected default model is unavailable: ${defaultModel}`,
        };
    } catch (error) {
        return { available: false, error: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * @param {MaybeShowModelWelcomeOptions} options
 * @returns {Promise<ModelWelcomeResult>}
 */
export async function maybeShowModelWelcome(options) {
    const getModelRegistry = options.getModelRegistry || getModelRegistryFn;
    const getSettingsManager = options.getSettingsManager || getSettingsManagerFn;
    const commandRegistry = options.commandRegistry || defaultCommandRegistry;
    const initialAvailability = getConfiguredModelAvailability(getModelRegistry);
    const selectedDefaultAvailability = getSelectedDefaultModelAvailability(getModelRegistry, getSettingsManager);
    if (initialAvailability.available && selectedDefaultAvailability.available && !options.forceModelSelection) {
        return { shown: false, suppressBootBanner: false, noModel: false, setupCompleted: false };
    }

    options.editor.disableSubmit = true;
    options.tui.requestRender();

    let afterLoginAvailability = initialAvailability;
    const providerAvailability = getConfiguredProviderAvailability(getModelRegistry);
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

    while (!afterLoginAvailability.available) {
        const choice = await options.uiAPI.promptSelect(
            title,
            [
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
            if (options.quit) {
                await options.quit({ uiAPI: options.uiAPI, editor: options.editor, tui: options.tui });
            } else {
                await commandRegistry[COMMAND_NAMES.QUIT].execute([], {
                    uiAPI: options.uiAPI,
                    editor: options.editor,
                    tui: options.tui,
                    sessionId: options.sessionId,
                    sessionRuntime: options.sessionRuntime,
                });
            }
            return { shown: true, suppressBootBanner: true, noModel: true, setupCompleted: false };
        }

        const loginArg = choice === "subscription" ? "subscription" : "api-key";
        await commandRegistry[COMMAND_NAMES.LOGIN].execute([loginArg], {
            uiAPI: options.uiAPI,
            editor: options.editor,
            tui: options.tui,
            sessionId: options.sessionId,
            sessionRuntime: options.sessionRuntime,
            skipPostLoginSetup: true,
        });

        afterLoginAvailability = getConfiguredModelAvailability(getModelRegistry);
    }

    await commandRegistry[COMMAND_NAMES.MODEL].execute([], {
        uiAPI: options.uiAPI,
        editor: options.editor,
        tui: options.tui,
        sessionId: options.sessionId,
        sessionRuntime: options.sessionRuntime,
        setActiveModel: options.setActiveModel,
    });

    const afterSelectionAvailability = getSelectedDefaultModelAvailability(getModelRegistry, getSettingsManager);
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
        await options.sessionRuntime.switchAgent(options.sessionId, {
            agentName: options.initialAgentInternalName,
            model: options.initialAgentModel,
        });
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
