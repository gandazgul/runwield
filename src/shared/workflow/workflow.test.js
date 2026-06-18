import { assertEquals, assertMatch, assertStringIncludes, assertThrows } from "@std/assert";
import {
    buildSlicerRequest,
    createSlicerFinalizeTool,
    ensureSlicerTasks,
    executePlan,
    executeProjectTasks,
    extractAssistantOutput,
    extractTasks,
    materializeSlicerDraft,
    parseTaskWriteScope,
    readLatestPlanOutcome,
    runSlicerAgent,
    selectNonConflictingTasks,
    taskWriteScopesOverlap,
    validateProjectTasks,
} from "./workflow.js";

const noopUiAPI = /** @type {any} */ ({ appendSystemMessage: () => {} });

Deno.test("readLatestPlanOutcome returns the latest plan_written outcome", () => {
    const messages = [
        /** @type {any} */ ({
            role: "toolResult",
            toolName: "plan_written",
            details: { planName: "first", outcome: "feedback" },
        }),
        /** @type {any} */ ({
            role: "toolResult",
            toolName: "plan_written",
            details: {
                planName: "first",
                outcome: "approved_execute",
                tasks: [{ task: 1, assignee: "engineer", dependencies: "", description: "X" }],
                triageMeta: { classification: "FEATURE" },
            },
        }),
    ];
    assertEquals(readLatestPlanOutcome(messages), {
        outcome: "approved_execute",
        planName: "first",
        tasks: [{ task: 1, assignee: "engineer", dependencies: "", description: "X" }],
        triageMeta: { classification: "FEATURE" },
    });
});

Deno.test("readLatestPlanOutcome returns null when no plan_written tool result is present", () => {
    assertEquals(readLatestPlanOutcome([]), null);
});

Deno.test("extractAssistantOutput falls back to task_completed message details", () => {
    const messages = [
        /** @type {any} */ ({
            role: "assistant",
            content: [{
                type: "tool_use",
                name: "task_completed",
                input: { message: "Implemented isolated worktree setup." },
            }],
        }),
        /** @type {any} */ ({
            role: "toolResult",
            toolName: "task_completed",
            details: {
                outcome: "task_completed",
                message: "Implemented isolated worktree setup.",
            },
        }),
    ];

    assertEquals(extractAssistantOutput(messages), "Implemented isolated worktree setup.");
});

Deno.test("extractAssistantOutput handles legacy assistant text shapes", () => {
    assertEquals(
        extractAssistantOutput([
            /** @type {any} */ ({ role: "assistant", content: "Plain legacy summary." }),
        ]),
        "Plain legacy summary.",
    );
    assertEquals(
        extractAssistantOutput([
            /** @type {any} */ ({ role: "assistant", content: [{ contentText: "Content text summary." }] }),
        ]),
        "Content text summary.",
    );
});

Deno.test("extractTasks parses valid markdown table", () => {
    const content = `
## Tasks
| Task | Assignee | Dependencies | Description |
|---|---|---|---|
| 1 | engineer | None | Implement X |
| 2 | tester | 1 | Test X |
`;
    const tasks = extractTasks(content);
    assertEquals(tasks.length, 2);
    assertEquals(tasks[0], {
        task: 1,
        assignee: "engineer",
        dependencies: "None",
        writeScope: "unknown",
        description: "Implement X",
    });
    assertEquals(tasks[1], {
        task: 2,
        assignee: "tester",
        dependencies: "1",
        writeScope: "unknown",
        description: "Test X",
    });
});

Deno.test("extractTasks parses write scope column when present", () => {
    const content = `
## Tasks
| Task | Assignee | Dependencies | Write Scope | Description |
|---|---|---|---|---|
| 1 | engineer | None | src/shared/workflow | Implement workflow scheduling |
| 2 | tester | 1 | none | Integration Point: run validation |
`;
    const tasks = extractTasks(content);
    assertEquals(tasks[0], {
        task: 1,
        assignee: "engineer",
        dependencies: "None",
        writeScope: "src/shared/workflow",
        description: "Implement workflow scheduling",
    });
    assertEquals(tasks[1], {
        task: 2,
        assignee: "tester",
        dependencies: "1",
        writeScope: "none",
        description: "Integration Point: run validation",
    });
});

Deno.test("extractTasks parses markdown table with minor deviations", () => {
    const content = `
## Tasks
| Task | Assignee | Dependencies | Description |
|---|---|---|---|
| 1 | engineer | None | Implement X (no trailing pipe)
| 2 | tester | 1 | Test X |
`;
    const tasks = extractTasks(content);
    assertEquals(tasks.length, 2);
    assertEquals(tasks[0].description, "Implement X (no trailing pipe)");
});

Deno.test("extractTasks parses markdown table with extra whitespace", () => {
    const content = `
## Tasks
| Task | Assignee | Dependencies | Description |
|---|---|---|---|
| 1   |  engineer  |  None  |  Implement X  |
| 2|tester|1|Test X|
`;
    const tasks = extractTasks(content);
    assertEquals(tasks.length, 2);
    assertEquals(tasks[0], {
        task: 1,
        assignee: "engineer",
        dependencies: "None",
        writeScope: "unknown",
        description: "Implement X",
    });
    assertEquals(tasks[1], {
        task: 2,
        assignee: "tester",
        dependencies: "1",
        writeScope: "unknown",
        description: "Test X",
    });
});

