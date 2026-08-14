import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { loadPlan, savePlan } from "../../plan-store.js";
import { stageValidationPassedInExecutionWorktree } from "./plan-lifecycle.js";
import {
    applyValidationPlanAmendment,
    detectValidationPlanAmendment,
    validateAmendedObjectiveChecksAgainstBaseline,
} from "./validation-plan-amendment.ts";

async function run(cwd: string, args: string[]) {
    const output = await new Deno.Command("git", { cwd, args, stdout: "piped", stderr: "piped" }).output();
    if (output.code !== 0) throw new Error(new TextDecoder().decode(output.stderr));
    return new TextDecoder().decode(output.stdout).trim();
}

Deno.test("worktree Objective Check amendment becomes canonical only after user approval", async () => {
    const projectRoot = await Deno.makeTempDir();
    const executionCwd = await Deno.makeTempDir();
    try {
        await savePlan(projectRoot, "feature", "# Primary body", {
            planId: "plan-1",
            classification: "PLANNED_CHANGE",
            status: "implemented",
            summary: "Primary",
            worktreeId: "runwield-owned",
            objectiveChecks: [{ id: "OC1", command: "deno eval -A 'Deno.exit(1)'" }],
            objectiveCheckWaivers: [{
                id: "OC1",
                command: "deno eval -A 'Deno.exit(1)'",
                source: "engineer_report",
                explanation: "old command",
                waivedAt: "2026-01-01T00:00:00.000Z",
            }],
        });
        await savePlan(executionCwd, "feature", "# Accepted body", {
            planId: "plan-1",
            classification: "PLANNED_CHANGE",
            status: "verified",
            summary: "Worktree",
            worktreeId: "tampered",
            objectiveChecks: [{ id: "OC1", command: "deno eval 'Deno.exit(1)'" }],
        });

        const proposal = await detectValidationPlanAmendment(projectRoot, executionCwd, "feature");
        assertEquals(proposal?.objectiveChecksChanged, true);
        assertStringIncludes(proposal?.summary || "", "objectiveChecks.OC1.command");
        const before = await loadPlan(projectRoot, "feature");
        assertEquals(before?.attrs.objectiveChecks?.[0].command, "deno eval -A 'Deno.exit(1)'");

        if (!proposal) throw new Error("expected amendment proposal");
        await applyValidationPlanAmendment(projectRoot, executionCwd, "feature", proposal);
        const primary = await loadPlan(projectRoot, "feature");
        const execution = await loadPlan(executionCwd, "feature");
        assertEquals(primary?.body, "# Accepted body");
        assertEquals(primary?.attrs.summary, "Worktree");
        assertEquals(primary?.attrs.status, "implemented");
        assertEquals(primary?.attrs.worktreeId, "runwield-owned");
        assertEquals(primary?.attrs.objectiveChecks?.[0].command, "deno eval 'Deno.exit(1)'");
        assertEquals(primary?.attrs.objectiveChecksBaseline, undefined);
        assertEquals(primary?.attrs.objectiveCheckWaivers, []);
        assertEquals(execution?.markdown, primary?.markdown);
    } finally {
        await Deno.remove(projectRoot, { recursive: true }).catch(() => undefined);
        await Deno.remove(executionCwd, { recursive: true }).catch(() => undefined);
    }
});

Deno.test("missing execution Plan fails closed instead of being ignored", async () => {
    const projectRoot = await Deno.makeTempDir();
    const executionCwd = await Deno.makeTempDir();
    try {
        await savePlan(projectRoot, "feature", "# Primary body", {
            planId: "plan-1",
            classification: "PLANNED_CHANGE",
            status: "implemented",
            summary: "Primary",
        });

        await assertRejects(
            () => detectValidationPlanAmendment(projectRoot, executionCwd, "feature"),
            Error,
            "Execution-worktree Plan is missing and validation cannot safely continue",
        );
    } finally {
        await Deno.remove(projectRoot, { recursive: true }).catch(() => undefined);
        await Deno.remove(executionCwd, { recursive: true }).catch(() => undefined);
    }
});

