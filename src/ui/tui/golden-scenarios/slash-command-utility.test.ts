import { registerSlashCommandGoldenTests } from "./slash-command-test-runner.ts";
import {
    slashCopyScenario,
    slashExportScenario,
    slashReloadScenario,
    slashVersionScenario,
} from "./slash-command-tree-utility.ts";

registerSlashCommandGoldenTests("src/ui/tui/golden-scenarios/slash-command-tree-utility.ts", [
    { scenario: slashVersionScenario, exportName: "slashVersionScenario" },
    { scenario: slashExportScenario, exportName: "slashExportScenario" },
    { scenario: slashCopyScenario, exportName: "slashCopyScenario" },
    { scenario: slashReloadScenario, exportName: "slashReloadScenario" },
]);