Deno.test("extractTasks throws error when section missing", () => {
    const content = `## Plan\nNo tasks here.`;
    assertThrows(() => extractTasks(content), Error, "Tasks section not found");
});

Deno.test("extractTasks throws error when table is empty", () => {
    const content = `
## Tasks
| Task | Assignee | Dependencies | Description |
|---|---|---|---|
`;
    assertThrows(() => extractTasks(content), Error, "Tasks table found but contains no valid task rows");
});

// ── validateProjectTasks ──────────────────────────────────────────

Deno.test("validateProjectTasks accepts a valid PROJECT task DAG with final Integration Point", () => {
    validateProjectTasks([
        { task: 1, assignee: "engineer", dependencies: "none", description: "Implement slice" },
        { task: 2, assignee: "doc-writer", dependencies: "none", description: "Document user-facing behavior" },
        { task: 3, assignee: "tester", dependencies: "1, 2", description: "Integration Point: run validation" },
    ]);
});

Deno.test("validateProjectTasks rejects missing final tester Integration Point", () => {
    assertThrows(
        () =>
            validateProjectTasks([
                { task: 1, assignee: "engineer", dependencies: "none", description: "Implement slice" },
            ]),
        Error,
        "final PROJECT task must be assigned to tester as the Integration Point",
    );
});

Deno.test("validateProjectTasks rejects final tester task that is not labeled Integration Point", () => {
    assertThrows(
        () =>
            validateProjectTasks([
                { task: 1, assignee: "engineer", dependencies: "none", description: "Implement slice" },
                { task: 2, assignee: "tester", dependencies: "1", description: "Run validation" },
            ]),
        Error,
        "identify the task as the Integration Point",
    );
});

Deno.test("validateProjectTasks rejects invalid assignees", () => {
    assertThrows(
        () =>
            validateProjectTasks([
                { task: 1, assignee: "planner", dependencies: "none", description: "Implement slice" },
                { task: 2, assignee: "tester", dependencies: "1", description: "Integration Point: run validation" },
            ]),
        Error,
        "invalid assignee",
    );
});

Deno.test("validateProjectTasks rejects cyclic dependencies", () => {
    assertThrows(
        () =>
            validateProjectTasks([
                { task: 1, assignee: "engineer", dependencies: "2", description: "Implement slice" },
                { task: 2, assignee: "tester", dependencies: "1", description: "Integration Point: run validation" },
            ]),
        Error,
        "cycle",
    );
});

// ── write scope scheduling ───────────────────────────────────────

Deno.test("parseTaskWriteScope treats missing and unknown scopes as broad", () => {
    assertEquals(parseTaskWriteScope(undefined), { broad: true, paths: [] });
    assertEquals(parseTaskWriteScope("unknown"), { broad: true, paths: [] });
    assertEquals(parseTaskWriteScope("src/**"), { broad: true, paths: [] });
});

Deno.test("parseTaskWriteScope treats none as read-only", () => {
    assertEquals(parseTaskWriteScope("none"), { broad: false, paths: [] });
});

Deno.test("taskWriteScopesOverlap detects exact and parent path overlaps", () => {
    assertEquals(
        taskWriteScopesOverlap({ writeScope: "src/shared/workflow" }, {
            writeScope: "src/shared/workflow/workflow.js",
        }),
        true,
    );
    assertEquals(
        taskWriteScopesOverlap({ writeScope: "src/shared/workflow" }, { writeScope: "docs/plan-lifecycle.md" }),
        false,
    );
});

Deno.test("taskWriteScopesOverlap serializes broad scopes but not read-only scopes", () => {
    assertEquals(taskWriteScopesOverlap({ writeScope: "unknown" }, { writeScope: "src/foo.js" }), true);
    assertEquals(taskWriteScopesOverlap({ writeScope: "none" }, { writeScope: "src/foo.js" }), false);
});

Deno.test("selectNonConflictingTasks skips ready tasks that overlap running or selected tasks", () => {
    const ready = [
        { task: 1, writeScope: "src/a.js" },
        { task: 2, writeScope: "src/b.js" },
        { task: 3, writeScope: "src/a.js" },
        { task: 4, writeScope: "unknown" },
    ];
    const running = [{ task: 9, writeScope: "docs" }];
    assertEquals(selectNonConflictingTasks(ready, running, 4), [
        { task: 1, writeScope: "src/a.js" },
        { task: 2, writeScope: "src/b.js" },
    ]);
});

function createWorkflowHarness() {
    /** @type {string[]} */
    const systemMessages = [];
    /** @type {string[]} */
    const agentOutputs = [];
    /** @type {Array<{ type: string, content: string, metadata?: Record<string, unknown> }>} */
    const rootEntries = [];
    /** @type {Array<Array<{ task: number, assignee: string, description: string }>>} */
    const runningSnapshots = [];
    const uiAPI = /** @type {any} */ ({
        appendSystemMessage: (/** @type {string} */ message) => systemMessages.push(String(message)),
        appendAgentMessageStart: () => ({
            appendText: (/** @type {string} */ text) => agentOutputs.push(String(text)),
        }),
    });
    const sessionManager = /** @type {any} */ ({
        appendCustomMessageEntry: (
            /** @type {string} */ type,
            /** @type {string} */ content,
            /** @type {boolean} */ _visible,
            /** @type {Record<string, unknown>} */ metadata,
        ) => rootEntries.push({ type, content, metadata }),
    });
    const onRunningTasksChange = (
        /** @type {Array<{ task: number, assignee: string, description: string }>} */ tasks,
    ) => {
        runningSnapshots.push(tasks.map((task) => ({ ...task })));
    };
    return { agentOutputs, onRunningTasksChange, rootEntries, runningSnapshots, sessionManager, systemMessages, uiAPI };
}

