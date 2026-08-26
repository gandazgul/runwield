import { assertEquals, assertStringIncludes } from "@std/assert";
import { loadPlan, savePlan } from "../../plan-store.js";
import { createTestWorktreeAttempt, makeRepo } from "../../shared/worktree-test-helpers.js";
import { removeWorktreeGitArtifacts } from "../../shared/worktree.js";
import { resolvePlanWithPrimaryRecovery } from "./primary-plan-recovery.ts";

Deno.test("load-plan reads the execution Plan without recreating a missing primary Plan", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir({ prefix: "runwield-primary-plan-recovery-" });
    const planName = "restore-me";
    const planId = "restore-me-id";
    let worktree: Awaited<ReturnType<typeof createTestWorktreeAttempt>> | undefined;
    try {
        worktree = await createTestWorktreeAttempt({ projectRoot, worktreeRoot, planName, planId });
        await savePlan(worktree.path, planName, "# Restored Plan\n\nExecution copy wins.\n", {
            classification: "PLANNED_CHANGE",
            complexity: "LOW",
            summary: "Restore me",
            affectedPaths: [],
            status: "implemented",
            planId,
            executionMode: "worktree",
            worktreeId: worktree.id,
            worktreePath: worktree.path,
            worktreeBranch: worktree.branch,
            worktreeBaseBranch: worktree.baseBranch,
        });

        const result = await resolvePlanWithPrimaryRecovery(projectRoot, planName);

        assertEquals(result.plan.path, `${worktree.path}/docs/plans/${planName}.md`);
        assertEquals(result.plan.attrs.planId, planId);
        assertStringIncludes(result.plan.markdown, "Execution copy wins.");
        assertEquals(await loadPlan(projectRoot, planName), null);
    } finally {
        if (worktree) {
            await removeWorktreeGitArtifacts({ projectRoot, path: worktree.path, force: true }).catch(() => {});
        }
        await Deno.remove(projectRoot, { recursive: true }).catch(() => {});
        await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
    }
});

Deno.test("load-plan leaves a malformed primary Plan untouched and reads the execution Plan", async () => {
    const projectRoot = await makeRepo();
    const worktreeRoot = await Deno.makeTempDir({ prefix: "runwield-primary-plan-malformed-" });
    const planName = "repair-malformed";
    const planId = "repair-malformed-id";
    let worktree: Awaited<ReturnType<typeof createTestWorktreeAttempt>> | undefined;
    try {
        worktree = await createTestWorktreeAttempt({ projectRoot, worktreeRoot, planName, planId });
        await savePlan(worktree.path, planName, "# Recovered\n", {
            classification: "PLANNED_CHANGE",
            complexity: "LOW",
            summary: "Repair malformed",
            affectedPaths: [],
            status: "implemented",
            planId,
            executionMode: "worktree",
            worktreeId: worktree.id,
            worktreePath: worktree.path,
            worktreeBranch: worktree.branch,
            worktreeBaseBranch: worktree.baseBranch,
        });
        await Deno.mkdir(`${projectRoot}/docs/plans`, { recursive: true });
        const malformed = '---\nstatus: "unterminated\n---\n# Broken\n';
        await Deno.writeTextFile(`${projectRoot}/docs/plans/${planName}.md`, malformed);

        const result = await resolvePlanWithPrimaryRecovery(projectRoot, planName);

        assertEquals(
            await Deno.readTextFile(`${projectRoot}/docs/plans/${planName}.md`),
            malformed,
        );
        assertStringIncludes(result.plan.markdown, "# Recovered");
    } finally {
        if (worktree) {
            await removeWorktreeGitArtifacts({ projectRoot, path: worktree.path, force: true }).catch(() => {});
        }
        await Deno.remove(projectRoot, { recursive: true }).catch(() => {});
        await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
    }
});
