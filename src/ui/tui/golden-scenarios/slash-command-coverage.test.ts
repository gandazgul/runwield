import { assertEquals } from "@std/assert";
import { getSlashCommandDefinitions } from "../../../cmd/registry.js";
import { goldenTuiPortfolioScenarios } from "./catalog.js";

const EXPECTED_SLASH_COMMANDS = [
    "agent",
    "compact",
    "context",
    "copy",
    "exit",
    "export",
    "help",
    "init",
    "load-plan",
    "login",
    "logout",
    "model",
    "name",
    "new",
    "quit",
    "reload",
    "resume",
    "session",
    "settings",
    "share",
    "sleep",
    "status",
    "theme",
    "version",
] as const;

type OwnedScenario = { name: string; slashCommands?: string[] };

Deno.test("every canonical slash command has exactly one Golden scenario owner", () => {
    const registered = getSlashCommandDefinitions().map((definition) => definition.name).sort();
    assertEquals(registered, [...EXPECTED_SLASH_COMMANDS]);

    const owners = new Map<string, string[]>();
    for (const scenario of goldenTuiPortfolioScenarios as OwnedScenario[]) {
        for (const command of scenario.slashCommands || []) {
            owners.set(command, [...(owners.get(command) || []), scenario.name]);
        }
    }

    assertEquals([...owners.keys()].sort(), [...EXPECTED_SLASH_COMMANDS]);
    assertEquals(
        [...owners.entries()].filter(([, scenarioNames]) => scenarioNames.length !== 1),
        [],
    );
});
