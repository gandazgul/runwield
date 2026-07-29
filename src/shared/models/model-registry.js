import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { dirname, join } from "@std/path";
import { parse as parseJsonc } from "@std/jsonc";
import { getSettingsDir } from "../settings.js";
import { getHomeDir } from "../../constants.js";

const MODEL_CONFIG_FILES = ["models.json", "auth.json"];

/** @type {Promise<import('@earendil-works/pi-coding-agent').ModelRuntime> | null} */
let modelRuntimePromise = null;
/** @type {import('@earendil-works/pi-coding-agent').ModelRuntime | null} */
let resolvedModelRuntime = null;
/** @type {RunWieldCredentialStore | null} */
let modelCredentialStore = null;

/**
 * @returns {string}
 */
export function getRunWieldModelConfigDir() {
    return getSettingsDir("global");
}

/**
 * @param {string} path
 * @returns {boolean}
 */
function fileExists(path) {
    try {
        return Deno.statSync(path).isFile;
    } catch {
        return false;
    }
}

/**
 * @param {string} path
 * @returns {Record<string, any> | null}
 */
function readJsoncObject(path) {
    try {
        const parsed = parseJsonc(Deno.readTextFileSync(path));
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? /** @type {Record<string, any>} */ (parsed)
            : null;
    } catch {
        return null;
    }
}

/**
 * @param {unknown} value
 * @returns {string | undefined}
 */
function resolveLiteralConfigValue(value) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (value && typeof value === "object") {
        const envName = /** @type {{ env?: unknown }} */ (value).env;
        if (typeof envName === "string" && envName.trim()) {
            return Deno.env.get(envName.trim());
        }
    }
    return undefined;
}

/**
 * @param {unknown} payload
 * @returns {string[]}
 */
function readOpenAiModelIds(payload) {
    const data = payload && typeof payload === "object" ? /** @type {{ data?: unknown }} */ (payload).data : undefined;
    const models = Array.isArray(data) ? data : Array.isArray(payload) ? payload : [];
    return models
        .map((item) => item && typeof item === "object" ? /** @type {{ id?: unknown }} */ (item).id : undefined)
        .filter((id) => typeof id === "string" && id.trim().length > 0)
        .map((id) => /** @type {string} */ (id).trim());
}

class RunWieldCredentialStore {
    /** @param {string} authPath */
    constructor(authPath) {
        this.authPath = authPath;
        /** @type {Map<string, Promise<void>>} */
        this.providerMutations = new Map();
    }

    ensureFile() {
        Deno.mkdirSync(dirname(this.authPath), { recursive: true, mode: 0o700 });
        try {
            Deno.statSync(this.authPath);
        } catch {
            Deno.writeTextFileSync(this.authPath, "{}", { mode: 0o600 });
        }
    }

    /** @returns {Record<string, any>} */
    readData() {
        this.ensureFile();
        const parsed = readJsoncObject(this.authPath);
        return parsed || {};
    }

    /** @param {Record<string, any>} data */
    writeData(data) {
        this.ensureFile();
        Deno.writeTextFileSync(this.authPath, JSON.stringify(data, null, 2), { mode: 0o600 });
        try {
            Deno.chmodSync(this.authPath, 0o600);
        } catch {
            // Best effort on platforms that do not support chmod.
        }
    }

    /** @param {string} providerId @returns {Promise<any | undefined>} */
    read(providerId) {
        const credential = this.readData()[providerId];
        const resolved = credential?.type !== "api_key" || credential.key === undefined
            ? credential
            : { ...credential, key: resolveLiteralConfigValue(credential.key) };
        return Promise.resolve(resolved);
    }

    /** @returns {Promise<Array<{ providerId: string, type: "oauth" | "api_key" }>>} */
    list() {
        return Promise.resolve(
            Object.entries(this.readData())
                .filter((entry) => {
                    const credential = entry[1];
                    return credential?.type === "oauth" || credential?.type === "api_key";
                })
                .map(([providerId, credential]) => ({ providerId, type: credential.type })),
        );
    }

