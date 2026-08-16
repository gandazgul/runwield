import {
    plannedChangeNonGitInPlaceScenario,
    plannedChangeReviewRepairValidationScenario,
} from "./planned-change-workflow.js";
import { validationEvidenceAssertion } from "../testing/validation-workflow-coverage.ts";
import { withValidationBranches } from "./validation-workflow-tree-shared.ts";

export const validationTreeSemanticReviewLoopScenario = withValidationBranches(
    plannedChangeReviewRepairValidationScenario,
    "validation-tree-semantic-review-loop",
    ["plan"],
);

// TODO: fix this. The existing composed repair loop does not reach a distinct,
// durable incomplete-repair outcome. Keep the branch as its own skipped Golden
// test so the working review-loop branches continue to run.
export const validationTreeSemanticRepairIncompleteScenario = {
    ...validationTreeSemanticReviewLoopScenario,
    name: "validation-tree-semantic-repair-incomplete",
    validationBranches: ["semantic:repair-incomplete"],
    assertions: [validationEvidenceAssertion("semantic:repair-incomplete")],
};

export const validationTreeSemanticReviewerIncompletePauseScenario = withValidationBranches(
    {
        ...plannedChangeReviewRepairValidationScenario,
        name: "validation-tree-semantic-reviewer-incomplete-pause-base",
        script: plannedChangeReviewRepairValidationScenario.script.slice(0, 5).concat([
            {
                id: "engineer-semantic-repair-without-completion",
                agent: "engineer",
                phase: "engineer",
                ordinal: 3,
                requiredTools: ["write"],
                thinking: "Repair after Semantic Reviewer rejection but do not complete the repair.",
                toolCalls: [{
                    name: "write",
                    arguments: { path: "golden-planned-change.txt", content: "goldenrepaired" },
                }],
            },
            {
                id: "engineer-semantic-repair-stops-before-completion",
                agent: "engineer",
                phase: "engineer",
                ordinal: 4,
                optional: true,
                text: "Semantic Code Review repair stopped before task_completed.",
            },
        ]),
        actions: [
            {
                type: "writeProjectFile",
                path: "docs/plans/plan.md",
                text:
                    "---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Golden PLANNED_CHANGE\naffectedPaths: []\nstatus: draft\n---\n# Golden PLANNED_CHANGE\n\nDraft content.\n",
            },
            { type: "type", text: "submit the planned change for review" },
            { type: "enter" },
            { type: "waitForEvent", event: "runtime:tool:start:review_complete", timeoutMs: 120000 },
            { type: "waitForEvent", event: "runtime:agent:engineer", timeoutMs: 120000 },
            { type: "waitForPlanStatus", planName: "plan", statuses: ["validated_ci"], timeoutMs: 90000 },
            { type: "sleep", ms: 1000 },
            { type: "captureProjectState", planNames: ["plan"] },
        ],
        assertions: [],
    },
    "validation-tree-semantic-reviewer-incomplete-pause",
    ["plan"],
    ["semantic:reviewer-incomplete-pause"],
);

