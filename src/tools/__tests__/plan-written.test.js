import { assertEquals, assertMatch, assertStringIncludes } from "@std/assert";
import { HostedSession } from "../../shared/session/hosted-session.js";
import { RuntimeEventTypes } from "../../shared/session/session-runtime-events.js";
import { SESSION_COMPLETE_GUIDANCE } from "../../shared/workflow/plan-review-recovery.js";
import { createPlanWrittenTool } from "../plan-written.ts";
import { loadPlan } from "../../plan-store.js";

/**
 * @param {Object} options
 * @param {"FEATURE" | "PROJECT" | "PLANNED_CHANGE"} [options.classification]
 * @param {"BUG_FIX" | "FEATURE" | "REFACTOR" | "MAINTENANCE" | "DOCUMENTATION"} [options.workKind]
 * @param {any} [options.reviewResponse]
 * @param {any[]} [options.reviewResponses]
 * @param {any} [options.retryResponse]
 * @param {"run" | "decompose" | "later"} [options.approvalAction]
 * @param {boolean} [options.exists]
 */
async function makeHarness(options = {}) {
    const events = /** @type {any[]} */ ([]);
    const interactionRequests = /** @type {any[]} */ ([]);
    const reviewResponses = [...(options.reviewResponses || [])];
    const cwd = await Deno.makeTempDir();
    await Deno.mkdir(`${cwd}/docs/plans`, { recursive: true });
    if (options.exists !== false) {
        // `approved` because that is where a Plan actually is when this tool records
        // readiness: the review has already run. Starting at `draft` only worked while
        // the lifecycle was faked — the real transition refuses `readiness_passed` from
        // anywhere but `approved`, which is the guarantee this tool depends on.
        //
        // Both Plans exist because tests drive the tool at either name, and the real
        // lifecycle writes the Plan it is named for rather than a recorded call.
        for (const name of ["runtime-boundary", "runtime-epic"]) {
            await Deno.writeTextFile(
                `${cwd}/docs/plans/${name}.md`,
                `---
classification: ${options.classification || "FEATURE"}
status: approved
---
# ${name}
`,
            );
        }
    }
    const hostedSession = new HostedSession({ id: crypto.randomUUID(), cwd });
    hostedSession.setEventSink({ emit: (/** @type {any} */ event) => events.push(event) });
    hostedSession.setInteractionAdapter({
        requestInteraction: (request) => {
            interactionRequests.push(request);
            if (request.type === "approval") {
                return Promise.resolve(options.retryResponse || { outcome: "canceled", value: false });
            }
            const onSurfaceReady = /** @type {any} */ (request._meta)?.onSurfaceReady;
            onSurfaceReady?.({ url: "http://127.0.0.1:4567/review/plan?token=test" });
            // The reviewed revision has to be the Plan's real one: the transition
            // rejects a stale revision, so a made-up string would fail the write.
            const reviewedName = /** @type {any} */ (request._meta)?.planName || "runtime-boundary";
            return loadPlan(cwd, reviewedName).then((plan) => {
                const revision = plan?.revision;
                const scripted = reviewResponses.shift() || options.reviewResponse;
                if (scripted) {
                    return scripted._meta ? { ...scripted, _meta: { revision, ...scripted._meta } } : scripted;
                }
                return {
                    outcome: "accepted",
                    _meta: {
                        approved: true,
                        revision,
                        approvalAction: options.approvalAction ||
                            (options.classification === "PROJECT" ? "decompose" : "run"),
                    },
                };
            });
        },
    });
    const tool = createPlanWrittenTool({
        hostedSession,
        agentName: options.classification === "PROJECT" ? "architect" : "planner",
        triageMeta: {
            classification: options.classification || "FEATURE",
            ...(options.workKind ? { workKind: options.workKind } : {}),
            complexity: "MEDIUM",
            summary: "Plan the boundary",
            affectedPaths: ["src/shared/session/session-runtime.js"],
        },
    });
    /** Read the Plan the tool actually wrote. */
    const readPlan = (name = "runtime-boundary") => loadPlan(cwd, name);
    return { tool, hostedSession, events, interactionRequests, readPlan, cwd };
}

/**
 * @param {Awaited<ReturnType<typeof makeHarness>>["tool"]} tool
 * @param {string} [planName]
 * @param {(result: any) => void} [onUpdate]
 */
function execute(tool, planName = "runtime-boundary", onUpdate = () => {}, params = {}) {
    return /** @type {any} */ (tool.execute)(
        "call",
        {
            planName,
            ...params,
        },
        new AbortController().signal,
        onUpdate,
        {},
    );
}

