import { assertEquals, assertRejects, assertStrictEquals } from "@std/assert";
import { HostedSession } from "./hosted-session.js";
import { SessionHost } from "./session-host.js";
import { RuntimeEventTypes } from "./session-runtime-events.js";
import { HANDOFF_LIMIT_MESSAGE, SessionRuntime, SessionTurnInProgressError } from "./session-runtime.js";

/** @param {string} id */
function makeSessionManager(id) {
    return {
        disposed: false,
        getSessionId: () => id,
        getCwd: () => `/repo/${id}`,
        dispose() {
            this.disposed = true;
        },
    };
}

Deno.test("SessionRuntime composes SessionHost for create adopt list and close", () => {
    const host = new SessionHost();
    const runtime = new SessionRuntime({ sessionHost: host });
    const createdManager = makeSessionManager("created");
    const adopted = new HostedSession({ id: "adopted", cwd: "/repo/adopted" });

    const created = runtime.createSession({ sessionManager: createdManager });
    const adoptedResult = runtime.adoptSession(adopted);

    assertStrictEquals(created, host.getSession("created"));
    assertStrictEquals(adoptedResult, adopted);
    assertEquals(runtime.listSessions().map((session) => session.id), ["created", "adopted"]);
    assertEquals(runtime.closeSession("created"), { ok: true, closed: true });
    assertEquals(created.disposed, true);
    assertEquals(createdManager.disposed, true);
    assertEquals(runtime.closeSession("missing"), { ok: true, closed: false });
});

Deno.test("SessionRuntime promptSession consumes only the target HostedSession handoff", async () => {
    const current = new HostedSession({ id: "current" });
    const other = new HostedSession({ id: "other" });
    const runtime = new SessionRuntime();
    /** @type {string[]} */
    const seenRequests = [];
    current.setRootSessionManager(/** @type {any} */ ({ id: "current-root" }));
    current.setActiveOnMessage((/** @type {string} */ request) => {
        seenRequests.push(request);
        if (seenRequests.length === 1) current.setPendingSwitchHandoff({ agentName: "router", reason: "handoff" });
        return Promise.resolve();
    });
    other.setPendingSwitchHandoff({ agentName: "router", reason: "other handoff" });

    const result = await runtime.promptSession(current, {
        initialRequest: "first",
        initialImages: [],
    });

    assertEquals(result.ok, true);
    assertEquals(result.turns, 2);
    assertEquals(result.handoffs, 1);
    assertEquals(seenRequests, ["first", "handoff"]);
    assertEquals(current.consumePendingSwitchHandoff(), null);
    assertEquals(other.consumePendingSwitchHandoff()?.reason, "other handoff");
});

Deno.test("SessionRuntime keeps the session busy while compatibility UI work is still in flight", async () => {
    const hostedSession = new HostedSession({ id: "busy-owner" });
    hostedSession.setRootSessionManager(/** @type {any} */ ({ id: "root" }));
    /**
     * @param {string} _request
     * @param {import('./types.js').ImageAttachment[]} _images
     * @param {import('../types.js').SessionUiPort} uiAPI
     */
    const simulateCompatibilityWork = (_request, _images, uiAPI) => {
        uiAPI.setBusy?.(false);
        uiAPI.setBusy?.(true);
        return Promise.resolve();
    };
    hostedSession.setActiveOnMessage(simulateCompatibilityWork);
    const runtime = new SessionRuntime();
    /** @type {boolean[]} */
    const busyStates = [];
    runtime.subscribeSessionEvents(hostedSession, (event) => {
        if (event.type === RuntimeEventTypes.BUSY_CHANGED) busyStates.push(event.busy);
    });

    await runtime.promptSession(hostedSession, {
        initialRequest: "start",
        initialImages: [],
    });

    assertEquals(busyStates, [true, false]);
});

Deno.test("SessionRuntime promptSession preserves the chained handoff limit", async () => {
    const hostedSession = new HostedSession({ id: "limited" });
    /** @type {string[]} */
    const messages = [];
    let turnCount = 0;
    hostedSession.setRootSessionManager(/** @type {any} */ ({ id: "root" }));
    hostedSession.setActiveOnMessage(() => {
        turnCount++;
        hostedSession.setPendingSwitchHandoff({ agentName: "router", reason: `handoff ${turnCount}` });
        return Promise.resolve();
    });
    const runtime = new SessionRuntime();
    runtime.subscribeSessionEvents(hostedSession, (event) => {
        if (event.type === RuntimeEventTypes.SYSTEM_STATUS) messages.push(event.message);
    });

    const result = await runtime.promptSession(hostedSession, {
        initialRequest: "start",
        initialImages: [],
    });

    assertEquals(turnCount, 5);
    assertEquals(result.handoffLimitReached, true);
    assertEquals(messages.includes(HANDOFF_LIMIT_MESSAGE), true);
});

