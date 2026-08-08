import { assertEquals, assertRejects, assertStrictEquals } from "@std/assert";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { withRuntimeCommandFixture } from "../../cmd/testing/runtime-command-fixture.ts";
import { runActiveAgentTurn, switchActiveAgent } from "./agent-switching.js";
import { HostedSession } from "./hosted-session.js";
import { RuntimeEventTypes } from "./session-runtime-events.js";
import {
    BACKEND_CONTINUATION_REQUEST,
    failRequestDispatch,
    prepareRequestDispatch,
    readRequestAttemptEntries,
} from "./request-dispatch.ts";

/**
 * @param {string} projectRoot
 */
function makeSession(projectRoot) {
    const sessionManager = SessionManager.inMemory(projectRoot);
    const hostedSession = new HostedSession({
        id: `root-switch-${crypto.randomUUID()}`,
        cwd: projectRoot,
        sessionManager: /** @type {any} */ (sessionManager),
    });
    return { hostedSession, sessionManager };
}

Deno.test("switchActiveAgent installs a real matching Agent root and handler", async () => {
    await withRuntimeCommandFixture("agent-switch-install-", async ({ projectRoot }) => {
        const { hostedSession, sessionManager } = makeSession(projectRoot);
        /** @type {Array<{ type?: string, agentName?: string }>} */
        const events = [];
        hostedSession.setEventSink((/** @type {{ type?: string, agentName?: string }} */ event) => events.push(event));

        const result = await switchActiveAgent(hostedSession, {
            agentName: "guide",
            sessionManager,
        });

        assertEquals(result, { ok: true, agentName: "guide", changed: true, model: undefined });
        assertEquals(hostedSession.getRootAgentName(), "guide");
        assertEquals(
            typeof /** @type {{ prompt?: Function } | null} */ (hostedSession.getRootAgentSession())?.prompt,
            "function",
        );
        assertEquals(typeof hostedSession.getActiveOnMessage(), "function");
        assertEquals(
            events.filter((event) => event.type === RuntimeEventTypes.AGENT_CHANGED && event.agentName === "guide")
                .length,
            1,
        );
        hostedSession.dispose();
    });
});

Deno.test("switchActiveAgent leaves the previous real root transaction intact when replacement construction fails", async () => {
    await withRuntimeCommandFixture("agent-switch-rollback-", async ({ projectRoot }) => {
        const { hostedSession, sessionManager } = makeSession(projectRoot);
        await switchActiveAgent(hostedSession, {
            agentName: "guide",
            allowReturnToRouter: true,
            sessionManager,
        });
        const previousRoot = hostedSession.getRootAgentSession();
        const previousHandler = hostedSession.getActiveOnMessage();

        await assertRejects(
            () =>
                switchActiveAgent(hostedSession, {
                    agentName: "guide",
                    model: "missing-provider/missing-model",
                    forceRebuild: true,
                    sessionManager,
                }),
            Error,
            "Unknown invocation model override",
        );

        assertEquals(hostedSession.getRootAgentName(), "guide");
        assertStrictEquals(hostedSession.getRootAgentSession(), previousRoot);
        assertStrictEquals(hostedSession.getActiveOnMessage(), previousHandler);
        hostedSession.dispose();
    });
});

Deno.test("runActiveAgentTurn switches and completes a real root turn through the faux model boundary", async () => {
    await withRuntimeCommandFixture(
        "active-agent-turn-",
        async ({ projectRoot, setModelResponse }) => {
            setModelResponse("The isolated Guide turn completed.");
            const { hostedSession, sessionManager } = makeSession(projectRoot);

            const messages = await runActiveAgentTurn({
                hostedSession,
                agentName: "guide",
                userRequest: "Explain the fixture.",
                sessionManager,
            });

            assertEquals(hostedSession.getRootAgentName(), "guide");
            assertEquals(JSON.stringify(messages).includes("The isolated Guide turn completed."), true);
            hostedSession.dispose();
        },
    );
});

Deno.test("switchActiveAgent reuses an unchanged real root and handler", async () => {
    await withRuntimeCommandFixture("agent-switch-reuse-", async ({ projectRoot }) => {
        const { hostedSession, sessionManager } = makeSession(projectRoot);
        await switchActiveAgent(hostedSession, {
            agentName: "guide",
            allowReturnToRouter: true,
            sessionManager,
        });
        const previousRoot = hostedSession.getRootAgentSession();
        const previousHandler = hostedSession.getActiveOnMessage();

        const result = await switchActiveAgent(hostedSession, {
            agentName: "guide",
            allowReturnToRouter: true,
        });

        assertEquals(result, { ok: true, agentName: "guide", changed: false, model: undefined });
        assertStrictEquals(hostedSession.getRootAgentSession(), previousRoot);
        assertStrictEquals(hostedSession.getActiveOnMessage(), previousHandler);
        hostedSession.dispose();
    });
});

