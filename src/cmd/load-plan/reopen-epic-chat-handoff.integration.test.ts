import { assert, assertEquals, assertStrictEquals, assertStringIncludes } from "@std/assert";
import {
    fauxAssistantMessage,
    fauxText,
    fauxToolCall,
    getCurrentSystemPrompt,
    type TranscriptContext,
} from "@earendil-works/pi-ai";
import { ensurePlanIdentity, loadPlan, savePlan } from "../../plan-store.js";
import { createSessionRuntime } from "../../shared/session/session-runtime.ts";
import { openOwnerCoordinationStore } from "../../shared/owner-coordination/index.js";
import { requestLocalReviewInteraction } from "../../shared/session/local-review-interactions.ts";
import { RuntimeInteractionTypes } from "../../shared/session/session-runtime-interactions.js";
import type { PlanReviewConversation } from "../../shared/session/plan-review-conversation.ts";
import { withRuntimeCommandFixture } from "../testing/runtime-command-fixture.ts";

async function decide(url: string, body: Record<string, string | boolean>) {
    const page = new URL(url);
    const token = page.searchParams.get("token");
    assert(token);
    const response = await fetch(
        new URL(`/api/review/${body.approved ? "decision" : "deny"}?token=${token}`, page.origin),
        {
            method: "POST",
            headers: { "content-type": "application/json", "x-runwield-review-token": token },
            body: JSON.stringify(body),
        },
    );
    assertEquals(response.status, 200, await response.text());
}

