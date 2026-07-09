import { assertEquals } from "@std/assert";
import { dispatchPostTriage, readLatestTriageOutcome } from "./orchestrator.js";
import { HostedSession } from "../session/hosted-session.js";

/**
 * @returns {any & { messages: string[] }}
 */

/**
 * @param {string} [id]
 */
function makeHostedSession(id = `orchestrator-test-${crypto.randomUUID()}`) {
    return new HostedSession({ id, cwd: Deno.cwd() });
}

function makeUi() {
    /** @type {string[]} */
    const messages = [];
    return /** @type {any} */ ({
        messages,
        appendSystemMessage: (/** @type {string} */ msg) => messages.push(String(msg)),
    });
}

Deno.test("dispatchPostTriage does not force Engineer after FEATURE/PROJECT validation", async () => {
    const source = await Deno.readTextFile(new URL("./orchestrator.js", import.meta.url));
    assertEquals(source.includes("setActiveAgent(AGENTS.ENGINEER"), false);
});

Deno.test("dispatchPostTriage keeps Engineer active when FEATURE/PROJECT execution is incomplete", async () => {
    const source = await Deno.readTextFile(new URL("./orchestrator.js", import.meta.url));
    assertEquals(source.includes('executionDecision.kind === "stay_with_agent"'), true);
    assertEquals(source.includes("executionAgentName: AGENTS.ENGINEER"), true);
});

Deno.test("dispatchPostTriage routes INQUIRY to Guide without completion or validation checks", async () => {
    const uiAPI = makeUi();
    /** @type {string[]} */
    const activeAgents = [];
    /** @type {string[]} */
    const rootTurns = [];
    let taskCompletedChecked = false;
    let validationCount = 0;
    /** @type {any[]} */
    const metrics = [];

    await dispatchPostTriage({
        hostedSession: makeHostedSession(),
        triage: {
            routingIntent: "INQUIRY",
            complexity: "LOW",
            summary: "answer a question",
            affectedPaths: ["src/constants.js"],
        },
        userRequest: "Where is model routing configured?",
        images: [],
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            applyPendingRootSwap: () => Promise.resolve(),
            createAgentHandler: (/** @type {string} */ name) => () => Promise.resolve(name),
            readLatestTaskCompletedOutcome: () => {
                taskCompletedChecked = true;
                return null;
            },
            runRootTurn: (/** @type {any} */ args) => {
                rootTurns.push(args.agentName);
                assertEquals(args.userRequest.includes("Routing Intent: INQUIRY"), true);
                return Promise.resolve([]);
            },
            runValidationLoop: () => {
                validationCount++;
                return Promise.resolve();
            },
            recordWorkflowMetric: (/** @type {any} */ metric) => {
                metrics.push(metric);
                return Promise.resolve(null);
            },
            setActiveAgent: (/** @type {unknown} */ _hostedSession, /** @type {string} */ name) =>
                activeAgents.push(name),
        }),
    });

    assertEquals(activeAgents, ["guide"]);
    assertEquals(rootTurns, ["guide"]);
    assertEquals(taskCompletedChecked, false);
    assertEquals(validationCount, 0);
    assertEquals(
        metrics.some((metric) =>
            metric.category === "routing" && metric.event === "dispatch_selected" &&
            metric.agentName === "guide" && metric.details.routingIntent === "INQUIRY"
        ),
        true,
    );
});

Deno.test("dispatchPostTriage routes IDEATION to Ideator without completion or validation checks", async () => {
    const uiAPI = makeUi();
    /** @type {string[]} */
    const activeAgents = [];
    /** @type {string[]} */
    const rootTurns = [];

    await dispatchPostTriage({
        hostedSession: makeHostedSession(),
        triage: {
            routingIntent: "IDEATION",
            complexity: "LOW",
            summary: "grill idea",
            affectedPaths: [],
        },
        userRequest: "grill me on adding a new provider",
        images: [],
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            applyPendingRootSwap: () => Promise.resolve(),
            createAgentHandler: (/** @type {string} */ name) => () => Promise.resolve(name),
            runRootTurn: (/** @type {any} */ args) => {
                rootTurns.push(args.agentName);
                assertEquals(args.userRequest.includes("Routing Intent: IDEATION"), true);
                return Promise.resolve([]);
            },
            runValidationLoop: () => {
                throw new Error("validation should not run");
            },
            setActiveAgent: (/** @type {unknown} */ _hostedSession, /** @type {string} */ name) =>
                activeAgents.push(name),
        }),
    });

    assertEquals(activeAgents, ["ideator"]);
    assertEquals(rootTurns, ["ideator"]);
});

