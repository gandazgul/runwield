import { assertEquals, assertStrictEquals } from "@std/assert";
import { HostedSession } from "./hosted-session.js";
import { SessionHost } from "./session-host.js";
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
    const runtime = new SessionRuntime();

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
});
