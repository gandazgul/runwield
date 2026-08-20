import { assert } from "@std/assert";
import {
    plannedChangeCiRepairReentryScenario,
    plannedChangeValidationExhaustedScenario,
    plannedChangeValidationFailureRetryScenario,
} from "./planned-change-workflow.js";
import { withValidationBranches } from "./validation-workflow-tree-shared.ts";
import type { ValidationWorkflowResultLike } from "../testing/validation-workflow-coverage.ts";

function assertBrokenObjectiveReportIsNotPlanAmendment(result: ValidationWorkflowResultLike): void {
    const transcript = `${result.screenText || ""}\n${result.scrollbackText || ""}`;
    assert(!transcript.includes("Plan Amendment"), "A broken-check report must not be shown as a Plan Amendment.");
    assert(!transcript.includes("<removed>"), "A broken-check report must not show Objective Checks as removed.");
}

export const validationTreeCiLoopScenario = withValidationBranches(
    plannedChangeCiRepairReentryScenario,
    "validation-tree-ci-loop",
    ["plan"],
    ["mechanical:ci:pass", "mechanical:ci:repair-completed"],
);

export const validationTreeCiRetrySuccessScenario = withValidationBranches(
    plannedChangeValidationFailureRetryScenario,
    "validation-tree-ci-retry-success",
    ["validation-retry"],
    ["semantic:approval:first-round"],
);

function planAmendmentScenario(
    choice: "approve_amendment" | "engineer_follow_up" | "stop",
    options: { suffix?: string; amendedCommand?: string; promptIncludes?: string } = {},
) {
    const suffix = options.suffix ||
        (choice === "approve_amendment" ? "approve" : choice === "engineer_follow_up" ? "follow-up" : "stop");
    const planName = `plan-amendment-${suffix}`;
    const amendedCommand = options.amendedCommand || "test -f amendment-ready";
    return {
        ...plannedChangeValidationFailureRetryScenario,
        committedProjectFiles: [
            { path: ".wld/settings.json", text: `${JSON.stringify({ verification_command: "true" }, null, 4)}\n` },
        ],
        // Keep the Plan file that plan_written just enriched with OC_AMEND.
        // Replacing it with a body-only review fixture would erase the baseline
        // check before the Engineer can propose a command change.
        reviewedPlan: undefined,
        scriptedInteractions: [{
            type: "select",
            promptIncludes: options.promptIncludes || "Approve this Plan Amendment",
            value: choice,
        }],
        script: [
            {
                id: `planner-submits-${planName}`,
                agent: "planner",
                phase: "plan_review",
                ordinal: 1,
                requiredTools: ["plan_written"],
                toolCalls: [{
                    name: "plan_written",
                    arguments: {
                        planName,
                        objectiveChecks: [{ id: "OC_AMEND", command: "test -f original-marker" }],
                    },
                }],
            },
            {
                id: `engineer-implements-${planName}`,
                agent: "engineer",
                phase: "engineer",
                planName,
                ordinal: 1,
                requiredTools: ["bash", "task_completed"],
                toolCalls: [
                    {
                        name: "bash",
                        arguments: {
                            command:
                                `printf ready > amendment-ready\npython3 - <<'PY'\nfrom pathlib import Path\np = Path('docs/plans/${planName}.md')\ns = p.read_text()\ns = s.replace('test -f original-marker', ${
                                    JSON.stringify(amendedCommand)
                                })\np.write_text(s)\nPY`,
                        },
                    },
                    { name: "task_completed", arguments: { message: "- Implemented and amended the Plan checks." } },
                ],
            },
            {
                id: `engineer-closes-${planName}`,
                agent: "engineer",
                phase: "engineer",
                planName,
                ordinal: 2,
                text: "Awaiting Plan Amendment decision.",
            },
        ],
        actions: [
            {
                type: "writeProjectFile",
                path: `docs/plans/${planName}.md`,
                text:
                    `---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Plan amendment\naffectedPaths: []\nstatus: draft\n---\n# Plan amendment\n\nDraft content.\n`,
            },
            { type: "type", text: `submit ${planName} plan for review` },
            { type: "enter" },
            { type: "waitForEvent", event: "runtime:tool:start:task_completed", timeoutMs: 60000 },
            { type: "sleep", ms: 1000 },
        ],
        assertions: [],
    };
}

export const validationTreePlanAmendmentApproveScenario = withValidationBranches(
    planAmendmentScenario("approve_amendment"),
    "validation-tree-plan-amendment-approve",
    ["plan-amendment-approve"],
    ["mechanical:plan-amendment:approve"],
);

export const validationTreePlanAmendmentFollowUpScenario = withValidationBranches(
    planAmendmentScenario("engineer_follow_up"),
    "validation-tree-plan-amendment-follow-up",
    ["plan-amendment-follow-up"],
    ["mechanical:plan-amendment:follow-up"],
);

export const validationTreePlanAmendmentStopScenario = withValidationBranches(
    planAmendmentScenario("stop"),
    "validation-tree-plan-amendment-stop",
    ["plan-amendment-stop"],
    ["mechanical:plan-amendment:stop"],
);

export const validationTreePlanAmendmentInvalidBaselineScenario = withValidationBranches(
    planAmendmentScenario("engineer_follow_up", {
        suffix: "invalid-baseline",
        amendedCommand: "true",
        promptIncludes: "What should RunWield do?",
    }),
    "validation-tree-plan-amendment-invalid-baseline",
    ["plan-amendment-invalid-baseline"],
    ["mechanical:plan-amendment:invalid-baseline"],
);

function ciCancellationScenario(choice: "engineer_follow_up" | "retry" | "stop") {
    const planName = `ci-cancel-${choice === "stop" ? "stop" : choice === "retry" ? "retry" : "follow-up"}`;
    return {
        ...plannedChangeValidationFailureRetryScenario,
        committedProjectFiles: [
            { path: ".wld/settings.json", text: `${JSON.stringify({ verification_command: "sleep 30" }, null, 4)}\n` },
        ],
        reviewDecisions: [{
            approved: true,
            feedback: "Approved for CI cancellation coverage.",
            approvalAction: "run",
        }],
        reviewedPlan: `# ${planName}\n\nGolden CI cancellation content.\n`,
        scriptedInteractions: [{ type: "select", promptIncludes: "tests for", value: choice }],
        script: [
            {
                id: `planner-submits-${planName}`,
                agent: "planner",
                phase: "plan_review",
                ordinal: 1,
                requiredTools: ["plan_written"],
                toolCalls: [{
                    name: "plan_written",
                    arguments: { planName, objectiveChecks: [{ id: "OC1", command: "test -f golden-ci-cancel.txt" }] },
                }],
            },
            {
                id: `engineer-implements-${planName}`,
                agent: "engineer",
                phase: "engineer",
                planName,
                ordinal: 1,
                requiredTools: ["bash", "task_completed"],
                toolCalls: [
                    { name: "bash", arguments: { command: "printf cancel > golden-ci-cancel.txt" } },
                    { name: "task_completed", arguments: { message: "- Implemented CI cancellation fixture." } },
                ],
            },
            {
                id: `engineer-closes-${planName}`,
                agent: "engineer",
                phase: "engineer",
                planName,
                ordinal: 2,
                text: "Awaiting canceled CI decision.",
            },
        ],
        actions: [
            {
                type: "writeProjectFile",
                path: `docs/plans/${planName}.md`,
                text:
                    `---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: CI cancel\naffectedPaths: []\nstatus: draft\n---\n# CI cancel\n\nDraft content.\n`,
            },
            { type: "type", text: `submit ${planName} plan for review` },
            { type: "enter" },
            { type: "waitForEvent", event: "runtime:tool:start:task_completed", timeoutMs: 60000 },
            { type: "waitForPlanStatus", planName, statuses: ["implemented"], timeoutMs: 90000 },
            { type: "waitForEventCount", event: "runtime:tool:start:bash", count: 2, timeoutMs: 90000 },
            { type: "sleep", ms: 1000 },
            { type: "escape" },
            { type: "sleep", ms: 1000 },
        ],
        assertions: [],
    };
}

