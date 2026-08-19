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
    attrs?: { status?: string; worktreeStatus?: string; planId?: string; failureReason?: string } | null;
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

function recoveryOptionValues(result: GoldenScenarioResult, index = 0): Set<string | undefined> {
    const interactions = result.state.scriptedInteractions as
        | Array<{ request?: { options?: Array<{ value?: string }> } }>
        | undefined;
    return new Set((interactions?.[index]?.request?.options || []).map((option) => option.value));
}

export const loadPlanActionsScenario = {
    name: "load-plan-hold-user-verify-actions",
    composedTui: true,
    initialAgentName: "guide",
    terminal: { columns: 100, rows: 30 },
    timeoutMs: 60000,
    coverage: ["workflow:load-plan", "durable:plan-lifecycle"],
    initialProjectFiles: [
        {
            path: "docs/plans/load-hold.md",
            text:
                "---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Hold through load-plan\naffectedPaths: []\nstatus: ready_for_work\n---\n# Hold\n",
        },
    ],
    scriptedInteractions: [
        { type: "select", promptIncludes: "What would you like to do", value: "hold" },
        { type: "text", promptIncludes: "Optional hold reason", value: "Golden hold." },
        { type: "select", value: "resume" },
        { type: "select", value: "user_verify" },
        { type: "text", value: "Golden user verification work record." },
    ],
    actions: [
        { type: "type", text: "/load-plan load-hold" },
        { type: "enter" },
        { type: "enter" },
        { type: "sleep", ms: 1000 },
        { type: "waitForIdle", timeoutMs: 12000 },
        { type: "type", text: "/load-plan load-hold" },
        { type: "enter" },
        { type: "enter" },
        { type: "sleep", ms: 1000 },
        { type: "waitForIdle", timeoutMs: 12000 },
        { type: "sleep", ms: 5000 },
        { type: "waitForIdle", timeoutMs: 30000 },
        { type: "captureProjectState", planNames: ["load-hold"] },
    ],
    assertions: [
        assertsGoldenCoverage("workflow:load-plan", (result: GoldenScenarioResult) => {
            assertEventIncludes(result, "terminal:type:/load-plan load-hold");
            assertScreenIncludes(result, "Plan put on hold");
            assertScreenIncludes(result, "User Verification records your attestation");
        }),
        assertsGoldenCoverage("durable:plan-lifecycle", (result: GoldenScenarioResult) => {
            assert(
                planStatus(result, "load-hold") === "user_verified",
                "Expected /load-plan hold/resume/user_verify to persist user_verified.",
            );
            assert(
                (projectState(result).workRecordNames || []).some((name) => name.startsWith("docs/work-records/")),
                "Expected /load-plan user_verify to create a Work Record.",
            );
        }),
    ],
};

