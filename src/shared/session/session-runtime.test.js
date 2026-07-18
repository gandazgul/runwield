import { assertEquals, assertRejects } from "@std/assert";
import { SessionHost } from "./session-host.js";
import { RuntimeEventTypes } from "./session-runtime-events.js";
import { HANDOFF_LIMIT_MESSAGE, SessionRuntime, SessionTurnInProgressError } from "./session-runtime.js";
import { switchActiveAgent as switchActiveAgentFn } from "./agent-switching.js";

/**
 * @param {string} id
 * @param {string} cwd
 * @param {unknown[]} [branch]
 */
function makeSessionManager(id, cwd, branch = []) {
    return {
        messages: /** @type {unknown[]} */ ([]),
        disposed: false,
        getSessionId: () => id,
        getCwd: () => cwd,
        getHeader: () => ({ timestamp: "2026-07-08T00:00:00.000Z" }),
        getBranch: () => branch,
        getEntries: () => branch,
        /** @param {string} customType @param {unknown} data */
        appendCustomEntry(customType, data) {
            branch.push({ type: "custom", customType, data });
        },
        addMessage(/** @type {unknown} */ message) {
            this.messages.push(message);
        },
        dispose() {
            this.disposed = true;
        },
    };
}

/**
 * @typedef {Object} RuntimeFixtureOptions
 * @property {import('./types.js').AgentMessageHandler} [handler]
 * @property {(session: import('./hosted-session.js').HostedSession) => boolean} [abortActiveSession]
 * @property {(session: import('./hosted-session.js').HostedSession, options: any) => Promise<any>} [switchActiveAgent]
 * @property {ReturnType<typeof makeSteeringAgentSession>} [agentSession]
 * @property {SessionHost} [sessionHost]
 * @property {(agentName: string, deps: any) => import('./types.js').AgentMessageHandler} [createAgentHandler]
 */

/** @param {RuntimeFixtureOptions} [options] */
function makeRuntime(options = {}) {
    let managerIndex = 0;
    const handler = options.handler || (() => Promise.resolve({ kind: "complete" }));
    const createAgentHandler = options.createAgentHandler || (() => handler);
    const switchActiveAgent = options.switchActiveAgent ||
        ((session, activationOptions) =>
            switchActiveAgentFn(session, activationOptions, {
                createAgentHandler,
                ensureRootAgentSession: /** @type {any} */ ((/** @type {any} */ rootOptions) => {
                    rootOptions.hostedSession.setRootAgentName(rootOptions.agentName);
                    rootOptions.hostedSession.setRootAgentSession(options.agentSession || { dispose() {} });
                    if (rootOptions.activeHandler) {
                        rootOptions.hostedSession.setActiveOnMessage(rootOptions.activeHandler);
                    }
                    return Promise.resolve(rootOptions.hostedSession.getRootAgentSession());
                }),
            }));
    return new SessionRuntime({
        ...(options.sessionHost ? { sessionHost: options.sessionHost } : {}),
        createRootSessionManager: (_mode, cwd) => Promise.resolve(makeSessionManager(`manager-${++managerIndex}`, cwd)),
        switchActiveAgent,
        ...(options.abortActiveSession ? { abortActiveSession: options.abortActiveSession } : {}),
    });
}

function makeSteeringAgentSession() {
    /** @type {Set<(event: any) => void>} */
    const listeners = new Set();
    /** @type {string[]} */
    let steering = [];
    const session = /** @type {any} */ ({
        isStreaming: true,
        model: { input: ["text", "image"] },
        /** @param {(event: any) => void} listener */
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        /** @param {string} text */
        steer(text) {
            steering.push(text);
            session.emitQueueUpdate();
            return Promise.resolve();
        },
        /** @param {string} text */
        followUp(text) {
            steering.push(text);
            session.emitQueueUpdate();
            return Promise.resolve();
        },
        clearQueue() {
            const cleared = { steering: [...steering], followUp: [] };
            steering = [];
            session.emitQueueUpdate();
            return cleared;
        },
        getSteeringMessages: () => steering,
        emitQueueUpdate() {
            for (const listener of listeners) {
                listener({ type: "queue_update", steering: [...steering], followUp: [] });
            }
        },
        consumeNextSteering() {
            steering.shift();
            session.emitQueueUpdate();
        },
        dispose() {},
    });
    return session;
}

