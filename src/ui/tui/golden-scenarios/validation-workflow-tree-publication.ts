import { assert, assertEquals } from "@std/assert";
import { assertsGoldenCoverage } from "../testing/portfolio-assertions.js";
import { withValidationBranches } from "./validation-workflow-tree-shared.ts";

type PublicationState = {
    scrollbackText?: string;
    screenText?: string;
    state: {
        publicationBaseline?: {
            head?: string;
            branch?: string;
            status?: string;
            files?: Record<string, string | null>;
        };
        publication?: {
            primaryHead?: string;
            primaryBranch?: string;
            primaryStatus?: string;
            primaryFiles?: Record<string, string | null>;
            remoteHead?: string;
            remotePlanStatus?: string;
            remotePlanAttrs?: { worktreeId?: string };
            remoteTree?: string;
            deliveredText?: string;
            registryEntries?: Array<{ status?: string }>;
            worktreeBranchExists?: boolean;
        };
        pendingPublication?: {
            registryStatus?: string;
            executionPlanStatus?: string;
            worktreeExists?: boolean;
            branchExists?: boolean;
            primaryHead?: string;
            primaryStatus?: string;
            primaryFiles?: Record<string, string | null>;
        };
        localPublication?: {
            head?: string;
            branch?: string;
            status?: string;
            files?: Record<string, string | null>;
            planStatus?: string;
            deliveredText?: string;
            registryEntries?: Array<{ status?: string }>;
        };
    };
};

function publicationPlan(planName: string, deliveredPath: string): string {
    return `---
classification: PLANNED_CHANGE
complexity: LOW
summary: ${planName}
affectedPaths: []
status: ready_for_work
planId: ${planName}-plan
objectiveChecks:
  - id: OC_${planName.replaceAll("-", "_").toUpperCase()}
    command: test -f ${deliveredPath}
---
# ${planName}

Golden isolated publication fixture.
`;
}

function assertPublishedWithoutPrimaryMutation(result: PublicationState, deliveredText: string): void {
    const baseline = result.state.publicationBaseline;
    const published = result.state.publication;
    assert(baseline, "Expected a primary-checkout baseline before publication.");
    assert(published, "Expected published remote state.");
    assertEquals(published.primaryHead, baseline.head);
    assertEquals(published.primaryBranch, baseline.branch);
    assertEquals(published.primaryStatus, baseline.status);
    assertEquals(published.primaryFiles, baseline.files);
    assertEquals(published.remotePlanStatus, "validated");
    assertEquals(published.remotePlanAttrs?.worktreeId, undefined);
    assertEquals(published.deliveredText, deliveredText);
    assert(String(published.remoteTree || "").includes("docs/work-records/"), "Expected a published Work Record.");
    assertEquals(published.registryEntries, []);
    assertEquals(published.worktreeBranchExists, false);
    assert(published.remoteHead !== baseline.head, "Expected publication to advance only the upstream target.");
}

