import { assertEquals } from "@std/assert";
import { formatAuthStatus, getLoginProviderOptions, runLoginCommand, runLogoutCommand } from "./index.js";

function createRegistry() {
    /** @type {Record<string, { type: "oauth" | "api_key", key?: string }>} */
    const credentials = {};
    let refreshed = false;
    return {
        authStorage: {
            getOAuthProviders: () => [{ id: "openai-codex", name: "ChatGPT Plus/Pro" }],
            list: () => Object.keys(credentials),
            get: (/** @type {string} */ providerId) => credentials[providerId],
            set: (/** @type {string} */ providerId, /** @type {{ type: "api_key", key: string }} */ credential) => {
                credentials[providerId] = credential;
            },
            logout: (/** @type {string} */ providerId) => {
                delete credentials[providerId];
            },
            login: (/** @type {string} */ providerId) => {
                credentials[providerId] = { type: "oauth" };
                return Promise.resolve();
            },
        },
        getAll: () => [
            { provider: "openai" },
            { provider: "openai-codex" },
        ],
        getAvailable: () => Object.keys(credentials).map((provider) => ({ provider })),
        getProviderDisplayName: (/** @type {string} */ providerId) =>
            providerId === "openai" ? "OpenAI" : "ChatGPT Plus/Pro",
        getProviderAuthStatus: (/** @type {string} */ providerId) => {
            if (credentials[providerId]) return { configured: true, source: "stored" };
            return { configured: false };
        },
        refresh: () => {
            refreshed = true;
        },
        wasRefreshed: () => refreshed,
    };
}

function createUi() {
    /** @type {string[]} */
    const messages = [];
    /** @type {string[]} */
    const selections = [];
    /** @type {string[]} */
    const textInputs = [];
    return {
        messages,
        selections,
        textInputs,
        uiAPI: {
            appendSystemMessage: (/** @type {string} */ message) => messages.push(message),
            appendAgentMessageStart: () => ({ appendText: () => {} }),
            requestRender: () => {},
            promptSelect: () => Promise.resolve(selections.shift() ?? null),
            promptText: () => Promise.resolve(textInputs.shift() ?? null),
            showModelSelector: () => {},
            abortActivePrompt: () => {},
        },
    };
}

Deno.test("getLoginProviderOptions separates subscription and API key providers", () => {
    const registry = createRegistry();

    assertEquals(getLoginProviderOptions(registry, "oauth"), [{
        id: "openai-codex",
        name: "ChatGPT Plus/Pro",
        authType: "oauth",
    }]);
    assertEquals(getLoginProviderOptions(registry, "api_key"), [{
        id: "openai",
        name: "OpenAI",
        authType: "api_key",
    }]);
});

Deno.test("runLoginCommand stores API key credentials", async () => {
    const registry = createRegistry();
    const { uiAPI, textInputs, messages } = createUi();
    textInputs.push("test-key");

    await runLoginCommand(["api-key", "openai"], {
        uiAPI: /** @type {any} */ (uiAPI),
        __testDeps: { getModelRegistry: () => registry },
    });

    assertEquals(registry.authStorage.get("openai"), { type: "api_key", key: "test-key" });
    assertEquals(registry.wasRefreshed(), true);
    assertEquals(messages.at(-1), "Logged in to OpenAI.");
});

Deno.test("runLoginCommand stores subscription credentials", async () => {
    const registry = createRegistry();
    const { uiAPI, messages } = createUi();

    await runLoginCommand(["subscription", "openai-codex"], {
        uiAPI: /** @type {any} */ (uiAPI),
        __testDeps: { getModelRegistry: () => registry },
    });

    assertEquals(registry.authStorage.get("openai-codex"), { type: "oauth" });
    assertEquals(messages.at(-1), "Logged in to ChatGPT Plus/Pro.");
});

Deno.test("runLogoutCommand removes stored credentials", async () => {
    const registry = createRegistry();
    registry.authStorage.set("openai", { type: "api_key", key: "test-key" });
    const { uiAPI, messages } = createUi();

    await runLogoutCommand(["openai"], {
        uiAPI: /** @type {any} */ (uiAPI),
        __testDeps: { getModelRegistry: () => registry },
    });

    assertEquals(registry.authStorage.get("openai"), undefined);
    assertEquals(messages.at(-1), "Logged out of OpenAI.");
});

Deno.test("formatAuthStatus reports configured providers and available models", () => {
    const registry = createRegistry();
    registry.authStorage.set("openai", { type: "api_key", key: "test-key" });

    assertEquals(
        formatAuthStatus(registry),
        [
            "Available models: 1",
            "Providers:",
            "- OpenAI (openai): API key stored",
            "- ChatGPT Plus/Pro (openai-codex): not configured",
        ].join("\n"),
    );
});