/**
 * @param {string} text
 * @returns {import('@earendil-works/pi-agent-core').AgentMessage[]}
 */
function completedTaskMessages(text) {
    return /** @type {import('@earendil-works/pi-agent-core').AgentMessage[]} */ ([
        { role: "assistant", content: [{ type: "text", text }] },
        { role: "toolResult", toolName: "task_completed", details: { outcome: "task_completed" } },
    ]);
}

/**
 * @returns {Promise<{ debugRoot: string, cleanup: () => Promise<void> }>}
 */
async function setupTempDebugRoot() {
    const debugRoot = await Deno.makeTempDir({ prefix: "harns-workflow-debug-test-" });
    return {
        debugRoot,
        cleanup: async () => {
            await Deno.remove(debugRoot, { recursive: true });
        },
    };
}

Deno.test("executePlan refuses to execute PROJECT Epic containers", async () => {
    /** @type {string[]} */
    const messages = [];
    let engineerCalled = false;
    let projectCalled = false;
    const result = await executePlan(
        "epic-plan",
        { classification: "PROJECT", type: "epic" },
        /** @type {any} */ ({
            appendSystemMessage: (/** @type {string} */ message) => messages.push(String(message)),
        }),
        undefined,
        undefined,
        {
            loadPlan: () =>
                Promise.resolve(
                    /** @type {any} */ ({
                        attrs: { status: "ready_for_work", classification: "PROJECT", type: "epic" },
                        body: "## Epic",
                        markdown: "## Epic",
                    }),
                ),
            executeSingleEngineerPlan: () => {
                engineerCalled = true;
                return Promise.resolve({ repairRequired: false, executionComplete: true });
            },
            executeStructuredProjectPlan: () => {
                projectCalled = true;
                return Promise.resolve({ repairRequired: false, executionComplete: true });
            },
        },
    );

    assertEquals(result.executionComplete, false);
    assertEquals(engineerCalled, false);
    assertEquals(projectCalled, false);
    assertStringIncludes(result.error || "", "PROJECT Epic container");
    assertEquals(messages.some((message) => message.includes("cannot be executed directly")), true);
});

Deno.test("executePlan refuses persisted Epic containers even when triage meta overrides classification", async () => {
    let engineerCalled = false;
    let projectCalled = false;
    const result = await executePlan(
        "epic-plan",
        { classification: "FEATURE", type: "feature" },
        noopUiAPI,
        undefined,
        undefined,
        {
            loadPlan: () =>
                Promise.resolve(
                    /** @type {any} */ ({
                        attrs: { status: "ready_for_work", classification: "PROJECT", type: "epic" },
                        body: "## Epic",
                        markdown: "## Epic",
                    }),
                ),
            executeSingleEngineerPlan: () => {
                engineerCalled = true;
                return Promise.resolve({ repairRequired: false, executionComplete: true });
            },
            executeStructuredProjectPlan: () => {
                projectCalled = true;
                return Promise.resolve({ repairRequired: false, executionComplete: true });
            },
        },
    );

    assertEquals(result.executionComplete, false);
    assertEquals(engineerCalled, false);
    assertEquals(projectCalled, false);
    assertStringIncludes(result.error || "", "PROJECT Epic container");
});

Deno.test("executePlan still executes ready FEATURE plans", async () => {
    let engineerCalled = false;
    /** @type {string[]} */
    const events = [];
    const result = await executePlan(
        "feature-plan",
        { classification: "FEATURE" },
        /** @type {any} */ ({ appendSystemMessage: () => {} }),
        undefined,
        undefined,
        {
            loadPlan: () =>
                Promise.resolve(
                    /** @type {any} */ ({
                        attrs: { status: "ready_for_work", classification: "FEATURE" },
                        body: "## Feature",
                        markdown: "## Feature",
                    }),
                ),
            executeSingleEngineerPlan: ({ triageMeta }) => {
                engineerCalled = true;
                assertEquals(triageMeta.classification, "FEATURE");
                return Promise.resolve({ repairRequired: false, executionComplete: true });
            },
            recordPlanEvent: ({ event }) => {
                events.push(event);
                return Promise.resolve(/** @type {any} */ ({}));
            },
            markActiveWorktreeStatus: () => Promise.resolve(),
        },
    );

    assertEquals(result, { repairRequired: false, executionComplete: true });
    assertEquals(engineerCalled, true);
    assertEquals(events, ["implementation_finished"]);
});

