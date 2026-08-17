import { registerSlashCommandGoldenTests } from "./slash-command-test-runner.ts";
import {
    slashAgentScenario,
    slashModelScenario,
    slashSettingsScenario,
    slashThemeScenario,
} from "./slash-command-tree-configuration.ts";

registerSlashCommandGoldenTests("src/ui/tui/golden-scenarios/slash-command-tree-configuration.ts", [
    { scenario: slashAgentScenario, exportName: "slashAgentScenario" },
    { scenario: slashModelScenario, exportName: "slashModelScenario" },
    { scenario: slashThemeScenario, exportName: "slashThemeScenario" },
    { scenario: slashSettingsScenario, exportName: "slashSettingsScenario" },
]);
