import { assertEquals, assertStringIncludes } from "@std/assert";
import { loadReviewerPrompt, runLocalCI, runMechanicalValidation, runValidationLoop } from "./validation.js";
import { HostedSession } from "../session/hosted-session.js";
import { __resetSettingsForTests } from "../settings.js";

const hostedSession = new HostedSession({ id: "validation-test" });

/**
 * @returns {any & { messages: string[], systemCalls: Array<{ message: string, isError: boolean, header: string, style: any }>, promptSelections: string[], busyStates: boolean[], toolCalls: Array<{ id: string, name: string, args: string }>, toolOutputs: string[], toolResults: Array<{ id: string, name: string, result: string, isError: boolean, durationMs: number }> }}
 */
function makeUi() {
    /** @type {string[]} */
    const messages = [];
    /** @type {Array<{ message: string, isError: boolean, header: string, style: any }>} */
    const systemCalls = [];
    /** @type {string[]} */
    const promptSelections = [];
    /** @type {boolean[]} */
    const busyStates = [];
    /** @type {Array<{ id: string, name: string, args: string }>} */
    const toolCalls = [];
    /** @type {string[]} */
    const toolOutputs = [];
    /** @type {Array<{ id: string, name: string, result: string, isError: boolean, durationMs: number }>} */
    const toolResults = [];
    return /** @type {any} */ ({
        messages,
        systemCalls,
        promptSelections,
        busyStates,
        toolCalls,
        toolOutputs,
        toolResults,
        appendSystemMessage: (
            /** @type {string} */ msg,
            /** @type {boolean} */ isError = false,
            /** @type {string} */ header = "",
            /** @type {any} */ style = {},
        ) => {
            messages.push(String(msg));
            systemCalls.push({ message: String(msg), isError, header, style });
        },
        promptSelect: () => {
            promptSelections.push("prompted");
            return Promise.resolve("stop");
        },
        promptText: () => Promise.resolve("deno task test"),
        setBusy: (/** @type {boolean} */ busy) => busyStates.push(busy),
        startToolExecution: (/** @type {string} */ id, /** @type {string} */ name, /** @type {string} */ args) => {
            toolCalls.push({ id, name, args });
            return {
                appendOutput: (/** @type {string} */ text) => toolOutputs.push(text),
                endExecution: (/** @type {boolean} */ isError, /** @type {number} */ durationMs) => {
                    toolResults.push({ id, name, result: "", isError, durationMs });
                },
                bodyText: "",
                startTime: Date.now(),
            };
        },
        addToolInvoked: (/** @type {{ id: string, name: string, input: { command?: string } }} */ event) => {
            toolCalls.push({ id: event.id, name: event.name, args: event.input.command || "" });
        },
        addToolResult: (
            /** @type {{ id: string, name: string, result: string, isError: boolean, durationMs: number }} */ event,
        ) => {
            toolResults.push(event);
        },
    });
}

function noOpRecordPlanEvent() {
    return Promise.resolve({});
}

Deno.test("loadReviewerPrompt returns a bare tool-free prompt", async () => {
    /** @type {string[]} */
    const readPaths = [];
    const reviewerDef = await loadReviewerPrompt(
        (path) => {
            readPaths.push(path);
            return Promise.resolve([
                "---",
                "name: Reviewer",
                'description: "Review prompt"',
                "tools: []",
                "---",
                "",
                "Review only the supplied plan and diff.",
                "",
            ].join("\n"));
        },
        (relativePath) => Promise.resolve(`/tmp/bundled-agent-definitions/${relativePath}`),
    );

    assertEquals(readPaths, ["/tmp/bundled-agent-definitions/workflow-prompts/reviewer-prompt.md"]);
    assertEquals(reviewerDef.name, "reviewer");
    assertEquals(reviewerDef.displayName, "Reviewer");
    assertEquals(reviewerDef.tools, []);
    assertEquals(reviewerDef.systemPrompt, "Review only the supplied plan and diff.");
    assertEquals(reviewerDef.systemPrompt.includes("{{SKILLS}}"), false);
    assertEquals(reviewerDef.systemPrompt.includes("Available tools"), false);
});

Deno.test("bundled reviewer prompt permits unrelated formatter-only changes", async () => {
    const prompt = await Deno.readTextFile(
        new URL("../../agent-definitions/workflow-prompts/reviewer-prompt.md", import.meta.url),
    );

    assertStringIncludes(prompt, "Ignore unrelated formatter-only changes");
    assertStringIncludes(prompt, "Do not fail a review merely because the diff touches files the plan did not mention");
});

Deno.test("runLocalCI displays validation command as a TUI tool call", async () => {
    const originalCwd = Deno.cwd();
    const tempDir = await Deno.makeTempDir({ prefix: "runwield-validation-test-" });
    const uiAPI = makeUi();

    try {
        Deno.chdir(tempDir);
        __resetSettingsForTests();
        uiAPI.promptText = () => Promise.resolve("printf validation-output");

        const result = await runLocalCI(uiAPI, tempDir);

        assertEquals(result.exitCode, 0);
        assertEquals(
            uiAPI.toolCalls.some((/** @type {{ name: string, args: string }} */ call) =>
                call.name === "$" && call.args === "printf validation-output"
            ),
            true,
        );
        assertEquals(
            uiAPI.toolOutputs.some((/** @type {string} */ output) => output.includes("validation-output")),
            true,
        );
        assertEquals(uiAPI.toolResults.some((/** @type {{ isError: boolean }} */ result) => !result.isError), true);
    } finally {
        Deno.chdir(originalCwd);
        __resetSettingsForTests();
        await Deno.remove(tempDir, { recursive: true });
    }
});

Deno.test("runLocalCI streams large validation output without failing the process buffer", async () => {
    const originalCwd = Deno.cwd();
    const tempDir = await Deno.makeTempDir({ prefix: "runwield-validation-large-output-test-" });
    const uiAPI = makeUi();

    try {
        Deno.chdir(tempDir);
        __resetSettingsForTests();
        const command = `${Deno.execPath()} eval "console.log('x'.repeat(1200000)); console.error('tail-marker')"`;
        uiAPI.promptText = () => Promise.resolve(command);

        const result = await runLocalCI(uiAPI, tempDir);

        assertEquals(result.exitCode, 0);
        assertStringIncludes(result.output, "tail-marker");
        assertStringIncludes(result.output, "stdout truncated; showing last");
        assertEquals(uiAPI.toolResults.some((/** @type {{ isError: boolean }} */ result) => !result.isError), true);
    } finally {
        Deno.chdir(originalCwd);
        __resetSettingsForTests();
        await Deno.remove(tempDir, { recursive: true });
    }
});

Deno.test("runMechanicalValidation passes local CI without plan-specific work", async () => {
    const uiAPI = makeUi();
    /** @type {string[]} */
    const actions = [];
    /** @type {any[]} */
    const metrics = [];

    const result = await runMechanicalValidation({
        hostedSession,
        uiAPI,
        sessionManager: undefined,
        cwd: "/repo",
        __deps: /** @type {any} */ ({
            runLocalCI: (/** @type {any} */ _uiAPI, /** @type {string | undefined} */ cwd) => {
                actions.push(`ci:${cwd}`);
                return Promise.resolve({ exitCode: 0, output: "ok" });
            },
            runAgentSession: () => {
                throw new Error("repair should not run");
            },
            setActiveAgent: (/** @type {unknown} */ _hostedSession, /** @type {string} */ name) =>
                actions.push(`active:${name}`),
            createAgentHandler: (/** @type {string} */ name) => () => Promise.resolve(name),
            recordWorkflowMetric: (/** @type {any} */ metric) => {
                metrics.push(metric);
                return Promise.resolve(null);
            },
        }),
    });

    assertEquals(result, { passed: true, attempts: 0 });
    assertEquals(actions, ["ci:/repo", "active:engineer"]);
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ m) => m.includes("QUICK_FIX Mechanical Validation passed")),
        true,
    );
    assertEquals(metrics.map((metric) => metric.event), [
        "mechanical_validation_started",
        "mechanical_ci_attempt",
        "mechanical_validation_finished",
    ]);
});