Deno.test("plan_written validates the declared plan before requesting review", async () => {
    const { tool } = await makeHarness({ exists: false });
    const result = await execute(tool);
    assertMatch(result.content[0].text, /not found/);
    assertEquals(result.terminate, undefined);
});

Deno.test("plan_written ignores legacy plans/ files and requires docs/plans/", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await Deno.mkdir(`${cwd}/plans`, { recursive: true });
        await Deno.writeTextFile(`${cwd}/plans/runtime-boundary.md`, "# Legacy only\n");
        const hostedSession = new HostedSession({ id: crypto.randomUUID(), cwd });
        hostedSession.setInteractionAdapter({
            requestInteraction: () => {
                throw new Error("legacy-only Plan must fail before review");
            },
        });
        const tool = createPlanWrittenTool({
            hostedSession,
            triageMeta: { classification: "PLANNED_CHANGE", complexity: "MEDIUM" },
        });

        const legacyResult = await execute(tool, "runtime-boundary");
        assertStringIncludes(legacyResult.content[0].text, "docs/plans/runtime-boundary.md not found");

        await Deno.mkdir(`${cwd}/docs/plans`, { recursive: true });
        await Deno.writeTextFile(
            `${cwd}/docs/plans/runtime-boundary.md`,
            `---\nclassification: PLANNED_CHANGE\nstatus: approved\n---\n# Current\n`,
        );
        hostedSession.setInteractionAdapter({
            requestInteraction: async () => ({
                outcome: "accepted",
                _meta: {
                    approved: true,
                    approvalAction: "run",
                    revision: (await loadPlan(cwd, "runtime-boundary"))?.revision,
                },
            }),
        });
        const currentResult = await execute(tool, "docs/plans/runtime-boundary.md");
        assertEquals(currentResult.details.outcome, "approved_execute");
    } finally {
        await Deno.remove(cwd, { recursive: true }).catch(() => {});
    }
});

Deno.test("plan_written streams declared plan details into the active tool block", async () => {
    const { tool, events } = await makeHarness();
    const updates = /** @type {any[]} */ ([]);
    await execute(tool, "runtime-boundary", (result) => updates.push(result));

    assertEquals(updates.length >= 2, true);
    const firstText = updates[0].content[0].text;
    assertMatch(firstText, /Plan name: docs\/plans\/runtime-boundary\.md/);
    assertMatch(firstText, /Status: Opening browser review UI\./);
    const readyText = updates[1].content[0].text;
    assertStringIncludes(readyText, "Plan name: docs/plans/runtime-boundary.md");
    assertStringIncludes(
        readyText,
        "Review Plan: \x1b]8;;http://127.0.0.1:4567/review/plan?token=test\x07http://127.0.0.1:4567/review/plan?token=test\x1b]8;;\x07",
    );
    assertEquals(updates[1].details.reviewUrl, "http://127.0.0.1:4567/review/plan?token=test");
    const finalUpdateText = updates.at(-1).content[0].text;
    assertEquals(finalUpdateText.includes("\x1b]8;;"), false);
    assertEquals(finalUpdateText.includes("Review Plan:"), false);
    assertEquals(updates[0].details.planName, "runtime-boundary");
    assertEquals(updates[0].details.planFileUrl.startsWith("file://"), true);
    assertEquals(
        events.some((event) =>
            event.type === RuntimeEventTypes.SYSTEM_STATUS &&
            String(event.message || "").includes("Plan name: docs/plans/runtime-boundary.md")
        ),
        false,
    );
});