Deno.test("dispatchPostTriage routes OPERATION to Operator without validation", async () => {
    const uiAPI = makeUi();
    /** @type {string[]} */
    const activeAgents = [];
    /** @type {string[]} */
    const rootTurns = [];
    let mechanicalValidationCount = 0;
    /** @type {any[]} */
    const metrics = [];

    await dispatchPostTriage({
        hostedSession: makeHostedSession(),
        triage: {
            routingIntent: "OPERATION",
            complexity: "LOW",
            summary: "show status",
            affectedPaths: [],
        },
        userRequest: "git status",
        images: [],
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            applyPendingRootSwap: () => Promise.resolve(),
            createAgentHandler: (/** @type {string} */ name) => () => Promise.resolve(name),
            readLatestTaskCompletedOutcome: () => true,
            runRootTurn: (/** @type {any} */ args) => {
                rootTurns.push(args.agentName);
                assertEquals(args.userRequest.includes("Routing Intent: OPERATION"), true);
                return Promise.resolve(
                    /** @type {any} */ ([{
                        role: "toolResult",
                        toolName: "task_completed",
                        details: { outcome: "task_completed" },
                    }]),
                );
            },
            runMechanicalValidation: () => {
                mechanicalValidationCount++;
                return Promise.resolve({ passed: true, attempts: 0 });
            },
            recordWorkflowMetric: (/** @type {any} */ metric) => {
                metrics.push(metric);
                return Promise.resolve(null);
            },
            setActiveAgent: (/** @type {unknown} */ _hostedSession, /** @type {string} */ name) =>
                activeAgents.push(name),
        }),
    });

    assertEquals(activeAgents, ["operator"]);
    assertEquals(rootTurns, ["operator"]);
    assertEquals(mechanicalValidationCount, 0);
    assertEquals(
        metrics.some((metric) =>
            metric.category === "execution" && metric.event === "operation_completed_observed" &&
            metric.details.taskCompletedObserved === true
        ),
        true,
    );
});

Deno.test("dispatchPostTriage routes QUICK_FIX to Engineer and runs Mechanical Validation after completion", async () => {
    const uiAPI = makeUi();
    /** @type {string[]} */
    const activeAgents = [];
    /** @type {string[]} */
    const rootTurns = [];
    let mechanicalValidationCount = 0;
    /** @type {any[]} */
    const metrics = [];

    await dispatchPostTriage({
        hostedSession: makeHostedSession(),
        triage: {
            routingIntent: "QUICK_FIX",
            complexity: "LOW",
            summary: "small fix",
            affectedPaths: ["src/a.js"],
        },
        userRequest: "Fix it",
        images: [],
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            applyPendingRootSwap: () => Promise.resolve(),
            createAgentHandler: (/** @type {string} */ name) => () => Promise.resolve(name),
            readLatestTaskCompletedOutcome: () => true,
            runRootTurn: (/** @type {any} */ args) => {
                rootTurns.push(args.agentName);
                assertEquals(args.userRequest.includes("Routing Intent: QUICK_FIX"), true);
                return Promise.resolve(
                    /** @type {any} */ ([{
                        role: "toolResult",
                        toolName: "task_completed",
                        details: { outcome: "task_completed" },
                    }]),
                );
            },
            runMechanicalValidation: () => {
                mechanicalValidationCount++;
                return Promise.resolve({ passed: true, attempts: 0 });
            },
            runValidationLoop: () => {
                throw new Error("saved-plan validation should not run");
            },
            recordWorkflowMetric: (/** @type {any} */ metric) => {
                metrics.push(metric);
                return Promise.resolve(null);
            },
            setActiveAgent: (/** @type {unknown} */ _hostedSession, /** @type {string} */ name) =>
                activeAgents.push(name),
        }),
    });

    assertEquals(activeAgents, ["engineer"]);
    assertEquals(rootTurns, ["engineer"]);
    assertEquals(mechanicalValidationCount, 1);
    assertEquals(
        metrics.some((metric) =>
            metric.category === "execution" && metric.event === "quick_fix_completed_observed" &&
            metric.details.taskCompletedObserved === true && metric.details.mechanicalValidationRan === true
        ),
        true,
    );
});