Deno.test("SessionRuntime exposes opaque ids and snapshots, never HostedSession objects", async () => {
    const runtime = makeRuntime();
    const created = await runtime.createInteractiveSession({ cwd: Deno.cwd() });

    assertEquals(typeof created.sessionId, "string");
    assertEquals(created.cwd, Deno.cwd());
    assertEquals("hostedSession" in created, false);
    assertEquals("sessionManager" in created, false);
    assertEquals(Object.hasOwn(runtime, "sessionHost"), false);
    assertEquals(runtime.listSessions(), [runtime.getSessionSnapshot(created.sessionId)]);
    assertEquals("getActiveOnMessage" in /** @type {any} */ (runtime.listSessions()[0]), false);
});

Deno.test("SessionRuntime rejects non-absolute session roots", async () => {
    const runtime = makeRuntime();
    await assertRejects(
        () => runtime.createInteractiveSession({ cwd: "relative/project" }),
        Error,
        "requires an absolute cwd",
    );
    await assertRejects(
        () => runtime.loadSession({ cwd: "relative/project", sessionId: "persisted" }),
        Error,
        "requires an absolute cwd",
    );
});

Deno.test("SessionRuntime uses one activation transaction for initial readiness and later switches", async () => {
    const sessionHost = new SessionHost();
    /** @type {WeakMap<Function, string>} */
    const handlerAgents = new WeakMap();
    const runtime = makeRuntime({
        sessionHost,
        createAgentHandler: (agentName) => {
            /** @type {import('./types.js').AgentMessageHandler} */
            const handler = () => Promise.resolve({ kind: "complete" });
            handlerAgents.set(handler, agentName);
            return handler;
        },
    });
    const sessionId = await runtime.createPromptReadySession({ cwd: Deno.cwd(), agentName: "router" });
    const hostedSession = sessionHost.requireSession(sessionId);
    const initialHandler = hostedSession.getActiveOnMessage();
    assertEquals(hostedSession.getRootAgentName(), "router");
    assertEquals(initialHandler ? handlerAgents.get(initialHandler) : undefined, "router");

    /** @type {string[]} */
    const changedAgents = [];
    runtime.subscribeSessionEvents(sessionId, (event) => {
        if (event.type === RuntimeEventTypes.AGENT_CHANGED) changedAgents.push(event.agentName);
    });
    await runtime.switchAgent(sessionId, { agentName: "operator" });

    const switchedHandler = hostedSession.getActiveOnMessage();
    assertEquals(hostedSession.getRootAgentName(), "operator");
    assertEquals(switchedHandler ? handlerAgents.get(switchedHandler) : undefined, "operator");
    assertEquals(changedAgents, ["operator"]);
});

Deno.test("SessionRuntime snapshots and events keep workflow footer context separate from execution state", async () => {
    const sessionHost = new SessionHost();
    const runtime = makeRuntime({ sessionHost });
    const { sessionId } = await runtime.createInteractiveSession({ cwd: Deno.cwd() });
    const hostedSession = sessionHost.requireSession(sessionId);
    /** @type {any[]} */
    const events = [];
    runtime.subscribeSessionEvents(sessionId, (event) => {
        events.push(event);
    });

    hostedSession.setWorkflowTriageContext({ routingIntent: "FEATURE", complexity: "MEDIUM" });
    hostedSession.setWorkflowPlanName("plans/footer-restoration.md");
    runtime.setActiveExecutionWorkflow(sessionId, {
        planName: "execution-plan",
        triageMeta: { complexity: "HIGH" },
        executionCwd: Deno.cwd(),
    });

    const snapshot = runtime.getSessionSnapshot(sessionId);
    assertEquals(snapshot?.workflowContext, {
        routingIntent: "FEATURE",
        complexity: "MEDIUM",
        planName: "footer-restoration",
    });
    assertEquals(snapshot?.activeExecutionWorkflow, {
        planName: "execution-plan",
        triageMeta: { complexity: "HIGH" },
        executionCwd: Deno.cwd(),
    });
    assertEquals("workflow" in /** @type {Record<string, unknown>} */ (snapshot || {}), false);
    assertEquals(
        events.filter((event) => event.type === RuntimeEventTypes.WORKFLOW_CONTEXT_CHANGED)
            .map((event) => event.workflowContext),
        [
            { routingIntent: "FEATURE", complexity: "MEDIUM" },
            {
                routingIntent: "FEATURE",
                complexity: "MEDIUM",
                planName: "footer-restoration",
            },
        ],
    );
});