Deno.test("SessionRuntime promptSession applies root swaps before turns and drains final swaps", async () => {
    const hostedSession = new HostedSession({ id: "swaps" });
    hostedSession.setRootSessionManager(/** @type {any} */ ({ id: "root" }));
    /** @type {string[]} */
    const events = [];
    hostedSession.setActiveOnMessage(() => {
        events.push("turn");
        hostedSession.setPendingRootSwap({ agentName: "guide", displayName: "Guide" });
        return Promise.resolve();
    });
    const runtime = new SessionRuntime({
        applyPendingRootSwap: (session) => {
            events.push(`swap:${session.getPendingRootSwap()?.agentName || "none"}`);
            session.setPendingRootSwap(null);
            return Promise.resolve();
        },
    });

    await runtime.promptSession(hostedSession, {
        initialRequest: "start",
        initialImages: [],
    });

    assertEquals(events, ["swap:none", "turn", "swap:guide"]);
});

Deno.test("SessionRuntime cancelSession aborts the target HostedSession and handles missing sessions", () => {
    const hostedSession = new HostedSession({ id: "cancel-me" });
    /** @type {string[]} */
    const aborted = [];
    const runtime = new SessionRuntime({
        abortActiveSession: (session) => {
            aborted.push(session.id);
            return true;
        },
    });

    assertEquals(runtime.cancelSession("missing"), { ok: false, aborted: false, error: "not_found" });
    assertEquals(runtime.cancelSession(hostedSession), { ok: true, aborted: true });
    assertEquals(aborted, ["cancel-me"]);
});

Deno.test("SessionRuntime promptSession reports missing active handler or session manager", async () => {
    const hostedSession = new HostedSession({ id: "missing-handler" });
    /** @type {string[]} */
    const events = [];
    const runtime = new SessionRuntime();
    runtime.subscribeSessionEvents(hostedSession, (event) => {
        events.push(event.type);
    });

    const result = await runtime.promptSession(hostedSession, {
        initialRequest: "hello",
        initialImages: [],
    });

    assertEquals(result, {
        ok: false,
        turns: 0,
        handoffs: 0,
        handoffLimitReached: false,
        error: "missing_active_handler_or_session_manager",
    });
    assertEquals(events, [
        RuntimeEventTypes.USER_MESSAGE,
        RuntimeEventTypes.TURN_START,
        RuntimeEventTypes.BUSY_CHANGED,
        RuntimeEventTypes.SYSTEM_STATUS,
        RuntimeEventTypes.TERMINAL_ERROR,
        RuntimeEventTypes.TURN_END,
        RuntimeEventTypes.BUSY_CHANGED,
    ]);
});

Deno.test("SessionRuntime emits scoped events and unsubscribe is deterministic", () => {
    const runtime = new SessionRuntime();
    const hostedSession = runtime.createSession({ id: "events", cwd: "/repo/events" });
    /** @type {unknown[]} */
    const seen = [];
    const unsubscribe = runtime.subscribeSessionEvents(hostedSession, (event) => {
        seen.push(event);
    });

    runtime.emitSessionEvent(hostedSession, { type: "system_status", message: "hello" });
    unsubscribe();
    runtime.emitSessionEvent(hostedSession, { type: "system_status", message: "ignored" });

    assertEquals(seen.length, 1);
    assertEquals(/** @type {any} */ (seen[0]).sessionId, "events");
    assertEquals(/** @type {any} */ (seen[0]).message, "hello");
});

