import { registerSlashCommandGoldenTests } from "./slash-command-test-runner.ts";
import {
    slashAgentBaseSettingScenario,
    slashAgentDefaultModelScenario,
    slashAgentFrontmatterModelScenario,
    slashAgentScenario,
    slashAgentUnavailablePresetRecoveryScenario,
    slashModelScenario,
    slashModelUnavailableOverrideRecoveryScenario,
    slashSettingsScenario,
    slashThemeScenario,
} from "./slash-command-tree-configuration.ts";

registerSlashCommandGoldenTests("src/ui/tui/golden-scenarios/slash-command-tree-configuration.ts", [
    { scenario: slashAgentScenario, exportName: "slashAgentScenario" },
    {
        scenario: slashAgentUnavailablePresetRecoveryScenario,
        exportName: "slashAgentUnavailablePresetRecoveryScenario",
    },
    { scenario: slashAgentBaseSettingScenario, exportName: "slashAgentBaseSettingScenario" },
    { scenario: slashAgentDefaultModelScenario, exportName: "slashAgentDefaultModelScenario" },
    { scenario: slashAgentFrontmatterModelScenario, exportName: "slashAgentFrontmatterModelScenario" },
    { scenario: slashModelScenario, exportName: "slashModelScenario" },
    {
        scenario: slashModelUnavailableOverrideRecoveryScenario,
        exportName: "slashModelUnavailableOverrideRecoveryScenario",
    },
    { scenario: slashThemeScenario, exportName: "slashThemeScenario" },
    { scenario: slashSettingsScenario, exportName: "slashSettingsScenario" },
]);