Deno.test("runMechanicalValidation repairs CI failures through Engineer and then passes", async () => {
    const uiAPI = makeUi();
    /** @type {string[]} */
    const actions = [];
    let ciRuns = 0;

    const result = await runMechanicalValidation({
        hostedSession,
        uiAPI,
        sessionManager: /** @type {any} */ ({ id: "session" }),
        cwd: "/repo",
        __deps: /** @type {any} */ ({
            runLocalCI: () => {
                ciRuns++;
                actions.push(`ci:${ciRuns}`);
                return Promise.resolve(ciRuns === 1 ? { exitCode: 1, output: "boom" } : { exitCode: 0, output: "" });
            },
            runAgentSession: (/** @type {any} */ opts) => {
                actions.push(`repair:${opts.agentName}:${opts.cwd}:${opts.userRequest.includes("boom")}`);
                return Promise.resolve([]);
            },
            readLatestTaskCompletedOutcome: () => true,
            setActiveAgent: (/** @type {unknown} */ _hostedSession, /** @type {string} */ name) =>
                actions.push(`active:${name}`),
            createAgentHandler: (/** @type {string} */ name) => () => Promise.resolve(name),
        }),
    });

    assertEquals(result, { passed: true, attempts: 1 });
    assertEquals(actions, ["ci:1", "repair:engineer:/repo:true", "ci:2", "active:engineer"]);
});

Deno.test("runMechanicalValidation ignores stale task_completed from earlier root turns", async () => {
    const uiAPI = makeUi();
    const staleHostedSession = new HostedSession({ id: "stale-task-completed-test" });
    staleHostedSession.setRootAgentName("engineer");
    staleHostedSession.setRootAgentSession(
        /** @type {any} */ ({
            agent: {
                state: {
                    messages: [{
                        role: "toolResult",
                        toolName: "task_completed",
                        details: { outcome: "task_completed" },
                    }],
                },
            },
        }),
    );
    /** @type {number[]} */
    const fromIndexes = [];

    const result = await runMechanicalValidation({
        hostedSession: staleHostedSession,
        uiAPI,
        sessionManager: undefined,
        cwd: "/repo",
        __deps: /** @type {any} */ ({
            runLocalCI: () => Promise.resolve({ exitCode: 1, output: "boom" }),
            runAgentSession: () =>
                Promise.resolve(
                    /** @type {any} */ ([
                        {
                            role: "toolResult",
                            toolName: "task_completed",
                            details: { outcome: "task_completed" },
                        },
                        { role: "assistant", content: [{ type: "text", text: "cancelled" }] },
                    ]),
                ),
            readLatestTaskCompletedOutcome: (/** @type {any[]} */ messages, /** @type {number} */ fromIndex) => {
                fromIndexes.push(fromIndex);
                return messages.slice(fromIndex).some((message) => message.toolName === "task_completed");
            },
            setActiveAgent: () => {},
            createAgentHandler: (/** @type {string} */ name) => () => Promise.resolve(name),
        }),
    });

    assertEquals(result.passed, false);
    assertEquals(result.reason, "Engineer stopped without task_completed during QUICK_FIX repair.");
    assertEquals(fromIndexes, [1]);
});

Deno.test("runMechanicalValidation detects task_completed when repair returns a fresh root transcript", async () => {
    const uiAPI = makeUi();
    const rebuiltHostedSession = new HostedSession({ id: "fresh-root-task-completed-test" });
    rebuiltHostedSession.setRootAgentName("engineer");
    rebuiltHostedSession.setRootAgentSession(
        /** @type {any} */ ({
            agent: {
                state: {
                    messages: [
                        { role: "user", content: [{ type: "text", text: "old" }] },
                        { role: "assistant", content: [{ type: "text", text: "old" }] },
                        {
                            role: "toolResult",
                            toolName: "task_completed",
                            details: { outcome: "task_completed" },
                        },
                    ],
                },
            },
        }),
    );
    let ciRuns = 0;

    const result = await runMechanicalValidation({
        hostedSession: rebuiltHostedSession,
        uiAPI,
        sessionManager: undefined,
        cwd: "/repo",
        __deps: /** @type {any} */ ({
            runLocalCI: () => {
                ciRuns++;
                return Promise.resolve(ciRuns === 1 ? { exitCode: 1, output: "boom" } : { exitCode: 0, output: "" });
            },
            runAgentSession: () =>
                Promise.resolve(
                    /** @type {any} */ ([{
                        role: "toolResult",
                        toolName: "task_completed",
                        details: { outcome: "task_completed" },
                    }]),
                ),
            setActiveAgent: () => {},
            createAgentHandler: (/** @type {string} */ name) => () => Promise.resolve(name),
        }),
    });

    assertEquals(result, { passed: true, attempts: 1 });
});

Deno.test("runMechanicalValidation stops after three Engineer repair attempts without Plan side effects", async () => {
    const uiAPI = makeUi();
    let repairCalls = 0;

    const result = await runMechanicalValidation({
        hostedSession,
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            runLocalCI: () => Promise.resolve({ exitCode: 1, output: "still broken" }),
            runAgentSession: () => {
                repairCalls++;
                return Promise.resolve([]);
            },
            readLatestTaskCompletedOutcome: () => true,
            setActiveAgent: () => {},
            createAgentHandler: (/** @type {string} */ name) => () => Promise.resolve(name),
            recordPlanEvent: () => {
                throw new Error("plan events should not run");
            },
            runPlannotatorCodeReview: () => {
                throw new Error("code review should not run");
            },
        }),
    });

    assertEquals(result.passed, false);
    assertEquals(result.attempts, 3);
    assertEquals(repairCalls, 3);
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ m) => m.includes("failed after 3 Engineer repair attempts")),
        true,
    );
});

Deno.test("runValidationLoop does not switch active agent unless finalAgentName is provided", async () => {
    const uiAPI = makeUi();
    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "",
        triageMeta: { classification: "QUICK_FIX" },
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve(""),
            recordPlanEvent: noOpRecordPlanEvent,
            setActiveAgent: () => {
                throw new Error("should not switch agent");
            },
        }),
    });

    assertEquals(
        uiAPI.messages.some((/** @type {string} */ m) => m.includes("execution and validation complete")),
        true,
    );
});

Deno.test("runValidationLoop marks validation progress and success messages with status styling", async () => {
    const uiAPI = makeUi();
    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "",
        triageMeta: { classification: "QUICK_FIX" },
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve(""),
            recordPlanEvent: noOpRecordPlanEvent,
            setActiveAgent: () => {},
        }),
    });

    assertEquals(
        uiAPI.systemCalls.some((/** @type {{ message: string }} */ call) =>
            call.message.includes("Running CI Validation (Attempt 1/3)...")
        ),
        true,
    );
    assertEquals(
        uiAPI.systemCalls
            .filter((/** @type {{ message: string }} */ call) =>
                call.message.includes("Running CI Validation") || call.message === "Build and tests passed."
            )
            .every((/** @type {{ header: string }} */ call) => call.header === "RunWield"),
        true,
    );
    assertEquals(
        uiAPI.systemCalls.some((/** @type {{ message: string }} */ call) =>
            call.message.includes("Running Semantic Code Review...")
        ),
        true,
    );
    assertEquals(
        uiAPI.systemCalls.some((/** @type {{ message: string }} */ call) => call.message.includes("[spinner]")),
        false,
    );
    assertEquals(uiAPI.busyStates, [true, false, true, false]);
    assertEquals(
        uiAPI.systemCalls.some((/** @type {{ message: string, style: any }} */ call) =>
            call.message === "Build and tests passed." && call.style.bodyColor === "success"
        ),
        true,
    );
});

Deno.test("runValidationLoop restores requested final agent after validation", async () => {
    const uiAPI = makeUi();
    /** @type {string[]} */
    const switched = [];
    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "",
        triageMeta: { classification: "QUICK_FIX" },
        uiAPI,
        sessionManager: undefined,
        finalAgentName: "planner",
        __deps: /** @type {any} */ ({
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve(""),
            recordPlanEvent: noOpRecordPlanEvent,
            createAgentHandler: (/** @type {string} */ name) => () => Promise.resolve(name),
            setActiveAgent: (/** @type {unknown} */ _hostedSession, /** @type {string} */ name) => switched.push(name),
        }),
    });

    assertEquals(switched, ["planner"]);
});

Deno.test("runValidationLoop fails FEATURE validation when workflow diff is empty", async () => {
    const uiAPI = makeUi();
    /** @type {Array<{ event: string, details: { failureReason?: string } }>} */
    const events = [];

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve(""),
            runAgentSession: () => {
                throw new Error("semantic review should not run");
            },
            recordPlanEvent: (/** @type {any} */ event) => {
                events.push(event);
                return Promise.resolve({});
            },
            setActiveAgent: () => {},
        }),
    });

    assertEquals(events.map((event) => event.event), ["validation_failed"]);
    assertEquals(events[0].details.failureReason, "No implementation changes detected in workflow diff.");
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ m) =>
            m.includes("Workflow halted: No implementation changes detected in workflow diff.")
        ),
        true,
    );
});