Deno.test("executePlan uses single-plan execution for child FEATURE plans", async () => {
    let engineerCalled = false;
    let projectDagCalled = false;
    const result = await executePlan(
        "epic-a/01-child-feature",
        { classification: "FEATURE", parentPlan: "epic-a" },
        /** @type {any} */ ({ appendSystemMessage: () => {} }),
        [{ task: 1, assignee: "engineer", dependencies: "none", description: "legacy task" }],
        undefined,
        {
            loadPlan: () =>
                Promise.resolve(
                    /** @type {any} */ ({
                        attrs: {
                            status: "ready_for_work",
                            classification: "FEATURE",
                            parentPlan: "epic-a",
                        },
                        body: "## Child FEATURE",
                        markdown: "## Child FEATURE",
                    }),
                ),
            executeSingleEngineerPlan: ({ triageMeta }) => {
                engineerCalled = true;
                assertEquals(triageMeta.parentPlan, "epic-a");
                return Promise.resolve({ repairRequired: false, executionComplete: true });
            },
            executeStructuredProjectPlan: () => {
                projectDagCalled = true;
                return Promise.resolve({ repairRequired: false, executionComplete: true });
            },
            recordPlanEvent: () => Promise.resolve(/** @type {any} */ ({})),
            markActiveWorktreeStatus: () => Promise.resolve(),
        },
    );

    assertEquals(result, { repairRequired: false, executionComplete: true });
    assertEquals(engineerCalled, true);
    assertEquals(projectDagCalled, false);
});

Deno.test("executePlan does not parse task tables or dispatch DAG execution for PROJECT plans", async () => {
    let engineerCalled = false;
    let projectDagCalled = false;
    const result = await executePlan(
        "legacy-project-plan",
        { classification: "PROJECT" },
        /** @type {any} */ ({ appendSystemMessage: () => {} }),
        undefined,
        undefined,
        {
            loadPlan: () =>
                Promise.resolve(
                    /** @type {any} */ ({
                        attrs: { status: "ready_for_work", classification: "PROJECT" },
                        body: "## Design only\nNo Tasks table.",
                        markdown: "## Design only\nNo Tasks table.",
                    }),
                ),
            executeSingleEngineerPlan: ({ triageMeta }) => {
                engineerCalled = true;
                assertEquals(triageMeta.classification, "PROJECT");
                return Promise.resolve({ repairRequired: false, executionComplete: true });
            },
            executeStructuredProjectPlan: () => {
                projectDagCalled = true;
                return Promise.resolve({ repairRequired: false, executionComplete: true });
            },
            recordPlanEvent: () => Promise.resolve(/** @type {any} */ ({})),
            markActiveWorktreeStatus: () => Promise.resolve(),
        },
    );

    assertEquals(result, { repairRequired: false, executionComplete: true });
    assertEquals(engineerCalled, true);
    assertEquals(projectDagCalled, false);
});

Deno.test("executeProjectTasks passes successful dependency output to dependent task request", async () => {
    const debug = await setupTempDebugRoot();
    const tasks = [
        { task: 1, assignee: "engineer", dependencies: "none", writeScope: "src/a.js", description: "Implement alpha" },
        { task: 2, assignee: "tester", dependencies: "1", writeScope: "none", description: "Verify alpha" },
    ];
    /** @type {string[]} */
    const requests = [];
    /** @type {string[]} */
    const rootEntries = [];
    const uiAPI = /** @type {any} */ ({
        appendSystemMessage: () => {},
        appendAgentMessageStart: () => ({ appendText: () => {} }),
    });
    const sessionManager = /** @type {any} */ ({
        appendCustomMessageEntry: (
            /** @type {string} */ _type,
            /** @type {string} */ content,
        ) => rootEntries.push(content),
    });

    try {
        const result = await executeProjectTasks(
            "project-plan",
            "Full plan body",
            tasks,
            uiAPI,
            [],
            undefined,
            sessionManager,
            undefined,
            /** @type {any} */ ((/** @type {any} */ opts) => {
                requests.push(opts.userRequest);
                return Promise.resolve([
                    {
                        role: "assistant",
                        content: [{
                            type: "text",
                            text: opts.agentName === "engineer" ? "Implemented alpha." : "Verified alpha.",
                        }],
                    },
                    { role: "toolResult", toolName: "task_completed", details: { outcome: "task_completed" } },
                ]);
            }),
            { debugRoot: debug.debugRoot },
        );

        assertEquals(result.failedTasks, []);
        assertEquals(rootEntries.length, 2);
        assertStringIncludes(requests[1], "### Dependency Outputs");
        assertStringIncludes(requests[1], rootEntries[0]);
    } finally {
        await debug.cleanup();
    }
});

Deno.test("executeProjectTasks records incomplete tasks and blocks dependents", async () => {
    const debug = await setupTempDebugRoot();
    const tasks = [
        { task: 1, assignee: "engineer", dependencies: "none", writeScope: "src/a.js", description: "Implement alpha" },
        { task: 2, assignee: "tester", dependencies: "1", writeScope: "none", description: "Verify alpha" },
    ];
    const harness = createWorkflowHarness();

    try {
        const result = await executeProjectTasks(
            "project-plan",
            "Full plan body",
            tasks,
            harness.uiAPI,
            [],
            harness.onRunningTasksChange,
            harness.sessionManager,
            undefined,
            () =>
                Promise.resolve(
                    /** @type {import('@earendil-works/pi-agent-core').AgentMessage[]} */ ([
                        { role: "assistant", content: [{ type: "text", text: "I stopped early." }] },
                    ]),
                ),
            { debugRoot: debug.debugRoot },
        );

        assertEquals(result.failedTasks, [1, 2]);
        assertEquals(result.results.get(1)?.status, "failed");
        assertEquals(result.results.get(2)?.status, "blocked");
        assertEquals(harness.rootEntries[0].metadata?.status, "failed");
        assertStringIncludes(harness.rootEntries[0].content, "INCOMPLETE");
        assertEquals(harness.runningSnapshots.map((snapshot) => snapshot.map((task) => task.task)), [[1], []]);
    } finally {
        await debug.cleanup();
    }
});