export const validationTreeCiCancelRetryScenario = withValidationBranches(
    {
        ...ciCancellationScenario("retry"),
        scriptedInteractions: [{
            type: "select",
            promptIncludes: "tests for",
            value: "retry",
            userFixesFirst: {
                path: ".wld/settings.json",
                text: `${JSON.stringify({ verification_command: "true" }, null, 4)}\n`,
            },
        }],
    },
    "validation-tree-ci-cancel-retry",
    ["ci-cancel-retry"],
    ["mechanical:ci:cancel-retry"],
);

export const validationTreeCiCancelFollowUpScenario = withValidationBranches(
    ciCancellationScenario("engineer_follow_up"),
    "validation-tree-ci-cancel-follow-up",
    ["ci-cancel-follow-up"],
    ["mechanical:ci:cancel-follow-up"],
);

export const validationTreeCiCancelStopScenario = withValidationBranches(
    ciCancellationScenario("stop"),
    "validation-tree-ci-cancel-stop",
    ["ci-cancel-stop"],
    ["mechanical:ci:cancel-stop"],
);

export const validationTreeCiRepairIncompleteScenario = withValidationBranches(
    {
        ...plannedChangeValidationFailureRetryScenario,
        script: [
            ...(plannedChangeValidationFailureRetryScenario.script ?? []).slice(0, 3),
            {
                id: "engineer-ci-repair-without-completion",
                agent: "engineer",
                phase: "engineer",
                planName: "validation-retry",
                ordinal: 3,
                requiredTools: ["bash"],
                toolCalls: [{
                    name: "bash",
                    arguments: { command: "printf repaired > golden-validation-retry.txt" },
                }],
            },
            {
                id: "engineer-ci-repair-stops-before-completion",
                agent: "engineer",
                phase: "engineer",
                planName: "validation-retry",
                ordinal: 4,
                text: "CI repair stopped before task_completed.",
            },
        ],
        actions: [
            {
                type: "writeProjectFile",
                path: "docs/plans/validation-retry.md",
                text:
                    "---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Validation retry\naffectedPaths: []\nstatus: draft\n---\n# Validation retry\n\nDraft content.\n",
            },
            { type: "type", text: "submit validation retry plan for review" },
            { type: "enter" },
            { type: "waitForEvent", event: "runtime:tool:start:task_completed", timeoutMs: 60000 },
            { type: "waitForPlanStatus", planName: "validation-retry", statuses: ["implemented"], timeoutMs: 90000 },
            { type: "sleep", ms: 1000 },
        ],
        assertions: [],
    },
    "validation-tree-ci-repair-incomplete",
    ["validation-retry"],
    ["mechanical:ci:repair-incomplete"],
);

export const validationTreeValidationExhaustedRetryScenario = withValidationBranches(
    {
        ...plannedChangeValidationExhaustedScenario,
        scriptedInteractions: [{
            type: "select",
            promptIncludes: "tests for",
            value: "retry",
            userFixesFirst: {
                path: ".wld/settings.json",
                text: `${JSON.stringify({ verification_command: "true" }, null, 4)}\n`,
            },
        }],
        script: [
            ...(plannedChangeValidationExhaustedScenario.script ?? []),
            {
                id: "reviewer-approves-validation-exhausted-retry",
                agent: "reviewer",
                phase: "semantic_review",
                planName: "validation-exhausted",
                ordinal: 1,
                requiredTools: ["review_diff", "review_complete"],
                toolCalls: [
                    { name: "review_diff", arguments: { command: "list" } },
                    { name: "review_complete", arguments: { approved: true, feedback: "Exhausted retry approved." } },
                ],
            },
            {
                id: "reviewer-closes-validation-exhausted-retry",
                agent: "reviewer",
                phase: "semantic_review",
                planName: "validation-exhausted",
                ordinal: 2,
                text: "Approved exhausted retry recovery.",
            },
        ],
        actions: [
            ...(plannedChangeValidationExhaustedScenario.actions ?? []).filter((action: { type?: string }) =>
                action.type !== "captureProjectState"
            ),
            { type: "waitForPlanStatus", planName: "validation-exhausted", statuses: ["verified"], timeoutMs: 90000 },
        ],
        assertions: [],
    },
    "validation-tree-validation-exhausted-retry",
    ["validation-exhausted"],
    ["mechanical:ci:exhausted-retry"],
);

export const validationTreeValidationExhaustedFollowUpScenario = withValidationBranches(
    {
        ...plannedChangeValidationExhaustedScenario,
        scriptedInteractions: [
            { type: "select", promptIncludes: "tests for", value: "engineer_follow_up" },
            {
                type: "text",
                promptIncludes: "Validation Repair Engineer",
                value: "Inspect why the verification command still fails, then try the smallest safe repair.",
            },
        ],
        script: [
            ...(plannedChangeValidationExhaustedScenario.script ?? []),
            {
                id: "validation-exhausted-follow-up-pauses",
                agent: "engineer",
                phase: "engineer",
                planName: "validation-exhausted",
                ordinal: 9,
                text: "I need more user guidance before changing the verification setup.",
            },
        ],
        actions: (plannedChangeValidationExhaustedScenario.actions ?? []).map((
            action: { type?: string; event?: string },
        ) => action.type === "waitForEventCount" && action.event === "runtime:interaction_resolved"
            ? { ...action, count: 3 }
            : action
        ),
    },
    "validation-tree-validation-exhausted-follow-up",
    ["validation-exhausted"],
    ["mechanical:ci:exhausted-follow-up"],
);

export const validationTreeValidationExhaustedStopScenario = withValidationBranches(
    plannedChangeValidationExhaustedScenario,
    "validation-tree-validation-exhausted-stop",
    ["validation-exhausted"],
    ["mechanical:ci:exhausted-stop"],
);