Deno.test("runValidationLoop fails PROJECT validation when workflow diff only changes a plan document", async () => {
    const uiAPI = makeUi();
    /** @type {Array<{ event: string, details: { failureReason?: string } }>} */
    const events = [];

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "PROJECT" },
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () =>
                Promise.resolve([
                    "diff --git a/plans/p.md b/plans/p.md",
                    "--- a/plans/p.md",
                    "+++ b/plans/p.md",
                    "@@ -1,3 +1,3 @@",
                    "-status: implemented",
                    "+status: verified",
                ].join("\n")),
            runAgentSession: () => {
                throw new Error("semantic review should not run");
            },
            recordPlanEvent: (/** @type {any} */ event) => {
                events.push(event);
                return Promise.resolve({});
            },
            setActiveAgent: () => {},
        }),
    });

    assertEquals(events.map((event) => event.event), ["validation_failed"]);
    assertEquals(
        events[0].details.failureReason,
        "No implementation changes detected in workflow diff; only plan document changes were found.",
    );
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ m) =>
            m.includes(
                "Workflow halted: No implementation changes detected in workflow diff; only plan document changes",
            )
        ),
        true,
    );
});

Deno.test("runValidationLoop pauses with Engineer when CI repair does not call task_completed", async () => {
    const uiAPI = makeUi();
    const repairHostedSession = new HostedSession({ id: "ci-repair-pause-test" });
    let repairCalls = 0;
    let repairAgentName = "";
    await runValidationLoop({
        hostedSession: repairHostedSession,
        planName: "p",
        planContent: "",
        triageMeta: { classification: "FEATURE" },
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            runLocalCI: () => Promise.resolve({ exitCode: 1, output: "boom" }),
            runAgentSession: (/** @type {any} */ opts) => {
                repairCalls++;
                repairAgentName = opts.agentName;
                return Promise.resolve([]);
            },
            readLatestTaskCompletedOutcome: () => false,
            recordPlanEvent: noOpRecordPlanEvent,
            setActiveAgent: () => {},
        }),
    });

    assertEquals(repairCalls, 1);
    assertEquals(repairAgentName, "engineer");
    assertEquals(repairHostedSession.getActiveExecutionWorkflow(), {
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        executionCwd: Deno.cwd(),
        validationContinuation: true,
    });
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ m) =>
            m.includes("Engineer stopped without task_completed during CI repair.") &&
            m.includes("Validation will resume after task_completed")
        ),
        true,
    );
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ m) => m.includes("Mechanical validation failed 3 times")),
        false,
    );
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ m) => m.includes("during validation repair")),
        false,
    );
});

Deno.test("runValidationLoop pauses with Engineer on interrupted semantic repair", async () => {
    const uiAPI = makeUi();
    const repairHostedSession = new HostedSession({ id: "semantic-repair-pause-test" });
    await runValidationLoop({
        hostedSession: repairHostedSession,
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve("diff"),
            runAgentSession: () =>
                Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "missing requirement" }],
                    }, {
                        role: "toolResult",
                        toolName: "review_complete",
                        details: { outcome: "feedback", approved: false, feedback: "missing requirement" },
                    }]),
                ),
            runCompletionGatedRepair: () => Promise.resolve(false),
            recordPlanEvent: noOpRecordPlanEvent,
            setActiveAgent: () => {},
        }),
    });

    assertEquals(repairHostedSession.getActiveExecutionWorkflow(), {
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        executionCwd: Deno.cwd(),
        validationContinuation: true,
    });
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ m) =>
            m.includes("Engineer stopped without task_completed during semantic repair.") &&
            m.includes("Validation will resume after task_completed")
        ),
        true,
    );
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ m) => m === "Review failed. Sending feedback back to Engineer..."),
        true,
    );
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ m) => m.includes("Reviewer Feedback:\nmissing requirement")),
        false,
    );
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ m) => m.includes("Maximum validation cycles")),
        false,
    );
});

Deno.test("runValidationLoop reviews the diff scoped to the active workflow baseline", async () => {
    const uiAPI = makeUi();
    /** @type {string[]} */
    const reviewPrompts = [];
    /** @type {Array<string | undefined>} */
    const baselineArgs = [];

    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        baselineTree: "baseline-tree",
    });

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: (/** @type {string | undefined} */ baselineTree) => {
                baselineArgs.push(baselineTree);
                return Promise.resolve("diff --git a/workflow.js b/workflow.js\n+scoped workflow change\n");
            },
            runAgentSession: (/** @type {any} */ opts) => {
                reviewPrompts.push(opts.userRequest);
                return Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "The implementation matches the plan." }],
                    }, {
                        role: "toolResult",
                        toolName: "review_complete",
                        details: { outcome: "approved", approved: true, feedback: "" },
                    }]),
                );
            },
            recordPlanEvent: noOpRecordPlanEvent,
            setActiveAgent: () => {},
        }),
    });

    assertEquals(baselineArgs, ["baseline-tree"]);
    assertEquals(reviewPrompts.length, 1);
    assertEquals(reviewPrompts[0].includes("scoped workflow change"), true);
    assertEquals(reviewPrompts[0].includes("pre-existing dirty change"), false);
    assertEquals(hostedSession.getActiveExecutionWorkflow(), null);
});

Deno.test("runValidationLoop runs validation and reviewer in active execution cwd", async () => {
    const uiAPI = makeUi();
    /** @type {Array<string | undefined>} */
    const ciCwds = [];
    /** @type {Array<string | undefined>} */
    const diffCwds = [];
    /** @type {Array<string | undefined>} */
    const sessionCwds = [];
    /** @type {Array<any>} */
    const sessionOpts = [];

    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        baselineTree: "baseline-tree",
        projectRoot: "/primary",
        executionCwd: "/worktree",
        worktreeId: "wt1",
        worktreeBranch: "runwield/worktree/p-wt1",
        worktreeBaseBranch: "feature-base",
    });

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            runLocalCI: (/** @type {any} */ _uiAPI, /** @type {string | undefined} */ cwd) => {
                ciCwds.push(cwd);
                return Promise.resolve({ exitCode: 0, output: "" });
            },
            getDiffText: (/** @type {string | undefined} */ _baselineTree, /** @type {string | undefined} */ cwd) => {
                diffCwds.push(cwd);
                return Promise.resolve("diff --git a/file.js b/file.js\n+change\n");
            },
            runAgentSession: (/** @type {any} */ opts) => {
                sessionCwds.push(opts.cwd);
                sessionOpts.push(opts);
                return Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "The implementation matches the plan." }],
                    }, {
                        role: "toolResult",
                        toolName: "review_complete",
                        details: { outcome: "approved", approved: true, feedback: "" },
                    }]),
                );
            },
            mergeExecutionWorktree: () => Promise.resolve(),
            updateWorktreeRegistryEntry: () => Promise.resolve({}),
            recordPlanEvent: noOpRecordPlanEvent,
            setActiveAgent: () => {},
        }),
    });

    assertEquals(ciCwds, ["/worktree"]);
    assertEquals(diffCwds, ["/worktree"]);
    assertEquals(sessionCwds, ["/worktree"]);
    assertEquals(sessionOpts[0].uiAPI, uiAPI);
    assertEquals(sessionOpts[0]._agentDefOverride.tools, ["review_complete"]);
    assertEquals(sessionOpts[0]._agentDefOverride.systemPrompt.includes("{{SKILLS}}"), false);
    assertEquals(sessionOpts[0].includeEditFallback, false);
    assertEquals(sessionOpts[0].useRootSession, false);
});

