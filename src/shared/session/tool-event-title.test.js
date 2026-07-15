import { assertEquals } from "@std/assert";
import { describeRuntimeTool } from "./tool-event-title.js";

Deno.test("Runtime provides one stable tool descriptor for live, replay, TUI, ACP, and future consumers", () => {
    assertEquals(describeRuntimeTool("bash", { command: "git status" }), {
        toolName: "bash",
        title: "$ git status",
        kind: "execute",
    });
    assertEquals(describeRuntimeTool("read", { path: "README.md" }), {
        toolName: "read",
        title: "read README.md",
        kind: "read",
    });
    assertEquals(describeRuntimeTool("grep", { pattern: "SessionRuntime", path: ["src", "tests"] }), {
        toolName: "grep",
        title: "grep SessionRuntime in src tests",
        kind: "search",
    });
    assertEquals(describeRuntimeTool("plan_written", { planName: "runtime-boundary.md" }), {
        toolName: "plan_written",
        title: "plan_written plans/runtime-boundary.md",
        kind: "other",
    });
});