Deno.test("dispatchPostTriage prompts before QUICK_FIX in non-Git projects", async () => {
    const uiAPI = makeUi();
    /** @type {string[]} */
    const prompts = [];
    uiAPI.promptSelect = (/** @type {string} */ prompt) => {
        prompts.push(prompt);
        return Promise.resolve("proceed");
    };
    /** @type {string[]} */
    const rootTurns = [];

    await dispatchPostTriage({
        hostedSession: makeHostedSession(),
        triage: {
            routingIntent: "QUICK_FIX",
            complexity: "LOW",
            summary: "small fix",
            affectedPaths: ["src/a.js"],
        },
        userRequest: "Fix it",
        images: [],
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            applyPendingRootSwap: () => Promise.resolve(),
            createAgentHandler: (/** @type {string} */ name) => () => Promise.resolve(name),
            probeGitRepository: () => Promise.resolve({ ok: false, state: "not_git", cwd: Deno.cwd() }),
            hasNonGitExecutionConsent: () => false,
            confirmNonGitQuickFixExecution: async (/** @type {any} */ ui) => {
                await ui.promptSelect("quick fix non git prompt", []);
                return true;
            },
            readLatestTaskCompletedOutcome: () => true,
            runRootTurn: (/** @type {any} */ args) => {
                rootTurns.push(args.agentName);
                return Promise.resolve(/** @type {any} */ ([{ toolName: "task_completed" }]));
            },
            runMechanicalValidation: () => Promise.resolve({ passed: true, attempts: 0 }),
            recordWorkflowMetric: () => Promise.resolve(null),
            setActiveAgent: () => {},
        }),
    });

    assertEquals(prompts, ["quick fix non git prompt"]);
    assertEquals(rootTurns, ["engineer"]);
});

Deno.test("dispatchPostTriage cancels QUICK_FIX before Engineer when non-Git consent is declined", async () => {
    const uiAPI = makeUi();
    let rootTurns = 0;
    let validationCount = 0;

    await dispatchPostTriage({
        hostedSession: makeHostedSession(),
        triage: {
            routingIntent: "QUICK_FIX",
            complexity: "LOW",
            summary: "small fix",
            affectedPaths: ["src/a.js"],
        },
        userRequest: "Fix it",
        images: [],
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            applyPendingRootSwap: () => Promise.resolve(),
            createAgentHandler: (/** @type {string} */ name) => () => Promise.resolve(name),
            probeGitRepository: () => Promise.resolve({ ok: false, state: "not_git", cwd: Deno.cwd() }),
            hasNonGitExecutionConsent: () => false,
            confirmNonGitQuickFixExecution: () => Promise.resolve(false),
            runRootTurn: () => {
                rootTurns++;
                return Promise.resolve([]);
            },
            runMechanicalValidation: () => {
                validationCount++;
                return Promise.resolve({ passed: true, attempts: 0 });
            },
            recordWorkflowMetric: () => Promise.resolve(null),
            setActiveAgent: () => {},
        }),
    });

    assertEquals(rootTurns, 0);
    assertEquals(validationCount, 0);
    assertEquals(uiAPI.messages.some((/** @type {string} */ message) => message.includes("QUICK_FIX canceled")), true);
});

Deno.test("dispatchPostTriage warns and skips Mechanical Validation when QUICK_FIX stops without task_completed", async () => {
    const uiAPI = makeUi();
    let mechanicalValidationCount = 0;

    await dispatchPostTriage({
        hostedSession: makeHostedSession(),
        triage: {
            routingIntent: "QUICK_FIX",
            complexity: "LOW",
            summary: "small fix",
            affectedPaths: ["src/a.js"],
        },
        userRequest: "Fix it",
        images: [],
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            applyPendingRootSwap: () => Promise.resolve(),
            createAgentHandler: (/** @type {string} */ name) => () => Promise.resolve(name),
            readLatestTaskCompletedOutcome: () => null,
            runRootTurn: () => Promise.resolve([]),
            runMechanicalValidation: () => {
                mechanicalValidationCount++;
                return Promise.resolve({ passed: true, attempts: 0 });
            },
            setActiveAgent: () => {},
        }),
    });

    assertEquals(mechanicalValidationCount, 0);
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ message) => message.includes("Mechanical Validation will not run")),
        true,
    );
});