// TODO: fix this. The composed scenario reaches a repaired semantic review where
// the Reviewer approves without mentioning the prior open finding. Validation
// currently publishes instead of visibly nudging for the omitted finding, so this
// scenario is disabled until that behavior is repaired.
export const validationTreeSemanticNudgeOmittedPriorFindingScenario = withValidationBranches(
    {
        ...plannedChangeReviewRepairValidationScenario,
        name: "validation-tree-semantic-nudge-omitted-prior-finding-base",
        script: [
            ...plannedChangeReviewRepairValidationScenario.script.slice(0, 4),
            {
                id: "semantic-reviewer-rejects-with-ledger-finding",
                agent: "reviewer",
                phase: "semantic_review",
                ordinal: 1,
                requiredTools: ["review_diff", "review_complete"],
                thinking: "Inspect the diff, then reject with a tracked finding.",
                toolCalls: [
                    { name: "review_diff", arguments: { command: "list" } },
                    {
                        name: "review_complete",
                        arguments: {
                            approved: false,
                            feedback: "Missing durable evidence.",
                            findings: [{
                                title: "Missing durable evidence",
                                requirement: "Plan",
                                evidence: "golden-planned-change.txt",
                            }],
                        },
                    },
                ],
            },
            ...plannedChangeReviewRepairValidationScenario.script.slice(5, 9),
            {
                id: "semantic-reviewer-omits-prior-finding-after-repair",
                agent: "reviewer",
                phase: "semantic_review",
                ordinal: 3,
                requiredTools: ["review_diff", "review_complete"],
                thinking: "Inspect the repair diff, then approve while omitting the existing open finding.",
                toolCalls: [
                    { name: "review_diff", arguments: { command: "list" } },
                    {
                        name: "review_complete",
                        arguments: { approved: true, feedback: "Approved but omitted prior finding.", findings: [] },
                    },
                ],
            },
            {
                id: "semantic-reviewer-accounts-for-prior-finding-after-nudge",
                agent: "reviewer",
                phase: "semantic_review",
                ordinal: 4,
                requiredTools: ["review_diff", "review_complete"],
                thinking: "Answer the nudge by accounting for the existing finding identity.",
                toolCalls: [
                    { name: "review_diff", arguments: { command: "list" } },
                    {
                        name: "review_complete",
                        arguments: {
                            approved: true,
                            feedback: "Approved after accounting for prior finding.",
                            findings: [{ id: "R1-1", resolved: true, title: "Missing durable evidence" }],
                        },
                    },
                ],
            },
            {
                id: "semantic-reviewer-closes-omitted-prior-finding-round",
                agent: "reviewer",
                phase: "semantic_review",
                ordinal: 5,
                text: "Reported the repaired finding after the omitted-finding nudge.",
            },
            plannedChangeReviewRepairValidationScenario.script[11],
        ],
        actions: [
            {
                type: "writeProjectFile",
                path: "docs/plans/plan.md",
                text:
                    "---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Golden PLANNED_CHANGE\naffectedPaths: []\nstatus: draft\n---\n# Golden PLANNED_CHANGE\n\nDraft content.\n",
            },
            { type: "type", text: "submit the planned change for review" },
            { type: "enter" },
            { type: "waitForPlanStatus", planName: "plan", statuses: ["verified"], timeoutMs: 180000 },
            { type: "assertWorkflowDurability" },
        ],
        assertions: [],
    },
    "validation-tree-semantic-nudge-omitted-prior-finding",
    ["plan"],
    ["semantic:nudge:omitted-prior-finding"],
);

export const validationTreeNonGitDeliveryScenario = withValidationBranches(
    plannedChangeNonGitInPlaceScenario,
    "validation-tree-non-git-delivery",
    ["non-git-plan"],
    ["semantic:entry:non-git-skip", "publication:non-git-success"],
);

export const validationTreeSemanticNudgeMissingReviewCompleteScenario = withValidationBranches(
    {
        name: "validation-tree-semantic-nudge-missing-review-complete-base",
        composedTui: true,
        initialAgentName: "guide",
        terminal: { columns: 100, rows: 30 },
        timeoutMs: 180000,
        committedProjectFiles: [
            { path: ".wld/settings.json", text: `${JSON.stringify({ verification_command: "true" }, null, 4)}\n` },
        ],
        initialProjectFiles: [{
            path: "docs/plans/semantic-nudge-missing-review-complete.md",
            text:
                '---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Semantic nudge missing review_complete\naffectedPaths: []\nstatus: ready_for_work\nplanId: semantic-nudge-missing-review-complete-plan\nobjectiveChecks:\n  - id: OC_NUDGE_REVIEW_COMPLETE\n    command: "true"\n---\n# Semantic nudge missing review_complete\n\nAlready implemented content.\n',
        }],
        script: [
            {
                id: "reviewer-stops-before-review-complete",
                agent: "reviewer",
                phase: "semantic_review",
                planName: "semantic-nudge-missing-review-complete",
                ordinal: 1,
                text: "I inspected the situation but did not call review_complete.",
            },
            {
                id: "reviewer-completes-after-review-complete-nudge",
                agent: "reviewer",
                phase: "semantic_review",
                planName: "semantic-nudge-missing-review-complete",
                ordinal: 2,
                requiredTools: ["review_diff", "review_complete"],
                toolCalls: [
                    { name: "review_diff", arguments: { command: "list" } },
                    {
                        name: "review_complete",
                        arguments: { approved: true, feedback: "Approved after review_complete nudge." },
                    },
                ],
            },
            {
                id: "reviewer-closes-semantic-nudge-missing-review-complete",
                agent: "reviewer",
                phase: "semantic_review",
                planName: "semantic-nudge-missing-review-complete",
                ordinal: 3,
                text: "Approved after missing-review-complete nudge.",
            },
        ],
        scriptedInteractions: [
            { type: "select", promptIncludes: "Plan recovery (validated_ci)", value: "validate" },
        ],
        actions: [
            {
                type: "seedActiveWorktree",
                planName: "semantic-nudge-missing-review-complete",
                status: "validated_ci",
                files: [{ path: "semantic-nudge-review-complete-implementation.txt", text: "implemented\n" }],
                attrs: { objectiveChecks: [{ id: "OC_NUDGE_REVIEW_COMPLETE", command: "true" }] },
            },
            { type: "type", text: "/load-plan semantic-nudge-missing-review-complete" },
            { type: "enter" },
            { type: "enter" },
            {
                type: "waitForPlanStatus",
                planName: "semantic-nudge-missing-review-complete",
                statuses: ["verified"],
                timeoutMs: 90000,
            },
        ],
        assertions: [],
    },
    "validation-tree-semantic-nudge-missing-review-complete",
    ["semantic-nudge-missing-review-complete"],
    ["semantic:nudge:missing-review-complete"],
);

