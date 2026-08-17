import { assertEquals } from "@std/assert";
import { getCwd } from "../../../constants.js";
import { git } from "../../../shared/worktree-test-helpers.js";
import { plannedChangeBlockedMergePauseScenario } from "./planned-change-workflow.js";
import { withValidationBranches } from "./validation-workflow-tree-shared.ts";

type DirtyStopResumeResult = {
    state: {
        scriptedInteractions?: Array<{
            interaction?: { value?: string };
        }>;
    };
};

export const validationTreePublicationDirtyCheckoutScenario = withValidationBranches(
    plannedChangeBlockedMergePauseScenario,
    "validation-tree-publication-dirty-checkout",
    ["plan"],
    ["publication:dirty-retry", "publication:direct-success"],
);

export const validationTreePublicationDirtyStopResumeScenario = withValidationBranches(
    {
        ...plannedChangeBlockedMergePauseScenario,
        name: "validation-tree-publication-dirty-stop-resume-base",
        scriptedInteractions: [
            { type: "text", promptIncludes: "Enter the command that runs this project's tests", value: "true" },
            {
                type: "select",
                promptIncludes: "have not saved to git yet",
                userFixesFirst: {
                    path: "golden-planned-change.txt",
                    text: "committed baseline\n",
                    commands: ["git checkout -- golden-planned-change.txt"],
                },
                value: "stop",
            },
            { type: "select", promptIncludes: "Plan recovery (validated_reviewer)", value: "validate" },
        ],
        actions: [
            {
                type: "writeProjectFile",
                path: "docs/plans/plan.md",
                text:
                    "---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Golden PLANNED_CHANGE\naffectedPaths: []\nstatus: draft\n---\n# Golden PLANNED_CHANGE\n\nDraft content.\n",
            },
            { type: "writeProjectFile", path: "golden-planned-change.txt", text: "my own unsaved edit\n" },
            { type: "type", text: "submit the planned change for review" },
            { type: "enter" },
            { type: "waitForPlanStatus", planName: "plan", statuses: ["validated_reviewer"], timeoutMs: 240000 },
            { type: "sleep", ms: 1000 },
            { type: "type", text: "/load-plan plan" },
            { type: "enter" },
            { type: "enter" },
            { type: "waitForPlanStatus", planName: "plan", statuses: ["verified"], timeoutMs: 180000 },
            { type: "assertWorkflowDurability" },
        ],
        assertions: [
            (result: DirtyStopResumeResult) => {
                const interactions = result.state.scriptedInteractions || [];
                assertEquals(interactions[1]?.interaction?.value, "stop");
                assertEquals(interactions[2]?.interaction?.value, "validate");
            },
        ],
    },
    "validation-tree-publication-dirty-stop-resume",
    ["plan"],
    ["publication:dirty-stop-resume"],
);

export const validationTreePublicationMissingTargetBranchScenario = withValidationBranches(
    {
        name: "validation-tree-publication-missing-target-branch-base",
        composedTui: true,
        initialAgentName: "guide",
        terminal: { columns: 100, rows: 30 },
        timeoutMs: 120000,
        committedProjectFiles: [
            { path: ".wld/settings.json", text: `${JSON.stringify({ verification_command: "true" }, null, 4)}\n` },
        ],
        initialProjectFiles: [{
            path: "docs/plans/publication-missing-target-branch.md",
            text:
                "---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Publication missing target branch\naffectedPaths: []\nstatus: ready_for_work\nplanId: publication-missing-target-branch-plan\nobjectiveChecks:\n  - id: OC_PUBLICATION_MISSING_TARGET\n    command: test -f publication-missing-target-branch.txt\n---\n# Publication missing target branch\n\nDraft content.\n",
        }],
        scriptedInteractions: [{
            type: "select",
            promptIncludes: "Plan recovery (validated_reviewer)",
            value: "validate",
        }],
        actions: [
            {
                type: "seedActiveWorktree",
                planName: "publication-missing-target-branch",
                status: "validated_reviewer",
                attrs: { humanReviewMode: "none", humanReviewDecision: "not_required" },
                files: [{ path: "publication-missing-target-branch.txt", text: "done\n" }],
            },
            { type: "deletePlanWorktreeBaseBranch", planName: "publication-missing-target-branch" },
            { type: "type", text: "/load-plan publication-missing-target-branch" },
            { type: "enter" },
            { type: "enter" },
            { type: "sleep", ms: 1000 },
            {
                type: "waitForPlanStatus",
                planName: "publication-missing-target-branch",
                statuses: ["validated_reviewer"],
                timeoutMs: 30000,
            },
            { type: "captureProjectState", planNames: ["publication-missing-target-branch"] },
        ],
        assertions: [],
    },
    "validation-tree-publication-missing-target-branch",
    ["publication-missing-target-branch"],
    ["publication:missing-target-branch"],
);

