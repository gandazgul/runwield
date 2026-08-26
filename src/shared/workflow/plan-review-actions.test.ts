import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
    getPlanRevisionForText,
    getStoredPlanPath,
    injectFrontMatter,
    loadPlan,
    parsePlanFrontMatter,
    savePlan,
} from "../../plan-store.js";
import { addEntry as addRegistryEntry, findById as findRegistryEntryById } from "../worktree-registry.js";
import { defineCommittedGitFixture, git } from "../git-test-fixture.ts";
import { applySharedPlanReviewDecision } from "./plan-review-actions.ts";
import type { PlanFrontMatter } from "../../plan-store.js";

interface PlanReviewFixture {
    dir: string;
    planPath: string;
    attrs: PlanFrontMatter;
    markdown: string;
    revision: string;
}

const gitFixture = defineCommittedGitFixture({ ".gitignore": ".wld/\nwt-prior/\n" });

async function makePlanFile(attrs: Partial<PlanFrontMatter> = {}): Promise<PlanReviewFixture> {
    const dir = await gitFixture.checkout();
    await savePlan(dir, "plan", "# Plan\n\nDo the thing.\n", {
        classification: "PLANNED_CHANGE",
        status: "draft",
        summary: "Do the thing",
        affectedPaths: [],
        ...attrs,
    });
    const planPath = getStoredPlanPath(dir, "plan");
    const markdown = await Deno.readTextFile(planPath);
    return {
        dir,
        planPath,
        markdown,
        attrs: parsePlanFrontMatter(markdown).attrs,
        revision: await getPlanRevisionForText(markdown),
    };
}

async function addActiveWorktree(dir: string): Promise<string> {
    await git(dir, ["add", "docs"]);
    await git(dir, ["commit", "-m", "Save review Plan"]);
    const path = join(dir, "wt-prior");
    await git(dir, ["worktree", "add", "-b", "worktree/plan", path]);
    await addRegistryEntry(dir, {
        id: "wt-prior",
        planName: "plan",
        planId: "plan-id",
        baseBranch: "main",
        baseRef: "refs/heads/main",
        baseCommit: await git(dir, ["rev-parse", "HEAD"]),
        baseTree: await git(dir, ["rev-parse", "HEAD^{tree}"]),
        branch: "worktree/plan",
        path,
        status: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
    });
    return path;
}

Deno.test("shared Plan review rejects stale revision status and worktree before mutation", async () => {
    const fixture = await makePlanFile({
        status: "ready_for_work",
        planId: "plan-id",
        worktreeId: "wt-prior",
        worktreeStatus: "completed",
    });
    const executionDir = await addActiveWorktree(fixture.dir);
    const executionPlanPath = getStoredPlanPath(executionDir, "plan");
    try {
        const currentPlan = injectFrontMatter(fixture.markdown, { status: "feedback", worktreeId: "other" });
        await Deno.writeTextFile(executionPlanPath, currentPlan);

        const result = await applySharedPlanReviewDecision({
            cwd: fixture.dir,
            planName: "plan",
            planPath: executionPlanPath,
            planWithFrontMatter: fixture.markdown,
            planRevision: fixture.revision,
            originalAttrs: fixture.attrs,
            trustedClassification: "PLANNED_CHANGE",
            decision: {
                approved: true,
                feedback: "run it",
                approvalAction: "run",
                executionAgent: "engineer",
                collaborationRecommendation: "autonomous",
            },
        });

        assertEquals(result.cancellationReason, "stale_plan_review");
        assertEquals((await loadPlan(executionDir, "plan"))?.attrs.status, "feedback");
        assertEquals((await loadPlan(executionDir, "plan"))?.attrs.worktreeId, "wt-prior");
        assertEquals(await Deno.readTextFile(executionPlanPath), currentPlan);
        assertEquals(await Deno.readTextFile(fixture.planPath), fixture.markdown);
        assertEquals((await findRegistryEntryById(fixture.dir, "wt-prior"))?.status, "active");
    } finally {
        await Deno.remove(fixture.dir, { recursive: true });
    }
});

