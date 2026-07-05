import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
    __resetPendingSteeringForTests,
    __setSettingsManagerForPersistenceTests,
    __setSteeringUiRefsForTests,
    applyPendingRootSwap,
    collectFooterUsage,
    getActiveModel,
    getFooterSessions,
    persistThinkingLevel,
    resolveTemplateModel,
    setActiveAgent,
    setActiveModel,
    shouldShowFooterThinkingLevel,
    trackPendingSteeringMessage,
} from "./chat-session.js";
import {
    addSubAgentSession,
    clearUserModelOverride,
    getActiveOnMessage,
    getPendingRootSwap,
    getRootAgentSession,
    getSubAgentSessions,
    removeSubAgentSession,
    setActiveUiAPI,
    setPendingRootSwap,
    setProjectStateContext,
    setRootAgentName,
    setRootAgentSession,
} from "../session/session-state.js";
import { __resetSettingsForTests } from "../settings.js";
import { __getRootSessionMetadataForTests, ensureRootAgentSession } from "../session/session.js";
import { EMPTY_PROJECT_DIRECTORY_PROMPT_NOTE } from "../project-state.js";

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

Deno.test("footer usage includes active sub-agent sessions and cache writes", () => {
    const rootSession = {
        sessionManager: {
            getEntries: () => [{
                type: "message",
                message: {
                    role: "assistant",
                    usage: { input: 100, output: 50, cacheRead: 25, cacheWrite: 10, cost: { total: 0.01 } },
                },
            }],
        },
    };
    const subSession = {
        sessionManager: {
            getEntries: () => [{
                type: "message",
                message: {
                    role: "assistant",
                    usage: { inputTokens: 3, outputTokens: 2, cacheReadTokens: 1, cacheWriteTokens: 4, cost: 0.02 },
                },
            }],
        },
    };

    try {
        addSubAgentSession(/** @type {any} */ (subSession));
        const sessions = getFooterSessions(rootSession, getSubAgentSessions());
        assertEquals(sessions, [rootSession, subSession]);

        assertEquals(collectFooterUsage(sessions), {
            input: 103,
            output: 52,
            cacheRead: 26,
            cacheWrite: 14,
            cost: 0.03,
        });
    } finally {
        removeSubAgentSession(/** @type {any} */ (subSession));
    }
});

Deno.test("footer thinking level is hidden until a model is configured", () => {
    assertEquals(shouldShowFooterThinkingLevel("", "medium"), false);
    assertEquals(shouldShowFooterThinkingLevel("test/model", "off"), false);
    assertEquals(shouldShowFooterThinkingLevel("test/model", "medium"), true);
});