export const validationTreePublicationMergeConflictRepairCompletedScenario = withValidationBranches(
    {
        name: "validation-tree-publication-merge-conflict-repair-completed-base",
        composedTui: true,
        initialAgentName: "guide",
        terminal: { columns: 100, rows: 30 },
        timeoutMs: 180000,
        committedProjectFiles: [
            { path: ".wld/settings.json", text: `${JSON.stringify({ verification_command: "true" }, null, 4)}\n` },
        ],
        initialProjectFiles: [{
            path: "docs/plans/publication-merge-conflict-repair-completed.md",
            text:
                "---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Publication merge conflict repair completed\naffectedPaths: []\nstatus: ready_for_work\nplanId: publication-merge-conflict-repair-completed-plan\nobjectiveChecks:\n  - id: OC_PUBLICATION_MERGE_REPAIR\n    command: test -f publication-merge-conflict.txt\n---\n# Publication merge conflict repair completed\n\nDraft content.\n",
        }],
        script: [
            {
                id: "engineer-repairs-publication-merge-conflict",
                agent: "engineer",
                phase: "engineer",
                planName: "publication-merge-conflict-repair-completed",
                ordinal: 1,
                requiredTools: ["bash", "task_completed"],
                toolCalls: [
                    {
                        name: "bash",
                        arguments: {
                            command:
                                "printf 'repaired version\n' > publication-merge-conflict.txt\ngit add publication-merge-conflict.txt\ngit commit -m 'repair publication merge conflict'",
                        },
                    },
                    { name: "task_completed", arguments: { message: "- Repaired publication merge conflict." } },
                ],
            },
        ],
        scriptedInteractions: [{
            type: "select",
            promptIncludes: "Plan recovery (validated_reviewer)",
            value: "validate",
        }],
        actions: [
            {
                type: "seedActiveWorktree",
                planName: "publication-merge-conflict-repair-completed",
                status: "validated_reviewer",
                attrs: { humanReviewMode: "none", humanReviewDecision: "not_required" },
                files: [{ path: "publication-merge-conflict.txt", text: "worktree version\n" }],
            },
            {
                type: "commitPlanWorktreeBaseBranchFile",
                planName: "publication-merge-conflict-repair-completed",
                path: "publication-merge-conflict.txt",
                text: "target version\n",
            },
            { type: "type", text: "/load-plan publication-merge-conflict-repair-completed" },
            { type: "enter" },
            { type: "enter" },
            {
                type: "waitForPlanStatus",
                planName: "publication-merge-conflict-repair-completed",
                statuses: ["verified"],
                timeoutMs: 120000,
            },
            { type: "waitForIdle", timeoutMs: 120000 },
            { type: "captureProjectState", planNames: ["publication-merge-conflict-repair-completed"] },
        ],
        assertions: [
            async () => {
                assertEquals(
                    (await git(getCwd(), ["show", "main:publication-merge-conflict.txt"])).trim(),
                    "repaired version",
                );
            },
        ],
    },
    "validation-tree-publication-merge-conflict-repair-completed",
    ["publication-merge-conflict-repair-completed"],
    ["publication:merge-conflict-repair-completed"],
);