Deno.test("runValidationLoop records validation_passed only after worktree merge succeeds", async () => {
    const uiAPI = makeUi();
    /** @type {string[]} */
    const actions = [];
    /** @type {any[]} */
    const metrics = [];

    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE", summary: "Preserve metadata in merge commits." },
        baselineTree: "baseline-tree",
        projectRoot: "/primary",
        executionCwd: "/worktree",
        worktreeId: "wt1",
        worktreeBranch: "runwield/worktree/p-wt1",
        worktreeBaseBranch: "feature-base",
    });

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE", summary: "Preserve metadata in merge commits." },
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve("diff --git a/file.js b/file.js\n+change\n"),
            runAgentSession: () =>
                Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "The implementation matches the plan." }],
                    }, {
                        role: "toolResult",
                        toolName: "review_complete",
                        details: { outcome: "approved", approved: true, feedback: "" },
                    }]),
                ),
            mergeExecutionWorktree: (
                /** @type {{ projectRoot: string, branch: string, targetBranch?: string, planName?: string, planDescription?: string }} */ args,
            ) => {
                actions.push(
                    `merge:${args.projectRoot}:${args.branch}:${args.targetBranch || ""}:${args.planName || ""}:${
                        args.planDescription || ""
                    }`,
                );
                return Promise.resolve();
            },
            removeExecutionWorktree: (/** @type {{ projectRoot: string, path: string, branch?: string }} */ args) => {
                actions.push(`remove:${args.projectRoot}:${args.path}:${args.branch || ""}`);
                return Promise.resolve();
            },
            removeWorktreeRegistryEntry: (/** @type {string} */ projectRoot, /** @type {string} */ id) => {
                actions.push(`registry-remove:${projectRoot}:${id}`);
                return Promise.resolve();
            },
            verifyExecutionWorktreeMerged: () => Promise.resolve({ merged: true, message: "merged" }),

            updateWorktreeRegistryEntry: (
                /** @type {string} */ _projectRoot,
                /** @type {string} */ _id,
                /** @type {{ status: string }} */ updates,
            ) => {
                actions.push(`registry:${updates.status}`);
                return Promise.resolve({});
            },
            recordPlanEvent: (/** @type {any} */ event) => {
                actions.push(`event:${event.event}:${event.details.worktreeStatus || ""}`);
                return Promise.resolve({});
            },
            getCodeReviewMode: () => "none",
            recordWorkflowMetric: (/** @type {any} */ metric) => {
                metrics.push(metric);
                return Promise.resolve(null);
            },
            setActiveAgent: () => {},
        }),
    });

    assertEquals(actions, [
        "merge:/primary:runwield/worktree/p-wt1:feature-base:p:Preserve metadata in merge commits.",
        "registry:merged",
        "remove:/primary:/worktree:runwield/worktree/p-wt1",
        "registry-remove:/primary:wt1",
        "event:validation_passed:merged",
    ]);
    assertEquals(
        metrics.some((metric) =>
            metric.category === "validation" && metric.event === "human_review_result" &&
            metric.details.mode === "none" && metric.details.decision === "not_required"
        ),
        true,
    );
});

Deno.test("runValidationLoop does not delete worktree when merge verification is uncertain", async () => {
    const uiAPI = makeUi();
    /** @type {string[]} */
    const actions = [];

    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        baselineTree: "baseline-tree",
        projectRoot: "/primary",
        executionCwd: "/worktree",
        worktreeId: "wt1",
        worktreeBranch: "runwield/worktree/p-wt1",
        worktreeBaseBranch: "feature-base",
    });

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve("diff --git a/file.js b/file.js\n+change\n"),
            runAgentSession: () =>
                Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "The implementation matches the plan." }],
                    }, {
                        role: "toolResult",
                        toolName: "review_complete",
                        details: { outcome: "approved", approved: true, feedback: "" },
                    }]),
                ),
            mergeExecutionWorktree: () => {
                actions.push("merge");
                return Promise.resolve();
            },
            verifyExecutionWorktreeMerged: () =>
                Promise.resolve({ merged: false, message: "branch is not contained in target" }),
            updateWorktreeRegistryEntry: (
                /** @type {string} */ _projectRoot,
                /** @type {string} */ _id,
                /** @type {{ status: string }} */ updates,
            ) => {
                actions.push(`registry:${updates.status}`);
                return Promise.resolve({});
            },
            removeExecutionWorktree: () => {
                actions.push("remove");
                return Promise.resolve();
            },
            recordPlanEvent: (/** @type {any} */ event) => {
                actions.push(
                    `event:${event.event}:${event.details.failureReason || event.details.worktreeStatus || ""}`,
                );
                return Promise.resolve({});
            },
            getCodeReviewMode: () => "none",
            setActiveAgent: () => {},
        }),
    });

    assertEquals(actions, [
        "merge",
        "registry:validation_failed",
        "event:validation_failed:Worktree merge verification failed after merge-back reported success: branch is not contained in target",
    ]);
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ message) =>
            message.includes("Worktree merge verification failed after merge-back reported success")
        ),
        true,
    );
});

Deno.test("runValidationLoop runs always human review after semantic approval and before merge", async () => {
    const uiAPI = makeUi();
    /** @type {string[]} */
    const actions = [];

    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        baselineTree: "baseline-tree",
        projectRoot: "/primary",
        executionCwd: "/worktree",
        worktreeId: "wt1",
        worktreeBranch: "runwield/worktree/p-wt1",
        worktreeBaseBranch: "feature-base",
    });

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve("diff --git a/file.js b/file.js\n+change\n"),
            runAgentSession: () =>
                Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "The implementation matches the plan." }],
                    }, {
                        role: "toolResult",
                        toolName: "review_complete",
                        details: { outcome: "approved", approved: true, feedback: "" },
                    }]),
                ),
            getCodeReviewMode: () => "always",
            runPlannotatorCodeReview: (/** @type {any} */ opts) => {
                actions.push(`human-review:${opts.executionCwd}:${opts.diffText.includes("+change")}`);
                return Promise.resolve({ approved: true, feedback: "", annotations: [], exit: false });
            },
            mergeExecutionWorktree: () => {
                actions.push("merge");
                return Promise.resolve();
            },
            removeExecutionWorktree: () => Promise.resolve(),
            removeWorktreeRegistryEntry: () => Promise.resolve(),
            verifyExecutionWorktreeMerged: () => Promise.resolve({ merged: true, message: "merged" }),
            updateWorktreeRegistryEntry: () => {
                actions.push("registry");
                return Promise.resolve({});
            },
            recordPlanEvent: (/** @type {any} */ event) => {
                actions.push(
                    `event:${event.event}:${event.details.humanReviewMode}:${event.details.humanReviewDecision}`,
                );
                return Promise.resolve({});
            },
            setActiveAgent: () => {},
        }),
    });

    assertEquals(actions, [
        "human-review:/worktree:true",
        "merge",
        "registry",
        "event:validation_passed:always:approved",
    ]);
});

Deno.test("runValidationLoop ask mode can skip human review and merge", async () => {
    const uiAPI = makeUi();
    /** @type {string[]} */
    const actions = [];
    uiAPI.promptSelect = () => {
        actions.push("prompt");
        return Promise.resolve("skip");
    };

    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        baselineTree: "baseline-tree",
        projectRoot: "/primary",
        executionCwd: "/worktree",
        worktreeId: "wt1",
        worktreeBranch: "runwield/worktree/p-wt1",
        worktreeBaseBranch: "feature-base",
    });

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve("diff --git a/file.js b/file.js\n+change\n"),
            runAgentSession: () =>
                Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "The implementation matches the plan." }],
                    }, {
                        role: "toolResult",
                        toolName: "review_complete",
                        details: { outcome: "approved", approved: true, feedback: "" },
                    }]),
                ),
            getCodeReviewMode: () => "ask",
            runPlannotatorCodeReview: () => {
                throw new Error("review server should not start");
            },
            mergeExecutionWorktree: () => {
                actions.push("merge");
                return Promise.resolve();
            },
            removeExecutionWorktree: () => Promise.resolve(),
            removeWorktreeRegistryEntry: () => Promise.resolve(),
            verifyExecutionWorktreeMerged: () => Promise.resolve({ merged: true, message: "merged" }),
            updateWorktreeRegistryEntry: () => Promise.resolve({}),
            recordPlanEvent: (/** @type {any} */ event) => {
                actions.push(
                    `event:${event.event}:${event.details.humanReviewMode}:${event.details.humanReviewDecision}`,
                );
                return Promise.resolve({});
            },
            setActiveAgent: () => {},
        }),
    });

    assertEquals(actions, ["prompt", "merge", "event:validation_passed:ask:skipped"]);
});

Deno.test("runValidationLoop ask mode opens human review before merge when approved", async () => {
    const uiAPI = makeUi();
    /** @type {string[]} */
    const actions = [];
    uiAPI.promptSelect = () => {
        actions.push("prompt");
        return Promise.resolve("open");
    };

    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        baselineTree: "baseline-tree",
        projectRoot: "/primary",
        executionCwd: "/worktree",
        worktreeId: "wt1",
        worktreeBranch: "runwield/worktree/p-wt1",
        worktreeBaseBranch: "feature-base",
    });

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve("diff --git a/file.js b/file.js\n+change\n"),
            runAgentSession: () =>
                Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "The implementation matches the plan." }],
                    }, {
                        role: "toolResult",
                        toolName: "review_complete",
                        details: { outcome: "approved", approved: true, feedback: "" },
                    }]),
                ),
            getCodeReviewMode: () => "ask",
            runPlannotatorCodeReview: (/** @type {any} */ opts) => {
                actions.push(`human-review:${opts.executionCwd}:${opts.diffText.includes("+change")}`);
                return Promise.resolve({ approved: true, feedback: "", annotations: [], exit: false });
            },
            mergeExecutionWorktree: () => {
                actions.push("merge");
                return Promise.resolve();
            },
            removeExecutionWorktree: () => Promise.resolve(),
            removeWorktreeRegistryEntry: () => Promise.resolve(),
            verifyExecutionWorktreeMerged: () => Promise.resolve({ merged: true, message: "merged" }),
            updateWorktreeRegistryEntry: () => Promise.resolve({}),
            recordPlanEvent: (/** @type {any} */ event) => {
                actions.push(
                    `event:${event.event}:${event.details.humanReviewMode}:${event.details.humanReviewDecision}`,
                );
                return Promise.resolve({});
            },
            setActiveAgent: () => {},
        }),
    });

    assertEquals(actions, ["prompt", "human-review:/worktree:true", "merge", "event:validation_passed:ask:approved"]);
});