function objectiveCancellationScenario(choice: "engineer_follow_up" | "retry" | "stop") {
    const planName = `objective-cancel-${choice === "stop" ? "stop" : choice === "retry" ? "retry" : "follow-up"}`;
    const objectiveCommand = "test -f objective-ready || { test -f objective-started && sleep 30; false; }";
    return {
        ...plannedChangeValidationFailureRetryScenario,
        committedProjectFiles: [
            { path: ".wld/settings.json", text: `${JSON.stringify({ verification_command: "true" }, null, 4)}\n` },
        ],
        initialProjectFiles: [{
            path: `docs/plans/${planName}.md`,
            text:
                `---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Objective cancel\naffectedPaths: []\nobjectiveChecks:\n  - id: OC_LONG\n    command: ${
                    JSON.stringify(objectiveCommand)
                }\nstatus: draft\n---\n# Objective cancel\n\nDraft content.\n`,
        }],
        reviewDecisions: [{
            approved: true,
            feedback: "Approved for Objective Check cancellation coverage.",
            approvalAction: "run",
        }],
        reviewedPlan: undefined,
        scriptedInteractions: [{ type: "select", promptIncludes: "Objective-Failing Checks", value: choice }],
        script: [
            {
                id: `planner-submits-${planName}`,
                agent: "planner",
                phase: "plan_review",
                ordinal: 1,
                requiredTools: ["plan_written"],
                toolCalls: [{
                    name: "plan_written",
                    arguments: { planName, objectiveChecks: [{ id: "OC_LONG", command: objectiveCommand }] },
                }],
            },
            {
                id: `engineer-implements-${planName}`,
                agent: "engineer",
                phase: "engineer",
                planName,
                ordinal: 1,
                requiredTools: ["bash", "task_completed"],
                toolCalls: [
                    { name: "bash", arguments: { command: "printf started > objective-started" } },
                    {
                        name: "task_completed",
                        arguments: { message: "- Implemented Objective Check cancellation fixture." },
                    },
                ],
            },
            {
                id: `engineer-closes-${planName}`,
                agent: "engineer",
                phase: "engineer",
                planName,
                ordinal: 2,
                text: "Awaiting canceled Objective Check decision.",
            },
        ],
        actions: [
            {
                type: "writeProjectFile",
                path: `docs/plans/${planName}.md`,
                text:
                    `---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Objective cancel\naffectedPaths: []\nobjectiveChecks:\n  - id: OC_LONG\n    command: ${
                        JSON.stringify(objectiveCommand)
                    }\nstatus: draft\n---\n# Objective cancel\n\nDraft content.\n`,
            },
            { type: "type", text: `submit ${planName} plan for review` },
            { type: "enter" },
            { type: "waitForEvent", event: "runtime:tool:start:task_completed", timeoutMs: 60000 },
            { type: "waitForScreen", text: `Running checks for ${planName}: OC_LONG`, timeoutMs: 90000 },
            { type: "escape" },
            { type: "waitForPlanStatus", planName, statuses: ["implemented"], timeoutMs: 90000 },
            { type: "sleep", ms: 1000 },
        ],
        assertions: [],
    };
}

export const validationTreeObjectiveCancelRetryScenario = withValidationBranches(
    {
        ...objectiveCancellationScenario("retry"),
        scriptedInteractions: [{
            type: "select",
            promptIncludes: "Objective-Failing Checks",
            value: "retry",
            userFixesFirst: {
                path: "objective-ready",
                text: "ready\n",
                target: "execution",
                planName: "objective-cancel-retry",
            },
        }],
        script: [
            ...objectiveCancellationScenario("retry").script,
            {
                id: "reviewer-approves-objective-cancel-retry",
                agent: "reviewer",
                phase: "semantic_review",
                planName: "objective-cancel-retry",
                ordinal: 1,
                requiredTools: ["review_diff", "review_complete"],
                toolCalls: [
                    { name: "review_diff", arguments: { command: "list" } },
                    {
                        name: "review_complete",
                        arguments: { approved: true, feedback: "Objective cancellation retry approved." },
                    },
                ],
            },
        ],
        actions: [
            ...objectiveCancellationScenario("retry").actions.slice(0, 6),
            {
                type: "waitForPlanStatus",
                planName: "objective-cancel-retry",
                statuses: ["verified"],
                timeoutMs: 90000,
            },
        ],
    },
    "validation-tree-objective-cancel-retry",
    ["objective-cancel-retry"],
    ["mechanical:objective:cancel-retry"],
);

export const validationTreeObjectiveCancelFollowUpScenario = withValidationBranches(
    {
        ...objectiveCancellationScenario("engineer_follow_up"),
        actions: [
            ...objectiveCancellationScenario("engineer_follow_up").actions.slice(0, 6),
            { type: "waitForScreen", text: "The check is on hold.", timeoutMs: 90000 },
        ],
    },
    "validation-tree-objective-cancel-follow-up",
    ["objective-cancel-follow-up"],
    ["mechanical:objective:cancel-follow-up"],
);

export const validationTreeObjectiveCancelStopScenario = withValidationBranches(
    objectiveCancellationScenario("stop"),
    "validation-tree-objective-cancel-stop",
    ["objective-cancel-stop"],
    ["mechanical:objective:cancel-stop"],
);

export const validationTreeBrokenObjectiveDetectedWaiveScenario = withValidationBranches(
    {
        name: "validation-tree-broken-objective-detected-waive-base",
        composedTui: true,
        initialAgentName: "guide",
        terminal: { columns: 100, rows: 30 },
        timeoutMs: 180000,
        committedProjectFiles: [
            { path: ".wld/settings.json", text: `${JSON.stringify({ verification_command: "true" }, null, 4)}\n` },
        ],
        initialProjectFiles: [{
            path: "docs/plans/broken-objective-detected-waive.md",
            text:
                "---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Broken Objective detected waiver\naffectedPaths: []\nstatus: ready_for_work\nplanId: broken-objective-detected-waive-plan\nobjectiveChecks:\n  - id: OC_BROKEN\n    command: runwield-missing-objective-command\n---\n# Broken Objective detected waiver\n\nAlready implemented content.\n",
        }],
        script: [
            {
                id: "reviewer-approves-broken-objective-detected-waive",
                agent: "reviewer",
                phase: "semantic_review",
                planName: "broken-objective-detected-waive",
                ordinal: 1,
                requiredTools: ["review_diff", "review_complete"],
                toolCalls: [
                    { name: "review_diff", arguments: { command: "list" } },
                    {
                        name: "review_complete",
                        arguments: { approved: true, feedback: "Broken Objective waiver path approved." },
                    },
                ],
            },
            {
                id: "reviewer-closes-broken-objective-detected-waive",
                agent: "reviewer",
                phase: "semantic_review",
                planName: "broken-objective-detected-waive",
                ordinal: 2,
                text: "Approved broken Objective waiver path.",
            },
        ],
        scriptedInteractions: [
            { type: "select", promptIncludes: "Plan recovery (implemented)", value: "validate" },
            { type: "select", promptIncludes: "RunWield detected broken Objective-Failing Checks", value: "waive" },
            { type: "text", promptIncludes: "Optional note", value: "Golden waiver note." },
        ],
        actions: [
            {
                type: "seedActiveWorktree",
                planName: "broken-objective-detected-waive",
                status: "implemented",
                files: [{ path: "implementation.txt", text: "implemented\n" }],
                attrs: {
                    objectiveChecks: [{ id: "OC_BROKEN", command: "runwield-missing-objective-command" }],
                },
            },
            { type: "type", text: "/load-plan broken-objective-detected-waive" },
            { type: "enter" },
            { type: "enter" },
            {
                type: "waitForPlanStatus",
                planName: "broken-objective-detected-waive",
                statuses: ["verified"],
                timeoutMs: 120000,
            },
        ],
        assertions: [],
    },
    "validation-tree-broken-objective-detected-waive",
    ["broken-objective-detected-waive"],
    ["mechanical:broken-objective:detected-waive"],
);