export const validationTreePublicationMergeConflictRepairIncompleteRetryScenario = withValidationBranches(
    {
        name: "validation-tree-publication-merge-conflict-repair-incomplete-retry-base",
        composedTui: true,
        initialAgentName: "guide",
        terminal: { columns: 100, rows: 30 },
        timeoutMs: 180000,
        committedProjectFiles: [
            { path: ".wld/settings.json", text: `${JSON.stringify({ verification_command: "true" }, null, 4)}\n` },
        ],
        initialProjectFiles: [{
            path: "docs/plans/publication-merge-conflict-repair-incomplete-retry.md",
            text:
                "---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Publication merge conflict repair incomplete retry\naffectedPaths: []\nstatus: ready_for_work\nplanId: publication-merge-conflict-repair-incomplete-retry-plan\nobjectiveChecks:\n  - id: OC_PUBLICATION_MERGE_RETRY\n    command: test -f publication-merge-conflict-retry.txt\n---\n# Publication merge conflict repair incomplete retry\n\nDraft content.\n",
        }],
        script: [1, 2, 3].map((ordinal) => ({
            id: `engineer-leaves-publication-merge-conflict-retry-incomplete-${ordinal}`,
            agent: "engineer",
            phase: "engineer",
            planName: "publication-merge-conflict-repair-incomplete-retry",
            ordinal,
            text: `Merge repair attempt ${ordinal} did not call task_completed before user retry.`,
        })),
        scriptedInteractions: [
            {
                type: "select",
                promptIncludes: "Plan recovery (validated_reviewer)",
                value: "validate",
            },
            {
                type: "select",
                promptIncludes: "could not combine",
                userFixesFirst: {
                    path: "publication-merge-conflict-retry.txt",
                    text: "resolved version\n",
                    commands: ["git add publication-merge-conflict-retry.txt"],
                },
                value: "retry",
            },
        ],
        actions: [
            {
                type: "seedActiveWorktree",
                planName: "publication-merge-conflict-repair-incomplete-retry",
                status: "validated_reviewer",
                attrs: { humanReviewMode: "none", humanReviewDecision: "not_required" },
                files: [{ path: "publication-merge-conflict-retry.txt", text: "worktree version\n" }],
            },
            {
                type: "commitPlanWorktreeBaseBranchFile",
                planName: "publication-merge-conflict-repair-incomplete-retry",
                path: "publication-merge-conflict-retry.txt",
                text: "target version\n",
            },
            { type: "type", text: "/load-plan publication-merge-conflict-repair-incomplete-retry" },
            { type: "enter" },
            { type: "enter" },
            {
                type: "waitForPlanStatus",
                planName: "publication-merge-conflict-repair-incomplete-retry",
                statuses: ["verified"],
                timeoutMs: 120000,
            },
        ],
        assertions: [
            async () => {
                assertEquals(
                    (await git(getCwd(), ["show", "main:publication-merge-conflict-retry.txt"])).trim(),
                    "resolved version",
                );
            },
        ],
    },
    "validation-tree-publication-merge-conflict-repair-incomplete-retry",
    ["publication-merge-conflict-repair-incomplete-retry"],
    ["publication:merge-conflict-repair-incomplete-retry"],
);

