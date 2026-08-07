import { assertEquals, assertStringIncludes } from "@std/assert";
import { buildValidationRepairPrompt } from "./validation-repair-prompt.ts";

Deno.test("independent validation repair packet links the Plan and carries worktree context", () => {
    const prompt = buildValidationRepairPrompt({
        planName: "epic/child",
        projectRoot: "/project",
        executionCwd: "/worktrees/child",
        repairCwd: "/worktrees/child",
        repairsNeeded: "CI failed with TS2741.",
        worktreeId: "wt-123",
        worktreeBranch: "worktree/child",
        worktreeBaseBranch: "main",
    });

    assertStringIncludes(prompt, "This is an independent repair session.");
    assertStringIncludes(prompt, "[docs/plans/epic/child.md](</worktrees/child/docs/plans/epic/child.md>)");
    assertStringIncludes(prompt, "Repair checkout: `/worktrees/child`");
    assertStringIncludes(prompt, "Primary project root: `/project`");
    assertStringIncludes(prompt, "Worktree ID: `wt-123`");
    assertStringIncludes(prompt, "Worktree branch: `worktree/child`");
    assertStringIncludes(prompt, "Target branch: `main`");
    assertStringIncludes(prompt, "CI failed with TS2741.");
    assertStringIncludes(prompt, "call task_completed again");
});

Deno.test("independent validation repair packet does not inline the approved Plan", () => {
    const prompt = buildValidationRepairPrompt({
        planName: "feature",
        projectRoot: "/project",
        executionCwd: "/execution",
        repairCwd: "/merge-repair",
        repairsNeeded: "Resolve the content conflict.",
        authorityNote: "Human feedback is authoritative.",
        completionInstruction: "Report one disposition per finding, then call task_completed.",
    });

    assertStringIncludes(prompt, "Original execution worktree: `/execution`");
    assertStringIncludes(prompt, "Human feedback is authoritative.");
    assertStringIncludes(prompt, "Report one disposition per finding, then call task_completed.");
    assertEquals(prompt.includes("### Approved Plan"), false);
});

Deno.test("independent QUICK_FIX repair packet does not claim a Plan exists", () => {
    const prompt = buildValidationRepairPrompt({
        planName: "quick-fix",
        projectRoot: "/project",
        executionCwd: "/project",
        repairCwd: "/project",
        repairsNeeded: "Fix the failing check.",
        includePlanLink: false,
    });

    assertEquals(prompt.includes("Approved Plan file"), false);
    assertEquals(prompt.includes("Read the Plan file"), false);
});
