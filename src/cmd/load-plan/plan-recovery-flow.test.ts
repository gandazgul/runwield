import { assertEquals } from "@std/assert";
import { handlePlanRecovery } from "./plan-recovery-flow.ts";
import { inspectRecoveryPlan, settleRecoveryRecords } from "./plan-recovery-actions.ts";
import { loadPlan, savePlan, updatePlanFrontMatter } from "../../plan-store.js";
import { getTransitionJournalDir } from "../../shared/workflow/state-transition.ts";
import { addEntry as addWorktreeRegistryEntry } from "../../shared/worktree-registry.js";

import type { PlanFrontMatter } from "../../plan-store.js";
import type { UiAPI } from "../../ui/tui/types.js";
import type { PlanSessionSurface } from "./plan-session-types.ts";
import type { HandlePlanRecoveryOptions, RecoveryFlowPlan } from "./plan-recovery-flow.ts";
import type { RecoveryActionContext } from "./plan-recovery-actions.ts";

interface PromptOption {
    value: string;
    label: string;
}

interface TestUi extends UiAPI {
    prompts: string[];
    messages: string[];
}

interface RunRecoveryResult {
    result: "handled" | "review";
    plan: RecoveryFlowPlan;
    ui: TestUi;
}

interface RealRecoveryProject {
    projectRoot: string;
    plan: RecoveryFlowPlan;
    baselineTree: string;
}

function makePlan(overrides: Partial<PlanFrontMatter> = {}): RecoveryFlowPlan {
    const attrs = {
        status: "failed",
        executionMode: "non_git_in_place",
        planId: "plan-1",
        summary: "test plan",
        ...overrides,
    } as PlanFrontMatter;
    return {
        planName: "recovery-contract",
        path: "docs/plans/recovery-contract.md",
        markdown: "# Plan",
        body: "# Plan",
        attrs,
    };
}

function makeUi(answers: (string | null)[], textAnswers: (string | null)[] = []): TestUi {
    const prompts: string[] = [];
    const messages: string[] = [];
    const ui: Partial<TestUi> = {
        prompts,
        messages,
        promptSelect: (prompt: string, options: PromptOption[]) => {
            prompts.push(`${prompt}:${options.map((option) => option.value).join(",")}`);
            return Promise.resolve(answers.shift() ?? null);
        },
        promptText: (prompt: string) => {
            prompts.push(`${prompt}:text`);
            return Promise.resolve(textAnswers.shift() ?? null);
        },
        appendSystemMessage: (message: string) => {
            messages.push(message);
        },
    };
    return ui as TestUi;
}

async function runGit(cwd: string, args: string[]): Promise<string> {
    const command = new Deno.Command("git", { cwd, args, stdout: "piped", stderr: "piped" });
    const output = await command.output();
    if (!output.success) {
        throw new Error(new TextDecoder().decode(output.stderr));
    }
    return new TextDecoder().decode(output.stdout).trim();
}

async function makeRealRecoveryProject(attrs: Partial<PlanFrontMatter> = {}): Promise<RealRecoveryProject> {
    const projectRoot = await Deno.makeTempDir({ prefix: "runwield-recovery-real-" });
    await runGit(projectRoot, ["init", "-b", "main"]);
    await runGit(projectRoot, ["config", "user.email", "runwield@example.test"]);
    await runGit(projectRoot, ["config", "user.name", "RunWield Test"]);
    await savePlan(projectRoot, "recovery-contract", "# Plan\n\nrecovery fixture\n", {
        classification: "FEATURE",
        status: "failed",
        summary: "test plan",
        affectedPaths: [],
        executionMode: "non_git_in_place",
        planId: "plan-1",
        ...attrs,
    });
    await runGit(projectRoot, ["add", "."]);
    await runGit(projectRoot, ["commit", "-m", "initial fixture"]);
    const baselineTree = await runGit(projectRoot, ["rev-parse", "HEAD^{tree}"]);
    const loadedPlan = await loadPlan(projectRoot, "recovery-contract");
    if (!loadedPlan) throw new Error("fixture plan was not saved");
    const plan: RecoveryFlowPlan = { ...loadedPlan, planName: "recovery-contract" };
    return { projectRoot, plan, baselineTree };
}

