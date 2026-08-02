import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { getStoredPlanPath, loadPlan, parsePlanFrontMatter, savePlan } from "../../plan-store.js";
import type { BrowserPort } from "../../shared/browser-port.ts";
import { submitPlanForReview } from "./plan-review.ts";
import { createScriptedReviewBrowser, type ReviewDecisionBody } from "./review-test-fixture.ts";

interface PlanReviewFixture {
    dir: string;
    planPath: string;
}

async function makePlanFile(): Promise<PlanReviewFixture> {
    const dir = await Deno.makeTempDir({ prefix: "runwield-plan-review-" });
    await savePlan(dir, "plan", "# Plan\n\nDo the thing.\n", {
        classification: "PLANNED_CHANGE",
        status: "draft",
        summary: "Do the thing",
        affectedPaths: [],
    });
    return { dir, planPath: getStoredPlanPath(dir, "plan") };
}

async function planStatus(dir: string): Promise<string | undefined> {
    return (await loadPlan(dir, "plan"))?.attrs.status;
}

function approvedDecision(overrides: ReviewDecisionBody = {}): ReviewDecisionBody {
    return {
        approved: true,
        feedback: "looks good",
        approvalAction: "run",
        executionAgent: "engineer",
        collaborationRecommendation: "autonomous",
        ...overrides,
    };
}