Deno.test("SessionRuntime emits one keyboard-help event for the requested session", async () => {
    const runtime = makeRuntime();
    const sessionId = await runtime.createPromptReadySession({ cwd: Deno.cwd() });
    /** @type {any[]} */
    const events = [];
    runtime.subscribeSessionEvents(sessionId, (event) => {
        events.push(event);
    });

    const result = runtime.requestSessionHelp(sessionId);
    const missing = runtime.requestSessionHelp("missing-session");

    assertEquals(result, { ok: true });
    assertEquals(missing, { ok: false, error: "not_found" });
    assertEquals(events.length, 1);
    assertEquals(events[0].type, RuntimeEventTypes.KEYBOARD_HELP);
    assertEquals(events[0].sessionId, sessionId);
    assertEquals(typeof events[0].timestamp, "string");
    assertEquals(events[0].title, "Keyboard shortcuts");
    assertEquals(events[0].items[0], { key: "esc", description: "to interrupt" });
});

Deno.test("SessionRuntime emits one ordered lifecycle for one prompt", async () => {
    const runtime = makeRuntime();
    const sessionId = await runtime.createPromptReadySession({ cwd: Deno.cwd() });
    /** @type {any[]} */
    const events = [];
    runtime.subscribeSessionEvents(sessionId, (event) => {
        events.push(event);
    });

    const result = await runtime.promptSession(sessionId, { initialRequest: "hello", initialImages: [] });

    assertEquals(result, { ok: true, turns: 1, handoffs: 0, handoffLimitReached: false });
    assertEquals(events.map((event) => event.type), [
        RuntimeEventTypes.USER_MESSAGE,
        RuntimeEventTypes.TURN_START,
        RuntimeEventTypes.BUSY_CHANGED,
        RuntimeEventTypes.TURN_END,
        RuntimeEventTypes.BUSY_CHANGED,
    ]);
    assertEquals(events.filter((event) => event.type === RuntimeEventTypes.USER_MESSAGE).length, 1);
    assertEquals(events.every((event) => event.sessionId === sessionId), true);
});

Deno.test("SessionRuntime keeps direct model operations busy until the outermost operation settles", async () => {
    const agentSession = makeSteeringAgentSession();
    /** @type {Array<() => void>} */
    const releases = [];
    agentSession.compact = () =>
        new Promise((resolve) => {
            releases.push(() => resolve({ ok: true }));
        });
    const runtime = makeRuntime({ agentSession });
    const sessionId = await runtime.createPromptReadySession({ cwd: Deno.cwd() });
    /** @type {boolean[]} */
    const busyStates = [];
    runtime.subscribeSessionEvents(sessionId, (event) => {
        if (event.type === RuntimeEventTypes.BUSY_CHANGED) busyStates.push(event.busy);
    });

    const first = runtime.compactSession(sessionId);
    const second = runtime.compactSession(sessionId);
    assertEquals(releases.length, 2);
    assertEquals(busyStates, [true]);
    assertEquals(runtime.getSessionSnapshot(sessionId)?.busy, true);

    releases[0]();
    await first;
    assertEquals(busyStates, [true]);
    assertEquals(runtime.getSessionSnapshot(sessionId)?.busy, true);

    releases[1]();
    await second;
    assertEquals(busyStates, [true, false]);
    assertEquals(runtime.getSessionSnapshot(sessionId)?.busy, false);
});

