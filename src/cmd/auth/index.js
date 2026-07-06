/**
 * @module cmd/auth
 * Login/logout/status commands for RunWield-owned model authentication.
 */

import { getModelRegistry as getModelRegistryFn } from "../../shared/models/model-registry.js";

const LOGIN_SUBSCRIPTION_LABEL = "Use a subscription";
const LOGIN_API_KEY_LABEL = "Use an API key";

/**
 * @typedef {Object} CommandDependencies
 * @property {typeof getModelRegistryFn} [getModelRegistry]
 */

/**
 * @param {import('../../cmd/registry.js').CommandContext} options
 * @returns {CommandDependencies}
 */
function getDeps(options) {
    return /** @type {CommandDependencies} */ ((/** @type {any} */ (options)).__testDeps || {});
}

/**
 * @param {import('../../cmd/registry.js').CommandContext} options
 * @returns {import('../../ui/tui/types.js').UiAPI | undefined}
 */
function getUi(options) {
    return options.uiAPI;
}

/**
 * @param {unknown} registry
 * @param {string} providerId
 * @returns {string}
 */
function getProviderDisplayName(registry, providerId) {
    const typedRegistry = /** @type {{ getProviderDisplayName?: (providerId: string) => string }} */ (registry);
    try {
        return typedRegistry.getProviderDisplayName?.(providerId) || providerId;
    } catch {
        return providerId;
    }
}

/**
 * @param {{ authStorage: { getOAuthProviders: () => Array<{ id: string, name: string }> }, getAll: () => Array<{ provider: string }> }} registry
 * @param {"oauth" | "api_key"} authType
 * @returns {Array<{ id: string, name: string, authType: "oauth" | "api_key" }>}
 */