Deno.test("switchActiveAgent replaces a stale handler without rebuilding the matching real root", async () => {
    await withRuntimeCommandFixture("agent-switch-stale-handler-", async ({ projectRoot }) => {
        const { hostedSession, sessionManager } = makeSession(projectRoot);
        await switchActiveAgent(hostedSession, { agentName: "guide", sessionManager });
        const previousRoot = hostedSession.getRootAgentSession();
        const staleHandler = () => Promise.resolve({ kind: "complete" });
        hostedSession.setActiveOnMessage(staleHandler);

        const result = await switchActiveAgent(hostedSession, { agentName: "guide" });

        assertEquals(result.changed, true);
        assertStrictEquals(hostedSession.getRootAgentSession(), previousRoot);
        assertEquals(hostedSession.getActiveOnMessage() === staleHandler, false);
        hostedSession.dispose();
    });
});

Deno.test("switchActiveAgent rebuilds a real same-Agent root when root policy changes", async () => {
    await withRuntimeCommandFixture("agent-switch-policy-", async ({ projectRoot }) => {
        const { hostedSession, sessionManager } = makeSession(projectRoot);
        await switchActiveAgent(hostedSession, {
            agentName: "guide",
            allowReturnToRouter: true,
            sessionManager,
        });
        const previousRoot = hostedSession.getRootAgentSession();

        const result = await switchActiveAgent(hostedSession, {
            agentName: "guide",
            allowReturnToRouter: false,
            sessionManager,
        });

        assertEquals(result.changed, true);
        assertEquals(hostedSession.getRootAgentSession() === previousRoot, false);
        hostedSession.dispose();
    });
});

Deno.test("provider switch continues a failed request without changing execution ownership or worktree", async () => {
    await withRuntimeCommandFixture(
        "agent-switch-backend-continuation-",
        async ({ projectRoot, setModelResponse }) => {
            setModelResponse("Continuation completed.");
            const { hostedSession, sessionManager } = makeSession(projectRoot);
            /** @type {import('./hosted-session.js').ActiveExecutionWorkflow} */
            const workflow = {
                planName: "stable-plan",
                triageMeta: { classification: "FEATURE", worktreeId: "wt-stable" },
                executionAgent: "engineer",
                executionStarted: true,
                executionCwd: `${projectRoot}/worktrees/wt-stable`,
            };
            hostedSession.setActiveExecutionWorkflow(workflow);
            await switchActiveAgent(hostedSession, {
                agentName: "engineer",
                model: "claude-cli/sonnet",
                sessionManager,
            });

            const planBody = "# Stable Plan\n\nOnly one copy belongs in the transcript.";
            const failed = prepareRequestDispatch(sessionManager, {
                userRequest: planBody,
                dispatchKind: "plan_execution",
                backend: "claude-cli",
            });
            sessionManager.appendMessage({
                role: "user",
                timestamp: Date.now(),
                content: [{ type: "text", text: planBody }],
            });
            failRequestDispatch(sessionManager, failed, true);

            await switchActiveAgent(hostedSession, {
                agentName: "engineer",
                model: "runtime-command-fixture/fixture-model",
                forceRebuild: true,
                sessionManager,
            });
            await runActiveAgentTurn({
                hostedSession,
                agentName: "engineer",
                userRequest: planBody,
                sessionManager,
                dispatchKind: "plan_execution",
            });

            const transcript = sessionManager.getBranch()
                .filter((entry) => entry.type === "message")
                .flatMap((entry) =>
                    /** @type {{ message?: { content?: Array<{ type: string, text?: string }> } }} */ (entry)
                        .message?.content || []
                )
                .filter((block) => block.type === "text")
                .map((block) => block.text || "")
                .join("\n");
            assertEquals(transcript.split(planBody).length - 1, 1);
            assertEquals(transcript.split(BACKEND_CONTINUATION_REQUEST).length - 1, 1);
            assertEquals(hostedSession.getActiveExecutionWorkflow(), workflow);
            assertEquals(hostedSession.getActiveExecutionWorkflow()?.executionAgent, "engineer");
            assertEquals(hostedSession.getActiveExecutionWorkflow()?.executionCwd, workflow.executionCwd);
            const attempts = readRequestAttemptEntries(sessionManager);
            assertEquals(attempts.at(-2)?.requestId, failed.requestId);
            assertEquals(attempts.at(-2)?.backend, "pi");
            hostedSession.dispose();
        },
    );
});