export const validationTreeBrokenObjectiveDetectedRejectScenario = withValidationBranches(
    {
        name: "validation-tree-broken-objective-detected-reject-base",
        composedTui: true,
        initialAgentName: "guide",
        terminal: { columns: 100, rows: 30 },
        timeoutMs: 180000,
        committedProjectFiles: [
            { path: ".wld/settings.json", text: `${JSON.stringify({ verification_command: "true" }, null, 4)}\n` },
        ],
        initialProjectFiles: [{
            path: "docs/plans/broken-objective-detected-reject.md",
            text:
                "---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Broken Objective detected reject\naffectedPaths: []\nstatus: ready_for_work\nplanId: broken-objective-detected-reject-plan\nobjectiveChecks:\n  - id: OC_BROKEN\n    command: runwield-missing-objective-command\n---\n# Broken Objective detected reject\n\nAlready implemented content.\n",
        }],
        script: [{
            id: "engineer-receives-broken-objective-rejection",
            agent: "engineer",
            phase: "engineer",
            planName: "broken-objective-detected-reject",
            ordinal: 1,
            text: "Received rejected broken Objective Check waiver feedback.",
        }],
        scriptedInteractions: [
            { type: "select", promptIncludes: "Plan recovery (implemented)", value: "validate" },
            { type: "select", promptIncludes: "RunWield detected broken Objective-Failing Checks", value: "reject" },
            { type: "text", promptIncludes: "Tell the Engineer", value: "Fix the broken Objective Check command." },
        ],
        actions: [
            {
                type: "seedActiveWorktree",
                planName: "broken-objective-detected-reject",
                status: "implemented",
                files: [{ path: "implementation.txt", text: "implemented\n" }],
                attrs: {
                    objectiveChecks: [{ id: "OC_BROKEN", command: "runwield-missing-objective-command" }],
                },
            },
            { type: "type", text: "/load-plan broken-objective-detected-reject" },
            { type: "enter" },
            { type: "enter" },
            {
                type: "waitForPlanStatus",
                planName: "broken-objective-detected-reject",
                statuses: ["implemented"],
                timeoutMs: 90000,
            },
            { type: "waitForEvent", event: "runtime:turn_end", timeoutMs: 60000 },
        ],
        assertions: [],
    },
    "validation-tree-broken-objective-detected-reject",
    ["broken-objective-detected-reject"],
    ["mechanical:broken-objective:detected-reject"],
);

export const validationTreeBrokenObjectiveFollowUpScenario = withValidationBranches(
    {
        name: "validation-tree-broken-objective-follow-up-base",
        composedTui: true,
        initialAgentName: "guide",
        terminal: { columns: 100, rows: 30 },
        timeoutMs: 180000,
        committedProjectFiles: [
            { path: ".wld/settings.json", text: `${JSON.stringify({ verification_command: "true" }, null, 4)}\n` },
        ],
        initialProjectFiles: [{
            path: "docs/plans/broken-objective-follow-up.md",
            text:
                "---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Broken Objective follow-up\naffectedPaths: []\nstatus: ready_for_work\nplanId: broken-objective-follow-up-plan\nobjectiveChecks:\n  - id: OC_BROKEN\n    command: runwield-missing-objective-command\n---\n# Broken Objective follow-up\n\nAlready implemented content.\n",
        }],
        script: [{
            id: "engineer-receives-broken-objective-follow-up",
            agent: "engineer",
            phase: "engineer",
            planName: "broken-objective-follow-up",
            ordinal: 1,
            text: "Received broken Objective Check follow-up.",
        }],
        scriptedInteractions: [
            { type: "select", promptIncludes: "Plan recovery (implemented)", value: "validate" },
            {
                type: "select",
                promptIncludes: "RunWield detected broken Objective-Failing Checks",
                value: "engineer_follow_up",
            },
        ],
        actions: [
            {
                type: "seedActiveWorktree",
                planName: "broken-objective-follow-up",
                status: "implemented",
                files: [{ path: "implementation.txt", text: "implemented\n" }],
                attrs: {
                    objectiveChecks: [{ id: "OC_BROKEN", command: "runwield-missing-objective-command" }],
                },
            },
            { type: "type", text: "/load-plan broken-objective-follow-up" },
            { type: "enter" },
            { type: "enter" },
            {
                type: "waitForPlanStatus",
                planName: "broken-objective-follow-up",
                statuses: ["implemented"],
                timeoutMs: 90000,
            },
            { type: "sleep", ms: 1000 },
            { type: "type", text: "Please review the broken Objective Check." },
            { type: "enter" },
            { type: "waitForEvent", event: "runtime:turn_end", timeoutMs: 60000 },
        ],
        assertions: [],
    },
    "validation-tree-broken-objective-follow-up",
    ["broken-objective-follow-up"],
    ["mechanical:broken-objective:follow-up"],
);

export const validationTreeBrokenObjectiveStopScenario = withValidationBranches(
    {
        name: "validation-tree-broken-objective-stop-base",
        composedTui: true,
        initialAgentName: "guide",
        terminal: { columns: 100, rows: 30 },
        timeoutMs: 180000,
        committedProjectFiles: [
            { path: ".wld/settings.json", text: `${JSON.stringify({ verification_command: "true" }, null, 4)}\n` },
        ],
        initialProjectFiles: [{
            path: "docs/plans/broken-objective-stop.md",
            text:
                "---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Broken Objective stop\naffectedPaths: []\nstatus: ready_for_work\nplanId: broken-objective-stop-plan\nobjectiveChecks:\n  - id: OC_BROKEN\n    command: runwield-missing-objective-command\n---\n# Broken Objective stop\n\nAlready implemented content.\n",
        }],
        scriptedInteractions: [
            { type: "select", promptIncludes: "Plan recovery (implemented)", value: "validate" },
            { type: "select", promptIncludes: "RunWield detected broken Objective-Failing Checks", value: "stop" },
        ],
        actions: [
            {
                type: "seedActiveWorktree",
                planName: "broken-objective-stop",
                status: "implemented",
                files: [{ path: "implementation.txt", text: "implemented\n" }],
                attrs: {
                    objectiveChecks: [{ id: "OC_BROKEN", command: "runwield-missing-objective-command" }],
                },
            },
            { type: "type", text: "/load-plan broken-objective-stop" },
            { type: "enter" },
            { type: "enter" },
            {
                type: "waitForPlanStatus",
                planName: "broken-objective-stop",
                statuses: ["implemented"],
                timeoutMs: 90000,
            },
            { type: "sleep", ms: 1000 },
        ],
        assertions: [],
    },
    "validation-tree-broken-objective-stop",
    ["broken-objective-stop"],
    ["mechanical:broken-objective:stop"],
);