export const loadPlanResetReviewArchiveScenario = {
    name: "load-plan-reset-review-and-archive-actions",
    composedTui: true,
    initialAgentName: "guide",
    terminal: { columns: 100, rows: 30 },
    timeoutMs: 150000,
    coverage: ["workflow:load-plan", "durable:plan-lifecycle"],
    reviewDecisions: [{ approved: true, feedback: "Re-review approved for later.", approvalAction: "later" }],
    script: [
        {
            id: "planner-handles-load-plan-re-review",
            agent: "planner",
            phase: "plan_review",
            ordinal: 1,
            requiredTools: ["plan_written"],
            toolCalls: [{
                name: "plan_written",
                arguments: {
                    planName: "re-review",
                    objectiveChecks: [{ id: "OC1", command: "true" }],
                },
            }],
        },
    ],
    initialProjectFiles: [
        {
            path: "docs/plans/reset-held.md",
            text:
                "---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Reset held\naffectedPaths: []\nstatus: on_hold\nheldFromStatus: ready_for_work\n---\n# Reset held\n",
        },
        {
            path: "docs/plans/re-review.md",
            text:
                "---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Re-review\naffectedPaths: []\nstatus: ready_for_work\n---\n# Re-review\n",
        },
        {
            path: "docs/plans/archive-me.md",
            text:
                "---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Archive me\naffectedPaths: []\nstatus: verified\n---\n# Archive me\n",
        },
    ],
    scriptedInteractions: [
        { type: "select", promptIncludes: "This plan is on hold", value: "reset" },
        { type: "select", value: "confirm" },
        { type: "select", promptIncludes: "What would you like to do", value: "cancel" },
        { type: "select", promptIncludes: "What would you like to do", value: "planner_re_review" },
        { type: "select", promptIncludes: "What would you like to do", value: "archive" },
    ],
    actions: [
        { type: "type", text: "/load-plan reset-held" },
        { type: "enter" },
        { type: "enter" },
        { type: "waitForIdle", timeoutMs: 12000 },
        { type: "sleep", ms: 1000 },
        { type: "type", text: "/load-plan re-review" },
        { type: "enter" },
        { type: "enter" },
        { type: "waitForIdle", timeoutMs: 60000 },
        { type: "sleep", ms: 1000 },
        { type: "waitForIdle", timeoutMs: 60000 },
        { type: "sleep", ms: 1000 },
        { type: "type", text: "/load-plan archive-me" },
        { type: "enter" },
        { type: "enter" },
        { type: "waitForIdle", timeoutMs: 12000 },
        { type: "waitForPlanAbsent", planName: "archive-me", timeoutMs: 12000 },
        { type: "captureProjectState", planNames: ["reset-held", "re-review", "archive-me"] },
    ],
    assertions: [
        assertsGoldenCoverage("workflow:load-plan", (result: GoldenScenarioResult) => {
            assertEventIncludes(result, "terminal:type:/load-plan reset-held");
            assertEventIncludes(result, "terminal:type:/load-plan re-review");
            assertEventIncludes(result, "terminal:type:/load-plan archive-me");
            assertScreenIncludes(result, "Plan loaded: reset-held");
            assertScreenIncludes(result, "Plan reset to draft");
            assertEventIncludes(result, "runtime:tool:start:plan_written");
            assertScreenIncludes(result, "Plan saved. Resume later with: wld resume re-review");
            assertScreenIncludes(result, "Plan loaded: archive-me");
            assertScreenIncludes(result, "Archived archive-me to");
        }),
        assertsGoldenCoverage("durable:plan-lifecycle", (result: GoldenScenarioResult) => {
            assert(
                planStatus(result, "reset-held") === "draft",
                `Expected reset-held to durably reset to draft; got ${planStatus(result, "reset-held")}`,
            );
            assert(
                planStatus(result, "re-review") === "ready_for_work",
                `Expected /load-plan planner re-review to leave durable ready_for_work Front Matter; got ${
                    planStatus(result, "re-review")
                }`,
            );
            const archived = projectState(result).plans?.find((entry) => entry.name === "archive-me");
            assert(
                archived?.attrs === null,
                `Expected archive-me to be removed from active Plan storage; got ${JSON.stringify(archived?.attrs)}`,
            );
        }),
    ],
};

