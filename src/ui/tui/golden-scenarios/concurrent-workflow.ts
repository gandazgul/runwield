/**
 * Golden concurrent Plan workflow coverage.
 */

import { assert } from "@std/assert";
import { assertScreenIncludes } from "../testing/scenario-runner.js";
import { assertsGoldenCoverage } from "../testing/portfolio-assertions.js";

interface CapturedPlan {
    name?: string;
    attrs?: { status?: string; planId?: string } | null;
}

interface CapturedProjectState {
    plans?: CapturedPlan[];
    registryEntries?: Array<{ status?: string; planName?: string; planId?: string }>;
}

interface GoldenScenarioResult {
    name: string;
    state: Record<string, unknown> & { projectState?: CapturedProjectState };
    screenText: string;
    events: string[];
    actor: { consumed: string[]; remaining: string[] };
    artifactDir: string | null;
}

function plans(result: GoldenScenarioResult): CapturedPlan[] {
    return result.state.projectState?.plans || [];
}

export const concurrentPlansIdentityScenario = {
    name: "project-two-plans-preserve-identity-and-drain-registry",
    composedTui: true,
    initialAgentName: "guide",
    terminal: { columns: 100, rows: 30 },
    timeoutMs: 60000,
    coverage: ["workflow:concurrent-plans"],
    initialProjectFiles: [
        {
            path: "plans/concurrent-a.md",
            text:
                "---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Concurrent A\naffectedPaths: []\nstatus: draft\nplanId: concurrent-plan-a\n---\n# Concurrent A\n",
        },
        {
            path: "plans/concurrent-b.md",
            text:
                "---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Concurrent B\naffectedPaths: []\nstatus: draft\nplanId: concurrent-plan-b\n---\n# Concurrent B\n",
        },
    ],
    scriptedInteractions: [
        { type: "select", promptIncludes: "What would you like to do", value: "hold" },
        { type: "text", promptIncludes: "Optional hold reason", value: "Concurrent A paused." },
        { type: "select", promptIncludes: "What would you like to do", value: "hold" },
        { type: "text", promptIncludes: "Optional hold reason", value: "Concurrent B paused." },
    ],
    actions: [
        { type: "type", text: "/load-plan concurrent-a" },
        { type: "enter" },
        { type: "enter" },
        { type: "sleep", ms: 1000 },
        { type: "waitForIdle", timeoutMs: 25000 },
        { type: "type", text: "/load-plan concurrent-b" },
        { type: "enter" },
        { type: "enter" },
        { type: "sleep", ms: 1000 },
        { type: "waitForIdle", timeoutMs: 25000 },
        { type: "captureProjectState", planNames: ["concurrent-a", "concurrent-b"] },
    ],
    assertions: [
        assertsGoldenCoverage("workflow:concurrent-plans", (result: GoldenScenarioResult) => {
            assertScreenIncludes(result, "Plan put on hold");
            const captured = plans(result);
            const first = captured.find((entry) => entry.name === "concurrent-a")?.attrs;
            const second = captured.find((entry) => entry.name === "concurrent-b")?.attrs;
            assert(first?.status === "on_hold", `Expected concurrent-a on hold; got ${first?.status}`);
            assert(second?.status === "on_hold", `Expected concurrent-b on hold; got ${second?.status}`);
            assert(first?.planId === "concurrent-plan-a", `Unexpected concurrent-a planId ${first?.planId}`);
            assert(second?.planId === "concurrent-plan-b", `Unexpected concurrent-b planId ${second?.planId}`);
            assert(
                (result.state.projectState?.registryEntries || []).length === 0,
                `Expected drained registry; got ${JSON.stringify(result.state.projectState?.registryEntries || [])}`,
            );
        }),
    ],
};

export const concurrentWorkflowScenarios = [concurrentPlansIdentityScenario];
