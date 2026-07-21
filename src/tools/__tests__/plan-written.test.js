import { assertEquals, assertMatch } from "@std/assert";
import { HostedSession } from "../../shared/session/hosted-session.js";
import { RuntimeEventTypes } from "../../shared/session/session-runtime-events.js";
import { createPlanWrittenTool } from "../plan-written.js";

/**
 * @param {Object} options
 * @param {"FEATURE" | "PROJECT"} [options.classification]
 * @param {any} [options.reviewResponse]
 * @param {"proceed" | "save"} [options.action]
 * @param {boolean} [options.exists]
 */
function makeHarness(options = {}) {
    const events = /** @type {any[]} */ ([]);
    const lifecycle = /** @type {any[]} */ ([]);
    const metrics = /** @type {any[]} */ ([]);
    const hostedSession = new HostedSession({ id: crypto.randomUUID(), cwd: Deno.cwd() });
    hostedSession.setEventSink({ emit: (/** @type {any} */ event) => events.push(event) });
    const tool = createPlanWrittenTool({
        hostedSession,
        agentName: options.classification === "PROJECT" ? "architect" : "planner",
        triageMeta: {
            classification: options.classification || "FEATURE",
            complexity: "MEDIUM",
            summary: "Plan the boundary",
            affectedPaths: ["src/shared/session/session-runtime.js"],
        },
        __deps: {
            cwd: Deno.cwd(),
            stat: () =>
                options.exists === false
                    ? Promise.reject(new Deno.errors.NotFound())
                    : Promise.resolve({ isFile: true }),
            requestPlanReview: () =>
                Promise.resolve(
                    options.reviewResponse || {
                        outcome: "accepted",
                        _meta: { approved: true },
                    },
                ),
            askPostApproval: () => Promise.resolve(options.action || "proceed"),
            askProjectDecompositionApproval: () => Promise.resolve(options.action || "proceed"),
            recordPlanEvent: (event) => {
                lifecycle.push(event);
                return Promise.resolve(/** @type {any} */ (event.details?.triageMeta || {}));
            },
            recordWorkflowMetric: (metric) => {
                metrics.push(metric);
                return Promise.resolve(/** @type {any} */ (null));
            },
        },
    });
    return { tool, hostedSession, events, lifecycle, metrics };
}

/**
 * @param {ReturnType<typeof makeHarness>["tool"]} tool
 * @param {string} [planName]
 * @param {(result: any) => void} [onUpdate]
 */
function execute(tool, planName = "runtime-boundary", onUpdate = () => {}) {
    return /** @type {any} */ (tool.execute)("call", { planName }, new AbortController().signal, onUpdate, {});
}

Deno.test("plan_written validates the declared plan before requesting review", async () => {
    const { tool } = makeHarness({ exists: false });
    const result = await execute(tool);
    assertMatch(result.content[0].text, /not found/);
    assertEquals(result.terminate, undefined);
});

Deno.test("plan_written streams declared plan details into the active tool block", async () => {
    const { tool } = makeHarness();
    const updates = /** @type {any[]} */ ([]);
    await execute(tool, "runtime-boundary", (result) => updates.push(result));

    assertEquals(updates.length >= 2, true);
    const firstText = updates[0].content[0].text;
    assertMatch(firstText, /Plan: plans\/runtime-boundary\.md/);
    assertMatch(firstText, /File URL: file:\/\//);
    assertMatch(firstText, /Path: .*plans\/runtime-boundary\.md/);
    assertMatch(firstText, /Status: Opening browser review UI\./);
    assertEquals(updates[0].details.planName, "runtime-boundary");
    assertEquals(updates[0].details.planFileUrl.startsWith("file://"), true);
});

Deno.test("plan_written returns review feedback and images to the planning agent", async () => {
    const { tool, lifecycle } = makeHarness({
        reviewResponse: {
            outcome: "selected",
            _meta: {
                approved: false,
                feedback: "Remove the cross-boundary import.",
                images: [{ base64: "abc", mimeType: "image/png" }],
            },
        },
    });
    const result = await execute(tool);

    assertEquals(result.terminate, undefined);
    assertEquals(result.details, {
        planName: "runtime-boundary",
        outcome: "feedback",
        feedback: "Remove the cross-boundary import.",
        imageCount: 1,
    });
    assertEquals(result.content.some((/** @type {any} */ item) => item.type === "image"), true);
    assertEquals(lifecycle, []);
});

Deno.test("plan_written cancellation is terminal and event-driven", async () => {
    const { tool, events } = makeHarness({
        reviewResponse: { outcome: "canceled" },
    });
    const result = await execute(tool);

    assertEquals(result.details.outcome, "canceled");
    assertEquals(result.terminate, true);
    assertEquals(events.some((event) => event.type === RuntimeEventTypes.SYSTEM_STATUS), true);
});

Deno.test("plan_written feature approval returns execution outcome", async () => {
    const { tool, lifecycle, metrics } = makeHarness({ classification: "FEATURE", action: "proceed" });
    const result = await execute(tool);

    assertEquals(result.details.outcome, "approved_execute");
    assertEquals(result.details.triageMeta.classification, "FEATURE");
    assertEquals(result.terminate, true);
    assertEquals(lifecycle.map((event) => event.event), ["readiness_passed"]);
    assertEquals(metrics.some((metric) => metric.details?.outcome === "approved_execute"), true);
});

Deno.test("plan_written feature approval can save without execution", async () => {
    const { tool, events } = makeHarness({ classification: "FEATURE", action: "save" });
    const result = await execute(tool);

    assertEquals(result.details.outcome, "saved");
    assertEquals(result.terminate, true);
    assertEquals(events.some((event) => String(event.message || "").includes("Plan saved")), true);
});

Deno.test("plan_written project approval returns decomposition outcome", async () => {
    const { tool, lifecycle } = makeHarness({ classification: "PROJECT", action: "proceed" });
    const result = await execute(tool, "runtime-epic");

    assertEquals(result.details.outcome, "approved_decompose");
    assertEquals(result.details.triageMeta.classification, "PROJECT");
    assertEquals(lifecycle.map((event) => event.event), ["epic_readiness_passed"]);
});

Deno.test("plan_written remote review emits a semantic review link", async () => {
    const { tool, events } = makeHarness({
        reviewResponse: {
            outcome: "accepted",
            message: "Review remotely.",
            _meta: {
                remoteReview: true,
                reviewerUrl: "https://review.example/plan",
                approved: false,
            },
        },
    });
    const result = await execute(tool);

    assertEquals(result.details.outcome, "saved");
    assertEquals(result.details.remoteReview, true);
    assertEquals(events.filter((event) => event.type === RuntimeEventTypes.PLAN_REVIEW_LINK).length, 1);
});
