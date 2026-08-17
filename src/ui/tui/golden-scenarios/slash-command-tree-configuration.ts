import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { assertEventIncludes } from "../testing/scenario-runner.js";

const GOLDEN_PROVIDER = "golden";
const FRONTMATTER_MODEL = "frontmatter";
const DEFAULT_MODEL = "default";
const BASE_AGENT_MODEL = "base-agent";
const PRESET_MODEL = "preset";
const MANUAL_MODEL = "manual";
const PLANNER_PROMPT_MARKER = "GOLDEN_PLANNER_MODEL_PRECEDENCE_PROMPT";

const goldenModels = [
    { id: "faux", name: "Golden Startup Model" },
    { id: FRONTMATTER_MODEL, name: "Golden Frontmatter Model" },
    { id: DEFAULT_MODEL, name: "Golden Default Model" },
    { id: BASE_AGENT_MODEL, name: "Golden Base Agent Model" },
    { id: PRESET_MODEL, name: "Golden Preset Model" },
    { id: MANUAL_MODEL, name: "Golden Manual Model" },
];

const plannerFrontmatterFixture = `---
model: "${GOLDEN_PROVIDER}/${FRONTMATTER_MODEL}"
---

${PLANNER_PROMPT_MARKER}
`;

const plannerFixture = [{ path: ".wld/agents/planner.md", text: plannerFrontmatterFixture }];

type ModelTurn = {
    agent?: string;
    model?: string;
    provider?: string;
    systemPrompt?: string;
};

type ConfigurationScenarioResult = Parameters<typeof assertEventIncludes>[0] & {
    state: {
        modelTurns?: ModelTurn[];
        globalSettings?: { defaultModel?: string; defaultProvider?: string };
        scriptedInteractions?: Array<{ interaction?: { value?: string } }>;
    };
};

function configuredSettings(options: { preset?: boolean; baseAgent?: boolean; defaultModel?: boolean } = {}) {
    return {
        ...(options.defaultModel === false ? {} : { defaultProvider: GOLDEN_PROVIDER, defaultModel: DEFAULT_MODEL }),
        ...(options.baseAgent === false
            ? {}
            : { agents: { planner: { model: `${GOLDEN_PROVIDER}/${BASE_AGENT_MODEL}` } } }),
        ...(options.preset === false ? {} : {
            activeModelPreset: "golden-preset",
            modelPresets: {
                "golden-preset": {
                    agents: { planner: { model: `${GOLDEN_PROVIDER}/${PRESET_MODEL}` } },
                },
            },
        }),
    };
}

function plannerScript(id: string) {
    return [{
        id,
        agent: "planner",
        phase: "plan_review",
        ordinal: 1,
        text: "Golden precedence response.",
    }];
}

function switchToPlannerAndSend(message: string) {
    return [
        { type: "type", text: "/agent planner" },
        { type: "enter" },
        { type: "enter" },
        { type: "waitForEvent", event: "runtime:agent:planner" },
        { type: "waitForIdle" },
        { type: "type", text: message },
        { type: "enter" },
        { type: "waitForEvent", event: "model:faux-provider:planner:plan_review" },
        { type: "waitForIdle" },
    ];
}

function assertFooter(result: ConfigurationScenarioResult, agent: string, model: string) {
    const footer = result.screenText.split("\n").slice(-6).join("\n");
    assertStringIncludes(footer, agent);
    assertStringIncludes(footer, `${GOLDEN_PROVIDER}/${model}`);
}

function assertTurn(
    result: ConfigurationScenarioResult,
    index: number,
    expected: { agent: string; model: string; promptIncludes: string[] },
) {
    const turns = result.state.modelTurns || [];
    const turn = turns[index];
    assert(turn, `Expected captured model turn ${index + 1}; captured ${turns.length}`);
    assertEquals(turn.agent, expected.agent);
    assertEquals(turn.provider, GOLDEN_PROVIDER);
    assertEquals(turn.model, expected.model);
    for (const marker of expected.promptIncludes) assertStringIncludes(turn.systemPrompt || "", marker);
}

function assertPlannerPrecedence(result: ConfigurationScenarioResult, model: string) {
    assertEquals(result.state.modelTurns?.length, 1);
    assertTurn(result, 0, {
        agent: "planner",
        model,
        promptIncludes: [
            "You are the Planner — the Planned Change planning specialist in the RunWield system.",
            PLANNER_PROMPT_MARKER,
        ],
    });
    assertFooter(result, "Planner", model);
}

export const slashAgentScenario = {
    name: "slash-command-agent-preset-model-precedence",
    slashCommands: ["agent"],
    composedTui: true,
    initialAgentName: "guide",
    terminal: { columns: 100, rows: 30 },
    models: goldenModels,
    globalSettings: configuredSettings(),
    initialProjectFiles: plannerFixture,
    captureModelTurns: true,
    script: plannerScript("agent-preset-precedence"),
    actions: switchToPlannerAndSend("Use the preset model."),
    assertions: [
        (result: ConfigurationScenarioResult) => assertEventIncludes(result, "terminal:type:/agent planner"),
        (result: ConfigurationScenarioResult) => assertEventIncludes(result, "runtime:agent:planner"),
        (result: ConfigurationScenarioResult) => assertPlannerPrecedence(result, PRESET_MODEL),
    ],
};

