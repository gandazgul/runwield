/**
 * Golden /load-plan workflow scenarios.
 */

import { assert } from "@std/assert";
import { assertEventIncludes, assertScreenIncludes } from "../testing/scenario-runner.js";
import { assertsGoldenCoverage } from "../testing/portfolio-assertions.js";
interface GoldenScenarioResult {
    name: string;
    state: Record<string, unknown> & { projectState?: CapturedProjectState };
    screenText: string;
    scrollbackText?: string;
    events: string[];
    actor: { consumed: string[]; remaining: string[] };
    artifactDir: string | null;
}

interface CapturedPlan {
    name?: string;
    attrs?: { status?: string; worktreeStatus?: string; planId?: string } | null;
}

interface CapturedProjectState {
    plans?: CapturedPlan[];
    registryEntries?: Array<{ status?: string; planName?: string }>;
    nonTerminalRegistryEntries?: Array<{ status?: string; planName?: string }>;
    workRecordNames?: string[];
}

function projectState(result: GoldenScenarioResult): CapturedProjectState {
    return result.state.projectState as CapturedProjectState;
}

function planStatus(result: GoldenScenarioResult, name: string): string {
    const plan = projectState(result).plans?.find((entry) => entry.name === name);
    return plan?.attrs?.status || "";
}

export const loadPlanActionsScenario = {
    name: "load-plan-hold-user-verify-archive-actions",
    composedTui: true,
    initialAgentName: "guide",
    terminal: { columns: 100, rows: 30 },
    timeoutMs: 60000,
    coverage: ["workflow:load-plan", "durable:plan-lifecycle"],
    initialProjectFiles: [
        {
            path: "plans/load-hold.md",
            text:
                "---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Hold through load-plan\naffectedPaths: []\nstatus: draft\n---\n# Hold\n",
        },
        {
            path: "plans/load-user.md",
            text:
                "---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: User verify through load-plan\naffectedPaths: []\nstatus: implemented\n---\n# User verify\n",
        },
    ],
    scriptedInteractions: [
        { type: "select", promptIncludes: "What would you like to do", value: "hold" },
        { type: "text", promptIncludes: "Optional hold reason", value: "Golden hold." },
        { type: "select", value: "user_verify" },
    ],
    actions: [
        { type: "type", text: "/load-plan load-hold" },
        { type: "enter" },
        { type: "enter" },
        { type: "sleep", ms: 1000 },
        { type: "waitForIdle", timeoutMs: 12000 },
        { type: "type", text: "/load-plan load-user" },
        { type: "enter" },
        { type: "enter" },
        { type: "sleep", ms: 1000 },
        { type: "sleep", ms: 5000 },
        { type: "waitForIdle", timeoutMs: 30000 },
        { type: "captureProjectState", planNames: ["load-hold", "load-user"] },
    ],
    assertions: [
        assertsGoldenCoverage("workflow:load-plan", (result: GoldenScenarioResult) => {
            assertEventIncludes(result, "terminal:type:/load-plan load-hold");
            assertScreenIncludes(result, "Plan put on hold");
            assertScreenIncludes(result, "User Verification records your attestation");
        }),
        assertsGoldenCoverage("durable:plan-lifecycle", (result: GoldenScenarioResult) => {
            assert(planStatus(result, "load-hold") === "on_hold", "Expected /load-plan hold to persist on_hold.");
        }),
    ],
};

