import { assertEquals, assertMatch, assertStringIncludes, assertThrows } from "@std/assert";
import {
    buildSlicerRequest,
    ensureSlicerTasks,
    extractTasks,
    readLatestPlanOutcome,
    runSlicerAgent,
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
    assertEquals(tasks[0], { task: 1, assignee: "engineer", dependencies: "None", description: "Implement X" });
    assertEquals(tasks[1], { task: 2, assignee: "tester", dependencies: "1", description: "Test X" });
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
    assertEquals(tasks[0], { task: 1, assignee: "engineer", dependencies: "None", description: "Implement X" });
    assertEquals(tasks[1], { task: 2, assignee: "tester", dependencies: "1", description: "Test X" });
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

Deno.test("validateProjectTasks accepts a valid PROJECT task DAG with final tester verification", () => {
    validateProjectTasks([
        { task: 1, assignee: "engineer", dependencies: "none", description: "Implement slice" },
        { task: 2, assignee: "doc-writer", dependencies: "none", description: "Document user-facing behavior" },
        { task: 3, assignee: "tester", dependencies: "1, 2", description: "Run full verification command" },
    ]);
});

Deno.test("validateProjectTasks rejects missing final tester verification task", () => {
    assertThrows(
        () =>
            validateProjectTasks([
                { task: 1, assignee: "engineer", dependencies: "none", description: "Implement slice" },
            ]),
        Error,
        "final PROJECT task must be assigned to tester",
    );
});

Deno.test("validateProjectTasks rejects invalid assignees", () => {
    assertThrows(
        () =>
            validateProjectTasks([
                { task: 1, assignee: "planner", dependencies: "none", description: "Implement slice" },
                { task: 2, assignee: "tester", dependencies: "1", description: "Run verification" },
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
                { task: 2, assignee: "tester", dependencies: "1", description: "Run verification" },
            ]),
        Error,
        "cycle",
    );
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
    const result = await runSlicerAgent({
        planName: "my-plan",
        triageMeta: { classification: "PROJECT", complexity: "LOW", summary: "x", affectedPaths: [] },
        uiAPI: noopUiAPI,
        __deps: {
            runAgentSession: (opts) => {
                captured = opts;
                return Promise.resolve([]);
            },
        },
    });
    assertEquals(result.ok, true);
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

Deno.test("runSlicerAgent reports progress via uiAPI when present", async () => {
    /** @type {string[]} */
    const messages = [];
    const uiAPI = /** @type {any} */ ({
        appendSystemMessage: (/** @type {string} */ msg) => messages.push(String(msg)),
    });
    await runSlicerAgent({
        planName: "p",
        uiAPI,
        __deps: { runAgentSession: () => Promise.resolve([]) },
    });
    assertEquals(messages.some((m) => m.includes("Running Slicer")), true);
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

// ── ensureSlicerTasks ──────────────────────────────────────────────

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
                { task: 1, assignee: "engineer", dependencies: "none", description: "x" },
                { task: 2, assignee: "tester", dependencies: "1", description: "Run verification" },
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
                    { task: 1, assignee: "engineer", dependencies: "none", description: "x" },
                    { task: 2, assignee: "tester", dependencies: "1", description: "Run verification" },
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