export function getLoginProviderOptions(registry, authType) {
    const oauthProviders = registry.authStorage.getOAuthProviders();
    const oauthProviderIds = new Set(oauthProviders.map((provider) => provider.id));

    if (authType === "oauth") {
        return oauthProviders
            .map((provider) => ({ id: provider.id, name: provider.name, authType }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    const providerIds = new Set(registry.getAll().map((model) => model.provider));
    return Array.from(providerIds)
        .filter((providerId) => !oauthProviderIds.has(providerId))
        .map((providerId) => ({ id: providerId, name: getProviderDisplayName(registry, providerId), authType }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * @param {{ authStorage: { list: () => string[], get: (providerId: string) => { type: "oauth" | "api_key" } | undefined } }} registry
 * @returns {Array<{ id: string, name: string, authType: "oauth" | "api_key" }>}
 */
function getLogoutProviderOptions(registry) {
    /** @type {Array<{ id: string, name: string, authType: "oauth" | "api_key" }>} */
    const providers = [];
    for (const providerId of registry.authStorage.list()) {
        const credential = registry.authStorage.get(providerId);
        if (credential) {
            providers.push({
                id: providerId,
                name: getProviderDisplayName(registry, providerId),
                authType: credential.type,
            });
        }
    }
    return providers.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * @param {string} value
 * @returns {"oauth" | "api_key" | null}
 */
function parseAuthType(value) {
    const normalized = value.trim().toLowerCase();
    if (["subscription", "sub", "oauth"].includes(normalized)) return "oauth";
    if (["key", "api-key", "apikey", "api_key"].includes(normalized)) return "api_key";
    return null;
}

/**
 * @param {import('../../ui/tui/types.js').UiAPI} uiAPI
 * @returns {Promise<"oauth" | "api_key" | null>}
 */
async function promptForAuthType(uiAPI) {
    const selected = await uiAPI.promptSelect("Select authentication method:", [
        { value: "oauth", label: LOGIN_SUBSCRIPTION_LABEL },
        { value: "api_key", label: LOGIN_API_KEY_LABEL },
    ]);
    return selected === "oauth" || selected === "api_key" ? selected : null;
}

/**
 * @param {import('../../ui/tui/types.js').UiAPI} uiAPI
 * @param {Array<{ id: string, name: string, authType: "oauth" | "api_key" }>} providers
 * @param {"login" | "logout"} mode
 * @returns {Promise<{ id: string, name: string, authType: "oauth" | "api_key" } | null>}
 */
async function promptForProvider(uiAPI, providers, mode) {
    const selected = await uiAPI.promptSelect(
        mode === "login" ? "Select provider to configure:" : "Select provider to logout:",
        providers.map((provider) => ({
            value: provider.id,
            label: provider.name,
            description: provider.authType === "oauth" ? "subscription" : "API key",
        })),
    );
    return providers.find((provider) => provider.id === selected) || null;
}

/**
 * @param {import('../../ui/tui/types.js').UiAPI} uiAPI
 * @param {{ id: string, name: string }} provider
 * @param {{ authStorage: { login: (providerId: string, callbacks: any) => Promise<void> } }} registry
 */
async function loginWithSubscription(uiAPI, provider, registry) {
    try {
        await registry.authStorage.login(provider.id, {
            onAuth: (/** @type {{ url: string, instructions?: string }} */ info) => {
                uiAPI.appendSystemMessage(
                    [
                        `Open this URL to login to ${provider.name}:`,
                        info.url,
                        info.instructions || "",
                    ].filter(Boolean).join("\n"),
                );
            },
            onPrompt: async (/** @type {{ message: string, placeholder?: string }} */ prompt) => {
                const value = await uiAPI.promptText(prompt.message, {
                    placeholder: prompt.placeholder,
                    allowEmpty: false,
                });
                if (value === null) throw new Error("Login cancelled");
                return value;
            },
            onProgress: (/** @type {string} */ message) => {
                uiAPI.appendSystemMessage(message);
            },
            onSelect: async (
                /** @type {{ message: string, options: Array<{ id: string, label: string }> }} */ prompt,
            ) => {
                const selected = await uiAPI.promptSelect(
                    prompt.message,
                    prompt.options.map((option) => ({ value: option.id, label: option.label })),
                );
                return selected || undefined;
            },
            onManualCodeInput: async () => {
                const value = await uiAPI.promptText("Paste redirect URL below, or complete login in browser:", {
                    allowEmpty: false,
                });
                if (value === null) throw new Error("Login cancelled");
                return value;
            },
        });
        uiAPI.abortActivePrompt?.();
    } catch (error) {
        uiAPI.abortActivePrompt?.();
        throw error;
    }
}

/**
 * @param {import('../../ui/tui/types.js').UiAPI} uiAPI
 * @param {{ id: string, name: string }} provider
 * @param {{ authStorage: { set: (providerId: string, credential: { type: "api_key", key: string }) => void } }} registry
 */
async function loginWithApiKey(uiAPI, provider, registry) {
    const apiKey = await uiAPI.promptText(`Enter API key for ${provider.name}:`, {
        allowEmpty: false,
    });
    if (apiKey === null) {
        throw new Error("Login cancelled");
    }
    registry.authStorage.set(provider.id, { type: "api_key", key: apiKey.trim() });
}

/**
 * @param {string[]} argv
 * @param {import('../../cmd/registry.js').CommandContext} [options]
 */
export async function runLoginCommand(argv, options = {}) {
    const uiAPI = getUi(options);
    if (!uiAPI) {
        console.log("The /login command is only available in the interactive session.");
        return;
    }

    const deps = getDeps(options);
    const registry = (deps.getModelRegistry || getModelRegistryFn)();
    let authType = argv[0] ? parseAuthType(argv[0]) : null;
    const providerArg = authType ? argv[1] : argv[0];

    if (!authType && providerArg) {
        const oauthProviderIds = new Set(registry.authStorage.getOAuthProviders().map((provider) => provider.id));
        authType = oauthProviderIds.has(providerArg) ? "oauth" : "api_key";
    }

    if (!authType) {
        authType = await promptForAuthType(uiAPI);
    }
    if (!authType) return;

    const providers = getLoginProviderOptions(registry, authType);
    if (providers.length === 0) {
        uiAPI.appendSystemMessage(
            authType === "oauth" ? "No subscription providers available." : "No API key providers available.",
        );
        return;
    }

    let provider = providerArg ? providers.find((candidate) => candidate.id === providerArg) : null;
    if (!provider) {
        provider = await promptForProvider(uiAPI, providers, "login");
    }
    if (!provider) return;

    try {
        if (provider.authType === "oauth") {
            await loginWithSubscription(uiAPI, provider, registry);
        } else {
            await loginWithApiKey(uiAPI, provider, registry);
        }
        registry.refresh?.();
        uiAPI.appendSystemMessage(`Logged in to ${provider.name}.`);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message !== "Login cancelled") {
            uiAPI.appendSystemMessage(`Failed to login to ${provider.name}: ${message}`, true);
        }
    }
}

/**
 * @param {string[]} argv
 * @param {import('../../cmd/registry.js').CommandContext} [options]
 */
export async function runLogoutCommand(argv, options = {}) {
    const uiAPI = getUi(options);
    if (!uiAPI) {
        console.log("The /logout command is only available in the interactive session.");
        return;
    }

    const deps = getDeps(options);
    const registry = (deps.getModelRegistry || getModelRegistryFn)();
    const providers = getLogoutProviderOptions(registry);
    if (providers.length === 0) {
        uiAPI.appendSystemMessage("No stored credentials to remove.");
        return;
    }

    const providerArg = argv[0];
    let provider = providerArg ? providers.find((candidate) => candidate.id === providerArg) : null;
    if (!provider) {
        provider = await promptForProvider(uiAPI, providers, "logout");
    }
    if (!provider) return;

    try {
        registry.authStorage.logout(provider.id);
        registry.refresh?.();
        uiAPI.appendSystemMessage(`Logged out of ${provider.name}.`);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        uiAPI.appendSystemMessage(`Logout failed: ${message}`, true);
    }
}

/**
 * @param {{ authStorage: { get: (providerId: string) => { type: string } | undefined }, getProviderAuthStatus: (providerId: string) => { source?: string, label?: string }, getAvailable: () => unknown[], getAll: () => Array<{ provider: string }> }} registry
 * @param {string} providerId
 * @returns {string}
 */
function formatProviderStatus(registry, providerId) {
    const credential = registry.authStorage.get(providerId);
    if (credential?.type === "oauth") return "subscription stored";
    if (credential?.type === "api_key") return "API key stored";

    const status = registry.getProviderAuthStatus(providerId);
    switch (status.source) {
        case "environment":
            return `environment ${status.label || "API key"}`;
        case "runtime":
            return "runtime API key";
        case "fallback":
            return "custom provider config";
        case "models_json_key":
            return "key in models.json";
        case "models_json_command":
            return "command in models.json";
        case "stored":
            return "stored";
        default:
            return "not configured";
    }
}

/**
 * @param {{ authStorage: { getOAuthProviders: () => Array<{ id: string, name: string }>, list: () => string[], get: (providerId: string) => { type: string } | undefined }, getProviderAuthStatus: (providerId: string) => { source?: string, label?: string }, getAvailable: () => unknown[], getAll: () => Array<{ provider: string }> }} registry
 * @returns {string}
 */
export function formatAuthStatus(registry) {
    const oauthProviderIds = registry.authStorage.getOAuthProviders().map((provider) => provider.id);
    const configuredProviderIds = registry.authStorage.list();
    const providerIds = new Set([...oauthProviderIds, ...configuredProviderIds]);

    for (const model of registry.getAll()) {
        const status = registry.getProviderAuthStatus(model.provider);
        if (status.source) providerIds.add(model.provider);
    }

    const lines = [
        `Available models: ${registry.getAvailable().length}`,
        "Providers:",
    ];

    if (providerIds.size === 0) {
        lines.push("- none configured");
        return lines.join("\n");
    }

    for (const providerId of Array.from(providerIds).sort()) {
        lines.push(
            `- ${getProviderDisplayName(registry, providerId)} (${providerId}): ${
                formatProviderStatus(registry, providerId)
            }`,
        );
    }

    return lines.join("\n");
}

/**
 * @param {string[]} _argv
 * @param {import('../../cmd/registry.js').CommandContext} [options]
 */
export async function runStatusCommand(_argv, options = {}) {
    const deps = getDeps(options);
    const registry = (deps.getModelRegistry || getModelRegistryFn)();
    const status = formatAuthStatus(registry);

    if (options.uiAPI) {
        options.uiAPI.appendSystemMessage(status);
    } else {
        console.log(status);
    }
    await Promise.resolve();
}
