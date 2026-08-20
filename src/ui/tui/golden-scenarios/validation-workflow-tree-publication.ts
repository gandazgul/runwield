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
    validationTreePublicationPushFailureRetryScenario,
    validationTreePublicationLegacyPartialRetryScenario,
];
