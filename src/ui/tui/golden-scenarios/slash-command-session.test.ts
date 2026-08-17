import { registerSlashCommandGoldenTests } from "./slash-command-test-runner.ts";
import { slashContextScenario, slashNameScenario, slashSessionScenario } from "./slash-command-tree-session.ts";

registerSlashCommandGoldenTests("src/ui/tui/golden-scenarios/slash-command-tree-session.ts", [
    { scenario: slashNameScenario, exportName: "slashNameScenario" },
    { scenario: slashSessionScenario, exportName: "slashSessionScenario" },
    { scenario: slashContextScenario, exportName: "slashContextScenario" },
]);