Deno.test("SessionRuntime event subscriptions unsubscribe deterministically", async () => {
    const runtime = makeRuntime();
    const { sessionId } = await runtime.createInteractiveSession({ cwd: Deno.cwd() });
    /** @type {any[]} */
    const events = [];
    const unsubscribe = runtime.subscribeSessionEvents(sessionId, (event) => {
        events.push(event);
    });

    runtime.setSessionThinkingLevel(sessionId, "low");
    unsubscribe();
    runtime.setSessionThinkingLevel(sessionId, "medium");

    assertEquals(events.map((event) => event.thinkingLevel), ["low"]);
});

Deno.test("SessionRuntime owns the complete local shell tool lifecycle", async () => {
    const runtime = makeRuntime();
    const { sessionId } = await runtime.createInteractiveSession({ cwd: Deno.cwd() });
    /** @type {any[]} */
    const events = [];
    runtime.subscribeSessionEvents(sessionId, (event) => {
        events.push(event);
    });

    const result = await runtime.runLocalShellCommand(sessionId, {
        command: "printf runtime-shell",
        userRequest: "!printf runtime-shell",
        persist: true,
    });

    assertEquals(result.ok, true);
    assertEquals(result.output, "runtime-shell");
    assertEquals(events[0].type, RuntimeEventTypes.USER_MESSAGE);
    assertEquals(events.filter((event) => event.type === RuntimeEventTypes.TOOL_START).length, 1);
    assertEquals(events.filter((event) => event.type === RuntimeEventTypes.TOOL_END).length, 1);
    assertEquals(events.find((event) => event.type === RuntimeEventTypes.TOOL_END)?.output, "runtime-shell");
});

Deno.test("SessionRuntime cancellation terminates an active local shell command", async () => {
    const runtime = makeRuntime();
    const { sessionId } = await runtime.createInteractiveSession({ cwd: Deno.cwd() });
    let resolveStarted = () => {};
    const started = new Promise((resolve) => {
        resolveStarted = () => resolve(undefined);
    });
    runtime.subscribeSessionEvents(sessionId, (event) => {
        if (event.type === RuntimeEventTypes.TOOL_START) resolveStarted();
    });

    const command = runtime.runLocalShellCommand(sessionId, { command: "sleep 5", persist: false });
    await started;
    runtime.cancelSession(sessionId);
    const result = await command;

    assertEquals(result.canceled, true);
    assertEquals(result.exitCode, 130);
});

Deno.test("SessionRuntime publishes handler errors and releases the turn", async () => {
    const runtime = makeRuntime({
        handler: () => Promise.reject(new Error("boom")),
    });
    const sessionId = await runtime.createPromptReadySession({ cwd: Deno.cwd() });
    /** @type {string[]} */
    const types = [];
    runtime.subscribeSessionEvents(sessionId, (event) => {
        types.push(event.type);
    });

    await assertRejects(
        () => runtime.promptSession(sessionId, { initialRequest: "fail", initialImages: [] }),
        Error,
        "boom",
    );

    assertEquals(types, [
        RuntimeEventTypes.USER_MESSAGE,
        RuntimeEventTypes.TURN_START,
        RuntimeEventTypes.BUSY_CHANGED,
        RuntimeEventTypes.TERMINAL_ERROR,
        RuntimeEventTypes.TURN_END,
        RuntimeEventTypes.BUSY_CHANGED,
    ]);
    assertEquals(runtime.getSessionSnapshot(sessionId)?.busy, false);
});

Deno.test("SessionRuntime rejects overlapping turns for one id", async () => {
    /** @type {() => void} */
    let release = () => {};
    const runtime = makeRuntime({
        handler: () =>
            new Promise((resolve) => {
                release = () => resolve({ kind: "complete" });
            }),
    });
    const sessionId = await runtime.createPromptReadySession({ cwd: Deno.cwd() });

    const first = runtime.promptSession(sessionId, { initialRequest: "first", initialImages: [] });
    await Promise.resolve();
    assertEquals(runtime.getSessionSnapshot(sessionId)?.busy, true);
    await assertRejects(
        () => runtime.promptSession(sessionId, { initialRequest: "second", initialImages: [] }),
        SessionTurnInProgressError,
        "already has an active turn",
    );

    release();
    await first;
    assertEquals(runtime.getSessionSnapshot(sessionId)?.busy, false);
});

