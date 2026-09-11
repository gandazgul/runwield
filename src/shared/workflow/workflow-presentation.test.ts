import { assertEquals } from "@std/assert";
import { buildWorkflowPresentation } from "./workflow-presentation.ts";

Deno.test("workflow presentation derives current stage and blocker from raw progress facts without fabricating recovery", () => {
    const presentation = buildWorkflowPresentation({
        planName: "workspace/diagram",
        epicName: "workspace",
        intent: "PLANNED_CHANGE",
        status: "implemented",
        progressFacts: [
            { kind: "validation_checkpoint", phase: "mechanical", state: "awaiting_repair" },
        ],
    });

    assertEquals(presentation.active, true);
    assertEquals(presentation.plan, "diagram");
    assertEquals(presentation.currentStage?.id, "mechanical");
    assertEquals(presentation.currentStage?.state, "blocked");
    assertEquals(presentation.blocker, "Tests and CI needs attention.");
    assertEquals(presentation.action?.kind, "open_plan");
    assertEquals(presentation.connections.some((connection) => connection.kind === "repair_return"), true);
});

Deno.test("workflow presentation exposes recovery only when live capability is present", () => {
    const presentation = buildWorkflowPresentation({
        planName: "workspace/diagram",
        status: "implemented",
        canRecover: true,
        progressFacts: [{ kind: "validation_checkpoint", phase: "mechanical", state: "awaiting_repair" }],
    });

    assertEquals(presentation.action?.kind, "recover");
});

Deno.test("workflow presentation returns repairs to the failed check, not repair itself", () => {
    const presentation = buildWorkflowPresentation({
        planName: "workspace/diagram",
        status: "validated_reviewer",
        progressFacts: [{ kind: "registry", status: "validation_failed" }],
    });

    assertEquals(
        presentation.connections.find((connection) => connection.kind === "repair_return"),
        { from: "repair", to: "delivery", kind: "repair_return" },
    );
});

Deno.test("workflow presentation does not fabricate review actions from missing live facts", () => {
    const presentation = buildWorkflowPresentation({
        planName: "ready-plan",
        intent: "PLANNED_CHANGE",
        hasWorkingSession: true,
    });

    assertEquals(presentation.currentStage?.id, "planning");
    assertEquals(presentation.currentStage?.state, "current");
    assertEquals(presentation.action?.kind, "open_session");
    assertEquals(presentation.stages.some((stage) => stage.id === "delivery"), true);
});

Deno.test("workflow presentation gives container Plans child-work stages", () => {
    const presentation = buildWorkflowPresentation({
        planName: "workspace",
        classification: "PROJECT",
        projectPlanType: "sequence",
        status: "ready_for_decomposition",
    });

    assertEquals(presentation.stages.map((stage) => stage.id), ["review", "decomposition", "child_work", "completion"]);
    assertEquals(presentation.currentStage?.id, "decomposition");
});