function makeOptions(
    plan: RecoveryFlowPlan,
    uiAPI: UiAPI,
    projectRoot = "/tmp/runwield-recovery-test",
): HandlePlanRecoveryOptions {
    const options = {
        projectRoot,
        plan,
        agentName: "engineer",
        uiAPI,
        session: {
            id: "session-1",
            cwd: projectRoot,
            getActiveAgentName: () => null,
            switchAgent: () => Promise.resolve(null),
            executePlan: () => Promise.resolve({ result: "complete" }),
            runPlanningAgent: () => Promise.resolve({ kind: "done" }),
            runValidation: () => Promise.resolve({ status: "blocked" }),
            runSlicerAgent: () => Promise.resolve(null),
            getActiveExecutionWorkflow: () => null,
            setActiveExecutionWorkflow: () => {},
            clearActiveExecutionWorkflow: async () => {},
            reviewPlan: () => Promise.resolve({ action: "cancel" }),
            rename: async () => {},
        },
        ports: {
            recordWorkflowMetric: () => Promise.resolve(null),
            probeGitRepository: () => Promise.resolve({ ok: true, state: "available", cwd: projectRoot }),
        },
    };
    return Object.assign({} as HandlePlanRecoveryOptions, options);
}

async function runRecovery(
    selections: Array<string | null>,
    attrs: Partial<PlanFrontMatter> = {},
    configure: (options: HandlePlanRecoveryOptions) => void = () => {},
): Promise<RunRecoveryResult> {
    const projectRoot = await Deno.makeTempDir({ prefix: "runwield-recovery-fake-" });
    const plan = makePlan(attrs);
    const ui = makeUi(selections);
    const options = makeOptions(plan, ui, projectRoot);
    configure(options);
    const result = await handlePlanRecovery(options);
    return { result, plan, ui };
}

async function writeTransitionRecord(
    projectRoot: string,
    transitionId: string,
    planName: string,
    state: string,
): Promise<void> {
    const journalDir = getTransitionJournalDir(projectRoot);
    await Deno.mkdir(journalDir, { recursive: true });
    await Deno.writeTextFile(
        `${journalDir}/${transitionId}.json`,
        `${JSON.stringify({ transitionId, planName, operation: "recovery_reset", state }, null, 2)}\n`,
    );
}

async function writeUnresolvedTransitionRecord(
    projectRoot: string,
    transitionId: string,
    planName: string,
): Promise<void> {
    const journalDir = getTransitionJournalDir(projectRoot);
    await Deno.mkdir(journalDir, { recursive: true });
    await Deno.writeTextFile(
        `${journalDir}/${transitionId}.json`,
        `${
            JSON.stringify(
                {
                    transitionId,
                    planName,
                    operation: "recovery_reset",
                    state: "interrupted",
                    beforeFacts: { plan: { revision: "stale-frontmatter-revision" } },
                },
                null,
                2,
            )
        }\n`,
    );
}

function makeSession(projectRoot: string): PlanSessionSurface {
    return {
        id: "session-1",
        cwd: projectRoot,
        getActiveAgentName: () => "engineer",
        switchAgent: () => Promise.resolve(null),
        executePlan: () => Promise.resolve({ result: "complete" }),
        runPlanningAgent: () => Promise.resolve({ kind: "done" }),
        runValidation: () => Promise.resolve({ status: "blocked" }),
        runSlicerAgent: () => Promise.resolve({ kind: "done" }),
        getActiveExecutionWorkflow: () => null,
        setActiveExecutionWorkflow: async () => {},
        clearActiveExecutionWorkflow: async () => {},
        reviewPlan: () => Promise.resolve({ canceled: true, approved: false }),
        rename: async () => {},
    };
}

function makeActionContext(projectRoot: string, plan: RecoveryFlowPlan, uiAPI: UiAPI): RecoveryActionContext {
    return {
        projectRoot,
        plan,
        agentName: "engineer",
        uiAPI,
        session: makeSession(projectRoot),
        loadedWorktreeId: plan.attrs.worktreeId,
        worktreeContext: null,
        unresolvedRecords: [],
        refreshRecoveryWorktree: () => Promise.resolve(null),
        recordRecoveryResult: () => Promise.resolve(),
    };
}

async function runRealRecovery(
    selections: Array<string | null>,
    attrs: Partial<PlanFrontMatter> = {},
    configure: (options: HandlePlanRecoveryOptions, project: RealRecoveryProject) => Promise<void> | void = () => {},
): Promise<RunRecoveryResult> {
    const project = await makeRealRecoveryProject(attrs);
    const ui = makeUi(selections);
    const options = makeOptions(project.plan, ui);
    options.projectRoot = project.projectRoot;
    options.session.cwd = project.projectRoot;
    await configure(options, project);
    const result = await handlePlanRecovery(options);
    return { result, plan: project.plan, ui };
}

