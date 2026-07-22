import { assertEquals } from "@std/assert";
import { parsePlanFrontMatter, resolvePlanExecutionPolicy } from "../../plan-store.js";
import { resolveExecutionOwner } from "./workflow.js";
import { createPairCheckpointTool } from "../../tools/pair-checkpoint.js";

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
    assertEquals(parsed.attrs.executionAgent, undefined);
    assertEquals(parsed.attrs.collaborationRecommendation, undefined);
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

for (const decision of ["continue", "revise", "autonomous", "stop", "cancel"]) {
    Deno.test(`pair checkpoint enforces ${decision} behavior`, async () => {
        let workflow = /** @type {any} */ ({
            planName: "visual-plan",
            projectRoot: Deno.cwd(),
            executionAgent: "frontend-engineer",
        });
        /** @type {any[]} */
        const updates = [];
        const hostedSession = /** @type {any} */ ({
            cwd: Deno.cwd(),
            getActiveExecutionWorkflow: () => workflow,
            setActiveExecutionWorkflow: (/** @type {any} */ next) => workflow = next,
            getInteractionAdapter: () => ({
                requestInteraction: () =>
                    Promise.resolve(
                        decision === "cancel" ? { outcome: "canceled" } : {
                            outcome: "selected",
                            value: decision,
                            _meta: decision === "revise" ? { feedback: "Tighten spacing" } : {},
                        },
                    ),
            }),
        });
        const tool = createPairCheckpointTool({
            hostedSession,
            __deps: {
                recordWorkflowMetric: () => Promise.resolve(null),
            },
        });

        const result = await tool.execute(
            "checkpoint-1",
            {
                summary: "Rendered settings form",
                nextIncrement: "Polish validation states",
            },
            undefined,
            undefined,
            /** @type {any} */ ({}),
        );
        const expected = decision === "cancel" ? "stop" : decision;
        assertEquals(result.details.outcome, expected);
        assertEquals(workflow.pairStopRequested, expected === "stop" ? true : undefined);
        assertEquals(updates.length, 0);
    });
}
