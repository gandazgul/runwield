import { assert, assertEquals, assertRejects, assertStrictEquals } from "@std/assert";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { join } from "@std/path";
import { withRuntimeCommandFixture } from "../../cmd/testing/runtime-command-fixture.ts";
import { __resetSettingsForTests } from "../settings.js";
import { SessionHost } from "./session-host.js";
import { switchActiveAgent } from "./agent-switching.js";
import { RuntimeEventTypes } from "./session-runtime-events.js";
import {
    createSessionRuntime,
    SessionRuntime,
    SessionTurnInProgressError,
    shouldEmitProjectedAttention,
} from "./session-runtime.js";
import { getRootSessionRebuildOptions } from "./session.js";
import { createRootSessionManager, getRunWieldSessionDir, resolveCreatedRootSessionPath } from "./root-session.js";
import { openFileSessionStore } from "./file-session-store.ts";
import { openOwnerCoordinationStore } from "../owner-coordination/index.js";
import { withProcessGlobalTestLock } from "../../testing/process-global-lock.js";
import { savePlan } from "../../plan-store.js";
import { rememberNonGitExecutionConsent } from "../git.js";
import { loadPlanActionEvidence } from "../workflow/plan-actions.ts";
import { getHomeDir, SUBAGENTS } from "../../constants.js";

const RUNTIME_TEST_PROVIDER = "session-runtime-test";
const RUNTIME_TEST_MODEL = "fixture-model";
const RUNTIME_TEST_API = "session-runtime-faux";

/** @type {ReturnType<typeof registerFauxProvider> | null} */
let runtimeFauxProvider = null;

function runtimeProjectRoot() {
    const sandboxHome = Deno.env.get("WLD_TEST_SANDBOX_HOME");
    const home = getHomeDir();
    if (!sandboxHome) {
        throw new Error("SessionRuntime tests must run through scripts/run-tests.js with an isolated HOME");
    }
    const projectRoot = join(home, "runtime-project");
    Deno.mkdirSync(projectRoot, { recursive: true });
    return projectRoot;
}

function ensureRuntimeModelFixture() {
    const sandboxHome = Deno.env.get("WLD_TEST_SANDBOX_HOME");
    const home = getHomeDir();
    if (!sandboxHome) {
        throw new Error("SessionRuntime tests must run through scripts/run-tests.js with an isolated HOME");
    }
    const runwieldDir = join(home, ".wld");
    Deno.mkdirSync(runwieldDir, { recursive: true });
    const settingsPath = join(runwieldDir, "settings.json");
    try {
        Deno.statSync(settingsPath);
        return;
    } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    Deno.writeTextFileSync(
        join(runwieldDir, "models.json"),
        JSON.stringify({
            providers: {
                [RUNTIME_TEST_PROVIDER]: {
                    name: "SessionRuntime Test Provider",
                    baseUrl: "http://127.0.0.1:0",
                    apiKey: "fixture-key",
                    api: RUNTIME_TEST_API,
                    models: [{
                        id: RUNTIME_TEST_MODEL,
                        name: "SessionRuntime Fixture Model",
                        api: RUNTIME_TEST_API,
                        input: ["text", "image"],
                        contextWindow: 128000,
                        maxTokens: 4096,
                    }],
                },
            },
        }),
    );
    Deno.writeTextFileSync(
        join(runwieldDir, "auth.json"),
        JSON.stringify({ [RUNTIME_TEST_PROVIDER]: { type: "api_key", key: "fixture-key" } }),
    );
    Deno.writeTextFileSync(
        settingsPath,
        JSON.stringify({
            defaultProvider: RUNTIME_TEST_PROVIDER,
            defaultModel: RUNTIME_TEST_MODEL,
            notifications: { enabled: false },
        }),
    );
    runtimeFauxProvider ??= registerFauxProvider({
        api: RUNTIME_TEST_API,
        provider: RUNTIME_TEST_PROVIDER,
        tokensPerSecond: 1000,
        models: [{ id: RUNTIME_TEST_MODEL, name: "SessionRuntime Fixture Model", input: ["text", "image"] }],
    });
    runtimeFauxProvider.setResponses(
        Array.from(
            { length: 100 },
            () => () => fauxAssistantMessage(fauxText("SessionRuntime fixture response.")),
        ),
    );
    __resetSettingsForTests();
}

/** @param {ReturnType<typeof fauxAssistantMessage>[]} messages */
function setRuntimeModelMessages(messages) {
    ensureRuntimeModelFixture();
    runtimeFauxProvider?.setResponses([
        ...messages.map((message) => () => message),
        ...Array.from(
            { length: 100 },
            () => () => fauxAssistantMessage(fauxText("SessionRuntime fixture response.")),
        ),
    ]);
}

/** @param {import('@earendil-works/pi-ai').FauxResponseFactory[]} factories */
function setRuntimeModelResponseFactories(factories) {
    ensureRuntimeModelFixture();
    runtimeFauxProvider?.setResponses([
        ...factories,
        ...Array.from(
            { length: 100 },
            () => () => fauxAssistantMessage(fauxText("SessionRuntime fixture response.")),
        ),
    ]);
}

/** @param {number} ms */
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * True while the OS still has a process with this pid.
 * @param {number} pid
 */
function processAlive(pid) {
    try {
        Deno.kill(pid, "SIGCONT");
        return true;
    } catch {
        return false;
    }
}

/**
 * Poll until the OS no longer reports a process with this pid. The wrapper
 * shell's exit settles before its SIGKILLed descendants are reaped, so a
 * single immediate probe can still observe them — and under CI load the
 * window is wide enough to fail a one-shot check.
 *
 * @param {number} pid
 * @param {number} [timeoutMs]
 */
async function waitForProcessDeath(pid, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (!processAlive(pid)) return true;
        await delay(20);
    }
    return !processAlive(pid);
}

/**
 * macOS can briefly report recursive temp cleanup as ENOTEMPTY/EBUSY while
 * filesystem metadata settles after a test's last writes. Retry boundedly so
 * cleanup flakiness does not fail an otherwise successful test.
 *
 * @param {string} path
 */
async function removeTempDir(path) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            await Deno.remove(path, { recursive: true });
            return;
        } catch (error) {
            if (error instanceof Deno.errors.NotFound) return;
            const isRetryable = error instanceof Error &&
                /Directory not empty|resource busy|os error 66|os error 16/i.test(error.message);
            if (!isRetryable || attempt === 4) throw error;
            await delay(25 * (attempt + 1));
        }
    }
}

/**
 * @typedef {Object} RuntimePreparationBusySample
 * @property {string} message
 * @property {boolean | undefined} busy
 */

/**
 * @typedef {Object} RuntimeFixtureOptions
 * @property {SessionHost} [sessionHost]
 */

/** @param {RuntimeFixtureOptions} [options] */
function makeRuntime(options = {}) {
    ensureRuntimeModelFixture();
    return new SessionRuntime({
        sessionHost: options.sessionHost ?? new SessionHost(),
        sessionStore: openOwnerCoordinationStore(),
        ownerProcessKind: "test",
        ownerInstanceId: crypto.randomUUID(),
    });
}

/**
 * Attach a Pi-facing AgentSession test double to a real Runtime-created persisted
 * session. These doubles stand in only for the external Pi session object; all
 * RunWield creation, queueing, cancellation, and event machinery stays real.
 *
 * @param {SessionRuntime} _runtime
 * @param {SessionHost} sessionHost
 * @param {ReturnType<typeof makeSteeringAgentSession> | Record<string, any>} agentSession
 * @param {import('./types.js').AgentMessageHandler} [handler]
 */
function attachExternalAgentSession(
    _runtime,
    sessionHost,
    agentSession,
    handler = () => Promise.resolve({ kind: "complete" }),
) {
    const hostedSession = sessionHost.createSession({
        id: crypto.randomUUID(),
        cwd: runtimeProjectRoot(),
        sessionManager: null,
    });
    hostedSession.setRootAgentName("router");
    hostedSession.setRootAgentSession(agentSession);
    hostedSession.setActiveOnMessage(handler);
    return Promise.resolve(hostedSession.id);
}

Deno.test("SessionRuntime commits a Claude CLI model reconfiguration only after root rebuild succeeds", async () => {
    const sessionHost = new SessionHost();
    const session = sessionHost.createSession({ id: "claude-model-commit", cwd: runtimeProjectRoot() });
    const previousHandler = () => Promise.resolve({ kind: "complete" });
    const previousAgentSession = { dispose() {} };
    session.setRootAgentName("engineer");
    session.setRootAgentSession(previousAgentSession);
    session.setActiveOnMessage(previousHandler);
    const runtime = makeRuntime({ sessionHost });
    /** @type {import('./session-runtime-events.js').SessionRuntimeEvent[]} */
    const events = [];
    runtime.subscribeSessionEvents("claude-model-commit", (event) => {
        events.push(event);
    });

    await runtime.reconfigureSessionModel("claude-model-commit", "sonnet", "claude-cli");

    assertEquals(session.getActiveModelState(), { model: "sonnet", provider: "claude-cli" });
    assertEquals(events.filter((event) => event.type === RuntimeEventTypes.MODEL_CHANGED).length, 1);
    const rebuiltRoot = /** @type {any} */ (session.getRootAgentSession());
    assertEquals(rebuiltRoot?.kind, "claude-cli");
    rebuiltRoot?.session?.dispose?.();
});

Deno.test("SessionRuntime restores the previous user model override when active root rebuild fails", async () => {
    const sessionHost = new SessionHost();
    const session = sessionHost.createSession({ id: "model-rollback", cwd: runtimeProjectRoot() });
    const previousHandler = () => Promise.resolve({ kind: "complete" });
    const previousAgentSession = { dispose() {} };
    session.setRootAgentName("engineer");
    session.setRootAgentSession(previousAgentSession);
    session.setActiveOnMessage(previousHandler);
    session.setActiveModelState("sonnet", "anthropic", true);
    const runtime = makeRuntime({ sessionHost });
    /** @type {import('./session-runtime-events.js').SessionRuntimeEvent[]} */
    const events = [];
    runtime.subscribeSessionEvents("model-rollback", (event) => {
        events.push(event);
    });

    await assertRejects(
        () => runtime.reconfigureSessionModel("model-rollback", "opus", "unknown-provider"),
        Error,
        "Unknown manual /model override",
    );

    assertEquals(session.getActiveModelState(), { model: "sonnet", provider: "anthropic" });
    assertStrictEquals(session.getRootAgentSession(), previousAgentSession);
    assertStrictEquals(session.getActiveOnMessage(), previousHandler);
    assertEquals(events.filter((event) => event.type === RuntimeEventTypes.MODEL_CHANGED), []);
});

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
        abort() {
            session.isStreaming = false;
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
    const created = await runtime.createInteractiveSession({ cwd: runtimeProjectRoot() });

    assertEquals(typeof created.sessionId, "string");
    assertEquals(created.cwd, runtimeProjectRoot());
    assertEquals("hostedSession" in created, false);
    assertEquals("sessionManager" in created, false);
    assertEquals(Object.hasOwn(runtime, "sessionHost"), false);
    assertEquals(runtime.listSessions(), [runtime.getSessionSnapshot(created.sessionId)]);
    assertEquals("getActiveOnMessage" in /** @type {any} */ (runtime.listSessions()[0]), false);
});

