import { assertEquals, assertStrictEquals } from "@std/assert";
import { HostedSession } from "./hosted-session.js";
import { SessionHost } from "./session-host.js";
import { RuntimeEventTypes } from "./session-runtime-events.js";
import { HANDOFF_LIMIT_MESSAGE, SessionRuntime } from "./session-runtime.js";

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
        uiAPI: /** @type {any} */ ({ appendSystemMessage: () => {} }),
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

    const result = await runtime.promptSession(hostedSession, {
        uiAPI: /** @type {any} */ ({
            appendSystemMessage: (/** @type {unknown} */ message) => messages.push(String(message)),
        }),
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
        uiAPI: /** @type {any} */ ({}),
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
    const messages = [];
    /** @type {string[]} */
    const events = [];
    const runtime = new SessionRuntime();
    runtime.subscribeSessionEvents(hostedSession, (event) => {
        events.push(event.type);
    });

    const result = await runtime.promptSession(hostedSession, {
        uiAPI: /** @type {any} */ ({
            appendSystemMessage: (/** @type {string} */ message) => messages.push(message),
        }),
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
    assertEquals(messages, ["Error: No active agent handler or session manager."]);
    assertEquals(events, [
        RuntimeEventTypes.USER_MESSAGE,
        RuntimeEventTypes.TURN_START,
        RuntimeEventTypes.SYSTEM_STATUS,
        RuntimeEventTypes.TERMINAL_ERROR,
        RuntimeEventTypes.TURN_END,
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

    assertEquals(hostedSession.id, "acp");
    assertEquals(hostedSession.cwd, "/repo/acp");
    assertEquals(hostedSession.getRootAgentName(), "router");
    assertEquals(typeof hostedSession.getActiveOnMessage(), "function");
    assertEquals(typeof /** @type {any} */ (hostedSession.getEventSink()).emit, "function");
    assertEquals(/** @type {any} */ (events[0]).message, "ready");
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
    assertEquals(types.at(-1), "turn_end");
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
