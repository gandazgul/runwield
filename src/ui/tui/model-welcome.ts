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
import { getModelRegistry } from "../../shared/models/model-registry.ts";
import { getSettingsManager } from "../../shared/settings.js";
import type { SessionRuntime } from "../../shared/session/session-runtime.js";
import type { Editor, TUI } from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.js";
import type { UiAPI } from "./types.js";

export interface ModelAvailability {
    available: boolean;
    error: string | null;
}

export interface ModelActivationResult {
    status?: "active" | "deferred";
    message?: string;
}

/**
 * A model-summary shape sufficient for availability classification. The real
 * `RunWieldModelRegistry` satisfies it structurally; tests may hand a plain
 * value to the pure `detectModelAvailability` contract.
 */
export interface ModelSummary {
    id: string;
    provider: string;
    executionBackend?: string;
}

/**
 * The read surface availability checks need from a model registry *value* —
 * never a replaceable authority.
 */
export interface ModelAvailabilitySource {
    getAvailable(): readonly ModelSummary[];
    find?(provider: string, id: string): ModelSummary | undefined;
}

export interface MaybeShowModelWelcomeOptions {
    uiAPI: UiAPI;
    editor: Editor;
    tui: TUI;
    sessionId: string;
    sessionRuntime: SessionRuntime;
    initialAgentInternalName: string;
    initialAgentModel?: string;
    setActiveModel?(
        model: string,
        provider?: string,
    ): Promise<ModelActivationResult | void> | ModelActivationResult | void;
    forceModelSelection?: boolean;
    /** Project root that scopes the settings manager used for defaults. */
    projectRoot: string;
}

export interface ModelWelcomeResult {
    shown: boolean;
    suppressBootBanner: boolean;
    noModel: boolean;
    setupCompleted: boolean;
    availabilityError?: string | null;
}

function isRegistryModelSummary(value: ModelSummary | undefined): value is ModelSummary {
    return Boolean(value && typeof value === "object");
}

/**
 * Pure value contract: classify a registry snapshot's available-model count.
 *
 * @param registry A registry value (never an injected authority).
 */
export function detectModelAvailability(registry: ModelAvailabilitySource): ModelAvailability {
    try {
        return { available: (registry.getAvailable?.() || []).length > 0, error: null };
    } catch (error) {
        return { available: false, error: error instanceof Error ? error.message : String(error) };
    }
}

/** @returns {ModelAvailability} */
export function getConfiguredModelAvailability(): ModelAvailability {
    try {
        return detectModelAvailability(getModelRegistry());
    } catch (error) {
        return { available: false, error: error instanceof Error ? error.message : String(error) };
    }
}

/** @returns {ModelAvailability} */
export function getConfiguredProviderAvailability(): ModelAvailability {
    try {
        return { available: (getModelRegistry().getRegisteredProviderIds?.() || []).length > 0, error: null };
    } catch (error) {
        return { available: false, error: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * Whether the persisted default model is runnable right now. Registry or
 * settings failures become `{ available: false, error }` — this never throws.
 *
 * @param projectRoot Project root that scopes the settings manager.
 * @returns {ModelAvailability}
 */
export function getSelectedDefaultModelAvailability(projectRoot: string): ModelAvailability {
    try {
        const settingsManager = getSettingsManager(projectRoot);
        const defaultModel = settingsManager.getDefaultModel?.()?.trim();
        const defaultProvider = settingsManager.getDefaultProvider?.()?.trim();
        if (!defaultModel) {
            return { available: false, error: "No default model is selected." };
        }

        const registry = getModelRegistry();
        if (!registry.find) return { available: true, error: null };
        const found = registry.find(defaultProvider || "", defaultModel);
        const foundModel = isRegistryModelSummary(found) ? found : null;
        const availableModels = registry.getAvailable?.() || [];
        const runnable = availableModels.some((model) =>
            model.provider === (defaultProvider || foundModel?.provider) &&
            model.id === (foundModel?.id || defaultModel)
        );
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
            await commandRegistry[COMMAND_NAMES.QUIT].execute([], runCommandContext(options));
            return { shown: true, suppressBootBanner: true, noModel: true, setupCompleted: false };
        }

        const loginArg = choice === "subscription" ? "subscription" : "api-key";
        await commandRegistry[COMMAND_NAMES.LOGIN].execute([loginArg], {
            ...runCommandContext(options),
            skipPostLoginSetup: true,
        });

        afterLoginAvailability = getConfiguredModelAvailability();
    }

    await commandRegistry[COMMAND_NAMES.MODEL].execute([], {
        ...runCommandContext(options),
        setActiveModel: options.setActiveModel,
    });

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
