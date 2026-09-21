import { assertEquals } from "@std/assert";
import { withRuntimeCommandFixture } from "../../cmd/testing/runtime-command-fixture.ts";
import { createSessionRuntime } from "../../shared/session/session-runtime.js";
import { savePlan } from "../../plan-store.js";
import { writeControllerState } from "../../shared/workflow/controller-registry.ts";
import { RuntimeEventTypes } from "../../shared/session/session-runtime-events.js";
import { getTutorialExplanation, presentTutorialEvent } from "./tutorial-guidance.ts";

const CHECKS = { ci: "passed", semanticReview: "passed", humanReview: "skipped", merge: "passed" };

Deno.test("tutorial explanations follow semantic workflow events", () => {
    assertEquals(
        getTutorialExplanation(
            /** @type {any} */ ({
                type: RuntimeEventTypes.INTERACTION_REQUESTED,
                interactionType: "plan_review",
            }),
        )?.id,
        "plan-review",
    );
    assertEquals(
        getTutorialExplanation(
            /** @type {any} */ ({
                type: RuntimeEventTypes.AGENT_CHANGED,
                agentName: "plan-engineer",
                rootHandoff: true,
            }),
        )?.id,
        "implementation",
    );
    assertEquals(
        getTutorialExplanation(
            /** @type {any} */ ({
                type: RuntimeEventTypes.SYSTEM_STATUS,
                validationProgress: { stage: "engineer_repair", outcome: "started", checks: CHECKS },
            }),
        )?.id,
        "ai-repair",
    );
    assertEquals(
        getTutorialExplanation(
            /** @type {any} */ ({
                type: RuntimeEventTypes.SYSTEM_STATUS,
                validationProgress: { stage: "terminal", outcome: "verified", checks: CHECKS },
            }),
        )?.id,
        "verified-recap",
    );
    assertEquals(
        getTutorialExplanation(
            /** @type {any} */ ({
                type: RuntimeEventTypes.SYSTEM_STATUS,
                validationProgress: { stage: "terminal", outcome: "paused", checks: CHECKS },
            }),
        ),
        null,
    );
});

Deno.test("tutorial verified recap excludes manual verification and closure", async () => {
    await withRuntimeCommandFixture("tutorial-manual-status-", async ({ projectRoot, setModelResponse }) => {
        setModelResponse("Choose a small change.");
        for (const status of /** @type {const} */ (["user_verified", "closed_without_verification"])) {
            const planId = `${status}-plan-id`;
            const planName = `${status}-plan`;
            await savePlan(projectRoot, planName, `# ${planName}\n`, {
                planId,
                status,
                classification: "PLANNED_CHANGE",
                complexity: "LOW",
            });
            await writeControllerState(projectRoot, { planId, planName }, {
                verifiedAt: "2026-01-01T00:00:00.000Z",
                deliveryEvidence: { version: 1, mode: "non_git_in_place" },
            });

            const runtime = createSessionRuntime();
            const created = await runtime.createInteractiveSession({ cwd: projectRoot, mode: "new" });
            /** @type {string[]} */
            const messages = [];
            try {
                await runtime.promptUserTurn(created.sessionId, {
                    initialRequest: "Start tutorial",
                    initialImages: [],
                    agentName: "planner",
                    initialTutorialContext: {
                        version: 1,
                        guidanceEnabled: true,
                        shownExplanationIds: ["choose-improvement"],
                        recapShown: false,
                        planId: null,
                    },
                });
                await runtime.recordPlanAssociation(created.sessionId, {
                    planId,
                    planName,
                    purpose: "planning",
                });
                await runtime.updateTutorialContext(created.sessionId, { planId });
                await presentTutorialEvent({
                    runtime,
                    sessionId: created.sessionId,
                    uiAPI: /** @type {any} */ ({
                        appendSystemMessage: (/** @type {string} */ text) => messages.push(text),
                    }),
                    event: /** @type {any} */ ({ type: RuntimeEventTypes.BUSY_CHANGED, busy: false }),
                });
                assertEquals(messages, [], `${status} must not produce a verified recap`);
                assertEquals(runtime.getSessionSnapshot(created.sessionId)?.tutorialContext?.recapShown, false);
            } finally {
                await runtime.closeAllSessionsWhenIdle();
            }
        }
    });
});

Deno.test("tutorial guidance persists deduplication and requires an associated Plan for verified recap", async () => {
    await withRuntimeCommandFixture("tutorial-guidance-", async ({ projectRoot, setModelResponse }) => {
        setModelResponse("Choose a small change.");
        const runtime = createSessionRuntime();
        const created = await runtime.createInteractiveSession({ cwd: projectRoot, mode: "new" });
        const sessionId = created.sessionId;
        /** @type {string[]} */
        const messages = [];
        const uiAPI = /** @type {any} */ ({
            promptSelect: () => Promise.resolve("continue"),
            appendSystemMessage: (
                /** @type {string} */ text,
                /** @type {boolean} */ _isError,
                /** @type {string} */ header,
            ) => messages.push(`${header}: ${text}`),
        });
        try {
            await runtime.promptUserTurn(sessionId, {
                initialRequest: "Start tutorial",
                initialImages: [],
                agentName: "planner",
                initialTutorialContext: {
                    version: 1,
                    guidanceEnabled: true,
                    shownExplanationIds: ["choose-improvement"],
                    recapShown: false,
                    planId: null,
                },
            });
            const reviewEvent = /** @type {any} */ ({
                type: RuntimeEventTypes.INTERACTION_REQUESTED,
                interactionType: "plan_review",
            });
            await presentTutorialEvent({ runtime, sessionId, uiAPI, event: reviewEvent });
            await presentTutorialEvent({ runtime, sessionId, uiAPI, event: reviewEvent });
            assertEquals(messages.length, 1);
            assertEquals(runtime.getSessionSnapshot(sessionId)?.tutorialContext?.shownExplanationIds, [
                "choose-improvement",
                "plan-review",
            ]);

            const verifiedEvent = /** @type {any} */ ({
                type: RuntimeEventTypes.SYSTEM_STATUS,
                validationProgress: { stage: "terminal", outcome: "verified", checks: CHECKS },
            });
            await presentTutorialEvent({ runtime, sessionId, uiAPI, event: verifiedEvent });
            assertEquals(messages.length, 1, "verified recap needs committed Plan identity");

            assertEquals(
                (await runtime.recordPlanAssociation(sessionId, {
                    planId: "plan-1",
                    planName: "small-change",
                    purpose: "planning",
                })).ok,
                true,
            );
            assertEquals((await runtime.updateTutorialContext(sessionId, { planId: "plan-1" })).ok, true);
            await presentTutorialEvent({ runtime, sessionId, uiAPI, event: verifiedEvent });

            assertEquals(messages.length, 1, "an association alone does not prove the active workflow was published");
            assertEquals(runtime.getSessionSnapshot(sessionId)?.tutorialContext?.recapShown, false);
        } finally {
            await runtime.closeAllSessionsWhenIdle();
        }
    });
});
