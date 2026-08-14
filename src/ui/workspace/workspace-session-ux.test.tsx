// @ts-nocheck: Deno test imports are checked by scripts/run-tests.js, not Astro check.
import { assertEquals } from "@std/assert";
import { draftRecoveryDecision, reduceOperationTransientItems, sessionDraftKey } from "./islands/SessionSurface.jsx";
import { deriveSessionAvailability } from "./components/SessionActivationStatus.jsx";
import { reduceSessionEvents } from "./components/SessionTimeline.jsx";

Deno.test("Session surface preserves drafts and replaces a lost live wait with one interruption line", () => {
    assertEquals(sessionDraftKey("project-1", "session-1"), "runwield:owner:project:project-1:session:session-1:draft");
    assertEquals(draftRecoveryDecision({ status: "unknown" }), "idle");
    const items = reduceOperationTransientItems([
        { type: "interaction_requested", interactionId: "wait-1", interactionType: "text", prompt: "Answer?" },
    ]);
    assertEquals(items[0]?.kind, "interaction");
    const interrupted = reduceSessionEvents([
        { type: "system_status", eventId: "status-1", message: "The agent was interrupted. Ask it to continue." },
    ]);
    assertEquals(interrupted[0]?.text, "The agent was interrupted. Ask it to continue.");
});

Deno.test("Session availability exposes Take control only after the owner stops renewing", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const past = new Date(Date.now() - 60_000).toISOString();
    assertEquals(
        deriveSessionAvailability({
            protocol: { enabled: true },
            state: "active",
            activeSurface: "tui",
            generation: 0,
            forceAvailableAt: future,
            controlRenewing: true,
        }).canForceRecover,
        false,
    );
    assertEquals(
        deriveSessionAvailability({
            protocol: { enabled: true },
            state: "active",
            activeSurface: "tui",
            generation: 0,
            forceAvailableAt: past,
            controlRenewing: false,
        }).canForceRecover,
        true,
    );
});