Deno.test("submitPlanForReview serves a real review and records approval metadata", async () => {
    const { dir, planPath } = await makePlanFile();
    const scriptedBrowser = createScriptedReviewBrowser("decision", approvedDecision());
    try {
        const result = await submitPlanForReview({
            cwd: dir,
            planName: "plan",
            planPath,
            triageMeta: {
                classification: "FEATURE",
                workKind: "DOCUMENTATION",
                complexity: "MEDIUM",
                summary: "Add the thing",
                affectedPaths: ["src/a.js"],
            },
            browser: scriptedBrowser.browser,
        });

        const savedPlan = await loadPlan(dir, "plan");
        assertEquals(result.approved, true);
        assertEquals(result.feedback, "looks good");
        assertEquals(result.approvalAction, "run");
        assertEquals(result.revision, savedPlan?.revision);
        assertEquals(savedPlan?.attrs.status, "approved");
        assertEquals(savedPlan?.attrs.classification, "PLANNED_CHANGE");
        assertEquals(savedPlan?.attrs.workKind, "DOCUMENTATION");
        assertStringIncludes(scriptedBrowser.urls[0], "/review/plan?token=");
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("submitPlanForReview persists approved execution policy and preserves custom front matter", async () => {
    const { dir, planPath } = await makePlanFile();
    await Deno.writeTextFile(
        planPath,
        `---
classification: FEATURE
frontend: true
customField: keep-me
---
# Plan
`,
    );
    const scriptedBrowser = createScriptedReviewBrowser("decision", approvedDecision({ approvalAction: "later" }));
    try {
        const result = await submitPlanForReview({
            cwd: dir,
            planName: "plan",
            planPath,
            browser: scriptedBrowser.browser,
        });
        const markdown = await Deno.readTextFile(planPath);
        const parsed = parsePlanFrontMatter(markdown);

        assertEquals(parsed.attrs.executionAgent, "engineer");
        assertEquals(parsed.attrs.collaborationRecommendation, "autonomous");
        assertEquals(parsed.attrs.frontend, undefined);
        assertStringIncludes(markdown, 'customField: "keep-me"');
        assertEquals(result.approvalAction, "later");
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("submitPlanForReview restores trusted PROJECT policy boundaries", async () => {
    const { dir, planPath } = await makePlanFile();
    const scriptedBrowser = createScriptedReviewBrowser("decision", {
        approved: true,
        feedback: "decompose",
        approvalAction: "decompose",
        plan: `---
classification: FEATURE
executionAgent: frontend-engineer
collaborationRecommendation: pair
---
# Edited Project
`,
    });
    try {
        const result = await submitPlanForReview({
            cwd: dir,
            planName: "plan",
            planPath,
            triageMeta: { classification: "PROJECT", complexity: "HIGH", summary: "Epic", affectedPaths: [] },
            browser: scriptedBrowser.browser,
        });
        const attrs = (await loadPlan(dir, "plan"))?.attrs;

        assertEquals(result.approved, true);
        assertEquals(attrs?.classification, "PROJECT");
        assertEquals(attrs?.executionAgent, undefined);
        assertEquals(attrs?.collaborationRecommendation, undefined);
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("submitPlanForReview restores trusted planned-change classification before approved policy", async () => {
    const { dir, planPath } = await makePlanFile();
    const scriptedBrowser = createScriptedReviewBrowser(
        "decision",
        approvedDecision({
            plan: `---
classification: PROJECT
---
# Edited Feature
`,
            executionAgent: "frontend-engineer",
            collaborationRecommendation: "pair",
        }),
    );
    try {
        await submitPlanForReview({
            cwd: dir,
            planName: "plan",
            planPath,
            triageMeta: { classification: "FEATURE", complexity: "MEDIUM", summary: "Feature", affectedPaths: [] },
            browser: scriptedBrowser.browser,
        });
        const attrs = (await loadPlan(dir, "plan"))?.attrs;

        assertEquals(attrs?.classification, "PLANNED_CHANGE");
        assertEquals(attrs?.executionAgent, "frontend-engineer");
        assertEquals(attrs?.collaborationRecommendation, "pair");
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("submitPlanForReview feedback writes the edited Plan without applying approval policy", async () => {
    const { dir, planPath } = await makePlanFile();
    const scriptedBrowser = createScriptedReviewBrowser("deny", {
        feedback: "revise",
        plan: `---
classification: FEATURE
executionAgent: frontend-engineer
collaborationRecommendation: pair
---
# Plan
`,
    });
    try {
        const result = await submitPlanForReview({
            cwd: dir,
            planName: "plan",
            planPath,
            browser: scriptedBrowser.browser,
        });
        const attrs = (await loadPlan(dir, "plan"))?.attrs;

        assertEquals(result.approved, false);
        assertEquals(attrs?.executionAgent, "frontend-engineer");
        assertEquals(attrs?.collaborationRecommendation, "pair");
        assertEquals(attrs?.status, "feedback");
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("submitPlanForReview rejects malformed empty feedback without writing the Plan", async () => {
    const { dir, planPath } = await makePlanFile();
    const originalPlan = await Deno.readTextFile(planPath);
    const scriptedBrowser = createScriptedReviewBrowser("deny", { feedback: "" });
    try {
        const result = await submitPlanForReview({
            cwd: dir,
            planName: "plan",
            planPath,
            browser: scriptedBrowser.browser,
        });

        assertEquals(result.cancellationReason, "malformed_review_response");
        assertEquals(await Deno.readTextFile(planPath), originalPlan);
        assertEquals(await planStatus(dir), "draft");
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("submitPlanForReview loads image bytes from real feedback transport", async () => {
    const { dir, planPath } = await makePlanFile();
    const imagePath = join(dir, "reference.png");
    await Deno.writeFile(imagePath, new Uint8Array([137, 80, 78, 71]));
    const scriptedBrowser = createScriptedReviewBrowser("deny", {
        feedback: "change this",
        globalAttachments: [{ path: imagePath, name: "reference" }],
    });
    try {
        const result = await submitPlanForReview({
            cwd: dir,
            planName: "plan",
            planPath,
            browser: scriptedBrowser.browser,
        });

        assertEquals(result.images, [{ base64: "iVBORw==", mimeType: "image/png", name: "reference" }]);
        assertEquals(await planStatus(dir), "feedback");
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("submitPlanForReview exit does not write the Plan", async () => {
    const { dir, planPath } = await makePlanFile();
    const originalPlan = await Deno.readTextFile(planPath);
    const scriptedBrowser = createScriptedReviewBrowser("exit", { reviewType: "plan" });
    try {
        const result = await submitPlanForReview({
            cwd: dir,
            planName: "plan",
            planPath,
            browser: scriptedBrowser.browser,
        });

        assertEquals(result.canceled, true);
        assertEquals(result.cancellationReason, "review_exit");
        assertEquals(await Deno.readTextFile(planPath), originalPlan);
        assertEquals(await planStatus(dir), "draft");
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("submitPlanForReview cancellation stops the real review surface without writing", async () => {
    const { dir, planPath } = await makePlanFile();
    const originalPlan = await Deno.readTextFile(planPath);
    const controller = new AbortController();
    let openedUrl = "";
    let markOpened: () => void = () => {};
    const opened = new Promise<void>((resolveOpened) => markOpened = resolveOpened);
    const browser: BrowserPort = {
        open: (url: string) => {
            openedUrl = url;
            markOpened();
            return Promise.resolve(true);
        },
    };
    try {
        const pending = submitPlanForReview({
            cwd: dir,
            planName: "plan",
            planPath,
            signal: controller.signal,
            browser,
        });
        await opened;
        controller.abort();

        assertEquals(await pending, {
            approved: false,
            canceled: true,
            feedback: "Cancelled by user (Esc)",
            cancellationReason: "abort_signal",
        });
        assertStringIncludes(openedUrl, "/review/plan?token=");
        assertEquals(await Deno.readTextFile(planPath), originalPlan);
        await assertRejects(() => fetch(openedUrl));
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});