Deno.test("executeProjectTasks writes per-task logs under explicit temp execution cwd", async () => {
    const previousDebug = Deno.env.get("DEBUG");
    const executionCwd = await Deno.makeTempDir({ prefix: "harns-workflow-log-test-" });
    Deno.env.delete("DEBUG");
    try {
        const tasks = [
            {
                task: 1,
                assignee: "engineer",
                dependencies: "none",
                writeScope: "src/a.js",
                description: "Implement alpha",
            },
        ];
        const harness = createWorkflowHarness();
        /** @type {string | undefined} */
        let debugLogPath;

        const result = await executeProjectTasks(
            "project-plan",
            "Full plan body",
            tasks,
            harness.uiAPI,
            [],
            harness.onRunningTasksChange,
            harness.sessionManager,
            undefined,
            (/** @type {{ debugLogPath?: string }} */ opts) => {
                debugLogPath = opts.debugLogPath;
                return Promise.resolve(completedTaskMessages("Implemented alpha."));
            },
            { executionCwd },
        );

        assertEquals(result.failedTasks, []);
        assertEquals(debugLogPath?.startsWith(`${executionCwd}/`), true);
        assertStringIncludes(debugLogPath || "", "debug-agents/task-1-engineer.log");

        const rootDebug = await Deno.readTextFile(`${executionCwd}/debug.log`);
        assertStringIncludes(rootDebug, "Event: HEADLESS TASK LOG");
        assertStringIncludes(rootDebug, debugLogPath || "");

        const taskDebug = await Deno.readTextFile(debugLogPath || "");
        assertStringIncludes(taskDebug, "Event: HEADLESS TASK START");
        assertStringIncludes(taskDebug, "Event: HEADLESS TASK RESULT");
        assertStringIncludes(taskDebug, '"toolName": "task_completed"');
        assertStringIncludes(taskDebug, "Implemented alpha.");
    } finally {
        if (previousDebug === undefined) {
            Deno.env.delete("DEBUG");
        } else {
            Deno.env.set("DEBUG", previousDebug);
        }
        await Deno.remove(executionCwd, { recursive: true });
    }
});

Deno.test("executeProjectTasks writes DEBUG legacy task logs under explicit debug root", async () => {
    const previousDebug = Deno.env.get("DEBUG");
    const debugRoot = await Deno.makeTempDir({ prefix: "harns-debug-root-test-" });
    Deno.env.set("DEBUG", "1");
    try {
        const tasks = [
            {
                task: 1,
                assignee: "engineer",
                dependencies: "none",
                writeScope: "src/a.js",
                description: "Implement alpha",
            },
        ];
        const harness = createWorkflowHarness();
        /** @type {string | undefined} */
        let debugLogPath;

        const result = await executeProjectTasks(
            "project-plan",
            "Full plan body",
            tasks,
            harness.uiAPI,
            [],
            harness.onRunningTasksChange,
            harness.sessionManager,
            undefined,
            (/** @type {{ debugLogPath?: string }} */ opts) => {
                debugLogPath = opts.debugLogPath;
                return Promise.resolve(completedTaskMessages("Implemented alpha."));
            },
            { debugRoot },
        );

        assertEquals(result.failedTasks, []);
        assertEquals(debugLogPath?.startsWith(`${debugRoot}/`), true);
        assertStringIncludes(debugLogPath || "", "debug-agents/task-1-engineer.log");
        const rootDebug = await Deno.readTextFile(`${debugRoot}/debug.log`);
        assertStringIncludes(rootDebug, "Event: HEADLESS TASK LOG");
    } finally {
        if (previousDebug === undefined) {
            Deno.env.delete("DEBUG");
        } else {
            Deno.env.set("DEBUG", previousDebug);
        }
        await Deno.remove(debugRoot, { recursive: true });
    }
});

Deno.test("executeProjectTasks records thrown task errors and blocks dependents", async () => {
    const debug = await setupTempDebugRoot();
    const tasks = [
        { task: 1, assignee: "engineer", dependencies: "none", writeScope: "src/a.js", description: "Implement alpha" },
        { task: 2, assignee: "tester", dependencies: "1", writeScope: "none", description: "Verify alpha" },
    ];
    const harness = createWorkflowHarness();

    try {
        const result = await executeProjectTasks(
            "project-plan",
            "Full plan body",
            tasks,
            harness.uiAPI,
            [],
            harness.onRunningTasksChange,
            harness.sessionManager,
            undefined,
            () => {
                throw new Error("agent crashed");
            },
            { debugRoot: debug.debugRoot },
        );

        assertEquals(result.failedTasks, [1, 2]);
        assertEquals(result.results.get(1)?.error, "agent crashed");
        assertEquals(result.results.get(2)?.status, "blocked");
        assertEquals(harness.rootEntries[0].metadata?.error, "agent crashed");
        assertStringIncludes(harness.systemMessages.join("\n"), "Task 1 failed");
    } finally {
        await debug.cleanup();
    }
});

