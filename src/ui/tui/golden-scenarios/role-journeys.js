/**
 * @module ui/tui/golden-scenarios/role-journeys
 * Golden role journey scenarios for the TUI workflow portfolio.
 */

import { assertCoverageWith, assertEventIncludes, assertScreenIncludes } from "../testing/mod.js";

/** @typedef {import('../testing/scenario-runner.js').GoldenScenarioResult} GoldenScenarioResult */

const roleJourneyAssertions = {
    guide: assertCoverageWith(["role:guide", "intent:INQUIRY", "durable:mutation-policy"], (result) => {
        assertEventIncludes(result, "runtime:agent:guide");
        assertScreenIncludes(result, "Guide answered from read-only project context.");
        if (result.state.projectMutation !== "clean") throw new Error("Guide INQUIRY mutated the fixture project.");
    }),
    ideator: assertCoverageWith(["role:ideator", "intent:IDEATION", "durable:mutation-policy"], (result) => {
        assertEventIncludes(result, "runtime:agent:ideator");
        assertEventIncludes(result, "runtime:tool:start:user_interview");
        assertScreenIncludes(result, "PRD synthesized after the interview.");
        if (result.state.materializedArtifact !== "docs/prd/golden-idea.md") {
            throw new Error("Ideator did not materialize the requested PRD artifact.");
        }
    }),
    operator: assertCoverageWith(["role:operator", "intent:OPERATION", "durable:mutation-policy"], (result) => {
        assertEventIncludes(result, "runtime:agent:operator");
        assertScreenIncludes(result, "Operator completed the requested repository operation.");
        if (result.state.operation !== "self-verified") throw new Error("Operator operation was not self-verified.");
    }),
    engineer: assertCoverageWith(["role:engineer", "intent:QUICK_FIX", "recovery:workflow-validation"], (result) => {
        assertEventIncludes(result, "runtime:agent:engineer");
        assertScreenIncludes(result, "Mechanical Validation passed after QUICK_FIX.");
        if (result.state.validation !== "passed") throw new Error("QUICK_FIX Mechanical Validation did not pass.");
    }),
};

export const guideInquiryRoleJourneyScenario = {
    name: "role-guide-inquiry-readonly",
    coverage: [
        "role:guide",
        "intent:INQUIRY",
        "durable:mutation-policy",
        "block:user",
        "block:thinking",
        "block:assistant",
        "block:tool",
    ],
    assertedCoverage: [
        "role:guide",
        "intent:INQUIRY",
        "durable:mutation-policy",
        "block:user",
        "block:thinking",
        "block:assistant",
        "block:tool",
    ],
    actions: [
        { type: "event", event: "terminal:type:explain the routing flow" },
        { type: "event", event: "runtime:agent:guide" },
        { type: "event", event: "runtime:tool:start:read" },
        { type: "event", event: "runtime:assistant:thinking" },
        { type: "event", event: "runtime:assistant:text" },
        { type: "setState", path: "projectMutation", value: "clean" },
        {
            type: "screen",
            text:
                "User: explain the routing flow\nThinking: inspect project context\nTool: read README.md\nGuide answered from read-only project context.",
        },
    ],
    assertions: [
        roleJourneyAssertions.guide,
        assertCoverageWith(["block:user", "block:thinking", "block:assistant", "block:tool"], (result) => {
            assertScreenIncludes(result, "User: explain the routing flow");
            assertScreenIncludes(result, "Thinking: inspect project context");
            assertScreenIncludes(result, "Tool: read README.md");
        }),
    ],
};

export const ideationInterviewPrdScenario = {
    name: "role-ideator-interview-prd-synthesis",
    coverage: ["role:ideator", "intent:IDEATION", "durable:mutation-policy", "block:text", "block:select"],
    assertedCoverage: ["role:ideator", "intent:IDEATION", "durable:mutation-policy", "block:text", "block:select"],
    actions: [
        { type: "event", event: "runtime:agent:ideator" },
        { type: "event", event: "runtime:tool:start:user_interview" },
        { type: "event", event: "interaction:text:text" },
        { type: "event", event: "interaction:select:selected" },
        { type: "setState", path: "materializedArtifact", value: "docs/prd/golden-idea.md" },
        {
            type: "screen",
            text:
                "Text prompt: What outcome matters?\nSelect prompt: Choose priority\nPRD synthesized after the interview.",
        },
    ],
    assertions: [
        roleJourneyAssertions.ideator,
        assertCoverageWith(["block:text", "block:select"], (result) => {
            assertScreenIncludes(result, "Text prompt: What outcome matters?");
            assertScreenIncludes(result, "Select prompt: Choose priority");
        }),
    ],
};

export const operatorOperationScenario = {
    name: "role-operator-operation-self-verified",
    coverage: ["role:operator", "intent:OPERATION", "durable:mutation-policy", "block:system-error"],
    assertedCoverage: ["role:operator", "intent:OPERATION", "durable:mutation-policy", "block:system-error"],
    actions: [
        { type: "event", event: "runtime:agent:operator" },
        { type: "setState", path: "operation", value: "self-verified" },
        {
            type: "screen",
            text: "System: bounded operation started\nOperator completed the requested repository operation.",
        },
    ],
    assertions: [
        roleJourneyAssertions.operator,
        assertCoverageWith(
            ["block:system-error"],
            (result) => assertScreenIncludes(result, "System: bounded operation started"),
        ),
    ],
};

export const engineerQuickFixMechanicalValidationScenario = {
    name: "role-engineer-quick-fix-mechanical-validation",
    coverage: ["role:engineer", "intent:QUICK_FIX", "recovery:workflow-validation", "block:validation-handoff"],
    assertedCoverage: ["role:engineer", "intent:QUICK_FIX", "recovery:workflow-validation", "block:validation-handoff"],
    actions: [
        { type: "event", event: "runtime:agent:engineer" },
        { type: "event", event: "runtime:validation:start" },
        { type: "setState", path: "validation", value: "passed" },
        { type: "screen", text: "Validation handoff: Mechanical Validation passed after QUICK_FIX." },
    ],
    assertions: [
        roleJourneyAssertions.engineer,
        assertCoverageWith(
            ["block:validation-handoff"],
            (result) => assertScreenIncludes(result, "Validation handoff:"),
        ),
    ],
};

export const roleJourneyScenarios = [
    guideInquiryRoleJourneyScenario,
    ideationInterviewPrdScenario,
    operatorOperationScenario,
    engineerQuickFixMechanicalValidationScenario,
];
