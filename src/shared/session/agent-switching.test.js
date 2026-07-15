import { assertEquals, assertRejects } from "@std/assert";
import { switchActiveAgent } from "./agent-switching.js";
import { HostedSession } from "./hosted-session.js";

function makeSession() {
    const hostedSession = new HostedSession({ id: "root-switch", cwd: Deno.cwd() });
    hostedSession.setRootSessionManager(
        /** @type {any} */ ({ getSessionId: () => "root-switch", getCwd: () => Deno.cwd() }),
    );
    return hostedSession;
}

Deno.test("switchActiveAgent installs matching root and handler after root build succeeds", async () => {
    const hostedSession = makeSession();
    /** @type {Array<{ type?: string }>} */
    const events = [];
    hostedSession.setEventSink((/** @type {{ type?: string }} */ event) => events.push(event));

    const result = await switchActiveAgent(hostedSession, { agentName: "operator" }, {
        ensureRootAgentSession: /** @type {any} */ ((/** @type {any} */ opts) => {
            opts.hostedSession.setRootAgentName(opts.agentName);
            opts.hostedSession.setRootAgentSession(/** @type {any} */ ({ dispose: () => {} }));
            return Promise.resolve();
        }),
        createAgentHandler: (agentName) => () => Promise.resolve({ kind: "complete", agentName }),
    });

    assertEquals(result, { ok: true, agentName: "operator", changed: true, model: undefined });
    assertEquals(hostedSession.getRootAgentName(), "operator");
    assertEquals(typeof hostedSession.getActiveOnMessage(), "function");
    assertEquals(events.filter((event) => event.type === "agent_changed").length, 1);
});

Deno.test("switchActiveAgent preserves previous root and handler when target build fails", async () => {
    const hostedSession = makeSession();
    const previousHandler = () => Promise.resolve({ kind: "complete" });
    const previousRoot = /** @type {any} */ ({ dispose: () => {} });
    hostedSession.setRootAgentName("router");
    hostedSession.setRootAgentSession(previousRoot);
    hostedSession.setActiveOnMessage(previousHandler);

    await assertRejects(
        () =>
            switchActiveAgent(hostedSession, { agentName: "operator" }, {
                ensureRootAgentSession: /** @type {any} */ (() => Promise.reject(new Error("build failed"))),
            }),
        Error,
        "build failed",
    );

    assertEquals(hostedSession.getRootAgentName(), "router");
    assertEquals(hostedSession.getRootAgentSession(), previousRoot);
    assertEquals(hostedSession.getActiveOnMessage(), previousHandler);
});

Deno.test("switchActiveAgent stages the handler before root installation", async () => {
    const hostedSession = makeSession();
    const previousHandler = () => Promise.resolve({ kind: "complete" });
    const previousRoot = /** @type {any} */ ({ dispose: () => {} });
    let rootBuildStarted = false;
    hostedSession.setRootAgentName("router");
    hostedSession.setRootAgentSession(previousRoot);
    hostedSession.setActiveOnMessage(previousHandler);

    await assertRejects(
        () =>
            switchActiveAgent(hostedSession, { agentName: "operator" }, {
                createAgentHandler: () => {
                    throw new Error("handler build failed");
                },
                ensureRootAgentSession: /** @type {any} */ (() => {
                    rootBuildStarted = true;
                    throw new Error("root build must not start");
                }),
            }),
        Error,
        "handler build failed",
    );

    assertEquals(rootBuildStarted, false);
    assertEquals(hostedSession.getRootAgentName(), "router");
    assertEquals(hostedSession.getRootAgentSession(), previousRoot);
    assertEquals(hostedSession.getActiveOnMessage(), previousHandler);
});

