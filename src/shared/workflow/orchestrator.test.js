import { assertEquals } from "@std/assert";
import { dispatchPostTriage, readLatestTriageOutcome } from "./orchestrator.js";

/**
 * @returns {any & { messages: string[] }}
 */
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

Deno.test("dispatchPostTriage restores plan owner when FEATURE/PROJECT execution is incomplete", async () => {
    const source = await Deno.readTextFile(new URL("./orchestrator.js", import.meta.url));
    assertEquals(source.includes('executionDecision.kind === "stay_with_agent"'), true);
    assertEquals(
        source.includes("setActiveAgentImpl(agentName, createAgentHandlerImpl(agentName), uiAPI);"),
        true,
    );
});

Deno.test("dispatchPostTriage routes INQUIRY to Guide without completion or validation checks", async () => {
    const uiAPI = makeUi();
    /** @type {string[]} */
    const activeAgents = [];
    /** @type {string[]} */
    const rootTurns = [];
    let taskCompletedChecked = false;
    let validationCount = 0;

    await dispatchPostTriage({
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
            setActiveAgent: (/** @type {string} */ name) => activeAgents.push(name),
        }),
    });

    assertEquals(activeAgents, ["guide"]);
    assertEquals(rootTurns, ["guide"]);
    assertEquals(taskCompletedChecked, false);
    assertEquals(validationCount, 0);
});

Deno.test("dispatchPostTriage routes IDEATION to Ideator without completion or validation checks", async () => {
    const uiAPI = makeUi();
    /** @type {string[]} */
    const activeAgents = [];
    /** @type {string[]} */
    const rootTurns = [];

    await dispatchPostTriage({
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
            setActiveAgent: (/** @type {string} */ name) => activeAgents.push(name),
        }),
    });

    assertEquals(activeAgents, ["ideator"]);
    assertEquals(rootTurns, ["ideator"]);
});

Deno.test("dispatchPostTriage skips workflow validation for completed QUICK_FIX", async () => {
    const uiAPI = makeUi();
    let validationCount = 0;

    await dispatchPostTriage({
        triage: {
            routingIntent: "QUICK_FIX",
            complexity: "LOW",
            summary: "answer a question",
            affectedPaths: [],
        },
        userRequest: "Where is the router?",
        images: [],
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            applyPendingRootSwap: () => Promise.resolve(),
            createAgentHandler: (/** @type {string} */ name) => () => Promise.resolve(name),
            readLatestTaskCompletedOutcome: () => true,
            runRootTurn: () =>
                Promise.resolve(
                    /** @type {any} */ ([{
                        role: "toolResult",
                        toolName: "task_completed",
                        details: { outcome: "task_completed" },
                    }]),
                ),
            runValidationLoop: () => {
                validationCount++;
                return Promise.resolve();
            },
            setActiveAgent: () => {},
        }),
    });

    assertEquals(validationCount, 0);
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ message) => message.includes("validation is waiting")),
        false,
    );
});

Deno.test("dispatchPostTriage warns when QUICK_FIX stops without task_completed", async () => {
    const uiAPI = makeUi();

    await dispatchPostTriage({
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
            setActiveAgent: () => {},
        }),
    });

    assertEquals(
        uiAPI.messages.some((/** @type {string} */ message) => message.includes("stopped without task_completed")),
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
                setActiveAgent: (/** @type {string} */ name) => activeAgents.push(name),
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

    await dispatchPostTriage({
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
        }),
    });

    assertEquals(executed.length, 1);
    assertEquals(/** @type {any[]} */ (executed[0])[0], "feature-plan");
    assertEquals(validations.length, 1);
    assertEquals(/** @type {any} */ (validations[0]).planContent, "plan markdown");
    assertEquals(/** @type {any} */ (validations[0]).finalAgentName, "planner");
});

Deno.test("dispatchPostTriage restores PROJECT owner after incomplete execution", async () => {
    const uiAPI = makeUi();
    /** @type {string[]} */
    const activeAgents = [];

    await dispatchPostTriage({
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
            decidePostExecution: () => ({ kind: "stay_with_agent", payload: { reason: "execution_incomplete" } }),
            createAgentHandler: (/** @type {string} */ name) => () => Promise.resolve(name),
            setActiveAgent: (/** @type {string} */ name) => activeAgents.push(name),
        }),
    });

    assertEquals(activeAgents, ["architect"]);
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
                affectedPaths: ["b.js"],
            },
        }),
    ];
    assertEquals(readLatestTriageOutcome(messages), {
        routingIntent: "FEATURE",
        classification: "FEATURE",
        complexity: "MEDIUM",
        summary: "second",
        affectedPaths: ["b.js"],
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