Deno.test("SessionRuntime allows independent session ids to run concurrently", async () => {
    /** @type {Array<() => void>} */
    const releases = [];
    const runtime = makeRuntime({
        handler: () => new Promise((resolve) => releases.push(() => resolve({ kind: "complete" }))),
    });
    const alpha = await runtime.createPromptReadySession({ cwd: Deno.cwd() });
    const beta = await runtime.createPromptReadySession({ cwd: Deno.cwd() });

    const prompts = [
        runtime.promptSession(alpha, { initialRequest: "alpha", initialImages: [] }),
        runtime.promptSession(beta, { initialRequest: "beta", initialImages: [] }),
    ];
    for (let index = 0; index < 10 && releases.length < 2; index++) await Promise.resolve();
    assertEquals(runtime.getSessionSnapshot(alpha)?.busy, true);
    assertEquals(runtime.getSessionSnapshot(beta)?.busy, true);
    for (const release of releases) release();
    assertEquals((await Promise.all(prompts)).map((result) => result.ok), [true, true]);
});

Deno.test("SessionRuntime preserves the chained handoff limit", async () => {
    let turnCount = 0;
    /** @type {import('./types.js').AgentMessageHandler} */
    const handler = () =>
        Promise.resolve({ kind: "handoff", agentName: "router", userRequest: `handoff ${++turnCount}` });
    const runtime = makeRuntime({
        handler,
        switchActiveAgent: (session) => {
            session.setActiveOnMessage(handler);
            return Promise.resolve({ ok: true, agentName: "router", changed: true });
        },
    });
    const sessionId = await runtime.createPromptReadySession({ cwd: Deno.cwd() });
    /** @type {string[]} */
    const messages = [];
    runtime.subscribeSessionEvents(sessionId, (event) => {
        if (event.type === RuntimeEventTypes.SYSTEM_STATUS) messages.push(event.message);
    });

    const result = await runtime.promptSession(sessionId, { initialRequest: "start", initialImages: [] });

    assertEquals(turnCount, 5);
    assertEquals(result.handoffLimitReached, true);
    assertEquals(messages, [HANDOFF_LIMIT_MESSAGE]);
});

Deno.test("SessionRuntime owns steering and deferred queue transitions", async () => {
    const agentSession = makeSteeringAgentSession();
    const runtime = makeRuntime({ agentSession });
    const sessionId = await runtime.createPromptReadySession({ cwd: Deno.cwd() });
    /** @type {string[]} */
    const statuses = [];
    runtime.subscribeSessionEvents(sessionId, (event) => {
        if (event.type === RuntimeEventTypes.QUEUED_MESSAGE_CHANGED) statuses.push(event.status);
    });

    const steered = await runtime.steerSession(sessionId, "change direction", []);
    const deferred = runtime.queueNextTurnMessage(sessionId, "later", []);
    agentSession.consumeNextSteering();
    const taken = runtime.takeNextTurnMessage(sessionId);

    assertEquals(steered.queued, true);
    assertEquals(taken.message?.id, deferred.message?.id);
    assertEquals(statuses, ["queued", "queued", "consumed", "consumed"]);
    assertEquals(runtime.getQueuedMessages(sessionId), []);
});

Deno.test("SessionRuntime cancellation emits cancellation and dequeues pending messages", async () => {
    const agentSession = makeSteeringAgentSession();
    const runtime = makeRuntime({ agentSession, abortActiveSession: () => true });
    const sessionId = await runtime.createPromptReadySession({ cwd: Deno.cwd() });
    /** @type {any[]} */
    const events = [];
    runtime.subscribeSessionEvents(sessionId, (event) => {
        events.push(event);
    });
    await runtime.steerSession(sessionId, "cancel me", []);

    assertEquals(runtime.cancelSession(sessionId), { ok: true, aborted: true });
    assertEquals(events.filter((event) => event.type === RuntimeEventTypes.CANCELLATION).length, 1);
    assertEquals(events.find((event) => event.type === RuntimeEventTypes.CANCELLATION)?.message, "Agent run canceled.");
    assertEquals(
        events.filter((event) => event.type === RuntimeEventTypes.QUEUED_MESSAGE_CHANGED).map((event) => event.status),
        ["queued", "dequeued"],
    );
});

