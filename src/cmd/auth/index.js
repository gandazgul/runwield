/*
 * @module cmd/auth
 * Login/logout/status commands for RunWield-owned model authentication.
 */

import { AGENTS } from "../../constants.js";
import { getModelRegistry as getModelRegistryFn } from "../../shared/models/model-registry.js";

const LOGIN_SUBSCRIPTION_LABEL = "Use a subscription";
const LOGIN_API_KEY_LABEL = "Use an API key";
const LOGIN_BACK_VALUE = "__runwield_login_back__";

/**
 * @typedef {Object} CommandDependencies
 * @property {typeof getModelRegistryFn} [getModelRegistry]
 */

/**
 * @typedef {Object} AuthProviderOption
 * @property {string} id
 * @property {string} name
 * @property {"oauth" | "api_key"} authType
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
 * @param {any} registry
 * @returns {Promise<void>}
 */
async function hydrateModelRegistry(registry) {
    if (typeof registry.getRuntime === "function") await registry.getRuntime();
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
 * @param {any} registry
 * @returns {Array<{ id: string, name: string }>}
 */
function getOAuthProviders(registry) {
    if (typeof registry.getOAuthProviders === "function") return registry.getOAuthProviders();
    return registry.authStorage?.getOAuthProviders?.() || [];
}

/**
 * @param {any} registry
 * @returns {Promise<AuthProviderOption[]>}
 */
async function listStoredCredentialProviders(registry) {
    if (typeof registry.listStoredCredentialProviders === "function") {
        return await registry.listStoredCredentialProviders();
    }
    /** @type {AuthProviderOption[]} */
    const providers = [];
    for (const providerId of registry.authStorage?.list?.() || []) {
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
 * @param {any} registry
 * @param {string} providerId
 * @returns {Promise<"oauth" | "api_key" | undefined>}
 */
async function getStoredCredentialType(registry, providerId) {
    if (typeof registry.getStoredCredentialType === "function") {
        return await registry.getStoredCredentialType(providerId);
    }
    return registry.authStorage?.get?.(providerId)?.type;
}

/**
 * @param {any} registry
 * @param {string} providerId
 * @param {string} apiKey
 * @returns {Promise<void>}
 */
async function setProviderApiKey(registry, providerId, apiKey) {
    if (typeof registry.setProviderApiKey === "function") {
        await registry.setProviderApiKey(providerId, apiKey);
        return;
    }
    await registry.authStorage.set(providerId, { type: "api_key", key: apiKey });
}

/**
 * @param {any} registry
 * @param {string} providerId
 * @returns {Promise<void>}
 */
async function logoutProvider(registry, providerId) {
    if (typeof registry.logoutProvider === "function") {
        await registry.logoutProvider(providerId);
        return;
    }
    await registry.authStorage.logout(providerId);
}

/**
 * @param {{ authStorage?: { getOAuthProviders?: () => Array<{ id: string, name: string }> }, getOAuthProviders?: () => Array<{ id: string, name: string }>, getAll: () => Array<{ provider: string }> }} registry
 * @param {"oauth" | "api_key"} authType
 * @returns {Array<AuthProviderOption>}
 */
export function getLoginProviderOptions(registry, authType) {
    const oauthProviders = getOAuthProviders(registry);
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
 * @param {any} registry
 * @returns {Promise<AuthProviderOption[]>}
 */
async function getLogoutProviderOptions(registry) {
    return (await listStoredCredentialProviders(registry)).sort((a, b) => a.name.localeCompare(b.name));
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
 * @param {string} url
 * @returns {string}
 */
function formatClickableTerminalUrl(url) {
    const safeUrl = Array.from(url).filter((char) => {
        const code = char.charCodeAt(0);
        return code >= 32 && code !== 127;
    }).join("");
    return `\x1b]8;;${safeUrl}\x07${safeUrl}\x1b]8;;\x07`;
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
 * @param {AuthProviderOption[]} providers
 * @param {"login" | "logout"} mode
 * @param {{ allowBack?: boolean }} [options]
 * @returns {Promise<AuthProviderOption | "back" | null>}
 */
async function promptForProvider(uiAPI, providers, mode, options = {}) {
    const providerOptions = providers.map((provider) => ({
        value: provider.id,
        label: provider.name,
        description: provider.authType === "oauth" ? "subscription" : "API key",
    }));
    const selected = await uiAPI.promptSelect(
        mode === "login" ? "Select provider to configure:" : "Select provider to logout:",
        options.allowBack
            ? [
                { value: LOGIN_BACK_VALUE, label: "Back", description: "Choose a different authentication method" },
                ...providerOptions,
            ]
            : providerOptions,
    );
    if (selected === LOGIN_BACK_VALUE || (selected === null && options.allowBack)) return "back";
    return providers.find((provider) => provider.id === selected) || null;
}

/**
 * @param {import('../../ui/tui/types.js').UiAPI} uiAPI
 * @param {{ id: string, name: string }} provider
 * @param {any} registry
 */
async function loginWithSubscription(uiAPI, provider, registry) {
    try {
        if (typeof registry.loginProvider === "function") {
            await registry.loginProvider(provider.id, "oauth", {
                notify: (/** @type {import('@earendil-works/pi-ai').AuthEvent} */ event) => {
                    if (event.type === "auth_url") {
                        uiAPI.appendSystemMessage(
                            [
                                `Open this URL to login to ${provider.name}:`,
                                formatClickableTerminalUrl(event.url),
                                event.instructions || "",
                            ].filter(Boolean).join("\n"),
                        );
                    } else if (event.type === "progress" || event.type === "info") {
                        uiAPI.appendSystemMessage(event.message);
                    } else if (event.type === "device_code") {
                        uiAPI.appendSystemMessage(
                            `Open ${
                                formatClickableTerminalUrl(event.verificationUri)
                            } and enter code ${event.userCode}`,
                        );
                    }
                },
                prompt: async (/** @type {import('@earendil-works/pi-ai').AuthPrompt} */ prompt) => {
                    if (prompt.type === "select") {
                        const selected = await uiAPI.promptSelect(
                            prompt.message,
                            prompt.options.map((/** @type {{ id: string, label: string }} */ option) => ({
                                value: option.id,
                                label: option.label,
                            })),
                        );
                        if (!selected) throw new Error("Login cancelled");
                        return selected;
                    }
                    const value = await uiAPI.promptText(prompt.message, {
                        placeholder: prompt.placeholder,
                        allowEmpty: false,
                    });
                    if (value === null) throw new Error("Login cancelled");
                    return value;
                },
            });
        } else {
            await registry.authStorage.login(provider.id, {
                onAuth: (/** @type {{ url: string, instructions?: string }} */ info) => {
                    uiAPI.appendSystemMessage(
                        [
                            `Open this URL to login to ${provider.name}:`,
                            formatClickableTerminalUrl(info.url),
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
        }
        uiAPI.abortActivePrompt?.();
    } catch (error) {
        uiAPI.abortActivePrompt?.();
        throw error;
    }
}

/**
 * @param {import('../../ui/tui/types.js').UiAPI} uiAPI
 * @param {{ id: string, name: string }} provider
 * @param {any} registry
 */
async function loginWithApiKey(uiAPI, provider, registry) {
    const apiKey = await uiAPI.promptText(`Enter API key for ${provider.name}:`, {
        allowEmpty: false,
        persistResult: false,
    });
    if (apiKey === null) throw new Error("Login cancelled");
    await setProviderApiKey(registry, provider.id, apiKey.trim());
}

/**
 * @param {import('../../cmd/registry.js').CommandContext} options
 * @param {{ getAvailable?: () => unknown[] }} registry
 */
async function configureInteractiveSessionAfterLogin(options, registry) {
    const availableModels = typeof registry.getAvailable === "function" ? registry.getAvailable() : [];
    if (availableModels.length > 0) await options.uiAPI?.showModelSelector?.();
    if (options.sessionId && options.sessionRuntime) {
        await options.sessionRuntime.switchAgent(options.sessionId, { agentName: AGENTS.ROUTER });
    }
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
    await hydrateModelRegistry(registry);
    let authType = argv[0] ? parseAuthType(argv[0]) : null;
    const providerArg = authType ? argv[1] : argv[0];

    if (!authType && providerArg) {
        const oauthProviderIds = new Set(getOAuthProviders(registry).map((provider) => provider.id));
        authType = oauthProviderIds.has(providerArg) ? "oauth" : "api_key";
    }

    while (true) {
        if (!authType) authType = await promptForAuthType(uiAPI);
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
            const selectedProvider = await promptForProvider(uiAPI, providers, "login", { allowBack: true });
            if (selectedProvider === "back") {
                authType = null;
                continue;
            }
            provider = selectedProvider;
        }
        if (!provider) return;

        try {
            if (provider.authType === "oauth") await loginWithSubscription(uiAPI, provider, registry);
            else await loginWithApiKey(uiAPI, provider, registry);
            await registry.refresh?.();
            uiAPI.appendSystemMessage(`Logged in to ${provider.name}.`);
            if (!options.skipPostLoginSetup) await configureInteractiveSessionAfterLogin(options, registry);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message !== "Login cancelled") {
                uiAPI.appendSystemMessage(`Failed to login to ${provider.name}: ${message}`, true);
            }
        }
        return;
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
    await hydrateModelRegistry(registry);
    const providers = await getLogoutProviderOptions(registry);
    if (providers.length === 0) {
        uiAPI.appendSystemMessage("No stored credentials to remove.");
        return;
    }

    const providerArg = argv[0];
    let provider = providerArg ? providers.find((candidate) => candidate.id === providerArg) : null;
    if (!provider) {
        const selectedProvider = await promptForProvider(uiAPI, providers, "logout");
        provider = selectedProvider === "back" ? null : selectedProvider;
    }
    if (!provider) return;

    try {
        await logoutProvider(registry, provider.id);
        await registry.refresh?.();
        uiAPI.appendSystemMessage(`Logged out of ${provider.name}.`);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        uiAPI.appendSystemMessage(`Logout failed: ${message}`, true);
    }
}

/**
 * @param {any} registry
 * @param {string} providerId
 * @returns {string}
 */
function formatProviderStatusSync(registry, providerId) {
    const credential = registry.authStorage?.get?.(providerId);
    if (credential?.type === "oauth") return "subscription stored";
    if (credential?.type === "api_key") return "API key stored";
    return formatProviderAuthStatus(registry, providerId);
}

/**
 * @param {any} registry
 * @param {string} providerId
 * @returns {string}
 */
function formatProviderAuthStatus(registry, providerId) {
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
 * @param {any} registry
 * @param {string} providerId
 * @returns {Promise<string>}
 */
async function formatProviderStatusAsync(registry, providerId) {
    const credentialType = await getStoredCredentialType(registry, providerId);
    if (credentialType === "oauth") return "subscription stored";
    if (credentialType === "api_key") return "API key stored";
    return formatProviderAuthStatus(registry, providerId);
}

/**
 * Synchronous test/helper formatting for legacy registry fakes.
 * @param {any} registry
 * @returns {string}
 */
export function formatAuthStatus(registry) {
    const oauthProviderIds = getOAuthProviders(registry).map((provider) => provider.id);
    const configuredProviderIds = registry.authStorage?.list?.() || [];
    const providerIds = new Set([...oauthProviderIds, ...configuredProviderIds]);
    for (const model of registry.getAll()) {
        const status = registry.getProviderAuthStatus(model.provider);
        if (status.source) providerIds.add(model.provider);
    }
    return formatAuthStatusLines(registry, providerIds, formatProviderStatusSync);
}

/**
 * @param {any} registry
 * @returns {Promise<string>}
 */
async function formatAuthStatusForRuntime(registry) {
    const oauthProviderIds = getOAuthProviders(registry).map((provider) => provider.id);
    const storedProviders = await listStoredCredentialProviders(registry);
    const providerIds = new Set([...oauthProviderIds, ...storedProviders.map((provider) => provider.id)]);
    for (const model of registry.getAll()) {
        const status = registry.getProviderAuthStatus(model.provider);
        if (status.source) providerIds.add(model.provider);
    }
    return await formatAuthStatusLinesAsync(registry, providerIds);
}

/**
 * @param {any} registry
 * @param {Set<string>} providerIds
 * @param {(registry: any, providerId: string) => string} formatProviderStatus
 * @returns {string}
 */
function formatAuthStatusLines(registry, providerIds, formatProviderStatus) {
    const lines = [`Available models: ${registry.getAvailable().length}`, "Providers:"];
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
 * @param {any} registry
 * @param {Set<string>} providerIds
 * @returns {Promise<string>}
 */
async function formatAuthStatusLinesAsync(registry, providerIds) {
    const lines = [`Available models: ${registry.getAvailable().length}`, "Providers:"];
    if (providerIds.size === 0) {
        lines.push("- none configured");
        return lines.join("\n");
    }
    for (const providerId of Array.from(providerIds).sort()) {
        lines.push(
            `- ${getProviderDisplayName(registry, providerId)} (${providerId}): ${await formatProviderStatusAsync(
                registry,
                providerId,
            )}`,
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
    await hydrateModelRegistry(registry);
    const status = await formatAuthStatusForRuntime(registry);
    if (options.uiAPI) options.uiAPI.appendSystemMessage(status);
    else console.log(status);
}
