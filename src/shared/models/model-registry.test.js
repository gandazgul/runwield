import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { discoverProviderModel, migratePiModelConfigOnce } from "./model-registry.js";

Deno.test("migratePiModelConfigOnce copies Pi files into Harns when missing", async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "harns-model-config-" });
    try {
        const piDir = join(tempDir, ".pi", "agent");
        const harnsDir = join(tempDir, ".hns");
        await Deno.mkdir(piDir, { recursive: true });
        await Deno.writeTextFile(join(piDir, "models.json"), '{"providers":{}}');
        await Deno.writeTextFile(join(piDir, "auth.json"), '{"openai":{"type":"api_key","key":"abc"}}');

        const result = migratePiModelConfigOnce({ homeDir: tempDir, harnsDir });

        assertEquals(result.copied.sort(), ["auth.json", "models.json"]);
        assertEquals(result.failed, []);
        assertEquals(await Deno.readTextFile(join(harnsDir, "models.json")), '{"providers":{}}');
        assertEquals(await Deno.readTextFile(join(harnsDir, "auth.json")), '{"openai":{"type":"api_key","key":"abc"}}');
    } finally {
        await Deno.remove(tempDir, { recursive: true });
    }
});

Deno.test("migratePiModelConfigOnce leaves existing Harns files untouched", async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "harns-model-config-" });
    try {
        const piDir = join(tempDir, ".pi", "agent");
        const harnsDir = join(tempDir, ".hns");
        await Deno.mkdir(piDir, { recursive: true });
        await Deno.mkdir(harnsDir, { recursive: true });
        await Deno.writeTextFile(join(piDir, "models.json"), '{"providers":{"pi":{}}}');
        await Deno.writeTextFile(join(harnsDir, "models.json"), '{"providers":{"harns":{}}}');

        const result = migratePiModelConfigOnce({ homeDir: tempDir, harnsDir });

        assertEquals(result.copied, []);
        assertEquals(await Deno.readTextFile(join(harnsDir, "models.json")), '{"providers":{"harns":{}}}');
    } finally {
        await Deno.remove(tempDir, { recursive: true });
    }
});

Deno.test("migratePiModelConfigOnce supports legacy ~/.pi file location", async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "harns-model-config-" });
    try {
        const piDir = join(tempDir, ".pi");
        const harnsDir = join(tempDir, ".hns");
        await Deno.mkdir(piDir, { recursive: true });
        await Deno.writeTextFile(join(piDir, "auth.json"), '{"openai-codex":{"type":"oauth"}}');

        const result = migratePiModelConfigOnce({ homeDir: tempDir, harnsDir });

        assertEquals(result.copied, ["auth.json"]);
        assertEquals(await Deno.readTextFile(join(harnsDir, "auth.json")), '{"openai-codex":{"type":"oauth"}}');
    } finally {
        await Deno.remove(tempDir, { recursive: true });
    }
});

Deno.test("discoverProviderModel registers a model returned by OpenAI-compatible /models", async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "harns-model-discovery-" });
    try {
        await Deno.writeTextFile(
            join(tempDir, "models.json"),
            JSON.stringify({
                providers: {
                    crofai: {
                        baseUrl: "https://crof.ai/v1",
                        api: "openai-completions",
                        apiKey: "test-key",
                    },
                },
            }),
        );

        /** @type {any | undefined} */
        let registeredModel;
        /** @type {string | undefined} */
        let requestedUrl;
        /** @type {string | undefined} */
        let authorization;
        const registry = /** @type {any} */ ({
            find: (/** @type {string} */ provider, /** @type {string} */ modelId) =>
                registeredModel && registeredModel.provider === provider && registeredModel.id === modelId
                    ? registeredModel
                    : undefined,
            registerProvider: (
                /** @type {string} */ provider,
                /** @type {{ models: Array<{ id: string }> }} */ config,
            ) => {
                registeredModel = { provider, id: config.models[0].id };
            },
        });

        const result = await discoverProviderModel(registry, "crofai", "deepseek-v4-pro", {
            harnsDir: tempDir,
            fetchFn: /** @type {typeof fetch} */ ((
                /** @type {string} */ url,
                /** @type {{ headers?: Record<string, string> }} */ init,
            ) => {
                requestedUrl = url;
                authorization = init.headers?.Authorization;
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    statusText: "OK",
                    json: () => Promise.resolve({ data: [{ id: "deepseek-v4-pro" }] }),
                });
            }),
        });

        assertEquals(requestedUrl, "https://crof.ai/v1/models");
        assertEquals(authorization, "Bearer test-key");
        assertEquals(result, { provider: "crofai", id: "deepseek-v4-pro" });
    } finally {
        await Deno.remove(tempDir, { recursive: true });
    }
});

