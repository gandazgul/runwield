import { assert, assertEquals } from "@std/assert";
import { assertEventIncludes, assertScreenIncludes } from "../testing/scenario-runner.js";

type InteractionResult = {
    state: { scriptedInteractions?: Array<{ interaction?: { value?: string } }> };
};

export const slashAgentScenario = {
    name: "slash-command-agent",
    slashCommands: ["agent"],
    composedTui: true,
    initialAgentName: "guide",
    terminal: { columns: 100, rows: 30 },
    actions: [
        { type: "type", text: "/agent planner" },
        { type: "enter" },
        { type: "waitForEvent", event: "runtime:agent:planner" },
        { type: "waitForIdle" },
    ],
    assertions: [
        (result: Parameters<typeof assertEventIncludes>[0]) =>
            assertEventIncludes(result, "terminal:type:/agent planner"),
        (result: Parameters<typeof assertEventIncludes>[0]) => assertEventIncludes(result, "runtime:agent:planner"),
    ],
};

export const slashModelScenario = {
    name: "slash-command-model",
    slashCommands: ["model"],
    composedTui: true,
    initialAgentName: "guide",
    terminal: { columns: 100, rows: 30 },
    actions: [
        { type: "type", text: "/model golden/faux" },
        { type: "enter" },
        { type: "waitForIdle" },
    ],
    assertions: [
        (result: Parameters<typeof assertEventIncludes>[0]) =>
            assertEventIncludes(result, "terminal:type:/model golden/faux"),
        (result: Parameters<typeof assertScreenIncludes>[0]) =>
            assertScreenIncludes(result, "Switched model to golden/faux"),
    ],
};

export const slashThemeScenario = {
    name: "slash-command-theme",
    slashCommands: ["theme"],
    composedTui: true,
    initialAgentName: "guide",
    terminal: { columns: 100, rows: 30 },
    scriptedInteractions: [{ type: "select", promptIncludes: "Select Theme", value: "catppuccin-mocha" }],
    actions: [
        { type: "type", text: "/theme" },
        { type: "enter" },
        { type: "waitForIdle" },
    ],
    assertions: [
        (result: Parameters<typeof assertEventIncludes>[0]) => assertEventIncludes(result, "terminal:type:/theme"),
        (result: InteractionResult) => {
            assertEquals(result.state.scriptedInteractions?.[0]?.interaction?.value, "catppuccin-mocha");
        },
    ],
};

export const slashSettingsScenario = {
    name: "slash-command-settings",
    slashCommands: ["settings"],
    composedTui: true,
    initialAgentName: "guide",
    terminal: { columns: 100, rows: 30 },
    scriptedInteractions: [{ type: "select", promptIncludes: "Settings", value: "done" }],
    actions: [
        { type: "type", text: "/settings" },
        { type: "enter" },
        { type: "waitForIdle" },
    ],
    assertions: [
        (result: Parameters<typeof assertEventIncludes>[0]) => assertEventIncludes(result, "terminal:type:/settings"),
        (result: InteractionResult) => {
            const value = result.state.scriptedInteractions?.[0]?.interaction?.value;
            assert(value === "done", `Expected Settings Done selection, got ${value}`);
        },
    ],
};

export const slashCommandConfigurationScenarios = [
    slashAgentScenario,
    slashModelScenario,
    slashThemeScenario,
    slashSettingsScenario,
];