Deno.test("runValidationLoop sends human feedback to Engineer and continues validation", async () => {
    const uiAPI = makeUi();
    /** @type {string[]} */
    const actions = [];
    /** @type {any[]} */
    const metrics = [];
    let humanReviewCalls = 0;

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve("diff --git a/file.js b/file.js\n+change\n"),
            runAgentSession: () =>
                Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "The implementation matches the plan." }],
                    }, {
                        role: "toolResult",
                        toolName: "review_complete",
                        details: { outcome: "approved", approved: true, feedback: "" },
                    }]),
                ),
            getCodeReviewMode: () => "always",
            runPlannotatorCodeReview: () => {
                humanReviewCalls++;
                actions.push(`human-review:${humanReviewCalls}`);
                if (humanReviewCalls === 1) {
                    return Promise.resolve({
                        approved: false,
                        feedback: "Please tighten this.",
                        annotations: [{ file: "src/a.js", line: 7, text: "Needs test." }],
                        exit: false,
                    });
                }
                return Promise.resolve({ approved: true, feedback: "", annotations: [], exit: false });
            },
            recordWorkflowMetric: (/** @type {any} */ metric) => {
                metrics.push(metric);
                return Promise.resolve(null);
            },
            runCompletionGatedRepair: (/** @type {any} */ opts) => {
                actions.push(`repair:${opts.agentName}:${opts.userRequest.includes("Needs test.")}`);
                return Promise.resolve(true);
            },
            recordPlanEvent: (/** @type {any} */ event) => {
                actions.push(
                    `event:${event.event}:${event.details.humanReviewMode}:${event.details.humanReviewDecision}`,
                );
                return Promise.resolve({});
            },
            setActiveAgent: () => {},
        }),
    });

    assertEquals(actions, [
        "human-review:1",
        "repair:engineer:true",
        "human-review:2",
        "event:validation_passed:always:approved",
    ]);
    assertEquals(
        metrics.some((metric) =>
            metric.category === "validation" && metric.event === "human_review_result" &&
            metric.details.mode === "always" && metric.details.decision === "feedback_requested" &&
            metric.details.hasFeedback === true && metric.details.annotationCount === 1
        ),
        true,
    );
});

Deno.test("runValidationLoop treats human review exit as validation failure without merge", async () => {
    const uiAPI = makeUi();
    /** @type {string[]} */
    const actions = [];
    /** @type {any[]} */
    const metrics = [];

    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        baselineTree: "baseline-tree",
        projectRoot: "/primary",
        executionCwd: "/worktree",
        worktreeId: "wt1",
        worktreeBranch: "runwield/worktree/p-wt1",
        worktreeBaseBranch: "feature-base",
    });

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve("diff --git a/file.js b/file.js\n+change\n"),
            runAgentSession: () =>
                Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "The implementation matches the plan." }],
                    }, {
                        role: "toolResult",
                        toolName: "review_complete",
                        details: { outcome: "approved", approved: true, feedback: "" },
                    }]),
                ),
            getCodeReviewMode: () => "always",
            runPlannotatorCodeReview: () =>
                Promise.resolve({ approved: false, feedback: "", annotations: [], exit: true }),
            mergeExecutionWorktree: () => {
                actions.push("merge");
                return Promise.resolve();
            },
            updateWorktreeRegistryEntry: (
                /** @type {string} */ _projectRoot,
                /** @type {string} */ _id,
                /** @type {{ status: string }} */ updates,
            ) => {
                actions.push(`registry:${updates.status}`);
                return Promise.resolve({});
            },
            recordPlanEvent: (/** @type {any} */ event) => {
                actions.push(`event:${event.event}:${event.details.failureReason}`);
                return Promise.resolve({});
            },
            recordWorkflowMetric: (/** @type {any} */ metric) => {
                metrics.push(metric);
                return Promise.resolve(null);
            },
            setActiveAgent: () => {},
        }),
    });

    assertEquals(actions, [
        "registry:validation_failed",
        "event:validation_failed:User code review exited without approval or feedback.",
    ]);
    assertEquals(
        metrics.some((metric) =>
            metric.category === "validation" && metric.event === "human_review_result" &&
            metric.details.decision === "exited"
        ),
        true,
    );
});

Deno.test("runValidationLoop keeps merged worktree when cleanup setting is disabled", async () => {
    const uiAPI = makeUi();
    /** @type {string[]} */
    const actions = [];

    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        baselineTree: "baseline-tree",
        projectRoot: "/primary",
        executionCwd: "/worktree",
        worktreeId: "wt1",
        worktreeBranch: "runwield/worktree/p-wt1",
        worktreeBaseBranch: "feature-base",
    });

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve("diff --git a/file.js b/file.js\n+change\n"),
            runAgentSession: () =>
                Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "The implementation matches the plan." }],
                    }, {
                        role: "toolResult",
                        toolName: "review_complete",
                        details: { outcome: "approved", approved: true, feedback: "" },
                    }]),
                ),
            mergeExecutionWorktree: () => {
                actions.push("merge");
                return Promise.resolve();
            },
            removeExecutionWorktree: () => {
                actions.push("remove");
                return Promise.resolve();
            },
            removeWorktreeRegistryEntry: () => {
                actions.push("registry-remove");
                return Promise.resolve();
            },
            verifyExecutionWorktreeMerged: () => Promise.resolve({ merged: true, message: "merged" }),
            updateWorktreeRegistryEntry: () => {
                actions.push("registry");
                return Promise.resolve({});
            },
            recordPlanEvent: (/** @type {any} */ event) => {
                actions.push(`event:${event.event}:${event.details.cleanupMergedWorktrees}`);
                return Promise.resolve({});
            },
            shouldCleanupMergedWorktrees: () => false,
            setActiveAgent: () => {},
        }),
    });

    assertEquals(actions, ["merge", "registry", "event:validation_passed:false"]);
});

Deno.test("runValidationLoop records worktree_merge_failed when merge-back fails", async () => {
    const uiAPI = makeUi();
    /** @type {string[]} */
    const actions = [];
    /** @type {any} */
    let mergeFailedDetails = null;

    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        baselineTree: "baseline-tree",
        projectRoot: "/primary",
        executionCwd: "/worktree",
        worktreeId: "wt1",
        worktreeBranch: "runwield/worktree/p-wt1",
        worktreeBaseBranch: "feature-base",
    });

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve("diff --git a/file.js b/file.js\n+change\n"),
            runAgentSession: () =>
                Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "The implementation matches the plan." }],
                    }, {
                        role: "toolResult",
                        toolName: "review_complete",
                        details: { outcome: "approved", approved: true, feedback: "" },
                    }]),
                ),
            mergeExecutionWorktree: () => Promise.reject(new Error("conflict")),
            updateWorktreeRegistryEntry: (
                /** @type {string} */ _projectRoot,
                /** @type {string} */ _id,
                /** @type {{ status: string }} */ updates,
            ) => {
                actions.push(`registry:${updates.status}`);
                return Promise.resolve({});
            },
            recordPlanEvent: (/** @type {any} */ event) => {
                if (event.event === "worktree_merge_failed") {
                    mergeFailedDetails = event.details;
                }
                actions.push(`event:${event.event}:${event.details.failureReason}`);
                return Promise.resolve({});
            },
            getCodeReviewMode: () => "none",
            setActiveAgent: () => {},
        }),
    });

    assertEquals(actions, [
        "registry:merge_conflict",
        "event:worktree_merge_failed:conflict",
        "registry:validation_failed",
        "event:validation_failed:Worktree merge failed: conflict",
    ]);
    assertEquals(mergeFailedDetails.worktreePath, "/worktree");
    assertEquals(mergeFailedDetails.worktreeBranch, "runwield/worktree/p-wt1");
    assertEquals(mergeFailedDetails.worktreeBaseBranch, "feature-base");
    assertEquals(uiAPI.promptSelections, ["prompted"]);
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ message) => message.includes("Worktree merge failed: conflict")),
        true,
    );
    assertEquals(
        uiAPI.systemCalls.some((/** @type {{ message: string, isError: boolean }} */ call) =>
            call.message.includes("Worktree merge failed: conflict") && call.isError
        ),
        true,
    );
});

