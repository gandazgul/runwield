import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { listPlans, loadPlan, savePlan, updatePlanFrontMatter } from "../../plan-store.js";
import { defineCommittedGitFixture, git } from "../git-test-fixture.ts";
import { HostedSession } from "../session/hosted-session.js";
import { findById, pruneEntry } from "../worktree-registry.js";
import { addEntry } from "../worktree-registry.js";
import { createExecutionStartPorts, startActiveExecutionWorkflow } from "./execution-start.ts";
import { recordPlanEvent } from "./plan-lifecycle.js";
import { recoverMissingExecutionWorktreesForPlanLoading, resolveWorkflowPlanLocation } from "./plan-location.ts";
import { applySharedPlanReviewDecision } from "./plan-review-actions.ts";
import { executePlanAction, loadPlanActionEvidence } from "./plan-actions.ts";

const fixture = defineCommittedGitFixture({ ".gitignore": ".wld/\n", "app.ts": "// application\n" });

Deno.test("load-plan rebuilds a missing execution worktree from one rescued branch", async () => {
    const root = await fixture.checkout({ prefix: "rw-rescued-execution-" });
    const container = await Deno.makeTempDir({ prefix: "rw-rescued-execution-tree-" });
    const executionPath = `${container}/execution`;
    try {
        await savePlan(root, "demo", "# Demo\n\n## Context\n\nImplement demo.\n", {
            planId: "rescued-plan-id",
            classification: "PLANNED_CHANGE",
            status: "ready_for_work",
            targetBranch: "main",
        });
        await git(root, ["add", "docs"]);
        await git(root, ["commit", "-m", "add Plan"]);
        const baseCommit = await git(root, ["rev-parse", "HEAD"]);
        const baseTree = await git(root, ["rev-parse", "HEAD^{tree}"]);
        await git(root, ["switch", "-c", "rescued/demo"]);
        await Deno.writeTextFile(`${root}/app.ts`, "// rescued implementation\n");
        const plan = await loadPlan(root, "demo");
        assert(plan);
        await updatePlanFrontMatter(root, "demo", { status: "implemented" }, plan.attrs, {
            expectedRevision: plan.revision,
        });
        await git(root, ["add", "app.ts", "docs/plans/demo.md"]);
        await git(root, ["commit", "-m", "rescue completed implementation"]);
        await git(root, ["switch", "main"]);
        await Deno.writeTextFile(`${root}/target.ts`, "// newer target work\n");
        await git(root, ["add", "target.ts"]);
        await git(root, ["commit", "-m", "new target work"]);
        await git(root, ["switch", "-c", "rescued/publication"]);
        await git(root, ["merge", "--no-ff", "rescued/demo", "-m", "manually rescue execution commits"]);
        const rescuedCommit = await git(root, ["rev-parse", "HEAD"]);
        await git(root, ["branch", "-D", "rescued/demo"]);
        await git(root, ["switch", "main"]);
        await addEntry(root, {
            id: "missing-attempt",
            planName: "demo",
            planId: "rescued-plan-id",
            baseBranch: "main",
            baseRef: "refs/heads/main",
            baseCommit,
            baseTree,
            executionBaselineTree: baseTree,
            branch: "worktree/demo-missing",
            path: executionPath,
            status: "completed",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });

        assertEquals(await recoverMissingExecutionWorktreesForPlanLoading(root), [{
            planName: "demo",
            branch: "worktree/demo-missing",
        }]);
        const listed = await listPlans(root);

        assertEquals(listed.find((item) => item.name === "demo")?.attrs.status, "implemented");
        assertEquals((await resolveWorkflowPlanLocation(root, "demo")).documentRoot, executionPath);
        assertEquals(await git(root, ["rev-parse", "worktree/demo-missing"]), rescuedCommit);
        assertEquals((await loadPlan(root, "demo"))?.attrs.status, "ready_for_work");
    } finally {
        await git(root, ["worktree", "remove", "--force", executionPath]).catch(() => {});
        await Deno.remove(container, { recursive: true }).catch(() => {});
        await Deno.remove(root, { recursive: true });
    }
});

