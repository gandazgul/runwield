/**
 * Regression tests for HostedSession-scoped abort behavior. The root
 * AgentSession is long-lived, so abortActiveSession(hostedSession) must abort
 * only streaming roots and transient sub-agents owned by the target HostedSession.
 */

import { assert, assertEquals } from "@std/assert";
import { abortActiveSession } from "./session.js";
import { HostedSession } from "./hosted-session.js";

/**
 * @param {string} id
 */
function makeHostedSession(id) {
    return new HostedSession({ id, cwd: Deno.cwd() });
}

/**
 * @param {{ isStreaming?: boolean, onAbort?: () => void }} [opts]
 */
function makeFakeSession(opts = {}) {
    const state = { isStreaming: !!opts.isStreaming, abortCalls: 0, clearQueueCalls: 0 };
    return /** @type {any} */ ({
        get isStreaming() {
            return state.isStreaming;
        },
        set isStreaming(value) {
            state.isStreaming = value;
        },
        abort() {
            state.abortCalls++;
            state.isStreaming = false;
            if (opts.onAbort) opts.onAbort();
        },
        clearQueue() {
            state.clearQueueCalls++;
        },
        get _abortCalls() {
            return state.abortCalls;
        },
        get _clearQueueCalls() {
            return state.clearQueueCalls;
        },
    });
}

Deno.test("abortActiveSession returns false when target root exists but is idle", () => {
    const hostedSession = makeHostedSession("abort-idle");
    const otherHostedSession = makeHostedSession("abort-idle-other");
    const idleRoot = makeFakeSession({ isStreaming: false });
    const otherRoot = makeFakeSession({ isStreaming: true });
    hostedSession.setRootAgentSession(idleRoot);
    hostedSession.setRootAgentName("router");
    otherHostedSession.setRootAgentSession(otherRoot);
    otherHostedSession.setRootAgentName("router");

    assertEquals(abortActiveSession(hostedSession), false);
    assertEquals(idleRoot._abortCalls, 0, "must not call abort() on an idle root session");
    assertEquals(idleRoot._clearQueueCalls, 1, "target root queue is cleared even when idle");
    assertEquals(otherRoot._abortCalls, 0, "other HostedSession root must not be aborted");
    assertEquals(otherRoot._clearQueueCalls, 0, "other HostedSession queue must not be cleared");
});

Deno.test("abortActiveSession aborts only the streaming root in the target HostedSession", () => {
    const hostedSession = makeHostedSession("abort-streaming");
    const otherHostedSession = makeHostedSession("abort-streaming-other");
    const streamingRoot = makeFakeSession({ isStreaming: true });
    const otherStreamingRoot = makeFakeSession({ isStreaming: true });
    hostedSession.setRootAgentSession(streamingRoot);
    otherHostedSession.setRootAgentSession(otherStreamingRoot);

    assertEquals(abortActiveSession(hostedSession), true);
    assertEquals(streamingRoot._abortCalls, 1);
    assertEquals(streamingRoot._clearQueueCalls, 1);
    assertEquals(otherStreamingRoot._abortCalls, 0);
    assertEquals(otherStreamingRoot._clearQueueCalls, 0);
});

Deno.test("abortActiveSession scopes transient sub-agents to the target HostedSession", () => {
    const hostedSession = makeHostedSession("abort-sub");
    const otherHostedSession = makeHostedSession("abort-sub-other");
    const idleRoot = makeFakeSession({ isStreaming: false });
    const sub = makeFakeSession({ isStreaming: true });
    const otherSub = makeFakeSession({ isStreaming: true });
    hostedSession.setRootAgentSession(idleRoot);
    hostedSession.addSubAgentSession(sub);
    otherHostedSession.addSubAgentSession(otherSub);

    assertEquals(abortActiveSession(hostedSession), true);
    assertEquals(idleRoot._abortCalls, 0, "idle root must remain untouched even when target sub-agents exist");
    assertEquals(idleRoot._clearQueueCalls, 1);
    assertEquals(sub._abortCalls, 1);
    assertEquals(otherSub._abortCalls, 0, "other HostedSession sub-agent must not be aborted");
});

Deno.test("abortActiveSession returns false when target HostedSession has no sessions", () => {
    assertEquals(abortActiveSession(makeHostedSession("abort-empty")), false);
});

Deno.test("abortActiveSession swallows errors thrown by abort() and still reports true", () => {
    const hostedSession = makeHostedSession("abort-error");
    const root = makeFakeSession({
        isStreaming: true,
        onAbort: () => {
            throw new Error("boom");
        },
    });
    hostedSession.setRootAgentSession(root);

    assertEquals(abortActiveSession(hostedSession), true);
});

/**
 * @param {{ opCanceled: boolean, sessionAborted: boolean, planCanceled: boolean }} flags
 * @returns {string | null}
 */
function pickCancelMessage(flags) {
    if (flags.opCanceled) return "Operation canceled.";
    if (flags.sessionAborted) return "Agent run canceled.";
    if (flags.planCanceled) return "Plan review canceled.";
    return null;
}

Deno.test("Esc on a fully idle HostedSession prints no cancellation message", () => {
    const message = pickCancelMessage({
        opCanceled: false,
        sessionAborted: abortActiveSession(makeHostedSession("abort-idle-message")),
        planCanceled: false,
    });
    assertEquals(message, null);
});

Deno.test("Esc during a streaming target root prints 'Agent run canceled.'", () => {
    const hostedSession = makeHostedSession("abort-streaming-message");
    hostedSession.setRootAgentSession(makeFakeSession({ isStreaming: true }));
    const message = pickCancelMessage({
        opCanceled: false,
        sessionAborted: abortActiveSession(hostedSession),
        planCanceled: false,
    });
    assertEquals(message, "Agent run canceled.");
});

Deno.test("Esc while an operation is active prefers 'Operation canceled.' over session/plan", () => {
    const hostedSession = makeHostedSession("abort-operation-message");
    hostedSession.setRootAgentSession(makeFakeSession({ isStreaming: true }));
    const message = pickCancelMessage({
        opCanceled: true,
        sessionAborted: abortActiveSession(hostedSession),
        planCanceled: true,
    });
    assertEquals(message, "Operation canceled.");
});

Deno.test("Esc with only a plan review pending prints 'Plan review canceled.'", () => {
    const message = pickCancelMessage({
        opCanceled: false,
        sessionAborted: abortActiveSession(makeHostedSession("abort-plan-message")),
        planCanceled: true,
    });
    assert(message === "Plan review canceled.");
});
