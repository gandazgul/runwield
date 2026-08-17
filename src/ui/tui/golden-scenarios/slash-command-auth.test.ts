import { registerSlashCommandGoldenTests } from "./slash-command-test-runner.ts";
import { slashLoginScenario, slashLogoutScenario, slashStatusScenario } from "./slash-command-tree-auth.ts";

registerSlashCommandGoldenTests("src/ui/tui/golden-scenarios/slash-command-tree-auth.ts", [
    { scenario: slashLoginScenario, exportName: "slashLoginScenario" },
    { scenario: slashLogoutScenario, exportName: "slashLogoutScenario" },
    { scenario: slashStatusScenario, exportName: "slashStatusScenario" },
]);