Deno.test("SessionRuntime cancellation owns active compaction and publishes one operation event", async () => {
    const agentSession = makeSteeringAgentSession();
    agentSession.isStreaming = false;
    agentSession.isCompacting = true;
    let compactionAborts = 0;
    agentSession.abortCompaction = () => {
        compactionAborts++;
        agentSession.isCompacting = false;
    };
    const runtime = makeRuntime({ agentSession, abortActiveSession: () => false });
    const sessionId = await runtime.createPromptReadySession({ cwd: Deno.cwd() });
    /** @type {any[]} */
    const events = [];
    runtime.subscribeSessionEvents(sessionId, (event) => {
        events.push(event);
    });

    assertEquals(runtime.cancelSession(sessionId), { ok: true, aborted: true });
    assertEquals(compactionAborts, 1);
    const cancellationEvents = events.filter((event) => event.type === RuntimeEventTypes.CANCELLATION);
    assertEquals(typeof cancellationEvents[0].messageId, "string");
    const { messageId: _messageId, ...cancellation } = cancellationEvents[0];
    assertEquals(cancellation, {
        type: RuntimeEventTypes.CANCELLATION,
        sessionId,
        timestamp: events.at(-1).timestamp,
        aborted: true,
        reason: "session_cancel",
        scope: "operation",
        message: "Operation canceled.",
    });
});

Deno.test("SessionRuntime interaction adapter resolves through semantic lifecycle events", async () => {
    const runtime = makeRuntime();
    const { sessionId } = await runtime.createInteractiveSession({ cwd: Deno.cwd() });
    /** @type {string[]} */
    const types = [];
    runtime.subscribeSessionEvents(sessionId, (event) => {
        types.push(event.type);
    });
    runtime.setInteractionAdapter(sessionId, {
        requestInteraction: (request) => ({
            outcome: "selected",
            value: request.options?.[0]?.value,
            valueLabel: request.options?.[0]?.label,
        }),
    });

    const response = await runtime.requestInteraction(sessionId, {
        type: "select",
        prompt: "Pick",
        options: [{ value: "a", label: "First" }],
    });

    assertEquals(response, { outcome: "selected", value: "a", valueLabel: "First" });
    assertEquals(types, [RuntimeEventTypes.INTERACTION_REQUESTED, RuntimeEventTypes.INTERACTION_RESOLVED]);
});

Deno.test("SessionRuntime emits canceled lifecycle for an already-aborted interaction", async () => {
    const runtime = makeRuntime();
    const { sessionId } = await runtime.createInteractiveSession({ cwd: Deno.cwd() });
    /** @type {string[]} */
    const types = [];
    runtime.subscribeSessionEvents(sessionId, (event) => {
        types.push(event.type);
    });
    runtime.setInteractionAdapter(sessionId, {
        requestInteraction: () => new Promise(() => {}),
    });
    const controller = new AbortController();
    controller.abort();

    const response = await runtime.requestInteraction(
        sessionId,
        { type: "text", prompt: "Name?" },
        controller.signal,
    );

    assertEquals(response.outcome, "canceled");
    assertEquals(types, [RuntimeEventTypes.INTERACTION_REQUESTED, RuntimeEventTypes.INTERACTION_CANCELED]);
});

