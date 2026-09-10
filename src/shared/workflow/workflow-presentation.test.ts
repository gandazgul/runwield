import { assertEquals } from "@std/assert";
import { buildWorkflowPresentation } from "./workflow-presentation.ts";

Deno.test("workflow presentation derives current stage, blocker and recovery action from raw progress facts", () => {
    const presentation = buildWorkflowPresentation({
        planName: "workspace/diagram",
        epicName: "workspace",
        intent: "PLANNED_CHANGE",
        stages: [
            { id: "execution", label: "Execution", state: "passed", detail: "Implementation finished." },
            { id: "mechanical", label: "Tests and CI", state: "needs_attention", detail: "CI failed." },
            { id: "repair", label: "Repair", state: "not_required", detail: "No repair is active." },
        ],
    });

    assertEquals(presentation.active, true);
    assertEquals(presentation.plan, "diagram");
    assertEquals(presentation.currentStage?.id, "mechanical");
    assertEquals(presentation.currentStage?.state, "blocked");
    assertEquals(presentation.blocker, "CI failed.");
    assertEquals(presentation.action?.kind, "recover");
    assertEquals(presentation.stages.map((stage) => stage.id), ["execution", "mechanical"]);
});

Deno.test("workflow presentation gives idle Plan facts a real diagram instead of a host mapper", () => {
    const presentation = buildWorkflowPresentation({
        planName: "ready-plan",
        intent: "PLANNED_CHANGE",
        hasWorkingSession: true,
    });

    assertEquals(presentation.currentStage?.id, "planning");
    assertEquals(presentation.currentStage?.state, "current");
    assertEquals(presentation.action?.kind, "review_plan");
    assertEquals(presentation.stages.some((stage) => stage.id === "delivery"), true);
});