Deno.test("executeProjectTasks retries only failed tasks with seeded dependency context", async () => {
    const debug = await setupTempDebugRoot();
    const tasks = [
        { task: 1, assignee: "engineer", dependencies: "none", writeScope: "src/a.js", description: "Implement alpha" },
        { task: 2, assignee: "tester", dependencies: "1", writeScope: "none", description: "Verify alpha" },
    ];
    /** @type {Map<number, import('./types.js').TaskExecutionResult>} */
    const seedResults = new Map([
        [1, {
            status: "success",
            output: "Implemented alpha.",
            display: "Task 1 (Engineer) — Implement alpha\n\nImplemented alpha.",
        }],
    ]);
    /** @type {string[]} */
    const requests = [];
    const harness = createWorkflowHarness();

    try {
        const result = await executeProjectTasks(
            "project-plan",
            "Full plan body",
            tasks,
            harness.uiAPI,
            [2],
            harness.onRunningTasksChange,
            harness.sessionManager,
            seedResults,
            (/** @type {{ userRequest: string }} */ opts) => {
                requests.push(opts.userRequest);
                return Promise.resolve(completedTaskMessages("Verified alpha."));
            },
            { debugRoot: debug.debugRoot },
        );

        assertEquals(result.failedTasks, []);
        assertEquals(requests.length, 1);
        assertStringIncludes(requests[0], "### Dependency Outputs");
        assertStringIncludes(requests[0], "Implemented alpha.");
        assertEquals(result.results.get(1)?.status, "success");
        assertEquals(result.results.get(2)?.status, "success");
        assertEquals(harness.rootEntries.length, 1);
        assertEquals(harness.rootEntries[0].metadata?.taskId, 2);
    } finally {
        await debug.cleanup();
    }
});

// ── buildSlicerRequest ─────────────────────────────────────────────

Deno.test("buildSlicerRequest includes plan name and base instructions", () => {
    const text = buildSlicerRequest("my-plan", undefined);
    assertStringIncludes(text, "Slice Plan: my-plan");
    assertStringIncludes(text, "plans/my-plan.md");
    assertStringIncludes(text, "system prompt");
    // Without triage meta, the report block must not appear.
    assertEquals(text.includes("Triage Report"), false);
});

Deno.test("buildSlicerRequest includes triage report fields when present", () => {
    const text = buildSlicerRequest("my-plan", {
        classification: "PROJECT",
        complexity: "HIGH",
        summary: "Initialize Harns",
        affectedPaths: ["src/foo.js", "src/bar.js"],
    });
    assertStringIncludes(text, "Triage Report");
    assertStringIncludes(text, "Classification: PROJECT");
    assertStringIncludes(text, "Complexity: HIGH");
    assertStringIncludes(text, "Summary: Initialize Harns");
    assertStringIncludes(text, "src/foo.js, src/bar.js");
});

Deno.test("buildSlicerRequest omits empty affectedPaths", () => {
    const text = buildSlicerRequest("p", {
        classification: "PROJECT",
        complexity: "LOW",
        summary: "x",
        affectedPaths: [],
    });
    assertEquals(text.includes("Affected paths"), false);
});

// ── runSlicerAgent ─────────────────────────────────────────────────

Deno.test("runSlicerAgent returns ok=true when session resolves", async () => {
    let captured = /** @type {any} */ (null);
    /** @type {string[]} */
    const loadedPaths = [];
    const result = await runSlicerAgent({
        planName: "my-plan",
        triageMeta: { classification: "PROJECT", complexity: "LOW", summary: "x", affectedPaths: [] },
        uiAPI: noopUiAPI,
        __deps: {
            ensureBundledAgentDefFile: (relativePath) =>
                Promise.resolve(`/tmp/bundled-agent-definitions/${relativePath}`),
            loadAgentDefFromPath: (path, opts) => {
                loadedPaths.push(`${path}:${opts?.agentName}`);
                return Promise.resolve(/** @type {any} */ ({ displayName: "Slicer" }));
            },
            runAgentSession: (opts) => {
                captured = opts;
                return Promise.resolve([]);
            },
        },
    });
    assertEquals(result.ok, true);
    assertEquals(loadedPaths, ["/tmp/bundled-agent-definitions/workflow-prompts/slicer-prompt.md:slicer"]);
    assertEquals(captured.agentName, "slicer");
    assertStringIncludes(captured.userRequest, "my-plan");
});

Deno.test("runSlicerAgent surfaces session errors as { ok:false, error }", async () => {
    const result = await runSlicerAgent({
        planName: "p",
        uiAPI: noopUiAPI,
        __deps: {
            runAgentSession: () => {
                throw new Error("boom");
            },
        },
    });
    assertEquals(result.ok, false);
    assertEquals(result.error, "boom");
});

Deno.test("runSlicerAgent surfaces non-Error throws as string", async () => {
    const result = await runSlicerAgent({
        planName: "p",
        uiAPI: noopUiAPI,
        __deps: {
            runAgentSession: () => {
                throw "string failure";
            },
        },
    });
    assertEquals(result.ok, false);
    assertEquals(result.error, "string failure");
});