Deno.test("dispatchPostTriage keeps planning agent active on stay/save/halt decisions", async () => {
    const cases = [
        { decision: { kind: "stay_with_agent", payload: { reason: "feedback" } }, expectedMessage: null },
        { decision: { kind: "save_plan", payload: { planName: "saved" } }, expectedMessage: null },
        { decision: { kind: "halt", payload: { reason: "unknown_plan_outcome" } }, expectedMessage: "Workflow halted" },
    ];

    for (const item of cases) {
        const uiAPI = makeUi();
        /** @type {string[]} */
        const activeAgents = [];
        let popped = false;

        await dispatchPostTriage({
            hostedSession: makeHostedSession(),
            triage: {
                routingIntent: "FEATURE",
                classification: "FEATURE",
                complexity: "MEDIUM",
                summary: "plan it",
                affectedPaths: ["src/a.js"],
            },
            userRequest: "Build it",
            images: [],
            uiAPI,
            sessionManager: undefined,
            __deps: /** @type {any} */ ({
                ensurePlansDir: () => Promise.resolve("/plans"),
                runPlanningAgent: () => Promise.resolve({ outcome: "feedback" }),
                consumePendingSwitchHandoff: () => null,
                decidePostPlanning: () => item.decision,
                createAgentHandler: (/** @type {string} */ name) => () => Promise.resolve(name),
                setActiveAgent: (/** @type {unknown} */ _hostedSession, /** @type {string} */ name) =>
                    activeAgents.push(name),
                getConfiguredAgentModel: () => "test/model",
                pushAgentInfo: () => {},
                popAgentInfo: () => {
                    popped = true;
                },
            }),
        });

        assertEquals(activeAgents, ["planner"]);
        assertEquals(popped, false);
        if (item.expectedMessage) {
            assertEquals(
                uiAPI.messages.some((/** @type {string} */ message) => message.includes(item.expectedMessage)),
                true,
            );
        }
    }
});

Deno.test("dispatchPostTriage executes approved FEATURE plans and runs validation", async () => {
    const uiAPI = makeUi();
    /** @type {unknown[]} */
    const executed = [];
    /** @type {unknown[]} */
    const validations = [];
    /** @type {any[]} */
    const metrics = [];

    await dispatchPostTriage({
        hostedSession: makeHostedSession(),
        triage: {
            routingIntent: "FEATURE",
            classification: "FEATURE",
            complexity: "MEDIUM",
            summary: "feature",
            affectedPaths: ["src/feature.js"],
        },
        userRequest: "Make feature",
        images: [{ base64: "abc", mimeType: "image/png" }],
        uiAPI,
        sessionManager: /** @type {any} */ ({ id: "session" }),
        __deps: /** @type {any} */ ({
            ensurePlansDir: () => Promise.resolve("/plans"),
            runPlanningAgent: (/** @type {any} */ args) => {
                assertEquals(args.agentName, "planner");
                assertEquals(args.triageMeta.classification, "FEATURE");
                return Promise.resolve({ outcome: "approved_execute", planName: "feature-plan" });
            },
            consumePendingSwitchHandoff: () => null,
            decidePostPlanning: () => ({
                kind: "execute_plan",
                payload: {
                    planName: "feature-plan",
                    triageMeta: { routingIntent: "FEATURE", classification: "FEATURE", summary: "feature" },
                    tasks: [{ task: 1 }],
                },
            }),
            executePlan: (/** @type {any[]} */ ...args) => {
                executed.push(args);
                return Promise.resolve({ executionComplete: true });
            },
            decidePostExecution: () => ({ kind: "run_validation", payload: {} }),
            loadPlan: () => Promise.resolve(/** @type {any} */ ({ markdown: "plan markdown" })),
            shouldRunWorkflowValidation: () => true,
            runValidationLoop: (/** @type {any} */ args) => {
                validations.push(args);
                return Promise.resolve();
            },
            recordWorkflowMetric: (/** @type {any} */ metric) => {
                metrics.push(metric);
                return Promise.resolve(null);
            },
        }),
    });

    assertEquals(executed.length, 1);
    assertEquals(/** @type {any[]} */ (executed[0])[0], "feature-plan");
    assertEquals(validations.length, 1);
    assertEquals(/** @type {any} */ (validations[0]).planContent, "plan markdown");
    assertEquals(/** @type {any} */ (validations[0]).finalAgentName, "planner");
    assertEquals(typeof /** @type {any[]} */ (executed[0])[5].recordWorkflowMetric, "function");
    assertEquals(typeof /** @type {any} */ (validations[0]).__deps.recordWorkflowMetric, "function");
    assertEquals(
        metrics.some((metric) =>
            metric.category === "execution" && metric.event === "feature_project_outcome" &&
            metric.details.outcome === "validation_completed"
        ),
        true,
    );
});

