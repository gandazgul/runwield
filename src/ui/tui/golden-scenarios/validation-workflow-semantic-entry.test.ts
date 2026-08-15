import {
    validationTreeEmptyDiffSkipScenario,
    validationTreeNonGitDeliveryScenario,
    validationTreePlanOnlyDiffFailsScenario,
} from "./validation-workflow-tree-semantic.ts";
import { registerValidationWorkflowTests } from "./validation-workflow-test-runner.ts";

registerValidationWorkflowTests("src/ui/tui/golden-scenarios/validation-workflow-tree-semantic.ts", [
    {
        scenario: validationTreeNonGitDeliveryScenario,
        exportName: "validationTreeNonGitDeliveryScenario",
        todo: "captured TUI evidence does not yet show the non-Git semantic skip",
    },
    {
        scenario: validationTreePlanOnlyDiffFailsScenario,
        exportName: "validationTreePlanOnlyDiffFailsScenario",
        todo: "captured TUI evidence does not yet show the Plan-only diff failure",
    },
    {
        scenario: validationTreeEmptyDiffSkipScenario,
        exportName: "validationTreeEmptyDiffSkipScenario",
        todo: "loading the seeded operation normalizes it and misses the empty-diff skip branch",
    },
]);
