/**
 * @module ui/tui/golden-scenarios/catalog
 * Central catalog for Golden TUI scenario portfolio metadata.
 */

import { concurrentWorkflowScenarios } from "./concurrent-workflow.ts";
import { initialGoldenScenarios } from "./initial-scenarios.js";
import { loadPlanWorkflowScenarios } from "./load-plan-workflow.ts";
import { plannedChangeWorkflowScenarios } from "./planned-change-workflow.js";
import { presentationAndTerminalScenarios } from "./presentation-and-terminal.js";
import { projectWorkflowScenarios } from "./project-workflow.js";
import { roleJourneyScenarios } from "./role-journeys.js";
import { validationWorkflowTreeScenarios } from "./validation-workflow-tree.ts";

export const goldenTuiPortfolioScenarios = [
    ...initialGoldenScenarios,
    ...roleJourneyScenarios,
    ...plannedChangeWorkflowScenarios,
    ...projectWorkflowScenarios,
    ...loadPlanWorkflowScenarios,
    ...validationWorkflowTreeScenarios,
    ...concurrentWorkflowScenarios,
    ...presentationAndTerminalScenarios,
];

export const goldenTuiExtensiveScenarios = goldenTuiPortfolioScenarios;
