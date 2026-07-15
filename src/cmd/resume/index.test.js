import { assertEquals } from "@std/assert";
import { runResumeCommand } from "./index.js";

/** @typedef {{ title: string, options: Array<{ value: string, label: string }> }} PromptRecord */

/** @param {string[]} selections */
function makeUi(selections) {
    const prompts = /** @type {PromptRecord[]} */ ([]);
    const messages = /** @type {string[]} */ ([]);
    let clears = 0;
    return {
        prompts,
        messages,
        get clears() {
            return clears;
        },
        uiAPI: /** @type {any} */ ({
            appendSystemMessage: (/** @type {string} */ message) => messages.push(message),
            promptSelect: (/** @type {string} */ title, /** @type {any[]} */ options) => {
                prompts.push({ title, options });
                return Promise.resolve(selections.shift() ?? null);
            },
            clearMessages: () => {
                clears++;
            },
        }),
        editor: /** @type {any} */ ({ disableSubmit: true, setText: () => {} }),
    };
}

/**
 * @param {{ estimatedTokens?: number, compact?: () => Promise<any> }} [options]
 */
function makeRuntime(options = {}) {
    const calls = {
        loads: /** @type {any[]} */ ([]),
        replays: /** @type {string[]} */ ([]),
    };
    const runtime = /** @type {any} */ ({
        getSessionSnapshot: (/** @type {string} */ id) => ({
            id,
            cwd: Deno.cwd(),
            name: id === "loaded-runtime" ? "Resumed Work" : null,
        }),
        listResumableSessions: () =>
            Promise.resolve([{
                path: "/sessions/session.jsonl",
                id: "persisted-id",
                modified: new Date("2026-06-14T00:00:00.000Z"),
                messageCount: 2,
                firstMessage: "hello",
            }]),
        inspectResumableSession: () =>
            Promise.resolve({
                estimatedTokens: options.estimatedTokens ?? 20,
                messageCount: 2,
                model: { provider: "test", modelId: "resumed-model" },
            }),
        loadSession: (/** @type {any} */ request) => {
            calls.loads.push(request);
            return Promise.resolve({
                sessionId: "loaded-runtime",
                sessionManagerId: "persisted-id",
                replayEvents: [],
            });
        },
        compactSession: options.compact || (() => Promise.resolve({ tokensBefore: 12345, summary: "summary" })),
        replaySession: (/** @type {string} */ id) => calls.replays.push(id),
    });
    return { runtime, calls };
}

function testDeps() {
    return {
        getResumeModelSelection: () => ({ modelOverride: "test/resumed-model", contextWindow: 100 }),
        getCompactThresholdPercent: () => 50,
    };
}

Deno.test("runResumeCommand loads, replaces, and replays through SessionRuntime", async () => {
    const ui = makeUi(["/sessions/session.jsonl"]);
    const { runtime, calls } = makeRuntime();
    const replacements = /** @type {string[]} */ ([]);

    await runResumeCommand([], {
        uiAPI: ui.uiAPI,
        editor: ui.editor,
        sessionId: "current-runtime",
        sessionRuntime: runtime,
        replaceRuntimeSession: (id) => replacements.push(id),
        __testDeps: testDeps(),
    });

    assertEquals(ui.prompts.map((prompt) => prompt.title), ["Select a session to resume:"]);
    assertEquals(calls.loads[0].modelOverride, "test/resumed-model");
    assertEquals(replacements, ["loaded-runtime"]);
    assertEquals(calls.replays, ["loaded-runtime"]);
    assertEquals(ui.clears, 1);
    assertEquals(ui.messages, ["Resumed session: persisted-id"]);
});

Deno.test("runResumeCommand offers Runtime compaction for large persisted context", async () => {
    const ui = makeUi(["/sessions/session.jsonl", "resume"]);
    const { runtime } = makeRuntime({ estimatedTokens: 60 });

    await runResumeCommand([], {
        uiAPI: ui.uiAPI,
        editor: ui.editor,
        sessionId: "current-runtime",
        sessionRuntime: runtime,
        replaceRuntimeSession: () => {},
        __testDeps: testDeps(),
    });

    assertEquals(ui.prompts.map((prompt) => prompt.title), [
        "Select a session to resume:",
        "Session is large — how would you like to resume?",
    ]);
    assertEquals(ui.prompts[1].options.map((option) => option.value), ["compact", "resume", "cancel"]);
});

Deno.test("runResumeCommand compacts through SessionRuntime", async () => {
    const ui = makeUi(["/sessions/session.jsonl", "compact"]);
    const { runtime } = makeRuntime({ estimatedTokens: 60 });
    await runResumeCommand([], {
        uiAPI: ui.uiAPI,
        editor: ui.editor,
        sessionId: "current-runtime",
        sessionRuntime: runtime,
        replaceRuntimeSession: () => {},
        __testDeps: testDeps(),
    });

    assertEquals(ui.messages, [
        "Compacting session before resume... (Esc to cancel)",
        "Compacted. Tokens before: 12,345\nResumed (compacted) session: persisted-id",
    ]);
});

Deno.test("runResumeCommand reports compaction failure and resumes via Runtime", async () => {
    const ui = makeUi(["/sessions/session.jsonl", "compact"]);
    const { runtime, calls } = makeRuntime({
        estimatedTokens: 60,
        compact: () => Promise.reject(new Error("boom")),
    });

    await runResumeCommand([], {
        uiAPI: ui.uiAPI,
        editor: ui.editor,
        sessionId: "current-runtime",
        sessionRuntime: runtime,
        replaceRuntimeSession: () => {},
        __testDeps: testDeps(),
    });

    assertEquals(calls.replays, ["loaded-runtime"]);
    assertEquals(ui.messages.at(-1), "Compaction failed: boom — resuming as-is...\nResumed session: persisted-id");
});
