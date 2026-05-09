import { assertEquals, assertThrows } from "@std/assert";
import { extractTasks, readLatestPlanOutcome } from "./workflow.js";

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
### Tasks
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
### Tasks
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
### Tasks
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
### Tasks
| Task | Assignee | Dependencies | Description |
|---|---|---|---|
`;
    assertThrows(() => extractTasks(content), Error, "Tasks table found but contains no valid task rows");
});