function engineerReportedBrokenObjectiveScenario(choice: "waive" | "reject") {
    const suffix = choice === "waive" ? "waive" : "reject";
    const planName = `broken-objective-engineer-reported-${suffix}`;
    return {
        name: `${planName}-base`,
        composedTui: true,
        initialAgentName: "planner",
        terminal: { columns: 100, rows: 30 },
        timeoutMs: 180000,
        committedProjectFiles: [
            { path: ".wld/settings.json", text: `${JSON.stringify({ verification_command: "true" }, null, 4)}\n` },
        ],
        initialProjectFiles: [{
            path: `docs/plans/${planName}.md`,
            text:
                `---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Engineer-reported broken Objective Check\naffectedPaths: []\nobjectiveChecks:\n  - id: OC_REPORT\n    command: test -f engineer-objective-ready\nstatus: draft\n---\n# Engineer-reported broken Objective Check\n\nDraft content.\n`,
        }],
        reviewedPlan: undefined,
        reviewDecisions: [{
            approved: true,
            feedback: "Approved for Engineer-reported Objective Check coverage.",
            approvalAction: "run",
        }],
        scriptedInteractions: choice === "waive"
            ? [
                {
                    type: "select",
                    promptIncludes: "The execution agent reported broken Objective-Failing Checks",
                    value: "waive",
                },
                { type: "text", promptIncludes: "Optional note", value: "Accepted Engineer evidence." },
            ]
            : [
                {
                    type: "select",
                    promptIncludes: "The execution agent reported broken Objective-Failing Checks",
                    value: "reject",
                },
                {
                    type: "text",
                    promptIncludes: "Tell the Engineer what to fix",
                    value: "The reported check is not waived. Make the Objective Check pass.",
                },
            ],
        script: [
            {
                id: `planner-submits-${planName}`,
                agent: "planner",
                phase: "plan_review",
                ordinal: 1,
                requiredTools: ["plan_written"],
                toolCalls: [{
                    name: "plan_written",
                    arguments: {
                        planName,
                        objectiveChecks: [{ id: "OC_REPORT", command: "test -f engineer-objective-ready" }],
                    },
                }],
            },
            {
                id: `engineer-implements-${planName}`,
                agent: "engineer",
                phase: "engineer",
                planName,
                ordinal: 1,
                requiredTools: ["bash", "task_completed"],
                toolCalls: [
                    { name: "bash", arguments: { command: "printf implemented > engineer-objective-started" } },
                    {
                        name: "task_completed",
                        arguments: { message: "- Implemented fixture before Objective Check repair." },
                    },
                ],
            },
            {
                id: `engineer-closes-${planName}-implementation`,
                agent: "engineer",
                phase: "engineer",
                planName,
                ordinal: 2,
                text: "Implementation is ready for Objective Check validation.",
            },
            {
                id: `engineer-reports-broken-objective-${suffix}`,
                agent: "engineer",
                phase: "engineer",
                planName,
                ordinal: 3,
                requiredTools: ["task_completed"],
                toolCalls: [{
                    name: "task_completed",
                    arguments: {
                        message: "- Objective Check appears defective after repair attempt.",
                        brokenObjectiveChecks: [{
                            id: "OC_REPORT",
                            explanation: "The repair run showed this check cannot prove the objective reliably.",
                        }],
                    },
                }],
            },
            ...(choice === "reject"
                ? [{
                    id: "engineer-closes-broken-objective-report-reject",
                    agent: "engineer",
                    phase: "engineer",
                    planName,
                    ordinal: 4,
                    text: "Broken Objective Check report is ready for the user decision.",
                }]
                : []),
            ...(choice === "waive"
                ? [
                    {
                        id: `reviewer-approves-${planName}`,
                        agent: "reviewer",
                        phase: "semantic_review",
                        planName,
                        ordinal: 1,
                        requiredTools: ["review_diff", "review_complete"],
                        toolCalls: [
                            { name: "review_diff", arguments: { command: "list" } },
                            {
                                name: "review_complete",
                                arguments: { approved: true, feedback: "Engineer-reported waiver path approved." },
                            },
                        ],
                    },
                ]
                : [
                    {
                        id: `engineer-receives-rejected-reported-broken-objective`,
                        agent: "engineer",
                        phase: "engineer",
                        planName,
                        ordinal: 5,
                        text: "Received rejected Engineer-reported broken Objective Check waiver feedback.",
                    },
                ]),
        ],
        actions: [
            {
                type: "writeProjectFile",
                path: `docs/plans/${planName}.md`,
                text:
                    `---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Engineer-reported broken Objective Check\naffectedPaths: []\nobjectiveChecks:\n  - id: OC_REPORT\n    command: test -f engineer-objective-ready\nstatus: draft\n---\n# Engineer-reported broken Objective Check\n\nDraft content.\n`,
            },
            { type: "type", text: `submit ${planName} plan for review` },
            { type: "enter" },
            { type: "waitForEvent", event: "runtime:tool:start:task_completed", timeoutMs: 60000 },
            { type: "waitForIdle", timeoutMs: 180000 },
            choice === "waive"
                ? { type: "waitForPlanStatus", planName, statuses: ["verified"], timeoutMs: 90000 }
                : { type: "waitForPlanStatus", planName, statuses: ["implemented"], timeoutMs: 90000 },
        ],
        assertions: [assertBrokenObjectiveReportIsNotPlanAmendment],
    };
}

export const validationTreeBrokenObjectiveEngineerReportedWaiveScenario = withValidationBranches(
    engineerReportedBrokenObjectiveScenario("waive"),
    "validation-tree-broken-objective-engineer-reported-waive",
    ["broken-objective-engineer-reported-waive"],
    ["mechanical:broken-objective:engineer-reported-waive"],
);

export const validationTreeBrokenObjectiveEngineerReportedRejectScenario = withValidationBranches(
    engineerReportedBrokenObjectiveScenario("reject"),
    "validation-tree-broken-objective-engineer-reported-reject",
    ["broken-objective-engineer-reported-reject"],
    ["mechanical:broken-objective:engineer-reported-reject"],
);

export const validationTreeBrokenObjectiveStaleReportScenario = withValidationBranches(
    {
        name: "validation-tree-broken-objective-stale-report-base",
        composedTui: true,
        initialAgentName: "guide",
        terminal: { columns: 100, rows: 30 },
        timeoutMs: 180000,
        committedProjectFiles: [
            { path: ".wld/settings.json", text: `${JSON.stringify({ verification_command: "true" }, null, 4)}\n` },
        ],
        initialProjectFiles: [{
            path: "docs/plans/broken-objective-stale-report.md",
            text:
                "---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Stale broken Objective Check report\naffectedPaths: []\nstatus: ready_for_work\nplanId: broken-objective-stale-report-plan\nobjectiveChecks:\n  - id: OC_CURRENT\n    command: test -f current-ready\n---\n# Stale broken Objective Check report\n\nAlready implemented content.\n",
        }],
        scriptedInteractions: [
            { type: "select", promptIncludes: "Plan recovery (implemented)", value: "validate" },
            { type: "select", promptIncludes: "does not match the current checks", value: "stop" },
        ],
        script: [
            {
                id: "engineer-repairs-and-reports-stale-broken-objective",
                agent: "engineer",
                phase: "engineer",
                planName: "broken-objective-stale-report",
                ordinal: 1,
                requiredTools: ["bash", "task_completed"],
                toolCalls: [
                    { name: "bash", arguments: { command: "printf repair-attempt > stale-report-attempt" } },
                    {
                        name: "task_completed",
                        arguments: {
                            message: "- Attempted repair and reported an obsolete Objective Check result.",
                            brokenObjectiveChecks: [{
                                id: "OC_OLD",
                                explanation: "This report came from an older Objective Check list.",
                            }],
                        },
                    },
                ],
            },
            {
                id: "engineer-closes-stale-broken-objective-report",
                agent: "engineer",
                phase: "engineer",
                planName: "broken-objective-stale-report",
                ordinal: 2,
                text: "The obsolete Objective Check report is ready for validation.",
            },
        ],
        actions: [
            {
                type: "seedActiveWorktree",
                planName: "broken-objective-stale-report",
                status: "implemented",
                files: [{ path: "implementation.txt", text: "implemented\n" }],
                attrs: {
                    objectiveChecks: [{ id: "OC_CURRENT", command: "test -f current-ready" }],
                },
            },
            { type: "type", text: "/load-plan broken-objective-stale-report" },
            { type: "enter" },
            { type: "enter" },
            { type: "waitForEvent", event: "runtime:tool:start:task_completed", timeoutMs: 90000 },
            { type: "sleep", ms: 1000 },
            { type: "captureProjectState", planNames: ["broken-objective-stale-report"] },
        ],
        assertions: [],
    },
    "validation-tree-broken-objective-stale-report",
    ["broken-objective-stale-report"],
    ["mechanical:broken-objective:stale-report"],
);

