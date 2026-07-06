import { assertEquals } from "@std/assert";
import { estimateSessionContextTokens, runResumeCommand } from "./index.js";
import { AGENTS } from "../../constants.js";
import { HostedSession } from "../../shared/session/hosted-session.js";

/**
 * @typedef {{ title: string, options: Array<{ value: string, label: string }> }} PromptRecord
 */

/** @param {string} [id] */
function makeHostedSession(id = `resume-command-${crypto.randomUUID()}`) {
    return new HostedSession({ id, cwd: Deno.cwd() });
}

/**
 * @param {Object} opts
 * @param {string[]} opts.selections
 * @param {PromptRecord[]} opts.prompts
 * @param {string[]} opts.messages
 * @param {number[]} opts.clearCalls
 * @returns {{ uiAPI: import('../../ui/tui/types.js').UiAPI, editor: import('../../ui/tui/types.js').EditorAPI }}
 */
function makeUi({ selections, prompts, messages, clearCalls }) {
    const uiAPI = /** @type {import('../../ui/tui/types.js').UiAPI} */ ({
        appendSystemMessage: (msg) => messages.push(String(msg)),
        appendAgentMessageStart: () => ({ appendText: () => {} }),
        requestRender: () => {},
        promptSelect: (title, options) => {
            prompts.push({ title, options: /** @type {Array<{ value: string, label: string }>} */ (options) });
            return Promise.resolve(selections.shift() ?? null);
        },
        promptText: () => Promise.resolve(null),
        showModelSelector: () => {},
        clearMessages: () => {
            clearCalls.push(1);
        },
    });

    const editor = /** @type {import('../../ui/tui/types.js').EditorAPI} */ ({
        disableSubmit: true,
        setText: () => {},
        setAutocompleteProvider: () => {},
        handleInput: () => {},
    });

    return { uiAPI, editor };
}

/**
 * @param {{ sessionManager: any, compactSession?: any, estimateTokens?: number }} opts
 */
function makeDeps({ sessionManager, compactSession, estimateTokens }) {
    /** @type {any[]} */
    const ensuredManagers = [];
    /** @type {string[]} */
    const agentNames = [];
    /** @type {Array<string | undefined>} */
    const modelOverrides = [];
    let openCount = 0;
    let hydrated = 0;

    const deps = {
        SessionManager: {
            list: () =>
                Promise.resolve([{
                    path: "session.jsonl",
                    id: "session-id",
                    modified: new Date("2026-06-14T00:00:00.000Z"),
                    messageCount: 2,
                    firstMessage: "hello",
                }]),
            open: () => {
                openCount++;
                return sessionManager;
            },
        },
        ensureRootAgentSession: (
            /** @type {{ hostedSession: HostedSession, agentName: string, sessionManager: any }} */ _opts,
        ) => {
            agentNames.push(_opts.agentName);
            ensuredManagers.push(_opts.sessionManager);
            modelOverrides.push(/** @type {{ modelOverride?: string }} */ (_opts).modelOverride);
            if (compactSession) {
                _opts.hostedSession.setRootAgentSession(compactSession);
            }
            return Promise.resolve(compactSession || {});
        },
        restorePersistedMessagesToUi: () => {
            hydrated++;
        },
        resolveResumeAgentName: () => Promise.resolve(AGENTS.PLANNER),
        getResumeModelSelection: () => ({ modelOverride: "test/resumed-model", contextWindow: 100 }),
        getCompactThresholdPercent: () => 50,
        estimateSessionContextTokens: estimateTokens === undefined
            ? estimateSessionContextTokens
            : () =>
                Promise.resolve({
                    estimatedTokens: estimateTokens,
                    messageCount: 1,
                    model: { provider: "test", modelId: "resumed-model" },
                }),
    };

    return {
        deps,
        get openCount() {
            return openCount;
        },
        get hydrated() {
            return hydrated;
        },
        ensuredManagers,
        agentNames,
        modelOverrides,
    };
}

Deno.test("estimateSessionContextTokens counts hydrated context instead of compaction tokensBefore", async () => {
    const result = await estimateSessionContextTokens({
        buildSessionContext: () => ({
            messages: [
                { role: "compactionSummary", summary: "abcdefgh" },
                { role: "user", content: "abcd" },
            ],
            model: { provider: "test", modelId: "resumed-model" },
        }),
    });

    assertEquals(result, {
        estimatedTokens: 3,
        messageCount: 2,
        model: { provider: "test", modelId: "resumed-model" },
    });
});

Deno.test("runResumeCommand does not offer compaction when hydrated context is below threshold", async () => {
    const hostedSession = makeHostedSession();
    /** @type {PromptRecord[]} */
    const prompts = [];
    /** @type {string[]} */
    const messages = [];
    /** @type {number[]} */
    const clearCalls = [];
    const { uiAPI, editor } = makeUi({
        selections: ["session.jsonl"],
        prompts,
        messages,
        clearCalls,
    });
    const sessionManager = {
        getSessionId: () => "session-id",
        buildSessionContext: () => ({
            messages: [
                { role: "compactionSummary", summary: "abcdefgh" },
                { role: "user", content: "abcd" },
            ],
        }),
    };
    const harness = makeDeps({ sessionManager });

    try {
        await runResumeCommand([], {
            uiAPI,
            editor,
            hostedSession,
            __testDeps: harness.deps,
        });

        assertEquals(prompts.length, 1);
        assertEquals(prompts[0].title, "Select a session to resume:");
        assertEquals(harness.openCount, 1);
        assertEquals(harness.ensuredManagers, [sessionManager]);
        assertEquals(harness.agentNames, [AGENTS.PLANNER]);
        assertEquals(harness.modelOverrides, ["test/resumed-model"]);
        assertEquals(harness.hydrated, 1);
        assertEquals(clearCalls.length, 1);
        assertEquals(messages, ["Resumed session: session-id"]);
    } finally {
        hostedSession.dispose();
    }
});