export const validationTreeSemanticNudgeMissingDiffInspectionScenario = withValidationBranches(
    {
        name: "validation-tree-semantic-nudge-missing-diff-inspection-base",
        composedTui: true,
        initialAgentName: "guide",
        terminal: { columns: 100, rows: 30 },
        timeoutMs: 180000,
        committedProjectFiles: [
            { path: ".wld/settings.json", text: `${JSON.stringify({ verification_command: "true" }, null, 4)}\n` },
        ],
        initialProjectFiles: [{
            path: "docs/plans/semantic-nudge-missing-diff.md",
            text:
                '---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Semantic nudge missing diff\naffectedPaths: []\nstatus: ready_for_work\nplanId: semantic-nudge-missing-diff-plan\nobjectiveChecks:\n  - id: OC_NUDGE_DIFF\n    command: "true"\n---\n# Semantic nudge missing diff\n\nAlready implemented content.\n',
        }],
        script: [
            {
                id: "reviewer-decides-without-diff-inspection",
                agent: "reviewer",
                phase: "semantic_review",
                planName: "semantic-nudge-missing-diff",
                ordinal: 1,
                requiredTools: ["review_complete"],
                toolCalls: [{
                    name: "review_complete",
                    arguments: { approved: true, feedback: "Approved without inspecting diff." },
                }],
            },
            {
                id: "reviewer-approves-after-diff-inspection-nudge",
                agent: "reviewer",
                phase: "semantic_review",
                planName: "semantic-nudge-missing-diff",
                ordinal: 2,
                requiredTools: ["review_diff", "review_complete"],
                toolCalls: [
                    { name: "review_diff", arguments: { command: "list" } },
                    {
                        name: "review_complete",
                        arguments: { approved: true, feedback: "Approved after diff inspection." },
                    },
                ],
            },
            {
                id: "reviewer-closes-semantic-nudge-missing-diff",
                agent: "reviewer",
                phase: "semantic_review",
                planName: "semantic-nudge-missing-diff",
                ordinal: 3,
                text: "Approved after missing-diff nudge.",
            },
        ],
        scriptedInteractions: [
            { type: "select", promptIncludes: "Plan recovery (validated_ci)", value: "validate" },
        ],
        actions: [
            {
                type: "seedActiveWorktree",
                planName: "semantic-nudge-missing-diff",
                status: "validated_ci",
                files: [{ path: "semantic-nudge-implementation.txt", text: "implemented\n" }],
                attrs: { objectiveChecks: [{ id: "OC_NUDGE_DIFF", command: "true" }] },
            },
            { type: "type", text: "/load-plan semantic-nudge-missing-diff" },
            { type: "enter" },
            { type: "enter" },
            {
                type: "waitForPlanStatus",
                planName: "semantic-nudge-missing-diff",
                statuses: ["verified"],
                timeoutMs: 90000,
            },
        ],
        assertions: [],
    },
    "validation-tree-semantic-nudge-missing-diff-inspection",
    ["semantic-nudge-missing-diff"],
    ["semantic:nudge:missing-diff-inspection"],
);