Deno.test("discoverProviderModel defaults discovered models to text-only input", async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "harns-model-discovery-input-" });
    try {
        await Deno.writeTextFile(
            join(tempDir, "models.json"),
            JSON.stringify({
                providers: {
                    crofai: {
                        baseUrl: "https://crof.ai/v1",
                        api: "openai-completions",
                        apiKey: "test-key",
                    },
                },
            }),
        );

        /** @type {any} */
        let registeredConfig;
        const registry = /** @type {any} */ ({
            find: () => registeredConfig ? { ...registeredConfig.models[0], provider: "crofai" } : undefined,
            registerProvider: (/** @type {string} */ _provider, /** @type {any} */ config) => {
                registeredConfig = config;
            },
        });

        // Default discovery (active model path): must NOT claim image support,
        // otherwise raw image bytes get sent to a text-only model and silently fail.
        const fetchFn = /** @type {typeof fetch} */ (/** @type {any} */ (() =>
            Promise.resolve({
                ok: true,
                status: 200,
                statusText: "OK",
                json: () => Promise.resolve({ data: [{ id: "deepseek-v4-pro" }] }),
            })));

        // Default discovery (active model path): must NOT claim image support,
        // otherwise raw image bytes get sent to a text-only model and silently fail.
        await discoverProviderModel(registry, "crofai", "deepseek-v4-pro", {
            harnsDir: tempDir,
            fetchFn,
        });
        assertEquals(registeredConfig.models[0].input, ["text"]);

        // Explicit vision-fallback path: caller opts the discovered model into image input.
        registeredConfig = undefined;
        await discoverProviderModel(registry, "crofai", "deepseek-v4-pro", {
            harnsDir: tempDir,
            input: ["text", "image"],
            fetchFn,
        });
        assertEquals(registeredConfig.models[0].input, ["text", "image"]);
    } finally {
        await Deno.remove(tempDir, { recursive: true });
    }
});

Deno.test("discoverProviderModel honors provider imageInputModels allowlist", async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "harns-model-discovery-allowlist-" });
    try {
        await Deno.writeTextFile(
            join(tempDir, "models.json"),
            JSON.stringify({
                providers: {
                    crofai: {
                        baseUrl: "https://crof.ai/v1",
                        api: "openai-completions",
                        apiKey: "test-key",
                        imageInputModels: ["vision-model"],
                    },
                },
            }),
        );

        /** @type {any} */
        let registeredConfig;
        const registry = /** @type {any} */ ({
            find: () => undefined,
            registerProvider: (/** @type {string} */ _provider, /** @type {any} */ config) => {
                registeredConfig = config;
            },
        });

        const fetchFn = /** @type {typeof fetch} */ (/** @type {any} */ (() =>
            Promise.resolve({
                ok: true,
                status: 200,
                statusText: "OK",
                json: () => Promise.resolve({ data: [{ id: "vision-model" }, { id: "text-model" }] }),
            })));

        // Listed in imageInputModels -> vision-capable.
        await discoverProviderModel(registry, "crofai", "vision-model", { harnsDir: tempDir, fetchFn });
        assertEquals(registeredConfig.models[0].input, ["text", "image"]);

        // Not listed -> text-only.
        registeredConfig = undefined;
        await discoverProviderModel(registry, "crofai", "text-model", { harnsDir: tempDir, fetchFn });
        assertEquals(registeredConfig.models[0].input, ["text"]);
    } finally {
        await Deno.remove(tempDir, { recursive: true });
    }
});