function isolatedPublicationScenario(
    name: string,
    options: { advanceRemote?: boolean } = {},
) {
    const deliveredPath = `${name}.txt`;
    const deliveredText = `delivered ${name}`;
    return withValidationBranches(
        {
            name: `${name}-base`,
            composedTui: true,
            initialAgentName: "guide",
            terminal: { columns: 100, rows: 30 },
            timeoutMs: 120000,
            committedProjectFiles: [
                { path: ".wld/settings.json", text: `${JSON.stringify({ verification_command: "true" }, null, 4)}\n` },
                { path: "user-work.txt", text: "committed user work\n" },
                { path: `docs/plans/${name}.md`, text: publicationPlan(name, deliveredPath) },
            ],
            initialProjectFiles: [],
            scriptedInteractions: [{ type: "select", promptIncludes: "Plan recovery", value: "validate" }],
            actions: [
                {
                    type: "seedActiveWorktree",
                    planName: name,
                    status: "validated_reviewer",
                    attrs: { humanReviewMode: "none", humanReviewDecision: "not_required" },
                    files: [{ path: deliveredPath, text: `${deliveredText}\n` }],
                },
                { type: "writeProjectFile", path: "user-work.txt", text: "unsaved user work\n" },
                { type: "writeProjectFile", path: "untracked-user-note.txt", text: "leave me alone\n" },
                {
                    type: "capturePublicationBaseline",
                    paths: ["user-work.txt", "untracked-user-note.txt", `docs/plans/${name}.md`],
                },
                ...(options.advanceRemote
                    ? [{
                        type: "advancePlanRemoteTarget",
                        planName: name,
                        path: "concurrent-remote-change.txt",
                        text: "remote work landed first\n",
                    }]
                    : []),
                { type: "type", text: `/load-plan ${name}` },
                { type: "enter" },
                { type: "enter" },
                { type: "waitForRemotePlanStatus", planName: name, statuses: ["validated"], timeoutMs: 90000 },
                { type: "waitForWorktreeRegistryStatus", planName: name, statuses: ["absent"], timeoutMs: 90000 },
                { type: "waitForIdle", timeoutMs: 90000 },
                { type: "capturePublicationState", planName: name, deliveredPath },
            ],
            assertions: [
                (result: PublicationState) => {
                    assertPublishedWithoutPrimaryMutation(result, deliveredText);
                    if (options.advanceRemote) {
                        assert(
                            String(result.state.publication?.remoteTree || "").includes("concurrent-remote-change.txt"),
                            "Expected the newer upstream commit to survive publication.",
                        );
                    }
                },
            ],
        },
        name,
        [name],
        [options.advanceRemote ? "publication:remote-target-advance" : "publication:isolated-dirty-primary"],
    );
}

export const validationTreePublicationIsolatedDirtyPrimaryScenario = isolatedPublicationScenario(
    "validation-tree-publication-isolated-dirty-primary",
);

export const validationTreePublicationRemoteTargetAdvanceScenario = isolatedPublicationScenario(
    "validation-tree-publication-remote-target-advance",
    { advanceRemote: true },
);

const localPublicationPlanName = "validation-tree-publication-local-only";