Deno.test("runValidationLoop still prompts when merge-conflict metadata updates fail", async () => {
    const uiAPI = makeUi();
    /** @type {string[]} */
    const actions = [];

    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        baselineTree: "baseline-tree",
        projectRoot: "/primary",
        executionCwd: "/worktree",
        worktreeId: "wt1",
        worktreeBranch: "runwield/worktree/p-wt1",
        worktreeBaseBranch: "feature-base",
    });

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve("diff --git a/file.js b/file.js\n+change\n"),
            runAgentSession: () =>
                Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "The implementation matches the plan." }],
                    }, {
                        role: "toolResult",
                        toolName: "review_complete",
                        details: { outcome: "approved", approved: true, feedback: "" },
                    }]),
                ),
            mergeExecutionWorktree: () => Promise.reject(new Error("merge conflict")),
            updateWorktreeRegistryEntry: () => {
                actions.push("registry-failed");
                return Promise.reject(new SyntaxError("Expected double-quoted property name"));
            },
            recordPlanEvent: () => {
                actions.push("plan-event-failed");
                return Promise.reject(new Error("front matter conflict markers"));
            },
            getCodeReviewMode: () => "none",
            setActiveAgent: () => {},
        }),
    });

    assertEquals(actions, ["registry-failed", "plan-event-failed", "registry-failed", "plan-event-failed"]);
    assertEquals(uiAPI.promptSelections, ["prompted"]);
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ message) =>
            message.includes("Could not update worktree registry while merge conflict is active")
        ),
        true,
    );
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ message) =>
            message.includes("Could not update plan metadata while merge conflict is active")
        ),
        true,
    );
});

Deno.test("runValidationLoop warns when using legacy current-checkout merge fallback", async () => {
    const uiAPI = makeUi();
    /** @type {Array<string | undefined>} */
    const targets = [];

    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        baselineTree: "baseline-tree",
        projectRoot: "/primary",
        executionCwd: "/worktree",
        worktreeId: "wt1",
        worktreeBranch: "runwield/worktree/p-wt1",
    });

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve("diff --git a/file.js b/file.js\n+change\n"),
            runAgentSession: () =>
                Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "The implementation matches the plan." }],
                    }, {
                        role: "toolResult",
                        toolName: "review_complete",
                        details: { outcome: "approved", approved: true, feedback: "" },
                    }]),
                ),
            mergeExecutionWorktree: (/** @type {{ targetBranch?: string }} */ args) => {
                targets.push(args.targetBranch);
                return Promise.resolve();
            },
            updateWorktreeRegistryEntry: () => Promise.resolve({}),
            recordPlanEvent: noOpRecordPlanEvent,
            removeExecutionWorktree: () => Promise.resolve(),
            getCodeReviewMode: () => "none",
            setActiveAgent: () => {},
        }),
    });

    assertEquals(targets, [undefined]);
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ message) =>
            message.includes("Recorded worktree target branch is unknown")
        ),
        true,
    );
});

Deno.test("runValidationLoop dispatches Engineer merge repair and retries merge-back", async () => {
    const uiAPI = makeUi();
    /** @type {string[]} */
    const actions = [];
    let mergeAttempts = 0;

    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        baselineTree: "baseline-tree",
        projectRoot: "/primary",
        executionCwd: "/worktree",
        worktreeId: "wt1",
        worktreeBranch: "runwield/worktree/p-wt1",
        worktreeBaseBranch: "feature-base",
    });

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve("diff --git a/file.js b/file.js\n+change\n"),
            runAgentSession: () =>
                Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "The implementation matches the plan." }],
                    }, {
                        role: "toolResult",
                        toolName: "review_complete",
                        details: { outcome: "approved", approved: true, feedback: "" },
                    }]),
                ),
            mergeExecutionWorktree: (/** @type {any} */ args) => {
                mergeAttempts++;
                actions.push(`merge:${mergeAttempts}:${args.repairMergeWorktreePath || ""}`);
                if (mergeAttempts === 1) {
                    const error =
                        /** @type {Error & { repairCwd?: string, mergeWorktreePath?: string, mergeFailureKind?: string }} */ (
                            new Error("conflict")
                        );
                    error.repairCwd = "/merge-wt";
                    error.mergeWorktreePath = "/merge-wt";
                    error.mergeFailureKind = "detached_merge_conflict";
                    return Promise.reject(error);
                }
                return Promise.resolve();
            },
            runCompletionGatedRepair: (/** @type {any} */ opts) => {
                actions.push(
                    `repair:${opts.cwd}:${opts.userRequest.includes("feature-base")}:${
                        opts.userRequest.includes("Current plan status: implemented")
                    }:${opts.userRequest.includes("Diff/context:")}:${
                        opts.userRequest.includes("detached merge worktree")
                    }`,
                );
                return Promise.resolve(true);
            },
            updateWorktreeRegistryEntry: (
                /** @type {string} */ _projectRoot,
                /** @type {string} */ _id,
                /** @type {{ status: string }} */ updates,
            ) => {
                actions.push(`registry:${updates.status}`);
                return Promise.resolve({});
            },
            recordPlanEvent: (/** @type {any} */ event) => {
                actions.push(
                    `event:${event.event}:${event.details.failureReason || event.details.worktreeStatus || ""}`,
                );
                return Promise.resolve({});
            },
            removeExecutionWorktree: () => {
                actions.push("remove");
                return Promise.resolve();
            },
            verifyExecutionWorktreeMerged: () => Promise.resolve({ merged: true, message: "merged" }),
            getCodeReviewMode: () => "none",
            setActiveAgent: () => {},
        }),
    });

    assertEquals(actions, [
        "merge:1:",
        "registry:merge_conflict",
        "event:worktree_merge_failed:conflict",
        "repair:/merge-wt:true:true:true:true",
        "merge:2:/merge-wt",
        "registry:merged",
        "remove",
        "event:validation_passed:merged",
    ]);
    assertEquals(uiAPI.promptSelections, []);
});

Deno.test("runValidationLoop records validation_passed after merge repair task_completed and retry", async () => {
    const uiAPI = makeUi();
    const repairHostedSession = new HostedSession({ id: "merge-repair-completion-test" });
    repairHostedSession.setRootAgentName("engineer");
    repairHostedSession.setRootAgentSession(
        /** @type {any} */ ({
            agent: {
                state: {
                    messages: [{ role: "assistant", content: [{ type: "text", text: "previous turn" }] }],
                },
            },
        }),
    );
    /** @type {string[]} */
    const events = [];
    let mergeAttempts = 0;

    repairHostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        baselineTree: "baseline-tree",
        projectRoot: "/primary",
        executionCwd: "/worktree",
        worktreeId: "wt1",
        worktreeBranch: "runwield/worktree/p-wt1",
        worktreeBaseBranch: "feature-base",
    });

    await runValidationLoop({
        hostedSession: repairHostedSession,
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve("diff --git a/file.js b/file.js\n+change\n"),
            runAgentSession: (/** @type {{ agentName: string }} */ opts) => {
                if (opts.agentName === "reviewer") {
                    return Promise.resolve(
                        /** @type {any} */ ([{
                            role: "assistant",
                            content: [{ type: "text", text: "The implementation matches the plan." }],
                        }, {
                            role: "toolResult",
                            toolName: "review_complete",
                            details: { outcome: "approved", approved: true, feedback: "" },
                        }]),
                    );
                }
                return Promise.resolve(
                    /** @type {any} */ ([{
                        role: "toolResult",
                        toolName: "task_completed",
                        details: { outcome: "task_completed" },
                    }]),
                );
            },
            mergeExecutionWorktree: () => {
                mergeAttempts++;
                if (mergeAttempts === 1) {
                    return Promise.reject(new Error("merge conflict"));
                }
                return Promise.resolve();
            },
            updateWorktreeRegistryEntry: () => Promise.resolve({}),
            recordPlanEvent: (/** @type {{ event: string }} */ event) => {
                events.push(event.event);
                return Promise.resolve({});
            },
            removeExecutionWorktree: () => Promise.resolve(),
            verifyExecutionWorktreeMerged: () => Promise.resolve({ merged: true, message: "merged" }),
            getCodeReviewMode: () => "none",
            setActiveAgent: () => {},
        }),
    });

    assertEquals(events, ["worktree_merge_failed", "validation_passed"]);
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ message) =>
            message.includes("Feature execution and validation complete")
        ),
        true,
    );
});

