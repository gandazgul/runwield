import { assertEquals } from "@std/assert";
import { handlePlanRecovery } from "./plan-recovery-flow.ts";

import type { PlanFrontMatter } from "../../plan-store.js";
import type { UiAPI } from "../../ui/tui/types.js";
import type { HandlePlanRecoveryOptions, RecoveryFlowPlan } from "./plan-recovery-flow.ts";

interface PromptOption {
    value: string;
    label: string;
}

interface TestUi extends UiAPI {
    prompts: string[];
    messages: string[];
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
        path: "plans/recovery-contract.md",
        markdown: "# Plan",
        body: "# Plan",
        attrs,
    };
}

function makeUi(answers: (string | null)[]): TestUi {
    const prompts: string[] = [];
    const messages: string[] = [];
    const ui: Partial<TestUi> = {
        prompts,
        messages,
        promptSelect: (prompt: string, options: PromptOption[]) => {
            prompts.push(`${prompt}:${options.map((option) => option.value).join(",")}`);
            return Promise.resolve(answers.shift() ?? null);
        },
        appendSystemMessage: (message: string) => {
            messages.push(message);
        },
    };
    return ui as TestUi;
}

function makeOptions(plan: RecoveryFlowPlan, uiAPI: UiAPI): HandlePlanRecoveryOptions {
    const recordPlanEvent = () => Promise.resolve(plan.attrs);
    const options = {
        projectRoot: "/tmp/runwield-recovery-test",
        plan,
        agentName: "engineer",
        uiAPI,
        executePlan: () => Promise.resolve({ result: "complete" }),
        runPlanningAgent: () => Promise.resolve({ kind: "done" }),
        decidePostPlanning: () => "done",
        decidePostExecution: () => "done",
        runValidationLoop: () => Promise.resolve({ status: "blocked" }),
        loadPlan: () => Promise.resolve(plan),
        getWorkflowDiff: () => Promise.resolve(""),
        listCommitsTouchingPathsSince: () => Promise.resolve([]),
        restoreWorktreeTree: () => Promise.resolve(),
        recordPlanEvent,
        stageValidationPassedInExecutionWorktree: () => Promise.resolve({ planPaths: [], attrs: plan.attrs }),
        updatePlanFrontMatter: (_root: string, _name: string, updates: Partial<PlanFrontMatter>) => {
            plan.attrs = { ...plan.attrs, ...updates };
            return Promise.resolve(plan.attrs);
        },
        findWorktreeById: () => Promise.resolve(null),
        findWorktreeByPlanName: () => Promise.resolve(null),
        updateWorktreeRegistryEntry: () => Promise.resolve(null),
        getWorktreeStatus: () => Promise.resolve({ exists: false, clean: true, statusText: "", diff: "" }),
        createWorktreeGitArtifacts: () =>
            Promise.resolve({
                id: "worktree-1",
                path: "/tmp/worktree",
                branch: "rw/test",
                baseBranch: "main",
                baseCommit: "abc",
                baseTree: "def",
                status: "active",
            }),
        settleWorktreeAttempt: (_root: string, entry: never) => Promise.resolve(entry),
        mergeExecutionWorktree: () => Promise.resolve({ updatedPrimaryCheckout: true }),
        checkpointExecutionWorktree: () => Promise.resolve({ executionCommit: "abc" }),
        getBranchHead: () => Promise.resolve("head"),
        isCommitAncestorOfBranch: () => Promise.resolve(true),
        preparePrimaryPlanPathForMerge: () =>
            Promise.resolve({ relativePath: "plans/recovery-contract.md", existed: false }),
        restorePrimaryPlanPathAfterMergeFailure: () => Promise.resolve(),
        removeWorktreeGitArtifacts: () => Promise.resolve(),
        removeWorktreeRegistryEntry: () => Promise.resolve(),
        shouldCleanupMergedWorktrees: () => false,
        findPlansByParent: () => Promise.resolve([]),
        session: { activeWorkflow: null },
        recordWorkflowMetric: () => Promise.resolve(null),
        probeGitRepository: () => Promise.resolve({ ok: true, state: "available", cwd: "/tmp/runwield-recovery-test" }),
        finalizePlanImplementation: () => Promise.resolve({}),
        resolveValidationExecutionContextForRecovery: () =>
            Promise.resolve({
                kind: "ok",
                context: { executionMode: "non_git_in_place", executionCwd: "/tmp/runwield-recovery-test" },
            }),
        autoGenerateWorkRecordForCompletedPlan: () =>
            Promise.resolve({ status: "skipped", planName: plan.planName, message: "skipped" }),
    };
    return Object.assign({} as HandlePlanRecoveryOptions, options);
}

Deno.test("Plan Recovery menu outcomes re-prompt without fallthrough", async () => {
    const plan = makePlan();
    const ui = makeUi(["inspect", null]);
    const result = await handlePlanRecovery(makeOptions(plan, ui));
    assertEquals(result, "handled");
    assertEquals(ui.prompts.length, 2);
});

Deno.test("Plan Recovery handled and review outcomes exit once", async () => {
    const plan = makePlan();
    const ui = makeUi([null]);
    const result = await handlePlanRecovery(makeOptions(plan, ui));
    assertEquals(result, "handled");
    assertEquals(ui.prompts.length, 1);
});

Deno.test("Plan Recovery actions preserve live context", async () => {
    const plan = makePlan({ worktreeId: "worktree-1", worktreePath: "/tmp/worktree", worktreeBranch: "rw/test" });
    const ui = makeUi(["inspect", null]);
    const result = await handlePlanRecovery(makeOptions(plan, ui));
    assertEquals(result, "handled");
    assertEquals(ui.prompts.length, 2);
});
