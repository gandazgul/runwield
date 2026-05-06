import { assertEquals, assertThrows } from "@std/assert";
import { buildDeniedFeedbackRequest, extractTasks } from "./workflow.js";

Deno.test("buildDeniedFeedbackRequest includes feedback and plan path", () => {
    const prompt = buildDeniedFeedbackRequest({
        round: 2,
        planName: "my-plan",
        feedback: "Please add verification details",
    });

    const expected = "## Previous Plan Feedback (Round 2)\n\nYour plan was denied. Here is the structured feedback from the user:\n\nPlease add verification details\n\nPlease revise your plan in plans/my-plan.md based on this feedback.\nUse the `edit` tool to make targeted revisions — do NOT rewrite the entire plan.\nAddress each piece of feedback specifically.\nAfter saving revisions, call the plan_written tool again with the same plan name.";
    assertEquals(prompt, expected);
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
    assertThrows(() => extractTasks(content), Error, "Tasks table not found");
});

Deno.test("extractTasks throws error when table is empty", () => {
    const content = `
### Tasks
| Task | Assignee | Dependencies | Description |
|---|---|---|---|
`;
    assertThrows(() => extractTasks(content), Error, "Tasks table found but contains no valid task rows");
});