Deno.test("switchActiveAgent treats unchanged same-agent switches as no-ops", async () => {
    const hostedSession = makeSession();
    const previousRoot = /** @type {any} */ ({ dispose: () => {} });
    /** @type {Array<{ type?: string }>} */
    const events = [];
    hostedSession.setEventSink((/** @type {{ type?: string }} */ event) => events.push(event));

    await switchActiveAgent(hostedSession, { agentName: "router" }, {
        ensureRootAgentSession: /** @type {any} */ ((/** @type {any} */ opts) => {
            opts.hostedSession.setRootAgentName(opts.agentName);
            opts.hostedSession.setRootAgentSession(previousRoot);
            return Promise.resolve();
        }),
        createAgentHandler: (agentName) => () => Promise.resolve({ kind: "complete", agentName }),
    });
    const previousHandler = hostedSession.getActiveOnMessage();
    events.length = 0;

    const result = await switchActiveAgent(hostedSession, { agentName: "router" }, {
        ensureRootAgentSession: /** @type {any} */ (() => {
            throw new Error("should not rebuild unchanged root");
        }),
        createAgentHandler: () => {
            throw new Error("should not rebuild unchanged handler");
        },
    });

    assertEquals(result, { ok: true, agentName: "router", changed: false, model: undefined });
    assertEquals(hostedSession.getRootAgentSession(), previousRoot);
    assertEquals(hostedSession.getActiveOnMessage(), previousHandler);
    assertEquals(events.filter((event) => event.type === "agent_changed").length, 0);
});

Deno.test("switchActiveAgent treats unchanged same-agent return-to-router policy as a no-op", async () => {
    const hostedSession = makeSession();
    const previousRoot = /** @type {any} */ ({ dispose: () => {} });
    /** @type {Array<{ type?: string }>} */
    const events = [];
    hostedSession.setEventSink((/** @type {{ type?: string }} */ event) => events.push(event));

    await switchActiveAgent(
        hostedSession,
        {
            agentName: "slicer",
            allowReturnToRouter: false,
        },
        {
            ensureRootAgentSession: /** @type {any} */ ((/** @type {any} */ opts) => {
                opts.hostedSession.setRootAgentName(opts.agentName);
                opts.hostedSession.setRootAgentSession(previousRoot);
                return Promise.resolve();
            }),
            createAgentHandler: (agentName) => () => Promise.resolve({ kind: "complete", agentName }),
        },
    );
    const previousHandler = hostedSession.getActiveOnMessage();
    events.length = 0;

    const result = await switchActiveAgent(
        hostedSession,
        {
            agentName: "slicer",
            allowReturnToRouter: false,
        },
        {
            getRootSessionSwitchState: () => ({
                agentName: "slicer",
                allowReturnToRouter: false,
            }),
            ensureRootAgentSession: /** @type {any} */ (() => {
                throw new Error("should not rebuild unchanged root policy");
            }),
            createAgentHandler: () => {
                throw new Error("should not rebuild unchanged handler policy");
            },
        },
    );

    assertEquals(result, { ok: true, agentName: "slicer", changed: false, model: undefined });
    assertEquals(hostedSession.getRootAgentSession(), previousRoot);
    assertEquals(hostedSession.getActiveOnMessage(), previousHandler);
    assertEquals(events.filter((event) => event.type === "agent_changed").length, 0);
});