for (const surface of ["primary", "execution"]) {
    Deno.test(`review from ${surface}, restart, approve and execute keeps the document but creates a fresh attempt`, async () => {
        const root = await fixture.checkout();
        const first = new HostedSession({ id: "first", cwd: root, eventSink: () => {} });
        const second = new HostedSession({ id: "second", cwd: root, eventSink: () => {} });
        const trees: string[] = [];
        try {
            await savePlan(root, "demo", "# Demo\n\n## Context\n\nImplement demo.\n", {
                planId: "demo-id",
                classification: "PLANNED_CHANGE",
                status: "ready_for_work",
                executionAgent: "engineer",
                collaborationRecommendation: "autonomous",
                targetBranch: "main",
            });
            const initial = await loadPlan(root, "demo");
            assert(initial);
            await startActiveExecutionWorkflow({
                planName: "demo",
                triageMeta: initial.attrs,
                currentStatus: initial.attrs.status,
                hostedSession: first,
                ports: createExecutionStartPorts(),
            });
            const started = first.getActiveExecutionWorkflow();
            assert(started?.executionCwd && started.worktreeId);
            trees.push(started.executionCwd);
            const primaryBytes = await Deno.readTextFile(initial.path);
            const execution = await loadPlan(started.executionCwd, "demo");
            assert(execution);
            const reviewedMarkdown = execution.markdown.replace("Implement demo.", "The revised approved definition.");
            const review = await applySharedPlanReviewDecision({
                cwd: surface === "primary" ? root : started.executionCwd,
                planName: "demo",
                planPath: execution.path,
                planWithFrontMatter: reviewedMarkdown,
                planRevision: execution.revision,
                originalAttrs: execution.attrs,
                trustedClassification: "PLANNED_CHANGE",
                decision: {
                    approved: true,
                    approvalAction: "run",
                    executionAgent: "engineer",
                    collaborationRecommendation: "autonomous",
                },
            });
            assertEquals(review.approved, true, review.feedback);
            assertEquals((await findById(root, started.worktreeId))?.status, "abandoned");
            const reopened = await resolveWorkflowPlanLocation(root, "demo");
            assert(reopened.plan);
            assertEquals(reopened.plan.attrs.status, "approved");
            assertEquals(reopened.plan.attrs.worktreeId, undefined);
            assertEquals(reopened.plan.attrs.worktreeBranch, undefined);
            const evidence = await loadPlanActionEvidence(root, "demo-id");
            assertEquals(evidence.kind, "success");
            if (evidence.kind === "success") {
                assertEquals(evidence.evidence.status, "approved");
                assertEquals(evidence.evidence.revision, reopened.plan.revision);
            }
            for (const action of ["put_on_hold", "resume_from_hold"] as const) {
                const fresh = await loadPlanActionEvidence(root, "demo-id");
                assert(fresh.kind === "success");
                const changed = await executePlanAction(root, {
                    planId: "demo-id",
                    action,
                    expectedRevision: fresh.evidence.revision,
                    expectedStatus: fresh.evidence.status,
                    expectedWorktree: fresh.evidence.worktree,
                });
                assertEquals(changed.kind, "success", changed.message);
                assertEquals((await resolveWorkflowPlanLocation(root, "demo")).documentRoot, started.executionCwd);
            }
            await recordPlanEvent({
                cwd: root,
                planName: "demo",
                event: "readiness_passed",
                currentStatus: "approved",
            });
            const next = await resolveWorkflowPlanLocation(root, "demo");
            assert(next.plan);
            first.dispose();
            const reader = await new Deno.Command(Deno.execPath(), {
                args: [
                    "run",
                    "-A",
                    fromFileUrl(new URL("./testing/controller-process-reader.ts", import.meta.url)),
                    root,
                    "demo",
                ],
                stdout: "piped",
                stderr: "piped",
            }).output();
            assert(reader.success, new TextDecoder().decode(reader.stderr));
            const restarted = JSON.parse(new TextDecoder().decode(reader.stdout));
            assertEquals(restarted.path, execution.path);
            assertEquals(restarted.status, "ready_for_work");
            assertEquals(restarted.primaryStatus, "ready_for_work");
            assertEquals(restarted.worktreeId, undefined);
            await startActiveExecutionWorkflow({
                planName: "demo",
                triageMeta: next.plan.attrs,
                currentStatus: next.plan.attrs.status,
                hostedSession: second,
                ports: createExecutionStartPorts(),
            });
            const result = second.getActiveExecutionWorkflow();
            assert(result?.executionCwd && result.worktreeId);
            trees.push(result.executionCwd);
            assertNotEquals(result.worktreeId, started.worktreeId);
            assertNotEquals(result.worktreeBranch, started.worktreeBranch);
            assertEquals((await loadPlan(result.executionCwd, "demo"))?.attrs.status, "in_progress");
            assert((await loadPlan(result.executionCwd, "demo"))?.body.includes("The revised approved definition."));
            assertEquals(await Deno.readTextFile(initial.path), primaryBytes);
            assertEquals(
                await git(root, ["show-ref", "--verify", "--hash", `refs/heads/${started.worktreeBranch}`]) !== "",
                true,
            );
            // Cleanup of the successor cannot revive an older review document.
            await pruneEntry(root, result.worktreeId);
            assertEquals((await resolveWorkflowPlanLocation(root, "demo")).documentRoot, root);
        } finally {
            first.dispose();
            second.dispose();
            for (const tree of trees) await git(root, ["worktree", "remove", "--force", tree]);
            await Deno.remove(root, { recursive: true });
        }
    });
}