Deno.test("SessionRuntime loadSession returns opaque metadata and redacted replay events", async () => {
    const manager = makeSessionManager("persisted-1", Deno.cwd(), [
        {
            type: "message",
            id: "u1",
            timestamp: "2026-07-08T00:00:00.000Z",
            message: { role: "user", content: [{ type: "text", text: "hello" }] },
        },
        {
            type: "custom",
            id: "marker",
            customType: "runwield.active_agent",
            data: { agentName: "Planner" },
        },
        {
            type: "message",
            id: "a1",
            timestamp: "2026-07-08T00:00:01.000Z",
            message: {
                role: "assistant",
                content: [
                    { type: "thinking", thinking: "considering" },
                    { type: "text", text: "hi" },
                ],
            },
        },
        {
            type: "message",
            id: "t1",
            message: { role: "assistant", content: [{ type: "tool_use", id: "tool-1", name: "bash" }] },
        },
        {
            type: "message",
            id: "tr1",
            message: {
                role: "user",
                content: [{ type: "tool_result", tool_use_id: "tool-1", content: "password=secret" }],
            },
        },
        {
            type: "message",
            id: "tc2",
            timestamp: "2026-07-08T00:00:03.000Z",
            message: {
                role: "assistant",
                content: [
                    { type: "toolCall", id: "tool-2", name: "read", arguments: { path: "README.md" } },
                    { type: "unknown_metadata", payload: { internal: true } },
                ],
            },
        },
        {
            type: "message",
            id: "tr2",
            timestamp: "2026-07-08T00:00:05.000Z",
            message: {
                role: "toolResult",
                toolCallId: "tool-2",
                toolName: "read",
                isError: false,
                content: [{ type: "text", text: "actual tool output" }],
                details: { fullOutputPath: "/tmp/read-output" },
            },
        },
        { type: "model_change", id: "m1", provider: "test", modelId: "initial" },
        { type: "thinking_level_change", id: "th1", thinkingLevel: "off" },
        { type: "model_change", id: "m2", provider: "test", modelId: "later" },
        { type: "thinking_level_change", id: "th2", thinkingLevel: "medium" },
    ]);
    const runtime = new SessionRuntime({
        openPersistedRootSession: () =>
            Promise.resolve({
                sessionManager: manager,
                resolved: {
                    cwd: Deno.cwd(),
                    sessionDir: "/sessions",
                    sessionId: "persisted-1",
                    sessionPath: "/sessions/persisted-1.jsonl",
                    info: null,
                },
            }),
        resolveResumeAgentName: () => Promise.resolve("planner"),
        switchActiveAgent: (session, options) => {
            session.setRootAgentName(options.agentName);
            session.setRootAgentSession({ dispose() {} });
            session.setActiveOnMessage(() => Promise.resolve({ kind: "complete" }));
            return Promise.resolve({ ok: true, agentName: options.agentName, changed: true });
        },
    });

    const result = await runtime.loadSession({ cwd: Deno.cwd(), sessionId: "persisted-1" });

    assertEquals("hostedSession" in result, false);
    assertEquals("sessionManager" in result, false);
    assertEquals(result.sessionManagerId, "persisted-1");
    assertEquals(result.replayEvents.map((event) => event.type), [
        RuntimeEventTypes.USER_MESSAGE,
        RuntimeEventTypes.ASSISTANT_THINKING_DELTA,
        RuntimeEventTypes.ASSISTANT_THINKING_END,
        RuntimeEventTypes.ASSISTANT_TEXT_DELTA,
        RuntimeEventTypes.TOOL_START,
        RuntimeEventTypes.TOOL_END,
        RuntimeEventTypes.TOOL_START,
        RuntimeEventTypes.TOOL_END,
        RuntimeEventTypes.SYSTEM_STATUS,
        RuntimeEventTypes.SYSTEM_STATUS,
    ]);
    assertEquals(
        result.replayEvents.filter((event) => event.type === RuntimeEventTypes.SYSTEM_STATUS).map((event) =>
            event.message
        ),
        ["Model changed: test/later", "Thinking level changed: medium"],
    );
    const modernToolEnd =
        /** @type {any} */ (result.replayEvents.find((event) =>
            event.type === RuntimeEventTypes.TOOL_END && event.toolCallId === "tool-2"
        ));
    const modernToolStart =
        /** @type {any} */ (result.replayEvents.find((event) =>
            event.type === RuntimeEventTypes.TOOL_START && event.toolCallId === "tool-2"
        ));
    assertEquals(modernToolStart?.title, "read README.md");
    assertEquals(modernToolStart?.kind, "read");
    assertEquals(modernToolEnd?.output, "actual tool output");
    assertEquals(modernToolEnd?.content, [{ type: "text", text: "actual tool output" }]);
    assertEquals(modernToolEnd?.details, { fullOutputPath: "/tmp/read-output" });
    assertEquals(modernToolEnd?.durationMs, 2000);
    const assistantMessage = /** @type {any} */ (
        result.replayEvents.find((event) => event.type === RuntimeEventTypes.ASSISTANT_TEXT_DELTA)
    );
    assertEquals(assistantMessage?.agentName, "Planner");
    const replayThinkingEvents = result.replayEvents.filter((event) =>
        event.type === RuntimeEventTypes.ASSISTANT_THINKING_DELTA ||
        event.type === RuntimeEventTypes.ASSISTANT_THINKING_END
    );
    assertEquals(replayThinkingEvents.map((event) => /** @type {any} */ (event).agentName), ["Planner", "Planner"]);
    assertEquals(JSON.stringify(result.replayEvents).includes("secret"), false);
    assertEquals(JSON.stringify(result.replayEvents).includes("[object Object]"), false);
    assertEquals(JSON.stringify(result.replayEvents).includes("runwield.active_agent"), false);
});