Deno.test("shared Plan review approval accepts every execution policy combination", async () => {
    const combinations = [
        { executionAgent: "engineer", collaborationRecommendation: "autonomous" },
        { executionAgent: "engineer", collaborationRecommendation: "pair" },
        { executionAgent: "frontend-engineer", collaborationRecommendation: "autonomous" },
        { executionAgent: "frontend-engineer", collaborationRecommendation: "pair" },
    ] as const;

    for (const combination of combinations) {
        const fixture = await makePlanFile();
        try {
            const result = await applySharedPlanReviewDecision({
                cwd: fixture.dir,
                planName: "plan",
                planPath: fixture.planPath,
                planWithFrontMatter: fixture.markdown,
                planRevision: fixture.revision,
                originalAttrs: fixture.attrs,
                trustedClassification: "PLANNED_CHANGE",
                decision: {
                    approved: true,
                    approvalAction: "run",
                    executionAgent: combination.executionAgent,
                    collaborationRecommendation: combination.collaborationRecommendation,
                },
            });
            const attrs = (await loadPlan(fixture.dir, "plan"))?.attrs;

            assertEquals(result.approved, true);
            assertEquals(result.planAttrs?.executionAgent, combination.executionAgent);
            assertEquals(result.planAttrs?.collaborationRecommendation, combination.collaborationRecommendation);
            assertEquals(attrs?.executionAgent, combination.executionAgent);
            assertEquals(attrs?.collaborationRecommendation, combination.collaborationRecommendation);
        } finally {
            await Deno.remove(fixture.dir, { recursive: true });
        }
    }
});

Deno.test("shared Plan review commits edited Feedback and approval notes with classification-correct outcomes", async () => {
    const feedbackFixture = await makePlanFile();
    const approvalFixture = await makePlanFile({ classification: "PROJECT" });
    try {
        const feedback = await applySharedPlanReviewDecision({
            cwd: feedbackFixture.dir,
            planName: "plan",
            planPath: feedbackFixture.planPath,
            planWithFrontMatter: feedbackFixture.markdown,
            planRevision: feedbackFixture.revision,
            originalAttrs: feedbackFixture.attrs,
            trustedClassification: "PLANNED_CHANGE",
            decision: {
                approved: false,
                feedback: "Keep the note.",
                plan:
                    `---\nclassification: FEATURE\nexecutionAgent: frontend-engineer\ncollaborationRecommendation: pair\n---\n# Edited Feedback\n`,
            },
        });
        const feedbackMarkdown = await Deno.readTextFile(feedbackFixture.planPath);
        const feedbackAttrs = parsePlanFrontMatter(feedbackMarkdown).attrs;

        assertEquals(feedback.approved, false);
        assertStringIncludes(feedbackMarkdown, "# Edited Feedback");
        assertEquals(feedbackAttrs.status, "feedback");
        assertEquals(feedbackAttrs.classification, "PLANNED_CHANGE");
        assertEquals(feedbackAttrs.executionAgent, "frontend-engineer");

        const approval = await applySharedPlanReviewDecision({
            cwd: approvalFixture.dir,
            planName: "plan",
            planPath: approvalFixture.planPath,
            planWithFrontMatter: approvalFixture.markdown,
            planRevision: approvalFixture.revision,
            originalAttrs: approvalFixture.attrs,
            trustedClassification: "PROJECT",
            decision: {
                approved: true,
                feedback: "Approved.",
                approvalAction: "decompose",
                plan:
                    `---\nclassification: FEATURE\nexecutionAgent: frontend-engineer\ncollaborationRecommendation: pair\n---\n# Approved Project\n`,
            },
        });
        const approvalAttrs = (await loadPlan(approvalFixture.dir, "plan"))?.attrs;

        assertEquals(approval.approved, true);
        assertEquals(approval.planAttrs?.classification, "PROJECT");
        assertEquals(approvalAttrs?.status, "approved");
        assertEquals(approvalAttrs?.classification, "PROJECT");
        assertEquals(approvalAttrs?.executionAgent, undefined);
        assertEquals(approvalAttrs?.collaborationRecommendation, undefined);
    } finally {
        await Deno.remove(feedbackFixture.dir, { recursive: true });
        await Deno.remove(approvalFixture.dir, { recursive: true });
    }
});
