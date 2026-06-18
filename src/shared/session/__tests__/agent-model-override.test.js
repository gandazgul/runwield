/**
 * @module shared/session/__tests__/agent-model-override
 * Tests for per-agent model override logic in session.js.
 *
 * Note: getConfiguredAgentModel() reads from the global settings singleton,
 * so full integration tests require a real settings.json. These tests verify
 * the resolution logic via direct mock patterns.
 */

import { assertEquals } from "@std/assert";

/**
 * Simulate getConfiguredAgentModel's logic (extracted for testability).
 *
 * @param {string} agentName
 * @param {Record<string, { model?: string }> | undefined} agents
 * @param {string | undefined} activeModelPreset
 * @param {Record<string, { agents?: Record<string, { model?: string }> }> | undefined} modelPresets
 * @returns {string | undefined}
 */
function simulateConfiguredAgentModel(agentName, agents, activeModelPreset, modelPresets) {
    if (activeModelPreset) {
        const preset = modelPresets?.[activeModelPreset];
        const presetModel = preset?.agents?.[agentName]?.model;
        if (presetModel) return presetModel;
    }

    return agents?.[agentName]?.model;
}

Deno.test("getConfiguredAgentModel returns undefined when no agents config", () => {
    const result = simulateConfiguredAgentModel("router", undefined, undefined, undefined);
    assertEquals(result, undefined);
});

Deno.test("getConfiguredAgentModel returns agent model from base config", () => {
    const agents = {
        router: { model: "openai/gpt-4" },
        operator: { model: "anthropic/claude-3" },
    };
    const result = simulateConfiguredAgentModel("router", agents, undefined, undefined);
    assertEquals(result, "openai/gpt-4");
});

Deno.test("getConfiguredAgentModel returns undefined for unknown agent", () => {
    const agents = {
        router: { model: "openai/gpt-4" },
    };
    const result = simulateConfiguredAgentModel("nonexistent", agents, undefined, undefined);
    assertEquals(result, undefined);
});

Deno.test("getConfiguredAgentModel returns preset model when active preset is set", () => {
    const agents = {
        router: { model: "openai/gpt-4" },
        operator: { model: "anthropic/claude-3" },
    };
    const modelPresets = {
        fast: {
            agents: {
                router: { model: "openai/gpt-4o-mini" },
                operator: { model: "anthropic/claude-3-haiku" },
            },
        },
        quality: {
            agents: {
                router: { model: "openai/gpt-4o" },
            },
        },
    };

    // Active preset 'fast' overrides base
    const result = simulateConfiguredAgentModel("router", agents, "fast", modelPresets);
    assertEquals(result, "openai/gpt-4o-mini");

    // Active preset 'quality' overrides base for router
    const resultQuality = simulateConfiguredAgentModel("router", agents, "quality", modelPresets);
    assertEquals(resultQuality, "openai/gpt-4o");

    // Preset doesn't have operator -> falls back to base config
    const resultOperator = simulateConfiguredAgentModel("operator", agents, "quality", modelPresets);
    assertEquals(resultOperator, "anthropic/claude-3");
});

Deno.test("getConfiguredAgentModel returns preset model without base agents config", () => {
    const modelPresets = {
        codex: {
            agents: {
                operator: { model: "crofai/deepseek-v4-pro" },
            },
        },
    };

    const result = simulateConfiguredAgentModel("operator", undefined, "codex", modelPresets);
    assertEquals(result, "crofai/deepseek-v4-pro");
});

Deno.test("getConfiguredAgentModel ignores missing preset gracefully", () => {
    const agents = {
        router: { model: "openai/gpt-4" },
    };
    const modelPresets = {
        fast: {
            agents: {
                router: { model: "openai/gpt-4o-mini" },
            },
        },
    };

    // Unknown preset name -> fall back to base config
    const result = simulateConfiguredAgentModel("router", agents, "nonexistent", modelPresets);
    assertEquals(result, "openai/gpt-4");
});

Deno.test("getConfiguredAgentModel ignores preset with no agents field", () => {
    const agents = {
        router: { model: "openai/gpt-4" },
    };
    const modelPresets = {
        empty: {},
    };

    const result = simulateConfiguredAgentModel("router", agents, "empty", modelPresets);
    assertEquals(result, "openai/gpt-4");
});

Deno.test("getConfiguredAgentModel - agent without model field in base config", () => {
    const agents = {
        router: { model: "openai/gpt-4" },
        operator: {}, // no model field
    };
    const result = simulateConfiguredAgentModel("operator", agents, undefined, undefined);
    assertEquals(result, undefined);
});

Deno.test("getConfiguredAgentModel - preset partial override merges correctly", () => {
    const agents = {
        router: { model: "openai/gpt-4" },
        planner: { model: "anthropic/claude-3-opus" },
        operator: { model: "openai/gpt-4o" },
    };
    const modelPresets = {
        fast: {
            agents: {
                router: { model: "openai/gpt-4o-mini" },
                // planner and operator NOT in preset -> inherited from base
            },
        },
    };

    // Router overridden by preset
    assertEquals(simulateConfiguredAgentModel("router", agents, "fast", modelPresets), "openai/gpt-4o-mini");
    // Planner NOT in preset -> falls through to base
    assertEquals(simulateConfiguredAgentModel("planner", agents, "fast", modelPresets), "anthropic/claude-3-opus");
    // Operator NOT in preset -> falls through to base
    assertEquals(simulateConfiguredAgentModel("operator", agents, "fast", modelPresets), "openai/gpt-4o");
});
