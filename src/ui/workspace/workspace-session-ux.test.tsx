// @ts-nocheck: Deno test imports are checked by scripts/run-tests.js, not Astro check.
import { assertEquals } from "@std/assert";
import {
    activePlanProgressApiUrl,
    deriveWorkflowSidebarStages,
    draftRecoveryDecision,
    reduceOperationTransientItems,
    serializeSessionImageForRequest,
    sessionAttachmentsKey,
    sessionDraftKey,
} from "./islands/SessionSurface.jsx";
import { deriveSessionAvailability } from "./components/SessionActivationStatus.jsx";
import { reduceSessionEvents } from "./components/SessionTimeline.jsx";

Deno.test("Session surface preserves drafts and replaces a lost live wait with one interruption line", () => {
    assertEquals(sessionDraftKey("project-1", "session-1"), "runwield:owner:project:project-1:session:session-1:draft");
    assertEquals(draftRecoveryDecision({ status: "unknown" }), "idle");
    const items = reduceOperationTransientItems([
        { type: "interaction_requested", interactionId: "wait-1", interactionType: "text", prompt: "Answer?" },
    ]);
    assertEquals(items[0]?.kind, "interaction");
    const reviewItems = reduceSessionEvents([
        {
            type: "interaction_requested",
            interactionId: "review-1",
            interactionType: "plan_review",
            prompt: "Review plan",
            review: {
                planId: "feature-a",
                planName: "Feature A",
                classification: "PLANNED_CHANGE",
                expectedStatus: "draft",
            },
        },
    ]);
    assertEquals(reviewItems[0]?.kind, "plan-review");
    assertEquals(reviewItems[0]?.request?.planReview?.planName, "Feature A");
    const interrupted = reduceSessionEvents([
        { type: "system_status", eventId: "status-1", message: "The agent was interrupted. Ask it to continue." },
    ]);
    assertEquals(interrupted[0]?.text, "The agent was interrupted. Ask it to continue.");
});

Deno.test("file-locked Sessions wait for the active surface without offering takeover", () => {
    const availability = deriveSessionAvailability({
        state: "active",
        activeSurface: "tui",
        generation: 0,
    });
    assertEquals(availability.key, "active");
    assertEquals(
        availability.explanation,
        "Another RunWield surface is using this Session. It becomes available when that surface stops.",
    );
});

Deno.test("Session timeline renders safe segment and recovery events as system blocks", () => {
    const items = reduceSessionEvents([
        {
            type: "user_message",
            eventId: "opaque-1",
            messageId: "m1",
            text: "Plan",
            segmentOrdinal: 0,
            segmentKind: "planning",
        },
        {
            type: "assistant_text_delta",
            eventId: "opaque-2",
            messageId: "m2",
            delta: "Work",
            segmentOrdinal: 1,
            segmentKind: "execution",
        },
        {
            type: "assistant_text_delta",
            eventId: "opaque-3",
            messageId: "m3",
            delta: "Repair",
            segmentOrdinal: 2,
            segmentKind: "semantic_repair",
        },
        { type: "recovery_event", eventId: "recover-1", message: "Recovered stale action." },
        { type: "recovery_event", eventId: "recover-2", message: "Restarted validation." },
    ]);
    const systemEvents = items.filter((item) => item.kind === "system-event");
    assertEquals(systemEvents.map((item) => item.text), [
        "Planning segment 1",
        "Execution segment 2",
        "Semantic Repair segment 3",
        "Recovered stale action.\nRestarted validation.",
    ]);
    assertEquals(systemEvents.at(-1)?.lines, ["Recovered stale action.", "Restarted validation."]);
    assertEquals(items.some((item) => String(item.text || "").includes("segment-id")), false);
});

Deno.test("Session workflow sidebar uses canonical progress stages", async () => {
    const surface = await Deno.readTextFile("src/ui/workspace/islands/SessionSurface.jsx");
    assertEquals(
        activePlanProgressApiUrl("project-1", "session-1", {
            activeExecutionWorkflow: { planId: "plan-demo" },
        }),
        "/api/owner/projects/project-1/plans/plan-demo/progress?session=session-1",
    );
    assertEquals(
        deriveWorkflowSidebarStages({
            stages: [
                { id: "execution", label: "Execution", state: "passed", detail: "Implementation reached validation." },
                { id: "mechanical", label: "Mechanical Validation", state: "passed", detail: "Checks passed." },
                { id: "semantic", label: "Semantic Code Review", state: "running", detail: "Review is active." },
                { id: "repair", label: "Repair", state: "not_required", detail: "No repair is active." },
                { id: "completion", label: "Completion", state: "pending", detail: "Waiting for delivery." },
            ],
        }).map((stage) => stage.label),
        ["Execution", "Validation", "Repair", "Completion"],
    );
    assertEquals(surface.includes('ownerFetch(apiUrl, { method: "GET" })'), true);
    assertEquals(surface.includes("Canonical workflow progress stages"), true);
});

Deno.test("Session image attachments use a Session-scoped draft key and request payload", () => {
    assertEquals(
        sessionAttachmentsKey("project-1", "session-1"),
        "runwield:owner:project:project-1:session:session-1:image-attachments",
    );
    assertEquals(
        serializeSessionImageForRequest({ id: "img-1", name: "paste.png", mimeType: "image/png", base64: "abc" }),
        { base64: "abc", mimeType: "image/png" },
    );
});

Deno.test("planning workflow Sessions can continue while live execution workflows stay read-only", () => {
    const planning = deriveSessionAvailability({
        state: "idle",
        generation: 4,
        snapshot: { activeAgent: "Planner", workflowContext: { planName: "feature-a" } },
    });
    assertEquals(planning.key, "available");
    assertEquals(planning.canContinue, true);

    const execution = deriveSessionAvailability({
        state: "idle",
        generation: 4,
        snapshot: { activeAgent: "Engineer", activeExecutionWorkflow: { planName: "feature-a" } },
    });
    assertEquals(execution.key, "execution-workflow");
    assertEquals(execution.canContinue, false);
    assertEquals(execution.explanation, "This Session is running work. Use the Plan progress view for current state.");
});