    /**
     * Serialize credential mutations for a provider so concurrent OAuth refresh/login
     * read-modify-write calls cannot overwrite each other with stale auth.json data.
     *
     * @template T
     * @param {string} providerId
     * @param {() => Promise<T>} operation
     * @returns {Promise<T>}
     */
    enqueueProviderMutation(providerId, operation) {
        const previous = this.providerMutations.get(providerId) || Promise.resolve();
        const operationPromise = previous.catch(() => {}).then(operation);
        const queuePromise = operationPromise
            .catch(() => {})
            .then(() => {
                if (this.providerMutations.get(providerId) === queuePromise) {
                    this.providerMutations.delete(providerId);
                }
            });
        this.providerMutations.set(providerId, queuePromise);
        return operationPromise;
    }

    /**
     * @param {string} providerId
     * @param {(current: any | undefined) => Promise<any | undefined>} fn
     * @returns {Promise<any | undefined>}
     */
    modify(providerId, fn) {
        return this.enqueueProviderMutation(providerId, async () => {
            const data = this.readData();
            const current = data[providerId];
            const next = await fn(current);
            if (next === undefined) return current;
            data[providerId] = next;
            this.writeData(data);
            return next;
        });
    }

    /** @param {string} providerId @returns {Promise<void>} */
    delete(providerId) {
        return this.enqueueProviderMutation(providerId, () => {
            const data = this.readData();
            delete data[providerId];
            this.writeData(data);
            return Promise.resolve();
        });
    }
}

/** @param {string} configDir @returns {RunWieldCredentialStore} */
function getRunWieldCredentialStore(configDir) {
    const authPath = join(configDir, "auth.json");
    if (!modelCredentialStore || modelCredentialStore.authPath !== authPath) {
        modelCredentialStore = new RunWieldCredentialStore(authPath);
    }
    return modelCredentialStore;
}

/**
 * @param {string} providerId
 * @param {Record<string, any>} providerConfig
 * @returns {any[]}
 */
function readConfiguredModels(providerId, providerConfig) {
    const models = providerConfig.models;
    const entries = Array.isArray(models)
        ? models
        : models && typeof models === "object"
        ? Object.entries(models).map(([id, value]) => ({ id, ...(value && typeof value === "object" ? value : {}) }))
        : [];
    return entries
        .filter((item) => item && typeof item === "object" && typeof item.id === "string")
        .map((item) => ({
            provider: providerId,
            name: item.name ?? item.id,
            api: item.api ?? providerConfig.api,
            baseUrl: item.baseUrl ?? providerConfig.baseUrl,
            reasoning: item.reasoning ?? false,
            input: Array.isArray(item.input) ? item.input : ["text"],
            cost: item.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: item.contextWindow ?? 128000,
            maxTokens: item.maxTokens ?? 16384,
            headers: item.headers,
            compat: item.compat,
            ...item,
            id: item.id,
        }));
}

/** @returns {any[]} */
function readBuiltinModels() {
    return builtinProviders().flatMap((provider) => {
        try {
            return Array.from(provider.getModels());
        } catch {
            return [];
        }
    });
}

/**
 * @param {Record<string, any> | undefined} credential
 * @returns {boolean}
 */
function isConfiguredStoredCredential(credential) {
    if (!credential || typeof credential !== "object") return false;
    if (credential.type === "oauth") return true;
    if (credential.type === "api_key") return Boolean(resolveLiteralConfigValue(credential.key));
    return false;
}

export class RunWieldModelRegistry {
    /**
     * @param {{ runtime?: import('@earendil-works/pi-coding-agent').ModelRuntime | null, runtimePromise?: Promise<import('@earendil-works/pi-coding-agent').ModelRuntime>, configDir?: string, credentialStore?: RunWieldCredentialStore }} [options]
     */
    constructor(options = {}) {
        this.runtime = options.runtime || resolvedModelRuntime;
        this.runtimePromise = options.runtimePromise || modelRuntimePromise || undefined;
        this.configDir = options.configDir || getRunWieldModelConfigDir();
        this.credentialStore = options.credentialStore || getRunWieldCredentialStore(this.configDir);
        /** @type {Map<string, any>} */
        this.registeredModels = new Map();
        if (this.runtimePromise && !this.runtime) {
            this.runtimePromise.then((runtime) => {
                this.runtime = runtime;
            }).catch(() => {});
        }
    }

