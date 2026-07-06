import { assert, assertEquals, assertStrictEquals, assertThrows } from "@std/assert";
import { HostedSession } from "./hosted-session.js";

/**
 * @param {string} id
 * @returns {{ getSessionId: () => string, getCwd: () => string, dispose: () => void, disposed: boolean }}
 */
function makeSessionManager(id) {
    return {
        getSessionId: () => id,
        getCwd: () => `/tmp/${id}`,
        disposed: false,
        dispose() {
            this.disposed = true;
        },
    };
}

/** @param {string} id */
function makeDisposableSession(id) {
    return {
        id,
        disposed: false,
        dispose() {
            this.disposed = true;
        },
    };
}

Deno.test("HostedSession stores mutable root runtime state per session", () => {
    const sessionManager = makeSessionManager("alpha-manager");
    const uiAPI = { name: "ui-alpha" };
    const eventSink = { name: "sink-alpha" };
    const activeHandler = () => {};
    const rootAgentSession = makeDisposableSession("root-alpha");
    const subAgentSession = makeDisposableSession("sub-alpha");
    const session = new HostedSession({ id: "alpha", cwd: "/work/alpha", sessionManager, uiAPI, eventSink });

    session.pushAgentInfo("Router", "openai/gpt-4.1", "openai");
    session.pushAgentInfo("Engineer", "anthropic/claude", "anthropic");
    session.setActiveOnMessage(activeHandler);
    session.setRootAgentName("engineer");
    session.setRootAgentSession(rootAgentSession);
    session.addSubAgentSession(subAgentSession);
    session.setPendingRootSwap({ agentName: "router", displayName: "Router", allowReturnToRouter: true });
    session.setPendingSwitchHandoff({ agentName: "router", reason: "go back" });
    session.setThinkingLevel("high");
    session.setProjectStateContext("project note");
    session.setActiveExecutionWorkflow({
        planName: "plan-a",
        triageMeta: { intent: "FEATURE" },
        executionCwd: "/exec/a",
    });

    assertEquals(session.id, "alpha-manager");
    assertEquals(session.cwd, "/tmp/alpha-manager");
    assertStrictEquals(session.getRootSessionManager(), sessionManager);
    assertStrictEquals(session.getActiveUiAPIState(), uiAPI);
    assertStrictEquals(session.getEventSink(), eventSink);
    assertEquals(session.getActiveAgentName(), "Engineer");
    assertEquals(session.getActiveModelState(), { model: "anthropic/claude", provider: "anthropic" });
    assertStrictEquals(session.getActiveOnMessage(), activeHandler);
    assertEquals(session.getRootAgentName(), "engineer");
    assertStrictEquals(session.getRootAgentSession(), rootAgentSession);
    assert(session.getSubAgentSessions().has(subAgentSession));
    assertEquals(session.getPendingRootSwap(), {
        agentName: "router",
        displayName: "Router",
        allowReturnToRouter: true,
    });
    assertEquals(session.getThinkingLevel(), "high");
    assertEquals(session.getProjectStateContext(), "project note");
    assertEquals(session.getActiveExecutionWorkflow(), {
        planName: "plan-a",
        triageMeta: { intent: "FEATURE" },
        executionCwd: "/exec/a",
    });
    assertEquals(session.getActiveExecutionCwd(), "/exec/a");
    assertEquals(session.consumePendingSwitchHandoff(), { agentName: "router", reason: "go back" });
    assertEquals(session.consumePendingSwitchHandoff(), null);
});

Deno.test("HostedSession keeps user model overrides independent from agent model state", () => {
    const session = new HostedSession({
        id: "models",
        cwd: "/work/models",
        sessionManager: makeSessionManager("models"),
    });

    session.resetAgentInfoStack("Router", "openai/default", "openai");
    session.setActiveModelState("openai/user-choice", "openai", true);

    assertEquals(session.isUserModelOverride(), true);
    assertEquals(session.getActiveModelState(), { model: "openai/user-choice", provider: "openai" });

    session.clearUserModelOverride();

    assertEquals(session.isUserModelOverride(), false);
    assertEquals(session.getActiveModelState(), { model: "openai/default", provider: "openai" });
});