export const validationTreeSemanticRoundLimitStopScenario = withValidationBranches(
    {
        name: "validation-tree-semantic-round-limit-stop-base",
        composedTui: true,
        initialAgentName: "guide",
        terminal: { columns: 100, rows: 30 },
        timeoutMs: 240000,
        committedProjectFiles: [
            { path: ".wld/settings.json", text: `${JSON.stringify({ verification_command: "true" }, null, 4)}\n` },
        ],
        initialProjectFiles: [{
            path: "docs/plans/semantic-round-limit-stop.md",
            text:
                '---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Semantic round limit stop\naffectedPaths: []\nstatus: ready_for_work\nplanId: semantic-round-limit-stop-plan\nobjectiveChecks:\n  - id: OC_SEMANTIC_ROUND_LIMIT_STOP\n    command: "true"\n---\n# Semantic round limit stop\n\nAlready implemented content.\n',
        }],
        script: [
            {
                id: "reviewer-rejects-semantic-round-limit-stop-1",
                agent: "reviewer",
                phase: "semantic_review",
                planName: "semantic-round-limit-stop",
                ordinal: 1,
                requiredTools: ["review_diff", "review_complete"],
                toolCalls: [
                    { name: "review_diff", arguments: { command: "list" } },
                    {
                        name: "review_complete",
                        arguments: {
                            approved: false,
                            feedback: "Round 1 still has open work.",
                            findings: [{
                                title: "Round-limit issue",
                                requirement: "Semantic review",
                                evidence: "The repair still needs verification.",
                            }],
                        },
                    },
                ],
            },
            {
                id: "engineer-repairs-semantic-round-limit-stop-1",
                agent: "engineer",
                phase: "engineer",
                planName: "semantic-round-limit-stop",
                ordinal: 1,
                requiredTools: ["write"],
                toolCalls: [{
                    name: "write",
                    arguments: { path: "semantic-round-limit-stop.txt", content: "repair 1\n" },
                }],
            },
            {
                id: "engineer-completes-semantic-round-limit-stop-1",
                agent: "engineer",
                phase: "engineer",
                planName: "semantic-round-limit-stop",
                ordinal: 2,
                requiredTools: ["task_completed"],
                toolCalls: [{ name: "task_completed", arguments: { message: "- Repaired semantic round 1." } }],
            },
            {
                id: "reviewer-closes-semantic-round-limit-stop-1",
                agent: "reviewer",
                phase: "semantic_review",
                planName: "semantic-round-limit-stop",
                ordinal: 2,
                text: "Reported semantic round 1 findings.",
            },
            {
                id: "reviewer-rejects-semantic-round-limit-stop-2",
                agent: "reviewer",
                phase: "semantic_review",
                planName: "semantic-round-limit-stop",
                ordinal: 3,
                requiredTools: ["review_diff", "review_complete"],
                toolCalls: [
                    { name: "review_diff", arguments: { command: "list" } },
                    {
                        name: "review_complete",
                        arguments: {
                            approved: false,
                            feedback: "Round 2 still has open work.",
                            findings: [{
                                id: "R1-1",
                                resolved: false,
                                title: "Round-limit issue",
                                requirement: "Semantic review",
                                evidence: "The issue remains after repair round 1.",
                            }],
                        },
                    },
                ],
            },
            {
                id: "engineer-repairs-semantic-round-limit-stop-2",
                agent: "engineer",
                phase: "engineer",
                planName: "semantic-round-limit-stop",
                ordinal: 3,
                requiredTools: ["write"],
                toolCalls: [{
                    name: "write",
                    arguments: { path: "semantic-round-limit-stop.txt", content: "repair 2\n" },
                }],
            },
            {
                id: "engineer-completes-semantic-round-limit-stop-2",
                agent: "engineer",
                phase: "engineer",
                planName: "semantic-round-limit-stop",
                ordinal: 4,
                requiredTools: ["task_completed"],
                toolCalls: [{ name: "task_completed", arguments: { message: "- Repaired semantic round 2." } }],
            },
            {
                id: "reviewer-closes-semantic-round-limit-stop-2",
                agent: "reviewer",
                phase: "semantic_review",
                planName: "semantic-round-limit-stop",
                ordinal: 4,
                text: "Reported semantic round 2 findings.",
            },
            {
                id: "reviewer-rejects-semantic-round-limit-stop-3",
                agent: "reviewer",
                phase: "semantic_review",
                planName: "semantic-round-limit-stop",
                ordinal: 5,
                requiredTools: ["review_diff", "review_complete"],
                toolCalls: [
                    { name: "review_diff", arguments: { command: "list" } },
                    {
                        name: "review_complete",
                        arguments: {
                            approved: false,
                            feedback: "Round 3 still has open work.",
                            findings: [{
                                id: "R1-1",
                                resolved: false,
                                title: "Round-limit issue",
                                requirement: "Semantic review",
                                evidence: "The issue remains after repair round 2.",
                            }],
                        },
                    },
                ],
            },
            {
                id: "reviewer-closes-semantic-round-limit-stop-3",
                agent: "reviewer",
                phase: "semantic_review",
                planName: "semantic-round-limit-stop",
                ordinal: 6,
                text: "Reported semantic round 3 findings.",
            },
            {
                id: "engineer-repairs-semantic-round-limit-stop-3",
                agent: "engineer",
                phase: "engineer",
                planName: "semantic-round-limit-stop",
                ordinal: 5,
                requiredTools: ["write"],
                toolCalls: [{
                    name: "write",
                    arguments: { path: "semantic-round-limit-stop.txt", content: "repair 3\n" },
                }],
            },
            {
                id: "engineer-completes-semantic-round-limit-stop-3",
                agent: "engineer",
                phase: "engineer",
                planName: "semantic-round-limit-stop",
                ordinal: 6,
                requiredTools: ["task_completed"],
                toolCalls: [{ name: "task_completed", arguments: { message: "- Repaired semantic round 3." } }],
            },
            {
                id: "reviewer-approves-semantic-round-limit-continue",
                agent: "reviewer",
                phase: "semantic_review",
                planName: "semantic-round-limit-stop",
                ordinal: 7,
                optional: true,
                requiredTools: ["review_diff", "review_complete"],
                toolCalls: [
                    { name: "review_diff", arguments: { command: "list" } },
                    {
                        name: "review_complete",
                        arguments: {
                            approved: true,
                            feedback: "Focused round-limit recheck approved.",
                            findings: [{ id: "R1-1", resolved: true, title: "Round-limit issue" }],
                        },
                    },
                ],
            },
            {
                id: "reviewer-closes-semantic-round-limit-continue",
                agent: "reviewer",
                phase: "semantic_review",
                planName: "semantic-round-limit-stop",
                ordinal: 8,
                optional: true,
                text: "Focused round-limit recheck complete.",
            },
        ],
        scriptedInteractions: [
            { type: "select", promptIncludes: "Plan recovery (validated_ci)", value: "validate" },
            { type: "select", promptIncludes: "Look once more, read it, or stop.", value: "stop" },
        ],
        actions: [
            {
                type: "seedActiveWorktree",
                planName: "semantic-round-limit-stop",
                status: "validated_ci",
                files: [{ path: "semantic-round-limit-stop.txt", text: "implemented\n" }],
                attrs: { objectiveChecks: [{ id: "OC_SEMANTIC_ROUND_LIMIT_STOP", command: "true" }] },
            },
            { type: "type", text: "/load-plan semantic-round-limit-stop" },
            { type: "enter" },
            { type: "enter" },
            { type: "waitForEventCount", event: "runtime:tool:start:task_completed", count: 3, timeoutMs: 90000 },
            { type: "waitForScreen", text: "Look once more, read it, or stop.", timeoutMs: 180000 },
            { type: "waitForEvent", event: "runtime:interaction_resolved", timeoutMs: 180000 },
            { type: "waitForIdle", timeoutMs: 180000 },
            { type: "captureProjectState", planNames: ["semantic-round-limit-stop"] },
        ],
        assertions: [],
    },
    "validation-tree-semantic-round-limit-stop",
    ["semantic-round-limit-stop"],
    ["semantic:round-limit:stop"],
);

