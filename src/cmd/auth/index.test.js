import { assertEquals } from "@std/assert";
import {
    formatAuthStatus,
    getLoginProviderOptions,
    runLoginCommand,
    runLogoutCommand,
    runStatusCommand,
} from "./index.js";

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
    /** @type {Array<string | null>} */
    const selections = [];
    /** @type {string[]} */
    const textInputs = [];
    /** @type {Array<{ title: string, options?: { defaultValue?: string, placeholder?: string, allowEmpty?: boolean, persistResult?: boolean } }>} */
    const textPrompts = [];
    let modelSelectorCalls = 0;
    return {
        messages,
        selections,
        textInputs,
        textPrompts,
        get modelSelectorCalls() {
            return modelSelectorCalls;
        },
        uiAPI: {
            appendSystemMessage: (/** @type {string} */ message) => messages.push(message),
            appendAgentMessageStart: () => ({ appendText: () => {} }),
            requestRender: () => {},
            promptSelect: () => Promise.resolve(selections.shift() ?? null),
            promptText: (/** @type {string} */ title, /** @type {any} */ options) => {
                textPrompts.push({ title, options });
                return Promise.resolve(textInputs.shift() ?? null);
            },
            showModelSelector: () => {
                modelSelectorCalls++;
            },
            abortActivePrompt: () => {},
        },
    };
}