Deno.test("dispatchPostTriage keeps Engineer active after incomplete PROJECT execution", async () => {
    const uiAPI = makeUi();
    /** @type {string[]} */
    const activeAgents = [];

    await dispatchPostTriage({
        hostedSession: makeHostedSession(),
        triage: {
            routingIntent: "PROJECT",
            classification: "PROJECT",
            complexity: "HIGH",
            summary: "project",
            affectedPaths: ["src/project.js"],
        },
        userRequest: "Project",
        images: [],
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            ensurePlansDir: () => Promise.resolve("/plans"),
            runPlanningAgent: (/** @type {any} */ args) => {
                assertEquals(args.agentName, "architect");
                return Promise.resolve({ outcome: "approved_execute", planName: "project-plan" });
            },
            consumePendingSwitchHandoff: () => null,
            decidePostPlanning: () => ({
                kind: "execute_plan",
                payload: {
                    planName: "project-plan",
                    triageMeta: { routingIntent: "PROJECT", classification: "PROJECT" },
                },
            }),
            executePlan: () => Promise.resolve({ executionComplete: false }),
            decidePostExecution: (/** @type {any} */ _result, /** @type {any} */ context) => ({
                kind: "stay_with_agent",
                payload: { agentName: context.executionAgentName, reason: "execution_incomplete" },
            }),
            createAgentHandler: (/** @type {string} */ name) => () => Promise.resolve(name),
            setActiveAgent: (/** @type {unknown} */ _hostedSession, /** @type {string} */ name) =>
                activeAgents.push(name),
        }),
    });

    assertEquals(activeAgents, ["engineer"]);
});

Deno.test("dispatchPostTriage keeps Engineer active after incomplete FEATURE execution", async () => {
    const uiAPI = makeUi();
    /** @type {string[]} */
    const activeAgents = [];

    await dispatchPostTriage({
        hostedSession: makeHostedSession(),
        triage: {
            routingIntent: "FEATURE",
            classification: "FEATURE",
            complexity: "MEDIUM",
            summary: "feature",
            affectedPaths: ["src/feature.js"],
        },
        userRequest: "Feature",
        images: [],
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            ensurePlansDir: () => Promise.resolve("/plans"),
            runPlanningAgent: () => Promise.resolve({ outcome: "approved_execute", planName: "feature-plan" }),
            consumePendingSwitchHandoff: () => null,
            decidePostPlanning: () => ({
                kind: "execute_plan",
                payload: {
                    planName: "feature-plan",
                    triageMeta: { routingIntent: "FEATURE", classification: "FEATURE" },
                },
            }),
            executePlan: () => Promise.resolve({ executionComplete: false }),
            decidePostExecution: (/** @type {any} */ _result, /** @type {any} */ context) => ({
                kind: "stay_with_agent",
                payload: { agentName: context.executionAgentName, reason: "execution_incomplete" },
            }),
            createAgentHandler: (/** @type {string} */ name) => () => Promise.resolve(name),
            setActiveAgent: (/** @type {unknown} */ _hostedSession, /** @type {string} */ name) =>
                activeAgents.push(name),
        }),
    });

    assertEquals(activeAgents, ["engineer"]);
});