Deno.test("runSlicerAgent handles success via uiAPI when present", async () => {
    /** @type {string[]} */
    const messages = [];
    const uiAPI = /** @type {any} */ ({
        appendSystemMessage: (/** @type {string} */ msg) => messages.push(String(msg)),
    });
    const result = await runSlicerAgent({
        planName: "p",
        uiAPI,
        __deps: { runAgentSession: () => Promise.resolve([]) },
    });
    assertEquals(result.ok, true);
});

Deno.test("runSlicerAgent reports failure via uiAPI when present", async () => {
    /** @type {string[]} */
    const messages = [];
    const uiAPI = /** @type {any} */ ({
        appendSystemMessage: (/** @type {string} */ msg) => messages.push(String(msg)),
    });
    await runSlicerAgent({
        planName: "p",
        uiAPI,
        __deps: {
            runAgentSession: () => {
                throw new Error("kaboom");
            },
        },
    });
    assertEquals(messages.some((m) => m.includes("Slicer failed: kaboom")), true);
});

Deno.test("createSlicerFinalizeTool finalizes approved Epic with child FEATURE plans", async () => {
    /** @type {any} */
    let recorded = null;
    const tool = createSlicerFinalizeTool({
        planName: "epic-a",
        cwd: "/repo",
        __deps: {
            loadPlan: () =>
                Promise.resolve(
                    /** @type {any} */ ({
                        attrs: { classification: "PROJECT", type: "epic", status: "approved" },
                    }),
                ),
            findPlansByParent: () =>
                Promise.resolve([
                    /** @type {any} */ ({
                        name: "epic-a/01-child",
                        attrs: { classification: "FEATURE" },
                    }),
                ]),
            recordPlanEvent: (args) => {
                recorded = args;
                return Promise.resolve(/** @type {any} */ ({ status: "ready_for_work" }));
            },
        },
    });

    const result = await tool.execute(
        "call-1",
        { confirmation: "yes, finalize" },
        new AbortController().signal,
        () => {},
        /** @type {any} */ ({}),
    );

    assertEquals(recorded.event, "decomposition_finalized");
    assertEquals(recorded.currentStatus, "approved");
    assertEquals(result.details, {
        status: "ready_for_work",
        children: ["epic-a/01-child"],
        error: "",
    });
});

Deno.test("materializeSlicerDraft delegates child FEATURE draft writes", async () => {
    /** @type {Array<{ cwd: string, epicPlanName: string, descriptors: unknown[] }>} */
    const calls = [];
    const children = [{
        sequence: 1,
        title: "Draft child",
        summary: "Draft summary",
        affectedPaths: ["src/plan-store.js"],
        dependencies: [],
        content: "# Draft child",
    }];
    const result = await materializeSlicerDraft({
        cwd: "/repo",
        epicPlanName: "epic-a",
        children,
        __deps: {
            saveChildFeaturePlans: (cwd, epicPlanName, descriptors) => {
                calls.push({ cwd, epicPlanName, descriptors });
                return Promise.resolve([{
                    name: "epic-a/01-draft-child",
                    path: "/repo/plans/epic-a/01-draft-child.md",
                    title: "Draft child",
                    action: "created",
                    dependencies: [],
                    metadata: {
                        classification: "FEATURE",
                        status: "draft",
                        parentPlan: "epic-a",
                        affectedPaths: ["src/plan-store.js"],
                    },
                }]);
            },
        },
    });

    assertEquals(calls, [{ cwd: "/repo", epicPlanName: "epic-a", descriptors: children }]);
    assertEquals(result[0].name, "epic-a/01-draft-child");
});

// ── ensureSlicerTasks ──────────────────────────────────────────────

Deno.test("ensureSlicerTasks opens Epic decomposition without reading a task table", async () => {
    let slicerCalls = 0;
    let readCalls = 0;
    const result = await ensureSlicerTasks({
        planName: "epic-a",
        planPath: "/tmp/epic-a.md",
        triageMeta: /** @type {any} */ ({ classification: "PROJECT", type: "epic", status: "approved" }),
        uiAPI: noopUiAPI,
        __deps: {
            readTextFile: () => {
                readCalls++;
                return Promise.resolve("# Epic");
            },
            runSlicerAgent: (opts) => {
                slicerCalls++;
                assertEquals(opts.planName, "epic-a");
                return Promise.resolve({ ok: true });
            },
        },
    });

    assertEquals(result, { ok: true, slicerInvoked: true });
    assertEquals(readCalls, 0);
    assertEquals(slicerCalls, 1);
});

Deno.test("ensureSlicerTasks opens decomposition when persisted plan is an Epic", async () => {
    let slicerCalls = 0;
    const result = await ensureSlicerTasks({
        planName: "epic-a",
        planPath: "/tmp/epic-a.md",
        uiAPI: noopUiAPI,
        __deps: {
            readTextFile: () =>
                Promise.resolve([
                    "---",
                    "classification: PROJECT",
                    "type: epic",
                    "status: approved",
                    "---",
                    "# Epic",
                ].join("\n")),
            runSlicerAgent: (opts) => {
                slicerCalls++;
                assertEquals(opts.triageMeta?.type, "epic");
                return Promise.resolve({ ok: true });
            },
        },
    });

    assertEquals(result, { ok: true, slicerInvoked: true });
    assertEquals(slicerCalls, 1);
});