export const validationTreeObjectiveNoneScenario = withValidationBranches(
    {
        name: "validation-tree-objective-none-base",
        composedTui: true,
        initialAgentName: "guide",
        terminal: { columns: 100, rows: 30 },
        timeoutMs: 180000,
        committedProjectFiles: [
            { path: ".wld/settings.json", text: `${JSON.stringify({ verification_command: "true" }, null, 4)}\n` },
        ],
        initialProjectFiles: [{
            path: "docs/plans/objective-none.md",
            text:
                "---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Objective none\naffectedPaths: []\nstatus: ready_for_work\nplanId: objective-none-plan\n---\n# Objective none\n\nAlready implemented content.\n",
        }],
        script: [
            {
                id: "reviewer-approves-objective-none",
                agent: "reviewer",
                phase: "semantic_review",
                planName: "objective-none",
                ordinal: 1,
                requiredTools: ["review_diff", "review_complete"],
                toolCalls: [
                    { name: "review_diff", arguments: { command: "list" } },
                    { name: "review_complete", arguments: { approved: true, feedback: "No-objective path approved." } },
                ],
            },
            {
                id: "reviewer-closes-objective-none",
                agent: "reviewer",
                phase: "semantic_review",
                planName: "objective-none",
                ordinal: 2,
                text: "Approved validation with no Objective-Failing Checks.",
            },
        ],
        scriptedInteractions: [
            { type: "select", promptIncludes: "Plan recovery (implemented)", value: "validate" },
        ],
        actions: [
            {
                type: "seedActiveWorktree",
                planName: "objective-none",
                status: "implemented",
                files: [{ path: "implementation.txt", text: "implemented\n" }],
            },
            { type: "type", text: "/load-plan objective-none" },
            { type: "enter" },
            { type: "enter" },
            { type: "waitForPlanStatus", planName: "objective-none", statuses: ["verified"], timeoutMs: 90000 },
        ],
        assertions: [],
    },
    "validation-tree-objective-none",
    ["objective-none"],
    ["mechanical:objective:none"],
);

export const validationTreeObjectiveAllPassScenario = withValidationBranches(
    {
        name: "validation-tree-objective-all-pass-base",
        composedTui: true,
        initialAgentName: "guide",
        terminal: { columns: 100, rows: 30 },
        timeoutMs: 180000,
        committedProjectFiles: [
            { path: ".wld/settings.json", text: `${JSON.stringify({ verification_command: "true" }, null, 4)}\n` },
        ],
        initialProjectFiles: [{
            path: "docs/plans/objective-all-pass.md",
            text:
                '---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Objective all pass\naffectedPaths: []\nstatus: ready_for_work\nplanId: objective-all-pass-plan\nobjectiveChecks:\n  - id: OC_PASS\n    command: "true"\n---\n# Objective all pass\n\nAlready implemented content.\n',
        }],
        script: [
            {
                id: "reviewer-approves-objective-all-pass",
                agent: "reviewer",
                phase: "semantic_review",
                planName: "objective-all-pass",
                ordinal: 1,
                requiredTools: ["review_diff", "review_complete"],
                toolCalls: [
                    { name: "review_diff", arguments: { command: "list" } },
                    { name: "review_complete", arguments: { approved: true, feedback: "All-pass path approved." } },
                ],
            },
            {
                id: "reviewer-closes-objective-all-pass",
                agent: "reviewer",
                phase: "semantic_review",
                planName: "objective-all-pass",
                ordinal: 2,
                text: "Approved validation after the Objective Check passed.",
            },
        ],
        scriptedInteractions: [
            { type: "select", promptIncludes: "Plan recovery (implemented)", value: "validate" },
        ],
        actions: [
            {
                type: "seedActiveWorktree",
                planName: "objective-all-pass",
                status: "implemented",
                files: [{ path: "implementation.txt", text: "implemented\n" }],
            },
            { type: "type", text: "/load-plan objective-all-pass" },
            { type: "enter" },
            { type: "enter" },
            {
                type: "waitForWorktreeRegistryStatus",
                planName: "objective-all-pass",
                statuses: ["absent"],
                timeoutMs: 90000,
            },
            { type: "waitForIdle", timeoutMs: 90000 },
            { type: "captureProjectState", planNames: ["objective-all-pass"] },
            {
                type: "capturePublicationState",
                planName: "objective-all-pass",
                deliveredPath: "implementation.txt",
            },
        ],
        assertions: [],
    },
    "validation-tree-objective-all-pass",
    ["objective-all-pass"],
    ["mechanical:objective:all-pass"],
);