Deno.test("two Hosted Sessions do not share session-scoped runtime state", () => {
    const alphaRoot = makeDisposableSession("alpha-root");
    const betaRoot = makeDisposableSession("beta-root");
    const alphaSub = makeDisposableSession("alpha-sub");
    const betaSub = makeDisposableSession("beta-sub");
    const alphaHandler = () => "alpha";
    const betaHandler = () => "beta";
    const alpha = new HostedSession({
        id: "alpha",
        cwd: "/work/alpha",
        sessionManager: makeSessionManager("alpha-manager"),
        uiAPI: { session: "alpha" },
        eventSink: { session: "alpha-sink" },
    });
    const beta = new HostedSession({
        id: "beta",
        cwd: "/work/beta",
        sessionManager: makeSessionManager("beta-manager"),
        uiAPI: { session: "beta" },
        eventSink: { session: "beta-sink" },
    });

    alpha.resetAgentInfoStack("Router", "openai/a", "openai");
    beta.resetAgentInfoStack("Planner", "anthropic/b", "anthropic");
    alpha.setActiveOnMessage(alphaHandler);
    beta.setActiveOnMessage(betaHandler);
    alpha.setRootAgentName("router");
    beta.setRootAgentName("planner");
    alpha.setRootAgentSession(alphaRoot);
    beta.setRootAgentSession(betaRoot);
    alpha.addSubAgentSession(alphaSub);
    beta.addSubAgentSession(betaSub);
    alpha.setPendingRootSwap({ agentName: "engineer", displayName: "Engineer" });
    beta.setPendingRootSwap({ agentName: "tester", displayName: "Tester" });
    alpha.setPendingSwitchHandoff({ agentName: "router", reason: "alpha" });
    beta.setPendingSwitchHandoff({ agentName: "router", reason: "beta" });
    alpha.setThinkingLevel("low");
    beta.setThinkingLevel("xhigh");
    alpha.setProjectStateContext("alpha context");
    beta.setProjectStateContext("beta context");
    alpha.setActiveExecutionWorkflow({ planName: "alpha-plan", triageMeta: {}, executionCwd: "/exec/alpha" });
    beta.setActiveExecutionWorkflow({ planName: "beta-plan", triageMeta: {}, executionCwd: "/exec/beta" });

    assertEquals(alpha.getActiveAgentName(), "Router");
    assertEquals(beta.getActiveAgentName(), "Planner");
    assertEquals(alpha.getActiveModelState(), { model: "openai/a", provider: "openai" });
    assertEquals(beta.getActiveModelState(), { model: "anthropic/b", provider: "anthropic" });
    assertStrictEquals(alpha.getActiveOnMessage(), alphaHandler);
    assertStrictEquals(beta.getActiveOnMessage(), betaHandler);
    assertEquals(alpha.getRootAgentName(), "router");
    assertEquals(beta.getRootAgentName(), "planner");
    assertStrictEquals(alpha.getRootAgentSession(), alphaRoot);
    assertStrictEquals(beta.getRootAgentSession(), betaRoot);
    assertEquals(alpha.getSubAgentSessions().has(alphaSub), true);
    assertEquals(alpha.getSubAgentSessions().has(betaSub), false);
    assertEquals(beta.getSubAgentSessions().has(betaSub), true);
    assertEquals(beta.getSubAgentSessions().has(alphaSub), false);
    assertEquals(alpha.getPendingRootSwap(), { agentName: "engineer", displayName: "Engineer" });
    assertEquals(beta.getPendingRootSwap(), { agentName: "tester", displayName: "Tester" });
    assertEquals(alpha.consumePendingSwitchHandoff(), { agentName: "router", reason: "alpha" });
    assertEquals(beta.consumePendingSwitchHandoff(), { agentName: "router", reason: "beta" });
    assertEquals(alpha.getThinkingLevel(), "low");
    assertEquals(beta.getThinkingLevel(), "xhigh");
    assertEquals(alpha.getProjectStateContext(), "alpha context");
    assertEquals(beta.getProjectStateContext(), "beta context");
    assertEquals(alpha.getActiveExecutionCwd(), "/exec/alpha");
    assertEquals(beta.getActiveExecutionCwd(), "/exec/beta");
    assertEquals(alpha.id, "alpha-manager");
    assertEquals(beta.id, "beta-manager");
    assertEquals(alpha.cwd, "/tmp/alpha-manager");
    assertEquals(beta.cwd, "/tmp/beta-manager");
    assertEquals(alpha.getRootSessionManager()?.getSessionId?.(), "alpha-manager");
    assertEquals(beta.getRootSessionManager()?.getSessionId?.(), "beta-manager");
    assertEquals(alpha.getActiveUiAPIState(), { session: "alpha" });
    assertEquals(beta.getActiveUiAPIState(), { session: "beta" });
    assertEquals(alpha.getEventSink(), { session: "alpha-sink" });
    assertEquals(beta.getEventSink(), { session: "beta-sink" });
});

Deno.test("HostedSession dispose clears owned runtime references and rejects later mutation", () => {
    const sessionManager = makeSessionManager("disposing-manager");
    const root = makeDisposableSession("root");
    const sub = makeDisposableSession("sub");
    const session = new HostedSession({ id: "disposing", cwd: "/work/disposing", sessionManager });

    session.resetAgentInfoStack("Engineer", "model", "provider");
    session.setRootAgentName("engineer");
    session.setRootAgentSession(root);
    session.addSubAgentSession(sub);
    session.setPendingRootSwap({ agentName: "router", displayName: "Router" });
    session.setPendingSwitchHandoff({ agentName: "router", reason: "done" });
    session.setActiveExecutionWorkflow({ planName: "plan", triageMeta: {}, executionCwd: "/exec" });

    session.dispose();

    assertEquals(session.disposed, true);
    assertEquals(root.disposed, true);
    assertEquals(sub.disposed, true);
    assertEquals(sessionManager.disposed, true);
    assertEquals(session.id, "disposing-manager");
    assertEquals(session.cwd, "/tmp/disposing-manager");
    assertEquals(session.getActiveAgentName(), "");
    assertEquals(session.getRootAgentName(), null);
    assertEquals(session.getRootAgentSession(), null);
    assertEquals(session.getRootSessionManager(), null);
    assertEquals(session.getSubAgentSessions().size, 0);
    assertEquals(session.getPendingRootSwap(), null);
    assertEquals(session.consumePendingSwitchHandoff(), null);
    assertEquals(session.getActiveExecutionWorkflow(), null);
    assertThrows(
        () => session.setThinkingLevel("medium"),
        Error,
        'HostedSession "disposing-manager" is disposed',
    );
});
