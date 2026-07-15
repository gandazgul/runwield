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
    const harness = makeDeps({ approved: true, feedback: "looks good" });
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
        assertEquals(result, { approved: true, feedback: "looks good" });
        assertEquals(harness.events.map((event) => event.event), ["review_approved"]);
        assertEquals(harness.stops(), 1);
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
