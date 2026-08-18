/**
 * The split put a resolver between the Plan's execution owner and the Agent the
 * user actually talks to. These tests enter through the real dispatch paths —
 * `executePlan` and a SessionRuntime turn — with canonical policy input only,
 * so a resolver that is defined but never called, or called only to build a
 * display label, fails here.
 *
 * Everything the tests assert is observable: the system prompt and tool list the
 * model was handed, the `agent_changed` identity, the durable workflow owner,
 * and whether the Plan reached `implemented`.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { type Context, fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { withRuntimeCommandFixture } from "../../cmd/testing/runtime-command-fixture.ts";
import { loadPlan, savePlan } from "../../plan-store.js";
import { git } from "../git-test-fixture.ts";
import { HostedSession } from "../session/hosted-session.js";
import { SessionHost } from "../session/session-host.js";
import { SessionRuntime } from "../session/session-runtime.js";
import { RuntimeEventTypes } from "../session/session-runtime-events.js";
import { openOwnerCoordinationStore } from "../owner-coordination/index.js";
import type { RuntimeInteractionRequest, RuntimeInteractionResponse } from "../session/session-runtime-interactions.js";
import { executePlan, executePreparedPlanSegmentHandoff } from "./plan-executor.ts";
import { buildExecutionSegmentContinuation } from "./execution-segment-handoff.ts";

type InteractionHandler = (request: RuntimeInteractionRequest) => RuntimeInteractionResponse;

/** What the model was actually handed on a turn, captured from the real request. */
interface CapturedTurn {
    agentName: string | null;
    systemPrompt: string;
    toolNames: string[];
}

interface ExecutionFixture {
    hostedSession: HostedSession;
    sessionManager: SessionManager;
    agentChanges: string[];
    statusMessages: string[];
    turns: CapturedTurn[];
}

function createExecutionFixture(projectRoot: string, interaction?: InteractionHandler): ExecutionFixture {
    const sessionManager = SessionManager.inMemory(projectRoot);
    const hostedSession = new HostedSession({
        id: `plan-boundaries-${crypto.randomUUID()}`,
        cwd: projectRoot,
        interactionAdapter: {
            supportsInteraction: (type: string) => type === "pair_checkpoint",
            requestInteraction: (request: RuntimeInteractionRequest) =>
                interaction?.(request) ?? { outcome: "canceled", message: "Fixture supplied no answer." },
        },
    });
    // Pi's concrete manager implements the HostedSession runtime contract.
    // @ts-expect-error The legacy HostedSession JSDoc describes a wider manager.
    hostedSession.setRootSessionManager(sessionManager);
    const agentChanges: string[] = [];
    const statusMessages: string[] = [];
    hostedSession.setEventSink((event: { type?: string; agentName?: string; message?: string }) => {
        if (event.type === RuntimeEventTypes.AGENT_CHANGED && event.agentName) agentChanges.push(event.agentName);
        if (event.type === RuntimeEventTypes.SYSTEM_STATUS && event.message) statusMessages.push(event.message);
    });
    return { hostedSession, sessionManager, agentChanges, statusMessages, turns: [] };
}

/** Record the identity behind each model call so a label-only change cannot pass. */
function captureTurn(fixture: ExecutionFixture, context: Context): void {
    fixture.turns.push({
        agentName: fixture.hostedSession.getRootAgentName(),
        systemPrompt: context.systemPrompt ?? "",
        toolNames: (context.tools ?? []).map((tool) => tool.name),
    });
}

async function initializeGitProject(projectRoot: string): Promise<void> {
    await git(projectRoot, ["init", "-b", "main"]);
    await git(projectRoot, ["config", "user.email", "test@example.com"]);
    await git(projectRoot, ["config", "user.name", "RunWield Test"]);
    await Deno.writeTextFile(`${projectRoot}/README.md`, "fixture\n");
    await git(projectRoot, ["add", "."]);
    await git(projectRoot, ["commit", "-m", "fixture: initial project"]);
}