Deno.test("SessionRuntime loadSession opens persisted session restores agent and returns replay events", async () => {
    const sessionManager = {
        disposed: false,
        getSessionId: () => "persisted-1",
        getCwd: () => "/repo/acp",
        getBranch: () => [
            {
                type: "message",
                id: "u1",
                timestamp: "2026-07-08T00:00:00.000Z",
                message: { role: "user", content: [{ type: "text", text: "hello" }] },
            },
            {
                type: "message",
                id: "a1",
                timestamp: "2026-07-08T00:00:01.000Z",
                message: { role: "assistant", content: [{ type: "text", text: "hi" }] },
            },
            {
                type: "message",
                id: "t1",
                timestamp: "2026-07-08T00:00:02.000Z",
                message: {
                    role: "assistant",
                    content: [{ type: "tool_use", id: "tool-1", name: "bash", input: { secret: "x" } }],
                },
            },
            {
                type: "message",
                id: "tr1",
                timestamp: new Date("2026-07-08T00:00:03.000Z"),
                message: {
                    role: "user",
                    content: [{ type: "tool_result", tool_use_id: "tool-1", content: "password=secret" }],
                },
            },
            {
                type: "future_unknown",
                id: "unknown-1",
                timestamp: 1783478404000,
                payload: { secret: "hidden" },
            },
        ],
        dispose() {
            this.disposed = true;
        },
    };
    const runtime = new SessionRuntime({
        openPersistedRootSession: (options) => {
            assertEquals(options, { cwd: "/repo/acp", sessionId: "persisted-1", sessionPath: undefined });
            return Promise.resolve({
                sessionManager,
                resolved: {
                    cwd: "/repo/acp",
                    sessionDir: "/sessions",
                    sessionId: "persisted-1",
                    sessionPath: "/sessions/persisted-1.jsonl",
                    info: null,
                },
            });
        },
        resolveResumeAgentName: () => Promise.resolve("planner"),
        createAgentHandler: (agentName) => {
            assertEquals(agentName, "planner");
            return () => Promise.resolve();
        },
        ensureRootAgentSession: (opts) => {
            opts.hostedSession.setRootAgentName(opts.agentName);
            opts.hostedSession.setRootAgentSession({ dispose() {} });
            return Promise.resolve(/** @type {any} */ (opts.hostedSession.getRootAgentSession()));
        },
    });

    const result = await runtime.loadSession({ cwd: "/repo/acp", sessionId: "persisted-1" });

    assertEquals(result.hostedSession.id === "persisted-1", false);
    assertEquals(result.hostedSession.cwd, "/repo/acp");
    assertEquals(result.hostedSession.getRootAgentName(), "planner");
    assertEquals(result.sessionManagerId, "persisted-1");
    assertEquals(result.sessionPath, "/sessions/persisted-1.jsonl");
    assertEquals(result.replayEvents.map((event) => event.type), [
        "user_message",
        "assistant_text_delta",
        "tool_start",
        "tool_end",
        "system_status",
    ]);
    assertEquals(/** @type {any} */ (result.replayEvents[0])._meta.replay, true);
    assertEquals(result.replayEvents[3].timestamp, "2026-07-08T00:00:03.000Z");
    assertEquals(result.replayEvents[4].timestamp, "2026-07-08T02:40:04.000Z");
    assertEquals(/** @type {any} */ (result.replayEvents[3]).text, "[tool result replayed]");
    assertEquals(
        /** @type {any} */ (result.replayEvents[4]).message,
        "Persisted session entry replayed: future_unknown",
    );
    assertEquals(JSON.stringify(result.replayEvents).includes("password"), false);
    assertEquals(JSON.stringify(result.replayEvents).includes("secret"), false);
});

Deno.test("SessionRuntime closeAllSessions cancels and disposes all hosted sessions", () => {
    const runtime = new SessionRuntime({ abortActiveSession: () => true });
    const first = runtime.createSession({ id: "first", cwd: "/repo/first" });
    const second = runtime.createSession({ id: "second", cwd: "/repo/second" });
    assertEquals(runtime.closeAllSessions(), { ok: true, closed: 2 });
    assertEquals(first.disposed, true);
    assertEquals(second.disposed, true);
    assertEquals(runtime.listSessions(), []);
});

Deno.test("SessionRuntime loadSession rejects relative cwd", async () => {
    const runtime = new SessionRuntime();
    try {
        await runtime.loadSession({ cwd: "relative", sessionId: "persisted" });
        throw new Error("expected loadSession to reject");
    } catch (error) {
        assertEquals(error instanceof Error && error.message, "SessionRuntime.loadSession requires an absolute cwd");
    }
});

