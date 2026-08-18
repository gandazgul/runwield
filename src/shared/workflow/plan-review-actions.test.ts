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
import { applySharedPlanReviewDecision } from "./plan-review-actions.ts";
import type { PlanFrontMatter } from "../../plan-store.js";

interface PlanReviewFixture {
    dir: string;
    planPath: string;
    attrs: PlanFrontMatter;
    markdown: string;
    revision: string;
}

async function makePlanFile(attrs: Partial<PlanFrontMatter> = {}): Promise<PlanReviewFixture> {
    const dir = await Deno.realPath(await Deno.makeTempDir({ prefix: "runwield-shared-plan-review-" }));
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

async function addActiveWorktree(dir: string): Promise<void> {
    await addRegistryEntry(dir, {
        id: "wt-prior",
        planName: "plan",
        planId: "plan-id",
        baseBranch: "main",
        baseRef: "HEAD",
        baseCommit: "recorded",
        baseTree: "recorded-tree",
        branch: "runwield/worktree/plan",
        path: join(dir, "wt-prior"),
        status: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
    } as never);
}

Deno.test("shared Plan review rejects stale revision status and worktree before mutation", async () => {
    const fixture = await makePlanFile({
        status: "ready_for_work",
        planId: "plan-id",
        worktreeId: "wt-prior",
        worktreeStatus: "completed",
    });
    await addActiveWorktree(fixture.dir);
    try {
        const currentPlan = injectFrontMatter(fixture.markdown, { status: "feedback", worktreeId: "other" });
        await Deno.writeTextFile(fixture.planPath, currentPlan);

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
                feedback: "run it",
                approvalAction: "run",
                executionAgent: "engineer",
                collaborationRecommendation: "autonomous",
            },
        });

        assertEquals(result.cancellationReason, "stale_plan_review");
        assertEquals((await loadPlan(fixture.dir, "plan"))?.attrs.status, "feedback");
        assertEquals((await loadPlan(fixture.dir, "plan"))?.attrs.worktreeId, "other");
        assertEquals((await findRegistryEntryById(fixture.dir, "wt-prior"))?.status, "active");
    } finally {
        await Deno.remove(fixture.dir, { recursive: true });
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