    /**
     * @returns {Promise<import('@earendil-works/pi-coding-agent').ModelRuntime>}
     */
    async getRuntime() {
        const runtime = this.runtime || await (this.runtimePromise || getModelRuntime());
        this.runtime = runtime;
        return runtime;
    }

    /**
     * @returns {Array<{ id: string, name: string }>}
     */
    getOAuthProviders() {
        return (this.runtime?.getProviders() || [])
            .filter((provider) => Boolean(provider.auth?.oauth))
            .map((provider) => ({ id: provider.id, name: provider.name }));
    }

    /**
     * @returns {Promise<Array<{ id: string, name: string, authType: "oauth" | "api_key" }>>}
     */
    async listStoredCredentialProviders() {
        const runtime = await this.getRuntime();
        const credentials = await runtime.listCredentials();
        return credentials.map((credential) => ({
            id: credential.providerId,
            name: this.getProviderDisplayName(credential.providerId),
            authType: credential.type,
        }));
    }

    /**
     * @param {string} providerId
     * @returns {Promise<"oauth" | "api_key" | undefined>}
     */
    async getStoredCredentialType(providerId) {
        const credential = (await this.listStoredCredentialProviders()).find((item) => item.id === providerId);
        return credential?.authType;
    }

    /**
     * @param {string} providerId
     * @param {"oauth" | "api_key"} authType
     * @param {import('@earendil-works/pi-ai').AuthInteraction} interaction
     * @returns {Promise<void>}
     */
    async loginProvider(providerId, authType, interaction) {
        const runtime = await this.getRuntime();
        await runtime.login(providerId, authType, interaction);
    }

    /**
     * @param {string} providerId
     * @param {string} apiKey
     * @returns {Promise<void>}
     */
    async setProviderApiKey(providerId, apiKey) {
        await this.credentialStore.modify(providerId, () => Promise.resolve({ type: "api_key", key: apiKey }));
        const runtime = await this.getRuntime();
        await runtime.refresh({ allowNetwork: false });
    }

    /** @param {string} providerId @returns {Promise<void>} */
    async logoutProvider(providerId) {
        const runtime = await this.getRuntime();
        await runtime.logout(providerId);
    }

    /** @returns {Promise<void>} */
    async refresh() {
        const runtime = await (this.runtimePromise || getModelRuntime());
        this.runtime = runtime;
        await runtime.refresh();
    }

    /** @returns {string | undefined} */
    getError() {
        return this.runtime?.getError();
    }

    /** @returns {any[]} */
    getAll() {
        const runtimeModels = this.runtime ? Array.from(this.runtime.getModels()) : readBuiltinModels();
        return [...runtimeModels, ...this.registeredModels.values(), ...this.getConfiguredModels()];
    }

    /** @returns {any[]} */
    getAvailable() {
        const models = this.runtime
            ? Array.from(this.runtime.getAvailableSnapshot())
            : this.getAll().filter((model) => this.hasConfiguredAuth(model));
        return models.filter((model, index) =>
            index === models.findIndex((item) => item.provider === model.provider && item.id === model.id)
        );
    }

    /**
     * @param {string} provider
     * @param {string} modelId
     * @returns {any | undefined}
     */
    find(provider, modelId) {
        return this.runtime?.getModel(provider, modelId) || this.registeredModels.get(`${provider}/${modelId}`) ||
            this.getConfiguredModels().find((model) => model.provider === provider && model.id === modelId) ||
            readBuiltinModels().find((model) => model.provider === provider && model.id === modelId);
    }

    /**
     * @param {any} model
     * @returns {boolean}
     */
    hasConfiguredAuth(model) {
        if (!model) return false;
        if (this.runtime?.hasConfiguredAuth(model.provider)) return true;
        const status = this.getProviderAuthStatus(model.provider);
        return Boolean(status.configured);
    }