export const validationTreeObjectiveMixedWaivedScenario = withValidationBranches(
    {
        name: "validation-tree-objective-mixed-waived-base",
        composedTui: true,
        initialAgentName: "guide",
        terminal: { columns: 100, rows: 30 },
        timeoutMs: 180000,
        committedProjectFiles: [
            { path: ".wld/settings.json", text: `${JSON.stringify({ verification_command: "true" }, null, 4)}\n` },
        ],
        initialProjectFiles: [{
            path: "docs/plans/objective-mixed-waived.md",
            text:
                "---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Objective mixed waived\naffectedPaths: []\nstatus: ready_for_work\nplanId: objective-mixed-waived-plan\nobjectiveChecks:\n  - id: OC_WAIVED\n    command: test -f never-created\n  - id: OC_ACTIVE\n    command: test -f objective-ready\nobjectiveCheckWaivers:\n  - id: OC_WAIVED\n    command: test -f never-created\n    source: mechanical_detection\n    explanation: Golden pre-accepted broken Objective Check.\n    waivedAt: 2024-01-01T00:00:00.000Z\n---\n# Objective mixed waived\n\nAlready implemented content.\n",
        }],
        script: [
            {
                id: "reviewer-approves-objective-mixed-waived",
                agent: "reviewer",
                phase: "semantic_review",
                planName: "objective-mixed-waived",
                ordinal: 1,
                requiredTools: ["review_diff", "review_complete"],
                toolCalls: [
                    { name: "review_diff", arguments: { command: "list" } },
                    {
                        name: "review_complete",
                        arguments: { approved: true, feedback: "Mixed waived Objective Check path approved." },
                    },
                ],
            },
            {
                id: "reviewer-closes-objective-mixed-waived",
                agent: "reviewer",
                phase: "semantic_review",
                planName: "objective-mixed-waived",
                ordinal: 2,
                text: "Approved mixed waived Objective Check path.",
            },
        ],
        scriptedInteractions: [{ type: "select", promptIncludes: "Plan recovery (implemented)", value: "validate" }],
        actions: [
            {
                type: "seedActiveWorktree",
                planName: "objective-mixed-waived",
                status: "implemented",
                files: [{ path: "objective-ready", text: "ready\n" }],
                attrs: {
                    objectiveChecks: [
                        { id: "OC_WAIVED", command: "test -f never-created" },
                        { id: "OC_ACTIVE", command: "test -f objective-ready" },
                    ],
                    objectiveCheckWaivers: [{
                        id: "OC_WAIVED",
                        command: "test -f never-created",
                        source: "mechanical_detection",
                        explanation: "Golden pre-accepted broken Objective Check.",
                        waivedAt: "2024-01-01T00:00:00.000Z",
                    }],
                },
            },
            { type: "type", text: "/load-plan objective-mixed-waived" },
            { type: "enter" },
            { type: "enter" },
            {
                type: "waitForPlanStatus",
                planName: "objective-mixed-waived",
                statuses: ["verified"],
                timeoutMs: 120000,
            },
        ],
        assertions: [],
    },
    "validation-tree-objective-mixed-waived",
    ["objective-mixed-waived"],
    ["mechanical:objective:mixed-waived"],
);

export const validationTreeObjectiveRepairCompletedScenario = withValidationBranches(
    {
        ...plannedChangeValidationFailureRetryScenario,
        committedProjectFiles: [
            { path: ".wld/settings.json", text: `${JSON.stringify({ verification_command: "true" }, null, 4)}\n` },
        ],
        initialProjectFiles: [{
            path: "docs/plans/objective-repair.md",
            text:
                "---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Objective repair\naffectedPaths: []\nobjectiveChecks:\n  - id: OC_REPAIR\n    command: test -f objective-ready\nstatus: draft\n---\n# Objective repair\n\nDraft content.\n",
        }],
        reviewedPlan: undefined,
        script: [
            {
                id: "planner-submits-objective-repair-plan",
                agent: "planner",
                phase: "plan_review",
                ordinal: 1,
                requiredTools: ["plan_written"],
                toolCalls: [{
                    name: "plan_written",
                    arguments: {
                        planName: "objective-repair",
                        objectiveChecks: [{ id: "OC_REPAIR", command: "test -f objective-ready" }],
                    },
                }],
            },
            {
                id: "engineer-implements-objective-repair-plan",
                agent: "engineer",
                phase: "engineer",
                planName: "objective-repair",
                ordinal: 1,
                requiredTools: ["bash", "task_completed"],
                toolCalls: [
                    { name: "bash", arguments: { command: "printf implemented > objective-started" } },
                    { name: "task_completed", arguments: { message: "- Implemented Objective Check repair fixture." } },
                ],
            },
            {
                id: "engineer-closes-objective-implementation",
                agent: "engineer",
                phase: "engineer",
                planName: "objective-repair",
                ordinal: 2,
                text: "Objective Check implementation is ready for validation.",
            },
            {
                id: "engineer-repairs-objective-check",
                agent: "engineer",
                phase: "engineer",
                planName: "objective-repair",
                ordinal: 3,
                requiredTools: ["bash", "task_completed"],
                toolCalls: [
                    { name: "bash", arguments: { command: "printf ready > objective-ready" } },
                    { name: "task_completed", arguments: { message: "- Repaired unmet Objective Check." } },
                ],
            },
            {
                id: "engineer-closes-objective-repair-session",
                agent: "engineer",
                phase: "engineer",
                planName: "objective-repair",
                ordinal: 4,
                text: "Objective Check repair is complete.",
            },
            {
                id: "reviewer-approves-objective-repair",
                agent: "reviewer",
                phase: "semantic_review",
                planName: "objective-repair",
                ordinal: 1,
                requiredTools: ["review_diff", "review_complete"],
                toolCalls: [
                    { name: "review_diff", arguments: { command: "list" } },
                    { name: "review_complete", arguments: { approved: true, feedback: "Objective repair approved." } },
                ],
            },
        ],
        actions: [
            {
                type: "writeProjectFile",
                path: "docs/plans/objective-repair.md",
                text:
                    "---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Objective repair\naffectedPaths: []\nobjectiveChecks:\n  - id: OC_REPAIR\n    command: test -f objective-ready\nstatus: draft\n---\n# Objective repair\n\nDraft content.\n",
            },
            { type: "type", text: "submit objective repair plan for review" },
            { type: "enter" },
            { type: "waitForEvent", event: "runtime:tool:start:task_completed", timeoutMs: 60000 },
            { type: "waitForIdle", timeoutMs: 180000 },
            { type: "waitForPlanStatus", planName: "objective-repair", statuses: ["verified"], timeoutMs: 90000 },
        ],
        assertions: [],
    },
    "validation-tree-objective-repair-completed",
    ["objective-repair"],
    ["mechanical:objective:repair-completed"],
);

export const validationTreeObjectiveRepairIncompleteScenario = withValidationBranches(
    {
        ...validationTreeObjectiveRepairCompletedScenario,
        name: "validation-tree-objective-repair-incomplete",
        script: validationTreeObjectiveRepairCompletedScenario.script.slice(0, 3).concat([
            {
                id: "engineer-objective-repair-without-completion",
                agent: "engineer",
                phase: "engineer",
                planName: "objective-repair",
                ordinal: 3,
                requiredTools: ["bash"],
                toolCalls: [{ name: "bash", arguments: { command: "printf ready > objective-ready" } }],
            },
            {
                id: "engineer-objective-repair-stops-before-completion",
                agent: "engineer",
                phase: "engineer",
                planName: "objective-repair",
                ordinal: 4,
                text: "Objective Check repair stopped before task_completed.",
            },
        ]),
        actions: validationTreeObjectiveRepairCompletedScenario.actions.slice(0, 5),
        assertions: [],
    },
    "validation-tree-objective-repair-incomplete",
    ["objective-repair"],
    ["mechanical:objective:repair-incomplete"],
);