Deno.test("SessionRuntime createPromptReadySession creates Router-backed hosted session", async () => {
    const runtime = new SessionRuntime({
        createRootSessionManager: (mode, cwd) => {
            assertEquals(mode, "new");
            return Promise.resolve(makeSessionManager(cwd.split("/").pop() || "created"));
        },
        createAgentHandler: (agentName) => {
            assertEquals(agentName, "router");
            return () => Promise.resolve();
        },
        ensureRootAgentSession: (opts) => {
            opts.hostedSession.setRootAgentName(opts.agentName);
            opts.hostedSession.setRootAgentSession({ dispose() {} });
            return Promise.resolve(/** @type {any} */ (opts.hostedSession.getRootAgentSession()));
        },
    });
    /** @type {unknown[]} */
    const events = [];

    const hostedSession = await runtime.createPromptReadySession({ cwd: "/repo/acp" });
    runtime.subscribeSessionEvents(hostedSession, (event) => {
        events.push(event);
    });
    runtime.emitSessionEvent(hostedSession, { type: "system_status", message: "ready" });

    assertEquals(hostedSession.id === "acp", false);
    assertEquals(hostedSession.cwd, "/repo/acp");
    assertEquals(hostedSession.getRootAgentName(), "router");
    assertEquals(typeof hostedSession.getActiveOnMessage(), "function");
    assertEquals(typeof /** @type {any} */ (hostedSession.getEventSink()).emit, "function");
    assertEquals(/** @type {any} */ (events[0]).message, "ready");
});

Deno.test("SessionRuntime removes partially initialized sessions when root creation fails", async () => {
    const manager = makeSessionManager("partial");
    const runtime = new SessionRuntime({
        createRootSessionManager: () => Promise.resolve(manager),
        ensureRootAgentSession: () => Promise.reject(new Error("root failed")),
    });

    await assertRejects(
        () => runtime.createPromptReadySession({ cwd: "/repo/partial" }),
        Error,
        "root failed",
    );
    assertEquals(runtime.listSessions(), []);
    assertEquals(manager.disposed, true);
});

Deno.test("SessionRuntime promptSession emits user turn and terminal error events", async () => {
    const hostedSession = new HostedSession({ id: "prompt-events" });
    hostedSession.setRootSessionManager(/** @type {any} */ ({ id: "root" }));
    hostedSession.setActiveOnMessage(() => {
        throw new Error("boom");
    });
    const runtime = new SessionRuntime();
    /** @type {string[]} */
    const types = [];
    runtime.subscribeSessionEvents(hostedSession, (event) => {
        types.push(event.type);
    });

    try {
        await runtime.promptSession(hostedSession, { initialRequest: "hello", initialImages: [] });
        throw new Error("expected prompt to throw");
    } catch (error) {
        assertEquals(error instanceof Error && error.message, "boom");
    }

    assertEquals(types.includes("user_message"), true);
    assertEquals(types.includes("turn_start"), true);
    assertEquals(types.includes("terminal_error"), true);
    assertEquals(types.at(-1), "busy_changed");
    assertEquals(hostedSession.isTurnActive(), false);
});

Deno.test("SessionRuntime owns same-session turn exclusion and exposes busy snapshots", async () => {
    const hostedSession = new HostedSession({ id: "turn-lock", cwd: "/repo/turn-lock" });
    hostedSession.setRootSessionManager(/** @type {any} */ ({ id: "root" }));
    const gate = { release: () => {} };
    hostedSession.setActiveOnMessage(() =>
        new Promise((resolve) => {
            gate.release = () => resolve(undefined);
        })
    );
    const runtime = new SessionRuntime();

    const firstPrompt = runtime.promptSession(hostedSession, {
        initialRequest: "first",
        initialImages: [],
    });
    await Promise.resolve();

    const activeSnapshot = runtime.getSessionSnapshot(hostedSession);
    assertEquals(activeSnapshot?.busy, true);
    assertEquals(typeof activeSnapshot?.activeTurnId, "string");
    await assertRejects(
        () => runtime.promptSession(hostedSession, { initialRequest: "second", initialImages: [] }),
        SessionTurnInProgressError,
        "already has an active turn",
    );

    gate.release();
    await firstPrompt;
    const idleSnapshot = runtime.getSessionSnapshot(hostedSession);
    assertEquals(idleSnapshot?.busy, false);
    assertEquals(idleSnapshot?.activeTurnId, null);
});

Deno.test("SessionRuntime keeps canceled turns reserved and closes only after prompt settlement", async () => {
    const runtime = new SessionRuntime({ abortActiveSession: () => true });
    const hostedSession = runtime.createSession({ id: "settled-close", cwd: "/repo/settled-close" });
    hostedSession.setRootSessionManager(/** @type {any} */ ({ id: "root", dispose() {} }));
    let release = () => {};
    hostedSession.setActiveOnMessage(() =>
        new Promise((resolve) => {
            release = () => resolve(undefined);
        })
    );

    const prompt = runtime.promptSession(hostedSession, { initialRequest: "long turn", initialImages: [] });
    await Promise.resolve();
    const close = runtime.closeSessionWhenIdle(hostedSession);
    await Promise.resolve();

    assertEquals(hostedSession.isTurnActive(), true);
    assertEquals(hostedSession.disposed, false);
    await assertRejects(
        () => runtime.promptSession(hostedSession, { initialRequest: "overlap", initialImages: [] }),
        SessionTurnInProgressError,
    );

    release();
    await prompt;
    assertEquals(await close, { ok: true, closed: true });
    assertEquals(hostedSession.disposed, true);
});