    /**
     * @param {any} model
     * @returns {Promise<{ ok: true, apiKey?: string, headers?: Record<string, string>, env?: Record<string, string> } | { ok: false, error: string }>}
     */
    async getApiKeyAndHeaders(model) {
        const runtime = this.runtime || await (this.runtimePromise || getModelRuntime());
        this.runtime = runtime;
        const auth = await runtime.getAuth(model);
        if (auth) {
            return {
                ok: true,
                apiKey: auth.auth.apiKey,
                headers: /** @type {Record<string, string> | undefined} */ (auth.auth.headers),
                env: auth.env,
            };
        }
        const compatibility = typeof runtime.getCompatibilityRequestConfig === "function"
            ? runtime.getCompatibilityRequestConfig(model)
            : undefined;
        const providerConfig = this.getProviderConfig(model.provider);
        const apiKey = resolveLiteralConfigValue(providerConfig?.apiKey);
        const headers = /** @type {Record<string, string> | undefined} */ (compatibility?.headers);
        if (apiKey || headers) return { ok: true, apiKey, headers };
        return { ok: false, error: `No configured auth for provider ${model.provider}` };
    }

    /**
     * @param {string} provider
     * @returns {{ configured: boolean, source?: string, label?: string }}
     */
    getProviderAuthStatus(provider) {
        const runtimeStatus = this.runtime?.getProviderAuthStatus(provider);
        if (runtimeStatus?.configured) return runtimeStatus;
        const providerConfig = this.getProviderConfig(provider);
        if (resolveLiteralConfigValue(providerConfig?.apiKey)) {
            return { configured: true, source: "models_json_key", label: "models.json apiKey" };
        }
        if (isConfiguredStoredCredential(this.credentialStore.readData()[provider])) {
            return { configured: true, source: "auth_json", label: "auth.json credential" };
        }
        return runtimeStatus || { configured: false };
    }

    /**
     * @param {string} provider
     * @returns {any | undefined}
     */
    getProvider(provider) {
        return this.runtime?.getProvider(provider) || builtinProviders().find((item) => item.id === provider) ||
            this.getProviderConfig(provider);
    }

    /**
     * @param {string} provider
     * @returns {string}
     */
    getProviderDisplayName(provider) {
        return this.runtime?.getProvider(provider)?.name || this.getProviderConfig(provider)?.name || provider;
    }

    /**
     * @param {string} provider
     * @returns {Promise<any>}
     */
    async getProviderAuth(provider) {
        const runtime = this.runtime || await (this.runtimePromise || getModelRuntime());
        this.runtime = runtime;
        return await runtime.getAuth(provider);
    }

    /**
     * @param {string} provider
     * @returns {Promise<string | undefined>}
     */
    async getApiKeyForProvider(provider) {
        const auth = await this.getProviderAuth(provider);
        return auth?.apiKey || resolveLiteralConfigValue(this.getProviderConfig(provider)?.apiKey);
    }

    /** @param {any} model @returns {boolean} */
    isUsingOAuth(model) {
        return Boolean(this.runtime?.isUsingOAuth(model.provider));
    }

    /**
     * @param {string | any} provider
     * @param {any} [config]
     */
    registerProvider(provider, config) {
        const providerId = typeof provider === "string" ? provider : provider.id;
        const providerConfig = typeof provider === "string" ? config : provider;
        if (!providerId || !providerConfig) return;
        this.runtime?.registerProvider(providerId, providerConfig);
        if (this.runtimePromise && !this.runtime) {
            this.runtimePromise.then((runtime) => runtime.registerProvider(providerId, providerConfig)).catch(() => {});
        }
        for (const model of readConfiguredModels(providerId, providerConfig)) {
            this.registeredModels.set(`${providerId}/${model.id}`, model);
        }
    }

    /** @param {string} provider */
    unregisterProvider(provider) {
        this.runtime?.unregisterProvider(provider);
        for (const key of this.registeredModels.keys()) {
            if (key.startsWith(`${provider}/`)) this.registeredModels.delete(key);
        }
    }