export const loadPlanCanceledExecutionThenPlannerReviewScenario = {
    name: "load-plan-cancel-stale-execution-then-planner-re-review",
    composedTui: true,
    initialAgentName: "guide",
    globalSettings: {
        defaultProvider: "golden",
        defaultModel: "faux",
        activeModelPreset: "unavailable-planner",
        modelPresets: {
            "unavailable-planner": {
                agents: { planner: { model: "missing/planner-model" } },
            },
            "available-planner": {
                agents: { planner: { model: "golden/faux" } },
            },
        },
    },
    terminal: { columns: 100, rows: 30 },
    timeoutMs: 120000,
    coverage: ["workflow:load-plan", "durable:plan-lifecycle"],
    reviewDecisions: [{ approved: true, feedback: "Re-review approved for later.", approvalAction: "later" }],
    script: [
        {
            id: "planner-reviews-after-canceled-execution",
            agent: "planner",
            phase: "plan_review",
            ordinal: 1,
            requiredTools: ["plan_written"],
            toolCalls: [{
                name: "plan_written",
                arguments: {
                    planName: "stale-then-review",
                    objectiveChecks: [{ id: "OC1", command: "true" }],
                },
            }],
        },
    ],
    committedProjectFiles: [
        { path: "app.ts", text: "export const changedAfterPlanning = true;\n" },
        {
            path: "docs/plans/stale-then-review.md",
            text:
                '---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Cancel stale execution then review\naffectedPaths:\n  - app.ts\nupdatedAt: "2020-01-01T00:00:00.000Z"\nstatus: ready_for_work\n---\n# Cancel stale execution then review\n',
        },
    ],
    scriptedInteractions: [
        { type: "select", promptIncludes: "What would you like to do", value: "proceed" },
        { type: "select", promptIncludes: "Proceed with execution", value: "cancel" },
        { type: "select", promptIncludes: "Settings", value: "model-presets" },
        { type: "select", promptIncludes: "Model Presets", value: "preset:available-planner" },
        { type: "select", promptIncludes: "Model Presets", value: "back" },
        { type: "select", promptIncludes: "Settings", value: "done" },
        { type: "select", promptIncludes: "What would you like to do", value: "planner_re_review" },
    ],
    actions: [
        { type: "type", text: "/load-plan stale-then-review" },
        { type: "enter" },
        { type: "enter" },
        { type: "waitForIdle", timeoutMs: 20000 },
        { type: "sleep", ms: 1000 },
        { type: "type", text: "/settings" },
        { type: "enter" },
        { type: "waitForScreen", text: "Active model preset set to available-planner", timeoutMs: 20000 },
        { type: "waitForIdle", timeoutMs: 20000 },
        { type: "type", text: "/load-plan stale-then-review" },
        { type: "enter" },
        { type: "enter" },
        {
            type: "waitForScreen",
            text: "Plan saved. Resume later with: wld resume stale-then-review",
            timeoutMs: 60000,
        },
        { type: "waitForIdle", timeoutMs: 60000 },
        { type: "sleep", ms: 1000 },
        { type: "captureProjectState", planNames: ["stale-then-review"] },
    ],
    assertions: [
        assertsGoldenCoverage("workflow:load-plan", (result: GoldenScenarioResult) => {
            assertScreenIncludes(result, "Execution canceled.");
            assertScreenIncludes(result, "Active model preset set to available-planner");
            assertEventIncludes(result, "runtime:tool:start:plan_written");
            assertScreenIncludes(result, "Plan saved. Resume later with: wld resume stale-then-review");
            const output = `${result.scrollbackText || ""}\n${result.screenText}`;
            assert(
                !output.includes("managed_operation_in_progress"),
                "Planner re-review must start after cancellation.",
            );
        }),
        assertsGoldenCoverage("durable:plan-lifecycle", (result: GoldenScenarioResult) => {
            assert(
                planStatus(result, "stale-then-review") === "ready_for_work",
                `Expected the re-reviewed Plan to remain ready_for_work; got ${
                    planStatus(result, "stale-then-review")
                }`,
            );
        }),
    ],
};

