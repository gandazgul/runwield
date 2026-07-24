import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { parsePlanFrontMatter } from "../../plan-store.js";
import { submitPlanForReview } from "./plan-review.js";

/** @returns {Promise<{ dir: string, planPath: string }>} */
async function makePlanFile() {
    const dir = await Deno.makeTempDir({ prefix: "runwield-plan-review-" });
    const planPath = join(dir, "plan.md");
    await Deno.writeTextFile(planPath, "# Plan\n\nDo the thing.\n");
    return { dir, planPath };
}

/**
 * @param {any} decision
 * @returns {{ deps: any, events: any[], stops: () => number }}
 */
function makeDeps(decision) {
    let stopCount = 0;
    const events = /** @type {any[]} */ ([]);
    return {
        events,
        stops: () => stopCount,
        deps: {
            startPlanReviewSurface: () =>
                Promise.resolve({
                    url: "http://127.0.0.1:9999/review",
                    waitForDecision: () => Promise.resolve(decision),
                    stop: () => {
                        stopCount++;
                    },
                }),
            recordPlanEvent: (/** @type {any} */ event) => {
                events.push(event);
                return Promise.resolve();
            },
        },
    };
}

Deno.test("submitPlanForReview updates metadata and records approval", async () => {
    const { dir, planPath } = await makePlanFile();
    const harness = makeDeps({ approved: true, feedback: "looks good", approvalAction: "run" });
    try {
        const result = await submitPlanForReview({
            cwd: dir,
            planName: "plan",
            planPath,
            triageMeta: {
                classification: "FEATURE",
                complexity: "MEDIUM",
                summary: "Add the thing",
                affectedPaths: ["src/a.js"],
            },
            __deps: harness.deps,
        });

        const parsed = parsePlanFrontMatter(await Deno.readTextFile(planPath));
        assertEquals(parsed.attrs.classification, "FEATURE");
        assertEquals(parsed.attrs.complexity, "MEDIUM");
        assertEquals(result.approved, true);
        assertEquals(result.feedback, "looks good");
        assertEquals(result.approvalAction, "run");
        assertEquals(result.planAttrs?.classification, "FEATURE");
        assertEquals(result.planAttrs?.complexity, "MEDIUM");
        assertEquals(harness.events.map((event) => event.event), ["review_approved"]);
        assertEquals(harness.stops(), 1);
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("submitPlanForReview persists approved execution policy before lifecycle metadata", async () => {
    const { dir, planPath } = await makePlanFile();
    const harness = makeDeps({
        approved: true,
        approvalAction: "later",
        plan: `---
classification: FEATURE
frontend: true
customField: keep-me
---
# Plan
`,
        executionAgent: "engineer",
        collaborationRecommendation: "autonomous",
    });
    try {
        const result = await submitPlanForReview({
            cwd: dir,
            planName: "plan",
            planPath,
            __deps: harness.deps,
        });

        const parsed = parsePlanFrontMatter(await Deno.readTextFile(planPath));
        assertEquals(parsed.attrs.executionAgent, "engineer");
        assertEquals(parsed.attrs.collaborationRecommendation, "autonomous");
        assertEquals(parsed.attrs.frontend, undefined);
        assertEquals(/** @type {any} */ (parsed.attrs).customField, "keep-me");
        assertEquals(harness.events[0].details.triageMeta.executionAgent, "engineer");
        assertEquals(result.planAttrs?.executionAgent, "engineer");
        assertEquals(result.approvalAction, "later");
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("submitPlanForReview restores trusted PROJECT classification and strips browser policy edits", async () => {
    const { dir, planPath } = await makePlanFile();
    const harness = makeDeps({
        approved: true,
        approvalAction: "decompose",
        plan: `---
classification: FEATURE
executionAgent: frontend-engineer
collaborationRecommendation: pair
---
# Edited Project
`,
        executionAgent: "frontend-engineer",
        collaborationRecommendation: "pair",
    });
    try {
        const result = await submitPlanForReview({
            cwd: dir,
            planName: "plan",
            planPath,
            triageMeta: {
                classification: "PROJECT",
                complexity: "HIGH",
                summary: "Epic",
                affectedPaths: [],
            },
            __deps: harness.deps,
        });

        const parsed = parsePlanFrontMatter(await Deno.readTextFile(planPath));
        assertEquals(parsed.attrs.classification, "PROJECT");
        assertEquals(parsed.attrs.executionAgent, undefined);
        assertEquals(parsed.attrs.collaborationRecommendation, undefined);
        assertEquals(harness.events[0].details.triageMeta.classification, "PROJECT");
        assertEquals(harness.events[0].details.triageMeta.executionAgent, undefined);
        assertEquals(result.planAttrs?.classification, "PROJECT");
        assertEquals(result.planAttrs?.executionAgent, undefined);
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("submitPlanForReview restores trusted FEATURE classification before applying approved policy", async () => {
    const { dir, planPath } = await makePlanFile();
    const harness = makeDeps({
        approved: true,
        approvalAction: "run",
        plan: `---
classification: PROJECT
---
# Edited Feature
`,
        executionAgent: "frontend-engineer",
        collaborationRecommendation: "pair",
    });
    try {
        const result = await submitPlanForReview({
            cwd: dir,
            planName: "plan",
            planPath,
            triageMeta: {
                classification: "FEATURE",
                complexity: "MEDIUM",
                summary: "Feature",
                affectedPaths: [],
            },
            __deps: harness.deps,
        });

        const parsed = parsePlanFrontMatter(await Deno.readTextFile(planPath));
        assertEquals(parsed.attrs.classification, "FEATURE");
        assertEquals(parsed.attrs.executionAgent, "frontend-engineer");
        assertEquals(parsed.attrs.collaborationRecommendation, "pair");
        assertEquals(harness.events[0].details.triageMeta.classification, "FEATURE");
        assertEquals(result.planAttrs?.classification, "FEATURE");
        assertEquals(result.planAttrs?.executionAgent, "frontend-engineer");
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("submitPlanForReview feedback writes edited Plan without applying temporary execution policy", async () => {
    const { dir, planPath } = await makePlanFile();
    const harness = makeDeps({
        approved: false,
        feedback: "revise",
        plan: `---
classification: FEATURE
executionAgent: frontend-engineer
collaborationRecommendation: pair
---
# Plan
`,
        executionAgent: "engineer",
        collaborationRecommendation: "autonomous",
    });
    try {
        const result = await submitPlanForReview({
            cwd: dir,
            planName: "plan",
            planPath,
            __deps: harness.deps,
        });

        const parsed = parsePlanFrontMatter(await Deno.readTextFile(planPath));
        assertEquals(result.approved, false);
        assertEquals(parsed.attrs.executionAgent, "frontend-engineer");
        assertEquals(parsed.attrs.collaborationRecommendation, "pair");
        assertEquals(harness.events[0].event, "review_feedback");
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("submitPlanForReview invalid approved policy has no write or lifecycle side effects", async () => {
    const { dir, planPath } = await makePlanFile();
    const harness = makeDeps({
        approved: true,
        plan: `---
classification: FEATURE
---
# Plan
`,
        executionAgent: "engineer",
        collaborationRecommendation: "pair",
    });
    try {
        let errorMessage = "";
        try {
            await submitPlanForReview({
                cwd: dir,
                planName: "plan",
                planPath,
                __deps: harness.deps,
            });
        } catch (error) {
            errorMessage = error instanceof Error ? error.message : String(error);
        }
        const parsed = parsePlanFrontMatter(await Deno.readTextFile(planPath));
        assertEquals(errorMessage.includes("pair is only valid"), true);
        assertEquals(parsed.attrs.executionAgent, undefined);
        assertEquals(parsed.attrs.collaborationRecommendation, undefined);
        assertEquals(harness.events, []);
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("submitPlanForReview records feedback and returns loaded images", async () => {
    const { dir, planPath } = await makePlanFile();
    const imagePath = join(dir, "reference.png");
    await Deno.writeFile(imagePath, new Uint8Array([137, 80, 78, 71]));
    const harness = makeDeps({
        approved: false,
        feedback: "change this",
        images: [{ path: imagePath, name: "reference" }],
    });
    try {
        const result = await submitPlanForReview({
            cwd: dir,
            planName: "plan",
            planPath,
            __deps: harness.deps,
        });

        assertEquals(result, {
            approved: false,
            feedback: "change this",
            images: [{ base64: "iVBORw==", mimeType: "image/png", name: "reference" }],
        });
        assertEquals(harness.events.map((event) => event.event), ["review_feedback"]);
        assertEquals(harness.stops(), 1);
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("submitPlanForReview cancellation is driven by its AbortSignal", async () => {
    const { dir, planPath } = await makePlanFile();
    const controller = new AbortController();
    let stopped = false;
    /** @type {() => void} */
    let markStarted = () => {};
    const started = new Promise((resolve) => {
        markStarted = () => resolve(undefined);
    });
    try {
        const pending = submitPlanForReview({
            cwd: dir,
            planName: "plan",
            planPath,
            signal: controller.signal,
            __deps: /** @type {any} */ ({
                startPlanReviewSurface: () => {
                    markStarted();
                    return Promise.resolve({
                        url: "http://127.0.0.1:9999/review",
                        opened: false,
                        waitForDecision: () => new Promise(() => {}),
                        stop: () => {
                            stopped = true;
                        },
                    });
                },
                recordPlanEvent: () => Promise.resolve(/** @type {any} */ ({})),
            }),
        });
        await started;
        await new Promise((resolve) => setTimeout(resolve, 0));
        controller.abort();

        assertEquals(await pending, {
            approved: false,
            canceled: true,
            feedback: "Cancelled by user (Esc)",
        });
        assertEquals(stopped, true);
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});