export const loadPlanInterruptedRecoveryScenario = {
    name: "load-plan-interrupted-child-recovery-options",
    composedTui: true,
    initialAgentName: "guide",
    terminal: { columns: 100, rows: 30 },
    timeoutMs: 45000,
    coverage: [
        "recovery:interrupted-execution",
        "recovery:load-plan-worktree",
        "recovery:validation-failure-retry",
        "recovery:validation-exhausted",
    ],
    initialProjectFiles: [
        {
            path: "plans/epic.md",
            text:
                "---\nclassification: PROJECT\ncomplexity: MEDIUM\nsummary: Interrupted Epic\naffectedPaths: []\nstatus: ready_for_work\n---\n# Epic\n",
        },
        {
            path: "plans/epic/01-child.md",
            text:
                "---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Interrupted child\naffectedPaths: []\nstatus: in_progress\nparentPlan: epic\norder: 1\n---\n# Child\n",
        },
    ],
    scriptedInteractions: [
        { type: "select", promptIncludes: "Plan recovery (in_progress)", value: "inspect" },
        { type: "select", promptIncludes: "Plan recovery (in_progress)", value: "cancel" },
    ],
    actions: [
        { type: "type", text: "/load-plan epic/01-child" },
        { type: "enter" },
        { type: "enter" },
        { type: "sleep", ms: 1000 },
        { type: "waitForIdle", timeoutMs: 20000 },
    ],
    assertions: [
        assertsGoldenCoverage("recovery:interrupted-execution", (result: GoldenScenarioResult) => {
            assertScreenIncludes(result, "Plan Recovery");
            assertScreenIncludes(result, "No execution baseline tree is recorded");
        }),
        assertsGoldenCoverage("recovery:load-plan-worktree", (result: GoldenScenarioResult) => {
            assertScreenIncludes(result, "No execution baseline tree is recorded");
            assert(
                !result.screenText.includes("Plan changed underneath"),
                "Expected no stale snapshot precondition error.",
            );
        }),
        assertsGoldenCoverage("recovery:validation-failure-retry", (result: GoldenScenarioResult) => {
            assertScreenIncludes(result, "Plan Recovery");
            assert(
                result.screenText.includes("No execution baseline tree is recorded"),
                "Expected validation retry recovery to explain that no execution baseline is recorded.",
            );
        }),
        assertsGoldenCoverage("recovery:validation-exhausted", (result: GoldenScenarioResult) => {
            assertScreenIncludes(result, "No execution baseline tree is recorded");
            assert(
                !result.screenText.includes("Plan changed underneath"),
                "Expected exhausted validation recovery prompt without stale Plan snapshot noise.",
            );
        }),
    ],
};

export const loadPlanAbandonProgressScenario = {
    name: "load-plan-abandon-worktree-shows-progress",
    composedTui: true,
    initialAgentName: "guide",
    terminal: { columns: 100, rows: 30 },
    timeoutMs: 60000,
    coverage: ["block:abandon-progress"],
    initialProjectFiles: [{
        path: "plans/recover-abandon.md",
        text:
            "---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Abandon recovery\naffectedPaths: []\nstatus: ready_for_work\nplanId: recover-abandon-plan\n---\n# Recover abandon\n",
    }],
    scriptedInteractions: [
        { type: "select", promptIncludes: "Plan recovery (in_progress)", value: "abandon" },
        { type: "select", promptIncludes: "Delete/abandon worktree", value: "confirm" },
    ],
    actions: [
        { type: "seedActiveWorktree", planName: "recover-abandon" },
        { type: "type", text: "/load-plan recover-abandon" },
        { type: "enter" },
        { type: "enter" },
        { type: "sleep", ms: 1000 },
        { type: "waitForIdle", timeoutMs: 40000 },
    ],
    assertions: [
        assertsGoldenCoverage("block:abandon-progress", (result: GoldenScenarioResult) => {
            assertScreenIncludes(result, 'Deleting recorded worktree for "recover-abandon"');
            assertScreenIncludes(result, "Worktree abandoned and removed.");
        }),
    ],
};

export const loadPlanMalformedFrontMatterScenario = {
    name: "load-plan-malformed-front-matter-fails-closed",
    composedTui: true,
    initialAgentName: "guide",
    terminal: { columns: 100, rows: 30 },
    timeoutMs: 20000,
    coverage: ["recovery:malformed-plan-front-matter"],
    initialProjectFiles: [{
        path: "plans/broken.md",
        text:
            "---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Broken\naffectedPaths: []\nstatus: draft\n---\n# Broken\n",
    }],
    actions: [
        { type: "type", text: "/load-plan broken" },
        {
            type: "writeProjectFile",
            path: "plans/broken.md",
            text: "---\nclassification: [PLANNED_CHANGE\nstatus: draft\n---\n# Broken\n",
        },
        { type: "enter" },
        { type: "enter" },
        { type: "sleep", ms: 1000 },
        { type: "waitForIdle", timeoutMs: 10000 },
    ],
    assertions: [
        assertsGoldenCoverage("recovery:malformed-plan-front-matter", (result: GoldenScenarioResult) => {
            assert(
                result.screenText.includes("Plan Front Matter could not be parsed") ||
                    result.screenText.includes("Plan not found: broken"),
                "Expected malformed or missing Plan Front Matter to fail closed on screen.",
            );
        }),
    ],
};

export const loadPlanWorkflowScenarios = [
    loadPlanActionsScenario,
    loadPlanInterruptedRecoveryScenario,
    loadPlanAbandonProgressScenario,
    loadPlanMalformedFrontMatterScenario,
];
