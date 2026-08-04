import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import type {
    Api,
    AuthInteraction,
    AuthType,
    Credential,
    CredentialInfo,
    Model,
    Provider,
} from "@earendil-works/pi-ai";
import { dirname, join } from "@std/path";
import { parse as parseJsonc } from "@std/jsonc";
import { getSettingsDir } from "../settings.js";
import { getHomeDir } from "../../constants.js";

export type ExecutionBackend = "pi" | "claude-cli";
export type AuthenticationKind = "api-auth" | "external-cli";
export type HealthCheckKind = "api-auth" | "execution-preflight";

export interface ModelExecutionMetadata {
    executionBackend?: ExecutionBackend;
    authenticationKind?: AuthenticationKind;
    healthCheck?: HealthCheckKind;
}

export type RunWieldModel = Model<Api> & ModelExecutionMetadata;

type JsonPrimitive = string | number | boolean | null;
interface JsonObject {
    [key: string]: JsonValue;
}
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

type ConfigValue = JsonValue | undefined;
interface ConfigObject {
    [key: string]: ConfigValue;
}

interface ConfiguredCredential extends ConfigObject {
    type?: string;
    key?: ConfigValue;
}

interface CredentialData {
    [providerId: string]: ConfiguredCredential | undefined;
}

interface ConfiguredModelInput extends ConfigObject {
    id?: ConfigValue;
    name?: ConfigValue;
    api?: ConfigValue;
    baseUrl?: ConfigValue;
    reasoning?: ConfigValue;
    input?: ConfigValue;
    cost?: ConfigValue;
    contextWindow?: ConfigValue;
    maxTokens?: ConfigValue;
    headers?: ConfigValue;
    compat?: ConfigValue;
}

interface ConfiguredProviderInput extends ConfigObject {
    name?: ConfigValue;
    api?: ConfigValue;
    baseUrl?: ConfigValue;
    apiKey?: ConfigValue;
    authHeader?: ConfigValue;
    headers?: ConfigValue;
    models?: ConfigValue;
    imageInputModels?: ConfigValue;
}

interface ModelsConfig extends ConfigObject {
    providers?: ConfigValue;
}

interface ProviderAuthStatus {
    configured: boolean;
    source?: string;
    label?: string;
}

interface AuthResultValue {
    auth: { apiKey?: string; headers?: Record<string, string> };
    env?: Record<string, string>;
}

interface CompatibilityRequestConfig {
    headers?: Record<string, string>;
}

interface DiscoverProviderModelOptions {
    runwieldDir?: string;
    fetchFn?: typeof fetch;
    input?: ("text" | "image")[];
}

interface ModelRegistryOptions {
    runtime?: ModelRuntime | null;
    runtimePromise?: Promise<ModelRuntime>;
    configDir?: string;
    credentialStore?: RunWieldCredentialStore;
}

const MODEL_CONFIG_FILES = ["models.json", "auth.json"] as const;
const CLAUDE_CLI_PROVIDER = "claude-cli";
const CLAUDE_CLI_ALIASES = ["sonnet", "opus", "haiku", "fable"] as const;
const CLAUDE_CLI_DISPLAY_NAMES: Record<(typeof CLAUDE_CLI_ALIASES)[number], string> = {
    sonnet: "Claude CLI Sonnet",
    opus: "Claude CLI Opus",
    haiku: "Claude CLI Haiku",
    fable: "Claude CLI Fable",
};

let bundledOAuthFlowsRegistered = false;
let modelRuntimePromise: Promise<ModelRuntime> | null = null;
let resolvedModelRuntime: ModelRuntime | null = null;
let modelRuntimeConfigDir: string | null = null;
let modelCredentialStore: RunWieldCredentialStore | null = null;

export function getRunWieldModelConfigDir(): string {
    return getSettingsDir("global");
}

function fileExists(path: string): boolean {
    try {
        return Deno.statSync(path).isFile;
    } catch {
        return false;
    }
}

