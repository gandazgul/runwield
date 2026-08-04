import { assert, assertEquals, assertObjectMatch } from "@std/assert";
import { join } from "@std/path";
import { RunWieldCredentialStore, RunWieldModelRegistry } from "./model-registry.ts";
import { resolveTemplateModel } from "./model-validation.ts";

async function makeRegistry(): Promise<{ registry: RunWieldModelRegistry; tempDir: string }> {
    const tempDir = await Deno.makeTempDir({ prefix: "runwield-claude-cli-models-" });
    return {
        tempDir,
        registry: new RunWieldModelRegistry({
            configDir: tempDir,
            credentialStore: new RunWieldCredentialStore(join(tempDir, "auth.json")),
        }),
    };
}

Deno.test("Claude CLI aliases are selectable with external backend metadata but not runnable", async () => {
    const { registry, tempDir } = await makeRegistry();
    try {
        const selectable = registry.getSelectable().filter((model) => model.provider === "claude-cli");
        assertEquals(selectable.map((model) => model.id), ["sonnet", "opus", "haiku", "fable"]);
        assertEquals(new Set(selectable.map((model) => `${model.provider}/${model.id}`)).size, 4);
        for (const model of selectable) {
            assertObjectMatch(model, {
                executionBackend: "claude-cli",
                authenticationKind: "external-cli",
                healthCheck: "execution-preflight",
            });
            assertEquals(registry.isSelectable(model), true);
            assertEquals(registry.hasConfiguredAuth(model), false);
        }
        assertEquals(registry.getAvailable().some((model) => model.provider === "claude-cli"), false);
    } finally {
        await Deno.remove(tempDir, { recursive: true });
    }
});

Deno.test("Claude CLI lookup synthesizes arbitrary non-empty selectors and rejects empty selectors", async () => {
    const { registry, tempDir } = await makeRegistry();
    try {
        const pinned = registry.find("claude-cli", "claude-3-7-sonnet-20250219");
        assert(pinned);
        assertObjectMatch(pinned, {
            provider: "claude-cli",
            id: "claude-3-7-sonnet-20250219",
            executionBackend: "claude-cli",
        });
        assertEquals(registry.find("claude-cli", "   "), undefined);
        assertEquals(registry.find("not-claude", "future"), undefined);
    } finally {
        await Deno.remove(tempDir, { recursive: true });
    }
});

Deno.test("Claude CLI remains outside API auth even when files contain a misleading provider entry", async () => {
    const { registry, tempDir } = await makeRegistry();
    try {
        await Deno.writeTextFile(
            join(tempDir, "auth.json"),
            JSON.stringify({ "claude-cli": { type: "api_key", key: "fake" } }),
        );
        await Deno.writeTextFile(
            join(tempDir, "models.json"),
            JSON.stringify({
                providers: {
                    "claude-cli": {
                        apiKey: "fake",
                        models: [{ id: "sonnet", name: "Wrong" }, { id: "configured-only" }],
                    },
                },
            }),
        );
        const model = registry.find("claude-cli", "sonnet");
        assert(model);
        assertEquals(registry.isSelectable(model), true);
        assertEquals(registry.hasConfiguredAuth(model), false);
        assertEquals(registry.getProviderAuthStatus("claude-cli").configured, false);
        assertEquals(await registry.getProviderAuth("claude-cli"), undefined);
        assertEquals(await registry.getApiKeyForProvider("claude-cli"), undefined);
        assertEquals(await registry.getApiKeyAndHeaders(model), {
            ok: false,
            error: "No API auth for external CLI provider claude-cli",
        });
        assertObjectMatch(model, {
            name: "Claude CLI Sonnet",
            executionBackend: "claude-cli",
            authenticationKind: "external-cli",
            healthCheck: "execution-preflight",
        });
        assertEquals(
            registry.getAll().filter((entry) => entry.provider === "claude-cli").map((entry) => entry.id),
            ["sonnet", "opus", "haiku", "fable"],
        );
        assertEquals(
            registry.getSelectable().filter((entry) => entry.provider === "claude-cli").map((entry) => entry.id),
            ["sonnet", "opus", "haiku", "fable"],
        );
    } finally {
        await Deno.remove(tempDir, { recursive: true });
    }
});

Deno.test("Claude CLI stored credentials are hidden from credential provider listings", async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "runwield-claude-cli-credentials-" });
    try {
        const store = new RunWieldCredentialStore(join(tempDir, "auth.json"));
        await Deno.writeTextFile(
            join(tempDir, "auth.json"),
            JSON.stringify({
                "claude-cli": { type: "api_key", key: "fake" },
                openai: { type: "api_key", key: "real" },
            }),
        );

        assertEquals(await store.read("claude-cli"), undefined);
        assertEquals(await store.list(), [{ providerId: "openai", type: "api_key" }]);
    } finally {
        await Deno.remove(tempDir, { recursive: true });
    }
});

Deno.test("strict template resolution accepts selectable Claude CLI references without weakening unknown provider failures", async () => {
    const { registry, tempDir } = await makeRegistry();
    try {
        assertEquals(resolveTemplateModel("claude-cli/future-alias", registry), {
            ok: true,
            provider: "claude-cli",
            id: "future-alias",
        });
        assertEquals(resolveTemplateModel("missing-provider/model", registry), { ok: false });
        assertEquals(resolveTemplateModel("claude-cli/", registry), { ok: false });
    } finally {
        await Deno.remove(tempDir, { recursive: true });
    }
});