export const validationTreePublicationMergeConflictRepairIncompleteStopScenario = withValidationBranches(
    {
        name: "validation-tree-publication-merge-conflict-repair-incomplete-stop-base",
        composedTui: true,
        initialAgentName: "guide",
        terminal: { columns: 100, rows: 30 },
        timeoutMs: 120000,
        committedProjectFiles: [
            { path: ".wld/settings.json", text: `${JSON.stringify({ verification_command: "true" }, null, 4)}\n` },
        ],
        initialProjectFiles: [{
            path: "docs/plans/publication-merge-conflict-repair-incomplete-stop.md",
            text:
                "---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Publication merge conflict repair incomplete stop\naffectedPaths: []\nstatus: ready_for_work\nplanId: publication-merge-conflict-repair-incomplete-stop-plan\nobjectiveChecks:\n  - id: OC_PUBLICATION_MERGE_STOP\n    command: test -f publication-merge-conflict-stop.txt\n---\n# Publication merge conflict repair incomplete stop\n\nDraft content.\n",
        }],
        script: [1, 2, 3].map((ordinal) => ({
            id: `engineer-leaves-publication-merge-conflict-incomplete-${ordinal}`,
            agent: "engineer",
            phase: "engineer",
            planName: "publication-merge-conflict-repair-incomplete-stop",
            ordinal,
            text: `Merge repair attempt ${ordinal} did not call task_completed.`,
        })),
        scriptedInteractions: [
            {
                type: "select",
                promptIncludes: "Plan recovery (validated_reviewer)",
                value: "validate",
            },
            { type: "select", promptIncludes: "could not combine", value: "stop" },
        ],
        actions: [
            {
                type: "seedActiveWorktree",
                planName: "publication-merge-conflict-repair-incomplete-stop",
                status: "validated_reviewer",
                attrs: { humanReviewMode: "none", humanReviewDecision: "not_required" },
                files: [{ path: "publication-merge-conflict-stop.txt", text: "worktree version\n" }],
            },
            {
                type: "commitPlanWorktreeBaseBranchFile",
                planName: "publication-merge-conflict-repair-incomplete-stop",
                path: "publication-merge-conflict-stop.txt",
                text: "target version\n",
            },
            { type: "type", text: "/load-plan publication-merge-conflict-repair-incomplete-stop" },
            { type: "enter" },
            { type: "enter" },
            {
                type: "waitForPlanStatus",
                planName: "publication-merge-conflict-repair-incomplete-stop",
                statuses: ["validated_reviewer"],
                timeoutMs: 90000,
            },
            { type: "sleep", ms: 1000 },
            { type: "captureProjectState", planNames: ["publication-merge-conflict-repair-incomplete-stop"] },
        ],
        assertions: [],
    },
    "validation-tree-publication-merge-conflict-repair-incomplete-stop",
    ["publication-merge-conflict-repair-incomplete-stop"],
    ["publication:merge-conflict-repair-incomplete-stop"],
);

// A stale merge-repair path is discarded before publication. The normal merge
// then proves the validated execution copy is still safe and publishable.
export const validationTreePublicationStaleRepairWorktreeScenario = withValidationBranches(
    {
        name: "validation-tree-publication-stale-repair-worktree-base",
        composedTui: true,
        initialAgentName: "guide",
        terminal: { columns: 100, rows: 30 },
        timeoutMs: 120000,
        committedProjectFiles: [
            { path: ".wld/settings.json", text: `${JSON.stringify({ verification_command: "true" }, null, 4)}\n` },
        ],
        initialProjectFiles: [{
            path: "docs/plans/publication-stale-repair-worktree.md",
            text:
                "---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Publication stale repair worktree\naffectedPaths: []\nstatus: ready_for_work\nplanId: publication-stale-repair-worktree-plan\nobjectiveChecks:\n  - id: OC_PUBLICATION_STALE_REPAIR\n    command: test -f publication-stale-repair-worktree.txt\n---\n# Publication stale repair worktree\n\nDraft content.\n",
        }],
        scriptedInteractions: [{
            type: "select",
            promptIncludes: "Plan recovery (validated_reviewer)",
            value: "validate",
        }],
        actions: [
            {
                type: "seedActiveWorktree",
                planName: "publication-stale-repair-worktree",
                status: "validated_reviewer",
                attrs: {
                    humanReviewMode: "none",
                    humanReviewDecision: "not_required",
                    validationMergeRepairWorktree: "/tmp/missing-runwield-merge",
                },
                files: [{ path: "publication-stale-repair-worktree.txt", text: "done\n" }],
            },
            { type: "type", text: "/load-plan publication-stale-repair-worktree" },
            { type: "enter" },
            { type: "enter" },
            { type: "sleep", ms: 1000 },
            { type: "captureProjectState", planNames: ["publication-stale-repair-worktree"] },
        ],
        assertions: [],
    },
    "validation-tree-publication-stale-repair-worktree",
    ["publication-stale-repair-worktree"],
    ["publication:stale-repair-worktree"],
);