export const validationTreePublicationLocalOnlyScenario = withValidationBranches(
    {
        name: `${localPublicationPlanName}-base`,
        composedTui: true,
        initialAgentName: "guide",
        terminal: { columns: 100, rows: 30 },
        timeoutMs: 120000,
        committedProjectFiles: [
            { path: ".wld/settings.json", text: `${JSON.stringify({ verification_command: "true" }, null, 4)}\n` },
            {
                path: `docs/plans/${localPublicationPlanName}.md`,
                text: publicationPlan(localPublicationPlanName, "local-publication.txt"),
            },
        ],
        initialProjectFiles: [],
        scriptedInteractions: [{ type: "select", promptIncludes: "Plan recovery", value: "validate" }],
        actions: [
            {
                type: "seedActiveWorktree",
                planName: localPublicationPlanName,
                status: "validated_reviewer",
                attrs: { humanReviewMode: "none", humanReviewDecision: "not_required" },
                files: [{ path: "local-publication.txt", text: "local-only delivery\n" }],
            },
            { type: "removePlanRemote", planName: localPublicationPlanName },
            {
                type: "writeProjectFile",
                path: ".gitignore",
                text:
                    "# BEGIN RunWield owned runtime state\n.wld/plan-locks\n.wld/plan-transitions\n.wld/plan-backups\n.wld/plan-staging\n.wld/worktrees\n.wld/debug\n.wld/worktrees.json\n.wld/worktrees.lock\n.wld/worktree-registry-migration-issues.json\n.wld/collaboration-secrets.json\n# END RunWield owned runtime state\n",
            },
            { type: "writeProjectFile", path: "untracked-user-note.txt", text: "preserve local note\n" },
            {
                type: "capturePublicationBaseline",
                paths: [".gitignore", "untracked-user-note.txt", `docs/plans/${localPublicationPlanName}.md`],
            },
            { type: "type", text: `/load-plan ${localPublicationPlanName}` },
            { type: "enter" },
            { type: "enter" },
            {
                type: "waitForWorktreeRegistryStatus",
                planName: localPublicationPlanName,
                statuses: ["absent"],
                timeoutMs: 90000,
            },
            { type: "waitForIdle", timeoutMs: 90000 },
            {
                type: "captureLocalPublicationState",
                planName: localPublicationPlanName,
                deliveredPath: "local-publication.txt",
            },
        ],
        assertions: [
            (result: PublicationState) => {
                const baseline = result.state.publicationBaseline;
                const published = result.state.localPublication;
                assert(baseline && published, "Expected local publication evidence.");
                assert(published.head !== baseline.head, "Expected local main to advance.");
                assertEquals(published.branch, "main");
                assertEquals(published.planStatus, "validated");
                assertEquals(published.deliveredText, "local-only delivery\n");
                assertEquals(published.files?.["untracked-user-note.txt"], "preserve local note\n");
                assertEquals(published.registryEntries, []);
                assert(
                    `${result.scrollbackText || ""}\n${result.screenText || ""}`.includes("This project has no remote"),
                    "Expected RunWield to explain the local publication fallback.",
                );
            },
        ],
    },
    localPublicationPlanName,
    [localPublicationPlanName],
    [],
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
                id: "operator-records-publication-qa",
                agent: "operator",
                phase: "operator",
                ordinal: 1,
                optional: true,
                requiredTools: ["qa_checklist_generated"],
                toolCalls: [{
                    name: "qa_checklist_generated",
                    arguments: {
                        checklistMarkdown:
                            "Manual verification steps for publication-merge-conflict-repair-completed\n\n- [ ] Confirm the repaired file is published.",
                    },
                }],
            },
            {
                id: "recorder-records-publication-repair",
                agent: "recorder",
                phase: "work_record",
                ordinal: 1,
                text: JSON.stringify({
                    title: "Publication repair",
                    summary: "Recorded the repaired publication fixture.",
                    deviationsFromPlan: "None.",
                }),
            },
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
                                "printf 'repaired version\n' > publication-merge-conflict.txt\nrm -rf .wld\ngit add -A",
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
            { type: "capturePublicationBaseline", paths: ["publication-merge-conflict.txt"] },
            { type: "type", text: "/load-plan publication-merge-conflict-repair-completed" },
            { type: "enter" },
            { type: "enter" },
            {
                type: "waitForWorktreeRegistryStatus",
                planName: "publication-merge-conflict-repair-completed",
                statuses: ["absent"],
                timeoutMs: 120000,
            },
            { type: "waitForIdle", timeoutMs: 120000 },
            {
                type: "capturePublicationState",
                planName: "publication-merge-conflict-repair-completed",
                deliveredPath: "publication-merge-conflict.txt",
            },
        ],
        assertions: [
            (result: PublicationState) => {
                assertPublishedWithoutPrimaryMutation(result, "repaired version");
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
        script: [
            {
                id: "operator-records-incomplete-retry-qa",
                agent: "operator",
                phase: "operator",
                ordinal: 1,
                optional: true,
                text: "Manual QA is not needed for this fixture.",
            },
            {
                id: "recorder-records-incomplete-retry",
                agent: "recorder",
                phase: "work_record",
                ordinal: 1,
                optional: true,
                text: JSON.stringify({
                    title: "Publication repair retry",
                    summary: "Recorded the publication retry fixture.",
                    deviationsFromPlan: "None.",
                }),
            },
            {
                id: "engineer-leaves-publication-merge-conflict-retry-incomplete-1",
                agent: "engineer",
                phase: "engineer",
                planName: "publication-merge-conflict-repair-incomplete-retry",
                ordinal: 1,
                text: "Merge repair did not call task_completed before user retry.",
            },
        ],
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
                    target: "repair",
                    commands: ["rm -rf .wld", "git add publication-merge-conflict-retry.txt"],
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
            { type: "capturePublicationBaseline", paths: ["publication-merge-conflict-retry.txt"] },
            { type: "type", text: "/load-plan publication-merge-conflict-repair-incomplete-retry" },
            { type: "enter" },
            { type: "enter" },
            {
                type: "waitForWorktreeRegistryStatus",
                planName: "publication-merge-conflict-repair-incomplete-retry",
                statuses: ["absent"],
                timeoutMs: 120000,
            },
            { type: "waitForIdle", timeoutMs: 120000 },
            {
                type: "capturePublicationState",
                planName: "publication-merge-conflict-repair-incomplete-retry",
                deliveredPath: "publication-merge-conflict-retry.txt",
            },
        ],
        assertions: [
            (result: PublicationState) => {
                assertPublishedWithoutPrimaryMutation(result, "resolved version");
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
        script: [
            {
                id: "operator-records-incomplete-stop-qa",
                agent: "operator",
                phase: "operator",
                ordinal: 1,
                optional: true,
                text: "Manual QA is not needed for this fixture.",
            },
            {
                id: "recorder-records-incomplete-stop",
                agent: "recorder",
                phase: "work_record",
                ordinal: 1,
                optional: true,
                text: JSON.stringify({
                    title: "Publication repair stop",
                    summary: "Recorded the stopped publication repair fixture.",
                    deviationsFromPlan: "None.",
                }),
            },
            {
                id: "engineer-leaves-publication-merge-conflict-incomplete-1",
                agent: "engineer",
                phase: "engineer",
                planName: "publication-merge-conflict-repair-incomplete-stop",
                ordinal: 1,
                text: "Merge repair did not call task_completed.",
            },
        ],
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
        script: [],
        scriptedInteractions: [
            {
                type: "select",
                promptIncludes: "Plan recovery (validated_reviewer)",
                value: "validate",
            },
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

const pushRetryPlanName = "validation-tree-publication-push-failure-retry";

export const validationTreePublicationPushFailureRetryScenario = {
    ...withValidationBranches(
        {
            name: `${pushRetryPlanName}-base`,
            coverage: ["recovery:user-pause"],
            composedTui: true,
            initialAgentName: "guide",
            terminal: { columns: 100, rows: 30 },
            timeoutMs: 150000,
            committedProjectFiles: [
                { path: ".wld/settings.json", text: `${JSON.stringify({ verification_command: "true" }, null, 4)}\n` },
                { path: "user-work.txt", text: "committed user work\n" },
                {
                    path: `docs/plans/${pushRetryPlanName}.md`,
                    text: publicationPlan(pushRetryPlanName, "publication-push-retry.txt"),
                },
            ],
            initialProjectFiles: [],
            scriptedInteractions: [
                { type: "select", promptIncludes: "Plan recovery", value: "validate" },
                { type: "select", promptIncludes: "could not be updated upstream", value: "stop" },
                { type: "select", promptIncludes: "Plan recovery", value: "validate" },
            ],
            actions: [
                {
                    type: "seedActiveWorktree",
                    planName: pushRetryPlanName,
                    status: "validated_reviewer",
                    attrs: { humanReviewMode: "none", humanReviewDecision: "not_required" },
                    files: [{ path: "publication-push-retry.txt", text: "safe implementation\n" }],
                },
                { type: "writeProjectFile", path: "user-work.txt", text: "unsaved user work\n" },
                {
                    type: "capturePublicationBaseline",
                    paths: ["user-work.txt", `docs/plans/${pushRetryPlanName}.md`],
                },
                { type: "setPlanRemotePushRejection", planName: pushRetryPlanName },
                { type: "type", text: `/load-plan ${pushRetryPlanName}` },
                { type: "enter" },
                { type: "enter" },
                {
                    type: "waitForWorktreeRegistryStatus",
                    planName: pushRetryPlanName,
                    statuses: ["publication_failed"],
                    timeoutMs: 90000,
                },
                { type: "capturePendingPublicationState", planName: pushRetryPlanName },
                { type: "waitForIdle", timeoutMs: 90000 },
                { type: "setPlanRemotePushRejection", planName: pushRetryPlanName, enabled: false },
                { type: "type", text: `/load-plan ${pushRetryPlanName}` },
                { type: "enter" },
                { type: "enter" },
                {
                    type: "waitForRemotePlanStatus",
                    planName: pushRetryPlanName,
                    statuses: ["validated"],
                    timeoutMs: 90000,
                },
                {
                    type: "waitForWorktreeRegistryStatus",
                    planName: pushRetryPlanName,
                    statuses: ["absent"],
                    timeoutMs: 90000,
                },
                { type: "waitForIdle", timeoutMs: 90000 },
                {
                    type: "capturePublicationState",
                    planName: pushRetryPlanName,
                    deliveredPath: "publication-push-retry.txt",
                },
            ],
            assertions: [
                assertsGoldenCoverage("recovery:user-pause", (result: PublicationState) => {
                    const baseline = result.state.publicationBaseline;
                    const pending = result.state.pendingPublication;
                    assert(baseline && pending, "Expected durable pending-publication evidence.");
                    assertEquals(pending.registryStatus, "publication_failed");
                    assertEquals(pending.executionPlanStatus, "validated");
                    assertEquals(pending.worktreeExists, true);
                    assertEquals(pending.branchExists, true);
                    assertEquals(pending.primaryHead, baseline.head);
                    assertEquals(pending.primaryStatus, baseline.status);
                    assertEquals(pending.primaryFiles, baseline.files);
                    assertPublishedWithoutPrimaryMutation(result, "safe implementation");
                    assert(
                        (result.scrollbackText || "").split("Generating the Work Record for the current plan").length -
                                1 <= 1,
                        "Publication retry must reuse the prepared Work Record instead of calling the Agent again.",
                    );
                }),
            ],
        },
        pushRetryPlanName,
        [pushRetryPlanName],
        ["publication:push-failure-preserves", "publication:push-retry"],
    ),
    coverage: ["recovery:user-pause"],
};

const legacyRetryPlanName = "validation-tree-publication-legacy-partial-retry";

export const validationTreePublicationLegacyPartialRetryScenario = withValidationBranches(
    {
        name: `${legacyRetryPlanName}-base`,
        composedTui: true,
        initialAgentName: "guide",
        terminal: { columns: 100, rows: 30 },
        timeoutMs: 150000,
        committedProjectFiles: [
            { path: ".wld/settings.json", text: `${JSON.stringify({ verification_command: "true" }, null, 4)}\n` },
            { path: "user-work.txt", text: "committed user work\n" },
            {
                path: `docs/plans/${legacyRetryPlanName}.md`,
                text: publicationPlan(legacyRetryPlanName, "legacy-publication-retry.txt"),
            },
        ],
        scriptedInteractions: [{ type: "select", promptIncludes: "Plan recovery", value: "merge" }],
        actions: [
            {
                type: "seedActiveWorktree",
                planName: legacyRetryPlanName,
                legacyStrandedPublication: true,
                files: [{ path: "legacy-publication-retry.txt", text: "preserved legacy implementation\n" }],
            },
            { type: "writeProjectFile", path: "user-work.txt", text: "unsaved user work\n" },
            { type: "writeProjectFile", path: "untracked-user-note.txt", text: "leave me alone\n" },
            {
                type: "capturePublicationBaseline",
                paths: ["user-work.txt", "untracked-user-note.txt", `docs/plans/${legacyRetryPlanName}.md`],
            },
            { type: "type", text: `/load-plan ${legacyRetryPlanName}` },
            { type: "enter" },
            { type: "enter" },
            {
                type: "waitForRemotePlanStatus",
                planName: legacyRetryPlanName,
                statuses: ["validated"],
                timeoutMs: 90000,
            },
            {
                type: "waitForWorktreeRegistryStatus",
                planName: legacyRetryPlanName,
                statuses: ["absent"],
                timeoutMs: 90000,
            },
            { type: "waitForIdle", timeoutMs: 90000 },
            {
                type: "capturePublicationState",
                planName: legacyRetryPlanName,
                deliveredPath: "legacy-publication-retry.txt",
            },
        ],
        assertions: [
            (result: PublicationState) => {
                assertPublishedWithoutPrimaryMutation(result, "preserved legacy implementation");
            },
        ],
    },
    legacyRetryPlanName,
    [legacyRetryPlanName],
    ["publication:legacy-partial-retry"],
);

export const validationWorkflowPublicationScenarios = [
    validationTreePublicationIsolatedDirtyPrimaryScenario,
    validationTreePublicationRemoteTargetAdvanceScenario,
    validationTreePublicationLocalOnlyScenario,
    validationTreePublicationMergeConflictRepairCompletedScenario,
    validationTreePublicationMergeConflictRepairIncompleteRetryScenario,
    validationTreePublicationMergeConflictRepairIncompleteStopScenario,
    validationTreePublicationMissingTargetBranchScenario,
    validationTreePublicationStaleRepairWorktreeScenario,
    validationTreePublicationGenericGitFailureScenario,
    validationTreePublicationPushFailureRetryScenario,
    validationTreePublicationLegacyPartialRetryScenario,
];