Deno.test("Plan Recovery menu outcomes re-prompt without fallthrough", async () => {
    const proofProject = await makeRealRecoveryProject();
    const proofUi = makeUi([]);
    await writeTransitionRecord(proofProject.projectRoot, "proof-record", proofProject.plan.planName, "committed");
    const proofContext = makeActionContext(proofProject.projectRoot, proofProject.plan, proofUi);
    proofContext.unresolvedRecords = [{ transitionId: "proof-record", operation: "reset", reason: "pending" }];
    assertEquals(await settleRecoveryRecords(proofContext), { kind: "menu" });
    assertEquals(proofUi.messages.some((message) => message.includes("1 old work note is done")), true);
    assertEquals(proofContext.unresolvedRecords.length, 0);

    const declineProject = await makeRealRecoveryProject();
    const declineUi = makeUi(["no"]);
    await writeUnresolvedTransitionRecord(declineProject.projectRoot, "declined-record", declineProject.plan.planName);
    const declineContext = makeActionContext(declineProject.projectRoot, declineProject.plan, declineUi);
    declineContext.unresolvedRecords = [{ transitionId: "declined-record", operation: "reset", reason: "pending" }];
    assertEquals(await settleRecoveryRecords(declineContext), { kind: "menu" });
    assertEquals(declineContext.unresolvedRecords.length, 1);

    const attestationProject = await makeRealRecoveryProject();
    const attestationUi = makeUi(["yes"]);
    await writeUnresolvedTransitionRecord(
        attestationProject.projectRoot,
        "attested-record",
        attestationProject.plan.planName,
    );
    const attestationContext = makeActionContext(
        attestationProject.projectRoot,
        attestationProject.plan,
        attestationUi,
    );
    attestationContext.unresolvedRecords = [
        { operation: "unidentified", reason: "missing transition id" },
        { transitionId: "attested-record", operation: "reset", reason: "pending" },
    ];
    assertEquals(await settleRecoveryRecords(attestationContext), { kind: "menu" });
    assertEquals(attestationUi.messages.some((message) => message.includes("Closed on your word")), true);
    assertEquals(attestationContext.unresolvedRecords.length, 0);

    const inspect = await runRecovery(["inspect", null], {
        worktreeId: "worktree-1",
        worktreePath: "/tmp/inspected-worktree",
        worktreeBranch: "rw/inspect",
    });
    assertEquals(inspect.result, "handled");
    assertEquals(inspect.ui.prompts.length, 2);
    assertEquals(
        inspect.ui.messages.some((message) => message.includes("Worktree path: /tmp/inspected-worktree")),
        true,
    );

    const resetPreflight = await runRecovery(["reset", null]);
    assertEquals(resetPreflight.result, "handled");
    assertEquals(resetPreflight.ui.messages.some((message) => message.includes("No test base is saved")), true);
    assertEquals(resetPreflight.ui.prompts.length, 2);

    const validateBlocked = await runRecovery(["validate", null], { status: "implemented" });
    assertEquals(validateBlocked.result, "handled");
    assertEquals(validateBlocked.ui.prompts.length, 1);

    const continueBlocked = await runRecovery(["continue", null], {
        executionMode: "worktree",
        executionBaselineTree: "baseline-tree",
    }, (options) => {
        options.ports.probeGitRepository = () =>
            Promise.resolve({ ok: false, state: "not_git", cwd: options.projectRoot });
    });
    assertEquals(continueBlocked.result, "handled");
    assertEquals(continueBlocked.ui.prompts.length, 2);

    const mergePreflight = await runRecovery(["merge", null], { status: "implemented" });
    assertEquals(mergePreflight.result, "handled");
    assertEquals(mergePreflight.ui.messages.some((message) => message.includes("Manual worktree merge")), true);
    assertEquals(mergePreflight.ui.prompts.length, 2);

    const abandonDecline = await runRecovery(["abandon", "cancel", null], {
        worktreeId: "worktree-1",
    });
    assertEquals(abandonDecline.result, "handled");
    assertEquals(abandonDecline.plan.attrs.worktreeId, "worktree-1");
    assertEquals(abandonDecline.ui.prompts.filter((prompt) => prompt.startsWith("Plan recovery")).length, 2);
});