function objectiveExhaustedScenario(choice: "engineer_follow_up" | "retry" | "stop") {
    const planName = `objective-exhausted-${choice === "stop" ? "stop" : choice === "retry" ? "retry" : "follow-up"}`;
    return {
        ...plannedChangeValidationExhaustedScenario,
        committedProjectFiles: [
            { path: ".wld/settings.json", text: `${JSON.stringify({ verification_command: "true" }, null, 4)}\n` },
        ],
        initialProjectFiles: [{
            path: `docs/plans/${planName}.md`,
            text:
                `---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Objective exhausted\naffectedPaths: []\nobjectiveChecks:\n  - id: OC_EXHAUSTED\n    command: test -f objective-ready\nstatus: draft\n---\n# Objective exhausted\n\nDraft content.\n`,
        }],
        reviewedPlan: undefined,
        scriptedInteractions: [{ type: "select", promptIncludes: "Objective-Failing Checks", value: choice }],
        script: [
            {
                id: `planner-submits-${planName}`,
                agent: "planner",
                phase: "plan_review",
                ordinal: 1,
                requiredTools: ["plan_written"],
                toolCalls: [{
                    name: "plan_written",
                    arguments: {
                        planName,
                        objectiveChecks: [{ id: "OC_EXHAUSTED", command: "test -f objective-ready" }],
                    },
                }],
            },
            {
                id: `engineer-implements-${planName}`,
                agent: "engineer",
                phase: "engineer",
                planName,
                ordinal: 1,
                requiredTools: ["bash", "task_completed"],
                toolCalls: [
                    { name: "bash", arguments: { command: "printf implemented > objective-started" } },
                    {
                        name: "task_completed",
                        arguments: { message: "- Implemented Objective Check exhaustion fixture." },
                    },
                ],
            },
            {
                id: `engineer-closes-${planName}-implementation`,
                agent: "engineer",
                phase: "engineer",
                planName,
                ordinal: 2,
                text: "Implementation is ready for validation.",
            },
            ...[1, 2, 3].flatMap((attempt) => [
                {
                    id: `engineer-${planName}-repair-${attempt}`,
                    agent: "engineer",
                    phase: "engineer",
                    planName,
                    ordinal: attempt * 2 + 1,
                    requiredTools: ["bash", "task_completed"],
                    toolCalls: [
                        { name: "bash", arguments: { command: `printf repair-${attempt} > objective-started` } },
                        {
                            name: "task_completed",
                            arguments: { message: `- Repair ${attempt} still cannot satisfy Objective Checks.` },
                        },
                    ],
                },
                {
                    id: `engineer-closes-${planName}-repair-${attempt}`,
                    agent: "engineer",
                    phase: "engineer",
                    planName,
                    ordinal: attempt * 2 + 2,
                    text: `Objective Check repair ${attempt} is complete.`,
                },
            ]),
        ],
        actions: [
            {
                type: "writeProjectFile",
                path: `docs/plans/${planName}.md`,
                text:
                    `---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Objective exhausted\naffectedPaths: []\nobjectiveChecks:\n  - id: OC_EXHAUSTED\n    command: test -f objective-ready\nstatus: draft\n---\n# Objective exhausted\n\nDraft content.\n`,
            },
            { type: "type", text: `submit ${planName} plan for review` },
            { type: "enter" },
            { type: "waitForEvent", event: "runtime:tool:start:task_completed", timeoutMs: 60000 },
            { type: "waitForIdle", timeoutMs: 180000 },
        ],
        assertions: [],
    };
}

export const validationTreeObjectiveExhaustedRetryScenario = withValidationBranches(
    {
        ...objectiveExhaustedScenario("retry"),
        scriptedInteractions: [{
            type: "select",
            promptIncludes: "Objective-Failing Checks",
            value: "retry",
            userFixesFirst: {
                path: "objective-ready",
                text: "ready\n",
                target: "execution",
                planName: "objective-exhausted-retry",
            },
        }],
        script: [
            ...objectiveExhaustedScenario("retry").script,
            {
                id: "reviewer-approves-objective-exhausted-retry",
                agent: "reviewer",
                phase: "semantic_review",
                planName: "objective-exhausted-retry",
                ordinal: 1,
                requiredTools: ["review_diff", "review_complete"],
                toolCalls: [
                    { name: "review_diff", arguments: { command: "list" } },
                    {
                        name: "review_complete",
                        arguments: { approved: true, feedback: "Objective exhausted retry approved." },
                    },
                ],
            },
        ],
        actions: [
            ...objectiveExhaustedScenario("retry").actions,
            {
                type: "waitForPlanStatus",
                planName: "objective-exhausted-retry",
                statuses: ["verified"],
                timeoutMs: 90000,
            },
        ],
    },
    "validation-tree-objective-exhausted-retry",
    ["objective-exhausted-retry"],
    ["mechanical:objective:exhausted-retry"],
);

export const validationTreeObjectiveExhaustedFollowUpScenario = withValidationBranches(
    {
        ...objectiveExhaustedScenario("engineer_follow_up"),
        scriptedInteractions: [
            { type: "select", promptIncludes: "Objective-Failing Checks", value: "engineer_follow_up" },
            {
                type: "text",
                promptIncludes: "Tell the Validation Repair Engineer what to try next",
                value: "Try the repair again with the latest user guidance.",
            },
        ],
        script: [
            ...objectiveExhaustedScenario("engineer_follow_up").script,
            {
                id: "engineer-objective-exhausted-follow-up",
                agent: "engineer",
                phase: "engineer",
                planName: "objective-exhausted-follow-up",
                ordinal: 9,
                text: "I need more user guidance before changing the Objective Check setup.",
            },
        ],
    },
    "validation-tree-objective-exhausted-follow-up",
    ["objective-exhausted-follow-up"],
    ["mechanical:objective:exhausted-follow-up"],
);

export const validationTreeObjectiveExhaustedStopScenario = withValidationBranches(
    objectiveExhaustedScenario("stop"),
    "validation-tree-objective-exhausted-stop",
    ["objective-exhausted-stop"],
    ["mechanical:objective:exhausted-stop"],
);

export const validationWorkflowMechanicalScenarios = [
    validationTreePlanAmendmentApproveScenario,
    validationTreePlanAmendmentFollowUpScenario,
    validationTreePlanAmendmentInvalidBaselineScenario,
    validationTreePlanAmendmentStopScenario,
    validationTreeCiLoopScenario,
    validationTreeCiRetrySuccessScenario,
    validationTreeCiCancelRetryScenario,
    validationTreeCiCancelFollowUpScenario,
    validationTreeCiCancelStopScenario,
    validationTreeCiRepairIncompleteScenario,
    validationTreeValidationExhaustedRetryScenario,
    validationTreeValidationExhaustedFollowUpScenario,
    validationTreeValidationExhaustedStopScenario,
    validationTreeBrokenObjectiveDetectedRejectScenario,
    validationTreeBrokenObjectiveDetectedWaiveScenario,
    validationTreeBrokenObjectiveEngineerReportedRejectScenario,
    validationTreeBrokenObjectiveEngineerReportedWaiveScenario,
    validationTreeBrokenObjectiveFollowUpScenario,
    validationTreeBrokenObjectiveStopScenario,
    validationTreeBrokenObjectiveStaleReportScenario,
    validationTreeObjectiveCancelRetryScenario,
    validationTreeObjectiveCancelFollowUpScenario,
    validationTreeObjectiveCancelStopScenario,
    validationTreeObjectiveMixedWaivedScenario,
    validationTreeObjectiveNoneScenario,
    validationTreeObjectiveAllPassScenario,
    validationTreeObjectiveRepairCompletedScenario,
    validationTreeObjectiveRepairIncompleteScenario,
    validationTreeObjectiveExhaustedRetryScenario,
    validationTreeObjectiveExhaustedFollowUpScenario,
    validationTreeObjectiveExhaustedStopScenario,
];