// TODO: fix this. Seeding validationSemanticRounds=2 reaches semanticRound 3,
// but after the Engineer repair completes the visible TUI stops at Engineer
// without the round-limit prompt. The latest probe left the Plan implemented
// with a paused semantic checkpoint, and only the recovery prompt interaction
// was captured. Keep unowned until Stop is visible.
export const validationTreeSemanticRoundLimitStopDirectScenario = withValidationBranches(
    {
        name: "validation-tree-semantic-round-limit-stop-direct-base",
        composedTui: true,
        initialAgentName: "guide",
        terminal: { columns: 100, rows: 30 },
        timeoutMs: 180000,
        committedProjectFiles: [
            { path: ".wld/settings.json", text: `${JSON.stringify({ verification_command: "true" }, null, 4)}\n` },
        ],
        initialProjectFiles: [{
            path: "docs/plans/semantic-round-limit-stop-direct.md",
            text:
                '---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Semantic round limit stop direct\naffectedPaths: []\nstatus: ready_for_work\nplanId: semantic-round-limit-stop-direct-plan\nobjectiveChecks:\n  - id: OC_SEMANTIC_ROUND_LIMIT_STOP_DIRECT\n    command: "true"\n---\n# Semantic round limit stop direct\n\nDraft content.\n',
        }],
        script: [
            {
                id: "reviewer-rejects-semantic-round-limit-stop-direct",
                agent: "reviewer",
                phase: "semantic_review",
                planName: "semantic-round-limit-stop-direct",
                ordinal: 1,
                requiredTools: ["review_diff", "review_complete"],
                toolCalls: [
                    { name: "review_diff", arguments: { command: "list" } },
                    {
                        name: "review_complete",
                        arguments: { approved: false, feedback: "Round limit still has open work." },
                    },
                ],
            },
            {
                id: "engineer-repairs-semantic-round-limit-stop-direct",
                agent: "engineer",
                phase: "engineer",
                planName: "semantic-round-limit-stop-direct",
                ordinal: 1,
                requiredTools: ["write", "task_completed"],
                toolCalls: [
                    {
                        name: "write",
                        arguments: { path: "semantic-round-limit-stop-direct.txt", content: "repair\n" },
                    },
                    { name: "task_completed", arguments: { message: "- Repaired semantic round limit." } },
                ],
            },
            {
                id: "engineer-idle-semantic-round-limit-stop-direct",
                agent: "engineer",
                phase: "engineer",
                planName: "semantic-round-limit-stop-direct",
                ordinal: 2,
                text: "Semantic round-limit repair is ready for the Stop choice.",
            },
        ],
        scriptedInteractions: [
            { type: "select", promptIncludes: "Plan recovery (validated_ci)", value: "validate" },
            { type: "select", promptIncludes: "Look once more, read it, or stop.", value: "stop" },
        ],
        actions: [
            {
                type: "seedActiveWorktree",
                planName: "semantic-round-limit-stop-direct",
                status: "validated_ci",
                attrs: {
                    validationSemanticRounds: 2,
                    objectiveChecks: [{ id: "OC_SEMANTIC_ROUND_LIMIT_STOP_DIRECT", command: "true" }],
                },
                files: [{ path: "semantic-round-limit-stop-direct.txt", text: "implemented\n" }],
            },
            { type: "type", text: "/load-plan semantic-round-limit-stop-direct" },
            { type: "enter" },
            { type: "enter" },
            { type: "waitForEvent", event: "runtime:tool:start:review_complete", timeoutMs: 90000 },
            { type: "waitForEvent", event: "runtime:agent:engineer", timeoutMs: 90000 },
            { type: "type", text: "repair the semantic review feedback" },
            { type: "enter" },
            { type: "waitForEvent", event: "runtime:tool:start:task_completed", timeoutMs: 90000 },
            { type: "waitForIdle", timeoutMs: 120000 },
            { type: "captureProjectState", planNames: ["semantic-round-limit-stop-direct"] },
        ],
        assertions: [],
    },
    "validation-tree-semantic-round-limit-stop-direct",
    ["semantic-round-limit-stop-direct"],
    [],
);

