/**
 * @module ui/tui/golden-scenarios/catalog
 * Central catalog for Golden TUI scenario portfolio metadata.
 */

import { initialGoldenScenarios } from "./initial-scenarios.js";
import { plannedChangeWorkflowScenarios } from "./planned-change-workflow.js";
import { presentationAndTerminalScenarios } from "./presentation-and-terminal.js";
import { projectWorkflowScenarios } from "./project-workflow.js";
import { roleJourneyScenarios } from "./role-journeys.js";

export const goldenTuiPortfolioScenarios = [
    ...initialGoldenScenarios,
    ...roleJourneyScenarios,
    ...plannedChangeWorkflowScenarios,
    ...projectWorkflowScenarios,
    ...presentationAndTerminalScenarios,
];

export const goldenTuiExtensiveScenarios = goldenTuiPortfolioScenarios;
