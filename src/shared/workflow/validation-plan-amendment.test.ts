import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import {
    getPlanRevisionForText,
    injectFrontMatter,
    loadPlan,
    savePlan,
    writePlanMarkdownWithRevision,
} from "../../plan-store.js";
import { stageValidationPassedInExecutionWorktree } from "./plan-lifecycle.js";
import {
    applyValidationPlanAmendment,
    detectValidationPlanAmendment,
    resumeValidationPlanAmendment,
    validateAmendedObjectiveChecksAgainstBaseline,
} from "./validation-plan-amendment.ts";
import { listTransitionRecoveryRecords, runPlanAmendmentTransition } from "./state-transition.ts";

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

Deno.test("an approved amendment resumes after the primary Plan write", async () => {
    const projectRoot = await Deno.makeTempDir();
    const executionCwd = await Deno.makeTempDir();
    try {
        await savePlan(projectRoot, "feature", "# Old", {
            planId: "plan-1",
            classification: "PLANNED_CHANGE",
            status: "implemented",
            summary: "Old",
        });
        await savePlan(executionCwd, "feature", "# New", {
            planId: "plan-1",
            classification: "PLANNED_CHANGE",
            status: "implemented",
            summary: "New",
        });
        const primary = await loadPlan(projectRoot, "feature");
        const execution = await loadPlan(executionCwd, "feature");
        if (!primary || !execution) throw new Error("Plan fixture did not load");
        const canonicalMarkdown = injectFrontMatter(execution.body, { ...primary.attrs, summary: "New" });
        const canonicalRevision = await getPlanRevisionForText(canonicalMarkdown);
        const interrupted = await runPlanAmendmentTransition({
            projectRoot,
            planName: "feature",
            expectedRevision: primary.revision,
            apply: async ({ markEffect }) => {
                await markEffect("plan_amendment_sync_required", {
                    executionCwd,
                    primaryRevision: primary.revision,
                    executionRevision: execution.revision,
                    canonicalRevision,
                    canonicalMarkdown,
                });
                await writePlanMarkdownWithRevision(primary.path, canonicalMarkdown, primary.revision);
                await markEffect("primary_plan_amended", { canonicalRevision });
                throw new Error("simulated process stop");
            },
        });
        assertEquals(interrupted.status, "needs_recovery");

        assertEquals(await resumeValidationPlanAmendment(projectRoot, "feature"), true);

        const resumedPrimary = await loadPlan(projectRoot, "feature");
        const resumedExecution = await loadPlan(executionCwd, "feature");
        assertEquals(resumedPrimary?.revision, canonicalRevision);
        assertEquals(resumedExecution?.revision, canonicalRevision);
        assertEquals(await listTransitionRecoveryRecords(projectRoot), []);
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