Deno.test("dispatchPostTriage drains execution handoffs from the supplied HostedSession", async () => {
    const uiAPI = makeUi();
    const target = makeHostedSession("target-execution-drain");
    const other = makeHostedSession("other-execution-drain");
    other.setPendingSwitchHandoff({ agentName: "router", reason: "other queued handoff" });

    await dispatchPostTriage({
        hostedSession: target,
        triage: {
            routingIntent: "FEATURE",
            classification: "FEATURE",
            complexity: "MEDIUM",
            summary: "feature",
            affectedPaths: ["src/feature.js"],
        },
        userRequest: "Feature",
        images: [],
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            ensurePlansDir: () => Promise.resolve("/plans"),
            runPlanningAgent: () => Promise.resolve({ outcome: "approved_execute", planName: "feature-plan" }),
            decidePostPlanning: () => ({
                kind: "execute_plan",
                payload: {
                    planName: "feature-plan",
                    triageMeta: { routingIntent: "FEATURE", classification: "FEATURE" },
                },
            }),
            executePlan: () => {
                target.setPendingSwitchHandoff({ agentName: "router", reason: "execution queued handoff" });
                return Promise.resolve({ executionComplete: false });
            },
            decidePostExecution: (/** @type {any} */ _result, /** @type {any} */ context) => ({
                kind: "stay_with_agent",
                payload: { agentName: context.executionAgentName, reason: "execution_incomplete" },
            }),
            createAgentHandler: (/** @type {string} */ name) => () => Promise.resolve(name),
            setActiveAgent: () => {},
        }),
    });

    assertEquals(target.consumePendingSwitchHandoff(), null);
    assertEquals(other.consumePendingSwitchHandoff()?.reason, "other queued handoff");
});

Deno.test("dispatchPostTriage auto-names unnamed sessions and mirrors title", async () => {
    const uiAPI = makeUi();
    /** @type {string[]} */
    const infos = [];
    /** @type {string[]} */
    const titles = [];

    await dispatchPostTriage({
        hostedSession: makeHostedSession(),
        triage: {
            routingIntent: "INQUIRY",
            complexity: "LOW",
            summary: "question",
            sessionName: "terminal titles",
            affectedPaths: [],
        },
        userRequest: "How should titles work?",
        images: [],
        uiAPI,
        sessionManager: /** @type {any} */ ({
            getSessionName: () => undefined,
            appendSessionInfo: (/** @type {string} */ name) => infos.push(name),
        }),
        __deps: /** @type {any} */ ({
            applyPendingRootSwap: () => Promise.resolve(),
            createAgentHandler: (/** @type {string} */ name) => () => Promise.resolve(name),
            runRootTurn: () => Promise.resolve([]),
            setActiveAgent: () => {},
            setTerminalTitleForName: (/** @type {string} */ name) => {
                titles.push(name);
                return `wld - ${name}`;
            },
        }),
    });

    assertEquals(infos, ["terminal titles"]);
    assertEquals(titles, ["terminal titles"]);
});

Deno.test("dispatchPostTriage does not overwrite existing session names", async () => {
    const uiAPI = makeUi();
    /** @type {string[]} */
    const infos = [];
    /** @type {string[]} */
    const titles = [];

    await dispatchPostTriage({
        hostedSession: makeHostedSession(),
        triage: {
            routingIntent: "INQUIRY",
            complexity: "LOW",
            summary: "question",
            sessionName: "router name",
            affectedPaths: [],
        },
        userRequest: "How should titles work?",
        images: [],
        uiAPI,
        sessionManager: /** @type {any} */ ({
            getSessionName: () => "manual name",
            appendSessionInfo: (/** @type {string} */ name) => infos.push(name),
        }),
        __deps: /** @type {any} */ ({
            applyPendingRootSwap: () => Promise.resolve(),
            createAgentHandler: (/** @type {string} */ name) => () => Promise.resolve(name),
            runRootTurn: () => Promise.resolve([]),
            setActiveAgent: () => {},
            setTerminalTitleForName: (/** @type {string} */ name) => {
                titles.push(name);
                return `wld - ${name}`;
            },
        }),
    });

    assertEquals(infos, []);
    assertEquals(titles, ["manual name"]);
});

Deno.test("readLatestTriageOutcome returns the latest triage_report details", () => {
    const messages = [
        /** @type {any} */ ({
            role: "toolResult",
            toolName: "triage_report",
            details: {
                routingIntent: "QUICK_FIX",
                complexity: "LOW",
                summary: "first",
                affectedPaths: ["a.js"],
            },
        }),
        /** @type {any} */ ({
            role: "toolResult",
            toolName: "triage_report",
            details: {
                routingIntent: "FEATURE",
                classification: "FEATURE",
                complexity: "MEDIUM",
                summary: "second",
                sessionName: "second feature",
                affectedPaths: ["b.js"],
            },
        }),
    ];
    assertEquals(readLatestTriageOutcome(messages), {
        routingIntent: "FEATURE",
        classification: "FEATURE",
        complexity: "MEDIUM",
        summary: "second",
        sessionName: "second feature",
        affectedPaths: ["b.js"],
    });
});