export const slashAgentBaseSettingScenario = {
    name: "slash-command-agent-base-setting-model-precedence",
    composedTui: true,
    initialAgentName: "guide",
    terminal: { columns: 100, rows: 30 },
    models: goldenModels,
    globalSettings: configuredSettings({ preset: false }),
    initialProjectFiles: plannerFixture,
    captureModelTurns: true,
    script: plannerScript("agent-base-setting-precedence"),
    actions: switchToPlannerAndSend("Use the base Agent setting."),
    assertions: [(result: ConfigurationScenarioResult) => assertPlannerPrecedence(result, BASE_AGENT_MODEL)],
};

export const slashAgentDefaultModelScenario = {
    name: "slash-command-agent-default-model-precedence",
    composedTui: true,
    initialAgentName: "guide",
    terminal: { columns: 100, rows: 30 },
    models: goldenModels,
    globalSettings: configuredSettings({ preset: false, baseAgent: false }),
    initialProjectFiles: plannerFixture,
    captureModelTurns: true,
    script: plannerScript("agent-default-model-precedence"),
    actions: switchToPlannerAndSend("Use the settings default."),
    assertions: [(result: ConfigurationScenarioResult) => assertPlannerPrecedence(result, DEFAULT_MODEL)],
};

export const slashAgentFrontmatterModelScenario = {
    name: "slash-command-agent-frontmatter-model-fallback",
    composedTui: true,
    initialAgentName: "guide",
    terminal: { columns: 100, rows: 30 },
    models: goldenModels,
    globalSettings: configuredSettings({ preset: false, baseAgent: false, defaultModel: false }),
    skipModelWelcome: true,
    initialProjectFiles: plannerFixture,
    captureModelTurns: true,
    script: plannerScript("agent-frontmatter-model-fallback"),
    actions: switchToPlannerAndSend("Use the Agent frontmatter model."),
    assertions: [(result: ConfigurationScenarioResult) => assertPlannerPrecedence(result, FRONTMATTER_MODEL)],
};

export const slashModelScenario = {
    name: "slash-command-model-manual-override-survives-agent-switch",
    slashCommands: ["model"],
    composedTui: true,
    initialAgentName: "guide",
    terminal: { columns: 100, rows: 30 },
    models: goldenModels,
    globalSettings: configuredSettings(),
    initialProjectFiles: plannerFixture,
    captureModelTurns: true,
    captureGlobalSettings: true,
    script: [
        {
            id: "manual-model-guide-turn",
            agent: "guide",
            phase: "inquiry",
            ordinal: 1,
            text: "Manual model handled the Guide turn.",
        },
        ...plannerScript("manual-model-planner-turn"),
    ],
    actions: [
        { type: "type", text: `/model ${GOLDEN_PROVIDER}/${MANUAL_MODEL}` },
        { type: "enter" },
        { type: "enter" },
        { type: "waitForScreen", text: `Switched model to ${GOLDEN_PROVIDER}/${MANUAL_MODEL}` },
        { type: "waitForIdle" },
        { type: "type", text: "Keep the manual model for this message." },
        { type: "enter" },
        { type: "waitForEvent", event: "model:faux-provider:guide:inquiry" },
        { type: "waitForIdle" },
        ...switchToPlannerAndSend("Keep the manual model after switching Agents."),
    ],
    assertions: [
        (result: ConfigurationScenarioResult) =>
            assertEventIncludes(result, `terminal:type:/model ${GOLDEN_PROVIDER}/${MANUAL_MODEL}`),
        (result: ConfigurationScenarioResult) => assertEquals(result.state.modelTurns?.length, 2),
        (result: ConfigurationScenarioResult) =>
            assertTurn(result, 0, {
                agent: "guide",
                model: MANUAL_MODEL,
                promptIncludes: ["You are the Guide — the read-mostly answer and orientation specialist in RunWield."],
            }),
        (result: ConfigurationScenarioResult) =>
            assertTurn(result, 1, {
                agent: "planner",
                model: MANUAL_MODEL,
                promptIncludes: [
                    "You are the Planner — the Planned Change planning specialist in the RunWield system.",
                    PLANNER_PROMPT_MARKER,
                ],
            }),
        (result: ConfigurationScenarioResult) => assertFooter(result, "Planner", MANUAL_MODEL),
        (result: ConfigurationScenarioResult) => {
            assertEquals(result.state.globalSettings?.defaultProvider, GOLDEN_PROVIDER);
            assertEquals(result.state.globalSettings?.defaultModel, MANUAL_MODEL);
        },
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
        (result: ConfigurationScenarioResult) => assertEventIncludes(result, "terminal:type:/theme"),
        (result: ConfigurationScenarioResult) => {
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
        (result: ConfigurationScenarioResult) => assertEventIncludes(result, "terminal:type:/settings"),
        (result: ConfigurationScenarioResult) => {
            const value = result.state.scriptedInteractions?.[0]?.interaction?.value;
            assert(value === "done", `Expected Settings Done selection, got ${value}`);
        },
    ],
};

export const slashCommandConfigurationScenarios = [
    slashAgentScenario,
    slashAgentBaseSettingScenario,
    slashAgentDefaultModelScenario,
    slashAgentFrontmatterModelScenario,
    slashModelScenario,
    slashThemeScenario,
    slashSettingsScenario,
];
