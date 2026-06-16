import { assertEquals } from "@std/assert";
import {
    applyPendingRootSwap,
    getActiveModel,
    persistThinkingLevel,
    resolveTemplateModel,
    setActiveAgent,
    setActiveModel,
} from "./chat-session.js";
import {
    getActiveOnMessage,
    getPendingRootSwap,
    setActiveUiAPI,
    setPendingRootSwap,
    setRootAgentName,
    setRootAgentSession,
} from "../session/session-state.js";
import { __resetSettingsForTests } from "../settings.js";

/**
 * @param {string} prefix
 * @param {(tempHome: string) => Promise<void>} fn
 */
async function withTempHome(prefix, fn) {
    const originalHome = Deno.env.get("HOME");
    const tempHome = await Deno.makeTempDir({ prefix });

    try {
        Deno.env.set("HOME", tempHome);
        __resetSettingsForTests();
        await fn(tempHome);
    } finally {
        __resetSettingsForTests();
        if (originalHome === undefined) Deno.env.delete("HOME");
        else Deno.env.set("HOME", originalHome);
        __resetSettingsForTests();
        await Deno.remove(tempHome, { recursive: true });
    }
}

Deno.test("setActiveModel reports setModel rejection instead of leaving an unhandled crash", async () => {
    const originalOpenAiKey = Deno.env.get("OPENAI_API_KEY");
    /** @type {string[]} */
    const messages = [];
    let renderRequested = false;

    try {
        Deno.env.set("OPENAI_API_KEY", "test-key");
        await withTempHome("harns-set-active-model-", async () => {
            setActiveUiAPI(
                /** @type {any} */ ({
                    appendSystemMessage: (/** @type {string} */ message) => messages.push(message),
                    requestRender: () => {
                        renderRequested = true;
                    },
                }),
            );
            setRootAgentSession(
                /** @type {any} */ ({
                    setModel: () => Promise.reject(new Error("No API key for openai/gpt-5")),
                }),
            );

            await setActiveModel("gpt-5", "openai");

            assertEquals(messages, ["Failed to switch model: No API key for openai/gpt-5"]);
            assertEquals(renderRequested, true);
        });
    } finally {
        setRootAgentSession(null);
        setActiveUiAPI(null);
        if (originalOpenAiKey === undefined) Deno.env.delete("OPENAI_API_KEY");
        else Deno.env.set("OPENAI_API_KEY", originalOpenAiKey);
    }
});

Deno.test("setActiveAgent updates the active handler and queues a pending root swap for a different agent", () => {
    const renders = [];
    const handler = () => Promise.resolve();
    const uiAPI = /** @type {any} */ ({
        requestRender: () => renders.push(1),
    });

    try {
        setRootAgentName("router");
        setPendingRootSwap(null);

        setActiveAgent("planner", handler, uiAPI, "test/model");

        assertEquals(getActiveOnMessage(), handler);
        assertEquals(getPendingRootSwap(), {
            agentName: "planner",
            displayName: "Planner",
            model: "test/model",
        });
        assertEquals(renders.length, 1);
    } finally {
        setRootAgentName(null);
        setPendingRootSwap(null);
    }
});

Deno.test("setActiveAgent only requests render when target already owns the root", () => {
    const renders = [];
    const handler = () => Promise.resolve();
    const uiAPI = /** @type {any} */ ({
        requestRender: () => renders.push(1),
    });

    try {
        setRootAgentName("router");
        setPendingRootSwap({ agentName: "planner", displayName: "Planner" });

        setActiveAgent("router", handler, uiAPI);

        assertEquals(getActiveOnMessage(), handler);
        assertEquals(getPendingRootSwap(), { agentName: "planner", displayName: "Planner" });
        assertEquals(renders.length, 1);
    } finally {
        setRootAgentName(null);
        setPendingRootSwap(null);
    }
});

Deno.test("applyPendingRootSwap clears no-op swaps without rebuilding", async () => {
    /** @type {string[]} */
    const messages = [];
    const uiAPI = /** @type {any} */ ({
        appendSystemMessage: (/** @type {string} */ message) => messages.push(message),
        requestRender: () => {},
    });

    try {
        setRootAgentName("planner");
        setPendingRootSwap({ agentName: "planner", displayName: "Planner" });

        await applyPendingRootSwap(uiAPI);

        assertEquals(getPendingRootSwap(), null);
        assertEquals(messages, []);
    } finally {
        setRootAgentName(null);
        setPendingRootSwap(null);
    }
});

Deno.test("resolveTemplateModel validates provider/id format, model lookup, and configured auth", () => {
    const registry = {
        find: (/** @type {string} */ provider, /** @type {string} */ id) =>
            provider === "test" && id === "model" ? { provider, id } : null,
        hasConfiguredAuth: (/** @type {unknown} */ model) => !!model,
    };
    const noAuthRegistry = {
        find: () => ({ provider: "test", id: "model" }),
        hasConfiguredAuth: () => false,
    };

    assertEquals(resolveTemplateModel("not-strict", registry), { ok: false });
    assertEquals(resolveTemplateModel("test/missing", registry), { ok: false });
    assertEquals(resolveTemplateModel("test/model", noAuthRegistry), { ok: false });
    assertEquals(resolveTemplateModel("test/model", registry), { ok: true, provider: "test", id: "model" });
});

Deno.test("getActiveModel reflects setActiveModel state when no root session is present", async () => {
    setRootAgentSession(null);

    await withTempHome("harns-active-model-state-", async () => {
        await setActiveModel("model-a", "provider-a");
    });

    assertEquals(getActiveModel(), "model-a");
});

Deno.test("persistThinkingLevel stores the selected level without throwing", async () => {
    await withTempHome("harns-thinking-level-", async () => {
        await persistThinkingLevel("high");
    });
});