Deno.test("Plan Recovery handled and review outcomes exit once", async () => {
    const cancel = await runRecovery([null]);
    assertEquals(cancel.result, "handled");
    assertEquals(cancel.ui.prompts.length, 1);
    assertEquals(cancel.ui.prompts[0].includes("user_verify"), false);

    const review = await runRealRecovery(["review"]);
    assertEquals(review.result, "review");
    assertEquals(review.ui.prompts.length, 1);

    const validateSuccess = await runRealRecovery(["validate"], { status: "implemented" }, (options) => {
        options.session.runValidation = () => Promise.resolve({ status: "passed" });
    });
    assertEquals(validateSuccess.result, "handled");
    assertEquals(validateSuccess.ui.prompts.length, 1);

    const continued = await runRealRecovery(["continue"], { executionMode: "non_git_in_place" });
    assertEquals(continued.result, "handled");
    assertEquals(continued.ui.prompts.length, 1);

    const resetSuccess = await runRealRecovery(
        ["reset", "clear"],
        { executionBaselineTree: "baseline-tree" },
        (options) => {
            options.ports.probeGitRepository = () =>
                Promise.resolve({ ok: false, state: "not_git", cwd: options.projectRoot });
        },
    );
    assertEquals(resetSuccess.result, "handled");
});

Deno.test("Plan Recovery actions preserve live context", async () => {
    const inspectUi = makeUi([]);
    const inspectPlan = makePlan({ worktreeId: "worktree-1" });
    const inspectContext = makeActionContext("/tmp/runwield-recovery-test", inspectPlan, inspectUi);
    let inspectedStatusPath = "";
    inspectContext.refreshRecoveryWorktree = () => {
        inspectPlan.attrs.failureReason = "refreshed before report";
        return Promise.resolve({
            id: "worktree-1",
            path: "/tmp/refreshed-worktree",
            branch: "rw/refreshed",
            baseBranch: "main",
            status: "active",
        });
    };
    assertEquals(await inspectRecoveryPlan(inspectContext), { kind: "menu" });
    inspectedStatusPath = inspectContext.worktreeContext?.path || "";
    assertEquals(inspectContext.worktreeContext?.path, "/tmp/refreshed-worktree");
    assertEquals(inspectedStatusPath, "/tmp/refreshed-worktree");
    assertEquals(inspectUi.messages.some((message) => message.includes("last run stopped")), true);

    const inspect = await runRecovery(["inspect", null], {
        worktreeId: "worktree-1",
        worktreePath: "/tmp/worktree",
        worktreeBranch: "rw/test",
    });
    assertEquals(inspect.result, "handled");
    assertEquals(inspect.ui.prompts.length, 2);

    const abandonSuccess = await runRealRecovery(["abandon", "confirm", null], {}, async (_options, project) => {
        const worktreePath = await Deno.makeTempDir({ prefix: "runwield-recovery-abandon-worktree-" });
        await Deno.remove(worktreePath);
        await runGit(project.projectRoot, ["worktree", "add", "-b", "rw/test", worktreePath, "HEAD"]);
        await addWorktreeRegistryEntry(project.projectRoot, {
            id: "worktree-1",
            planName: project.plan.planName,
            planId: "plan-1",
            path: worktreePath,
            branch: "rw/test",
            baseBranch: "main",
            baseRef: "main",
            baseCommit: await runGit(project.projectRoot, ["rev-parse", "HEAD"]),
            baseTree: project.baselineTree,
            status: "active",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });
        const attrs = await updatePlanFrontMatter(
            project.projectRoot,
            project.plan.planName,
            { worktreeId: "worktree-1", worktreePath, worktreeBranch: "rw/test" },
            project.plan.attrs,
            { expectedRevision: project.plan.revision },
        );
        project.plan.attrs = attrs;
        const reloaded = await loadPlan(project.projectRoot, project.plan.planName);
        if (!reloaded) throw new Error("abandon fixture plan disappeared");
        project.plan.revision = reloaded.revision;
    });
    assertEquals(abandonSuccess.result, "handled");
    assertEquals(Boolean(abandonSuccess.plan.attrs.worktreeId), false);
    assertEquals(abandonSuccess.ui.prompts.filter((prompt) => prompt.startsWith("Plan recovery")).length, 2);

    const abandonMissingRegistry = await runRealRecovery(
        ["abandon", "confirm", null],
        {},
        async (_options, project) => {
            const worktreePath = await Deno.makeTempDir({ prefix: "runwield-recovery-missing-registry-" });
            await Deno.remove(worktreePath);
            const attrs = await updatePlanFrontMatter(
                project.projectRoot,
                project.plan.planName,
                { worktreeId: "missing-worktree-1", worktreePath, worktreeBranch: "rw/missing-registry" },
                project.plan.attrs,
                { expectedRevision: project.plan.revision },
            );
            project.plan.attrs = attrs;
            const reloaded = await loadPlan(project.projectRoot, project.plan.planName);
            if (!reloaded) throw new Error("missing-registry abandon fixture plan disappeared");
            project.plan.revision = reloaded.revision;
        },
    );
    assertEquals(abandonMissingRegistry.result, "handled");
    assertEquals(Boolean(abandonMissingRegistry.plan.attrs.worktreeId), false);
    assertEquals(
        abandonMissingRegistry.ui.messages.some((message) =>
            message.includes("saved worktree details were already gone")
        ),
        true,
    );

    const mergeAttemptFailure = await runRealRecovery(["merge"], {
        status: "implemented",
        executionMode: "worktree",
        worktreeStatus: "merge_conflict",
    }, async (_options, project) => {
        const worktreePath = await Deno.makeTempDir({ prefix: "runwield-recovery-merge-worktree-" });
        await Deno.remove(worktreePath);
        await runGit(project.projectRoot, ["worktree", "add", "-b", "rw/test", worktreePath, "HEAD"]);
        const attrs = await updatePlanFrontMatter(
            project.projectRoot,
            project.plan.planName,
            {
                status: "implemented",
                executionMode: "worktree",
                worktreeId: "worktree-1",
                worktreePath,
                worktreeBranch: "rw/test",
                worktreeBaseBranch: "main",
                worktreeStatus: "merge_conflict",
            },
            project.plan.attrs,
            { expectedRevision: project.plan.revision },
        );
        project.plan.attrs = attrs;
        const reloaded = await loadPlan(project.projectRoot, project.plan.planName);
        if (!reloaded) throw new Error("merge fixture plan disappeared");
        project.plan.revision = reloaded.revision;
    });
    assertEquals(mergeAttemptFailure.result, "handled");
    assertEquals(mergeAttemptFailure.ui.messages.length > 0, true);
});