Deno.test("readLatestTriageOutcome accepts OPERATION without plan classification", () => {
    const messages = [
        /** @type {any} */ ({
            role: "toolResult",
            toolName: "triage_report",
            details: {
                routingIntent: "OPERATION",
                classification: "OPERATION",
                complexity: "LOW",
                summary: "show status",
                affectedPaths: [],
            },
        }),
    ];
    assertEquals(readLatestTriageOutcome(messages), {
        routingIntent: "OPERATION",
        complexity: "LOW",
        summary: "show status",
        affectedPaths: [],
    });
});

Deno.test("readLatestTriageOutcome ignores stale triage_report before fromIndex", () => {
    const messages = [
        /** @type {any} */ ({
            role: "toolResult",
            toolName: "triage_report",
            details: {
                routingIntent: "FEATURE",
                classification: "FEATURE",
                complexity: "MEDIUM",
                summary: "old",
                affectedPaths: ["old.js"],
            },
        }),
        /** @type {any} */ ({
            role: "assistant",
            content: "no tool this turn",
        }),
    ];

    assertEquals(readLatestTriageOutcome(messages, 1), null);
});

Deno.test("readLatestTriageOutcome returns null when no triage_report tool result", () => {
    assertEquals(readLatestTriageOutcome([]), null);
});

Deno.test("readLatestTriageOutcome normalizes legacy classification details", () => {
    const messages = [
        /** @type {any} */ ({
            role: "toolResult",
            toolName: "triage_report",
            details: {
                classification: "QUICK_FIX",
                complexity: "LOW",
                summary: "legacy",
                affectedPaths: ["a.js"],
            },
        }),
    ];
    assertEquals(readLatestTriageOutcome(messages), {
        routingIntent: "QUICK_FIX",
        complexity: "LOW",
        summary: "legacy",
        affectedPaths: ["a.js"],
    });
});

Deno.test("readLatestTriageOutcome ignores tool results without routingIntent or classification", () => {
    const messages = [
        /** @type {any} */ ({
            role: "toolResult",
            toolName: "triage_report",
            details: { something: "else" },
        }),
    ];
    assertEquals(readLatestTriageOutcome(messages), null);
});

Deno.test("dispatchPostTriage switches and runs only the supplied HostedSession", async () => {
    const target = makeHostedSession("target-orchestrator-session");
    const other = makeHostedSession("other-orchestrator-session");
    other.setPendingRootSwap({ agentName: "engineer", displayName: "Engineer" });
    other.setPendingSwitchHandoff({ agentName: "router", reason: "other queued handoff" });
    /** @type {unknown[]} */
    const switchedSessions = [];
    /** @type {unknown[]} */
    const swapSessions = [];
    /** @type {unknown[]} */
    const rootTurnSessions = [];

    await dispatchPostTriage({
        hostedSession: target,
        triage: {
            routingIntent: "INQUIRY",
            complexity: "LOW",
            summary: "answer a scoped question",
            affectedPaths: [],
        },
        userRequest: "question",
        images: [],
        uiAPI: makeUi(),
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            createAgentHandler: (/** @type {string} */ name) => () => Promise.resolve(name),
            setActiveAgent: (/** @type {unknown} */ hostedSession) => switchedSessions.push(hostedSession),
            applyPendingRootSwap: (/** @type {unknown} */ hostedSession) => {
                swapSessions.push(hostedSession);
                return Promise.resolve();
            },
            runRootTurn: (/** @type {any} */ args) => {
                rootTurnSessions.push(args.hostedSession);
                return Promise.resolve([]);
            },
        }),
    });

    assertEquals(switchedSessions, [target]);
    assertEquals(swapSessions, [target]);
    assertEquals(rootTurnSessions, [target]);
    assertEquals(other.getPendingRootSwap()?.agentName, "engineer");
    assertEquals(other.consumePendingSwitchHandoff()?.reason, "other queued handoff");
});