export const loadPlanInterruptedRecoveryScenario = {
    name: "load-plan-interrupted-child-recovery-options",
    composedTui: true,
    initialAgentName: "guide",
    terminal: { columns: 100, rows: 30 },
    timeoutMs: 90000,
    coverage: [
        "recovery:interrupted-execution",
        "recovery:load-plan-worktree",
    ],
    initialProjectFiles: [
        {
            path: "docs/plans/epic.md",
            text:
                "---\nclassification: PROJECT\ncomplexity: MEDIUM\nsummary: Interrupted Epic\naffectedPaths: []\nstatus: ready_for_decomposition\n---\n# Epic\n",
        },
        {
            path: "docs/plans/epic/01-child.md",
            text:
                "---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Interrupted child\naffectedPaths: []\nstatus: ready_for_work\nparentPlan: epic\norder: 1\n---\n# Child\n",
        },
    ],
    script: [
        {
            id: "engineer-starts-child-without-completion",
            agent: "engineer",
            phase: "engineer",
            planName: "epic/01-child",
            ordinal: 1,
            requiredTools: ["bash"],
            thinking: "Start the child in its real execution worktree, but do not call task_completed.",
            toolCalls: [{ name: "bash", arguments: { command: "printf interrupted > interrupted-child.txt" } }],
        },
        {
            id: "engineer-stops-before-task-completed",
            agent: "engineer",
            phase: "engineer",
            planName: "epic/01-child",
            ordinal: 2,
            text: "Interrupted before task_completed.",
        },
    ],
    scriptedInteractions: [
        { type: "select", promptIncludes: "What would you like to do", value: "proceed" },
        { type: "select", value: "pick_child" },
        { type: "select", value: "epic/01-child" },
        { type: "select", value: "load" },
        { type: "select", value: "inspect" },
    ],
    actions: [
        { type: "type", text: "/load-plan epic/01-child" },
        { type: "enter" },
        { type: "enter" },
        { type: "waitForEvent", event: "runtime:tool:start:bash", timeoutMs: 30000 },
        { type: "waitForIdle", timeoutMs: 30000 },
        { type: "restartTui", initialAgentName: "guide" },
        { type: "type", text: "/load-plan epic" },
        { type: "enter" },
        { type: "enter" },
        { type: "sleep", ms: 1000 },
        { type: "waitForIdle", timeoutMs: 20000 },
    ],
    assertions: [
        assertsGoldenCoverage("recovery:interrupted-execution", (result: GoldenScenarioResult) => {
            assertEventIncludes(result, "runtime:tool:start:bash");
            assertEventIncludes(result, "tui:restarted");
            assertScreenIncludes(result, "active/implemented");
        }),
        assertsGoldenCoverage("recovery:load-plan-worktree", (result: GoldenScenarioResult) => {
            const childOptions = recoveryOptionValues(result, 1);
            assert(childOptions.has("pick_child"), `Expected active child choice; got ${[...childOptions].join(", ")}`);
            const planRecoveryOptions = recoveryOptionValues(result, 4);
            for (
                const expected of ["inspect", "continue", "reset", "abandon", "review", "user_verify", "hold", "cancel"]
            ) {
                assert(
                    planRecoveryOptions.has(expected),
                    `Expected interrupted child Plan Recovery option ${expected}; got ${
                        [...planRecoveryOptions].join(", ")
                    }`,
                );
            }
            assert(
                !result.screenText.includes("No execution baseline tree is recorded") &&
                    !result.screenText.includes("Plan changed underneath"),
                "Expected current active-worktree recovery options without stale snapshot/precondition text.",
            );
        }),
    ],
};