export const validationTreeSemanticRoundLimitContinueScenario = {
    ...validationTreeSemanticRoundLimitStopScenario,
    name: "validation-tree-semantic-round-limit-continue",
    scriptedInteractions: [
        { type: "select", promptIncludes: "Plan recovery (validated_ci)", value: "validate" },
        { type: "select", promptIncludes: "Look once more, read it, or stop.", value: "continue" },
    ],
    actions: validationTreeSemanticRoundLimitStopScenario.actions.flatMap((action: { type?: string }) =>
        action.type === "captureProjectState"
            ? [
                {
                    type: "waitForPlanStatus",
                    planName: "semantic-round-limit-stop",
                    statuses: ["verified"],
                    timeoutMs: 180000,
                },
                action,
            ]
            : [action]
    ),
    validationBranches: ["semantic:round-limit:continue"],
    assertions: [validationEvidenceAssertion("semantic:round-limit:continue")],
};

export const validationTreeSemanticRoundLimitHumanReviewScenario = {
    ...validationTreeSemanticRoundLimitStopScenario,
    name: "validation-tree-semantic-round-limit-human-review",
    scriptedInteractions: [
        { type: "select", promptIncludes: "Plan recovery (validated_ci)", value: "validate" },
        { type: "select", promptIncludes: "Look once more, read it, or stop.", value: "code_review" },
    ],
    humanReviewDecisions: [{ approved: true, feedback: "Human approved after reading the repaired changes." }],
    actions: validationTreeSemanticRoundLimitStopScenario.actions.flatMap((action: { type?: string }) =>
        action.type === "captureProjectState"
            ? [
                { type: "waitForEvent", event: "human-review:captured", timeoutMs: 30000 },
                {
                    type: "waitForPlanStatus",
                    planName: "semantic-round-limit-stop",
                    statuses: ["verified"],
                    timeoutMs: 180000,
                },
                action,
            ]
            : [action]
    ),
    validationBranches: ["semantic:round-limit:human-review"],
    assertions: [validationEvidenceAssertion("semantic:round-limit:human-review")],
};

