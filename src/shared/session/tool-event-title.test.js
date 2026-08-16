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
    assertEquals(describeRuntimeTool("write_docs", { path: "docs/report.md" }), {
        toolName: "write_docs",
        title: "write_docs docs/report.md",
        kind: "edit",
    });
    assertEquals(describeRuntimeTool("edit_docs", { path: "docs/report.md" }), {
        toolName: "edit_docs",
        title: "edit_docs docs/report.md",
        kind: "edit",
    });
    assertEquals(describeRuntimeTool("grep", { pattern: "SessionRuntime", path: ["src", "tests"] }), {
        toolName: "grep",
        title: "grep SessionRuntime in src tests",
        kind: "search",
    });
    assertEquals(describeRuntimeTool("plan_written", { planName: "runtime-boundary.md" }), {
        toolName: "plan_written",
        title: "plan_written docs/plans/runtime-boundary.md",
        kind: "other",
    });
    assertEquals(
        describeRuntimeTool("pair_checkpoint", {
            summary: "Rendered the responsive account settings form with validation states and diagnostics",
        }),
        {
            toolName: "pair_checkpoint",
            title: "pair_checkpoint Rendered the responsive account settings form with valida...",
            kind: "other",
        },
    );
    assertEquals(describeRuntimeTool("memory", { action: "recall", query: "docs style" }), {
        toolName: "memory",
        title: "memory docs style",
        kind: "search",
    });
    assertEquals(describeRuntimeTool("memory", { action: "store", content: "Keep docs concise" }), {
        toolName: "memory",
        title: "memory Keep docs concise",
        kind: "edit",
    });
    assertEquals(describeRuntimeTool("memory", { action: "delete", id: 42 }), {
        toolName: "memory",
        title: "memory id: 42",
        kind: "delete",
    });
    assertEquals(describeRuntimeTool("memory_store", { content: "Historical transcript memory" }), {
        toolName: "memory_store",
        title: "memory_store Historical transcript memory",
        kind: "other",
    });
    assertEquals(describeRuntimeTool("memory_recall_global", { query: "Historical transcript query" }), {
        toolName: "memory_recall_global",
        title: "memory_recall_global Historical transcript query",
        kind: "search",
    });
    assertEquals(describeRuntimeTool("work_record_search", { query: "prior auth work" }), {
        toolName: "work_record_search",
        title: "work_record_search prior auth work",
        kind: "search",
    });
    assertEquals(describeRuntimeTool("work_record_read", { recordId: "11111111-1111-4111-8111-111111111111" }), {
        toolName: "work_record_read",
        title: "work_record_read 11111111-1111-4111-8111-111111111111",
        kind: "read",
    });
    assertEquals(describeRuntimeTool("return_to_router", {}), {
        toolName: "return_to_router",
        title: "return_to_router",
        kind: "switch_mode",
    });
    assertEquals(describeRuntimeTool("delegate_agent", { mode: "write", brief: "Repair the execution worktree" }), {
        toolName: "delegate_agent",
        title: "delegate_agent write: Repair the execution worktree",
        kind: "think",
    });
});