Deno.test("getLoginProviderOptions separates subscription and API key providers", () => {
    const registry = /** @type {any} */ (createRegistry());

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

Deno.test("runLoginCommand prompts for auth type and provider when args are omitted", async () => {
    const registry = createRegistry();
    const { uiAPI, selections, textInputs, messages } = createUi();
    selections.push("api_key", "openai");
    textInputs.push("prompted-key");

    await runLoginCommand([], {
        uiAPI: /** @type {any} */ (uiAPI),
        __testDeps: { getModelRegistry: () => registry },
    });

    assertEquals(registry.authStorage.get("openai"), { type: "api_key", key: "prompted-key" });
    assertEquals(messages.at(-1), "Logged in to OpenAI.");
});

Deno.test("runLoginCommand keeps API key prompt private and opens model selector with router active", async () => {
    const registry = createRegistry();
    const ui = createUi();
    ui.textInputs.push("secret-key");
    /** @type {string[]} */
    const afterLoginActions = [];
    ui.uiAPI.showModelSelector = () => {
        afterLoginActions.push("model");
    };

    await runLoginCommand(["api-key", "openai"], {
        uiAPI: /** @type {any} */ (ui.uiAPI),
        sessionId: "session-1",
        sessionRuntime: /** @type {any} */ ({
            switchAgent: (
                /** @type {string} */ _sessionId,
                /** @type {{ agentName: string }} */ options,
            ) => afterLoginActions.push(`agent:${options.agentName}`),
        }),
        __testDeps: { getModelRegistry: () => registry },
    });

    assertEquals(ui.textPrompts, [{
        title: "Enter API key for OpenAI:",
        options: { allowEmpty: false, persistResult: false },
    }]);
    assertEquals(afterLoginActions, ["model", "agent:router"]);
});

Deno.test("runLoginCommand lets provider prompt escape return to auth method menu", async () => {
    const registry = createRegistry();
    const ui = createUi();
    ui.selections.push("oauth", null, "api_key", "openai");
    ui.textInputs.push("prompted-key");

    await runLoginCommand([], {
        uiAPI: /** @type {any} */ (ui.uiAPI),
        __testDeps: { getModelRegistry: () => registry },
    });

    assertEquals(registry.authStorage.get("openai"), { type: "api_key", key: "prompted-key" });
    assertEquals(registry.authStorage.get("openai-codex"), undefined);
});

Deno.test("runLoginCommand returns quietly when auth type or provider prompts are cancelled", async () => {
    const registry = createRegistry();
    const first = createUi();

    await runLoginCommand([], {
        uiAPI: /** @type {any} */ (first.uiAPI),
        __testDeps: { getModelRegistry: () => registry },
    });

    assertEquals(first.messages, []);

    const second = createUi();
    second.selections.push("api_key");
    await runLoginCommand([], {
        uiAPI: /** @type {any} */ (second.uiAPI),
        __testDeps: { getModelRegistry: () => registry },
    });

    assertEquals(second.messages, []);
});

Deno.test("runLoginCommand reports unavailable providers and cancelled API key input", async () => {
    const noApiProviders = createRegistry();
    noApiProviders.getAll = () => [{ provider: "openai-codex" }];
    const noProviderUi = createUi();

    await runLoginCommand(["api-key"], {
        uiAPI: /** @type {any} */ (noProviderUi.uiAPI),
        __testDeps: { getModelRegistry: () => noApiProviders },
    });

    assertEquals(noProviderUi.messages, ["No API key providers available."]);

    const registry = createRegistry();
    const cancelled = createUi();
    await runLoginCommand(["api-key", "openai"], {
        uiAPI: /** @type {any} */ (cancelled.uiAPI),
        __testDeps: { getModelRegistry: () => registry },
    });

    assertEquals(registry.authStorage.get("openai"), undefined);
    assertEquals(cancelled.messages, []);
});

Deno.test("runLoginCommand exercises subscription callbacks", async () => {
    const registry = /** @type {any} */ (createRegistry());
    registry.authStorage.login = async (
        /** @type {string} */ providerId,
        /** @type {any} */ callbacks,
    ) => {
        callbacks.onAuth({ url: "https://auth.example", instructions: "Follow the light" });
        assertEquals(await callbacks.onPrompt({ message: "Enter code", placeholder: "123" }), "code-value");
        callbacks.onProgress("Halfway there");
        assertEquals(
            await callbacks.onSelect({ message: "Choose account", options: [{ id: "acct", label: "Account" }] }),
            "acct",
        );
        assertEquals(await callbacks.onManualCodeInput(), "redirect-url");
        registry.authStorage.set(providerId, /** @type {any} */ ({ type: "oauth" }));
    };
    const { uiAPI, selections, textInputs, messages } = createUi();
    textInputs.push("code-value", "redirect-url");
    selections.push("acct");

    await runLoginCommand(["subscription", "openai-codex"], {
        uiAPI: /** @type {any} */ (uiAPI),
        __testDeps: { getModelRegistry: () => registry },
    });

    assertEquals(messages.includes("Halfway there"), true);
    assertEquals(messages.some((message) => message.includes("https://auth.example")), true);
    assertEquals(messages.at(-1), "Logged in to ChatGPT Plus/Pro.");
});

Deno.test("runLoginCommand reports non-cancel login failures", async () => {
    const registry = /** @type {any} */ (createRegistry());
    registry.authStorage.login = () => Promise.reject(new Error("oauth unavailable"));
    const { uiAPI, messages } = createUi();

    await runLoginCommand(["subscription", "openai-codex"], {
        uiAPI: /** @type {any} */ (uiAPI),
        __testDeps: { getModelRegistry: () => registry },
    });

    assertEquals(messages, ["Failed to login to ChatGPT Plus/Pro: oauth unavailable"]);
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

Deno.test("runLogoutCommand reports no credentials, prompt cancellation, and logout failures", async () => {
    const emptyRegistry = createRegistry();
    const emptyUi = createUi();
    await runLogoutCommand([], {
        uiAPI: /** @type {any} */ (emptyUi.uiAPI),
        __testDeps: { getModelRegistry: () => emptyRegistry },
    });
    assertEquals(emptyUi.messages, ["No stored credentials to remove."]);

    const cancelRegistry = createRegistry();
    cancelRegistry.authStorage.set("openai", { type: "api_key", key: "test-key" });
    const cancelUi = createUi();
    await runLogoutCommand([], {
        uiAPI: /** @type {any} */ (cancelUi.uiAPI),
        __testDeps: { getModelRegistry: () => cancelRegistry },
    });
    assertEquals(cancelRegistry.authStorage.get("openai"), { type: "api_key", key: "test-key" });
    assertEquals(cancelUi.messages, []);

    const failingRegistry = createRegistry();
    failingRegistry.authStorage.set("openai", { type: "api_key", key: "test-key" });
    failingRegistry.authStorage.logout = () => {
        throw new Error("locked");
    };
    const failingUi = createUi();
    await runLogoutCommand(["openai"], {
        uiAPI: /** @type {any} */ (failingUi.uiAPI),
        __testDeps: { getModelRegistry: () => failingRegistry },
    });
    assertEquals(failingUi.messages, ["Logout failed: locked"]);
});

Deno.test("runLogoutCommand prompts for provider when no provider arg is supplied", async () => {
    const registry = createRegistry();
    registry.authStorage.set("openai", { type: "api_key", key: "test-key" });
    const { uiAPI, selections, messages } = createUi();
    selections.push("openai");

    await runLogoutCommand([], {
        uiAPI: /** @type {any} */ (uiAPI),
        __testDeps: { getModelRegistry: () => registry },
    });

    assertEquals(registry.authStorage.get("openai"), undefined);
    assertEquals(messages, ["Logged out of OpenAI."]);
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

Deno.test("formatAuthStatus reports each non-stored auth source", () => {
    const sources = ["environment", "runtime", "fallback", "models_json_key", "models_json_command", "stored"];
    const registry = /** @type {any} */ (createRegistry());
    registry.authStorage.getOAuthProviders = () => [];
    registry.getAll = () => sources.map((source) => ({ provider: source }));
    registry.getAvailable = () => [];
    registry.getProviderDisplayName = (/** @type {string} */ providerId) => providerId;
    registry.getProviderAuthStatus = (/** @type {string} */ providerId) => ({
        source: providerId,
        label: providerId === "environment" ? "OPENAI_API_KEY" : undefined,
    });

    assertEquals(
        formatAuthStatus(registry),
        [
            "Available models: 0",
            "Providers:",
            "- environment (environment): environment OPENAI_API_KEY",
            "- fallback (fallback): custom provider config",
            "- models_json_command (models_json_command): command in models.json",
            "- models_json_key (models_json_key): key in models.json",
            "- runtime (runtime): runtime API key",
            "- stored (stored): stored",
        ].join("\n"),
    );
});

Deno.test("runStatusCommand writes to UI or console depending on context", async () => {
    const registry = createRegistry();
    const { uiAPI, messages } = createUi();

    await runStatusCommand([], {
        uiAPI: /** @type {any} */ (uiAPI),
        __testDeps: { getModelRegistry: () => registry },
    });

    assertEquals(messages[0].startsWith("Available models:"), true);

    const originalLog = console.log;
    /** @type {string[]} */
    const logs = [];
    console.log = (/** @type {string} */ message) => logs.push(message);
    try {
        await runStatusCommand([], {
            __testDeps: { getModelRegistry: () => registry },
        });
    } finally {
        console.log = originalLog;
    }

    assertEquals(logs[0].startsWith("Available models:"), true);
});