function isJsonRecord(value: JsonValue | undefined): value is JsonObject {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readJsoncObject(path: string): JsonObject | null {
    try {
        const parsed = parseJsonc(Deno.readTextFileSync(path)) as JsonValue;
        return isJsonRecord(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function resolveLiteralConfigValue(value: ConfigValue): string | undefined {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (isJsonRecord(value)) {
        const envName = value.env;
        if (typeof envName === "string" && envName.trim()) return Deno.env.get(envName.trim());
    }
    return undefined;
}

function readOpenAiModelIds(payload: JsonValue): string[] {
    const data = isJsonRecord(payload) ? payload.data : undefined;
    const models = Array.isArray(data) ? data : Array.isArray(payload) ? payload : [];
    return models
        .map((item) => isJsonRecord(item) ? item.id : undefined)
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
        .map((id) => id.trim());
}

function errorMessage(error: Error | string): string {
    return error instanceof Error ? error.message : String(error);
}

export class RunWieldCredentialStore {
    readonly authPath: string;
    private readonly providerMutations = new Map<string, Promise<void>>();

    constructor(authPath: string) {
        this.authPath = authPath;
    }

    ensureFile(): void {
        Deno.mkdirSync(dirname(this.authPath), { recursive: true, mode: 0o700 });
        try {
            Deno.statSync(this.authPath);
        } catch {
            Deno.writeTextFileSync(this.authPath, "{}", { mode: 0o600 });
        }
    }

    readData(): CredentialData {
        this.ensureFile();
        const parsed = readJsoncObject(this.authPath);
        if (!parsed) return {};
        const data: CredentialData = {};
        for (const [providerId, credential] of Object.entries(parsed)) {
            if (!isJsonRecord(credential)) continue;
            data[providerId] = {
                ...credential,
                type: typeof credential.type === "string" ? credential.type : undefined,
            };
        }
        return data;
    }

    writeData(data: CredentialData): void {
        this.ensureFile();
        Deno.writeTextFileSync(this.authPath, JSON.stringify(data, null, 2), { mode: 0o600 });
        try {
            Deno.chmodSync(this.authPath, 0o600);
        } catch {
            // Best effort on platforms that do not support chmod.
        }
    }

    read(providerId: string): Promise<Credential | undefined> {
        if (providerId === CLAUDE_CLI_PROVIDER) return Promise.resolve(undefined);
        const credential = this.readData()[providerId];
        if (!credential) return Promise.resolve(undefined);
        if (credential.type !== "api_key" || credential.key === undefined) {
            return Promise.resolve(credential as Credential);
        }
        return Promise.resolve({ ...credential, key: resolveLiteralConfigValue(credential.key) } as Credential);
    }

    list(): Promise<CredentialInfo[]> {
        return Promise.resolve(
            Object.entries(this.readData())
                .filter((entry): entry is [string, ConfiguredCredential] => {
                    const [providerId, credential] = entry;
                    if (providerId === CLAUDE_CLI_PROVIDER) return false;
                    return credential?.type === "oauth" || credential?.type === "api_key";
                })
                .map(([providerId, credential]) => ({ providerId, type: credential.type as "oauth" | "api_key" })),
        );
    }

    enqueueProviderMutation<T>(providerId: string, operation: () => Promise<T>): Promise<T> {
        const previous = this.providerMutations.get(providerId) || Promise.resolve();
        const operationPromise = previous.catch(() => {}).then(operation);
        const queuePromise = operationPromise
            .catch(() => {})
            .then(() => {
                if (this.providerMutations.get(providerId) === queuePromise) this.providerMutations.delete(providerId);
            });
        this.providerMutations.set(providerId, queuePromise);
        return operationPromise;
    }

    modify(
        providerId: string,
        fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    ): Promise<Credential | undefined> {
        return this.enqueueProviderMutation(providerId, async () => {
            const data = this.readData();
            const current = await this.read(providerId);
            const next = await fn(current);
            if (next === undefined) return current;
            data[providerId] = next as ConfiguredCredential;
            this.writeData(data);
            return next;
        });
    }

    delete(providerId: string): Promise<void> {
        return this.enqueueProviderMutation(providerId, () => {
            const data = this.readData();
            delete data[providerId];
            this.writeData(data);
            return Promise.resolve();
        });
    }
}

function getRunWieldCredentialStore(configDir: string): RunWieldCredentialStore {
    const authPath = join(configDir, "auth.json");
    if (!modelCredentialStore || modelCredentialStore.authPath !== authPath) {
        modelCredentialStore = new RunWieldCredentialStore(authPath);
    }
    return modelCredentialStore;
}

function asString(value: ConfigValue, fallback: string): string {
    return typeof value === "string" && value.length > 0 ? value : fallback;
}

function asNumber(value: ConfigValue, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: ConfigValue, fallback: boolean): boolean {
    return typeof value === "boolean" ? value : fallback;
}

function asHeaders(value: ConfigValue): Record<string, string> | undefined {
    if (!isJsonRecord(value)) return undefined;
    const headers: Record<string, string> = {};
    for (const [key, entry] of Object.entries(value)) {
        if (typeof entry === "string") headers[key] = entry;
    }
    return Object.keys(headers).length > 0 ? headers : undefined;
}

function asInputList(value: ConfigValue): ("text" | "image")[] {
    if (!Array.isArray(value)) return ["text"];
    const input = value.filter((entry): entry is "text" | "image" => entry === "text" || entry === "image");
    return input.length > 0 ? input : ["text"];
}

function asModelCost(value: ConfigValue): Model<Api>["cost"] {
    if (!isJsonRecord(value)) return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    return {
        input: asNumber(value.input, 0),
        output: asNumber(value.output, 0),
        cacheRead: asNumber(value.cacheRead, 0),
        cacheWrite: asNumber(value.cacheWrite, 0),
    };
}

function readConfiguredModels(providerId: string, providerConfig: ConfiguredProviderInput): RunWieldModel[] {
    const models = providerConfig.models;
    const entries: ConfiguredModelInput[] = Array.isArray(models)
        ? models.filter(isJsonRecord).map((item) => item as ConfiguredModelInput)
        : isJsonRecord(models)
        ? Object.entries(models).map(([id, value]) => ({
            ...(isJsonRecord(value) ? value : {}),
            id,
        })) as ConfiguredModelInput[]
        : [];
    return entries
        .filter((item): item is ConfiguredModelInput & { id: string } => typeof item.id === "string")
        .map((item) => ({
            provider: providerId,
            name: asString(item.name, item.id),
            api: asString(item.api, asString(providerConfig.api, "openai-completions")) as Api,
            baseUrl: asString(item.baseUrl, asString(providerConfig.baseUrl, "")),
            reasoning: asBoolean(item.reasoning, false),
            input: asInputList(item.input),
            cost: asModelCost(item.cost),
            contextWindow: asNumber(item.contextWindow, 128000),
            maxTokens: asNumber(item.maxTokens, 16384),
            headers: asHeaders(item.headers),
            compat: item.compat as Model<Api>["compat"],
            id: item.id,
        }));
}

function readBuiltinModels(): RunWieldModel[] {
    return builtinProviders().flatMap((provider) => {
        try {
            return Array.from(provider.getModels()) as RunWieldModel[];
        } catch {
            return [];
        }
    });
}

function registerBundledOAuthFlowsOnce(): void {
    if (bundledOAuthFlowsRegistered) return;
    registerBunOAuthFlows();
    bundledOAuthFlowsRegistered = true;
}

function isConfiguredStoredCredential(credential: ConfiguredCredential | undefined): boolean {
    if (!credential) return false;
    if (credential.type === "oauth") return true;
    if (credential.type === "api_key") return Boolean(resolveLiteralConfigValue(credential.key));
    return false;
}

function createClaudeCliModelDescriptor(selector: string): RunWieldModel | undefined {
    const id = selector.trim();
    if (!id) return undefined;
    const alias = CLAUDE_CLI_ALIASES.find((entry) => entry === id);
    return {
        provider: CLAUDE_CLI_PROVIDER,
        id,
        name: alias ? CLAUDE_CLI_DISPLAY_NAMES[alias] : `Claude CLI ${id}`,
        api: "anthropic-messages",
        baseUrl: "",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200000,
        maxTokens: 16384,
        executionBackend: "claude-cli",
        authenticationKind: "external-cli",
        healthCheck: "execution-preflight",
    };
}

function getClaudeCliAliasModels(): RunWieldModel[] {
    return CLAUDE_CLI_ALIASES.map((alias) => createClaudeCliModelDescriptor(alias)).filter((
        model,
    ): model is RunWieldModel => Boolean(model));
}

function dedupeModels(models: RunWieldModel[]): RunWieldModel[] {
    return models.filter((model, index) =>
        index === models.findIndex((item) => item.provider === model.provider && item.id === model.id)
    );
}

export class RunWieldModelRegistry {
    runtime: ModelRuntime | null;
    runtimePromise?: Promise<ModelRuntime>;
    configDir: string;
    credentialStore: RunWieldCredentialStore;
    registeredModels = new Map<string, RunWieldModel>();

    constructor(options: ModelRegistryOptions = {}) {
        this.runtime = options.runtime || resolvedModelRuntime;
        this.runtimePromise = options.runtimePromise || modelRuntimePromise || undefined;
        this.configDir = options.configDir || getRunWieldModelConfigDir();
        this.credentialStore = options.credentialStore || getRunWieldCredentialStore(this.configDir);
        if (this.runtimePromise && !this.runtime) {
            this.runtimePromise.then((runtime) => {
                this.runtime = runtime;
            }).catch(() => {});
        }
    }

    async getRuntime(): Promise<ModelRuntime> {
        const runtime = this.runtime || await (this.runtimePromise || getModelRuntime());
        this.runtime = runtime;
        return runtime;
    }

    getOAuthProviders(): Array<{ id: string; name: string }> {
        return (this.runtime?.getProviders() || [])
            .filter((provider) => Boolean(provider.auth?.oauth))
            .map((provider) => ({ id: provider.id, name: provider.name }));
    }

    async listStoredCredentialProviders(): Promise<Array<{ id: string; name: string; authType: "oauth" | "api_key" }>> {
        const runtime = await this.getRuntime();
        const credentials = await runtime.listCredentials();
        return credentials
            .filter((credential) => credential.providerId !== CLAUDE_CLI_PROVIDER)
            .map((credential) => ({
                id: credential.providerId,
                name: this.getProviderDisplayName(credential.providerId),
                authType: credential.type,
            }));
    }

    async getStoredCredentialType(providerId: string): Promise<"oauth" | "api_key" | undefined> {
        const credential = (await this.listStoredCredentialProviders()).find((item) => item.id === providerId);
        return credential?.authType;
    }

    async loginProvider(providerId: string, authType: AuthType, interaction: AuthInteraction): Promise<void> {
        const runtime = await this.getRuntime();
        await runtime.login(providerId, authType, interaction);
    }

    async setProviderApiKey(providerId: string, apiKey: string): Promise<void> {
        await this.credentialStore.modify(providerId, () => Promise.resolve({ type: "api_key", key: apiKey }));
        const runtime = await this.getRuntime();
        await runtime.refresh({ allowNetwork: false });
    }

    async logoutProvider(providerId: string): Promise<void> {
        const runtime = await this.getRuntime();
        await runtime.logout(providerId);
    }

    async refresh(): Promise<void> {
        const runtime = await (this.runtimePromise || getModelRuntime());
        this.runtime = runtime;
        await runtime.refresh();
    }

    getError(): string | undefined {
        return this.runtime?.getError();
    }

    getAll(): RunWieldModel[] {
        const runtimeModels = this.runtime
            ? Array.from(this.runtime.getModels()) as RunWieldModel[]
            : readBuiltinModels();
        return dedupeModels([
            ...runtimeModels.filter((model) => model.provider !== CLAUDE_CLI_PROVIDER),
            ...Array.from(this.registeredModels.values()).filter((model) => model.provider !== CLAUDE_CLI_PROVIDER),
            ...this.getConfiguredModels(),
            ...getClaudeCliAliasModels(),
        ]);
    }

    getSelectable(): RunWieldModel[] {
        return dedupeModels([...this.getAvailable(), ...getClaudeCliAliasModels()]);
    }

    getAvailable(): RunWieldModel[] {
        const models = this.runtime
            ? Array.from(this.runtime.getAvailableSnapshot()) as RunWieldModel[]
            : this.getAll().filter((model) => this.hasConfiguredAuth(model));
        return dedupeModels(
            models.filter((model) => model.provider !== CLAUDE_CLI_PROVIDER && model.executionBackend !== "claude-cli"),
        );
    }

    find(provider: string, modelId: string): RunWieldModel | undefined {
        if (provider === CLAUDE_CLI_PROVIDER) return createClaudeCliModelDescriptor(modelId);
        return this.runtime?.getModel(provider, modelId) as RunWieldModel | undefined ||
            this.registeredModels.get(`${provider}/${modelId}`) ||
            this.getConfiguredModels().find((model) => model.provider === provider && model.id === modelId) ||
            readBuiltinModels().find((model) => model.provider === provider && model.id === modelId);
    }

    isSelectable(model: RunWieldModel | undefined): boolean {
        if (!model) return false;
        if (model.executionBackend === "claude-cli" || model.provider === CLAUDE_CLI_PROVIDER) return true;
        return this.hasConfiguredAuth(model);
    }

    hasConfiguredAuth(model: RunWieldModel | undefined): boolean {
        if (!model) return false;
        if (model.provider === CLAUDE_CLI_PROVIDER || model.executionBackend === "claude-cli") return false;
        if (this.runtime?.hasConfiguredAuth(model.provider)) return true;
        const status = this.getProviderAuthStatus(model.provider);
        return Boolean(status.configured);
    }

    async getApiKeyAndHeaders(model: RunWieldModel): Promise<
        { ok: true; apiKey?: string; headers?: Record<string, string>; env?: Record<string, string> } | {
            ok: false;
            error: string;
        }
    > {
        if (model.provider === CLAUDE_CLI_PROVIDER || model.executionBackend === "claude-cli") {
            return { ok: false, error: `No API auth for external CLI provider ${model.provider}` };
        }
        const runtime = this.runtime || await (this.runtimePromise || getModelRuntime());
        this.runtime = runtime;
        const auth = await runtime.getAuth(model) as AuthResultValue | undefined;
        if (auth) return { ok: true, apiKey: auth.auth.apiKey, headers: auth.auth.headers, env: auth.env };
        const compatibility = typeof runtime.getCompatibilityRequestConfig === "function"
            ? runtime.getCompatibilityRequestConfig(model) as CompatibilityRequestConfig
            : undefined;
        const providerConfig = this.getProviderConfig(model.provider);
        const apiKey = resolveLiteralConfigValue(providerConfig?.apiKey);
        const headers = compatibility?.headers;
        if (apiKey || headers) return { ok: true, apiKey, headers };
        return { ok: false, error: `No configured auth for provider ${model.provider}` };
    }

    getProviderAuthStatus(provider: string): ProviderAuthStatus {
        if (provider === CLAUDE_CLI_PROVIDER) return { configured: false };
        const runtimeStatus = this.runtime?.getProviderAuthStatus(provider) as ProviderAuthStatus | undefined;
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

    getProvider(provider: string): Provider | ConfiguredProviderInput | undefined {
        return this.runtime?.getProvider(provider) || builtinProviders().find((item) => item.id === provider) ||
            this.getProviderConfig(provider);
    }

    getProviderDisplayName(provider: string): string {
        if (provider === CLAUDE_CLI_PROVIDER) return "Claude CLI";
        return this.runtime?.getProvider(provider)?.name ||
            this.getProviderConfig(provider)?.name as string | undefined || provider;
    }

    async getProviderAuth(provider: string): Promise<AuthResultValue | undefined> {
        if (provider === CLAUDE_CLI_PROVIDER) return undefined;
        const runtime = this.runtime || await (this.runtimePromise || getModelRuntime());
        this.runtime = runtime;
        return await runtime.getAuth(provider) as AuthResultValue | undefined;
    }

    async getApiKeyForProvider(provider: string): Promise<string | undefined> {
        if (provider === CLAUDE_CLI_PROVIDER) return undefined;
        const auth = await this.getProviderAuth(provider);
        return auth?.auth.apiKey || resolveLiteralConfigValue(this.getProviderConfig(provider)?.apiKey);
    }

    isUsingOAuth(model: RunWieldModel): boolean {
        if (model.provider === CLAUDE_CLI_PROVIDER) return false;
        return Boolean(this.runtime?.isUsingOAuth(model.provider));
    }

    registerProvider(provider: string | ConfiguredProviderInput, config?: ConfiguredProviderInput): void {
        const providerId = typeof provider === "string" ? provider : asString(provider.id, "");
        const providerConfig = typeof provider === "string" ? config : provider;
        if (!providerId || !providerConfig || providerId === CLAUDE_CLI_PROVIDER) return;
        this.runtime?.registerProvider(providerId, providerConfig as Parameters<ModelRuntime["registerProvider"]>[1]);
        if (this.runtimePromise && !this.runtime) {
            this.runtimePromise.then((runtime) =>
                runtime.registerProvider(providerId, providerConfig as Parameters<ModelRuntime["registerProvider"]>[1])
            ).catch(() => {});
        }
        for (const model of readConfiguredModels(providerId, providerConfig)) {
            this.registeredModels.set(`${providerId}/${model.id}`, model);
        }
    }

    unregisterProvider(provider: string): void {
        this.runtime?.unregisterProvider(provider);
        for (const key of this.registeredModels.keys()) {
            if (key.startsWith(`${provider}/`)) this.registeredModels.delete(key);
        }
    }

    getRegisteredProviderConfig(provider: string): ConfiguredProviderInput | undefined {
        return this.runtime?.getRegisteredProviderConfig(provider) as ConfiguredProviderInput | undefined ||
            this.getProviderConfig(provider);
    }

    getRegisteredNativeProvider(provider: string): Provider | undefined {
        return this.runtime?.getRegisteredNativeProvider(provider);
    }

    getRegisteredProviderIds(): readonly string[] {
        const providers = this.readModelsConfig().providers;
        const configured = Object.keys(isJsonRecord(providers) ? providers : {}).filter((provider) =>
            provider !== CLAUDE_CLI_PROVIDER
        );
        const runtime = (this.runtime?.getRegisteredProviderIds() || []).filter((provider) =>
            provider !== CLAUDE_CLI_PROVIDER
        );
        return [...new Set([...runtime, ...configured])];
    }

    readModelsConfig(): ModelsConfig {
        return readJsoncObject(join(this.configDir, "models.json")) as ModelsConfig || {};
    }

    getProviderConfig(provider: string): ConfiguredProviderInput | undefined {
        const providers = this.readModelsConfig().providers;
        const config = isJsonRecord(providers) ? providers[provider] : undefined;
        return isJsonRecord(config) ? config as ConfiguredProviderInput : undefined;
    }

    getConfiguredModels(): RunWieldModel[] {
        const providers = this.readModelsConfig().providers;
        if (!isJsonRecord(providers)) return [];
        return Object.entries(providers).flatMap(([provider, config]) =>
            provider !== CLAUDE_CLI_PROVIDER && isJsonRecord(config)
                ? readConfiguredModels(provider, config as ConfiguredProviderInput)
                : []
        );
    }
}

export async function discoverProviderModel(
    modelRegistry: RunWieldModelRegistry,
    provider: string,
    modelId: string,
    options: DiscoverProviderModelOptions = {},
): Promise<RunWieldModel | undefined> {
    const existing = modelRegistry.find(provider, modelId);
    if (existing) return existing;

    const runwieldDir = options.runwieldDir ?? getRunWieldModelConfigDir();
    const modelsConfig = readJsoncObject(join(runwieldDir, "models.json"));
    const providerConfig = isJsonRecord(modelsConfig?.providers) && isJsonRecord(modelsConfig.providers[provider])
        ? modelsConfig.providers[provider] as ConfiguredProviderInput
        : undefined;
    if (!providerConfig) return undefined;

    const baseUrl = typeof providerConfig.baseUrl === "string" ? providerConfig.baseUrl.trim() : "";
    const api = typeof providerConfig.api === "string" ? providerConfig.api.trim() : "";
    const apiKey = resolveLiteralConfigValue(providerConfig.apiKey);
    if (!baseUrl || !api || !apiKey) return undefined;

    const fetchFn = options.fetchFn ?? fetch;
    const response = await fetchFn(`${baseUrl.replace(/\/+$/, "")}/models`, {
        headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) {
        throw new Error(
            `model discovery failed for provider "${provider}" (${response.status} ${response.statusText})`,
        );
    }

    const ids = readOpenAiModelIds(await response.json() as JsonValue);
    if (!ids.includes(modelId)) return undefined;

    const imageInputModels = Array.isArray(providerConfig.imageInputModels) ? providerConfig.imageInputModels : [];
    const resolvedInput = options.input ?? (imageInputModels.includes(modelId) ? ["text", "image"] : ["text"]);

    modelRegistry.registerProvider(provider, {
        name: asString(providerConfig.name, provider),
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

function getPiConfigMigrationCandidates(fileName: string, homeDir: string): string[] {
    if (!homeDir) return [];
    return [join(homeDir, ".pi", "agent", fileName), join(homeDir, ".pi", fileName)];
}

function migrateModelConfigFilesOnce(
    options: { targetDir: string; sourceCandidatesByFile: (fileName: string) => string[] },
): {
    copied: string[];
    skipped: string[];
    failed: Array<{ file: string; error: string }>;
} {
    const copied: string[] = [];
    const skipped: string[] = [];
    const failed: Array<{ file: string; error: string }> = [];
    for (const fileName of MODEL_CONFIG_FILES) {
        const targetPath = join(options.targetDir, fileName);
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
            Deno.mkdirSync(options.targetDir, { recursive: true });
            Deno.copyFileSync(sourcePath, targetPath);
            copied.push(fileName);
        } catch (error) {
            failed.push({ file: fileName, error: errorMessage(error as Error | string) });
        }
    }
    return { copied, skipped, failed };
}

export function migratePiModelConfigOnce(options: { homeDir?: string; runwieldDir?: string } = {}): {
    copied: string[];
    skipped: string[];
    failed: Array<{ file: string; error: string }>;
} {
    const homeDir = options.homeDir ?? getHomeDir();
    const runwieldDir = options.runwieldDir ?? getRunWieldModelConfigDir();
    return migrateModelConfigFilesOnce({
        targetDir: runwieldDir,
        sourceCandidatesByFile: (fileName) => getPiConfigMigrationCandidates(fileName, homeDir),
    });
}

export async function createRunWieldModelRuntime(): Promise<ModelRuntime> {
    registerBundledOAuthFlowsOnce();
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

export function getModelRuntime(): Promise<ModelRuntime> {
    const configDir = getRunWieldModelConfigDir();
    if (!modelRuntimePromise || modelRuntimeConfigDir !== configDir) {
        modelRuntimeConfigDir = configDir;
        resolvedModelRuntime = null;
        const pendingRuntime = createRunWieldModelRuntime();
        const configuredRuntimePromise = pendingRuntime.then((runtime) => {
            if (modelRuntimePromise === configuredRuntimePromise) resolvedModelRuntime = runtime;
            return runtime;
        });
        modelRuntimePromise = configuredRuntimePromise;
    }
    return modelRuntimePromise;
}

export function getModelRegistry(): RunWieldModelRegistry {
    const agentDir = getRunWieldModelConfigDir();
    const piMigration = migratePiModelConfigOnce({ runwieldDir: agentDir });
    for (const failure of piMigration.failed) {
        console.warn(`Failed to migrate Pi ${failure.file} to RunWield config: ${failure.error}`);
    }
    modelRuntimePromise = getModelRuntime();
    return new RunWieldModelRegistry({
        runtime: resolvedModelRuntime,
        runtimePromise: modelRuntimePromise,
        configDir: agentDir,
        credentialStore: getRunWieldCredentialStore(agentDir),
    });
}