Deno.test("runValidationLoop retries worktree merge after user fixes primary checkout", async () => {
    const uiAPI = makeUi();
    /** @type {string[]} */
    const actions = [];
    let mergeAttempts = 0;
    uiAPI.promptSelect = () => {
        uiAPI.promptSelections.push("retry");
        return Promise.resolve("retry");
    };

    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        baselineTree: "baseline-tree",
        projectRoot: "/primary",
        executionCwd: "/worktree",
        worktreeId: "wt1",
        worktreeBranch: "runwield/worktree/p-wt1",
        worktreeBaseBranch: "feature-base",
    });

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve("diff --git a/file.js b/file.js\n+change\n"),
            runAgentSession: () =>
                Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "The implementation matches the plan." }],
                    }, {
                        role: "toolResult",
                        toolName: "review_complete",
                        details: { outcome: "approved", approved: true, feedback: "" },
                    }]),
                ),
            mergeExecutionWorktree: () => {
                mergeAttempts++;
                actions.push(`merge:${mergeAttempts}`);
                if (mergeAttempts === 1) return Promise.reject(new Error("primary dirty"));
                return Promise.resolve();
            },
            updateWorktreeRegistryEntry: (
                /** @type {string} */ _projectRoot,
                /** @type {string} */ _id,
                /** @type {{ status: string }} */ updates,
            ) => {
                actions.push(`registry:${updates.status}`);
                return Promise.resolve({});
            },
            recordPlanEvent: (/** @type {any} */ event) => {
                actions.push(
                    `event:${event.event}:${event.details.failureReason || event.details.worktreeStatus || ""}`,
                );
                return Promise.resolve({});
            },
            removeExecutionWorktree: () => {
                actions.push("remove");
                return Promise.resolve();
            },
            verifyExecutionWorktreeMerged: () => Promise.resolve({ merged: true, message: "merged" }),
            getCodeReviewMode: () => "none",
            setActiveAgent: () => {},
        }),
    });

    assertEquals(actions, [
        "merge:1",
        "registry:merge_conflict",
        "event:worktree_merge_failed:primary dirty",
        "merge:2",
        "registry:merged",
        "remove",
        "event:validation_passed:merged",
    ]);
    assertEquals(uiAPI.promptSelections, ["retry"]);
});

Deno.test("runValidationLoop marks active worktree validation_failed when validation fails", async () => {
    const uiAPI = makeUi();
    /** @type {string[]} */
    const actions = [];

    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        baselineTree: "baseline-tree",
        projectRoot: "/primary",
        executionCwd: "/worktree",
        worktreeId: "wt1",
        worktreeBranch: "runwield/worktree/p-wt1",
        worktreeBaseBranch: "feature-base",
    });

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve(""),
            updateWorktreeRegistryEntry: (
                /** @type {string} */ _projectRoot,
                /** @type {string} */ _id,
                /** @type {{ status: string }} */ updates,
            ) => {
                actions.push(`registry:${updates.status}`);
                return Promise.resolve({});
            },
            recordPlanEvent: (/** @type {any} */ event) => {
                actions.push(`event:${event.event}:${event.details.failureReason}`);
                return Promise.resolve({});
            },
            setActiveAgent: () => {},
        }),
    });

    assertEquals(actions, [
        "registry:validation_failed",
        "event:validation_failed:No implementation changes detected in workflow diff.",
    ]);
});

// ─── review-diff-tool tests ────────────────────────────────────────────────

import {
    buildLargeDiffReviewPrompt,
    createReviewDiffTool,
    formatChangedFileList,
    getFileDiff,
    listDiffFiles,
    parseDiffFiles,
} from "./review-diff-tool.js";

const SAMPLE_INLINE_DIFF = [
    "diff --git a/src/a.js b/src/a.js",
    "--- a/src/a.js",
    "+++ b/src/a.js",
    "@@ -1,3 +1,4 @@",
    " line1",
    "-old line",
    "+new line",
    " line3",
    "diff --git a/src/b.js b/src/b.js",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/src/b.js",
    "@@ -0,0 +1,2 @@",
    "+brand new",
    "+file",
    "diff --git a/src/c.js b/src/c.js",
    "deleted file mode 100644",
    "--- a/src/c.js",
    "+++ /dev/null",
    "@@ -1,2 +0,0 @@",
    "-removed line1",
    "-removed line2",
    "diff --git a/src/old.js b/src/new.js",
    "rename from src/old.js",
    "rename to src/new.js",
    "--- a/src/old.js",
    "+++ b/src/new.js",
    "@@ -1,1 +1,2 @@",
    " base",
    "+extra",
    "diff --git a/src/binary.png b/src/binary.png",
    "new file mode 100644",
    "Binary files /dev/null and b/src/binary.png differ",
].join("\n");

Deno.test("parseDiffFiles parses modified, added, deleted, renamed, and binary files", () => {
    const entries = parseDiffFiles(SAMPLE_INLINE_DIFF);
    assertEquals(entries.length, 5, "expected 5 file entries");

    const modEntry = entries.find((e) => e.path === "src/a.js");
    assertEquals(modEntry?.changeType, "modified");
    assertEquals(modEntry?.hunkLines.added, 1);
    assertEquals(modEntry?.hunkLines.removed, 1);

    const addEntry = entries.find((e) => e.path === "src/b.js");
    assertEquals(addEntry?.changeType, "added");
    assertEquals(addEntry?.hunkLines.added, 2);
    assertEquals(addEntry?.hunkLines.removed, 0);

    const delEntry = entries.find((e) => e.path === "src/c.js");
    assertEquals(delEntry?.changeType, "deleted");
    assertEquals(delEntry?.hunkLines.added, 0);
    assertEquals(delEntry?.hunkLines.removed, 2);

    const renameEntry = entries.find((e) => e.path === "src/new.js");
    assertEquals(renameEntry?.changeType, "renamed");

    const binaryEntry = entries.find((e) => e.path === "src/binary.png");
    assertEquals(binaryEntry?.changeType, "modified");
    assertEquals(binaryEntry?.hunkLines.added, 0);
    assertEquals(binaryEntry?.hunkLines.removed, 0);
});

Deno.test("parseDiffFiles returns empty array for empty diff", () => {
    assertEquals(parseDiffFiles(""), []);
    assertEquals(parseDiffFiles("   "), []);
    assertEquals(parseDiffFiles("no header here"), []);
});

Deno.test("formatChangedFileList includes all entries with summary info", () => {
    const entries = parseDiffFiles(SAMPLE_INLINE_DIFF);
    const output = formatChangedFileList(entries);
    assertStringIncludes(output, "src/a.js");
    assertStringIncludes(output, "src/b.js");
    assertStringIncludes(output, "src/c.js");
    assertStringIncludes(output, "1 added, 1 removed");
    assertStringIncludes(output, "2 added, 0 removed");
    assertStringIncludes(output, "0 added, 2 removed");
    assertStringIncludes(output, "5 file(s)");
});

Deno.test("getFileDiff finds file by exact path", () => {
    const entries = parseDiffFiles(SAMPLE_INLINE_DIFF);
    const result = getFileDiff(entries, "src/a.js");
    assertEquals(result.found, true);
    if (result.found) {
        assertStringIncludes(result.content, "new line");
        assertEquals(result.truncated, false);
    }
});

Deno.test("getFileDiff returns not-found for nonexistent file", () => {
    const entries = parseDiffFiles(SAMPLE_INLINE_DIFF);
    const result = getFileDiff(entries, "src/nope.js");
    assertEquals(result.found, false);
    if (!result.found) {
        assertStringIncludes(result.message, "not found");
    }
});

Deno.test("getFileDiff supports byte offset for truncated reads", () => {
    const entries = parseDiffFiles(SAMPLE_INLINE_DIFF);
    // Use a very small maxBytes to force truncation
    const result = getFileDiff(entries, "src/a.js", { offsetBytes: 0, maxBytes: 50 });
    assertEquals(result.found, true);
    if (result.found) {
        assertEquals(result.truncated, true);
        assertEquals(result.remainingBytes > 0, true);
    }
});

Deno.test("listDiffFiles marks entries exceeding max inline bytes as truncated", () => {
    const entries = parseDiffFiles(SAMPLE_INLINE_DIFF);
    const summaries = listDiffFiles(entries, 1);

    for (const s of summaries) {
        assertEquals(s.truncated, true);
        assertEquals(s.maxInlineBytes, 1);
    }
});

Deno.test("listDiffFiles does not mark small entries as truncated", () => {
    const entries = parseDiffFiles(SAMPLE_INLINE_DIFF);
    const summaries = listDiffFiles(entries, 10_000_000);

    for (const s of summaries) {
        assertEquals(s.truncated, false);
        assertEquals(s.maxInlineBytes, null);
    }
});