async function saveExecutablePlan(
    projectRoot: string,
    planName: string,
    attrs: Parameters<typeof savePlan>[3] = {},
): Promise<void> {
    await savePlan(projectRoot, planName, `# ${planName}`, {
        classification: "PLANNED_CHANGE",
        complexity: "MEDIUM",
        summary: planName,
        affectedPaths: ["implemented.txt"],
        status: "ready_for_work",
        executionAgent: "engineer",
        planId: `plan-${crypto.randomUUID()}`,
        ...attrs,
    });
}

const IMPLEMENT_AND_COMPLETE = [
    fauxAssistantMessage(fauxToolCall("write", { path: "implemented.txt", content: "implemented\n" })),
    fauxAssistantMessage(fauxToolCall("task_completed", { message: "- Implemented the Plan.\n- Verified the Plan." })),
];

Deno.test("an engineer-owned Plan runs under Plan Engineer while the Plan keeps saying engineer", async () => {
    await withRuntimeCommandFixture("plan-boundaries-engineer-", async ({ projectRoot, setModelResponseFactories }) => {
        await initializeGitProject(projectRoot);
        await saveExecutablePlan(projectRoot, "backend-feature");
        const fixture = createExecutionFixture(projectRoot);
        setModelResponseFactories(
            IMPLEMENT_AND_COMPLETE.map((message) => (context: Context) => {
                captureTurn(fixture, context);
                return message;
            }),
        );

        try {
            const result = await executePlan({
                planName: "backend-feature",
                triageMeta: { classification: "PLANNED_CHANGE" },
                sessionManager: fixture.sessionManager,
                hostedSession: fixture.hostedSession,
            });

            // The Agent that actually ran, proven by the prompt the model received.
            assertEquals(fixture.turns[0]?.agentName, "plan-engineer");
            assertStringIncludes(fixture.turns[0]?.systemPrompt ?? "", "You are the Plan Engineer");
            assertEquals((fixture.turns[0]?.systemPrompt ?? "").includes("Quick Fix Checklist"), false);
            assertEquals(fixture.turns[0]?.toolNames.includes("task_completed"), true);
            assertEquals(fixture.agentChanges.includes("plan-engineer"), true);
            assertEquals(fixture.agentChanges.includes("engineer"), false);

            // The durable record never learns the runtime identity.
            assertEquals(result.executionContext?.executionAgent, "engineer");
            assertEquals(fixture.hostedSession.getActiveExecutionWorkflow()?.executionAgent, "engineer");
            const persisted = await loadPlan(projectRoot, "backend-feature");
            assertEquals(persisted?.attrs.executionAgent, "engineer");

            // Plan Engineer's task_completed was accepted, not rejected as a wrong owner.
            assertEquals(result.executionComplete, true);
            assertEquals(persisted?.attrs.status, "implemented");
            assertEquals(persisted?.attrs.executionReport, "- Implemented the Plan.\n- Verified the Plan.");
        } finally {
            fixture.hostedSession.dispose();
        }
    });
});

Deno.test("a legacy segment handoff announces Plan Engineer before resuming", async () => {
    await withRuntimeCommandFixture(
        "plan-boundaries-legacy-handoff-",
        async ({ projectRoot, setModelResponseFactories }) => {
            await initializeGitProject(projectRoot);
            await saveExecutablePlan(projectRoot, "legacy-handoff");
            const savedPlan = await loadPlan(projectRoot, "legacy-handoff");
            const planId = savedPlan?.attrs.planId || "plan-legacy-handoff";
            const fixture = createExecutionFixture(projectRoot);
            setModelResponseFactories(
                IMPLEMENT_AND_COMPLETE.map((message) => (context: Context) => {
                    captureTurn(fixture, context);
                    return message;
                }),
            );
            const continuation = {
                ...buildExecutionSegmentContinuation({
                    runwieldSessionId: fixture.hostedSession.id,
                    planId,
                    planName: "legacy-handoff",
                    approvedRevision: "legacy-revision",
                    approvedStatus: "ready_for_work",
                    approvedMarkdown: "# legacy-handoff",
                    preparedEvidence: {
                        planId,
                        planName: "legacy-handoff",
                        revision: "legacy-revision",
                        status: "ready_for_work",
                        worktree: { kind: "none" },
                    },
                    activeWorkflow: {
                        planName: "legacy-handoff",
                        triageMeta: { classification: "PLANNED_CHANGE" },
                        executionAgent: "engineer",
                        collaborationRecommendation: "autonomous",
                        collaborationStyle: "autonomous",
                        executionCwd: projectRoot,
                        executionMode: "non_git_in_place",
                        nonGitInPlace: true,
                        projectRoot,
                    },
                    executionOwner: "plan-engineer",
                    collaborationStyle: "autonomous",
                    collaborationRecommendation: "autonomous",
                }),
                executionOwner: "engineer" as const,
            };

            try {
                const result = await executePreparedPlanSegmentHandoff({
                    continuation,
                    sessionManager: fixture.sessionManager,
                    hostedSession: fixture.hostedSession,
                });

                assertEquals(fixture.statusMessages.includes("launching Plan Engineer to execute..."), true);
                assertEquals(fixture.statusMessages.includes("launching Engineer to execute..."), false);
                assertEquals(fixture.turns[0]?.agentName, "plan-engineer");
                assertEquals(result.executionComplete, true);
            } finally {
                fixture.hostedSession.dispose();
            }
        },
    );
});

