import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { RunWieldModelRegistry } from "./model-registry.js";
import { formatProviderModelReference, parseProviderModel, resolveTemplateModel } from "./model-validation.js";

Deno.test("parseProviderModel accepts strict provider/id", () => {
    const parsed = parseProviderModel("openai/gpt-4.1");
    assertEquals(parsed, { ok: true, provider: "openai", id: "gpt-4.1" });
});

Deno.test("parseProviderModel rejects non provider/id formats", () => {
    assertEquals(parseProviderModel("gpt-4.1"), { ok: false });
    assertEquals(parseProviderModel("openai/"), { ok: false });
    assertEquals(parseProviderModel("/gpt-4.1"), { ok: false });
});

Deno.test("formatProviderModelReference qualifies active model state exactly once", () => {
    assertEquals(formatProviderModelReference({ model: "gpt-5", provider: "openai" }), "openai/gpt-5");
    assertEquals(
        formatProviderModelReference({ model: "openai/gpt-5", provider: "openai" }),
        "openai/gpt-5",
    );
    assertEquals(formatProviderModelReference({ model: "local-model" }), "local-model");
});

Deno.test("resolveTemplateModel returns ok for valid configured model", () => {
    const result = resolveTemplateModel("openai/gpt-4.1", {
        find: (/** @type {string} */ provider, /** @type {string} */ model) => ({ provider, id: model }),
        hasConfiguredAuth: () => true,
    });

    assertEquals(result, { ok: true, provider: "openai", id: "gpt-4.1" });
});

Deno.test("resolveTemplateModel fails for unknown model", () => {
    const result = resolveTemplateModel("openai/gpt-4.1", {
        find: () => null,
        hasConfiguredAuth: () => true,
    });

    assertEquals(result, { ok: false });
});

Deno.test("resolveTemplateModel fails when auth is missing", () => {
    const result = resolveTemplateModel("openai/gpt-4.1", {
        find: (/** @type {string} */ provider, /** @type {string} */ model) => ({ provider, id: model }),
        hasConfiguredAuth: () => false,
    });

    assertEquals(result, { ok: false });
});

Deno.test("resolveTemplateModel uses the sync facade configured-auth contract", async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "runwield-model-validation-facade-" });
    try {
        await Deno.writeTextFile(
            join(tempDir, "models.json"),
            JSON.stringify({
                providers: {
                    authed: {
                        baseUrl: "https://authed.example.test/v1",
                        api: "openai-completions",
                        apiKey: "configured-key",
                        models: [{ id: "usable" }],
                    },
                    unauthed: {
                        baseUrl: "https://unauthed.example.test/v1",
                        api: "openai-completions",
                        models: [{ id: "blocked" }],
                    },
                },
            }),
        );
        const registry = new RunWieldModelRegistry({ configDir: tempDir });

        assertEquals(resolveTemplateModel("authed/usable", registry), { ok: true, provider: "authed", id: "usable" });
        assertEquals(resolveTemplateModel("unauthed/blocked", registry), { ok: false });
    } finally {
        await Deno.remove(tempDir, { recursive: true });
    }
});