export const loadPlanWorktreeInspectResetScenario = {
    name: "load-plan-worktree-recovery-inspect-and-reset",
    composedTui: true,
    initialAgentName: "guide",
    terminal: { columns: 100, rows: 30 },
    timeoutMs: 240000,
    coverage: ["recovery:load-plan-worktree"],
    committedProjectFiles: [
        { path: ".wld/settings.json", text: `${JSON.stringify({ verification_command: "true" }, null, 4)}\n` },
    ],
    initialProjectFiles: [{
        path: "docs/plans/recover-reset.md",
        text:
            "---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Reset recovery\naffectedPaths: []\nstatus: ready_for_work\nplanId: recover-reset-plan\n---\n# Recover reset\n",
    }],
    script: [
        {
            id: "engineer-completes-recover-reset-after-recreate",
            agent: "engineer",
            phase: "engineer",
            planName: "recover-reset",
            ordinal: 1,
            requiredTools: ["bash", "task_completed"],
            toolCalls: [
                { name: "bash", arguments: { command: "printf after-reset > recover-reset.txt" } },
                { name: "task_completed", arguments: { message: "- Completed after recovery reset." } },
            ],
        },
        {
            id: "engineer-closes-recover-reset-after-recreate",
            agent: "engineer",
            phase: "engineer",
            planName: "recover-reset",
            ordinal: 2,
            text: "Recovery reset completed.",
        },
        {
            id: "reviewer-approves-recover-reset-after-recreate",
            agent: "reviewer",
            phase: "semantic_review",
            planName: "recover-reset",
            ordinal: 1,
            requiredTools: ["review_diff", "review_complete"],
            toolCalls: [
                { name: "review_diff", arguments: { command: "list" } },
                { name: "review_complete", arguments: { approved: true, feedback: "Recovery reset approved." } },
            ],
        },
        {
            id: "reviewer-closes-recover-reset-after-recreate",
            agent: "reviewer",
            phase: "semantic_review",
            planName: "recover-reset",
            ordinal: 2,
            text: "Approved recovery reset.",
        },
    ],
    scriptedInteractions: [
        { type: "select", promptIncludes: "Plan recovery", value: "inspect" },
        { type: "select", promptIncludes: "Plan recovery", value: "reset" },
        { type: "select", promptIncludes: "Delete/recreate", value: "confirm" },
    ],
    actions: [
        { type: "seedActiveWorktree", planName: "recover-reset" },
        { type: "sleep", ms: 1000 },
        { type: "type", text: "/load-plan recover-reset" },
        { type: "enter" },
        { type: "enter" },
        { type: "waitForEvent", event: "runtime:tool:start:task_completed", timeoutMs: 60000 },
        {
            type: "waitForPlanStatus",
            planName: "recover-reset",
            statuses: ["validated_ci", "verified"],
            timeoutMs: 60000,
        },
        { type: "captureProjectState", planNames: ["recover-reset"] },
    ],
    assertions: [
        assertsGoldenCoverage("recovery:load-plan-worktree", (result: GoldenScenarioResult) => {
            assertEventIncludes(result, "project:worktree-seeded:recover-reset");
            assertScreenIncludes(result, "Plan Recovery");
            assert(
                ["validated_ci", "verified"].includes(planStatus(result, "recover-reset")),
                `Expected recovery reset to re-run and validate the Plan; got ${planStatus(result, "recover-reset")}`,
            );
            assert(
                (projectState(result).nonTerminalRegistryEntries || []).length === 0,
                `Expected recovery reset completion to drain live registry entries; got ${
                    JSON.stringify(projectState(result).nonTerminalRegistryEntries || [])
                }`,
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
    coverage: ["block:abandon-progress", "recovery:load-plan-worktree"],
    initialProjectFiles: [{
        path: "docs/plans/recover-abandon.md",
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
        { type: "captureProjectState", planNames: ["recover-abandon"] },
    ],
    assertions: [
        assertsGoldenCoverage("block:abandon-progress", (result: GoldenScenarioResult) => {
            assertScreenIncludes(result, "RunWield will now take out the worktree for recover-abandon.");
            assertScreenIncludes(result, "The worktree is gone. The work is stopped.");
        }),
        assertsGoldenCoverage("recovery:load-plan-worktree", (result: GoldenScenarioResult) => {
            assert(
                planStatus(result, "recover-abandon") === "in_progress",
                "Expected abandon to leave lifecycle status for explicit recovery.",
            );
            assert(
                (projectState(result).nonTerminalRegistryEntries || []).length === 0,
                "Expected abandon to drain live worktree registry entries.",
            );
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
        path: "docs/plans/broken.md",
        text:
            "---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Broken\naffectedPaths: []\nstatus: draft\n---\n# Broken\n",
    }],
    actions: [
        { type: "type", text: "/load-plan broken" },
        {
            type: "writeProjectFile",
            path: "docs/plans/broken.md",
            text: "---\nclassification: [PLANNED_CHANGE\nstatus: draft\n---\n# Broken\n",
        },
        { type: "captureProjectFileText", path: "docs/plans/broken.md", key: "brokenPlanTextBefore" },
        { type: "enter" },
        { type: "enter" },
        { type: "sleep", ms: 1000 },
        { type: "waitForIdle", timeoutMs: 10000 },
        { type: "captureProjectFileText", path: "docs/plans/broken.md", key: "brokenPlanTextAfter" },
        { type: "captureProjectState", planNames: ["broken"] },
    ],
    assertions: [
        assertsGoldenCoverage("recovery:malformed-plan-front-matter", (result: GoldenScenarioResult) => {
            assert(
                result.screenText.includes("Plan Front Matter could not be parsed") ||
                    result.screenText.includes("Plan not found: broken"),
                "Expected malformed or missing Plan Front Matter to fail closed on screen.",
            );
            assert(
                result.state.brokenPlanTextBefore === result.state.brokenPlanTextAfter,
                "Malformed Plan content must remain unchanged after /load-plan failure.",
            );
            const captured = projectState(result);
            assert(
                captured.plans?.[0]?.attrs === null,
                "Malformed Plan must not be parsed as a mutated lifecycle Plan.",
            );
            assert(
                (captured.registryEntries || []).length === 0,
                "Malformed Front Matter must not write registry entries.",
            );
            assert(
                (captured.workRecordNames || []).length === 0,
                "Malformed Front Matter must not write Work Records.",
            );
        }),
    ],
};

export const loadPlanValidateWaivedObjectiveChecksScenario = {
    name: "load-plan-validate-waived-objective-checks-reaches-semantic-failure",
    composedTui: true,
    initialAgentName: "guide",
    terminal: { columns: 100, rows: 30 },
    timeoutMs: 120000,
    coverage: ["workflow:load-plan", "recovery:workflow-validation"],
    committedProjectFiles: [
        { path: ".wld/settings.json", text: `${JSON.stringify({ verification_command: "true" }, null, 4)}\n` },
        {
            path: "docs/plans/waived-validate.md",
            text:
                '---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Waived Objective Check validation\naffectedPaths: []\nobjectiveChecks:\n  - id: OC1\n    command: "false"\nobjectiveCheckWaivers:\n  - id: OC1\n    command: "false"\n    source: engineer_report\n    explanation: Golden waiver.\n    waivedAt: "2026-08-13T00:00:00.000Z"\nstatus: draft\n---\n# Waived validate\n',
        },
    ],
    scriptedInteractions: [{ type: "select", promptIncludes: "Plan recovery", value: "validate" }],
    actions: [
        { type: "seedActiveWorktree", planName: "waived-validate", status: "implemented" },
        { type: "type", text: "/load-plan waived-validate" },
        { type: "enter" },
        { type: "enter" },
        { type: "sleep", ms: 1000 },
        { type: "waitForIdle", timeoutMs: 90000 },
        { type: "sleep", ms: 1000 },
        { type: "captureProjectState", planNames: ["waived-validate"] },
    ],
    assertions: [
        assertsGoldenCoverage("workflow:load-plan", (result: GoldenScenarioResult) => {
            assertEventIncludes(result, "terminal:type:/load-plan waived-validate");
            assertScreenIncludes(result, "All checks for waived-validate are waived");
            assertScreenIncludes(result, "The build, tests, and checks passed.");
            assertScreenIncludes(result, "Ask the Engineer to restore the code");
            assertScreenIncludes(result, "Workflow Validation failed");
        }),
        assertsGoldenCoverage("recovery:workflow-validation", (result: GoldenScenarioResult) => {
            const plan = projectState(result).plans?.find((entry) => entry.name === "waived-validate");
            assert(
                plan?.attrs?.status === "implemented",
                `Expected validation failure to return to implemented; got ${plan?.attrs?.status}`,
            );
            assert(
                String(plan?.attrs?.failureReason || "").includes("No implementation changes detected"),
                `Expected visible semantic failure reason to be stored; got ${plan?.attrs?.failureReason}`,
            );
        }),
    ],
};

export const loadPlanWorkflowScenarios = [
    loadPlanActionsScenario,
    loadPlanResetReviewArchiveScenario,
    loadPlanCanceledExecutionThenPlannerReviewScenario,
    loadPlanInterruptedRecoveryScenario,
    loadPlanWorktreeInspectResetScenario,
    loadPlanAbandonProgressScenario,
    loadPlanMalformedFrontMatterScenario,
    loadPlanValidateWaivedObjectiveChecksScenario,
];