Deno.test("SessionRuntime snapshot exposes active context capacity without exposing AgentSession", () => {
    const sessionHost = new SessionHost();
    const agentSession = makeSteeringAgentSession();
    agentSession.getContextUsage = () => ({ tokens: 48_000, contextWindow: 128_000, percent: 37.5 });
    agentSession.settingsManager = {
        getCompactionSettings: () => ({ enabled: true }),
    };
    const runtime = makeRuntime({ sessionHost });
    const hostedSession = sessionHost.createSession({
        id: crypto.randomUUID(),
        cwd: runtimeProjectRoot(),
        sessionManager: null,
    });
    hostedSession.setRootAgentName("router");
    hostedSession.setRootAgentSession(agentSession);
    const sessionId = hostedSession.id;

    assertEquals(runtime.getSessionSnapshot(sessionId)?.contextUsage, {
        tokens: 48_000,
        contextWindow: 128_000,
        percent: 37.5,
    });
    assertEquals(runtime.getSessionSnapshot(sessionId)?.autoCompactionEnabled, true);

    const transientSession = /** @type {any} */ ({
        getContextUsage: () => ({ tokens: 4_000, contextWindow: 64_000, percent: 6.25 }),
        settingsManager: { getCompactionSettings: () => ({ enabled: false }) },
    });
    hostedSession.addSubAgentSession(transientSession);
    assertEquals(runtime.getSessionSnapshot(sessionId)?.contextUsage, {
        tokens: 4_000,
        contextWindow: 64_000,
        percent: 6.25,
    });
    assertEquals(runtime.getSessionSnapshot(sessionId)?.autoCompactionEnabled, false);

    const snapshot = runtime.getSessionSnapshot(sessionId);
    assertEquals("agentSession" in /** @type {Record<string, unknown>} */ (snapshot || {}), false);
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

Deno.test("SessionRuntime blocks Pi-backed create and load when owner coordination is absent", async () => {
    ensureRuntimeModelFixture();
    const runtime = new SessionRuntime({
        sessionHost: new SessionHost(),
        sessionStore: null,
        ownerProcessKind: "test",
        ownerInstanceId: crypto.randomUUID(),
    });
    await assertRejects(
        () => runtime.createInteractiveSession({ cwd: runtimeProjectRoot(), mode: "new" }),
        Error,
        "session_store_unavailable",
    );
    await assertRejects(
        () => runtime.loadSession({ cwd: runtimeProjectRoot(), sessionId: "persisted" }),
        Error,
        "session_store_unavailable",
    );
});

Deno.test("SessionRuntime keeps dormant managed image persistence read-only but allows live manager paste", async () => {
    await withProcessGlobalTestLock(async () => {
        const previousHome = getHomeDir();
        const home = await Deno.makeTempDir({ prefix: "runwield-runtime-managed-image-" });
        Deno.env.set("HOME", home);
        const cwd = `${home}/project`;
        await Deno.mkdir(cwd, { recursive: true });
        ensureRuntimeModelFixture();
        const sessionHost = new SessionHost();
        try {
            const session = sessionHost.createSession({
                id: "managed-image-runtime",
                cwd,
                sessionManager: null,
                managed: {
                    runwieldSessionId: "rw-managed-image",
                    projectId: "project-managed-image",
                    piSessionId: "pi-managed-image",
                    transcriptPath: `${cwd}/transcript.jsonl`,
                    generation: 1,
                    name: "Managed image",
                    activeAgent: "Router",
                    model: RUNTIME_TEST_MODEL,
                    provider: RUNTIME_TEST_PROVIDER,
                    workflowContext: null,
                },
            });
            assertEquals(session.getRootSessionManager(), null);
            const runtime = makeRuntime({ sessionHost });

            const dormantResult = await runtime.persistSessionImage(session.id, {
                base64: btoa("img"),
                mimeType: "image/png",
            });
            assertEquals(dormantResult.error, "refresh_required");

            const sessionDir = getRunWieldSessionDir(cwd);
            await Deno.mkdir(sessionDir, { recursive: true });
            const sessionManager = SessionManager.create(cwd, sessionDir, { id: "pi-managed-image" });
            /** @type {import('./managed-operation.ts').ManagedOperationCapability} */
            const capability = {
                runtimeSessionId: session.id,
                runwieldSessionId: "rw-managed-image",
                operationId: "op-managed-image",
                proof: {
                    runwieldSessionId: "rw-managed-image",
                    projectId: "project-managed-image",
                    ownerInstanceId: "owner-managed-image",
                    ownerProcessKind: "test",
                    operationId: "op-managed-image",
                    fence: 1,
                    phase: "hydrated",
                    expectedGeneration: 1,
                },
                settled: false,
                updateProof: () => {},
                assertLive: () => {},
                settle: () => {},
            };
            session.setManagedOperationCapability(capability);
            session.setRootSessionManager(/** @type {any} */ (sessionManager), capability);
            const persisted = await runtime.persistSessionImage(session.id, {
                base64: btoa("img"),
                mimeType: "image/png",
            });

            const persistedPath = persisted.path || "";
            assertEquals(persisted.ref?.startsWith("attachment:"), true);
            assertEquals(persistedPath.startsWith(`${getRunWieldSessionDir(cwd)}/pi-managed-image_images/`), true);
            assertEquals(new TextDecoder().decode(await Deno.readFile(persistedPath)), "img");
            assertEquals(await runtime.preflightSessionImages(session.id, [persisted]), { ok: true, mode: "direct" });
        } finally {
            Deno.env.set("HOME", previousHome);
            await removeTempDir(home);
        }
    });
});

Deno.test("SessionRuntime persists a newly managed Pi transcript before cataloging it", async () => {
    await withProcessGlobalTestLock(async () => {
        const previousHome = getHomeDir();
        const home = await Deno.makeTempDir({ prefix: "runwield-runtime-managed-lazy-transcript-" });
        Deno.env.set("HOME", home);
        const cwd = `${home}/project`;
        await Deno.mkdir(cwd, { recursive: true });
        const store = openOwnerCoordinationStore({ dbPath: `${home}/owner.sqlite3` });
        try {
            ensureRuntimeModelFixture();
            store.registerProject({ root: cwd, now: () => "2026-01-01T00:00:01.000Z" });
            const runtime = createSessionRuntime({
                sessionStore: store,
                ownerProcessKind: "test",
                ownerInstanceId: "runtime-test-owner",
            });
            try {
                const created = await runtime.createInteractiveSession({
                    cwd,
                    mode: "new",
                });
                assertEquals(typeof created.sessionManagerId, "string");
                const persisted = await runtime.listResumableSessions(cwd);
                assertEquals(persisted.some((session) => session.id === created.sessionManagerId), true);

                await runtime.switchAgent(created.sessionId, { agentName: "Ideator" });
                const snapshot = runtime.getSessionSnapshot(created.sessionId);
                assertEquals(snapshot?.managed?.generation, 1);
            } finally {
                await runtime.closeAllSessionsWhenIdle?.();
            }
        } finally {
            store.close();
            Deno.env.set("HOME", previousHome);
            await removeTempDir(home);
        }
    });
});

Deno.test("SessionRuntime automatically segments new Sessions in unregistered local projects", async () => {
    await withProcessGlobalTestLock(async () => {
        const previousHome = getHomeDir();
        const home = await Deno.makeTempDir({ prefix: "runwield-runtime-unmanaged-registered-project-" });
        Deno.env.set("HOME", home);
        const cwd = `${home}/project`;
        await Deno.mkdir(cwd, { recursive: true });
        const store = openOwnerCoordinationStore({ dbPath: `${home}/owner.sqlite3` });
        try {
            ensureRuntimeModelFixture();
            const runtime = createSessionRuntime({
                sessionStore: store,
                ownerProcessKind: "test",
                ownerInstanceId: "runtime-test-owner",
            });
            try {
                const created = await runtime.createInteractiveSession({ cwd, mode: "new" });
                const managed = runtime.getSessionSnapshot(created.sessionId)?.managed;
                assertEquals(typeof managed?.runwieldSessionId, "string");
                assertEquals(typeof managed?.currentSegmentId, "string");
                assertEquals(store.listProjects(), []);
            } finally {
                await runtime.closeAllSessionsWhenIdle?.();
            }
        } finally {
            store.close();
            Deno.env.set("HOME", previousHome);
            await removeTempDir(home);
        }
    });
});

Deno.test("SessionRuntime publishes generation zero before dehydrating newly managed Sessions", async () => {
    await withProcessGlobalTestLock(async () => {
        const previousHome = getHomeDir();
        const home = await Deno.makeTempDir({ prefix: "runwield-runtime-managed-create-" });
        Deno.env.set("HOME", home);
        const cwd = `${home}/project`;
        await Deno.mkdir(cwd, { recursive: true });
        const store = openOwnerCoordinationStore({ dbPath: `${home}/owner.sqlite3` });
        try {
            ensureRuntimeModelFixture();
            const project = store.registerProject({ root: cwd, now: () => "2026-01-01T00:00:01.000Z" });
            const runtime = createSessionRuntime({
                sessionStore: store,
                ownerProcessKind: "test",
                ownerInstanceId: "runtime-test-owner",
            });
            try {
                const created = await runtime.createInteractiveSession({
                    cwd,
                    mode: "new",
                });
                assertEquals(typeof created.sessionManagerId, "string");
                const active = store.inspectSessionActivation(
                    runtime.getSessionSnapshot(created.sessionId)?.managed?.runwieldSessionId || "",
                );
                assertEquals(active.activation?.state, "idle");

                await runtime.switchAgent(created.sessionId, { agentName: "Ideator" });
                const snapshot = runtime.getSessionSnapshot(created.sessionId);
                const managed = snapshot?.managed;
                assertEquals(snapshot?.activeAgent, "ideator");
                assertEquals(managed?.projectId, store.ensureRuntimeProject({ root: cwd }).projectId);
                assertEquals(managed?.projectId === project.projectId, false);
                assertEquals(managed?.generation, 1);
                assertEquals(managed?.acknowledgedGeneration, 1);
                assertEquals(managed?.syncState?.status, "current");
                const inspected = store.inspectSessionActivation(managed?.runwieldSessionId || "");
                assertEquals(inspected.activation?.state, "idle");
                assertEquals(inspected.generation?.generation, 1);
            } finally {
                await runtime.closeAllSessionsWhenIdle?.();
            }
        } finally {
            store.close();
            if (previousHome === undefined) Deno.env.delete("HOME");
            else Deno.env.set("HOME", previousHome);
            await removeTempDir(home);
        }
    });
});

Deno.test("SessionRuntime automatically recovers append-only output written before generation zero", async () => {
    await withProcessGlobalTestLock(async () => {
        const previousHome = getHomeDir();
        const home = await Deno.makeTempDir({ prefix: "runwield-runtime-initial-recovery-" });
        Deno.env.set("HOME", home);
        const cwd = join(home, "project");
        await Deno.mkdir(cwd, { recursive: true });
        const interruptedStore = openFileSessionStore();
        try {
            const project = interruptedStore.ensureRuntimeProject({ root: cwd });
            const manager = await createRootSessionManager("new", cwd);
            const piSessionId = manager.getSessionId();
            const transcriptPath = await resolveCreatedRootSessionPath(cwd, manager);
            const session = await interruptedStore.ensureSessionCatalogRecord({
                projectId: project.projectId,
                piSessionId,
                transcriptPath,
                transcriptCwd: cwd,
                source: "created",
            });
            const segment = interruptedStore.getCurrentSessionSegment(session.runwieldSessionId);
            if (!segment) throw new Error("fixture segment missing");
            interruptedStore.acquireSessionActivation({
                runwieldSessionId: session.runwieldSessionId,
                projectId: project.projectId,
                ownerInstanceId: "interrupted-owner",
                ownerProcessKind: "test",
                expectedGeneration: null,
                expectedCurrentSegmentId: segment.segmentId,
            });
            manager.appendMessage({
                role: "user",
                timestamp: Date.now(),
                content: [{ type: "text", text: "preserved output" }],
            });
            await Promise.resolve(
                (/** @type {{ dispose?: () => void | Promise<void> }} */ (manager)).dispose?.(),
            );
            interruptedStore.close();

            const resumedStore = openFileSessionStore();
            const runtime = createSessionRuntime({
                sessionStore: resumedStore,
                ownerProcessKind: "test",
                ownerInstanceId: "resuming-owner",
            });
            try {
                const loaded = await runtime.loadSession({ cwd, sessionId: piSessionId, sessionPath: transcriptPath });
                assertEquals(loaded.sessionManagerId, piSessionId);
                const recovered = resumedStore.inspectSessionActivation(session.runwieldSessionId);
                assertEquals(recovered.activation?.state, "idle");
                assertEquals(recovered.generation?.generation, 0);
            } finally {
                await runtime.closeAllSessionsWhenIdle?.();
                resumedStore.close();
            }
        } finally {
            interruptedStore.close();
            if (previousHome === undefined) Deno.env.delete("HOME");
            else Deno.env.set("HOME", previousHome);
            await removeTempDir(home);
        }
    });
});

Deno.test("SessionRuntime synchronization recovers safe append-only output after a later interrupted turn", async () => {
    await withRuntimeCommandFixture(
        "runtime-managed-later-recovery-",
        async ({ homeDir: home, projectRoot: cwd }) => {
            const store = openOwnerCoordinationStore({ dbPath: `${home}/owner.sqlite3` });
            const runtime = createSessionRuntime({
                sessionStore: store,
                ownerProcessKind: "test",
                ownerInstanceId: "runtime-recovery-owner",
            });
            try {
                const sessionId = await runtime.createPromptReadySession({ cwd, agentName: "guide" });
                const managed = runtime.getSessionSnapshot(sessionId)?.managed;
                if (!managed) throw new Error("Fixture Session was not managed");
                const segment = store.getCurrentSessionSegment(managed.runwieldSessionId);
                if (!segment) throw new Error("Fixture Session segment was unavailable");
                const state = store.inspectSessionActivation(managed.runwieldSessionId);
                const proof = store.acquireSessionActivation({
                    runwieldSessionId: managed.runwieldSessionId,
                    projectId: managed.projectId,
                    ownerInstanceId: "interrupted-claude-turn",
                    ownerProcessKind: "test",
                    expectedGeneration: state.generation?.generation ?? null,
                    expectedCurrentSegmentId: managed.currentSegmentId,
                    phase: "turning",
                });
                await Deno.writeTextFile(
                    segment.transcriptPath,
                    `${
                        JSON.stringify({
                            type: "custom",
                            id: crypto.randomUUID(),
                            customType: "runwield.backend_status",
                            data: {
                                version: 1,
                                backend: "claude-cli",
                                kind: "non_zero_exit",
                                exitCode: 1,
                                message: "Claude Code exited before completing the turn.",
                            },
                        })
                    }\n`,
                    { append: true },
                );
                store.markSessionUncertain(proof, { reason: "Claude Code exited before completing the turn." });

                const synchronized = await runtime.synchronizeManagedSession(sessionId);

                assertEquals(synchronized.ok, true);
                assertEquals(
                    store.inspectSessionActivation(managed.runwieldSessionId).generation?.generation,
                    (state.generation?.generation ?? 0) + 1,
                );
                assertEquals(store.inspectSessionActivation(managed.runwieldSessionId).activation?.state, "idle");
                assertEquals(runtime.getSessionSnapshot(sessionId)?.managed?.syncState?.status, "current");
                assertEquals(runtime.getUserTurnSubmissionBlockMessage(sessionId), null);
            } finally {
                await runtime.closeAllSessionsWhenIdle?.();
                store.close();
            }
        },
    );
});

Deno.test("SessionRuntime does not emit unchanged current managed sync state on idle polls", async () => {
    await withRuntimeCommandFixture(
        "runtime-managed-idle-sync-",
        async ({ homeDir, projectRoot }) => {
            const store = openOwnerCoordinationStore({ dbPath: `${homeDir}/owner.sqlite3` });
            try {
                const writerRuntime = createSessionRuntime({
                    sessionStore: store,
                    ownerProcessKind: "test",
                    ownerInstanceId: "runtime-idle-sync-writer",
                });
                let runwieldSessionId = "";
                try {
                    const created = await writerRuntime.createInteractiveSession({ cwd: projectRoot, mode: "new" });
                    await writerRuntime.switchAgent(created.sessionId, { agentName: "Ideator" });
                    runwieldSessionId = writerRuntime.getSessionSnapshot(created.sessionId)?.managed
                        ?.runwieldSessionId || "";
                    assert(runwieldSessionId);
                } finally {
                    await writerRuntime.closeAllSessionsWhenIdle?.();
                }

                const observerRuntime = createSessionRuntime({
                    sessionStore: store,
                    ownerProcessKind: "test",
                    ownerInstanceId: "runtime-idle-sync-observer",
                });
                try {
                    const resumed = await observerRuntime.createInteractiveSession({
                        cwd: projectRoot,
                        mode: "continue",
                        resumeSessionId: runwieldSessionId,
                    });
                    await observerRuntime.synchronizeManagedSession(resumed.sessionId);
                    /** @type {string[]} */
                    const events = [];
                    observerRuntime.subscribeSessionEvents(resumed.sessionId, (event) => {
                        if (event.type === RuntimeEventTypes.MANAGED_SYNC_STATE_CHANGED) events.push(event.status);
                    });

                    await observerRuntime.synchronizeManagedSession(resumed.sessionId);
                    await observerRuntime.synchronizeManagedSession(resumed.sessionId);

                    assertEquals(events, []);
                } finally {
                    await observerRuntime.closeAllSessionsWhenIdle?.();
                }
            } finally {
                store.close();
            }
        },
    );
});

Deno.test("SessionRuntime hydrates dormant managed Sessions for direct Plan workflow operations", async () => {
    await withRuntimeCommandFixture(
        "runtime-managed-plan-workflow-",
        async ({ homeDir: home, projectRoot: cwd, setModelMessages }) => {
            setModelMessages([fauxAssistantMessage(fauxText("Planning remains active after hydration."))]);
            const store = openOwnerCoordinationStore({ dbPath: `${home}/owner.sqlite3` });
            try {
                store.registerProject({ root: cwd, now: () => "2026-01-01T00:00:01.000Z" });
                const runtime = createSessionRuntime({
                    sessionStore: store,
                    ownerProcessKind: "test",
                    ownerInstanceId: "runtime-test-owner",
                });
                try {
                    const created = await runtime.createInteractiveSession({
                        cwd,
                        mode: "new",
                        deferManagedActivationUntilAgentReady: true,
                    });
                    await runtime.switchAgent(created.sessionId, { agentName: "planner" });
                    assertEquals(runtime.getSessionSnapshot(created.sessionId)?.managed?.generation, 0);
                    assertEquals(typeof runtime.getSessionSnapshot(created.sessionId)?.sessionManagerId, "string");

                    const result = await runtime.runPlanningAgent(created.sessionId, {
                        agentName: "planner",
                        initialRequest: "Resume planning",
                    });

                    assertEquals(result, { outcome: "no_call" });
                    assertEquals(runtime.getSessionSnapshot(created.sessionId)?.managed?.generation, 1);
                    assertEquals(typeof runtime.getSessionSnapshot(created.sessionId)?.sessionManagerId, "string");
                } finally {
                    await runtime.closeAllSessionsWhenIdle?.();
                }
            } finally {
                store.close();
            }
        },
    );
});

Deno.test("SessionRuntime lazy materialization creates missing Project roots", async () => {
    ensureRuntimeModelFixture();
    const cwd = join(runtimeProjectRoot(), `lazy-missing-root-${crypto.randomUUID()}`);
    const runtime = createSessionRuntime({ sessionStore: null, ownerProcessKind: "test" });
    const created = await runtime.createInteractiveSession({
        cwd,
        mode: "new",
        deferManagedActivationUntilAgentReady: true,
    });
    try {
        runtime.markPromptReadyAgent(created.sessionId, { agentName: "router" });
        const result = await runtime.promptUserTurn(created.sessionId, { initialRequest: "hello" });
        assertEquals(result.ok, true);
        assertEquals((await Deno.stat(cwd)).isDirectory, true);
        assertEquals(typeof runtime.getSessionSnapshot(created.sessionId)?.sessionManagerId, "string");
    } finally {
        await runtime.closeAllSessionsWhenIdle?.();
    }
});

Deno.test("SessionRuntime keeps first-turn materialization failures retryable", async () => {
    ensureRuntimeModelFixture();
    const cwd = join(runtimeProjectRoot(), `lazy-file-root-${crypto.randomUUID()}`);
    await Deno.writeTextFile(cwd, "not a directory");
    const runtime = createSessionRuntime({ sessionStore: null, ownerProcessKind: "test" });
    const created = await runtime.createInteractiveSession({
        cwd,
        mode: "new",
        deferManagedActivationUntilAgentReady: true,
    });
    try {
        runtime.markPromptReadyAgent(created.sessionId, { agentName: "router" });
        await assertRejects(
            () => runtime.promptUserTurn(created.sessionId, { initialRequest: "first try" }),
            Error,
            "Project root must be a directory",
        );
        assertEquals(runtime.getSessionSnapshot(created.sessionId)?.busy, false);
        assertEquals(runtime.getSessionSnapshot(created.sessionId)?.managed, null);
        await Deno.remove(cwd);
        await Deno.mkdir(cwd, { recursive: true });
        const result = await runtime.promptUserTurn(created.sessionId, { initialRequest: "retry" });
        assertEquals(result.ok, true);
        assertEquals(typeof runtime.getSessionSnapshot(created.sessionId)?.sessionManagerId, "string");
    } finally {
        await runtime.closeAllSessionsWhenIdle?.();
    }
});

Deno.test("SessionRuntime can defer managed creation cataloging until Agent readiness", async () => {
    const cwd = join(runtimeProjectRoot(), `deferred-${crypto.randomUUID()}`);
    await Deno.mkdir(cwd, { recursive: true });
    const home = getHomeDir();
    const store = openOwnerCoordinationStore({ dbPath: join(home, "owner-defer.sqlite3") });
    try {
        const project = store.registerProject({ root: cwd, now: () => "2026-01-01T00:00:01.000Z" });

        const runtime = createSessionRuntime({
            sessionStore: store,
            ownerProcessKind: "test",
            ownerInstanceId: "runtime-test-owner",
        });
        const created = await runtime.createInteractiveSession({
            cwd,
            mode: "new",
            deferManagedActivationUntilAgentReady: true,
        });
        try {
            assertEquals(created.sessionManagerId, null);
            assertEquals(runtime.getSessionSnapshot(created.sessionId)?.sessionManagerId, null);
            assertEquals(runtime.getSessionSnapshot(created.sessionId)?.managed, null);
            assertEquals((await store.listProjectSessions(project.projectId)).sessions, []);
        } finally {
            runtime.closeSession(created.sessionId);
        }
    } finally {
        store.close();
    }
});

Deno.test("SessionRuntime continue opens the explicitly requested saved Session", async () => {
    ensureRuntimeModelFixture();
    const cwd = join(runtimeProjectRoot(), `explicit-resume-${crypto.randomUUID()}`);
    await Deno.mkdir(cwd, { recursive: true });
    const runtime = createSessionRuntime({ ownerProcessKind: "test" });
    let firstPersistedId = "";
    let firstRunWieldId = "";
    try {
        const first = await runtime.createInteractiveSession({ cwd, mode: "new" });
        const second = await runtime.createInteractiveSession({ cwd, mode: "new" });
        firstPersistedId = runtime.getSessionSnapshot(first.sessionId)?.sessionManagerId || "";
        firstRunWieldId = runtime.getSessionSnapshot(first.sessionId)?.managed?.runwieldSessionId || "";
        const secondPersistedId = runtime.getSessionSnapshot(second.sessionId)?.sessionManagerId;
        assert(firstPersistedId);
        assert(firstRunWieldId);
        assert(typeof secondPersistedId === "string");
        assert(firstPersistedId !== secondPersistedId);
    } finally {
        await runtime.closeAllSessionsWhenIdle();
    }

    const resumedRuntime = createSessionRuntime({ ownerProcessKind: "test" });
    try {
        const resumed = await resumedRuntime.createInteractiveSession({
            cwd,
            mode: "continue",
            resumeSessionId: firstRunWieldId,
        });

        assertEquals(resumedRuntime.getSessionSnapshot(resumed.sessionId)?.sessionManagerId, firstPersistedId);
        assertEquals(resumedRuntime.getSessionSnapshot(resumed.sessionId)?.managed?.runwieldSessionId, firstRunWieldId);
    } finally {
        await resumedRuntime.closeAllSessionsWhenIdle();
    }

    const transcriptIdRuntime = createSessionRuntime({ ownerProcessKind: "test" });
    try {
        const resumed = await transcriptIdRuntime.createInteractiveSession({
            cwd,
            mode: "continue",
            resumeSessionId: firstPersistedId,
        });

        assertEquals(transcriptIdRuntime.getSessionSnapshot(resumed.sessionId)?.sessionManagerId, firstPersistedId);
        assertEquals(
            transcriptIdRuntime.getSessionSnapshot(resumed.sessionId)?.managed?.runwieldSessionId,
            firstRunWieldId,
        );
    } finally {
        await transcriptIdRuntime.closeAllSessionsWhenIdle();
    }
});

Deno.test("SessionRuntime does not apply dormant local mutations when Session evidence is absent", async () => {
    const sessionHost = new SessionHost();
    const session = sessionHost.createSession({
        id: "managed-pending-agent",
        cwd: runtimeProjectRoot(),
        sessionManager: null,
        managed: {
            runwieldSessionId: "rw-pending-agent",
            projectId: "project-pending-agent",
            piSessionId: "pi-pending-agent",
            transcriptPath: `${runtimeProjectRoot()}/transcript.jsonl`,
            generation: 3,
            acknowledgedGeneration: 3,
            name: "Pending Agent",
            activeAgent: "router",
            workflowContext: null,
        },
    });
    const home = getHomeDir();
    const store = openOwnerCoordinationStore({
        dbPath: join(home, `owner-no-authority-${crypto.randomUUID()}.sqlite3`),
    });
    const runtime = new SessionRuntime({
        sessionHost,
        sessionStore: store,
        ownerProcessKind: "test",
        ownerInstanceId: crypto.randomUUID(),
    });
    /** @type {string[]} */
    const changedAgents = [];
    runtime.subscribeSessionEvents(session.id, (event) => {
        if (event.type === RuntimeEventTypes.AGENT_CHANGED) changedAgents.push(event.agentName);
    });

    assertEquals((await runtime.switchAgent(session.id, { agentName: "engineer" })).error, "refresh_required");
    assertEquals(
        (await runtime.reconfigureSessionModel(session.id, "gpt-next", "test-provider")).error,
        "refresh_required",
    );
    assertEquals((await runtime.setSessionThinkingLevel(session.id, "high")).error, "refresh_required");

    const snapshot = runtime.getSessionSnapshot(session.id);

    assertEquals(changedAgents, []);
    assertEquals(session.getPendingManagedTurnIntent(), {});
    assertEquals(snapshot?.activeAgent, "router");
    assertEquals(snapshot?.activeModel, { model: "", provider: "" });
    assertEquals(snapshot?.thinkingLevel, "off");
    store.close();
});

Deno.test("SessionRuntime emits projected attention only when the attention record changes", () => {
    const summary = {
        attention: {
            eventId: "attention-entry:attention_requested:0",
            reason: "agentStopped",
            agentName: "Planner",
        },
    };

    // First observation seeds the baseline: a transcript adopted with an attention
    // entry already in it must not notify about that history.
    assertEquals(shouldEmitProjectedAttention(summary, undefined), false);
    // Repeat syncs project the same record and must stay silent.
    assertEquals(shouldEmitProjectedAttention(summary, "attention-entry:attention_requested:0"), false);
    // A newly appended attention entry notifies once.
    assertEquals(shouldEmitProjectedAttention(summary, "older-entry:attention_requested:0"), true);
    assertEquals(shouldEmitProjectedAttention(summary, null), true);
    // No attention in the projection is never an emission.
    assertEquals(shouldEmitProjectedAttention({ attention: null }, "older-entry:attention_requested:0"), false);
    assertEquals(shouldEmitProjectedAttention(undefined, undefined), false);
});

Deno.test("SessionRuntime keeps dormant managed projection separate from runtime authority", () => {
    const sessionHost = new SessionHost();
    const session = sessionHost.createSession({
        id: "managed-authority-separation",
        cwd: runtimeProjectRoot(),
        sessionManager: null,
        managed: {
            runwieldSessionId: "rw-authority-separation",
            projectId: "project-authority-separation",
            piSessionId: "pi-authority-separation",
            transcriptPath: `${runtimeProjectRoot()}/transcript.jsonl`,
            generation: 9,
            acknowledgedGeneration: 9,
            name: "Managed Authority Separation",
            activeAgent: "router",
            model: "cached-model",
            provider: "cached-provider",
            thinkingLevel: "medium",
            workflowContext: { routingIntent: "PLANNED_CHANGE", complexity: "LOW" },
        },
    });
    const runtime = makeRuntime({ sessionHost });

    assertEquals(runtime.isManagedSessionDormant(session.id), true);
    assertEquals(runtime.getRuntimeActiveAgentName(session.id), null);
    assertEquals(runtime.getRuntimeActiveExecutionWorkflow(session.id), null);
    assertEquals(runtime.getSessionSnapshot(session.id)?.activeAgent, "router");
    assertEquals(runtime.getSessionSnapshot(session.id)?.activeModel, {
        model: "cached-model",
        provider: "cached-provider",
    });
    assertEquals(runtime.getSessionSnapshot(session.id)?.thinkingLevel, "medium");
    assertEquals(runtime.getSessionSnapshot(session.id)?.workflowContext, {
        routingIntent: "PLANNED_CHANGE",
        complexity: "LOW",
    });

    assertEquals(session.getRootSessionManager?.(), null);

    assertEquals(runtime.getRuntimeActiveAgentName(session.id), null);
    assertEquals(runtime.getSessionSnapshot(session.id)?.activeAgent, "router");
});

Deno.test("SessionRuntime blocks dormant reload and compaction when Session evidence is absent", async () => {
    const sessionHost = new SessionHost();
    const session = sessionHost.createSession({
        id: "managed-reload-compact",
        cwd: runtimeProjectRoot(),
        sessionManager: null,
        managed: {
            runwieldSessionId: "rw-reload-compact",
            projectId: "project-reload-compact",
            piSessionId: "pi-reload-compact",
            transcriptPath: `${runtimeProjectRoot()}/transcript.jsonl`,
            generation: 3,
            acknowledgedGeneration: 3,
            name: "Managed Reload Compact",
            activeAgent: "router",
            workflowContext: null,
        },
    });
    const home = getHomeDir();
    const store = openOwnerCoordinationStore({ dbPath: join(home, `owner-no-reload-${crypto.randomUUID()}.sqlite3`) });
    const runtime = new SessionRuntime({
        sessionHost,
        sessionStore: store,
        ownerProcessKind: "test",
        ownerInstanceId: crypto.randomUUID(),
    });

    assertEquals((await runtime.reloadSession(session.id)).error, "refresh_required");
    assertEquals((await runtime.compactSession(session.id)).error, "refresh_required");
    store.close();
});

Deno.test("SessionRuntime reload preserves the canonical hidden-agent selection", async () => {
    const sessionHost = new SessionHost();
    const runtime = makeRuntime({ sessionHost });
    const cwd = runtimeProjectRoot();
    const sessionManager = SessionManager.create(cwd, getRunWieldSessionDir(cwd));
    const session = sessionHost.createSession({
        id: crypto.randomUUID(),
        cwd,
        // @ts-expect-error Real SessionManager is runtime-compatible with HostedSession.
        sessionManager,
    });
    const customTool = {
        name: "slicer_finalize",
        label: "Finalize fixture",
        description: "Finalize child plans",
        parameters: { type: "object", properties: {} },
        execute: () =>
            Promise.resolve({
                content: [{ type: /** @type {const} */ ("text"), text: "ok" }],
                details: null,
            }),
    };
    await switchActiveAgent(session, {
        agentName: "slicer",
        subAgentDefinition: { id: SUBAGENTS.SLICER },
        customTools: [customTool],
        toolNames: ["slicer_finalize"],
        sessionManager: /** @type {any} */ (session.getRootSessionManager()),
    });

    assertEquals(await runtime.reloadSession(session.id), { ok: true });
    const rebuilt = getRootSessionRebuildOptions(session);
    assertEquals(rebuilt?.subAgentDefinition, { id: SUBAGENTS.SLICER });
    assertStrictEquals(rebuilt?.customTools?.[0], customTool);
    assertEquals(rebuilt?.toolNames?.includes("slicer_finalize"), true);
    assertEquals(session.getRootAgentName(), "slicer");
});

Deno.test("SessionRuntime emits the first user message before busy and persistence", async () => {
    ensureRuntimeModelFixture();
    const cwd = join(runtimeProjectRoot(), `first-message-order-${crypto.randomUUID()}`);
    await Deno.mkdir(cwd, { recursive: true });
    const runtime = createSessionRuntime({ sessionStore: null, ownerProcessKind: "test" });
    const created = await runtime.createInteractiveSession({
        cwd,
        mode: "new",
        deferManagedActivationUntilAgentReady: true,
    });
    /** @type {string[]} */
    const events = [];
    let userEventCount = 0;
    let presentationTurnRanBeforePersistence = false;
    let resolvePresentationTurn = () => {};
    const presentationTurn = new Promise((resolve) => {
        resolvePresentationTurn = () => resolve(undefined);
    });
    runtime.subscribeSessionEvents(created.sessionId, (event) => {
        if (event.type === RuntimeEventTypes.USER_MESSAGE) {
            userEventCount += 1;
            events.push(`user:${runtime.getSessionSnapshot(created.sessionId)?.sessionManagerId || "none"}`);
        }
        if (event.type === RuntimeEventTypes.BUSY_CHANGED && event.busy) {
            events.push(`busy:${runtime.getSessionSnapshot(created.sessionId)?.sessionManagerId || "none"}`);
            setTimeout(() => {
                presentationTurnRanBeforePersistence =
                    runtime.getSessionSnapshot(created.sessionId)?.sessionManagerId === null;
                resolvePresentationTurn();
            }, 0);
        }
        if (event.type === RuntimeEventTypes.MANAGED_SYNC_STATE_CHANGED) {
            events.push(`sync:${runtime.getSessionSnapshot(created.sessionId)?.sessionManagerId || "none"}`);
        }
    });
    try {
        runtime.markPromptReadyAgent(created.sessionId, { agentName: "router" });
        const result = await runtime.promptUserTurn(created.sessionId, {
            initialRequest: "hello",
            initialImages: [{ base64: btoa("img"), mimeType: "image/png" }],
        });
        assertEquals(result.ok, true);
        await presentationTurn;
        assertEquals(userEventCount, 1);
        assertEquals(events.slice(0, 2), ["user:none", "busy:none"]);
        assertEquals(presentationTurnRanBeforePersistence, true);
        assert(events.some((event) => event.startsWith("sync:")));
    } finally {
        await runtime.closeAllSessionsWhenIdle?.();
    }
});

Deno.test("SessionRuntime clean agent starts and switches resolve each agent preset model", async () => {
    await withRuntimeCommandFixture(
        "runtime-router-engineer-preset-",
        async ({ homeDir, projectRoot, settingsPath }) => {
            await Deno.writeTextFile(
                settingsPath,
                JSON.stringify({
                    activeModelPreset: "split-agents",
                    modelPresets: {
                        "split-agents": {
                            agents: {
                                router: { model: "runtime-command-fixture/router-model" },
                                engineer: { model: "runtime-command-fixture/engineer-model" },
                                guide: { model: "runtime-command-fixture/guide-model" },
                            },
                        },
                    },
                    notifications: { enabled: false },
                }),
            );
            await Deno.writeTextFile(
                `${homeDir}/.wld/models.json`,
                JSON.stringify({
                    providers: {
                        "runtime-command-fixture": {
                            name: "Runtime Command Fixture Provider",
                            baseUrl: "http://127.0.0.1:0",
                            apiKey: "fixture-key",
                            api: "runtime-command-faux",
                            models: [
                                {
                                    id: "router-model",
                                    name: "Router Model",
                                    api: "runtime-command-faux",
                                    input: ["text", "image"],
                                    contextWindow: 128000,
                                    maxTokens: 4096,
                                },
                                {
                                    id: "engineer-model",
                                    name: "Engineer Model",
                                    api: "runtime-command-faux",
                                    input: ["text", "image"],
                                    contextWindow: 128000,
                                    maxTokens: 4096,
                                },
                                {
                                    id: "guide-model",
                                    name: "Guide Model",
                                    api: "runtime-command-faux",
                                    input: ["text", "image"],
                                    contextWindow: 128000,
                                    maxTokens: 4096,
                                },
                            ],
                        },
                    },
                }),
            );
            const sessionHost = new SessionHost();
            const runtime = makeRuntime({ sessionHost });
            const sessionId = await runtime.createPromptReadySession({ cwd: projectRoot });
            const hostedSession = sessionHost.getSession(sessionId);
            assert(hostedSession);
            assertEquals(runtime.getSessionSnapshot(sessionId)?.activeModel, {
                provider: "runtime-command-fixture",
                model: "router-model",
            });

            const switched = await runtime.switchAgent(sessionId, { agentName: "engineer" });
            assertEquals(switched.ok, true);
            assertEquals(runtime.getSessionSnapshot(sessionId)?.activeModel, {
                provider: "runtime-command-fixture",
                model: "engineer-model",
            });

            const guideSwitched = await runtime.switchAgent(sessionId, { agentName: "guide" });
            assertEquals(guideSwitched.ok, true);
            assertEquals(runtime.getSessionSnapshot(sessionId)?.activeModel, {
                provider: "runtime-command-fixture",
                model: "guide-model",
            });
            await runtime.closeSession(sessionId);

            const directGuideSessionId = await runtime.createPromptReadySession({
                cwd: projectRoot,
                agentName: "guide",
            });
            assertEquals(runtime.getSessionSnapshot(directGuideSessionId)?.activeAgent, "guide");
            assertEquals(runtime.getSessionSnapshot(directGuideSessionId)?.activeModel, {
                provider: "runtime-command-fixture",
                model: "guide-model",
            });
            await runtime.closeSession(directGuideSessionId);
        },
    );
});

Deno.test("SessionRuntime prompt-ready metadata is limited to unpersisted new-session shells", async () => {
    ensureRuntimeModelFixture();
    const cwd = join(runtimeProjectRoot(), `prompt-ready-shell-${crypto.randomUUID()}`);
    await Deno.mkdir(cwd, { recursive: true });
    const runtime = createSessionRuntime({ sessionStore: null, ownerProcessKind: "test" });
    const created = await runtime.createInteractiveSession({
        cwd,
        mode: "new",
        deferManagedActivationUntilAgentReady: true,
    });
    try {
        assertEquals(runtime.markPromptReadyAgent(created.sessionId, { agentName: "router" }).ok, true);
        assertEquals(runtime.getSessionSnapshot(created.sessionId)?.activeAgent, "router");
        const result = await runtime.promptUserTurn(created.sessionId, { initialRequest: "hello" });
        assertEquals(result.ok, true);
        assertEquals(typeof runtime.getSessionSnapshot(created.sessionId)?.sessionManagerId, "string");
        assertEquals(runtime.markPromptReadyAgent(created.sessionId, { agentName: "guide" }), {
            ok: false,
            error: "not_unpersisted_new_session",
        });
    } finally {
        await runtime.closeAllSessionsWhenIdle?.();
    }
});

/**
 * @typedef {Object} ManagedModelTurnSample
 * @property {string | null | undefined} agent
 * @property {string} prompt
 * @property {string} model
 */

Deno.test("SessionRuntime managed operation prefers persisted active agent over stale catalog summary", async () => {
    await withRuntimeCommandFixture(
        "runtime-stale-agent-summary-",
        async ({ projectRoot, setModelResponseFactory }) => {
            const sessionHost = new SessionHost();
            const runtime = new SessionRuntime({
                sessionHost,
                sessionStore: openFileSessionStore(),
                ownsSessionStore: true,
                ownerProcessKind: "test",
                ownerInstanceId: crypto.randomUUID(),
            });
            try {
                const sessionId = await runtime.createPromptReadySession({ cwd: projectRoot, agentName: "guide" });
                const hosted = sessionHost.getSession(sessionId);
                assert(hosted);
                const managed = hosted.getManagedMetadata();
                assert(managed);
                hosted.setManagedMetadata({ ...managed, activeAgent: "router", model: "stale-router-model" });
                /** @type {ManagedModelTurnSample[]} */
                const turns = [];
                setModelResponseFactory((context, _options, _state, model) => {
                    turns.push({
                        agent: runtime.getSessionSnapshot(sessionId)?.activeAgent,
                        prompt: context.systemPrompt || "",
                        model: model.id,
                    });
                    return fauxAssistantMessage(fauxText("The saved Guide handled this turn."));
                });
                const result = await runtime.promptUserTurn(sessionId, { initialRequest: "Continue explaining." });
                assertEquals(result.ok, true);
                assertEquals(turns.length, 1);
                assertEquals(turns[0].agent, "guide");
                assertEquals(turns[0].model, "fixture-model");
                assert(turns[0].prompt.includes("You are the Guide"));
                assertEquals(runtime.getSessionSnapshot(sessionId)?.activeAgent, "guide");
            } finally {
                await runtime.closeAllSessionsWhenIdle();
            }
        },
    );
});

Deno.test("SessionRuntime managed prompt acquires activation before writable hydration and publication", async () => {
    const source = await Deno.readTextFile(new URL("./session-runtime.js", import.meta.url));
    const promptManagedIndex = source.indexOf("async #runManagedOperation(sessionId, descriptor, body)");
    const nextMethodIndex = source.indexOf("async promptManagedSession(sessionId, options)", promptManagedIndex);
    const promptManagedBody = source.slice(promptManagedIndex, nextMethodIndex);
    const inspectIndex = promptManagedBody.indexOf("inspectSessionActivation(managed.runwieldSessionId)");
    const acquireIndex = promptManagedBody.indexOf("acquireSessionActivation({", inspectIndex);
    const userMessageIndex = promptManagedBody.indexOf("type: RuntimeEventTypes.USER_MESSAGE", acquireIndex);
    const hydratedIndex = promptManagedBody.indexOf(
        'changeSessionActivationPhase(activeProof, "hydrated")',
        acquireIndex,
    );
    const openIndex = promptManagedBody.indexOf("await openPersistedRootSession({", hydratedIndex);
    const resumeAgentIndex = promptManagedBody.indexOf("await resolveResumeAgentName(sessionManager)", openIndex);
    const activateIndex = promptManagedBody.indexOf(
        "await this.#activateSessionAgent(hostedSession, {",
        resumeAgentIndex,
    );
    const promptIndex = promptManagedBody.indexOf(
        "async () => await body({ acceptedTurnId, hasPendingImages, capability }),",
        activateIndex,
    );
    const checkpointIndex = promptManagedBody.indexOf(
        'changeSessionActivationPhase(activeProof, "checkpointing")',
        promptIndex,
    );
    const publishIndex = promptManagedBody.indexOf("publishGenerationAndRelease(activeProof", checkpointIndex);
    const recoveryIndex = promptManagedBody.indexOf("markSessionUncertain(activeProof", publishIndex);

    assertEquals(promptManagedIndex >= 0, true);
    assertEquals(inspectIndex >= 0, true);
    assertEquals(acquireIndex > inspectIndex, true);
    assertEquals(userMessageIndex > acquireIndex, true);
    assertEquals(hydratedIndex > userMessageIndex, true);
    assertEquals(openIndex > hydratedIndex, true);
    assertEquals(resumeAgentIndex > openIndex, true);
    assertEquals(activateIndex > resumeAgentIndex, true);
    assertEquals(promptIndex > activateIndex, true);
    assertEquals(checkpointIndex > promptIndex, true);
    assertEquals(publishIndex > checkpointIndex, true);
    assertEquals(recoveryIndex > publishIndex, true);
});

/**
 * @typedef {Object} ManagedActivationSample
 * @property {string | undefined} state
 * @property {string | null | undefined} phase
 * @property {boolean} writable
 */

Deno.test("SessionRuntime managed workflow operations hold activation during model execution and publish afterward", async () => {
    await withRuntimeCommandFixture(
        "runtime-operation-publication-",
        async ({ projectRoot, setModelResponseFactory }) => {
            const store = openFileSessionStore();
            const sessionHost = new SessionHost();
            const runtime = new SessionRuntime({
                sessionHost,
                sessionStore: store,
                ownerProcessKind: "test",
                ownerInstanceId: crypto.randomUUID(),
            });
            try {
                const sessionId = await runtime.createPromptReadySession({ cwd: projectRoot, agentName: "guide" });
                const managed = sessionHost.getSession(sessionId)?.getManagedMetadata();
                assert(managed);
                /** @type {ManagedActivationSample[]} */
                const samples = [];
                setModelResponseFactory(() => {
                    const activation = store.inspectSessionActivation(managed.runwieldSessionId).activation;
                    samples.push({
                        state: activation?.state,
                        phase: activation?.phase,
                        writable: Boolean(sessionHost.getSession(sessionId)?.getRootSessionManager()),
                    });
                    return fauxAssistantMessage(fauxText("The isolated operation completed."));
                });
                await runtime.runIsolatedAgent(sessionId, { agentName: "guide", userRequest: "Inspect this project." });
                assertEquals(samples, [{ state: "active", phase: "turning", writable: true }]);
                const published = store.inspectSessionActivation(managed.runwieldSessionId);
                assertEquals(published.activation?.state, "idle");
                assertEquals(published.generation?.generation, (managed.generation ?? 0) + 1);
                assertEquals(published.generation?.byteLength, (await Deno.stat(managed.transcriptPath)).size);
                assertEquals(sessionHost.getSession(sessionId)?.getRootSessionManager(), null);
            } finally {
                await runtime.closeAllSessionsWhenIdle();
                store.close();
            }
        },
    );
});

Deno.test("SessionRuntime uses one segmented user-turn submission path", async () => {
    setRuntimeModelMessages([fauxAssistantMessage(fauxText("Normalized request received."))]);
    const runtime = makeRuntime();
    const sessionId = await runtime.createPromptReadySession({ cwd: runtimeProjectRoot(), agentName: "router" });
    /** @type {string[]} */
    const userMessages = [];
    runtime.subscribeSessionEvents(sessionId, (event) => {
        if (event.type === RuntimeEventTypes.USER_MESSAGE) userMessages.push(event.text);
    });

    const result = await runtime.promptUserTurn(sessionId, {
        initialRequest: "  hello from editor  ",
        initialImages: [],
    });

    assertEquals(userMessages, ["  hello from editor  "]);
    assertEquals(result, {
        ok: true,
        turns: 1,
        managed: true,
        submittedRequest: "  hello from editor  ",
        restoreDraft: false,
        historyText: "hello from editor",
    });
});

Deno.test("SessionRuntime routes execution continuation input to the resolved Plan owner", async () => {
    setRuntimeModelMessages([fauxAssistantMessage(fauxText("Engineer continuation received."))]);
    const runtime = makeRuntime();
    const sessionId = await runtime.createPromptReadySession({ cwd: runtimeProjectRoot(), agentName: "router" });
    await runtime.switchAgent(sessionId, { agentName: "planner" });
    await runtime.setActiveExecutionWorkflow(sessionId, {
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        executionAgent: "engineer",
        executionCwd: runtimeProjectRoot(),
        validationContinuation: true,
    });
    /** @type {string[]} */
    const changedAgents = [];
    runtime.subscribeSessionEvents(sessionId, (event) => {
        if (event.type === RuntimeEventTypes.AGENT_CHANGED) changedAgents.push(event.agentName);
    });

    const result = await runtime.promptUserTurn(sessionId, {
        initialRequest: "  continue  ",
        initialImages: [],
    });

    assertEquals(result.ok, true);
    // The workflow still records `engineer`; the user talks to Plan Engineer.
    assertEquals(runtime.getSessionSnapshot(sessionId)?.activeAgent, "plan-engineer");
    assertEquals(changedAgents, ["planner", "plan-engineer"]);
});

Deno.test("SessionRuntime keeps the next Epic decomposition reply with Slicer", async () => {
    const projectRoot = join(runtimeProjectRoot(), `slicer-resume-${crypto.randomUUID()}`);
    await Deno.mkdir(projectRoot, { recursive: true });
    await savePlan(projectRoot, "epic-a", "# Epic A", {
        classification: "PROJECT",
        complexity: "HIGH",
        summary: "Epic A",
        affectedPaths: ["src/epic.ts"],
        status: "ready_for_decomposition",
    });
    let resumedSystemPrompt = "";
    const resumedToolNames = new Set([""]);
    resumedToolNames.clear();
    setRuntimeModelResponseFactories([
        () => fauxAssistantMessage(fauxText("I recommend two child Plans. Should I finalize them?")),
        (context) => {
            resumedSystemPrompt = context.systemPrompt || "";
            for (const tool of context.tools || []) resumedToolNames.add(tool.name);
            return fauxAssistantMessage(fauxText("I will keep refining this Epic decomposition."));
        },
    ]);
    const runtime = makeRuntime();
    const sessionId = await runtime.createPromptReadySession({ cwd: projectRoot, agentName: "architect" });

    try {
        const slicerResult = await runtime.runSlicerAgent(sessionId, { planName: "epic-a" });
        assertEquals(slicerResult, { ok: true });
        assertEquals(runtime.getSessionSnapshot(sessionId)?.activeAgent, "slicer");

        const replyResult = await runtime.promptUserTurn(sessionId, {
            initialRequest: "Yes; use epic-base as the shared branch and finalize the children.",
            initialImages: [],
        });

        assertEquals(replyResult.ok, true);
        assertEquals(runtime.getSessionSnapshot(sessionId)?.activeAgent, "slicer");
        assertEquals(resumedSystemPrompt.includes("You are the Slicer"), true);
        assertEquals(resumedToolNames.has("slicer_finalize_decomposition"), true);
    } finally {
        await runtime.closeSession(sessionId);
    }
});

Deno.test("SessionRuntime owns managed submission blocking messages", () => {
    const sessionHost = new SessionHost();
    const session = sessionHost.createSession({
        id: "managed-submission-block",
        cwd: runtimeProjectRoot(),
        sessionManager: null,
        managed: {
            runwieldSessionId: "rw-managed-submission-block",
            projectId: "project-managed-submission-block",
            piSessionId: "pi-managed-submission-block",
            transcriptPath: `${runtimeProjectRoot()}/transcript.jsonl`,
            generation: 2,
            acknowledgedGeneration: 2,
            name: "Managed Submission Block",
            activeAgent: "router",
            workflowContext: null,
            syncState: {
                type: RuntimeEventTypes.MANAGED_SYNC_STATE_CHANGED,
                status: "active_elsewhere",
                localGeneration: 2,
                latestGeneration: 2,
                owningSurfaceKind: "workspace",
            },
        },
    });
    const runtime = makeRuntime({ sessionHost });

    assertEquals(
        runtime.getUserTurnSubmissionBlockMessage(session.id),
        "This conversation is still running in RunWield Workspace. Continue there, or wait for its current turn to finish before sending here.",
    );

    session.setManagedMetadata({
        .../** @type {NonNullable<ReturnType<typeof session.getManagedMetadata>>} */ (session.getManagedMetadata()),
        syncState: {
            type: RuntimeEventTypes.MANAGED_SYNC_STATE_CHANGED,
            status: "degraded",
            localGeneration: 2,
            latestGeneration: 3,
            message: "Refresh failed.",
        },
    });

    assertEquals(runtime.getUserTurnSubmissionBlockMessage(session.id), "Refresh failed.");
});

Deno.test("SessionRuntime projects an empty context report before an Agent is selected", async () => {
    const runtime = makeRuntime();
    const { sessionId } = await runtime.createInteractiveSession({ cwd: runtimeProjectRoot() });
    assertEquals((await runtime.getSessionContextReport(sessionId))?.usedTokens, 0);
});

Deno.test("SessionRuntime projects active Agent Session context without exposing internals", async () => {
    const sessionHost = new SessionHost();
    const runtime = makeRuntime({ sessionHost });
    const sessionId = await runtime.createPromptReadySession({ cwd: runtimeProjectRoot(), agentName: "engineer" });

    const report = await runtime.getSessionContextReport(sessionId);
    assertEquals(report?.agentDisplayName, "Engineer");
    assertEquals(report?.provider, RUNTIME_TEST_PROVIDER);
    assertEquals(report?.model, RUNTIME_TEST_MODEL);
    assertEquals(report?.usageState, "estimated");
    assertEquals(report?.staticTokens, 0);
    assertEquals(report?.activeMessageTokens, 0);
    assertEquals(JSON.stringify(report).includes("systemPrompt"), false);
});

Deno.test("SessionRuntime uses one activation transaction for initial readiness and later switches", async () => {
    const sessionHost = new SessionHost();
    const runtime = makeRuntime({ sessionHost });
    const sessionId = await runtime.createPromptReadySession({ cwd: runtimeProjectRoot(), agentName: "router" });
    const hostedSession = sessionHost.requireSession(sessionId);
    assertEquals(hostedSession.getRootAgentName(), null);
    assertEquals(runtime.getSessionSnapshot(sessionId)?.activeAgent, "router");
    assertEquals(hostedSession.getRootSessionManager(), null);

    /** @type {string[]} */
    const changedAgents = [];
    runtime.subscribeSessionEvents(sessionId, (event) => {
        if (event.type === RuntimeEventTypes.AGENT_CHANGED) changedAgents.push(event.agentName);
    });
    await runtime.switchAgent(sessionId, { agentName: "operator" });

    assertEquals(hostedSession.getRootAgentName(), null);
    assertEquals(runtime.getSessionSnapshot(sessionId)?.activeAgent, "operator");
    assertEquals(hostedSession.getRootSessionManager(), null);
    assertEquals(changedAgents, ["operator"]);
});

Deno.test("SessionRuntime snapshots and events keep workflow footer context separate from execution state", async () => {
    const sessionHost = new SessionHost();
    const runtime = makeRuntime({ sessionHost });
    const hostedSession = sessionHost.createSession({
        id: crypto.randomUUID(),
        cwd: runtimeProjectRoot(),
        sessionManager: null,
    });
    const sessionId = hostedSession.id;
    /** @type {any[]} */
    const events = [];
    /** @param {import('./session-runtime-events.js').SessionRuntimeEvent} event */
    const captureEvent = (event) => events.push(event);
    hostedSession.setEventSink({ emit: captureEvent });

    hostedSession.setWorkflowTriageContext({ routingIntent: "PLANNED_CHANGE", complexity: "MEDIUM" });
    hostedSession.setWorkflowPlanName("docs/plans/footer-restoration.md");
    await runtime.setActiveExecutionWorkflow(sessionId, {
        planName: "execution-plan",
        triageMeta: { complexity: "HIGH" },
        executionAgent: "frontend-engineer",
        collaborationRecommendation: "pair",
        collaborationStyle: "pair",
        pairCheckpointCount: 2,
        executionCwd: runtimeProjectRoot(),
    });

    const snapshot = runtime.getSessionSnapshot(sessionId);
    assertEquals(snapshot?.workflowContext, {
        routingIntent: "PLANNED_CHANGE",
        complexity: "MEDIUM",
        planName: "footer-restoration",
    });
    assertEquals(snapshot?.activeExecutionWorkflow, {
        planName: "execution-plan",
        triageMeta: { complexity: "HIGH" },
        executionAgent: "frontend-engineer",
        collaborationRecommendation: "pair",
        collaborationStyle: "pair",
        pairCheckpointCount: 2,
        executionCwd: runtimeProjectRoot(),
    });
    assertEquals(snapshot?.activeExecutionWorkflow === hostedSession.getActiveExecutionWorkflow(), false);
    assertEquals("workflow" in /** @type {Record<string, unknown>} */ (snapshot || {}), false);
    assertEquals(
        events.filter((event) => event.type === RuntimeEventTypes.WORKFLOW_CONTEXT_CHANGED)
            .map((event) => event.workflowContext),
        [
            { routingIntent: "PLANNED_CHANGE", complexity: "MEDIUM" },
            {
                routingIntent: "PLANNED_CHANGE",
                complexity: "MEDIUM",
                planName: "footer-restoration",
            },
        ],
    );
});

Deno.test("SessionRuntime emits one keyboard-help event for the requested session", async () => {
    const runtime = makeRuntime();
    const sessionId = await runtime.createPromptReadySession({ cwd: runtimeProjectRoot() });
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
    const sessionId = await runtime.createPromptReadySession({ cwd: runtimeProjectRoot() });
    /** @type {any[]} */
    const events = [];
    runtime.subscribeSessionEvents(sessionId, (event) => {
        events.push(event);
    });

    const result = await runtime.promptSession(sessionId, { initialRequest: "hello", initialImages: [] });

    assertEquals(result, { ok: true, turns: 1 });
    const eventTypes = events.map((event) => event.type);
    assertEquals(eventTypes.slice(0, 3), [
        RuntimeEventTypes.BUSY_CHANGED,
        RuntimeEventTypes.USER_MESSAGE,
        RuntimeEventTypes.TURN_START,
    ]);
    assertEquals(eventTypes.at(-1), RuntimeEventTypes.BUSY_CHANGED);
    assertEquals(events.at(-1)?.busy, false);
    assertEquals(eventTypes.filter((type) => type === RuntimeEventTypes.TURN_START).length, 2);
    assertEquals(eventTypes.filter((type) => type === RuntimeEventTypes.TURN_END).length, 2);
    assertEquals(eventTypes.filter((type) => type === RuntimeEventTypes.USAGE).length, 1);
    assertEquals(eventTypes.filter((type) => type === RuntimeEventTypes.ATTENTION_REQUESTED).length, 1);
    assertEquals(eventTypes.filter((type) => type === RuntimeEventTypes.ASSISTANT_TEXT_DELTA).length > 0, true);
    assertEquals(events.filter((event) => event.type === RuntimeEventTypes.USER_MESSAGE).length, 1);
    assertEquals(events.every((event) => event.sessionId === sessionId), true);
});

Deno.test("SessionRuntime persists pending prompt images once a live manager exists", async () => {
    await withProcessGlobalTestLock(async () => {
        const previousHome = getHomeDir();
        const home = await Deno.makeTempDir({ prefix: "runwield-runtime-pending-image-" });
        Deno.env.set("HOME", home);
        const cwd = `${home}/project`;
        await Deno.mkdir(cwd, { recursive: true });
        const runtime = makeRuntime();
        try {
            const sessionId = await runtime.createPromptReadySession({ cwd });
            /** @type {any[]} */
            const events = [];
            runtime.subscribeSessionEvents(sessionId, (event) => {
                events.push(event);
            });

            const result = await runtime.promptSession(sessionId, {
                initialRequest: "look",
                initialImages: [{ base64: btoa("img"), mimeType: "image/png" }],
            });

            assertEquals(result.ok, true);
            const userEvent = events.find((event) => event.type === RuntimeEventTypes.USER_MESSAGE);
            const eventImage = userEvent?.images?.[0];
            assertEquals(eventImage?.ref?.startsWith("attachment:"), true);
            assertEquals(new TextDecoder().decode(await Deno.readFile(eventImage.path)), "img");
        } finally {
            Deno.env.set("HOME", previousHome);
            await removeTempDir(home);
        }
    });
});

Deno.test("SessionRuntime keeps executePlan workflow operations busy while preparation runs", async () => {
    await withRuntimeCommandFixture(
        "runtime-execute-busy-",
        async ({ projectRoot: cwd, setModelResponseFactory }) => {
            const runtime = createSessionRuntime();
            /** @type {() => void} */
            let releaseEngineerTurn = () => {};
            const engineerTurnReleased = new Promise((resolve) => {
                releaseEngineerTurn = /** @type {() => void} */ (resolve);
            });
            setModelResponseFactory(async () => {
                await engineerTurnReleased;
                return fauxAssistantMessage(fauxText("Execution remains paused in the fixture."));
            });
            const planName = "execute-busy-plan";
            await savePlan(cwd, planName, `# ${planName}`, {
                classification: "PLANNED_CHANGE",
                status: "ready_for_work",
                summary: planName,
                affectedPaths: [],
                planId: "execute-busy-plan-id",
            });
            // Exercise the real persisted-consent path against the fixture HOME. This keeps
            // the test on the non-Git execution branch without replacing workflow machinery
            // or opening an interactive prompt.
            await rememberNonGitExecutionConsent("featurePlan", cwd);
            const approvalEvidence = await loadPlanActionEvidence(cwd, "execute-busy-plan-id");
            if (approvalEvidence.kind !== "success") throw new Error(approvalEvidence.message);
            const sessionId = await runtime.createPromptReadySession({ cwd });
            /** @type {boolean[]} */
            const busyStates = [];
            /** @type {RuntimePreparationBusySample[]} */
            const preparationMessages = [];
            /** @type {() => void} */
            let resolveLaunchSeen = () => {};
            const launchSeen = new Promise((resolve) => {
                resolveLaunchSeen = /** @type {() => void} */ (resolve);
            });
            runtime.subscribeSessionEvents(sessionId, (event) => {
                if (event.type === RuntimeEventTypes.BUSY_CHANGED) busyStates.push(event.busy);
                if ("message" in event && typeof event.message === "string") {
                    if (
                        event.message.includes("preparing execution target") ||
                        event.message.includes("preparing in-place execution") ||
                        event.message.includes("updating Plan status to in_progress") ||
                        event.message.includes("launching Plan Engineer to execute")
                    ) {
                        preparationMessages.push({
                            message: event.message,
                            busy: runtime.getSessionSnapshot(sessionId)?.busy,
                        });
                    }
                    if (event.message.includes("launching Plan Engineer to execute")) resolveLaunchSeen();
                }
            });

            const execution = runtime.executePlan(sessionId, {
                planName,
                triageMeta: {
                    planId: "execute-busy-plan-id",
                    classification: "PLANNED_CHANGE",
                    revision: approvalEvidence.evidence.revision,
                    status: approvalEvidence.evidence.status,
                    worktree: approvalEvidence.evidence.worktree,
                },
            });

            const preparation = await Promise.race([
                launchSeen.then(() => ({ kind: "launched" })),
                execution.then((result) => ({ kind: "completed", result })),
            ]);
            if (preparation.kind === "completed" && "result" in preparation) {
                throw new Error(`Execution completed before Engineer launch: ${JSON.stringify(preparation.result)}`);
            }
            assertEquals(runtime.getSessionSnapshot(sessionId)?.busy, true);
            releaseEngineerTurn();
            await execution;

            assertEquals(busyStates, [true, false]);
            assertEquals(preparationMessages.map((entry) => entry.message), [
                "preparing execution target...",
                "preparing in-place execution because Git is unavailable...",
                "updating Plan status to in_progress...",
                "launching Plan Engineer to execute...",
            ]);
            assertEquals(preparationMessages.map((entry) => entry.busy), [true, true, true, true]);
            assertEquals(runtime.getSessionSnapshot(sessionId)?.busy, false);
            runtime.closeAllSessions();
        },
    );
});

Deno.test("SessionRuntime keeps direct model operations busy until the outermost operation settles", async () => {
    const sessionHost = new SessionHost();
    const agentSession = makeSteeringAgentSession();
    /** @type {Array<() => void>} */
    const releases = [];
    agentSession.compact = () =>
        new Promise((resolve) => {
            releases.push(() => resolve({ ok: true }));
        });
    const runtime = makeRuntime({ sessionHost });
    const sessionId = await attachExternalAgentSession(runtime, sessionHost, agentSession);
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

Deno.test("SessionRuntime cycles through max thinking level", async () => {
    const runtime = makeRuntime();
    const { sessionId } = await runtime.createInteractiveSession({ cwd: runtimeProjectRoot() });
    await runtime.setSessionThinkingLevel(sessionId, "xhigh");

    const result = await runtime.cycleSessionThinkingLevel(sessionId);

    assertEquals(result, { ok: true, thinkingLevel: "max" });
    assertEquals(runtime.getSessionSnapshot(sessionId)?.thinkingLevel, "max");
});

Deno.test("SessionRuntime event subscriptions unsubscribe deterministically", async () => {
    const runtime = makeRuntime();
    const { sessionId } = await runtime.createInteractiveSession({ cwd: runtimeProjectRoot() });
    /** @type {any[]} */
    const events = [];
    const unsubscribe = runtime.subscribeSessionEvents(sessionId, (event) => {
        events.push(event);
    });

    await runtime.setSessionThinkingLevel(sessionId, "low");
    unsubscribe();
    await runtime.setSessionThinkingLevel(sessionId, "medium");

    assertEquals(
        events.filter((event) => event.type === RuntimeEventTypes.THINKING_LEVEL_CHANGED)
            .map((event) => event.thinkingLevel),
        ["low"],
    );
});

Deno.test("SessionRuntime owns the complete local shell tool lifecycle", async () => {
    const runtime = makeRuntime();
    const { sessionId } = await runtime.createInteractiveSession({ cwd: runtimeProjectRoot() });
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
    assertEquals(events.find((event) => event.type === RuntimeEventTypes.USER_MESSAGE)?.text, "!printf runtime-shell");
    assertEquals(events.find((event) => event.type === RuntimeEventTypes.TOOL_START)?.title, "! printf runtime-shell");
    assertEquals(events.filter((event) => event.type === RuntimeEventTypes.TOOL_START).length, 1);
    assertEquals(events.filter((event) => event.type === RuntimeEventTypes.TOOL_END).length, 1);
    assertEquals(events.find((event) => event.type === RuntimeEventTypes.TOOL_END)?.output, "runtime-shell");
});

Deno.test("SessionRuntime persists local shell commands as bash execution messages visible to LLM context", async () => {
    setRuntimeModelMessages([fauxAssistantMessage(fauxText("Initial fixture turn."))]);
    const runtime = makeRuntime();
    const sessionId = await runtime.createPromptReadySession({ cwd: runtimeProjectRoot() });
    await runtime.promptSession(sessionId, { initialRequest: "start", initialImages: [] });

    await runtime.runLocalShellCommand(sessionId, {
        command: "printf visible-shell",
        userRequest: "!printf visible-shell",
        persist: true,
    });
    let nextTurnContext = "";
    setRuntimeModelResponseFactories([(context) => {
        nextTurnContext = JSON.stringify(context.messages);
        return fauxAssistantMessage(fauxText("Observed the shell result."));
    }]);
    await runtime.promptSession(sessionId, { initialRequest: "what happened?", initialImages: [] });

    assertEquals(nextTurnContext.includes("visible-shell"), true);
});

Deno.test("SessionRuntime cancellation terminates an active local shell command", async () => {
    const runtime = makeRuntime();
    const { sessionId } = await runtime.createInteractiveSession({ cwd: runtimeProjectRoot() });
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

Deno.test({
    name: "SessionRuntime cancellation kills the local shell command's descendant processes",
    ignore: Deno.build.os === "windows",
    fn: async () => {
        const runtime = makeRuntime();
        const { sessionId } = await runtime.createInteractiveSession({ cwd: runtimeProjectRoot() });
        const pidFile = await Deno.makeTempFile({ prefix: "runwield-local-shell-descendant-" });
        let resolveStarted = () => {};
        const started = new Promise((resolve) => {
            resolveStarted = () => resolve(undefined);
        });
        runtime.subscribeSessionEvents(sessionId, (event) => {
            if (event.type === RuntimeEventTypes.TOOL_START) resolveStarted();
        });

        const command = runtime.runLocalShellCommand(sessionId, {
            command: `sleep 30 & echo $! > ${pidFile}; wait`,
            persist: false,
        });
        await started;
        let descendantPid = 0;
        while (!descendantPid) {
            await new Promise((resolve) => setTimeout(resolve, 10));
            descendantPid = Number((await Deno.readTextFile(pidFile)).trim()) || 0;
        }
        runtime.cancelSession(sessionId);
        const result = await command;

        const descendantDead = await waitForProcessDeath(descendantPid);
        if (!descendantDead) Deno.kill(descendantPid, "SIGKILL");
        await Deno.remove(pidFile).catch(() => {});

        assertEquals(result.canceled, true);
        assertEquals(result.exitCode, 130);
        assertEquals(
            descendantDead,
            true,
            "cancellation must kill the wrapper shell's descendants, not only the wrapper",
        );
    },
});

Deno.test("SessionRuntime publishes handler errors and releases the turn", async () => {
    setRuntimeModelResponseFactories([() => {
        throw new Error("boom");
    }]);
    const runtime = makeRuntime();
    const sessionId = await runtime.createPromptReadySession({ cwd: runtimeProjectRoot() });
    /** @type {string[]} */
    const types = [];
    runtime.subscribeSessionEvents(sessionId, (event) => {
        types.push(event.type);
    });

    const result = await runtime.promptSession(sessionId, { initialRequest: "fail", initialImages: [] });

    assertEquals(result.ok, true);
    assertEquals(types.includes(RuntimeEventTypes.TERMINAL_ERROR), true);
    assertEquals(types.at(-1), RuntimeEventTypes.BUSY_CHANGED);
    assertEquals(runtime.getSessionSnapshot(sessionId)?.busy, false);
});

Deno.test("SessionRuntime rejects overlapping turns for one id", async () => {
    /** @type {() => void} */
    let release = () => {};
    const released = new Promise((resolve) => {
        release = () => resolve(undefined);
    });
    /** @type {() => void} */
    let markStarted = () => {};
    const started = new Promise((resolve) => {
        markStarted = () => resolve(undefined);
    });
    setRuntimeModelResponseFactories([async () => {
        markStarted();
        await released;
        return fauxAssistantMessage(fauxText("Released."));
    }]);
    const runtime = makeRuntime();
    const sessionId = await runtime.createPromptReadySession({ cwd: runtimeProjectRoot() });

    const first = runtime.promptSession(sessionId, { initialRequest: "first", initialImages: [] });
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timeoutId;
    try {
        await Promise.race([
            started,
            new Promise((_, reject) => {
                timeoutId = setTimeout(() => reject(new Error("The first model turn did not start")), 10000);
            }),
        ]);
        assertEquals(runtime.getSessionSnapshot(sessionId)?.busy, true);
        await assertRejects(
            () => runtime.promptSession(sessionId, { initialRequest: "second", initialImages: [] }),
            SessionTurnInProgressError,
            "already has an active turn",
        );
    } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        release();
        await first;
        assertEquals(runtime.getSessionSnapshot(sessionId)?.busy, false);
        await runtime.closeAllSessionsWhenIdle();
    }
});

Deno.test("SessionRuntime allows independent session ids to run concurrently", async () => {
    /** @type {() => void} */
    let releaseResponses = () => {};
    const released = new Promise((resolve) => {
        releaseResponses = () => resolve(undefined);
    });
    /** @type {() => void} */
    let markBothStarted = () => {};
    const bothStarted = new Promise((resolve) => {
        markBothStarted = () => resolve(undefined);
    });
    let startedCount = 0;
    setRuntimeModelResponseFactories(["Alpha.", "Beta."].map((text) => async () => {
        startedCount++;
        if (startedCount === 2) markBothStarted();
        await released;
        return fauxAssistantMessage(fauxText(text));
    }));
    const runtime = makeRuntime();
    const alpha = await runtime.createPromptReadySession({ cwd: runtimeProjectRoot() });
    const beta = await runtime.createPromptReadySession({ cwd: runtimeProjectRoot() });

    const prompts = [
        runtime.promptSession(alpha, { initialRequest: "alpha", initialImages: [] }),
        runtime.promptSession(beta, { initialRequest: "beta", initialImages: [] }),
    ];
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timeoutId;
    try {
        await Promise.race([
            bothStarted,
            new Promise((_, reject) => {
                timeoutId = setTimeout(() => reject(new Error("Both model turns did not start concurrently")), 10000);
            }),
        ]);
        assertEquals(runtime.getSessionSnapshot(alpha)?.busy, true);
        assertEquals(runtime.getSessionSnapshot(beta)?.busy, true);
    } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        // A shared gate also releases a late-starting response on failure.
        releaseResponses();
        await Promise.all(prompts);
        await runtime.closeAllSessionsWhenIdle();
    }
    assertEquals((await Promise.all(prompts)).map((result) => result.ok), [true, true]);
});

Deno.test("SessionRuntime ignores synthetic switch-requesting tool results", async () => {
    setRuntimeModelMessages([
        fauxAssistantMessage(fauxToolCall("synthetic_switch_request", {})),
        fauxAssistantMessage(fauxText("Still working as Engineer.")),
    ]);
    const runtime = makeRuntime();
    const sessionId = await runtime.createPromptReadySession({ cwd: runtimeProjectRoot(), agentName: "engineer" });
    const syntheticSwitchTool = {
        name: "synthetic_switch_request",
        label: "Synthetic Switch Request",
        description: "Return a synthetic tool result that asks the runtime to switch agents.",
        parameters: { type: "object", properties: {} },
        execute: () =>
            Promise.resolve({
                content: [{ type: /** @type {const} */ ("text"), text: "Switch to Router now." }],
                details: { outcome: "switch_agent", agentName: "router" },
            }),
    };
    await runtime.switchAgent(sessionId, {
        agentName: "engineer",
        customTools: [syntheticSwitchTool],
        toolNames: ["synthetic_switch_request"],
    });
    /** @type {string[]} */
    const submittedMessages = [];
    /** @type {string[]} */
    const changedAgents = [];
    runtime.subscribeSessionEvents(sessionId, (event) => {
        if (event.type === RuntimeEventTypes.USER_MESSAGE) submittedMessages.push(event.text);
        if (event.type === RuntimeEventTypes.AGENT_CHANGED) changedAgents.push(event.agentName);
    });
    const activeAgentBefore = runtime.getSessionSnapshot(sessionId)?.activeAgent;

    const result = await runtime.promptUserTurn(sessionId, { initialRequest: "fix this", initialImages: [] });

    assertEquals(result.ok, true);
    assertEquals(result.turns, 1);
    assertEquals(submittedMessages, ["fix this"]);
    assertEquals(changedAgents.filter((agentName) => agentName !== "engineer"), []);
    assertEquals(runtime.getSessionSnapshot(sessionId)?.activeAgent, activeAgentBefore);
});

Deno.test("SessionRuntime owns steering and deferred queue transitions", async () => {
    const sessionHost = new SessionHost();
    const agentSession = makeSteeringAgentSession();
    const runtime = makeRuntime({ sessionHost });
    const sessionId = await attachExternalAgentSession(runtime, sessionHost, agentSession);
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

Deno.test("SessionRuntime lets dormant managed sessions consume deferred user follow-up messages", async () => {
    const runtime = makeRuntime();
    const sessionId = await runtime.createPromptReadySession({ cwd: runtimeProjectRoot(), agentName: "router" });
    await runtime.promptUserTurn(sessionId, { initialRequest: "finish this session" });
    assertEquals(runtime.getSessionSnapshot(sessionId)?.managed?.dormant, true);

    const queued = runtime.queueNextTurnMessage(sessionId, "follow up anyway", []);
    const taken = runtime.takeNextTurnMessage(sessionId);

    assertEquals(taken.ok, true);
    assertEquals(taken.message?.id, queued.message?.id);
    assertEquals(taken.message?.text, "follow up anyway");
    assertEquals(runtime.getQueuedMessages(sessionId), []);
});

Deno.test("SessionRuntime steers active foreground sub-agent before streaming root and reconciles source queue", async () => {
    const sessionHost = new SessionHost();
    const rootSession = makeSteeringAgentSession();
    const foregroundSession = makeSteeringAgentSession();
    const runtime = makeRuntime({ sessionHost });
    const sessionId = await attachExternalAgentSession(runtime, sessionHost, rootSession);
    const hostedSession = sessionHost.requireSession(sessionId);
    hostedSession.addSubAgentSession(foregroundSession);
    const targetId = hostedSession.pushSteeringTargetSession(foregroundSession);
    /** @type {Array<{ status: string, text: string }>} */
    const queueEvents = [];
    runtime.subscribeSessionEvents(sessionId, (event) => {
        if (event.type === RuntimeEventTypes.QUEUED_MESSAGE_CHANGED) {
            queueEvents.push({ status: event.status, text: event.message.text });
        }
    });

    const steered = await runtime.steerSession(sessionId, "review this edge case", []);
    assertEquals(steered.queued, true);
    assertEquals(rootSession.getSteeringMessages(), []);
    assertEquals(foregroundSession.getSteeringMessages(), ["review this edge case"]);

    foregroundSession.consumeNextSteering();
    assertEquals(queueEvents, [
        { status: "queued", text: "review this edge case" },
        { status: "consumed", text: "review this edge case" },
    ]);
    assertEquals(runtime.getQueuedMessages(sessionId), []);

    hostedSession.popSteeringTargetSession(targetId);
    hostedSession.removeSubAgentSession(foregroundSession);
});

Deno.test("SessionRuntime keeps queue subscriptions for multiple steering source sessions", async () => {
    const sessionHost = new SessionHost();
    const rootSession = makeSteeringAgentSession();
    const foregroundSession = makeSteeringAgentSession();
    const runtime = makeRuntime({ sessionHost });
    const sessionId = await attachExternalAgentSession(runtime, sessionHost, rootSession);
    const hostedSession = sessionHost.requireSession(sessionId);
    /** @type {string[]} */
    const consumedTexts = [];
    runtime.subscribeSessionEvents(sessionId, (event) => {
        if (event.type === RuntimeEventTypes.QUEUED_MESSAGE_CHANGED && event.status === "consumed") {
            consumedTexts.push(event.message.text);
        }
    });

    await runtime.steerSession(sessionId, "root pending", []);
    const targetId = hostedSession.pushSteeringTargetSession(foregroundSession);
    await runtime.steerSession(sessionId, "foreground pending", []);

    rootSession.consumeNextSteering();
    foregroundSession.consumeNextSteering();

    assertEquals(consumedTexts, ["root pending", "foreground pending"]);
    assertEquals(runtime.getQueuedMessages(sessionId), []);
    hostedSession.popSteeringTargetSession(targetId);
});

Deno.test("SessionRuntime dequeue restores remaining steering onto original source when foreground changes", async () => {
    const sessionHost = new SessionHost();
    const rootSession = makeSteeringAgentSession();
    const foregroundSession = makeSteeringAgentSession();
    const otherForegroundSession = makeSteeringAgentSession();
    const runtime = makeRuntime({ sessionHost });
    const sessionId = await attachExternalAgentSession(runtime, sessionHost, rootSession);
    const hostedSession = sessionHost.requireSession(sessionId);
    const foregroundTargetId = hostedSession.pushSteeringTargetSession(foregroundSession);
    await runtime.steerSession(sessionId, "keep on child", []);
    await runtime.steerSession(sessionId, "recall from child", []);
    hostedSession.popSteeringTargetSession(foregroundTargetId);
    const otherTargetId = hostedSession.pushSteeringTargetSession(otherForegroundSession);

    const dequeued = await runtime.dequeueLastQueuedMessage(sessionId);

    assertEquals(dequeued.message?.text, "recall from child");
    assertEquals(foregroundSession.getSteeringMessages(), ["keep on child"]);
    assertEquals(otherForegroundSession.getSteeringMessages(), []);
    assertEquals(runtime.getQueuedMessages(sessionId).map((message) => message.text), ["keep on child"]);
    hostedSession.popSteeringTargetSession(otherTargetId);
});

Deno.test("SessionRuntime falls back to root when foreground steering target stopped streaming", async () => {
    const sessionHost = new SessionHost();
    const rootSession = makeSteeringAgentSession();
    const foregroundSession = makeSteeringAgentSession();
    foregroundSession.isStreaming = false;
    const runtime = makeRuntime({ sessionHost });
    const sessionId = await attachExternalAgentSession(runtime, sessionHost, rootSession);
    const hostedSession = sessionHost.requireSession(sessionId);
    const targetId = hostedSession.pushSteeringTargetSession(foregroundSession);

    const steered = await runtime.steerSession(sessionId, "root instead", []);
    assertEquals(steered.queued, true);
    assertEquals(rootSession.getSteeringMessages(), ["root instead"]);
    assertEquals(foregroundSession.getSteeringMessages(), []);

    hostedSession.popSteeringTargetSession(targetId);
});

Deno.test("SessionRuntime cancellation emits cancellation and dequeues pending messages", async () => {
    const sessionHost = new SessionHost();
    const agentSession = makeSteeringAgentSession();
    const runtime = makeRuntime({ sessionHost });
    const sessionId = await attachExternalAgentSession(runtime, sessionHost, agentSession);
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

Deno.test("SessionRuntime marks aborted agent turns to suppress agent-stopped attention", async () => {
    const sessionHost = new SessionHost();
    const runtime = makeRuntime({ sessionHost });
    const sessionId = await attachExternalAgentSession(runtime, sessionHost, makeSteeringAgentSession());
    const canceledSession = sessionHost.requireSession(sessionId);

    assertEquals(runtime.cancelSession(sessionId), { ok: true, aborted: true });
    assertEquals(canceledSession?.consumeSuppressedAgentStoppedAttention(), true);
    assertEquals(canceledSession?.consumeSuppressedAgentStoppedAttention(), false);
});

Deno.test("SessionRuntime suppresses attention when Esc races with turn completion", async () => {
    const sessionHost = new SessionHost();
    const agentSession = makeSteeringAgentSession();
    agentSession.isStreaming = false;
    const runtime = makeRuntime({ sessionHost });
    const sessionId = await attachExternalAgentSession(runtime, sessionHost, agentSession);
    const hostedSession = sessionHost.requireSession(sessionId);
    hostedSession.beginTurn("racing-turn");

    assertEquals(runtime.cancelSession(sessionId), { ok: true, aborted: false });
    assertEquals(hostedSession.consumeSuppressedAgentStoppedAttention(), true);
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
    const sessionHost = new SessionHost();
    const runtime = makeRuntime({ sessionHost });
    const sessionId = await attachExternalAgentSession(runtime, sessionHost, agentSession);
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
    const sessionHost = new SessionHost();
    const runtime = makeRuntime({ sessionHost });
    const session = sessionHost.createSession({
        id: crypto.randomUUID(),
        cwd: runtimeProjectRoot(),
        sessionManager: null,
    });
    const sessionId = session.id;
    /** @type {string[]} */
    const types = [];
    /** @param {import('./session-runtime-events.js').SessionRuntimeEvent} event */
    const captureEvent = (event) => types.push(event.type);
    session.setEventSink({ emit: captureEvent });
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
    const sessionHost = new SessionHost();
    const runtime = makeRuntime({ sessionHost });
    const session = sessionHost.createSession({
        id: crypto.randomUUID(),
        cwd: runtimeProjectRoot(),
        sessionManager: null,
    });
    const sessionId = session.id;
    /** @type {string[]} */
    const types = [];
    /** @param {import('./session-runtime-events.js').SessionRuntimeEvent} event */
    const captureEvent = (event) => types.push(event.type);
    session.setEventSink({ emit: captureEvent });
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

Deno.test("SessionRuntime automatically catalogs and segments legacy transcripts when loaded", async () => {
    await withProcessGlobalTestLock(async () => {
        const previousHome = getHomeDir();
        const home = await Deno.makeTempDir({ prefix: "runwield-runtime-load-cataloged-unmanaged-" });
        Deno.env.set("HOME", home);
        const cwd = `${home}/project`;
        await Deno.mkdir(cwd, { recursive: true });
        const store = openOwnerCoordinationStore({ dbPath: `${home}/owner.sqlite3` });
        const piSessionId = "cataloged-normal-resume";
        try {
            ensureRuntimeModelFixture();
            const sessionDir = getRunWieldSessionDir(cwd);
            await Deno.mkdir(sessionDir, { recursive: true });
            const manager = SessionManager.create(cwd, sessionDir, { id: piSessionId });
            manager.appendCustomEntry("runwield.active_agent", { agentName: "planner" });
            manager.appendMessage(
                /** @type {any} */ ({
                    role: "user",
                    timestamp: Date.now(),
                    content: [{ type: "text", text: "resume cataloged fixture" }],
                }),
            );
            manager.appendMessage(
                /** @type {any} */ ({
                    role: "assistant",
                    timestamp: Date.now(),
                    api: RUNTIME_TEST_API,
                    provider: RUNTIME_TEST_PROVIDER,
                    model: RUNTIME_TEST_MODEL,
                    usage: {},
                    cost: {},
                    stopReason: "end_turn",
                    content: [{ type: "text", text: "cataloged fixture response" }],
                }),
            );
            const transcriptPath = manager.getSessionFile();
            if (!transcriptPath) throw new Error("fixture transcript was not persisted");
            const runtime = createSessionRuntime({
                sessionStore: store,
                ownerProcessKind: "test",
                ownerInstanceId: "runtime-test-owner",
            });
            try {
                const loaded = await runtime.loadSession({ cwd, sessionId: piSessionId, sessionPath: transcriptPath });
                const managed = runtime.getSessionSnapshot(loaded.sessionId)?.managed;
                const cataloged = store.findSessionByLocator({ transcriptPath });
                assertEquals(cataloged?.piSessionId, piSessionId);
                assertEquals(managed?.runwieldSessionId, cataloged?.runwieldSessionId);
                assertEquals(managed?.generation, 0);
                assertEquals(store.listProjects(), []);
                assertEquals(store.listSessionTranscriptSegments(managed?.runwieldSessionId || "").length, 1);
            } finally {
                await runtime.closeAllSessionsWhenIdle?.();
            }
        } finally {
            store.close();
            Deno.env.set("HOME", previousHome);
            await removeTempDir(home);
        }
    });
});

Deno.test("SessionRuntime loadSession returns opaque metadata and redacted replay events", async () => {
    ensureRuntimeModelFixture();
    const branch = [
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
    ];
    const manager = SessionManager.create(runtimeProjectRoot(), getRunWieldSessionDir(runtimeProjectRoot()), {
        id: "persisted-1",
    });
    for (const entry of branch) {
        if (entry.type === "message") manager.appendMessage(/** @type {any} */ (entry.message));
        else if (entry.type === "custom") manager.appendCustomEntry(String(entry.customType), entry.data);
        else if (entry.type === "model_change") {
            manager.appendModelChange(String(entry.provider), String(entry.modelId));
        } else if (entry.type === "thinking_level_change") {
            manager.appendThinkingLevelChange(String(entry.thinkingLevel));
        }
    }
    const sessionPath = manager.getSessionFile();
    if (!sessionPath) throw new Error("fixture transcript was not persisted");
    const runtime = createSessionRuntime();

    const result = await runtime.loadSession({ cwd: runtimeProjectRoot(), sessionId: "persisted-1", sessionPath });

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
    assertEquals(typeof modernToolEnd?.durationMs, "number");
    assertEquals(modernToolEnd?.durationMs >= 0, true);
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
    ensureRuntimeModelFixture();
    const branch = [
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
    ];
    const manager = SessionManager.create(runtimeProjectRoot(), getRunWieldSessionDir(runtimeProjectRoot()), {
        id: "persisted-workflow",
    });
    manager.appendCustomEntry("runwield.active_agent", { agentName: "engineer" });
    for (const entry of branch) {
        if (entry.type === "message") manager.appendMessage(/** @type {any} */ (entry.message));
        else manager.appendCustomEntry(String(entry.customType), entry.data);
    }
    const sessionPath = manager.getSessionFile();
    if (!sessionPath) throw new Error("fixture transcript was not persisted");
    const runtime = createSessionRuntime();

    const result = await runtime.loadSession({
        cwd: runtimeProjectRoot(),
        sessionId: "persisted-workflow",
        sessionPath,
    });
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
    const runtime = makeRuntime();
    const first = await runtime.createInteractiveSession({ cwd: runtimeProjectRoot() });
    const second = await runtime.createInteractiveSession({ cwd: runtimeProjectRoot() });

    assertEquals(runtime.closeSession(first.sessionId), { ok: true, closed: true });
    assertEquals(runtime.getSessionSnapshot(first.sessionId), null);
    assertEquals(await runtime.closeAllSessionsWhenIdle(), { ok: true, closed: 1 });
    assertEquals(runtime.getSessionSnapshot(second.sessionId), null);
    assertEquals(runtime.listSessions(), []);
});

Deno.test("SessionRuntime snapshot derives workflow context from active execution workflow fallback", async () => {
    const sessionHost = new SessionHost();
    const runtime = makeRuntime({ sessionHost });
    const sessionId = await runtime.createPromptReadySession({ cwd: runtimeProjectRoot() });
    const hostedSession = sessionHost.requireSession(sessionId);
    hostedSession.setActiveExecutionWorkflow({
        planName: "footer-plan",
        triageMeta: { classification: "FEATURE", complexity: "MEDIUM" },
        executionAgent: "engineer",
    });

    assertEquals(runtime.getSessionSnapshot(sessionId)?.workflowContext, {
        routingIntent: "PLANNED_CHANGE",
        complexity: "MEDIUM",
        planName: "footer-plan",
    });
});

Deno.test("SessionRuntime snapshot prefers explicit workflow context over active execution fallback", async () => {
    const sessionHost = new SessionHost();
    const runtime = makeRuntime({ sessionHost });
    const sessionId = await runtime.createPromptReadySession({ cwd: runtimeProjectRoot() });
    const hostedSession = sessionHost.requireSession(sessionId);
    hostedSession.setWorkflowExecutionContext({
        planName: "explicit-plan",
        triageMeta: { routingIntent: "PROJECT", complexity: "HIGH" },
    });
    hostedSession.setActiveExecutionWorkflow({
        planName: "fallback-plan",
        triageMeta: { classification: "FEATURE", complexity: "MEDIUM" },
        executionAgent: "engineer",
    });

    assertEquals(runtime.getSessionSnapshot(sessionId)?.workflowContext, {
        routingIntent: "PROJECT",
        complexity: "HIGH",
        planName: "explicit-plan",
    });
});

Deno.test("user-authorized agent switch releases active workflows", async () => {
    ensureRuntimeModelFixture();
    const sessionHost = new SessionHost();
    const runtime = makeRuntime({ sessionHost });
    const sessionId = await runtime.createPromptReadySession({ cwd: runtimeProjectRoot(), agentName: "engineer" });
    const hostedSession = sessionHost.requireSession(sessionId);
    hostedSession.setWorkflowPlanName("release-plan");
    await runtime.setActiveExecutionWorkflow(sessionId, {
        planName: "release-plan",
        triageMeta: { classification: "PLANNED_CHANGE" },
        executionAgent: "engineer",
        executionStarted: true,
        executionAttemptStartedAtMs: 123,
        projectRoot: runtimeProjectRoot(),
        executionCwd: runtimeProjectRoot(),
    });
    /** @type {string[]} */
    const notices = [];
    runtime.subscribeSessionEvents(sessionId, (event) => {
        if (event.type === RuntimeEventTypes.SYSTEM_STATUS) notices.push(event.message || "");
    });

    await runtime.switchAgent(sessionId, { agentName: "planner", releaseActiveWorkflow: true });

    const snapshot = runtime.getSessionSnapshot(sessionId);
    assertEquals(snapshot?.activeAgent, "planner");
    assertEquals(snapshot?.activeExecutionWorkflow, null);
    assertEquals(snapshot?.workflowContext?.planName, "release-plan");
    assertEquals(notices.some((message) => message.includes("/load-plan")), true);
});
