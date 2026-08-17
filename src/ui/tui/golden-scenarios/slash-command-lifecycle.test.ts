import { registerSlashCommandGoldenTests } from "./slash-command-test-runner.ts";
import {
    slashCompactScenario,
    slashInitScenario,
    slashNewScenario,
    slashResumeScenario,
    slashSleepScenario,
    startupInitScenario,
} from "./slash-command-tree-lifecycle.ts";

registerSlashCommandGoldenTests("src/ui/tui/golden-scenarios/slash-command-tree-lifecycle.ts", [
    { scenario: slashNewScenario, exportName: "slashNewScenario" },
    { scenario: slashResumeScenario, exportName: "slashResumeScenario" },
    { scenario: slashCompactScenario, exportName: "slashCompactScenario" },
    { scenario: slashInitScenario, exportName: "slashInitScenario" },
    { scenario: startupInitScenario, exportName: "startupInitScenario" },
    { scenario: slashSleepScenario, exportName: "slashSleepScenario" },
]);