Deno.test("SessionRuntime permits independent Hosted Sessions to prompt concurrently", async () => {
    const runtime = new SessionRuntime();
    const alpha = runtime.createSession({ id: "concurrent-alpha", cwd: "/repo/alpha" });
    const beta = runtime.createSession({ id: "concurrent-beta", cwd: "/repo/beta" });
    alpha.setRootSessionManager(/** @type {any} */ ({ id: "alpha-root" }));
    beta.setRootSessionManager(/** @type {any} */ ({ id: "beta-root" }));
    /** @type {Array<() => void>} */
    const releases = [];
    for (const session of [alpha, beta]) {
        session.setActiveOnMessage(() =>
            new Promise((resolve) => {
                releases.push(() => resolve(undefined));
            })
        );
    }

    const prompts = [
        runtime.promptSession(alpha, { initialRequest: "alpha", initialImages: [] }),
        runtime.promptSession(beta, { initialRequest: "beta", initialImages: [] }),
    ];
    for (let i = 0; i < 10 && releases.length < 2; i++) await Promise.resolve();
    assertEquals(runtime.getSessionSnapshot(alpha)?.busy, true);
    assertEquals(runtime.getSessionSnapshot(beta)?.busy, true);
    for (const release of releases) release();
    assertEquals((await Promise.all(prompts)).map((result) => result.ok), [true, true]);
});

Deno.test("SessionRuntime cancelSession emits cancellation event", () => {
    const hostedSession = new HostedSession({ id: "cancel-events" });
    const runtime = new SessionRuntime({ abortActiveSession: () => true });
    /** @type {unknown[]} */
    const events = [];
    runtime.subscribeSessionEvents(hostedSession, (event) => {
        events.push(event);
    });

    assertEquals(runtime.cancelSession(hostedSession), { ok: true, aborted: true });
    assertEquals(/** @type {any} */ (events[0]).type, "cancellation");
    assertEquals(/** @type {any} */ (events[0]).aborted, true);
});

Deno.test("SessionRuntime requestInteraction settles adapter outcomes and emits lifecycle", async () => {
    const hostedSession = new HostedSession({ id: "interactions" });
    const runtime = new SessionRuntime();
    /** @type {string[]} */
    const events = [];
    runtime.subscribeSessionEvents(hostedSession, (event) => {
        events.push(event.type);
    });
    runtime.setInteractionAdapter(hostedSession, {
        requestInteraction: (request) => ({
            outcome: "selected",
            value: request.options?.[0]?.value,
            valueLabel: "First",
        }),
    }, { kind: "test" });

    const response = await runtime.requestInteraction(hostedSession, {
        type: "select",
        prompt: "Pick",
        options: [{ value: "a", label: "First" }],
    });

    assertEquals(response, { outcome: "selected", value: "a", valueLabel: "First" });
    assertEquals(hostedSession.getActiveInteractions().size, 0);
    assertEquals(events, [RuntimeEventTypes.INTERACTION_REQUESTED, RuntimeEventTypes.INTERACTION_RESOLVED]);
});

Deno.test("SessionRuntime requestInteraction returns unsupported without adapter", async () => {
    const hostedSession = new HostedSession({ id: "unsupported-interactions" });
    const runtime = new SessionRuntime();
    const response = await runtime.requestInteraction(hostedSession, { type: "text", prompt: "Name?" });
    assertEquals(response.outcome, "unsupported");
});

Deno.test("SessionRuntime requestInteraction resolves canceled when session cancellation aborts active interaction", async () => {
    const hostedSession = new HostedSession({ id: "cancel-interactions" });
    const runtime = new SessionRuntime();
    let sawAbortSignal = false;
    hostedSession.setInteractionAdapter({
        requestInteraction: (
            /** @type {unknown} */ _request,
            /** @type {AbortSignal | undefined} */ signal,
        ) => {
            sawAbortSignal = Boolean(signal);
            return new Promise(() => {});
        },
    });

    const pending = runtime.requestInteraction(hostedSession, { type: "text", prompt: "Name?" });
    await Promise.resolve();
    runtime.cancelSession(hostedSession);
    const response = await pending;

    assertEquals(sawAbortSignal, true);
    assertEquals(response.outcome, "canceled");
    assertEquals(hostedSession.getActiveInteractions().size, 0);
});