Deno.test("switchActiveAgent replaces a stale handler when the reusable root already matches target agent", async () => {
    const hostedSession = makeSession();
    const staleRouterHandler = () => Promise.resolve({ kind: "complete", agentName: "router" });
    const previousRoot = /** @type {any} */ ({ dispose: () => {} });
    /** @type {Array<{ type?: string }>} */
    const events = [];
    let createdHandlerFor = "";
    hostedSession.setRootAgentName("slicer");
    hostedSession.setRootAgentSession(previousRoot);
    hostedSession.setActiveOnMessage(staleRouterHandler);
    hostedSession.setEventSink((/** @type {{ type?: string }} */ event) => events.push(event));

    const result = await switchActiveAgent(
        hostedSession,
        {
            agentName: "slicer",
            allowReturnToRouter: false,
        },
        {
            getRootSessionSwitchState: () => ({
                agentName: "slicer",
                allowReturnToRouter: false,
            }),
            ensureRootAgentSession: /** @type {any} */ (() => {
                throw new Error("should reuse the existing slicer root");
            }),
            createAgentHandler: (agentName) => {
                createdHandlerFor = agentName;
                return () => Promise.resolve({ kind: "complete", agentName });
            },
        },
    );

    assertEquals(result, { ok: true, agentName: "slicer", changed: true, model: undefined });
    assertEquals(hostedSession.getRootAgentSession(), previousRoot);
    assertEquals(hostedSession.getActiveOnMessage() === staleRouterHandler, false);
    assertEquals(createdHandlerFor, "slicer");
    assertEquals(events.filter((event) => event.type === "agent_changed").length, 1);
});

Deno.test("switchActiveAgent rebuilds a same-agent root when effective return-to-router policy changes", async () => {
    const hostedSession = makeSession();
    const previousHandler = () => Promise.resolve({ kind: "complete" });
    const previousRoot = /** @type {any} */ ({ dispose: () => {} });
    /** @type {Array<{ type?: string }>} */
    const events = [];
    hostedSession.setRootAgentName("slicer");
    hostedSession.setRootAgentSession(previousRoot);
    hostedSession.setActiveOnMessage(previousHandler);
    hostedSession.setEventSink((/** @type {{ type?: string }} */ event) => events.push(event));

    const result = await switchActiveAgent(
        hostedSession,
        {
            agentName: "slicer",
            allowReturnToRouter: false,
        },
        {
            getRootSessionSwitchState: () => ({
                agentName: "slicer",
                allowReturnToRouter: true,
            }),
            ensureRootAgentSession: /** @type {any} */ ((/** @type {any} */ opts) => {
                opts.hostedSession.setRootAgentName(opts.agentName);
                opts.hostedSession.setRootAgentSession(/** @type {any} */ ({ dispose: () => {} }));
                return Promise.resolve();
            }),
            createAgentHandler: (agentName) => () => Promise.resolve({ kind: "complete", agentName }),
        },
    );

    assertEquals(result, { ok: true, agentName: "slicer", changed: true, model: undefined });
    assertEquals(hostedSession.getRootAgentSession() === previousRoot, false);
    assertEquals(events.filter((event) => event.type === "agent_changed").length, 1);
});

Deno.test("switchActiveAgent rebuilds a same-agent root when effective model changes", async () => {
    const hostedSession = makeSession();
    const previousHandler = () => Promise.resolve({ kind: "complete" });
    const previousRoot = /** @type {any} */ ({ dispose: () => {} });
    /** @type {Array<{ type?: string, model?: string }>} */
    const events = [];
    hostedSession.setRootAgentName("router");
    hostedSession.setRootAgentSession(previousRoot);
    hostedSession.setActiveOnMessage(previousHandler);
    hostedSession.resetAgentInfoStack("Router", "old-model", "provider", "router");
    hostedSession.setEventSink((/** @type {{ type?: string, model?: string }} */ event) => events.push(event));

    const result = await switchActiveAgent(hostedSession, { agentName: "router", model: "new-model" }, {
        ensureRootAgentSession: /** @type {any} */ ((/** @type {any} */ opts) => {
            opts.hostedSession.setRootAgentName(opts.agentName);
            opts.hostedSession.setRootAgentSession(/** @type {any} */ ({ dispose: () => {} }));
            return Promise.resolve();
        }),
        createAgentHandler: (agentName) => () => Promise.resolve({ kind: "complete", agentName }),
    });

    assertEquals(result, { ok: true, agentName: "router", changed: true, model: "new-model" });
    assertEquals(hostedSession.getRootAgentSession() === previousRoot, false);
    assertEquals(events.filter((event) => event.type === "agent_changed" && event.model === "new-model").length, 1);
});
