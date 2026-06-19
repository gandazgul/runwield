import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { join } from "@std/path";
import { parse as parseJsonc } from "@std/jsonc";
import { getSettingsDir } from "../settings.js";

const MODEL_CONFIG_FILES = ["models.json", "auth.json"];

/**
 * @returns {string}
 */
export function getHarnsModelConfigDir() {
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

/**
 * Discover a model from a custom OpenAI-compatible provider using `/models`.
 *
 * This is intentionally targeted: settings may name a model that is valid for
 * a provider whose `models.json` entry has only `baseUrl`/`apiKey`. In that
 * case the upstream registry has no concrete model object yet, so Harns asks
 * the provider before treating the settings model as unknown.
 *
 * The `/models` endpoint does not report per-model input modalities, so
 * discovered models default to text-only. There are two ways to mark a
 * discovered model as vision-capable:
 *   1. List its id in the provider's `imageInputModels` array in models.json.
 *   2. Pass `input: ["text", "image"]` (callers that already know the model is
 *      vision-capable, e.g. an explicitly configured `visionFallback.model`).
 * An explicit `options.input` always wins over the `imageInputModels` allowlist.
 *
 * @param {ModelRegistry} modelRegistry
 * @param {string} provider
 * @param {string} modelId
 * @param {{
 *   harnsDir?: string,
 *   fetchFn?: typeof fetch,
 *   input?: ("text" | "image")[],
 * }} [options]
 * @returns {Promise<any | undefined>}
 */
export async function discoverProviderModel(modelRegistry, provider, modelId, options = {}) {
    const existing = modelRegistry.find(provider, modelId);
    if (existing) return existing;

    const harnsDir = options.harnsDir ?? getHarnsModelConfigDir();
    const modelsConfig = readJsoncObject(join(harnsDir, "models.json"));
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

    // /models reports no modalities, so default to text-only. A user can opt a
    // discovered model into image input via providers.<p>.imageInputModels in
    // models.json. An explicit options.input (e.g. the vision fallback path) wins.
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
 * Pi historically stores model/auth config under ~/.pi/agent, but support the
 * shorter ~/.pi path as an import source too because some early installs and
 * docs used that shape.
 *
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
 * One-time import of Pi-owned model/auth files into Harns-owned config.
 * Existing Harns files always win; Pi is never used as a runtime fallback.
 *
 * @param {{ homeDir?: string, harnsDir?: string }} [options]
 * @returns {{ copied: string[], skipped: string[], failed: Array<{ file: string, error: string }> }}
 */
export function migratePiModelConfigOnce(options = {}) {
    const homeDir = options.homeDir ?? Deno.env.get("HOME") ?? "";
    const harnsDir = options.harnsDir ?? getHarnsModelConfigDir();
    /** @type {string[]} */
    const copied = [];
    /** @type {string[]} */
    const skipped = [];
    /** @type {Array<{ file: string, error: string }>} */
    const failed = [];

    for (const fileName of MODEL_CONFIG_FILES) {
        const targetPath = join(harnsDir, fileName);
        if (fileExists(targetPath)) {
            skipped.push(fileName);
            continue;
        }

        const sourcePath = getPiConfigMigrationCandidates(fileName, homeDir).find(fileExists);
        if (!sourcePath) {
            skipped.push(fileName);
            continue;
        }

        try {
            Deno.mkdirSync(harnsDir, { recursive: true });
            Deno.copyFileSync(sourcePath, targetPath);
            copied.push(fileName);
        } catch (error) {
            failed.push({ file: fileName, error: error instanceof Error ? error.message : String(error) });
        }
    }

    return { copied, skipped, failed };
}

/**
 * Get a configured ModelRegistry instance.
 * @returns {ModelRegistry}
 */
export function getModelRegistry() {
    const agentDir = getHarnsModelConfigDir();
    const migration = migratePiModelConfigOnce({ harnsDir: agentDir });
    for (const failure of migration.failed) {
        console.warn(`Failed to migrate Pi ${failure.file} to Harns config: ${failure.error}`);
    }

    const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
    return ModelRegistry.create(authStorage, join(agentDir, "models.json"));
}