Deno.test("a frontend-owned Plan runs under Frontend Engineer", async () => {
    await withRuntimeCommandFixture("plan-boundaries-frontend-", async ({ projectRoot, setModelResponseFactories }) => {
        await initializeGitProject(projectRoot);
        await saveExecutablePlan(projectRoot, "visual-feature", { executionAgent: "frontend-engineer" });
        const fixture = createExecutionFixture(projectRoot);
        setModelResponseFactories(
            IMPLEMENT_AND_COMPLETE.map((message) => (context: Context) => {
                captureTurn(fixture, context);
                return message;
            }),
        );

        try {
            const result = await executePlan({
                planName: "visual-feature",
                triageMeta: { classification: "PLANNED_CHANGE" },
                sessionManager: fixture.sessionManager,
                hostedSession: fixture.hostedSession,
            });

            assertEquals(fixture.turns[0]?.agentName, "frontend-engineer");
            assertStringIncludes(fixture.turns[0]?.systemPrompt ?? "", "You are the Frontend Engineer");
            assertEquals(fixture.agentChanges.includes("plan-engineer"), false);
            assertEquals(result.executionContext?.executionAgent, "frontend-engineer");
            assertEquals((await loadPlan(projectRoot, "visual-feature"))?.attrs.executionAgent, "frontend-engineer");
        } finally {
            fixture.hostedSession.dispose();
        }
    });
});

Deno.test("Plan Engineer reaches a real Pair checkpoint through production dispatch", async () => {
    await withRuntimeCommandFixture("plan-boundaries-pair-", async ({ projectRoot, setModelResponseFactories }) => {
        await initializeGitProject(projectRoot);
        await saveExecutablePlan(projectRoot, "paired-feature", { collaborationRecommendation: "pair" });
        const checkpointRequests: RuntimeInteractionRequest[] = [];
        const fixture = createExecutionFixture(projectRoot, (request) => {
            checkpointRequests.push(request);
            return { outcome: "selected", value: "continue" };
        });
        setModelResponseFactories([
            (context: Context) => {
                captureTurn(fixture, context);
                return fauxAssistantMessage(
                    fauxToolCall("pair_checkpoint", { summary: "Retry policy now drops duplicate writes." }),
                );
            },
            (context: Context) => {
                captureTurn(fixture, context);
                return fauxAssistantMessage(
                    fauxToolCall("task_completed", { message: "- Implemented the Plan.\n- Verified the Plan." }),
                );
            },
        ]);

        try {
            const result = await executePlan({
                planName: "paired-feature",
                triageMeta: { classification: "PLANNED_CHANGE" },
                sessionManager: fixture.sessionManager,
                hostedSession: fixture.hostedSession,
            });

            // Pair is a Plan execution style now, not a Frontend Engineer feature.
            assertEquals(fixture.turns[0]?.agentName, "plan-engineer");
            assertEquals(fixture.turns[0]?.toolNames.includes("pair_checkpoint"), true);
            assertEquals(checkpointRequests.map((request) => request.type), ["pair_checkpoint"]);
            assertEquals(result.executionContext?.collaborationStyle, "pair");
            assertEquals(result.executionContext?.executionAgent, "engineer");
            assertEquals(result.executionComplete, true);
            assertEquals((await loadPlan(projectRoot, "paired-feature"))?.attrs.executionAgent, "engineer");
        } finally {
            fixture.hostedSession.dispose();
        }
    });
});