Deno.test("buildLargeDiffReviewPrompt produces compact review packet without full diff", () => {
    const reviewerAgentDef = {
        name: "reviewer",
        displayName: "Reviewer",
        model: "",
        description: "",
        tools: [],
        systemPrompt: "",
    };
    const planContent = "Add a feature that does X.";
    const totalBytes = new TextEncoder().encode(SAMPLE_INLINE_DIFF).byteLength;
    const prompt = buildLargeDiffReviewPrompt(reviewerAgentDef, planContent, SAMPLE_INLINE_DIFF, totalBytes);

    // Should NOT contain the full diff
    assertEquals(prompt.includes("new line"), false);
    assertEquals(prompt.includes("brand new"), false);
    assertEquals(prompt.includes("removed line1"), false);

    // Should contain the changed file listing
    assertStringIncludes(prompt, "src/a.js");
    assertStringIncludes(prompt, "src/b.js");
    assertStringIncludes(prompt, "src/c.js");

    // Should contain the original plan
    assertStringIncludes(prompt, "Add a feature that does X");

    // Should contain usage instructions
    assertStringIncludes(prompt, "review_diff");

    // Should mention the size
    assertStringIncludes(prompt, "omitted");
});

Deno.test("review_diff tool responds to list command", async () => {
    const tool = createReviewDiffTool(SAMPLE_INLINE_DIFF);
    const result = await /** @type {any} */ (tool.execute)("test-1", { command: "list" });
    assertStringIncludes(result.content[0].text, "src/a.js");
    assertStringIncludes(result.content[0].text, "src/b.js");
    assertEquals(result.details.command, "list");
    assertEquals(result.details.fileCount, 5);
});

Deno.test("review_diff tool responds to show command", async () => {
    const tool = createReviewDiffTool(SAMPLE_INLINE_DIFF);
    const result = await /** @type {any} */ (tool.execute)("test-2", { command: "show", path: "src/a.js" });
    assertStringIncludes(result.content[0].text, "new line");
    assertEquals(result.details.command, "show");
    assertEquals(result.details.path, "src/a.js");
});

Deno.test("review_diff tool reports error for missing path in show", async () => {
    const tool = createReviewDiffTool(SAMPLE_INLINE_DIFF);
    const result = await /** @type {any} */ (tool.execute)("test-3", { command: "show" });
    assertEquals(result.isError, true);
    assertStringIncludes(result.content[0].text, "required");
});

Deno.test("review_diff tool reports error for unknown command", async () => {
    const tool = createReviewDiffTool(SAMPLE_INLINE_DIFF);
    const result = await /** @type {any} */ (tool.execute)("test-4", { command: "unknown" });
    assertEquals(result.isError, true);
    assertStringIncludes(result.content[0].text, "unknown command");
});

Deno.test("review_diff tool reports not-found for nonexistent file", async () => {
    const tool = createReviewDiffTool(SAMPLE_INLINE_DIFF);
    const result = await /** @type {any} */ (tool.execute)("test-5", { command: "show", path: "nonexistent.js" });
    assertEquals(result.isError, true);
    assertStringIncludes(result.content[0].text, "not found");
});

Deno.test("review_diff tool returns no-files message for empty diff", async () => {
    const tool = createReviewDiffTool("");
    const result = await /** @type {any} */ (tool.execute)("test-6", { command: "list" });
    assertEquals(result.details.fileCount, 0);
    assertStringIncludes(result.content[0].text, "No changed files");
});

// ─── Large-diff / error-handling integration tests ──────────────────────────

Deno.test("runValidationLoop uses large-diff prompt when diff exceeds inline threshold", async () => {
    const uiAPI = makeUi();
    /** @type {string[]} */
    const reviewPrompts = [];

    // Build a diff larger than 60KB inline threshold (use 5000 lines to get >100KB)
    const largeDiffLines = ["diff --git a/src/big.js b/src/big.js", "--- a/src/big.js", "+++ b/src/big.js"];
    for (let i = 0; i < 5000; i++) {
        largeDiffLines.push(`+line ${i} with some extra padding to make each line bigger and bigger`);
        largeDiffLines.push(`-old line ${i} also with some extra padding for size purposes`);
    }
    const largeDiffText = largeDiffLines.join("\n");

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "Add a large feature.",
        triageMeta: { classification: "FEATURE" },
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve(largeDiffText),
            runAgentSession: (/** @type {any} */ opts) => {
                reviewPrompts.push(opts.userRequest);
                // Verify customTools include review_diff
                const hasReviewDiff = (opts.customTools || []).some(
                    (/** @type {{ name: string }} */ t) => t.name === "review_diff",
                );
                assertEquals(hasReviewDiff, true, "large diff should get review_diff tool");
                // Verify agent definition includes exploration tools
                assertEquals(
                    opts._agentDefOverride.tools.includes("read"),
                    true,
                    "large diff reviewer should have read tool",
                );
                assertEquals(
                    opts._agentDefOverride.tools.includes("grep"),
                    true,
                    "large diff reviewer should have grep tool",
                );
                return Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "The implementation matches the plan." }],
                    }, {
                        role: "toolResult",
                        toolName: "review_complete",
                        details: { outcome: "approved", approved: true, feedback: "" },
                    }]),
                );
            },
            getCodeReviewMode: () => "none",
            mergeExecutionWorktree: () => Promise.resolve(),
            updateWorktreeRegistryEntry: () => Promise.resolve({}),
            recordPlanEvent: () => Promise.resolve({}),
            setActiveAgent: () => {},
        }),
    });

    // The large diff should NOT appear inline in the review prompt
    assertEquals(reviewPrompts[0].includes("line 1999"), false, "full large diff should not be inline");
    // But the compact summary should mention changed files
    assertStringIncludes(reviewPrompts[0], "src/big.js");
    // Should include review_diff instructions
    assertStringIncludes(reviewPrompts[0], "review_diff");
});

Deno.test("runValidationLoop shows retry/cancel menu when reviewer throws an error", async () => {
    const uiAPI = makeUi();
    /** @type {string[]} */
    const promptsSeen = [];

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve("diff --git a/file.js b/file.js\n+change\n"),
            runAgentSession: () => {
                promptsSeen.push("review-invoked");
                throw new Error("Context window exceeded");
            },
            recordWorkflowMetric: (/** @type {any} */ metric) => {
                promptsSeen.push(`metric:${metric.event}`);
                return Promise.resolve(null);
            },
            recordPlanEvent: () => Promise.resolve({}),
            setActiveAgent: () => {},
        }),
    });

    // Should show the retry/cancel prompt - promptSelect was called
    // The existing makeUi() stores promptSelections
    // Since promptSelect returns "stop" (default in makeUi), validation should halt
    assertStringIncludes(
        uiAPI.messages.join(" "),
        "Semantic Reviewer execution failed",
    );
    assertStringIncludes(
        uiAPI.messages.join(" "),
        "User canceled validation",
    );
});

Deno.test("runValidationLoop halts when reviewer returns blank output and user cancels", async () => {
    const uiAPI = makeUi();
    /** @type {string[]} */
    const events = [];

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve("diff --git a/file.js b/file.js\n+change\n"),
            runAgentSession: () =>
                Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "" }],
                    }]),
                ),
            recordWorkflowMetric: (/** @type {any} */ metric) => {
                events.push(metric.event);
                return Promise.resolve(null);
            },
            recordPlanEvent: () => Promise.resolve({}),
            setActiveAgent: () => {},
        }),
    });

    // Since promptSelect returns "stop" (default in makeUi), validation should halt
    assertStringIncludes(
        uiAPI.messages.join(" "),
        "did not call review_complete",
    );
    assertStringIncludes(
        uiAPI.messages.join(" "),
        "User canceled validation",
    );
});

Deno.test("runValidationLoop retries semantic review when user chooses retry", async () => {
    const uiAPI = makeUi();
    /** @type {number} */
    let reviewCalls = 0;

    // Override promptSelect to return "retry" so the retry path is exercised
    uiAPI.promptSelect = () => Promise.resolve("retry");

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve("diff --git a/file.js b/file.js\n+change\n"),
            runAgentSession: () => {
                reviewCalls++;
                if (reviewCalls === 1) {
                    throw new Error("Context window exceeded");
                }
                // Second call succeeds
                return Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "The implementation matches the plan." }],
                    }, {
                        role: "toolResult",
                        toolName: "review_complete",
                        details: { outcome: "approved", approved: true, feedback: "" },
                    }]),
                );
            },
            getCodeReviewMode: () => "none",
            mergeExecutionWorktree: () => Promise.resolve(),
            updateWorktreeRegistryEntry: () => Promise.resolve({}),
            recordPlanEvent: () => Promise.resolve({}),
            setActiveAgent: () => {},
        }),
    });

    assertEquals(reviewCalls, 2, "should retry reviewer session");
    assertStringIncludes(uiAPI.messages.join(" "), "retry completed");
});