export const validationTreePublicationGenericGitFailureScenario = withValidationBranches(
    {
        name: "validation-tree-publication-generic-git-failure-base",
        composedTui: true,
        initialAgentName: "guide",
        terminal: { columns: 100, rows: 30 },
        timeoutMs: 120000,
        committedProjectFiles: [
            { path: ".wld/settings.json", text: `${JSON.stringify({ verification_command: "true" }, null, 4)}\n` },
        ],
        initialProjectFiles: [{
            path: "docs/plans/publication-generic-git-failure.md",
            text:
                "---\nclassification: PLANNED_CHANGE\ncomplexity: LOW\nsummary: Publication generic git failure\naffectedPaths: []\nstatus: ready_for_work\nplanId: publication-generic-git-failure-plan\nobjectiveChecks:\n  - id: OC_PUBLICATION_GENERIC_FAILURE\n    command: test -f publication-generic-git-failure.txt\n---\n# Publication generic git failure\n\nDraft content.\n",
        }],
        script: [1, 2, 3].map((ordinal) => ({
            id: `engineer-cannot-repair-generic-publication-failure-${ordinal}`,
            agent: "engineer",
            phase: "engineer",
            planName: "publication-generic-git-failure",
            ordinal,
            text: `Publication repair attempt ${ordinal} did not call task_completed.`,
        })),
        scriptedInteractions: [
            {
                type: "select",
                promptIncludes: "Plan recovery (validated_reviewer)",
                value: "validate",
            },
            { type: "select", promptIncludes: "could not add", value: "stop" },
        ],
        actions: [
            {
                type: "seedActiveWorktree",
                planName: "publication-generic-git-failure",
                status: "validated_reviewer",
                attrs: {
                    humanReviewMode: "none",
                    humanReviewDecision: "not_required",
                },
                files: [{ path: "publication-generic-git-failure.txt", text: "done\n" }],
            },
            {
                type: "installPlanWorktreeFailingPreCommitHook",
                planName: "publication-generic-git-failure",
            },
            { type: "type", text: "/load-plan publication-generic-git-failure" },
            { type: "enter" },
            { type: "enter" },
            { type: "sleep", ms: 1000 },
            {
                type: "waitForPlanStatus",
                planName: "publication-generic-git-failure",
                statuses: ["validated_reviewer"],
                timeoutMs: 30000,
            },
            { type: "captureProjectState", planNames: ["publication-generic-git-failure"] },
        ],
        assertions: [],
    },
    "validation-tree-publication-generic-git-failure",
    ["publication-generic-git-failure"],
    ["publication:generic-git-failure"],
);

export const validationWorkflowPublicationScenarios = [
    validationTreePublicationDirtyCheckoutScenario,
    validationTreePublicationDirtyStopResumeScenario,
    validationTreePublicationMergeConflictRepairCompletedScenario,
    validationTreePublicationMergeConflictRepairIncompleteRetryScenario,
    validationTreePublicationMergeConflictRepairIncompleteStopScenario,
    validationTreePublicationMissingTargetBranchScenario,
    validationTreePublicationStaleRepairWorktreeScenario,
    validationTreePublicationGenericGitFailureScenario,
];