Deno.test("lost worktree recovery offers User Verification for implemented plans", async () => {
    const project = await makeRealRecoveryProject({
        status: "implemented",
        executionMode: "worktree",
        worktreeId: "lost-worktree",
        worktreePath: `${await Deno.makeTempDir()}/gone`,
        worktreeBranch: "rw/gone",
        worktreeBaseBranch: "main",
    });
    const ui = makeUi(["user_verify"], ["Accepted from staging check."]);
    const options = makeOptions(project.plan, ui);
    options.projectRoot = project.projectRoot;
    options.session.cwd = project.projectRoot;

    assertEquals(await handlePlanRecovery(options), "handled");
    assertEquals(
        ui.prompts[0],
        "The worktree and branch are gone. The Plan says they should be here. What do you want to do?:reset,user_verify,review,stop_lost",
    );
    assertEquals(ui.prompts[1], "Required user verification note (blank cancels)::text");
    const loadedPlan = await loadPlan(project.projectRoot, project.plan.planName);
    assertEquals(loadedPlan?.attrs.status, "user_verified");
    assertEquals(loadedPlan?.attrs.userVerificationNote, "Accepted from staging check.");
    assertEquals(Boolean(loadedPlan?.attrs.userVerifiedAt), true);
    assertEquals(loadedPlan?.attrs.verifiedAt, undefined);
});

Deno.test("lost worktree recovery omits User Verification for failed plans", async () => {
    const project = await makeRealRecoveryProject({
        executionMode: "worktree",
        worktreeId: "lost-worktree",
        worktreePath: `${await Deno.makeTempDir()}/gone`,
        worktreeBranch: "rw/gone",
        worktreeBaseBranch: "main",
    });
    const ui = makeUi(["stop_lost"]);
    const options = makeOptions(project.plan, ui);
    options.projectRoot = project.projectRoot;
    options.session.cwd = project.projectRoot;

    assertEquals(await handlePlanRecovery(options), "handled");
    assertEquals(
        ui.prompts[0],
        "The worktree and branch are gone. The Plan says they should be here. What do you want to do?:reset,review,stop_lost",
    );
    assertEquals((await loadPlan(project.projectRoot, project.plan.planName))?.attrs.status, "ready_for_work");
});
