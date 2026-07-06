import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { cancelActivePlanReview, submitPlanForReview } from "./submit-plan.js";
import { injectFrontMatter, parsePlanFrontMatter } from "../../plan-store.js";
import { COLLABORATION_STATE_REMOTE_CANONICAL, SharedPlanLockError } from "../collaboration/lock.js";
import { HostedSession } from "../session/hosted-session.js";

/** @param {string} [id] */
function makeHostedSession(id = "plan-review-test") {
    return new HostedSession({ id, cwd: Deno.cwd(), sessionManager: null });
}

/** @returns {any} */
function makeUi() {
    return {
        messages: /** @type {string[]} */ ([]),
        disabled: 0,
        enabled: 0,
        appendSystemMessage(/** @type {string} */ message) {
            this.messages.push(message);
        },
        disableInput() {
            this.disabled++;
        },
        enableInput() {
            this.enabled++;
        },
    };
}

/**
 * @param {{ approved?: boolean, feedback?: string, openResult?: boolean, pending?: boolean }} opts
 * @returns {{ deps: any, events: any[], stops: () => number, openedUrls: string[] }}
 */
function makeDeps(opts = {}) {
    let stopCount = 0;
    const events = /** @type {any[]} */ ([]);
    const openedUrls = /** @type {string[]} */ ([]);
    const server = {
        url: "http://127.0.0.1:9999/review",
        waitForDecision: () =>
            opts.pending
                ? new Promise(() => {})
                : Promise.resolve({ approved: opts.approved ?? true, feedback: opts.feedback }),
        stop: () => {
            stopCount++;
        },
    };
    return {
        events,
        openedUrls,
        stops: () => stopCount,
        deps: {
            htmlContent: "<html></html>",
            startPlanReviewServer: () => Promise.resolve(server),
            openInDefaultBrowser: (/** @type {string} */ url) => {
                openedUrls.push(url);
                return Promise.resolve(opts.openResult ?? true);
            },
            recordPlanEvent: (/** @type {any} */ event) => {
                events.push(event);
                return Promise.resolve();
            },
        },
    };
}

/**
 * @returns {Promise<{ dir: string, planPath: string }>}
 */
async function makePlanFile() {
    const dir = await Deno.makeTempDir({ prefix: "runwield-submit-plan-" });
    const planPath = join(dir, "plan.md");
    await Deno.writeTextFile(planPath, "# Plan\n\nDo the thing.\n");
    return { dir, planPath };
}

Deno.test("submitPlanForReview approves a plan, records event, and updates front matter", async () => {
    const { dir, planPath } = await makePlanFile();
    const uiAPI = makeUi();
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
            uiAPI,
            hostedSession: makeHostedSession("review-approve"),
            __deps: harness.deps,
        });

        const updated = await Deno.readTextFile(planPath);
        const parsed = parsePlanFrontMatter(updated);
        assertEquals(parsed.attrs.classification, "FEATURE");
        assertEquals(parsed.attrs.complexity, "MEDIUM");
        assertEquals(parsed.attrs.summary, "Add the thing");
        assertEquals(parsed.attrs.affectedPaths, ["src/a.js"]);
        assertEquals(result, { approved: true, feedback: "looks good" });
        assertEquals(harness.events[0].event, "review_approved");
        assertEquals(harness.openedUrls, ["http://127.0.0.1:9999/review"]);
        assertEquals(harness.stops(), 1);
        assertEquals(uiAPI.disabled, 1);
        assertEquals(uiAPI.enabled, 1);
        assertEquals(uiAPI.messages.some((/** @type {string} */ message) => message.includes("Plan approved")), true);
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("submitPlanForReview records feedback and reports manual browser fallback", async () => {
    const { dir, planPath } = await makePlanFile();
    const uiAPI = makeUi();
    const harness = makeDeps({ approved: false, feedback: "Needs work", openResult: false });

    try {
        const result = await submitPlanForReview({
            cwd: dir,
            planName: "plan",
            planPath,
            uiAPI,
            hostedSession: makeHostedSession("review-feedback"),
            __deps: harness.deps,
        });

        assertEquals(result, { approved: false, feedback: "Needs work" });
        assertEquals(harness.events[0].event, "review_feedback");
        assertEquals(harness.events[0].details.failureReason, "Needs work");
        assertEquals(
            uiAPI.messages.some((/** @type {string} */ message) => message.includes("Could not auto-open browser")),
            true,
        );
        assertEquals(
            uiAPI.messages.some((/** @type {string} */ message) => message.includes("Plan returned with feedback")),
            true,
        );
        assertEquals(harness.stops(), 1);
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test("submitPlanForReview can be cancelled through cancelActivePlanReview", async () => {
    const { dir, planPath } = await makePlanFile();
    const uiAPI = makeUi();
    const harness = makeDeps({ pending: true });

    try {
        const hostedSession = makeHostedSession("review-cancel");
        const pending = submitPlanForReview({
            cwd: dir,
            planName: "plan",
            planPath,
            uiAPI,
            hostedSession,
            __deps: harness.deps,
        });
        for (let i = 0; i < 20 && uiAPI.disabled === 0; i++) {
            await new Promise((resolve) => setTimeout(resolve, 0));
        }

        assertEquals(cancelActivePlanReview(hostedSession), true);
        const result = await pending;

        assertEquals(result, {
            approved: false,
            canceled: true,
            feedback: "Cancelled by user (Esc)",
        });
        assertEquals(cancelActivePlanReview(hostedSession), false);
        assertEquals(harness.events, []);
        assertEquals(harness.stops(), 1);
        assertEquals(uiAPI.enabled, 1);
    } finally {
        await Deno.remove(dir, { recursive: true });
    }
});

Deno.test({
    name: "submitPlanForReview blocks locked shared Plans before server start and file write",
    permissions: { read: true, write: true },
    fn: async () => {
        const cwd = await Deno.makeTempDir();
        try {
            const planPath = join(cwd, "locked.md");
            const before = injectFrontMatter("# Locked", {
                status: "draft",
                collaborationState: COLLABORATION_STATE_REMOTE_CANONICAL,
                collaborationServerUrl: "https://plans.example.test",
                collaborationSpaceId: "space-1",
            });
            await Deno.writeTextFile(planPath, before);
            let serverStarted = false;

            await assertRejects(
                () =>
                    submitPlanForReview({
                        cwd,
                        planName: "locked",
                        planPath,
                        uiAPI: makeUi(),
                        hostedSession: makeHostedSession("review-locked"),
                        __deps: {
                            startPlanReviewServer: /** @type {any} */ (() => {
                                serverStarted = true;
                            }),
                            openInDefaultBrowser: () => Promise.resolve(true),
                            recordPlanEvent: /** @type {any} */ (() => Promise.resolve()),
                            htmlContent: "<html></html>",
                        },
                    }),
                SharedPlanLockError,
            );
            assertEquals(serverStarted, false);
            assertEquals(await Deno.readTextFile(planPath), before);
        } finally {
            await Deno.remove(cwd, { recursive: true });
        }
    },
});