Deno.test("runResumeCommand offers compaction for large context and resumes as-is when selected", async () => {
    const hostedSession = makeHostedSession();
    /** @type {PromptRecord[]} */
    const prompts = [];
    /** @type {string[]} */
    const messages = [];
    /** @type {number[]} */
    const clearCalls = [];
    const { uiAPI, editor } = makeUi({
        selections: ["session.jsonl", "resume"],
        prompts,
        messages,
        clearCalls,
    });
    const sessionManager = {
        getSessionId: () => "session-id",
        buildSessionContext: () => ({ messages: [] }),
    };
    const harness = makeDeps({ sessionManager, estimateTokens: 60 });

    try {
        await runResumeCommand([], {
            uiAPI,
            editor,
            hostedSession,
            __testDeps: harness.deps,
        });

        assertEquals(prompts.length, 2);
        assertEquals(prompts[1].title, "Session is large — how would you like to resume?");
        assertEquals(prompts[1].options.map((opt) => opt.value), ["compact", "resume", "cancel"]);
        assertEquals(harness.openCount, 1);
        assertEquals(harness.ensuredManagers, [sessionManager]);
        assertEquals(harness.agentNames, [AGENTS.PLANNER]);
        assertEquals(harness.modelOverrides, ["test/resumed-model"]);
        assertEquals(harness.hydrated, 1);
        assertEquals(clearCalls.length, 1);
        assertEquals(messages, ["Resumed session: session-id"]);
    } finally {
        hostedSession.dispose();
    }
});

Deno.test("runResumeCommand resumes as-is when selected compaction fails", async () => {
    const hostedSession = makeHostedSession();
    /** @type {PromptRecord[]} */
    const prompts = [];
    /** @type {string[]} */
    const messages = [];
    /** @type {number[]} */
    const clearCalls = [];
    let registeredCancel = false;
    const { uiAPI, editor } = makeUi({
        selections: ["session.jsonl", "compact"],
        prompts,
        messages,
        clearCalls,
    });
    const sessionManager = {
        getSessionId: () => "session-id",
        buildSessionContext: () => ({ messages: [] }),
    };
    const compactSession = {
        abortCompaction: () => {},
        compact: () => Promise.reject(new Error("boom")),
    };
    const harness = makeDeps({ sessionManager, compactSession, estimateTokens: 60 });

    try {
        await runResumeCommand([], {
            uiAPI,
            editor,
            hostedSession,
            registerOperationCancel: () => {
                registeredCancel = true;
            },
            __testDeps: harness.deps,
        });

        assertEquals(registeredCancel, true);
        assertEquals(prompts.length, 2);
        assertEquals(harness.openCount, 1);
        assertEquals(harness.ensuredManagers, [sessionManager]);
        assertEquals(harness.agentNames, [AGENTS.PLANNER]);
        assertEquals(harness.modelOverrides, ["test/resumed-model"]);
        assertEquals(harness.hydrated, 1);
        assertEquals(clearCalls.length, 1);
        assertEquals(messages, [
            "Compacting session before resume... (Esc to cancel)",
            "Compaction failed: boom — resuming as-is...\nResumed session: session-id",
        ]);
    } finally {
        hostedSession.dispose();
    }
});

Deno.test("runResumeCommand shows compaction result after compacting and resuming", async () => {
    const hostedSession = makeHostedSession();
    /** @type {PromptRecord[]} */
    const prompts = [];
    /** @type {string[]} */
    const messages = [];
    /** @type {number[]} */
    const clearCalls = [];
    const { uiAPI, editor } = makeUi({
        selections: ["session.jsonl", "compact"],
        prompts,
        messages,
        clearCalls,
    });
    const sessionManager = {
        getSessionId: () => "session-id",
        buildSessionContext: () => ({ messages: [] }),
    };
    const compactSession = {
        abortCompaction: () => {},
        compact: () => Promise.resolve({ tokensBefore: 12345, summary: "summary" }),
    };
    const harness = makeDeps({ sessionManager, compactSession, estimateTokens: 60 });

    try {
        await runResumeCommand([], {
            uiAPI,
            editor,
            hostedSession,
            __testDeps: harness.deps,
        });

        assertEquals(prompts.length, 2);
        assertEquals(harness.openCount, 1);
        assertEquals(harness.ensuredManagers, [sessionManager]);
        assertEquals(harness.agentNames, [AGENTS.PLANNER]);
        assertEquals(harness.modelOverrides, ["test/resumed-model"]);
        assertEquals(harness.hydrated, 1);
        assertEquals(clearCalls.length, 1);
        assertEquals(messages, [
            "Compacting session before resume... (Esc to cancel)",
            "Compacted. Tokens before: 12,345\nResumed (compacted) session: session-id",
        ]);
    } finally {
        hostedSession.dispose();
    }
});