Deno.test("ensureSlicerTasks returns persisted Epic slicer throws as slicer failure", async () => {
    let slicerCalls = 0;
    const result = await ensureSlicerTasks({
        planName: "epic-a",
        planPath: "/tmp/epic-a.md",
        uiAPI: noopUiAPI,
        __deps: {
            readTextFile: () =>
                Promise.resolve([
                    "---",
                    "classification: PROJECT",
                    "type: epic",
                    "status: approved",
                    "---",
                    "# Epic",
                ].join("\n")),
            runSlicerAgent: () => {
                slicerCalls++;
                throw new Error("agent definition unavailable");
            },
        },
    });

    assertEquals(result, { ok: false, error: "agent definition unavailable", stage: "slicer" });
    assertEquals(slicerCalls, 1);
});

Deno.test("ensureSlicerTasks skips slicer when Tasks already parseable (resumed plan)", async () => {
    let slicerCalls = 0;
    const result = await ensureSlicerTasks({
        planName: "p",
        planPath: "/tmp/p.md",
        uiAPI: noopUiAPI,
        __deps: {
            readTextFile: () =>
                Promise.resolve("## Tasks\n| Task | A | B | C |\n|-|-|-|-|\n| 1 | engineer | none | x |"),
            extractTasks: () => [
                { task: 1, assignee: "engineer", dependencies: "none", writeScope: "src/x.js", description: "x" },
                {
                    task: 2,
                    assignee: "tester",
                    dependencies: "1",
                    writeScope: "none",
                    description: "Integration Point: run validation",
                },
            ],
            runSlicerAgent: () => {
                slicerCalls++;
                return Promise.resolve({ ok: true });
            },
        },
    });
    assertEquals(result.ok, true);
    assertEquals(/** @type {any} */ (result).slicerInvoked, false);
    assertEquals(slicerCalls, 0);
});

Deno.test("ensureSlicerTasks invokes slicer when Tasks missing", async () => {
    let slicerCalls = 0;
    let parseCalls = 0;
    const result = await ensureSlicerTasks({
        planName: "p",
        planPath: "/tmp/p.md",
        uiAPI: noopUiAPI,
        __deps: {
            readTextFile: () => Promise.resolve("design only, no tasks"),
            extractTasks: () => {
                parseCalls++;
                if (parseCalls === 1) throw new Error("Tasks section not found");
                return [
                    { task: 1, assignee: "engineer", dependencies: "none", writeScope: "src/x.js", description: "x" },
                    {
                        task: 2,
                        assignee: "tester",
                        dependencies: "1",
                        writeScope: "none",
                        description: "Integration Point: run validation",
                    },
                ];
            },
            runSlicerAgent: () => {
                slicerCalls++;
                return Promise.resolve({ ok: true });
            },
        },
    });
    assertEquals(result.ok, true);
    assertEquals(/** @type {any} */ (result).slicerInvoked, true);
    assertEquals(slicerCalls, 1);
});

Deno.test("ensureSlicerTasks returns { ok:false, stage:'slicer' } when slicer fails", async () => {
    const result = await ensureSlicerTasks({
        planName: "p",
        planPath: "/tmp/p.md",
        uiAPI: noopUiAPI,
        __deps: {
            readTextFile: () => Promise.resolve("design only"),
            extractTasks: () => {
                throw new Error("Tasks section not found");
            },
            runSlicerAgent: () => Promise.resolve({ ok: false, error: "model timeout" }),
        },
    });
    assertEquals(result.ok, false);
    assertEquals(/** @type {any} */ (result).stage, "slicer");
    assertEquals(/** @type {any} */ (result).error, "model timeout");
});

Deno.test("ensureSlicerTasks returns { ok:false, stage:'validation' } when slicer output is unparseable", async () => {
    let parseCalls = 0;
    const result = await ensureSlicerTasks({
        planName: "p",
        planPath: "/tmp/p.md",
        uiAPI: noopUiAPI,
        __deps: {
            readTextFile: () => Promise.resolve("design only"),
            extractTasks: () => {
                parseCalls++;
                throw new Error(parseCalls === 1 ? "Tasks section not found" : "malformed table");
            },
            runSlicerAgent: () => Promise.resolve({ ok: true }),
        },
    });
    assertEquals(result.ok, false);
    assertEquals(/** @type {any} */ (result).stage, "validation");
    assertMatch(/** @type {any} */ (result).error, /malformed table/);
});

Deno.test("ensureSlicerTasks falls back to slicer error message when error is missing", async () => {
    const result = await ensureSlicerTasks({
        planName: "p",
        planPath: "/tmp/p.md",
        uiAPI: noopUiAPI,
        __deps: {
            readTextFile: () => Promise.resolve("design only"),
            extractTasks: () => {
                throw new Error("Tasks section not found");
            },
            runSlicerAgent: () => Promise.resolve({ ok: false }),
        },
    });
    assertEquals(result.ok, false);
    assertEquals(/** @type {any} */ (result).stage, "slicer");
    assertEquals(/** @type {any} */ (result).error, "slicer failed");
});
