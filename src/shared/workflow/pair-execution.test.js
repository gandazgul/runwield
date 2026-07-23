import { assertEquals } from "@std/assert";
import { parsePlanFrontMatter, resolvePlanExecutionPolicy } from "../../plan-store.js";
import { HostedSession } from "../session/hosted-session.js";
import { decidePostExecution } from "./decisions.js";
import { resolveExecutionOwner, supportsPairExecution } from "./workflow.js";

Deno.test("Plan metadata normalizes explicit pair execution ownership", () => {
    const parsed = parsePlanFrontMatter(`---
classification: FEATURE
executionAgent: frontend-engineer
collaborationRecommendation: pair
---
# UI
`);
    assertEquals(parsed.attrs.executionAgent, "frontend-engineer");
    assertEquals(parsed.attrs.collaborationRecommendation, "pair");
    assertEquals(resolvePlanExecutionPolicy(parsed.attrs), {
        ok: true,
        policy: {
            executionAgent: "frontend-engineer",
            collaborationRecommendation: "pair",
            source: "canonical",
        },
    });
    assertEquals(resolveExecutionOwner(parsed.attrs), "frontend-engineer");
});

Deno.test("legacy frontend true resolves to autonomous Frontend Engineer", () => {
    const parsed = parsePlanFrontMatter(`---
classification: FEATURE
frontend: true
---
# Legacy UI
`);
    assertEquals(resolvePlanExecutionPolicy(parsed.attrs), {
        ok: true,
        policy: {
            executionAgent: "frontend-engineer",
            collaborationRecommendation: "autonomous",
            source: "legacy_frontend",
        },
    });
    assertEquals(resolveExecutionOwner(parsed.attrs), "frontend-engineer");
});

Deno.test("missing and frontend false ownership resolve to Engineer", () => {
    assertEquals(resolveExecutionOwner({}), "engineer");
    assertEquals(resolveExecutionOwner({ frontend: false }), "engineer");
});

Deno.test("Pair capability requires explicit pair checkpoint support", () => {
    const unsupported = new HostedSession({
        id: "pair-unsupported",
        cwd: Deno.cwd(),
        interactionAdapter: {
            requestInteraction: () => ({ outcome: "selected", value: "pair" }),
        },
    });
    const genericOnly = new HostedSession({
        id: "pair-generic-only",
        cwd: Deno.cwd(),
        interactionAdapter: {
            supportsInteraction: (type) => type === "select" || type === "text",
            requestInteraction: () => ({ outcome: "selected", value: "pair" }),
        },
    });
    const throwing = new HostedSession({
        id: "pair-throwing",
        cwd: Deno.cwd(),
        interactionAdapter: {
            supportsInteraction: () => {
                throw new Error("capability probe failed");
            },
            requestInteraction: () => ({ outcome: "selected", value: "pair" }),
        },
    });
    const supported = new HostedSession({
        id: "pair-supported",
        cwd: Deno.cwd(),
        interactionAdapter: {
            supportsInteraction: (type) => type === "pair_checkpoint",
            requestInteraction: () => ({ outcome: "selected", value: "pair" }),
        },
    });

    assertEquals(supportsPairExecution(new HostedSession({ id: "pair-none", cwd: Deno.cwd() })), false);
    assertEquals(supportsPairExecution(unsupported), false);
    assertEquals(supportsPairExecution(genericOnly), false);
    assertEquals(supportsPairExecution(throwing), false);
    assertEquals(supportsPairExecution(supported), true);
});

Deno.test("post-execution decisions keep Pair pauses out of validation", () => {
    const options = /** @type {const} */ ({
        planName: "visual-plan",
        triageMeta: { classification: "FEATURE" },
        executionAgentName: "frontend-engineer",
    });

    assertEquals(
        decidePostExecution(
            { repairRequired: false, executionComplete: false, paused: true, pauseReason: "stop" },
            options,
        ),
        {
            kind: "stay_with_agent",
            payload: {
                agentName: "frontend-engineer",
                reason: "execution_paused",
                pauseReason: "stop",
                error: undefined,
            },
        },
    );
    assertEquals(
        decidePostExecution(
            { repairRequired: false, executionComplete: false, canceled: true },
            options,
        ).payload.reason,
        "execution_canceled",
    );
});
