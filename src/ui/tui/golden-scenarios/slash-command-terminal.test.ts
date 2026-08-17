import { registerSlashCommandGoldenTests } from "./slash-command-test-runner.ts";
import {
    slashExitScenario,
    slashHelpScenario,
    slashLoadPlanScenario,
    slashQuitScenario,
    slashShareScenario,
} from "./slash-command-tree-terminal.ts";

registerSlashCommandGoldenTests("src/ui/tui/golden-scenarios/slash-command-tree-terminal.ts", [
    { scenario: slashHelpScenario, exportName: "slashHelpScenario" },
    { scenario: slashLoadPlanScenario, exportName: "slashLoadPlanScenario" },
    { scenario: slashShareScenario, exportName: "slashShareScenario" },
    { scenario: slashQuitScenario, exportName: "slashQuitScenario" },
    { scenario: slashExitScenario, exportName: "slashExitScenario" },
]);