Deno.test("plan_written rejects invalid loaded Plan policy before review or readiness", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await Deno.mkdir(`${cwd}/docs/plans`, { recursive: true });
        await Deno.writeTextFile(
            `${cwd}/docs/plans/runtime-boundary.md`,
            `---
classification: FEATURE
executionAgent: engineer
collaborationRecommendation: sometimes
---
# Invalid
`,
        );
        let reviewRequested = false;
        const hostedSession = new HostedSession({ id: crypto.randomUUID(), cwd });
        hostedSession.setInteractionAdapter({
            requestInteraction: () => {
                reviewRequested = true;
                return Promise.resolve({ outcome: "accepted", _meta: { approved: true } });
            },
        });
        const tool = createPlanWrittenTool({
            hostedSession,
            agentName: "planner",
            triageMeta: { classification: "FEATURE", complexity: "MEDIUM" },
        });

        const result = await execute(tool);

        assertEquals(result.details.outcome, "repair_required");
        assertEquals(result.details.reason, "invalid_collaboration_recommendation");
        assertEquals(reviewRequested, false);
        // Rejected before review, so nothing may have advanced the Plan.
        assertEquals((await loadPlan(cwd, "runtime-boundary"))?.attrs.status, "draft");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("plan_written persists declared execution policy to front matter before review", async () => {
    const { tool, readPlan } = await makeHarness({ classification: "PLANNED_CHANGE" });
    const result = await execute(tool, "runtime-boundary", () => {}, {
        executionAgent: "frontend-engineer",
        collaborationRecommendation: "pair",
    });

    assertEquals(result.details.outcome, "approved_execute");
    const attrs = (await readPlan())?.attrs;
    assertEquals(attrs?.executionAgent, "frontend-engineer");
    assertEquals(attrs?.collaborationRecommendation, "pair");
});

Deno.test("plan_written omitted execution policy leaves front matter untouched", async () => {
    const { tool, readPlan } = await makeHarness({ classification: "PLANNED_CHANGE" });
    const result = await execute(tool);

    assertEquals(result.details.outcome, "approved_execute");
    const attrs = (await readPlan())?.attrs;
    assertEquals(attrs?.executionAgent, undefined);
    assertEquals(attrs?.collaborationRecommendation, undefined);
});

Deno.test("plan_written persists a pair recommendation declared for Engineer-owned execution", async () => {
    // Pair used to be rejected for Engineer on the theory that only visual work is
    // worth watching. Steering value is not a browser property: a risky refactor is
    // exactly where the user wants to read the diff between increments.
    const { tool, readPlan } = await makeHarness({ classification: "PLANNED_CHANGE" });
    const result = await execute(tool, "runtime-boundary", () => {}, {
        executionAgent: "engineer",
        collaborationRecommendation: "pair",
    });

    assertEquals(result.details.outcome, "approved_execute");
    const attrs = (await readPlan())?.attrs;
    assertEquals(attrs?.executionAgent, "engineer");
    assertEquals(attrs?.collaborationRecommendation, "pair");
});

Deno.test("plan_written rejects execution policy arguments on PROJECT Epics", async () => {
    const { tool, readPlan } = await makeHarness({ classification: "PROJECT" });
    const result = await execute(tool, "runtime-epic", () => {}, {
        executionAgent: "engineer",
    });

    assertEquals(result.details.outcome, "repair_required");
    assertEquals(result.details.reason, "project_execution_agent");
    const attrs = (await readPlan("runtime-epic"))?.attrs;
    assertEquals(attrs?.executionAgent, undefined);
    assertEquals(attrs?.status, "approved");
});

Deno.test("plan_written returns review feedback and images to the planning agent", async () => {
    const { tool, readPlan } = await makeHarness({
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
    // Feedback is not readiness: the Plan must still be sitting at `approved`.
    assertEquals((await readPlan())?.attrs.status, "approved");
});

Deno.test("plan_written compares a revised Plan with the first reviewed Plan", async () => {
    const { tool, cwd, interactionRequests } = await makeHarness({
        reviewResponses: [
            {
                outcome: "selected",
                _meta: { approved: false, feedback: "Revise the approach." },
            },
            {
                outcome: "accepted",
                _meta: { approved: true, approvalAction: "later" },
            },
        ],
    });

    const firstResult = await execute(tool);
    assertEquals(firstResult.details.outcome, "feedback");

    const planPath = `${cwd}/docs/plans/runtime-boundary.md`;
    const firstPlan = await Deno.readTextFile(planPath);
    await Deno.writeTextFile(planPath, firstPlan.replace("# runtime-boundary", "# Revised runtime boundary"));

    const secondResult = await execute(tool);
    assertEquals(secondResult.details.outcome, "saved");

    const reviewRequests = interactionRequests.filter((request) => request.type === "plan_review");
    assertEquals(reviewRequests.length, 2);
    assertEquals(reviewRequests[0]._meta.previousPlan, undefined);
    assertEquals(reviewRequests[1]._meta.previousPlan, firstPlan);
    assertEquals(reviewRequests[0]._meta.planVersions.length, 1);
    assertEquals(reviewRequests[1]._meta.planVersions.length, 2);
    assertEquals(reviewRequests[1]._meta.planVersions[0].plan, firstPlan);
});

Deno.test("plan_written cancellation asks whether to reopen review before completing", async () => {
    const { tool, events } = await makeHarness({
        reviewResponse: { outcome: "canceled" },
        retryResponse: { outcome: "canceled", value: false },
    });
    const result = await execute(tool);

    assertEquals(result.details.outcome, "canceled");
    assertEquals(result.terminate, true);
    assertEquals(events.some((event) => String(event.message || "").includes("This session is complete")), true);
});

Deno.test("plan_written reopens review when recovery confirmation is accepted", async () => {
    const { tool } = await makeHarness({
        reviewResponses: [
            { outcome: "canceled" },
            { outcome: "accepted", _meta: { approved: true, approvalAction: "run" } },
        ],
        retryResponse: { outcome: "accepted", value: true },
    });
    const result = await execute(tool);

    assertEquals(result.details.outcome, "approved_execute");
    assertEquals(result.terminate, true);
});

Deno.test("plan_written feature approval returns execution outcome", async () => {
    const { tool, readPlan } = await makeHarness({ classification: "FEATURE", approvalAction: "run" });
    const result = await execute(tool);

    assertEquals(result.details.outcome, "approved_execute");
    assertEquals(result.details.triageMeta.classification, "PLANNED_CHANGE");
    assertEquals(result.terminate, true);
    // `ready_for_work` is only reachable from `approved` via `readiness_passed`, so
    // the status is the transition, recorded by the real lifecycle.
    assertEquals((await readPlan())?.attrs.status, "ready_for_work");
});

Deno.test("plan_written accepts planned changes without custom shell checks", async () => {
    const { tool, readPlan } = await makeHarness({ classification: "PLANNED_CHANGE" });
    const result = await execute(tool);

    assertEquals(result.details.outcome, "approved_execute");
    assertEquals((await readPlan())?.attrs.status, "ready_for_work");
});

Deno.test("plan_written accepts PROJECT Epics", async () => {
    const { tool, readPlan } = await makeHarness({ classification: "PROJECT", approvalAction: "decompose" });
    const result = await execute(tool);

    assertEquals(result.details.outcome, "approved_decompose");
    assertEquals((await readPlan())?.attrs.status, "ready_for_decomposition");
});

Deno.test("plan_written preserves documentation triage workKind when Plan front matter omits it", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await Deno.mkdir(`${cwd}/docs/plans`, { recursive: true });
        await Deno.writeTextFile(
            `${cwd}/docs/plans/runtime-boundary.md`,
            `---
classification: PLANNED_CHANGE
status: approved
---
# Bug fix plan
`,
        );
        const hostedSession = new HostedSession({ id: crypto.randomUUID(), cwd });
        hostedSession.setInteractionAdapter({
            // Read at review time so the lifecycle checks the current revision.
            requestInteraction: async () => ({
                outcome: "accepted",
                _meta: {
                    approved: true,
                    approvalAction: "run",
                    revision: (await loadPlan(cwd, "runtime-boundary"))?.revision,
                },
            }),
        });
        const tool = createPlanWrittenTool({
            hostedSession,
            agentName: "planner",
            triageMeta: { classification: "PLANNED_CHANGE", workKind: "DOCUMENTATION", complexity: "MEDIUM" },
        });

        const result = await execute(tool);

        assertEquals(result.details.triageMeta.classification, "PLANNED_CHANGE");
        assertEquals(result.details.triageMeta.workKind, "DOCUMENTATION");
        // Readiness was recorded by the real lifecycle, which is what makes the
        // returned meta above a statement about a Plan that actually moved.
        assertEquals((await loadPlan(cwd, "runtime-boundary"))?.attrs.status, "ready_for_work");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("plan_written preserves triage workKind when approved review attrs omit it", async () => {
    const { tool, readPlan } = await makeHarness({
        classification: "PLANNED_CHANGE",
        workKind: "BUG_FIX",
        reviewResponse: {
            outcome: "accepted",
            _meta: {
                approved: true,
                approvalAction: "run",
                planAttrs: {
                    classification: "PLANNED_CHANGE",
                    complexity: "MEDIUM",
                    summary: "Plan the boundary",
                    affectedPaths: ["src/shared/session/session-runtime.js"],
                    executionAgent: "engineer",
                    collaborationRecommendation: "autonomous",
                },
            },
        },
    });
    const result = await execute(tool);

    assertEquals(result.details.outcome, "approved_execute");
    assertEquals(result.details.triageMeta.workKind, "BUG_FIX");
    // The readiness transition really ran; `workKind` is not part of the canonical
    // Front Matter it writes, so the tool's own returned meta above is where that
    // preservation is observable.
    assertEquals((await readPlan())?.attrs.status, "ready_for_work");
});

Deno.test("plan_written feature approval uses post-review execution metadata for readiness", async () => {
    const { tool, readPlan } = await makeHarness({
        classification: "FEATURE",
        reviewResponse: {
            outcome: "accepted",
            _meta: {
                approved: true,
                approvalAction: "run",
                planAttrs: {
                    classification: "FEATURE",
                    complexity: "MEDIUM",
                    summary: "Plan the boundary",
                    affectedPaths: ["src/shared/session/session-runtime.js"],
                    executionAgent: "frontend-engineer",
                    collaborationRecommendation: "pair",
                },
            },
        },
    });
    const result = await execute(tool);

    assertEquals(result.details.outcome, "approved_execute");
    assertEquals(result.details.triageMeta.executionAgent, "frontend-engineer");
    assertEquals(result.details.triageMeta.collaborationRecommendation, "pair");
    assertEquals((await readPlan())?.attrs.status, "ready_for_work");
});

Deno.test("plan_written saved feature approval keeps post-review execution metadata", async () => {
    const { tool, readPlan } = await makeHarness({
        classification: "FEATURE",
        reviewResponse: {
            outcome: "accepted",
            _meta: {
                approved: true,
                approvalAction: "later",
                planAttrs: {
                    classification: "FEATURE",
                    complexity: "MEDIUM",
                    summary: "Plan the boundary",
                    affectedPaths: ["src/shared/session/session-runtime.js"],
                    executionAgent: "engineer",
                    collaborationRecommendation: "autonomous",
                },
            },
        },
    });
    const result = await execute(tool);

    assertEquals(result.details.outcome, "saved");
    assertEquals(result.details.triageMeta.executionAgent, "engineer");
    assertEquals(result.details.triageMeta.collaborationRecommendation, "autonomous");
    assertEquals((await readPlan())?.attrs.status, "ready_for_work");
});

Deno.test("plan_written feature approval can save without execution", async () => {
    const { tool, events } = await makeHarness({ classification: "FEATURE", approvalAction: "later" });
    const result = await execute(tool);

    assertEquals(result.details.outcome, "saved");
    assertEquals(result.terminate, true);
    assertStringIncludes(result.content[0].text, SESSION_COMPLETE_GUIDANCE);
    assertEquals(events.some((event) => String(event.message || "").includes("Plan saved")), true);
    assertEquals(events.some((event) => String(event.message || "").includes(SESSION_COMPLETE_GUIDANCE)), true);
});

Deno.test("plan_written project approval can save for later with session-complete guidance", async () => {
    const { tool, events } = await makeHarness({ classification: "PROJECT", approvalAction: "later" });
    const result = await execute(tool, "runtime-epic");

    assertEquals(result.details.outcome, "saved");
    assertEquals(result.terminate, true);
    assertStringIncludes(result.content[0].text, SESSION_COMPLETE_GUIDANCE);
    assertEquals(events.some((event) => String(event.message || "").includes("Plan saved")), true);
    assertEquals(events.some((event) => String(event.message || "").includes(SESSION_COMPLETE_GUIDANCE)), true);
});

Deno.test("plan_written project approval returns decomposition outcome", async () => {
    const { tool, readPlan } = await makeHarness({ classification: "PROJECT", approvalAction: "decompose" });
    const result = await execute(tool, "runtime-epic");

    assertEquals(result.details.outcome, "approved_decompose");
    assertEquals(result.details.triageMeta.classification, "PROJECT");
    assertEquals((await readPlan("runtime-epic"))?.attrs.status, "ready_for_decomposition");
});

Deno.test("plan_written missing approval action safely saves for later", async () => {
    const { tool, readPlan } = await makeHarness({
        classification: "FEATURE",
        reviewResponse: { outcome: "accepted", _meta: { approved: true } },
    });
    const result = await execute(tool);

    assertEquals(result.details.outcome, "saved");
    assertEquals((await readPlan())?.attrs.status, "ready_for_work");
});

Deno.test("plan_written mismatched project approval action safely saves for later", async () => {
    const { tool, readPlan } = await makeHarness({ classification: "PROJECT", approvalAction: "run" });
    const result = await execute(tool, "runtime-epic");

    assertEquals(result.details.outcome, "saved");
    assertEquals((await readPlan("runtime-epic"))?.attrs.status, "ready_for_decomposition");
});

Deno.test("plan_written remote review emits a semantic review link", async () => {
    const { tool, events } = await makeHarness({
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
