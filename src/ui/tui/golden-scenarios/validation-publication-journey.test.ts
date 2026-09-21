import { validationPublicationJourneyScenario } from "./validation-publication-journey.ts";
import { registerValidationWorkflowTests } from "./validation-workflow-test-runner.ts";

registerValidationWorkflowTests("src/ui/tui/golden-scenarios/validation-publication-journey.ts", [{
    scenario: validationPublicationJourneyScenario,
    exportName: "validationPublicationJourneyScenario",
}]);