Deno.test("setActiveModel reports setModel rejection instead of leaving an unhandled crash", async () => {
    const originalOpenAiKey = Deno.env.get("OPENAI_API_KEY");
    /** @type {string[]} */
    const messages = [];
    let renderRequested = false;

    try {
        Deno.env.set("OPENAI_API_KEY", "test-key");
        await withTempHome("runwield-set-active-model-", async () => {
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
    /** @type {string[]} */
    const persisted = [];

    try {
        __setSettingsManagerForPersistenceTests(() => /** @type {any} */ ({
            setDefaultModel: (/** @type {string} */ model) => {
                persisted.push(`model:${model}`);
                return Promise.resolve();
            },
            setDefaultProvider: (/** @type {string} */ provider) => {
                persisted.push(`provider:${provider}`);
                return Promise.resolve();
            },
        }));
        await setActiveModel("model-a", "provider-a");

        assertEquals(getActiveModel(), "model-a");
        assertEquals(persisted, ["model:model-a", "provider:provider-a"]);
    } finally {
        __setSettingsManagerForPersistenceTests(null);
    }
});

Deno.test("persistThinkingLevel stores the selected level without throwing", async () => {
    /** @type {string[]} */
    const persisted = [];

    try {
        __setSettingsManagerForPersistenceTests(() => /** @type {any} */ ({
            setDefaultThinkingLevel: (/** @type {string} */ level) => {
                persisted.push(level);
                return Promise.resolve();
            },
        }));
        await persistThinkingLevel("high");
        assertEquals(persisted, ["high"]);
    } finally {
        __setSettingsManagerForPersistenceTests(null);
    }
});

function makeSteeringSession() {
    /** @type {((event: any) => void) | null} */
    let subscriber = null;
    return /** @type {any} */ ({
        /** @param {(event: any) => void} fn */
        subscribe(fn) {
            subscriber = fn;
            return () => {
                subscriber = null;
            };
        },
        /** @param {any} event */
        emit(event) {
            subscriber?.(event);
        },
    });
}

Deno.test("trackPendingSteeringMessage only consumes queue updates from the session that accepted steering", () => {
    const sessionA = makeSteeringSession();
    const sessionB = makeSteeringSession();
    const blockA = {};
    const spacerA = {};
    const blockB = {};
    const spacerB = {};
    /** @type {unknown[]} */
    const removed = [];
    /** @type {string[]} */
    const userMessages = [];
    let renders = 0;

    try {
        __setSteeringUiRefsForTests(
            /** @type {any} */ ({
                removeChild: (/** @type {unknown} */ child) => removed.push(child),
            }),
            /** @type {any} */ ({
                appendUserMessage: (/** @type {string} */ text) => userMessages.push(text),
            }),
            /** @type {any} */ ({
                requestRender: () => {
                    renders++;
                },
            }),
        );

        trackPendingSteeringMessage(
            sessionA,
            "same text",
            [],
            /** @type {any} */ (blockA),
            /** @type {any} */ (spacerA),
        );
        trackPendingSteeringMessage(
            sessionB,
            "same text",
            [],
            /** @type {any} */ (blockB),
            /** @type {any} */ (spacerB),
        );

        sessionB.emit({ type: "queue_update", steering: [] });
        assertEquals(userMessages, ["same text"]);
        assertEquals(removed, [blockB, spacerB]);

        sessionA.emit({ type: "queue_update", steering: ["same text"] });
        assertEquals(userMessages, ["same text"]);

        sessionA.emit({ type: "queue_update", steering: [] });
        assertEquals(userMessages, ["same text", "same text"]);
        assertEquals(removed, [blockB, spacerB, blockA, spacerA]);
        assertEquals(renders, 2);
    } finally {
        __resetPendingSteeringForTests();
    }
});

Deno.test("setActiveModel rebuilds root session tool set when switching between vision and text-only models", async () => {
    const originalOpenAiKey = Deno.env.get("OPENAI_API_KEY");
    const originalCwd = Deno.cwd();
    const tempProject = await Deno.makeTempDir({ prefix: "runwield-model-switch-project-" });
    /** @type {Set<any>} */
    const rootsBuiltDuringTest = new Set();
    try {
        await withTempHome("runwield-model-switch-home-", async (tempHome) => {
            Deno.chdir(tempProject);
            Deno.env.set("OPENAI_API_KEY", "test-key");
            await Deno.mkdir(join(tempHome, ".wld"), { recursive: true });
            await Deno.writeTextFile(
                join(tempHome, ".wld", "models.json"),
                JSON.stringify({
                    providers: {
                        test: {
                            baseUrl: "https://example.invalid/v1",
                            api: "openai-completions",
                            apiKey: "test-key",
                            models: [
                                { id: "text", input: ["text"] },
                                { id: "vision", input: ["text", "image"] },
                            ],
                        },
                    },
                }),
            );
            await Deno.writeTextFile(
                join(tempHome, ".wld", "settings.json"),
                JSON.stringify({
                    visionFallback: { model: "test/vision" },
                }),
            );
            __resetSettingsForTests();
            clearUserModelOverride();
            setProjectStateContext(EMPTY_PROJECT_DIRECTORY_PROMPT_NOTE);
            setActiveUiAPI(/** @type {any} */ ({ appendSystemMessage: () => {}, requestRender: () => {} }));

            await ensureRootAgentSession({
                agentName: "operator",
                modelOverride: "test/text",
                _agentDefOverride: {
                    name: "operator",
                    displayName: "Operator",
                    model: "",
                    description: "Test operator",
                    tools: ["read"],
                    systemPrompt: "Test operator prompt.",
                },
            });
            let session = getRootAgentSession();
            rootsBuiltDuringTest.add(session);
            const firstRoot = /** @type {any} */ (session);
            let firstRootDisposeCalls = 0;
            const firstRootDispose = firstRoot.dispose.bind(firstRoot);
            firstRoot.dispose = () => {
                firstRootDisposeCalls += 1;
                firstRootDispose();
            };
            assertEquals(
                __getRootSessionMetadataForTests(/** @type {any} */ (session)).tools.includes("see_image"),
                true,
            );
            assertEquals(
                __getRootSessionMetadataForTests(/** @type {any} */ (session)).projectStateContext,
                EMPTY_PROJECT_DIRECTORY_PROMPT_NOTE,
            );

            await setActiveModel("vision", "test");
            session = getRootAgentSession();
            rootsBuiltDuringTest.add(session);
            assertEquals(firstRootDisposeCalls, 0);
            assertEquals(
                __getRootSessionMetadataForTests(/** @type {any} */ (session)).tools.includes("see_image"),
                false,
            );
            assertEquals(
                __getRootSessionMetadataForTests(/** @type {any} */ (session)).projectStateContext,
                EMPTY_PROJECT_DIRECTORY_PROMPT_NOTE,
            );

            await setActiveModel("text", "test");
            session = getRootAgentSession();
            rootsBuiltDuringTest.add(session);
            assertEquals(firstRootDisposeCalls, 0);
            assertEquals(
                __getRootSessionMetadataForTests(/** @type {any} */ (session)).tools.includes("see_image"),
                true,
            );
            assertEquals(
                __getRootSessionMetadataForTests(/** @type {any} */ (session)).projectStateContext,
                EMPTY_PROJECT_DIRECTORY_PROMPT_NOTE,
            );
        });
    } finally {
        rootsBuiltDuringTest.add(getRootAgentSession());
        for (const root of rootsBuiltDuringTest) {
            try {
                root?.dispose?.();
            } catch (_e) { /* ignore */ }
        }
        setRootAgentSession(null);
        setRootAgentName(null);
        setActiveUiAPI(null);
        setProjectStateContext("");
        Deno.chdir(originalCwd);
        if (originalOpenAiKey === undefined) Deno.env.delete("OPENAI_API_KEY");
        else Deno.env.set("OPENAI_API_KEY", originalOpenAiKey);
        await Deno.remove(tempProject, { recursive: true });
    }
});