    /** @param {string} provider @returns {any | undefined} */
    getRegisteredProviderConfig(provider) {
        return this.runtime?.getRegisteredProviderConfig(provider) || this.getProviderConfig(provider);
    }

    /** @param {string} provider @returns {any | undefined} */
    getRegisteredNativeProvider(provider) {
        return this.runtime?.getRegisteredNativeProvider(provider);
    }

    /** @returns {readonly string[]} */
    getRegisteredProviderIds() {
        const configured = Object.keys(this.readModelsConfig().providers || {});
        const runtime = this.runtime?.getRegisteredProviderIds() || [];
        return [...new Set([...runtime, ...configured])];
    }

    /** @returns {Record<string, any>} */
    readModelsConfig() {
        return readJsoncObject(join(this.configDir, "models.json")) || {};
    }

    /** @param {string} provider @returns {Record<string, any> | undefined} */
    getProviderConfig(provider) {
        const providers = this.readModelsConfig().providers;
        const config = providers && typeof providers === "object" ? providers[provider] : undefined;
        return config && typeof config === "object" ? config : undefined;
    }

    /** @returns {any[]} */
    getConfiguredModels() {
        const providers = this.readModelsConfig().providers;
        if (!providers || typeof providers !== "object") return [];
        return Object.entries(providers).flatMap(([provider, config]) => {
            return config && typeof config === "object" ? readConfiguredModels(provider, config) : [];
        });
    }
}

/**
 * Discover a model from a custom OpenAI-compatible provider using `/models`.
 *
 * @param {RunWieldModelRegistry} modelRegistry
 * @param {string} provider
 * @param {string} modelId
 * @param {{
 *   runwieldDir?: string,
 *   fetchFn?: typeof fetch,
 *   input?: ("text" | "image")[],
 * }} [options]
 * @returns {Promise<any | undefined>}
 */
export async function discoverProviderModel(modelRegistry, provider, modelId, options = {}) {
    const existing = modelRegistry.find(provider, modelId);
    if (existing) return existing;

    const runwieldDir = options.runwieldDir ?? getRunWieldModelConfigDir();
    const modelsConfig = readJsoncObject(join(runwieldDir, "models.json"));
    const providerConfig = /** @type {Record<string, any> | undefined} */ (
        modelsConfig?.providers?.[provider]
    );
    if (!providerConfig || typeof providerConfig !== "object") return undefined;

    const baseUrl = typeof providerConfig.baseUrl === "string" ? providerConfig.baseUrl.trim() : "";
    const api = typeof providerConfig.api === "string" ? providerConfig.api.trim() : "";
    const apiKey = resolveLiteralConfigValue(providerConfig.apiKey);
    if (!baseUrl || !api || !apiKey) return undefined;

    const fetchFn = options.fetchFn ?? fetch;
    const response = await fetchFn(`${baseUrl.replace(/\/+$/, "")}/models`, {
        headers: {
            Accept: "application/json",
            Authorization: `Bearer ${apiKey}`,
        },
    });
    if (!response.ok) {
        throw new Error(
            `model discovery failed for provider "${provider}" (${response.status} ${response.statusText})`,
        );
    }

    const ids = readOpenAiModelIds(await response.json());
    if (!ids.includes(modelId)) return undefined;

    const imageInputModels = Array.isArray(providerConfig.imageInputModels) ? providerConfig.imageInputModels : [];
    /** @type {("text" | "image")[]} */
    const resolvedInput = options.input ?? (imageInputModels.includes(modelId) ? ["text", "image"] : ["text"]);

    modelRegistry.registerProvider(provider, {
        name: providerConfig.name ?? provider,
        baseUrl,
        apiKey,
        api,
        authHeader: providerConfig.authHeader,
        headers: providerConfig.headers,
        models: [{
            id: modelId,
            name: modelId,
            api,
            baseUrl,
            reasoning: false,
            input: resolvedInput,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 128000,
            maxTokens: 16384,
        }],
    });

    return modelRegistry.find(provider, modelId);
}

/**
 * @param {string} fileName
 * @param {string} homeDir
 * @returns {string[]}
 */