Deno.test("execution Plan without matching identity fails closed", async () => {
    const projectRoot = await Deno.makeTempDir();
    const executionCwd = await Deno.makeTempDir();
    try {
        await savePlan(projectRoot, "feature", "# Primary body", {
            planId: "plan-1",
            classification: "PLANNED_CHANGE",
            status: "implemented",
            summary: "Primary",
        });
        await savePlan(executionCwd, "feature", "# Changed body", {
            classification: "PLANNED_CHANGE",
            status: "implemented",
            summary: "Worktree",
        });

        await assertRejects(
            () => detectValidationPlanAmendment(projectRoot, executionCwd, "feature"),
            Error,
            "Execution-worktree Plan identity is missing for feature",
        );
    } finally {
        await Deno.remove(projectRoot, { recursive: true }).catch(() => undefined);
        await Deno.remove(executionCwd, { recursive: true }).catch(() => undefined);
    }
});

Deno.test("Objective Check rationale amendments are proposed", async () => {
    const projectRoot = await Deno.makeTempDir();
    const executionCwd = await Deno.makeTempDir();
    try {
        await savePlan(projectRoot, "feature", "# Body", {
            planId: "plan-1",
            classification: "PLANNED_CHANGE",
            status: "implemented",
            summary: "Plan",
            objectiveChecks: [{ id: "OC1", command: "false", rationale: "old reason" }],
        });
        await savePlan(executionCwd, "feature", "# Body", {
            planId: "plan-1",
            classification: "PLANNED_CHANGE",
            status: "implemented",
            summary: "Plan",
            objectiveChecks: [{ id: "OC1", command: "false", rationale: "new reason" }],
        });

        const proposal = await detectValidationPlanAmendment(projectRoot, executionCwd, "feature");
        assertEquals(proposal?.objectiveChecksChanged, true);
        assertStringIncludes(proposal?.summary || "", "objectiveChecks.OC1.rationale");
    } finally {
        await Deno.remove(projectRoot, { recursive: true }).catch(() => undefined);
        await Deno.remove(executionCwd, { recursive: true }).catch(() => undefined);
    }
});

Deno.test("changed Objective Checks are proven red against the recorded execution baseline", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await run(cwd, ["init"]);
        await run(cwd, ["config", "user.email", "test@example.com"]);
        await run(cwd, ["config", "user.name", "RunWield Test"]);
        await Deno.writeTextFile(`${cwd}/README.md`, "baseline\n");
        await run(cwd, ["add", "."]);
        await run(cwd, ["commit", "-m", "baseline"]);
        const baselineTree = await run(cwd, ["rev-parse", "HEAD^{tree}"]);
        await Deno.writeTextFile(`${cwd}/implemented.txt`, "done\n");

        await validateAmendedObjectiveChecksAgainstBaseline(cwd, baselineTree, [{
            id: "OC1",
            command: "test -f implemented.txt",
        }]);
        await assertRejects(
            () => validateAmendedObjectiveChecksAgainstBaseline(cwd, baselineTree, [{ id: "OC2", command: "true" }]),
            Error,
            "not red against the recorded execution baseline",
        );
    } finally {
        await Deno.remove(cwd, { recursive: true }).catch(() => undefined);
    }
});

Deno.test("publication preserves an accepted execution Plan definition amendment", async () => {
    const projectRoot = await Deno.makeTempDir();
    const executionCwd = await Deno.makeTempDir();
    try {
        await savePlan(projectRoot, "feature", "# Old", {
            planId: "plan-1",
            classification: "PLANNED_CHANGE",
            status: "validated_reviewer",
            summary: "Old",
            objectiveChecks: [{ id: "OC1", command: "false" }],
        });
        await savePlan(executionCwd, "feature", "# New", {
            planId: "plan-1",
            classification: "PLANNED_CHANGE",
            status: "validated_reviewer",
            summary: "New",
            objectiveChecks: [{ id: "OC1", command: "test -f new-file" }],
        });
        const proposal = await detectValidationPlanAmendment(projectRoot, executionCwd, "feature");
        if (!proposal) throw new Error("expected proposal");
        await applyValidationPlanAmendment(projectRoot, executionCwd, "feature", proposal);
        await stageValidationPassedInExecutionWorktree({
            projectRoot,
            executionCwd,
            planName: "feature",
            details: {
                executionMode: "non_git_in_place",
                deliveryEvidence: { version: 1, mode: "non_git_in_place" },
            },
        });
        const staged = await loadPlan(executionCwd, "feature");
        assertEquals(staged?.body, "# New");
        assertEquals(staged?.attrs.summary, "New");
        assertEquals(staged?.attrs.objectiveChecks?.[0].command, "test -f new-file");
        assertEquals(staged?.attrs.status, "verified");
    } finally {
        await Deno.remove(projectRoot, { recursive: true }).catch(() => undefined);
        await Deno.remove(executionCwd, { recursive: true }).catch(() => undefined);
    }
});