// TODO: fix this. Attempting to seed an OPERATION validated_ci Plan through
// `/load-plan` normalizes the workflow to PLANNED_CHANGE and proves the
// Plan-only diff failure instead of the empty-diff skip branch. Keep unowned.
export const validationTreeEmptyDiffSkipScenario = withValidationBranches(
    {
        name: "validation-tree-empty-diff-skip-base",
        composedTui: true,
        initialAgentName: "guide",
        terminal: { columns: 100, rows: 30 },
        timeoutMs: 180000,
        committedProjectFiles: [
            { path: ".wld/settings.json", text: `${JSON.stringify({ verification_command: "true" }, null, 4)}\n` },
        ],
        initialProjectFiles: [{
            path: "docs/plans/empty-diff-skip.md",
            text:
                '---\nclassification: OPERATION\ncomplexity: LOW\nsummary: Empty diff skip\naffectedPaths: []\nstatus: ready_for_work\nplanId: empty-diff-skip-plan\nobjectiveChecks:\n  - id: OC_EMPTY_DIFF\n    command: "true"\n---\n# Empty diff skip\n\nAlready complete content.\n',
        }],
        scriptedInteractions: [{ type: "select", promptIncludes: "Plan recovery (validated_ci)", value: "validate" }],
        actions: [
            {
                type: "seedActiveWorktree",
                planName: "empty-diff-skip",
                status: "validated_ci",
                attrs: {
                    classification: "OPERATION",
                    objectiveChecks: [{ id: "OC_EMPTY_DIFF", command: "true" }],
                },
            },
            { type: "type", text: "/load-plan empty-diff-skip" },
            { type: "enter" },
            { type: "enter" },
            { type: "waitForPlanStatus", planName: "empty-diff-skip", statuses: ["verified"], timeoutMs: 90000 },
        ],
        assertions: [],
    },
    "validation-tree-empty-diff-skip",
    ["empty-diff-skip"],
    ["semantic:entry:empty-diff-skip"],
);