Deno.test("SessionRuntime replays persisted task_completed summaries and manual QA checklists", async () => {
    const manager = makeSessionManager("persisted-workflow", Deno.cwd(), [
        {
            type: "message",
            id: "tc-call",
            timestamp: "2026-07-08T00:00:01.000Z",
            message: {
                role: "assistant",
                content: [{ type: "toolCall", id: "task-tool", name: "task_completed", arguments: {} }],
            },
        },
        {
            type: "message",
            id: "tc-result",
            timestamp: "2026-07-08T00:00:02.000Z",
            message: {
                role: "toolResult",
                toolCallId: "task-tool",
                toolName: "task_completed",
                isError: false,
                content: [],
                details: { outcome: "task_completed", message: "- Implemented the fix." },
            },
        },
        {
            type: "custom",
            id: "qa-checklist",
            timestamp: "2026-07-08T00:00:03.000Z",
            customType: "runwield.manual_qa_checklist",
            data: { agentName: "Operator", text: "Manual verification steps for fix\n- Check resume." },
        },
    ]);
    const runtime = new SessionRuntime({
        openPersistedRootSession: () =>
            Promise.resolve({
                sessionManager: manager,
                resolved: {
                    cwd: Deno.cwd(),
                    sessionDir: "/sessions",
                    sessionId: "persisted-workflow",
                    sessionPath: "/sessions/persisted-workflow.jsonl",
                    info: null,
                },
            }),
        resolveResumeAgentName: () => Promise.resolve("engineer"),
        switchActiveAgent: (session, options) => {
            session.setRootAgentName(options.agentName);
            session.setRootAgentSession({ dispose() {} });
            session.setActiveOnMessage(() => Promise.resolve({ kind: "complete" }));
            return Promise.resolve({ ok: true, agentName: options.agentName, changed: true });
        },
    });

    const result = await runtime.loadSession({ cwd: Deno.cwd(), sessionId: "persisted-workflow" });
    const workflowMessages = result.replayEvents.filter((event) =>
        event.type === RuntimeEventTypes.ASSISTANT_TEXT_DELTA &&
        /** @type {any} */ (event).messageKind === "workflow"
    );

    assertEquals(workflowMessages.map((event) => /** @type {any} */ (event).workflowMessage), [
        "task_completed",
        "manual_qa_checklist",
    ]);
    assertEquals(/** @type {any} */ (workflowMessages[0]).delta, "**Task completed.**\n\n- Implemented the fix.");
    assertEquals(
        /** @type {any} */ (workflowMessages[1]).delta,
        "Manual verification steps for fix\n- Check resume.",
    );
});

Deno.test("SessionRuntime close operations dispose sessions by id", async () => {
    const runtime = makeRuntime({ abortActiveSession: () => true });
    const first = await runtime.createInteractiveSession({ cwd: Deno.cwd() });
    const second = await runtime.createInteractiveSession({ cwd: Deno.cwd() });

    assertEquals(runtime.closeSession(first.sessionId), { ok: true, closed: true });
    assertEquals(runtime.getSessionSnapshot(first.sessionId), null);
    assertEquals(await runtime.closeAllSessionsWhenIdle(), { ok: true, closed: 1 });
    assertEquals(runtime.getSessionSnapshot(second.sessionId), null);
    assertEquals(runtime.listSessions(), []);
});