function getPiConfigMigrationCandidates(fileName, homeDir) {
    if (!homeDir) return [];
    return [
        join(homeDir, ".pi", "agent", fileName),
        join(homeDir, ".pi", fileName),
    ];
}

/**
 * @param {{ targetDir: string, sourceCandidatesByFile: (fileName: string) => string[] }} options
 * @returns {{ copied: string[], skipped: string[], failed: Array<{ file: string, error: string }> }}
 */
function migrateModelConfigFilesOnce(options) {
    const targetDir = options.targetDir;
    /** @type {string[]} */
    const copied = [];
    /** @type {string[]} */
    const skipped = [];
    /** @type {Array<{ file: string, error: string }>} */
    const failed = [];

    for (const fileName of MODEL_CONFIG_FILES) {
        const targetPath = join(targetDir, fileName);
        if (fileExists(targetPath)) {
            skipped.push(fileName);
            continue;
        }

        const sourcePath = options.sourceCandidatesByFile(fileName).find(fileExists);
        if (!sourcePath) {
            skipped.push(fileName);
            continue;
        }

        try {
            Deno.mkdirSync(targetDir, { recursive: true });
            Deno.copyFileSync(sourcePath, targetPath);
            copied.push(fileName);
        } catch (error) {
            failed.push({ file: fileName, error: error instanceof Error ? error.message : String(error) });
        }
    }

    return { copied, skipped, failed };
}

/**
 * One-time import of Pi-owned model/auth files into RunWield-owned config.
 * Existing RunWield files always win; Pi is never used as a runtime fallback.
 *
 * @param {{ homeDir?: string, runwieldDir?: string }} [options]
 * @returns {{ copied: string[], skipped: string[], failed: Array<{ file: string, error: string }> }}
 */
export function migratePiModelConfigOnce(options = {}) {
    const homeDir = options.homeDir ?? getHomeDir();
    const runwieldDir = options.runwieldDir ?? getRunWieldModelConfigDir();
    return migrateModelConfigFilesOnce({
        targetDir: runwieldDir,
        sourceCandidatesByFile: (fileName) => getPiConfigMigrationCandidates(fileName, homeDir),
    });
}

/**
 * Create the canonical Pi model runtime using RunWield-owned config paths.
 * @returns {Promise<import('@earendil-works/pi-coding-agent').ModelRuntime>}
 */
export async function createRunWieldModelRuntime() {
    const agentDir = getRunWieldModelConfigDir();
    const piMigration = migratePiModelConfigOnce({ runwieldDir: agentDir });
    for (const failure of piMigration.failed) {
        console.warn(`Failed to migrate Pi ${failure.file} to RunWield config: ${failure.error}`);
    }
    const credentialStore = getRunWieldCredentialStore(agentDir);
    return await ModelRuntime.create({
        credentials: credentialStore,
        authPath: join(agentDir, "auth.json"),
        modelsPath: join(agentDir, "models.json"),
    });
}

/**
 * @returns {Promise<import('@earendil-works/pi-coding-agent').ModelRuntime>}
 */
export function getModelRuntime() {
    if (!modelRuntimePromise) {
        modelRuntimePromise = createRunWieldModelRuntime().then((runtime) => {
            resolvedModelRuntime = runtime;
            return runtime;
        });
    }
    return modelRuntimePromise;
}

/**
 * Get a RunWield-owned compatibility model registry facade.
 * @returns {RunWieldModelRegistry}
 */
export function getModelRegistry() {
    const agentDir = getRunWieldModelConfigDir();
    const piMigration = migratePiModelConfigOnce({ runwieldDir: agentDir });
    for (const failure of piMigration.failed) {
        console.warn(`Failed to migrate Pi ${failure.file} to RunWield config: ${failure.error}`);
    }
    if (!modelRuntimePromise) modelRuntimePromise = getModelRuntime();
    return new RunWieldModelRegistry({
        runtime: resolvedModelRuntime,
        runtimePromise: modelRuntimePromise,
        configDir: agentDir,
        credentialStore: getRunWieldCredentialStore(agentDir),
    });
}