export const validationTreeSemanticRoundModeDiscoveryToVerifyScenario = withValidationBranches(
    {
        name: "validation-tree-semantic-round-mode-discovery-to-verify-base",
        composedTui: true,
        initialAgentName: "guide",
        terminal: { columns: 100, rows: 30 },
        timeoutMs: 180000,
        committedProjectFiles: [
            { path: ".wld/settings.json", text: `${JSON.stringify({ verification_command: "true" }, null, 4)}\n` },
        ],
        initialProjectFiles: [{
            path: "docs/plans/semantic-round-mode-discovery-to-verify.md",
            text:
                "---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Semantic round mode discovery to verify\naffectedPaths: []\nstatus: ready_for_work\nplanId: semantic-round-mode-discovery-to-verify-plan\nobjectiveChecks:\n  - id: OC_SEMANTIC_VERIFY_MODE\n    command: test -f semantic-round-mode-discovery-to-verify.txt\n---\n# Semantic round mode discovery to verify\n\nDraft content.\n",
        }],
        script: [
            {
                id: "reviewer-approves-verify-mode-round",
                agent: "reviewer",
                phase: "semantic_review",
                planName: "semantic-round-mode-discovery-to-verify",
                ordinal: 1,
                requiredTools: ["review_diff", "review_complete"],
                toolCalls: [
                    { name: "review_diff", arguments: { command: "list" } },
                    {
                        name: "review_complete",
                        arguments: { approved: true, feedback: "Focused verification approved." },
                    },
                ],
            },
            {
                id: "reviewer-closes-verify-mode-round",
                agent: "reviewer",
                phase: "semantic_review",
                planName: "semantic-round-mode-discovery-to-verify",
                ordinal: 2,
                text: "Approved the focused verification round.",
            },
        ],
        scriptedInteractions: [{ type: "select", promptIncludes: "Plan recovery (validated_ci)", value: "validate" }],
        actions: [
            {
                type: "seedActiveWorktree",
                planName: "semantic-round-mode-discovery-to-verify",
                status: "validated_ci",
                attrs: { validationSemanticRounds: 2 },
                files: [{ path: "semantic-round-mode-discovery-to-verify.txt", text: "done\n" }],
            },
            { type: "type", text: "/load-plan semantic-round-mode-discovery-to-verify" },
            { type: "enter" },
            { type: "enter" },
            { type: "waitForEvent", event: "runtime:tool:start:review_diff", timeoutMs: 90000 },
            {
                type: "waitForPlanStatus",
                planName: "semantic-round-mode-discovery-to-verify",
                statuses: ["verified"],
                timeoutMs: 120000,
            },
        ],
        assertions: [],
    },
    "validation-tree-semantic-round-mode-discovery-to-verify",
    ["semantic-round-mode-discovery-to-verify"],
    ["semantic:round-mode:discovery-to-verify"],
);

export const validationTreePlanOnlyDiffFailsScenario = withValidationBranches(
    {
        name: "validation-tree-plan-only-diff-fails-base",
        composedTui: true,
        initialAgentName: "guide",
        terminal: { columns: 100, rows: 30 },
        timeoutMs: 180000,
        committedProjectFiles: [
            { path: ".wld/settings.json", text: `${JSON.stringify({ verification_command: "true" }, null, 4)}\n` },
        ],
        initialProjectFiles: [{
            path: "docs/plans/plan-only-diff.md",
            text:
                '---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Plan only diff\naffectedPaths: []\nstatus: ready_for_work\nplanId: plan-only-diff-plan\nobjectiveChecks:\n  - id: OC_PLAN_ONLY\n    command: "true"\n---\n# Plan only diff\n\nDraft content.\n',
        }],
        scriptedInteractions: [{ type: "select", promptIncludes: "Plan recovery (validated_ci)", value: "validate" }],
        actions: [
            { type: "seedActiveWorktree", planName: "plan-only-diff", status: "validated_ci" },
            { type: "type", text: "/load-plan plan-only-diff" },
            { type: "enter" },
            { type: "enter" },
            { type: "waitForPlanStatus", planName: "plan-only-diff", statuses: ["implemented"], timeoutMs: 90000 },
        ],
        assertions: [],
    },
    "validation-tree-plan-only-diff-fails",
    ["plan-only-diff"],
    ["semantic:entry:plan-only-diff-fails"],
);

export const validationWorkflowSemanticScenarios = [
    validationTreeSemanticReviewLoopScenario,
    validationTreeSemanticRepairIncompleteScenario,
    validationTreeSemanticReviewerIncompletePauseScenario,
    validationTreeSemanticNudgeOmittedPriorFindingScenario,
    validationTreeSemanticRoundModeDiscoveryToVerifyScenario,
    validationTreeSemanticNudgeMissingReviewCompleteScenario,
    validationTreeSemanticNudgeMissingDiffInspectionScenario,
    validationTreeSemanticRoundLimitContinueScenario,
    validationTreeSemanticRoundLimitHumanReviewScenario,
    validationTreeSemanticRoundLimitStopScenario,
    validationTreeEmptyDiffSkipScenario,
    validationTreeNonGitDeliveryScenario,
    validationTreePlanOnlyDiffFailsScenario,
];