Deno.test("reopened saved Epic chat hands feedback to Architect and shows its model-authored revision", async () => {
    await withRuntimeCommandFixture(
        "reopen-epic-handoff-",
        async ({ homeDir, projectRoot, setModelResponseFactories }) => {
            await savePlan(projectRoot, "epic", "# Epic\n\n## Context\n\nOriginal delivery boundary.\n", {
                classification: "PROJECT",
                status: "draft",
                affectedPaths: [],
            });
            const store = openOwnerCoordinationStore({ dbPath: `${homeDir}/owner.sqlite3` });
            const runtime = createSessionRuntime({ sessionStore: store, ownerProcessKind: "test" });
            let url = "";
            let readyCount = 0;
            const conversations: PlanReviewConversation[] = [];
            const prompts: string[] = [];
            let modelTurns = 0;
            try {
                const { sessionId } = await runtime.createInteractiveSession({ cwd: projectRoot, mode: "new" });
                const initial = await ensurePlanIdentity(projectRoot, "epic");
                runtime.setInteractionAdapter(sessionId, { requestInteraction: () => ({ outcome: "canceled" }) });
                await runtime.requestInteraction(sessionId, {
                    type: RuntimeInteractionTypes.PLAN_REVIEW,
                    prompt: "Review saved Epic",
                    _meta: { planId: initial.attrs.planId, planName: "epic", planningAgentName: "architect" },
                });
                const persistentId = runtime.getSessionSnapshot(sessionId)?.managed?.runwieldSessionId;
                const modelResponse = async (context: TranscriptContext) => {
                    modelTurns++;
                    prompts.push(`${getCurrentSystemPrompt(context.messages)}\n${JSON.stringify(context.messages)}`);
                    const current = await loadPlan(projectRoot, "epic");
                    assert(current);
                    await savePlan(
                        projectRoot,
                        "epic",
                        `# Epic\n\n## Context\n\nArchitect revision ${modelTurns}.\n`,
                        current.attrs,
                        {
                            expectedRevision: current.revision,
                        },
                    );
                    return fauxAssistantMessage([
                        fauxText(`Architect revised the Epic in round ${modelTurns}.`),
                        fauxToolCall("plan_written", { planName: "epic" }),
                    ]);
                };
                setModelResponseFactories([modelResponse, modelResponse]);
                runtime.setInteractionAdapter(sessionId, {
                    async requestInteraction(request, signal) {
                        if (request.type !== RuntimeInteractionTypes.PLAN_REVIEW) return { outcome: "canceled" };
                        const conversation = request._meta?.reviewConversation;
                        assert(conversation && typeof conversation === "object" && "id" in conversation);
                        conversations.push(conversation as PlanReviewConversation);
                        const response = await requestLocalReviewInteraction({
                            ...request,
                            _meta: {
                                ...request._meta,
                                onSurfaceReady: (surface: { url: string }) => {
                                    url = surface.url;
                                    readyCount++;
                                },
                            },
                        }, signal);
                        return response;
                    },
                });
                // The revised plan_written handoff opens its next review inside this same runtime operation.
                const pending = runtime.reopenPlanReview(sessionId);
                let settled = false;
                try {
                    for (let i = 0; i < 200 && !url; i++) await new Promise((resolve) => setTimeout(resolve, 20));
                    assert(url, "The saved Epic review page did not open");
                    const firstUrl = url;
                    assertEquals(modelTurns, 0, "Opening the saved review must not turn the Architect model");
                    await decide(firstUrl, {
                        approved: false,
                        conversationTurn: true,
                        feedback: "Clarify milestone 1.",
                    });
                    for (let i = 0; i < 200 && readyCount < 2; i++) {
                        await new Promise((resolve) => setTimeout(resolve, 20));
                    }
                    assertEquals(readyCount, 2, "plan_written must reopen review after the Architect turn");
                    for (let i = 0; i < 200 && modelTurns < 1; i++) {
                        await new Promise((resolve) => setTimeout(resolve, 20));
                    }
                    assertEquals(url, firstUrl);
                    const saved = await loadPlan(projectRoot, "epic");
                    assert(saved);
                    assertStringIncludes(saved.markdown, "Architect revision 1.");
                    const page = new URL(url);
                    const token = page.searchParams.get("token");
                    assert(token);
                    const response = await fetch(new URL(`/api/review/conversation?token=${token}`, page.origin), {
                        headers: { "x-runwield-review-token": token },
                    });
                    assertEquals(response.status, 200);
                    const status = await response.json();
                    assertEquals(status.agentLabel, "Architect");
                    assertEquals(status.revision, 1);
                    assertStringIncludes(status.plan, "Architect revision 1.");
                    assertStringIncludes(
                        status.events.map((event: { delta: string }) => event.delta).join(""),
                        "Architect revised the Epic in round 1.",
                    );
                    assertEquals(modelTurns, 1);
                    await decide(firstUrl, {
                        approved: false,
                        conversationTurn: true,
                        feedback: "Clarify milestone 2 dependencies.",
                    });
                    for (let i = 0; i < 200 && readyCount < 3; i++) {
                        await new Promise((resolve) => setTimeout(resolve, 20));
                    }
                    assertEquals(
                        readyCount,
                        3,
                        `The second plan_written must reopen review after another Architect turn (model turns: ${modelTurns})`,
                    );
                    assertEquals(modelTurns, 2);
                    assertEquals(url, firstUrl, "The second revision must stay on the same review page");
                    const latest = await loadPlan(projectRoot, "epic");
                    assert(latest);
                    assertStringIncludes(latest.markdown, "Architect revision 2.");
                    const latestResponse = await fetch(
                        new URL(`/api/review/conversation?token=${token}`, page.origin),
                        {
                            headers: { "x-runwield-review-token": token },
                        },
                    );
                    assertEquals(latestResponse.status, 200);
                    const latestStatus = await latestResponse.json();
                    assertEquals(latestStatus.agentLabel, "Architect");
                    assertEquals(latestStatus.revision, 2);
                    assertEquals(latestStatus.plan, latest.markdown);
                    const replies = latestStatus.events.map((event: { delta: string }) => event.delta).join("");
                    assertEquals(
                        new Set(latestStatus.events.map((event: { messageId: string }) => event.messageId)).size,
                        2,
                        "The conversation must contain two distinct Architect replies",
                    );
                    assertStringIncludes(replies, "Architect revised the Epic in round 1.");
                    assertStringIncludes(replies, "Architect revised the Epic in round 2.");
                    const pageResponse = await fetch(firstUrl);
                    assertEquals(pageResponse.status, 200);
                    const html = await pageResponse.text();
                    assertStringIncludes(html, '"previousPlan":' + JSON.stringify(saved.markdown));
                    assertStringIncludes(html, JSON.stringify(latest.markdown));
                    await decide(url, { approved: true, approvalAction: "later" });
                    const result = await pending;
                    settled = true;
                    assertEquals(result.kind, "complete", result.message);
                } finally {
                    if (!settled) {
                        if (url) {
                            try {
                                await decide(url, { approved: true, approvalAction: "later" });
                            } catch {
                                runtime.closeAllSessions();
                            }
                        } else {
                            runtime.closeAllSessions();
                        }
                        await pending;
                    }
                }
                assertEquals(modelTurns, 2);
                assertEquals(runtime.getSessionSnapshot(sessionId)?.activeAgent, "architect");
                assertEquals(runtime.getSessionSnapshot(sessionId)?.managed?.runwieldSessionId, persistentId);
                assertEquals(conversations.length, 3);
                assertStrictEquals(conversations[0], conversations[1]);
                assertStrictEquals(conversations[1], conversations[2]);
                assertEquals(conversations[2].revision, 2);
                const replies = conversations[2].events.map((event) => event.delta).join("");
                assertStringIncludes(replies, "Architect revised the Epic in round 1.");
                assertStringIncludes(replies, "Architect revised the Epic in round 2.");
                assertEquals(prompts.length, 2);
                assert(prompts.every((prompt) => prompt.includes("Architect")));
                assertStringIncludes(prompts[0], "Clarify milestone 1.");
                assertStringIncludes(prompts[1], "Clarify milestone 2 dependencies.");
            } finally {
                await runtime.closeAllSessionsWhenIdle();
                store.close();
            }
        },
    );
});