/** A SessionRuntime over a real SessionHost and coordination store. */
function makeRuntime(sessionHost: SessionHost): SessionRuntime {
    return new SessionRuntime({
        sessionHost,
        sessionStore: openOwnerCoordinationStore(),
        ownerProcessKind: "test",
        ownerInstanceId: crypto.randomUUID(),
    });
}

Deno.test("resuming a session whose persisted workflow owner is engineer activates Plan Engineer", async () => {
    await withRuntimeCommandFixture("plan-boundaries-resume-", async ({ projectRoot, setModelResponseFactory }) => {
        // A Session persisted before the split records `engineer`; no migration
        // runs, so the resolver is the only thing that can put the user back
        // with a Plan executor.
        const sessionHost = new SessionHost();
        const runtime = makeRuntime(sessionHost);
        const sessionId = await runtime.createPromptReadySession({ cwd: projectRoot, agentName: "router" });
        const agentChanges: string[] = [];
        runtime.subscribeSessionEvents(sessionId, (event: { type?: string; agentName?: string }) => {
            if (event.type === RuntimeEventTypes.AGENT_CHANGED && event.agentName) agentChanges.push(event.agentName);
        });
        let promptedSystemPrompt = "";
        setModelResponseFactory((context: Context) => {
            promptedSystemPrompt = context.systemPrompt ?? "";
            return fauxAssistantMessage(fauxText("Continuing the Plan."));
        });

        try {
            await runtime.setActiveExecutionWorkflow(sessionId, {
                planName: "resumed-feature",
                triageMeta: { classification: "PLANNED_CHANGE" },
                executionAgent: "engineer",
                collaborationRecommendation: "autonomous",
                collaborationStyle: "autonomous",
                executionCwd: projectRoot,
            });

            const result = await runtime.promptUserTurn(sessionId, { initialRequest: "continue" });
            assertEquals(result.ok, true);

            assertStringIncludes(promptedSystemPrompt, "You are the Plan Engineer");
            assertEquals(runtime.getSessionSnapshot(sessionId)?.activeAgent, "plan-engineer");
            assertEquals(agentChanges.includes("plan-engineer"), true);
            // The workflow record itself is untouched by the realignment.
            assertEquals(
                sessionHost.requireSession(sessionId).getActiveExecutionWorkflow()?.executionAgent,
                "engineer",
            );
        } finally {
            await runtime.closeAllSessionsWhenIdle?.();
        }
    });
});

Deno.test("a QUICK_FIX workflow resumes under the selectable Engineer, not Plan Engineer", async () => {
    await withRuntimeCommandFixture("plan-boundaries-quickfix-", async ({ projectRoot, setModelResponseFactory }) => {
        // QUICK_FIX also records `executionAgent: engineer`, so only the absence
        // of a Plan tells the two apart.
        const sessionHost = new SessionHost();
        const runtime = makeRuntime(sessionHost);
        const sessionId = await runtime.createPromptReadySession({ cwd: projectRoot, agentName: "router" });
        let promptedSystemPrompt = "";
        setModelResponseFactory((context: Context) => {
            promptedSystemPrompt = context.systemPrompt ?? "";
            return fauxAssistantMessage(fauxText("Continuing the quick fix."));
        });

        try {
            await runtime.setActiveExecutionWorkflow(sessionId, {
                planName: "",
                triageMeta: { classification: "QUICK_FIX" },
                executionAgent: "engineer",
                collaborationRecommendation: "autonomous",
                collaborationStyle: "autonomous",
                executionCwd: projectRoot,
            });

            assertEquals((await runtime.promptUserTurn(sessionId, { initialRequest: "continue" })).ok, true);

            assertStringIncludes(promptedSystemPrompt, "RunWield's full-stack coding helper");
            assert(!promptedSystemPrompt.includes("You are the Plan Engineer"));
            assertEquals(runtime.getSessionSnapshot(sessionId)?.activeAgent, "engineer");
        } finally {
            await runtime.closeAllSessionsWhenIdle?.();
        }
    });
});
