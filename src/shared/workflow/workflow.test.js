import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { createWorktreeGitArtifacts, settleWorktreeAttempt } from "../worktree.js";
import {
    beginSlicerContextPhase,
    buildSlicerRequest,
    createSlicerFinalizeTool,
    executePlan,
    extractAssistantOutput,
    finalizePlanImplementation,
    materializeSlicerDraft,
    openSlicerDecomposition,
    readLatestPlanOutcome,
    runPlanningAgent,
    runSlicerAgent,
    startActiveExecutionWorkflow,
} from "./workflow.js";
import { buildEngineerRequest } from "./workflow-prompts.js";
import { SESSION_COMPLETE_GUIDANCE } from "./plan-review-recovery.js";
import { HostedSession } from "../session/hosted-session.js";
import { runActiveAgentTurn } from "../session/agent-switching.js";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { findPlansByParent, loadPlan, savePlan } from "../../plan-store.js";
import { getTransitionJournalDir } from "./state-transition.ts";
import { ensureExecutionPlanFile, loadCanonicalExecutionPlanSource } from "./execution-plan-file.js";
import { captureWorktreeTree } from "./git-snapshot.js";
import { defineCommittedGitFixture, git } from "../git-test-fixture.ts";
import {
    findById as findWorktreeRegistryEntryById,
    listEntries as listWorktreeRegistryEntries,
} from "../worktree-registry.js";

/**
 * @param {string} [id]
 * @param {string} [cwd]
 */
function makeHostedSession(id = "workflow-test", cwd = Deno.cwd()) {
    return new HostedSession({ id, cwd, sessionManager: null });
}

/** @type {string[]} */
const projectsToRemove = [];
let projectCleanupRegistered = false;

function registerProjectCleanup() {
    if (projectCleanupRegistered) return;
    projectCleanupRegistered = true;
    globalThis.addEventListener("unload", () => {
        for (const path of projectsToRemove) {
            try {
                Deno.removeSync(path, { recursive: true });
            } catch {
                // Best effort; a leftover temp directory must not fail a passing run.
            }
        }
    });
}

const workflowRepo = defineCommittedGitFixture();

/** The durable Plan identity shared by the fixture Plan and the `triageMeta` naming it. */
const PLAN_UNDER_TEST = "plan-under-test";

/**
 * A real project: a real Git repository holding real Plans.
 *
 * The Plan Lifecycle *and* the worktree registry are RunWield's own machinery, not
 * external boundaries, so these tests run them for real against a temp project rather
 * than injecting stand-ins. A faked lifecycle returns whatever the fake says and hides
 * what the transition actually wrote — which is how a workflow assertion once passed
 * against state that only existed because the lifecycle was not running.
 *
 * The repository is real for the same reason: `startActiveExecutionWorkflow` proves its
 * own work by stat-ing the worktree and re-reading the registry entry it settled, and
 * those proofs mean nothing against a directory Git never made.
 *
 * @param {Array<string | { name: string, status?: string, classification?: string, attrs?: Record<string, unknown> }>} plans
 * @returns {Promise<string>} the project root
 */
async function makeWorkflowProject(plans) {
    const cwd = await workflowRepo.checkout({ prefix: "runwield-workflow-" });
    projectsToRemove.push(cwd);
    registerProjectCleanup();
    for (const [index, entry] of plans.entries()) {
        const plan = typeof entry === "string" ? { name: entry } : entry;
        await savePlan(
            cwd,
            plan.name,
            `# ${plan.name}`,
            /** @type {any} */ ({
                classification: plan.classification || "PLANNED_CHANGE",
                status: plan.status || "ready_for_work",
                summary: plan.name,
                affectedPaths: [],
                // A Plan that reached execution already has its durable identity. Without
                // it, ensurePlanIdentity backfills one mid-transaction and the execution
                // preparation transaction correctly rejects its own snapshot as stale.
                //
                // The first Plan gets PLAN_UNDER_TEST because it is the one callers name
                // in `triageMeta.planId`, and those two identities have to agree: the
                // preparation transaction re-reads the Plan it materialized into the
                // worktree and rejects a copy whose id is not the one it prepared. They
                // silently disagreed while that check was gated off for injected deps.
                planId: index === 0 ? PLAN_UNDER_TEST : `plan-${plan.name.replace(/[^a-z0-9]+/gi, "-")}`,
                ...(plan.attrs || {}),
            }),
        );
    }
    return cwd;
}

Deno.test("runPlanningAgent forwards triage metadata into the planning root", async () => {
    const hostedSession = makeHostedSession();
    const triageMeta = /** @type {any} */ ({
        classification: "PLANNED_CHANGE",
        workKind: "BUG_FIX",
        summary: "Fix settings persistence",
    });
    let capturedOptions;

    await runPlanningAgent({
        agentName: "planner",
        initialRequest: "Plan the fix",
        triageMeta,
        hostedSession,
        __deps: {
            runActiveAgentTurn: (options) => {
                capturedOptions = options;
                return Promise.resolve([]);
            },
        },
    });

    assertEquals(/** @type {any} */ (capturedOptions).triageMeta, triageMeta);
});

Deno.test("buildEngineerRequest describes documentation Work Kind as planned documentation", () => {
    const text = buildEngineerRequest("docs-plan", "# Docs Plan", undefined, {
        triageMeta: { workKind: "DOCUMENTATION" },
    });

    assertStringIncludes(text, "This is a planned documentation");
});

Deno.test("HostedSession scopes active execution workflow independently", () => {
    const sessionA = new HostedSession({ id: "workflow-a", cwd: "/project-a" });
    const sessionB = new HostedSession({ id: "workflow-b", cwd: "/project-b" });
    const workflowA = /** @type {const} */ ({
        planName: "a",
        triageMeta: {},
        executionAgent: "engineer",
        executionCwd: "/work/a",
    });
    const workflowB = /** @type {const} */ ({
        planName: "b",
        triageMeta: {},
        executionAgent: "engineer",
        executionCwd: "/work/b",
    });

    sessionA.setActiveExecutionWorkflow(workflowA);
    sessionB.setActiveExecutionWorkflow(workflowB);
    sessionA.clearActiveExecutionWorkflow();

    assertEquals(sessionA.getActiveExecutionWorkflow(), null);
    assertEquals(sessionA.getActiveExecutionCwd(), "/project-a");
    assertEquals(sessionB.getActiveExecutionWorkflow(), workflowB);
    assertEquals(sessionB.getActiveExecutionCwd(), "/work/b");
});

Deno.test("baseline rejects already-met Objective-Failing Checks before Engineer starts", async () => {
    const projectRoot = await makeWorkflowProject([{
        name: "already-met-plan",
        status: "ready_for_work",
        attrs: {
            objectiveChecks: [{ id: "OC_TRUE", command: "true" }],
        },
    }]);
    const hostedSession = makeHostedSession("already-met-baseline", projectRoot);
    /** @type {Array<{ agentName: string, userRequest: string }>} */
    const agentTurns = [];

    const result = await executePlan({
        planName: "already-met-plan",
        triageMeta: { planId: PLAN_UNDER_TEST, classification: "FEATURE" },
        hostedSession,
        __deps: {
            runActiveAgentTurn: (options) => {
                agentTurns.push(/** @type {{ agentName: string, userRequest: string }} */ (options));
                return Promise.resolve(
                    /** @type {any[]} */ ([{
                        role: "toolResult",
                        toolName: "plan_written",
                        details: { outcome: "feedback", planName: "already-met-plan" },
                    }]),
                );
            },
        },
    });

    assertEquals(result.executionComplete, false);
    assertEquals(hostedSession.getActiveExecutionWorkflow(), null);
    assertEquals(agentTurns.map((turn) => turn.agentName), ["planner"]);
    assertStringIncludes(agentTurns[0].userRequest, "already satisfied before implementation");
    const plan = await loadPlan(projectRoot, "already-met-plan");
    assertEquals(plan?.attrs.status, "feedback");
    assertEquals(plan?.attrs.objectiveChecksBaseline, undefined);
    assertEquals((await listWorktreeRegistryEntries(projectRoot)).length, 0);
});

Deno.test("re-baselines Objective-Failing Checks when head or command set changes", async () => {
    const projectRoot = await makeWorkflowProject([{
        name: "stale-baseline-plan",
        status: "ready_for_work",
        attrs: {
            objectiveChecks: [{ id: "OC1", command: "test -f rebaseline-marker" }],
            objectiveChecksBaseline: {
                recordedAt: "2026-01-01T00:00:00.000Z",
                head: "0000000000000000000000000000000000000000",
                results: [{
                    id: "OC1",
                    command: "false",
                    status: "unmet",
                    stdout: "",
                    stderr: "",
                    exitCode: 1,
                    durationMs: 1,
                    output: "",
                }],
            },
        },
    }]);
    const hostedSession = makeHostedSession("stale-baseline", projectRoot);

    const workflow = await startActiveExecutionWorkflow({
        planName: "stale-baseline-plan",
        triageMeta: { planId: PLAN_UNDER_TEST, classification: "FEATURE" },
        currentStatus: "ready_for_work",
        hostedSession,
    });

    const plan = await loadPlan(projectRoot, "stale-baseline-plan");
    assertEquals(plan?.attrs.objectiveChecksBaseline?.head, workflow.worktreeBaseCommit);
    assertEquals(
        plan?.attrs.objectiveChecksBaseline?.results.map((result) => [result.id, result.command, result.status]),
        [
            ["OC1", "test -f rebaseline-marker", "unmet"],
        ],
    );
    assertEquals(hostedSession.getActiveExecutionWorkflow()?.planName, "stale-baseline-plan");
});

Deno.test("startActiveExecutionWorkflow bases the execution worktree on the requested target branch", async () => {
    const projectRoot = await makeWorkflowProject([{
        name: "targeted-plan",
        status: "ready_for_work",
        attrs: {
            objectiveChecks: [{ id: "OC_TARGET_BASE", command: "test -f current-only-marker" }],
        },
    }]);
    const hostedSession = makeHostedSession("targeted-workflow", projectRoot);
    await Deno.writeTextFile(`${projectRoot}/current-only-marker`, "present only in the current checkout\n");

    const result = await startActiveExecutionWorkflow({
        // Padded on purpose: the target branch arrives from Front Matter a user edited.
        planName: "targeted-plan",
        triageMeta: { planId: "plan-under-test", worktreeBaseBranch: " feature-base " },
        currentStatus: "ready_for_work",
        hostedSession,
    });

    // Asserted through Git rather than through the arguments handed to a fake: the
    // question is what the worktree was actually branched from, and only the repository
    // can answer that.
    assertEquals(result.worktreeBaseBranch, "feature-base");
    const entry = await findWorktreeRegistryEntryById(projectRoot, /** @type {string} */ (result.worktreeId));
    assertEquals(entry?.baseRef, "refs/heads/feature-base");
    assertEquals(entry?.baseBranch, "feature-base");
    const targetCommit = await git(projectRoot, ["rev-parse", "refs/heads/feature-base"]);
    assertEquals(
        targetCommit,
        await git(projectRoot, ["rev-parse", `${result.worktreeBranch}^{commit}`]),
    );
    const plan = await loadPlan(projectRoot, "targeted-plan");
    assertEquals(plan?.attrs.objectiveChecksBaseline?.head, targetCommit);
    assertEquals(
        plan?.attrs.objectiveChecksBaseline?.results.map((result) => [result.id, result.command, result.status]),
        [["OC_TARGET_BASE", "test -f current-only-marker", "unmet"]],
    );
});

Deno.test("startActiveExecutionWorkflow captures baseline after restored Plan preparation and records metric", async () => {
    const projectRoot = await makeWorkflowProject([{ name: "p", status: "ready_for_work" }]);
    const hostedSession = makeHostedSession("baseline-after-plan-restore", projectRoot);
    // A real execution worktree that is already registered but has no Plan copy in it,
    // while the session still remembers a baseline from when one was there. Built with
    // the real helpers rather than faked: this is the environment the test needs, not the
    // behaviour it is checking.
    const existingWorktree = await settleWorktreeAttempt(
        projectRoot,
        await createWorktreeGitArtifacts({ projectRoot, planName: "p", planId: PLAN_UNDER_TEST }),
    );
    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { planId: PLAN_UNDER_TEST },
        executionAgent: "engineer",
        executionMode: "worktree",
        baselineTree: "stale-tree-without-plan",
        projectRoot: hostedSession.cwd,
        executionCwd: existingWorktree.path,
        worktreeId: existingWorktree.id,
        worktreeBranch: existingWorktree.branch,
        worktreeBaseBranch: existingWorktree.baseBranch,
    });
    /** @type {string[]} */
    const order = [];
    /** @type {any[]} */
    const metrics = [];

    const result = await startActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { planId: PLAN_UNDER_TEST, worktreeId: existingWorktree.id },
        currentStatus: "ready_for_work",
        hostedSession,
        __deps: {
            loadCanonicalExecutionPlanSource: (root, name) => {
                // Observe the ordering, then read the real Plan: a synthetic source
                // disagrees with the file on disk and trips the front-matter guard.
                order.push("load-source");
                return loadCanonicalExecutionPlanSource(root, name);
            },
            ensureExecutionPlanFile: (args) => {
                // Observe, then do the real work. A stand-in that only claims to have
                // restored the Plan leaves the worktree without one, and preparation is
                // supposed to notice that.
                order.push("ensure-plan");
                return ensureExecutionPlanFile(args);
            },
            captureWorktreeTree: (cwd) => {
                order.push("capture-tree");
                return captureWorktreeTree(cwd);
            },
            recordWorkflowMetric: (metric) => {
                metrics.push(metric);
                return Promise.resolve(null);
            },
        },
    });

    assertEquals(order, ["load-source", "load-source", "ensure-plan", "capture-tree"]);
    assertEquals(metrics.at(-1)?.details.planFileMaterialized, true);
    // The ordering claim is only worth making if the baseline actually contains the Plan
    // that was restored just before it — the stale one recorded on the session did not.
    assertEquals(result.baselineTree !== "stale-tree-without-plan", true);
    const baselineFiles = await git(/** @type {string} */ (result.executionCwd), [
        "ls-tree",
        "-r",
        "--name-only",
        /** @type {string} */ (result.baselineTree),
    ]);
    assertStringIncludes(baselineFiles, "plans/p.md");
});

Deno.test("startActiveExecutionWorkflow rejects an unsafe canonical source before worktree selection or creation", async () => {
    const projectRoot = await makeWorkflowProject([{ name: "p", status: "ready_for_work" }]);
    const hostedSession = makeHostedSession("canonical-source-before-worktree", projectRoot);
    let reuseLookups = 0;
    let ensureCalls = 0;

    await assertRejects(
        () =>
            startActiveExecutionWorkflow({
                planName: "p",
                triageMeta: { planId: PLAN_UNDER_TEST, worktreeId: "wt-recorded" },
                currentStatus: "ready_for_work",
                hostedSession,
                __deps: {
                    probeGitRepository: () => Promise.resolve({ ok: true, state: "work_tree", cwd: "" }),
                    loadCanonicalExecutionPlanSource: () =>
                        Promise.resolve({
                            kind: "symlink",
                            relativePath: "plans/p.md",
                            reason: "Canonical Plan source parent is a symlink at plans.",
                        }),
                    findReusableWorktree: () => {
                        reuseLookups++;
                        return Promise.resolve(null);
                    },
                    ensureExecutionPlanFile: () => {
                        ensureCalls++;
                        return Promise.resolve({ kind: "present", relativePath: "plans/p.md" });
                    },
                },
            }),
        Error,
        "plans/p.md",
    );

    assertEquals(reuseLookups, 0);
    assertEquals(ensureCalls, 0);
    // "Before creation" is a claim about the repository and the registry, so ask them
    // rather than a fake that was told to refuse.
    assertEquals(await listWorktreeRegistryEntries(projectRoot), []);
    assertStringIncludes(await git(projectRoot, ["worktree", "list", "--porcelain"]), projectRoot);
    assertEquals((await git(projectRoot, ["worktree", "list", "--porcelain"])).includes("runwield/worktree"), false);
});

Deno.test("startActiveExecutionWorkflow preserves reused worktree when Plan preparation blocks", async () => {
    const projectRoot = await makeWorkflowProject([{ name: "p", status: "ready_for_work" }]);
    const hostedSession = makeHostedSession("reused-plan-block", projectRoot);
    const reused = await settleWorktreeAttempt(
        projectRoot,
        await createWorktreeGitArtifacts({ projectRoot, planName: "p", planId: PLAN_UNDER_TEST }),
    );

    try {
        await assertRejects(
            () =>
                startActiveExecutionWorkflow({
                    planName: "p",
                    triageMeta: { planId: PLAN_UNDER_TEST, worktreeId: reused.id },
                    currentStatus: "ready_for_work",
                    hostedSession,
                    __deps: {
                        probeGitRepository: () => Promise.resolve({ ok: true, state: "work_tree", cwd: "" }),
                        findReusableWorktree: () => Promise.resolve(reused),
                        resolveCurrentCheckoutBranch: () => Promise.resolve("main"),
                        ensureExecutionPlanFile: () =>
                            Promise.resolve({
                                kind: "malformed",
                                relativePath: "plans/p.md",
                                reason: "malformed Front Matter",
                            }),
                    },
                }),
            Error,
            "plans/p.md",
        );

        // Preservation is the point: a worktree someone may have work in survives a
        // blocked preparation, and the Plan never moved.
        assertEquals((await Deno.stat(reused.path)).isDirectory, true);
        assertEquals((await findWorktreeRegistryEntryById(projectRoot, reused.id))?.status, "active");
        assertEquals((await loadPlan(projectRoot, "p"))?.attrs.status, "ready_for_work");
    } finally {
        await Deno.remove(getTransitionJournalDir(hostedSession.cwd), { recursive: true }).catch(() => {});
    }
});

Deno.test("startActiveExecutionWorkflow preserves failed preparation evidence in the registry and on disk", async () => {
    const projectRoot = await makeWorkflowProject([{ name: "p", status: "ready_for_work" }]);
    const hostedSession = makeHostedSession("fresh-cleanup-failure", projectRoot);
    try {
        await assertRejects(
            () =>
                startActiveExecutionWorkflow({
                    planName: "p",
                    triageMeta: { planId: PLAN_UNDER_TEST },
                    currentStatus: "ready_for_work",
                    hostedSession,
                    __deps: {
                        probeGitRepository: () => Promise.resolve({ ok: true, state: "work_tree", cwd: "" }),
                        findReusableWorktree: () => Promise.resolve(null),
                        ensureExecutionPlanFile: () =>
                            Promise.resolve({
                                kind: "restore_failed",
                                relativePath: "plans/p.md",
                                reason: "disk full",
                            }),
                    },
                }),
            Error,
            "execution worktree evidence was preserved",
        );

        // What actually survives a failed preparation, asserted as it behaves rather than
        // as the error message reads. Two gaps between the two are recorded here on
        // purpose, so a change to either shows up as a failing test:
        //
        //  - The status is "abandoned", not the "execution_failed" the failure path
        //    writes just before throwing. Rolling back the created entry runs
        //    removeEntry(), which downgrades any non-terminal status, so the diagnostic
        //    never survives the rollback that follows it.
        //  - The message says evidence "was preserved at <path>", but the rollback also
        //    removes the worktree when it is clean — and a worktree whose Plan file never
        //    materialized always is. The history entry survives; the directory does not.
        const entries = await listWorktreeRegistryEntries(projectRoot);
        assertEquals(entries.length, 1);
        assertEquals(entries[0].status, "abandoned");
        assertEquals(await Deno.stat(entries[0].path).catch(() => null), null);
    } finally {
        await Deno.remove(getTransitionJournalDir(hostedSession.cwd), { recursive: true }).catch(() => {});
    }
});

Deno.test("startActiveExecutionWorkflow keeps HEAD fallback for untargeted plans", async () => {
    const projectRoot = await makeWorkflowProject([{ name: "untargeted-plan", status: "ready_for_work" }]);
    const hostedSession = makeHostedSession("untargeted-workflow", projectRoot);
    let prepareCalls = 0;
    let reuseLookups = 0;
    const result = await startActiveExecutionWorkflow({
        planName: "untargeted-plan",
        triageMeta: { planId: PLAN_UNDER_TEST, worktreeStatus: "completed" },
        currentStatus: "ready_for_work",
        hostedSession,
        __deps: {
            probeGitRepository: () => Promise.resolve({ ok: true, state: "work_tree", cwd: "" }),
            findReusableWorktree: () => {
                reuseLookups++;
                return Promise.reject(new Error("fresh execution must not reuse by plan name"));
            },
            prepareTargetBranchRef: () => {
                prepareCalls++;
                return Promise.reject(new Error("an untargeted Plan must not prepare a target branch"));
            },
        },
    });

    assertEquals(prepareCalls, 0);
    assertEquals(reuseLookups, 0);
    const entry = await findWorktreeRegistryEntryById(projectRoot, /** @type {string} */ (result.worktreeId));
    // No declared target, so the worktree starts from wherever the checkout is now: the
    // base *ref* stays HEAD, and the base *branch* is resolved to whatever HEAD was on.
    assertEquals(entry?.baseRef, "HEAD");
    assertEquals(result.worktreeBaseBranch, "main");
    assertEquals(
        await git(projectRoot, ["rev-parse", "HEAD"]),
        await git(projectRoot, ["rev-parse", `${result.worktreeBranch}^{commit}`]),
    );
});

Deno.test("startActiveExecutionWorkflow resolves implicit current branch before reusing a recorded worktree", async () => {
    const projectRoot = await makeWorkflowProject([{ name: "untargeted-plan", status: "ready_for_work" }]);
    const hostedSession = makeHostedSession("implicit-target-reuse-workflow", projectRoot);
    const recorded = await settleWorktreeAttempt(
        projectRoot,
        await createWorktreeGitArtifacts({ projectRoot, planName: "untargeted-plan", planId: PLAN_UNDER_TEST }),
    );
    /** @type {unknown[]} */
    const reuseCalls = [];
    const result = await startActiveExecutionWorkflow({
        planName: "untargeted-plan",
        triageMeta: { planId: PLAN_UNDER_TEST, worktreeId: recorded.id },
        currentStatus: "ready_for_work",
        hostedSession,
        __deps: {
            probeGitRepository: () => Promise.resolve({ ok: true, state: "work_tree", cwd: "" }),
            findReusableWorktree: (opts) => {
                reuseCalls.push(opts);
                return Promise.resolve(recorded);
            },
        },
    });

    assertEquals(reuseCalls, [{
        projectRoot,
        planName: "untargeted-plan",
        planId: PLAN_UNDER_TEST,
        worktreeId: recorded.id,
    }]);
    // Reused, not recreated: same attempt, and the Plan never targeted a branch, so the
    // recorded target is the checkout's own branch resolved at reuse time.
    assertEquals(result.worktreeId, recorded.id);
    assertEquals(result.executionCwd, recorded.path);
    assertEquals(result.worktreeBaseBranch, "main");
    const entry = await findWorktreeRegistryEntryById(projectRoot, recorded.id);
    assertEquals(entry?.status, "active");
    assertEquals(entry?.executionBaselineTree, result.baselineTree);
});

Deno.test("startActiveExecutionWorkflow rejects reusable worktree target mismatches", async () => {
    const projectRoot = await makeWorkflowProject([{ name: "targeted-plan", status: "ready_for_work" }]);
    const hostedSession = makeHostedSession("mismatched-workflow", projectRoot);
    let prepareCalls = 0;
    await assertRejects(
        () =>
            startActiveExecutionWorkflow({
                planName: "targeted-plan",
                triageMeta: { planId: "plan-under-test", worktreeId: "wt3", worktreeBaseBranch: "feature-base" },
                currentStatus: "ready_for_work",
                hostedSession,
                __deps: {
                    probeGitRepository: () => Promise.resolve({ ok: true, state: "work_tree", cwd: "" }),
                    findReusableWorktree: () =>
                        Promise.resolve(
                            /** @type {any} */ ({
                                id: "wt3",
                                path: "/tmp/wt3",
                                branch: "runwield/worktree/targeted-plan-wt3",
                                baseBranch: "other-base",
                            }),
                        ),
                    resolveTargetBranchName: () => Promise.resolve("feature-base"),
                    prepareTargetBranchRef: () => {
                        prepareCalls++;
                        return Promise.resolve({ baseRef: "refs/heads/feature-base", baseBranch: "feature-base" });
                    },
                },
            }),
        Error,
        "Existing execution worktree targets other-base, but plan targets feature-base",
    );
    assertEquals(prepareCalls, 0);
    // Refused before anything durable happened.
    assertEquals(await listWorktreeRegistryEntries(projectRoot), []);
});

Deno.test("startActiveExecutionWorkflow matches explicit remote target to recorded local reusable target", async () => {
    const projectRoot = await makeWorkflowProject([{ name: "targeted-plan", status: "ready_for_work" }]);
    const hostedSession = makeHostedSession("remote-reusable-workflow", projectRoot);
    const recorded = await settleWorktreeAttempt(
        projectRoot,
        await createWorktreeGitArtifacts({
            projectRoot,
            planName: "targeted-plan",
            planId: PLAN_UNDER_TEST,
            baseBranch: "feature-base",
        }),
    );
    let prepareCalls = 0;
    const result = await startActiveExecutionWorkflow({
        planName: "targeted-plan",
        triageMeta: { planId: PLAN_UNDER_TEST, worktreeId: recorded.id, worktreeBaseBranch: "origin/feature-base" },
        currentStatus: "ready_for_work",
        hostedSession,
        __deps: {
            probeGitRepository: () => Promise.resolve({ ok: true, state: "work_tree", cwd: "" }),
            findReusableWorktree: () => Promise.resolve(recorded),
            resolveTargetBranchName: () => Promise.resolve("feature-base"),
            prepareTargetBranchRef: () => {
                prepareCalls++;
                return Promise.reject(new Error("a matching reusable target must not be re-prepared"));
            },
        },
    });

    // `origin/feature-base` and the recorded local `feature-base` are the same target, so
    // the existing worktree is reused rather than rejected as a mismatch.
    assertEquals(prepareCalls, 0);
    assertEquals(result.worktreeId, recorded.id);
    assertEquals(result.worktreeBaseBranch, "feature-base");
});

Deno.test("startActiveExecutionWorkflow does not let plan target overwrite unknown active worktree target", async () => {
    const projectRoot = await makeWorkflowProject([{ name: "targeted-plan", status: "ready_for_work" }]);
    const hostedSession = makeHostedSession("unknown-active-target-workflow", projectRoot);
    hostedSession.setActiveExecutionWorkflow({
        planName: "targeted-plan",
        triageMeta: { planId: "plan-under-test" },
        executionAgent: "engineer",
        baselineTree: "tree4",
        projectRoot: "/repo",
        executionCwd: "/tmp/wt4",
        worktreeId: "wt4",
        worktreeBranch: "runwield/worktree/targeted-plan-wt4",
    });
    let prepareCalls = 0;

    await assertRejects(
        () =>
            startActiveExecutionWorkflow({
                planName: "targeted-plan",
                triageMeta: { planId: "plan-under-test", worktreeBaseBranch: "feature-base" },
                currentStatus: "ready_for_work",
                hostedSession,
                __deps: {
                    probeGitRepository: () => Promise.resolve({ ok: true, state: "work_tree", cwd: "" }),
                    findReusableWorktree: () => Promise.reject(new Error("should use active workflow")),
                    resolveTargetBranchName: () => Promise.resolve("feature-base"),
                    prepareTargetBranchRef: () => {
                        prepareCalls++;
                        return Promise.resolve({ baseRef: "refs/heads/feature-base", baseBranch: "feature-base" });
                    },
                },
            }),
        Error,
        "Existing execution worktree targets HEAD/current checkout, but plan targets feature-base",
    );
    assertEquals(prepareCalls, 0);
});

Deno.test("startActiveExecutionWorkflow prompts once and uses CWD for non-Git in-place execution", async () => {
    const projectRoot = await makeWorkflowProject([{ name: "non-git-plan", status: "ready_for_work" }]);
    const hostedSession = makeHostedSession("non-git-feature-workflow", projectRoot);
    /** @type {string[]} */
    const prompts = [];
    const result = await startActiveExecutionWorkflow({
        planName: "non-git-plan",
        triageMeta: { planId: "plan-under-test", classification: "FEATURE" },
        currentStatus: "ready_for_work",
        hostedSession,
        __deps: {
            probeGitRepository: () => Promise.resolve({ ok: false, state: "not_git", cwd: projectRoot }),
            hasNonGitExecutionConsent: () => false,
            confirmNonGitFeaturePlanExecution: (_session, projectRoot) => {
                const prompt = `non git prompt:${projectRoot}`;
                prompts.push(prompt);
                return Promise.resolve(true);
            },
            findReusableWorktree: () => Promise.reject(new Error("should not inspect worktrees")),
            captureWorktreeTree: () => Promise.reject(new Error("should not capture git tree")),
        },
    });

    assertEquals(prompts, [`non git prompt:${projectRoot}`]);
    assertEquals(result.executionCwd, projectRoot);
    assertEquals(result.nonGitInPlace, true);
    assertEquals(result.worktreeId, undefined);
    assertEquals(hostedSession.getActiveExecutionWorkflow()?.nonGitInPlace, true);
    assertEquals(hostedSession.getActiveExecutionWorkflow()?.executionStarted, true);
    // The non-Git decision is durable Plan state, not just an event payload.
    const started = await loadPlan(projectRoot, "non-git-plan");
    assertEquals(started?.attrs.status, "in_progress");
    assertEquals(started?.attrs.executionMode, "non_git_in_place");
});

Deno.test("startActiveExecutionWorkflow cancels non-Git execution without consent", async () => {
    const projectRoot = await makeWorkflowProject([{ name: "non-git-plan", status: "ready_for_work" }]);
    const hostedSession = makeHostedSession("non-git-feature-cancel-workflow", projectRoot);
    await assertRejects(
        () =>
            startActiveExecutionWorkflow({
                planName: "non-git-plan",
                triageMeta: { planId: PLAN_UNDER_TEST, classification: "FEATURE" },
                currentStatus: "ready_for_work",
                hostedSession,
                __deps: {
                    probeGitRepository: () => Promise.resolve({ ok: false, state: "not_git", cwd: projectRoot }),
                    hasNonGitExecutionConsent: () => false,
                    confirmNonGitFeaturePlanExecution: () => Promise.resolve(false),
                },
            }),
        Error,
        "in-place execution was not approved",
    );
    assertEquals(hostedSession.getActiveExecutionWorkflow(), null);
    // Refusing consent leaves the Plan exactly where it was.
    assertEquals((await loadPlan(projectRoot, "non-git-plan"))?.attrs.status, "ready_for_work");
});

Deno.test("startActiveExecutionWorkflow does not activate Frontend Engineer before non-Git consent commits", async () => {
    const projectRoot = await makeWorkflowProject([{ name: "visual-plan", status: "ready_for_work" }]);
    const hostedSession = makeHostedSession("frontend-non-git-cancel-workflow", projectRoot);
    await assertRejects(
        () =>
            startActiveExecutionWorkflow({
                planName: "visual-plan",
                triageMeta: {
                    planId: PLAN_UNDER_TEST,
                    classification: "FEATURE",
                    executionAgent: "frontend-engineer",
                },
                currentStatus: "ready_for_work",
                hostedSession,
                __deps: {
                    probeGitRepository: () => Promise.resolve({ ok: false, state: "not_git", cwd: projectRoot }),
                    hasNonGitExecutionConsent: () => false,
                    confirmNonGitFeaturePlanExecution: () => Promise.resolve(false),
                },
            }),
        Error,
        "in-place execution was not approved",
    );

    assertEquals(hostedSession.getActiveExecutionWorkflow(), null);
    assertEquals((await loadPlan(projectRoot, "visual-plan"))?.attrs.status, "ready_for_work");
});

Deno.test("readLatestPlanOutcome returns the latest plan_written outcome", () => {
    const messages = [
        /** @type {any} */ ({
            role: "toolResult",
            toolName: "plan_written",
            details: { planName: "first", outcome: "feedback" },
        }),
        /** @type {any} */ ({
            role: "toolResult",
            toolName: "plan_written",
            content: [
                { type: "text", text: "approved" },
                { type: "image", data: "YXBwcm92ZWQ=", mimeType: "image/png" },
            ],
            details: {
                planName: "first",
                outcome: "approved_execute",
                triageMeta: { classification: "FEATURE" },
                feedback: "Keep the selected command.",
            },
        }),
    ];
    assertEquals(readLatestPlanOutcome(messages), {
        outcome: "approved_execute",
        planName: "first",
        triageMeta: { classification: "FEATURE" },
        feedback: "Keep the selected command.",
        images: [{ base64: "YXBwcm92ZWQ=", mimeType: "image/png" }],
    });
});

Deno.test("readLatestPlanOutcome returns null when no plan_written tool result is present", () => {
    assertEquals(readLatestPlanOutcome([]), null);
});

Deno.test("extractAssistantOutput falls back to task_completed message details", () => {
    const messages = [
        /** @type {any} */ ({
            role: "assistant",
            content: [{
                type: "tool_use",
                name: "task_completed",
                input: { message: "Implemented isolated worktree setup." },
            }],
        }),
        /** @type {any} */ ({
            role: "toolResult",
            toolName: "task_completed",
            details: {
                outcome: "task_completed",
                message: "Implemented isolated worktree setup.",
            },
        }),
    ];

    assertEquals(extractAssistantOutput(messages), "Implemented isolated worktree setup.");
});

Deno.test("extractAssistantOutput handles legacy assistant text shapes", () => {
    assertEquals(
        extractAssistantOutput([
            /** @type {any} */ ({ role: "assistant", content: "Plain legacy summary." }),
        ]),
        "Plain legacy summary.",
    );
    assertEquals(
        extractAssistantOutput([
            /** @type {any} */ ({ role: "assistant", content: [{ contentText: "Content text summary." }] }),
        ]),
        "Content text summary.",
    );
});

Deno.test("executePlan refuses to execute PROJECT Epic containers", async () => {
    /** @type {string[]} */
    const messages = [];
    const hostedSession = makeHostedSession("epic-execution");
    hostedSession.setEventSink((/** @type {{ message?: string }} */ event) => {
        if (event.message) messages.push(event.message);
    });
    let engineerCalled = false;
    const result = await executePlan({
        planName: "epic-plan",
        triageMeta: { classification: "PROJECT" },
        hostedSession,
        __deps: {
            loadPlan: () =>
                Promise.resolve(
                    /** @type {any} */ ({
                        attrs: { status: "ready_for_work", classification: "PROJECT" },
                        body: "## Epic",
                        markdown: "## Epic",
                    }),
                ),
            executeSingleEngineerPlan: () => {
                engineerCalled = true;
                return Promise.resolve({ repairRequired: false, executionComplete: true });
            },
        },
    });

    assertEquals(result.executionComplete, false);
    assertEquals(engineerCalled, false);
    assertStringIncludes(result.error || "", "PROJECT Epic container");
    assertEquals(messages.some((message) => message.includes("cannot be executed directly")), true);
});

Deno.test("executePlan refuses persisted Epic containers even when triage meta overrides classification", async () => {
    let engineerCalled = false;
    const result = await executePlan({
        planName: "epic-plan",
        triageMeta: { classification: "FEATURE" },
        hostedSession: makeHostedSession("persisted-epic-execution"),
        __deps: {
            loadPlan: () =>
                Promise.resolve(
                    /** @type {any} */ ({
                        attrs: { status: "ready_for_work", classification: "PROJECT" },
                        body: "## Epic",
                        markdown: "## Epic",
                    }),
                ),
            executeSingleEngineerPlan: () => {
                engineerCalled = true;
                return Promise.resolve({ repairRequired: false, executionComplete: true });
            },
        },
    });

    assertEquals(result.executionComplete, false);
    assertEquals(engineerCalled, false);
    assertStringIncludes(result.error || "", "PROJECT Epic container");
});

Deno.test("executePlan asks to reopen review when approved Plan cannot be loaded", async () => {
    const hostedSession = makeHostedSession("missing-plan-recovery");
    const requests = /** @type {string[]} */ ([]);
    const result = await executePlan({
        planName: "missing-plan",
        triageMeta: { classification: "FEATURE" },
        hostedSession,
        __deps: {
            loadPlan: () => Promise.resolve(null),
            requestPlanReview: (_session, request) => {
                requests.push(request.type);
                if (request.type === "approval") return Promise.resolve({ outcome: "canceled", value: false });
                return Promise.resolve({ outcome: "canceled" });
            },
            recordWorkflowMetric: () => Promise.resolve(null),
        },
    });

    assertEquals(requests, ["approval"]);
    assertEquals(result.intentionalComplete, true);
    assertEquals(result.intentionalCompleteReason, "plan_not_found");
    assertEquals(result.message, SESSION_COMPLETE_GUIDANCE);
});

Deno.test("executePlan recovers unreadable Plan load errors with review retry prompt", async () => {
    const hostedSession = makeHostedSession("unreadable-plan-recovery");
    const requests = /** @type {string[]} */ ([]);
    const result = await executePlan({
        planName: "broken-plan",
        triageMeta: { classification: "FEATURE" },
        hostedSession,
        __deps: {
            loadPlan: () => Promise.reject(new Error("front matter malformed")),
            requestPlanReview: (_session, request) => {
                requests.push(request.type);
                if (request.type === "approval") return Promise.resolve({ outcome: "canceled", value: false });
                return Promise.resolve({ outcome: "canceled" });
            },
            recordWorkflowMetric: () => Promise.resolve(null),
        },
    });

    assertEquals(requests, ["approval"]);
    assertEquals(result.intentionalComplete, true);
    assertEquals(result.intentionalCompleteReason, "plan_load_failed");
});

Deno.test("executePlan returns to review recovery when approved recovery still cannot load Plan", async () => {
    const hostedSession = makeHostedSession("post-review-load-failure-loop");
    const requests = /** @type {string[]} */ ([]);
    const result = await executePlan({
        planName: "still-missing-plan",
        triageMeta: { classification: "FEATURE" },
        hostedSession,
        __deps: {
            loadPlan: () => Promise.resolve(null),
            requestPlanReview: (_session, request) => {
                requests.push(request.type);
                if (request.type === "approval") {
                    const approvalCount = requests.filter((type) => type === "approval").length;
                    return Promise.resolve({
                        outcome: approvalCount === 1 ? "accepted" : "canceled",
                        value: approvalCount === 1,
                    });
                }
                return Promise.resolve({ outcome: "accepted", _meta: { approved: true, approvalAction: "run" } });
            },
            recordWorkflowMetric: () => Promise.resolve(null),
        },
    });

    assertEquals(requests, ["approval", "plan_review", "approval"]);
    assertEquals(result.intentionalComplete, true);
    assertEquals(result.intentionalCompleteReason, "plan_not_found");
    assertEquals(result.message, SESSION_COMPLETE_GUIDANCE);
});

Deno.test("executePlan routes recovered Approve & Run through readiness before execution", async () => {
    const projectRoot = await makeWorkflowProject([{ name: "missing-plan", status: "approved" }]);
    const hostedSession = makeHostedSession("missing-plan-reapproved", projectRoot);
    let loadCount = 0;
    let executed = false;
    const events = /** @type {string[]} */ ([]);
    const result = await executePlan({
        planName: "missing-plan",
        triageMeta: { classification: "FEATURE" },
        hostedSession,
        __deps: {
            loadPlan: () => {
                loadCount++;
                if (loadCount === 1) return Promise.resolve(null);
                return Promise.resolve(
                    /** @type {any} */ ({
                        path: "/repo/plans/missing-plan.md",
                        markdown: "# Plan",
                        body: "# Plan",
                        attrs: { classification: "FEATURE", status: "approved" },
                    }),
                );
            },
            requestPlanReview: (_session, request) => {
                if (request.type === "approval") return Promise.resolve({ outcome: "accepted", value: true });
                return Promise.resolve({ outcome: "accepted", _meta: { approved: true, approvalAction: "run" } });
            },
            executeSingleEngineerPlan: (/** @type {any} */ options) => {
                events.push(`execute:${options.triageMeta.status}`);
                executed = true;
                return Promise.resolve({
                    repairRequired: false,
                    executionComplete: true,
                    executionContext: {
                        planName: "missing-plan",
                        triageMeta: { classification: "FEATURE" },
                        executionAgent: "engineer",
                        executionMode: "non_git_in_place",
                        projectRoot: Deno.cwd(),
                        executionCwd: Deno.cwd(),
                        nonGitInPlace: true,
                    },
                });
            },
            markActiveWorktreeStatus: () => Promise.resolve(),
            recordPlanEvent: (/** @type {any} */ event) => {
                events.push(event.event);
                return Promise.resolve(/** @type {any} */ ({ status: "ready_for_work" }));
            },
            recordWorkflowMetric: () => Promise.resolve(null),
        },
    });

    // Execution saw ready_for_work, which is only reachable from approved via
    // readiness_passed — and the Plan then ran through to implemented.
    assertEquals(events.slice(0, 1), ["execute:ready_for_work"]);
    assertEquals((await loadPlan(projectRoot, "missing-plan"))?.attrs.status, "implemented");
    assertEquals(executed, true);
    assertEquals(result.executionComplete, true);
});

Deno.test("executePlan forwards recovered approval feedback images to Engineer after load failure", async () => {
    const projectRoot = await makeWorkflowProject([{ name: "missing-plan", status: "approved" }]);
    const hostedSession = makeHostedSession("missing-plan-approved-images", projectRoot);
    let loadCount = 0;
    const reviewImages = [{ base64: "YXBwcm92ZWQ=", mimeType: "image/png" }];
    /** @type {any} */
    let executionRequest = null;
    const result = await executePlan({
        planName: "missing-plan",
        triageMeta: { classification: "FEATURE" },
        hostedSession,
        __deps: {
            loadPlan: () => {
                loadCount++;
                if (loadCount === 1) return Promise.resolve(null);
                return Promise.resolve(
                    /** @type {any} */ ({
                        path: "/repo/plans/missing-plan.md",
                        markdown: "# Plan",
                        body: "# Plan",
                        attrs: { classification: "FEATURE", status: "approved" },
                    }),
                );
            },
            requestPlanReview: (_session, request) => {
                if (request.type === "approval") return Promise.resolve({ outcome: "accepted", value: true });
                return Promise.resolve({
                    outcome: "accepted",
                    _meta: {
                        approved: true,
                        approvalAction: "run",
                        feedback: "Use these approved notes.",
                        images: reviewImages,
                    },
                });
            },
            executeSingleEngineerPlan: (/** @type {any} */ request) => {
                executionRequest = request;
                return Promise.resolve({ repairRequired: false, executionComplete: false });
            },
            recordPlanEvent: () => Promise.resolve(/** @type {any} */ ({ status: "ready_for_work" })),
            recordWorkflowMetric: () => Promise.resolve(null),
        },
    });

    assertEquals(executionRequest.reviewFeedback, "Use these approved notes.");
    assertEquals(executionRequest.reviewImages, reviewImages);
    assertEquals(result.executionComplete, false);
});

Deno.test("executePlan preserves remote review outcome during load-failure recovery", async () => {
    const hostedSession = makeHostedSession("missing-plan-remote-review");
    const requests = /** @type {string[]} */ ([]);
    const messages = /** @type {string[]} */ ([]);
    hostedSession.setEventSink((/** @type {{ message?: string }} */ event) => {
        if (event.message) messages.push(event.message);
    });
    let plannerCalled = false;
    const result = await executePlan({
        planName: "missing-plan",
        triageMeta: { classification: "FEATURE" },
        hostedSession,
        __deps: {
            loadPlan: () => Promise.resolve(null),
            requestPlanReview: (_session, request) => {
                requests.push(request.type);
                if (request.type === "approval") return Promise.resolve({ outcome: "accepted", value: true });
                return Promise.resolve({
                    outcome: "accepted",
                    message: "Plan saved for remote review.",
                    _meta: { remoteReview: true, approved: false, reviewerUrl: "https://review.example/plan" },
                });
            },
            runActiveAgentTurn: () => {
                plannerCalled = true;
                return Promise.resolve([]);
            },
            recordWorkflowMetric: () => Promise.resolve(null),
        },
    });

    assertEquals(requests, ["approval", "plan_review"]);
    assertEquals(plannerCalled, false);
    assertEquals(result.intentionalComplete, true);
    assertEquals(result.intentionalCompleteReason, "remote_review");
    assertEquals(result.message, "Plan saved for remote review.");
    assertEquals(messages.some((message) => message.includes(SESSION_COMPLETE_GUIDANCE)), false);
});

Deno.test("executePlan forwards recovered Feedback images to Planner after load failure", async () => {
    const hostedSession = makeHostedSession("missing-plan-feedback-images");
    const reviewImages = [{ base64: "aW1hZ2U=", mimeType: "image/png" }];
    let plannerImages;
    const result = await executePlan({
        planName: "missing-plan",
        triageMeta: { classification: "FEATURE" },
        hostedSession,
        __deps: {
            loadPlan: () => Promise.resolve(null),
            requestPlanReview: () =>
                Promise.resolve({
                    outcome: "accepted",
                    _meta: { approved: false, feedback: "Revise with this screenshot.", images: reviewImages },
                }),
            runActiveAgentTurn: (/** @type {any} */ options) => {
                plannerImages = options.images;
                return Promise.resolve([]);
            },
            recordWorkflowMetric: () => Promise.resolve(null),
        },
    });

    assertEquals(plannerImages, reviewImages);
    assertEquals(result.executionComplete, false);
});

Deno.test("executePlan loops through repeated unanswered recovered reviews until answered", async () => {
    const projectRoot = await makeWorkflowProject([{ name: "missing-plan", status: "approved" }]);
    const hostedSession = makeHostedSession("missing-plan-review-loop", projectRoot);
    let loadCount = 0;
    const reviewResponses = /** @type {any[]} */ ([
        { outcome: "canceled" },
        { outcome: "canceled" },
        { outcome: "accepted", _meta: { approved: true, approvalAction: "later" } },
    ]);
    const requests = /** @type {string[]} */ ([]);
    const result = await executePlan({
        planName: "missing-plan",
        triageMeta: { classification: "FEATURE" },
        hostedSession,
        __deps: {
            loadPlan: () => {
                loadCount++;
                if (loadCount === 1) return Promise.resolve(null);
                return Promise.resolve(
                    /** @type {any} */ ({
                        path: "/repo/plans/missing-plan.md",
                        markdown: "# Plan",
                        body: "# Plan",
                        attrs: { classification: "FEATURE", status: "approved" },
                    }),
                );
            },
            requestPlanReview: (_session, request) => {
                requests.push(request.type);
                if (request.type === "approval") return Promise.resolve({ outcome: "accepted", value: true });
                return Promise.resolve(reviewResponses.shift());
            },
            recordPlanEvent: () => Promise.resolve(/** @type {any} */ ({ status: "ready_for_work" })),
            recordWorkflowMetric: () => Promise.resolve(null),
        },
    });

    assertEquals(requests, ["approval", "plan_review", "approval", "plan_review", "approval", "plan_review"]);
    assertEquals(result.intentionalComplete, true);
    assertEquals(result.intentionalCompleteReason, "saved_for_later");
});

Deno.test("executePlan treats recovered Approve for Later as session complete", async () => {
    const projectRoot = await makeWorkflowProject([{ name: "missing-plan", status: "approved" }]);
    const hostedSession = makeHostedSession("missing-plan-save-later", projectRoot);
    let loadCount = 0;
    const result = await executePlan({
        planName: "missing-plan",
        triageMeta: { classification: "FEATURE" },
        hostedSession,
        __deps: {
            loadPlan: () => {
                loadCount++;
                if (loadCount === 1) return Promise.resolve(null);
                return Promise.resolve(
                    /** @type {any} */ ({
                        path: "/repo/plans/missing-plan.md",
                        markdown: "# Plan",
                        body: "# Plan",
                        attrs: { classification: "FEATURE", status: "approved" },
                    }),
                );
            },
            requestPlanReview: () =>
                Promise.resolve({ outcome: "accepted", _meta: { approved: true, approvalAction: "later" } }),
            recordPlanEvent: () => Promise.resolve(/** @type {any} */ ({ status: "ready_for_work" })),
            recordWorkflowMetric: () => Promise.resolve(null),
        },
    });

    assertEquals(result.executionComplete, false);
    assertEquals(result.intentionalComplete, true);
    assertEquals(result.intentionalCompleteReason, "saved_for_later");
    assertEquals(result.message, SESSION_COMPLETE_GUIDANCE);
});

Deno.test("finalizePlanImplementation checkpoints worktree changes before lifecycle completion", async () => {
    const projectRoot = await makeWorkflowProject([{ name: "feature-plan", status: "in_progress" }]);
    // A real worktree on a real branch. The checkpoint is RunWield's own policy — it
    // commits the Agent's work and refuses to return while the tree is still dirty —
    // so a stand-in returning a plausible SHA replaces the behaviour under test with
    // an assertion that the test itself wrote the answer.
    const worktree = await settleWorktreeAttempt(
        projectRoot,
        await createWorktreeGitArtifacts({ projectRoot, planName: "feature-plan", planId: PLAN_UNDER_TEST }),
    );
    const branchHeadBefore = await git(projectRoot, ["rev-parse", `${worktree.branch}^{commit}`]);
    await Deno.writeTextFile(`${worktree.path}/implemented.txt`, "the Agent's work\n");

    /** @type {string[]} */
    const order = [];
    /** @type {string | undefined} */
    let statusWhenRegistryRan;
    /** @type {string | undefined} */
    let branchHeadWhenRegistryRan;
    const executionContext = /** @type {const} */ ({
        planName: "feature-plan",
        triageMeta: { classification: "FEATURE" },
        executionAgent: "engineer",
        executionMode: "worktree",
        projectRoot,
        executionCwd: worktree.path,
        baselineTree: "attempt-tree",
        worktreeId: worktree.id,
        worktreeBranch: worktree.branch,
    });

    const result = await finalizePlanImplementation({
        projectRoot,
        planName: "feature-plan",
        triageMeta: { classification: "FEATURE", summary: "Preserve completed implementation work." },
        executionContext,
        executionReport: "- Implemented.",
        __deps: {
            markActiveWorktreeStatus: async (status, /** @type {any} */ options) => {
                order.push(`registry:${status}:${options.workflow?.worktreeId}`);
                // Ordering read from the world rather than from a recorded call: by
                // the time the registry is told the attempt completed, the commit
                // holding that work must already exist.
                statusWhenRegistryRan = (await loadPlan(projectRoot, "feature-plan"))?.attrs.status;
                branchHeadWhenRegistryRan = await git(projectRoot, ["rev-parse", `${worktree.branch}^{commit}`]);
            },
            recordWorkflowMetric: (/** @type {any} */ metric) => {
                order.push(`metric:${metric.event}:${metric.details.checkpointCommitted}`);
                return Promise.resolve(null);
            },
        },
    });

    const branchHeadAfter = await git(projectRoot, ["rev-parse", `${worktree.branch}^{commit}`]);
    assertEquals(result, { implementationCommit: branchHeadAfter });
    assertEquals(order, [
        "registry:completed:" + worktree.id,
        "metric:implementation_finished:true",
    ]);
    assertEquals(
        branchHeadWhenRegistryRan,
        branchHeadAfter,
        "the checkpoint commits before anything else is told the attempt finished",
    );
    // The registry is settled after the lifecycle transition, not before it. What
    // guarantees the commit precedes the Plan's claim is that a failing checkpoint
    // leaves the lifecycle untouched, which
    // "executePlan does not mark implementation complete when checkpointing fails"
    // proves from the outside — a stronger statement than watching call order.
    assertEquals(statusWhenRegistryRan, "implemented");
    assertEquals(branchHeadAfter === branchHeadBefore, false, "the Agent's work must be committed to the branch");
    // The checkpoint's own contract: nothing left behind in the worktree.
    assertEquals(await git(worktree.path, ["status", "--porcelain"]), "");
    const finalized = await loadPlan(projectRoot, "feature-plan");
    assertEquals(finalized?.attrs.status, "implemented");
    assertEquals(finalized?.attrs.executionReport, "- Implemented.");
    assertEquals(finalized?.attrs.worktreeId, worktree.id);
    assertEquals(finalized?.attrs.executionBaselineTree, "attempt-tree");
});

Deno.test("finalizePlanImplementation restores missing execution_started before lifecycle completion", async () => {
    const projectRoot = await makeWorkflowProject([{ name: "feature-plan", status: "ready_for_work" }]);
    const worktree = await settleWorktreeAttempt(
        projectRoot,
        await createWorktreeGitArtifacts({ projectRoot, planName: "feature-plan", planId: PLAN_UNDER_TEST }),
    );
    await Deno.writeTextFile(`${worktree.path}/recovered.txt`, "work done before the marker was lost\n");

    /** @type {string[]} */
    const order = [];
    /** @type {string | undefined} */
    let branchHeadWhenRegistryRan;
    const executionContext = /** @type {const} */ ({
        planName: "feature-plan",
        triageMeta: { classification: "FEATURE" },
        executionAgent: "engineer",
        executionMode: "worktree",
        projectRoot,
        executionCwd: worktree.path,
        baselineTree: "attempt-tree",
        worktreeId: worktree.id,
        worktreeBranch: worktree.branch,
    });

    await finalizePlanImplementation({
        projectRoot,
        planName: "feature-plan",
        triageMeta: { classification: "FEATURE", summary: "Recover lifecycle marker order." },
        executionContext,
        executionReport: "- Implemented after marker recovery.",
        __deps: {
            markActiveWorktreeStatus: async (status) => {
                order.push(`registry:${status}`);
                branchHeadWhenRegistryRan = await git(projectRoot, ["rev-parse", `${worktree.branch}^{commit}`]);
            },
            recordWorkflowMetric: (/** @type {any} */ metric) => {
                order.push(`metric:${metric.event}:${metric.details.checkpointCommitted}`);
                return Promise.resolve(null);
            },
        },
    });

    assertEquals(order, ["registry:completed", "metric:implementation_finished:true"]);
    assertEquals(
        branchHeadWhenRegistryRan,
        await git(projectRoot, ["rev-parse", `${worktree.branch}^{commit}`]),
        "the checkpoint commits before the attempt is recorded as finished",
    );
    assertEquals(await git(worktree.path, ["status", "--porcelain"]), "");
    const finalized = await loadPlan(projectRoot, "feature-plan");
    assertEquals(
        finalized?.attrs.status,
        "implemented",
        "implemented is unreachable from ready_for_work unless execution_started was restored first",
    );
});

Deno.test("finalizePlanImplementation fails closed without durable execution context", async () => {
    let lifecycleMutated = false;
    await assertRejects(
        () =>
            finalizePlanImplementation({
                projectRoot: "/project",
                planName: "feature-plan",
                triageMeta: { classification: "FEATURE" },
                executionContext: null,
                __deps: {
                    recordPlanEvent: () => {
                        lifecycleMutated = true;
                        return Promise.resolve(/** @type {any} */ ({}));
                    },
                },
            }),
        Error,
        "durable execution context is missing",
    );
    assertEquals(lifecycleMutated, false);
});

Deno.test("executePlan does not mark implementation complete when checkpointing fails", async () => {
    const projectRoot = await makeWorkflowProject([{ name: "feature-plan", status: "ready_for_work" }]);
    // A path Git cannot checkpoint. The failure comes from the real checkpoint
    // refusing an execution directory that is not a worktree, rather than from a
    // stand-in told to reject — which would have proved only that the test can throw.
    const unusableExecutionCwd = await Deno.makeTempDir({ prefix: "runwield-not-a-worktree-" });
    let lifecycleMutated = false;
    const executionContext = /** @type {const} */ ({
        planName: "feature-plan",
        triageMeta: { classification: "FEATURE" },
        executionAgent: "engineer",
        executionMode: "worktree",
        projectRoot,
        executionCwd: unusableExecutionCwd,
        worktreeId: "wt-1",
        worktreeBranch: "runwield/worktree/feature-plan",
    });
    const result = await executePlan({
        planName: "feature-plan",
        triageMeta: { classification: "FEATURE" },
        hostedSession: makeHostedSession("checkpoint-failure", projectRoot),
        __deps: {
            executeSingleEngineerPlan: () =>
                Promise.resolve({
                    repairRequired: false,
                    executionComplete: true,
                    executionContext,
                }),
            recordPlanEvent: () => {
                lifecycleMutated = true;
                return Promise.resolve(/** @type {any} */ ({}));
            },
            recordWorkflowMetric: () => Promise.resolve(null),
        },
    });

    assertEquals(result.executionComplete, false);
    assertEquals(result.repairRequired, true);
    assertStringIncludes(result.error || "", "Git operation requires a Git repository");
    assertEquals(result.executionContext, executionContext);
    assertEquals(lifecycleMutated, false);
    await Deno.remove(unusableExecutionCwd, { recursive: true }).catch(() => {});
});

Deno.test("executePlan still executes ready FEATURE plans", async () => {
    const projectRoot = await makeWorkflowProject([{ name: "feature-plan", status: "ready_for_work" }]);
    let engineerCalled = false;
    /** @type {string[]} */
    const events = [];
    /** @type {any[]} */
    const planEventDetails = [];
    /** @type {any[]} */
    const metrics = [];
    const executionContext = /** @type {const} */ ({
        planName: "feature-plan",
        triageMeta: { classification: "FEATURE" },
        executionAgent: "engineer",
        executionMode: "non_git_in_place",
        projectRoot: Deno.cwd(),
        executionCwd: Deno.cwd(),
        nonGitInPlace: true,
    });
    const result = await executePlan({
        planName: "feature-plan",
        triageMeta: { classification: "FEATURE" },
        hostedSession: makeHostedSession("feature-execution", projectRoot),
        reviewFeedback: "Keep the selected command.",
        reviewImages: [{ base64: "YXBwcm92ZWQ=", mimeType: "image/png" }],
        __deps: {
            loadPlan: () =>
                Promise.resolve(
                    /** @type {any} */ ({
                        attrs: { status: "ready_for_work", classification: "FEATURE" },
                        body: "## Feature",
                        markdown: "## Feature",
                    }),
                ),
            executeSingleEngineerPlan: (/** @type {any} */ { triageMeta, reviewFeedback, reviewImages }) => {
                engineerCalled = true;
                assertEquals(triageMeta.classification, "FEATURE");
                assertEquals(reviewFeedback, "Keep the selected command.");
                assertEquals(reviewImages, [{ base64: "YXBwcm92ZWQ=", mimeType: "image/png" }]);
                return Promise.resolve({
                    repairRequired: false,
                    executionComplete: true,
                    executionContext,
                    completionReport: "- Implemented.\n- Verified.",
                });
            },
            recordPlanEvent: (/** @type {any} */ { event, details }) => {
                events.push(event);
                planEventDetails.push(details);
                return Promise.resolve(/** @type {any} */ ({}));
            },
            markActiveWorktreeStatus: () => Promise.resolve(),
            recordWorkflowMetric: (/** @type {any} */ metric) => {
                metrics.push(metric);
                return Promise.resolve(null);
            },
        },
    });

    assertEquals(result, {
        repairRequired: false,
        executionComplete: true,
        executionContext,
        completionReport: "- Implemented.\n- Verified.",
    });
    assertEquals(engineerCalled, true);
    // The lifecycle ran for real, so the Plan itself is the evidence.
    const finalized = await loadPlan(projectRoot, "feature-plan");
    assertEquals(finalized?.attrs.status, "implemented");
    assertEquals(finalized?.attrs.executionReport, "- Implemented.\n- Verified.");
    assertEquals(
        metrics.some((metric) =>
            metric.category === "execution" && metric.event === "plan_execution_started" &&
            metric.planName === "feature-plan"
        ),
        true,
    );
    assertEquals(
        metrics.some((metric) =>
            metric.category === "execution" && metric.event === "plan_execution_result" &&
            metric.details.executionComplete === true
        ),
        true,
    );
    assertEquals(
        metrics.some((metric) => metric.category === "execution" && metric.event === "implementation_finished"),
        true,
    );
});

Deno.test("executePlan dispatches explicit Frontend Engineer from loaded Plan metadata", async () => {
    const projectRoot = await makeWorkflowProject([{ name: "visual-feature", status: "ready_for_work" }]);
    let dispatchedAgent = "";
    let engineerRequest = "";
    const result = await executePlan({
        planName: "visual-feature",
        triageMeta: { planId: "plan-under-test", classification: "FEATURE", executionAgent: "engineer" },
        hostedSession: makeHostedSession("frontend-execution", projectRoot),
        __deps: {
            loadPlan: () =>
                Promise.resolve(
                    /** @type {any} */ ({
                        attrs: {
                            planId: "plan-under-test",
                            status: "ready_for_work",
                            routingIntent: "PLANNED_CHANGE",
                            classification: "PLANNED_CHANGE",
                            workKind: "FEATURE",
                            complexity: "MEDIUM",
                            summary: "Implement the visual feature.",
                            affectedPaths: ["src/ui/feature.tsx"],
                            executionAgent: "frontend-engineer",
                            collaborationRecommendation: "pair",
                        },
                        body: "## Visual Feature",
                        markdown: "## Visual Feature",
                    }),
                ),
            runActiveAgentTurn: (/** @type {any} */ opts) => {
                dispatchedAgent = opts.agentName;
                engineerRequest = opts.userRequest;
                return Promise.resolve(
                    /** @type {any} */ ([{
                        role: "toolResult",
                        toolName: "task_completed",
                        details: { outcome: "task_completed" },
                    }]),
                );
            },
            probeGitRepository: () => Promise.resolve({ ok: false, state: "git_missing", cwd: Deno.cwd() }),
            hasNonGitExecutionConsent: () => true,
            markActiveWorktreeStatus: () => Promise.resolve(),
            recordWorkflowMetric: () => Promise.resolve(null),
        },
    });

    assertEquals(result.executionComplete, true);
    assertEquals(dispatchedAgent, "frontend-engineer");
    assertStringIncludes(engineerRequest, "- Routing Intent: PLANNED_CHANGE");
    assertStringIncludes(engineerRequest, "- Plan Classification: PLANNED_CHANGE");
    assertStringIncludes(engineerRequest, "- Work Kind: FEATURE");
    assertStringIncludes(engineerRequest, "- Summary: Implement the visual feature.");
    assertStringIncludes(engineerRequest, "- Affected paths: src/ui/feature.tsx");
});

Deno.test("executePlan uses the Plan Pair recommendation and injects one workflow checkpoint tool", async () => {
    const projectRoot = await makeWorkflowProject([{ name: "visual-feature", status: "ready_for_work" }]);
    const hostedSession = makeHostedSession("pair-execution", projectRoot);
    /** @type {any} */
    let activeTurn = null;
    hostedSession.setInteractionAdapter({
        supportsInteraction: (type) => type === "pair_checkpoint",
        requestInteraction: () => {
            throw new Error("approve & run must not prompt for collaboration style");
        },
    });

    const result = await executePlan({
        planName: "visual-feature",
        triageMeta: { planId: "plan-under-test", classification: "FEATURE" },
        hostedSession,
        __deps: {
            loadPlan: () =>
                Promise.resolve(
                    /** @type {any} */ ({
                        attrs: {
                            planId: "plan-under-test",
                            status: "ready_for_work",
                            classification: "FEATURE",
                            executionAgent: "frontend-engineer",
                            collaborationRecommendation: "pair",
                        },
                        body: "## Visual Feature",
                    }),
                ),
            runActiveAgentTurn: (/** @type {any} */ opts) => {
                activeTurn = opts;
                return Promise.resolve(
                    /** @type {any} */ ([{
                        role: "toolResult",
                        toolName: "task_completed",
                        details: { outcome: "task_completed", message: "- Done." },
                    }]),
                );
            },
            probeGitRepository: () => Promise.resolve({ ok: false, state: "git_missing", cwd: Deno.cwd() }),
            hasNonGitExecutionConsent: () => true,
            recordPlanEvent: () => Promise.resolve(/** @type {any} */ ({})),
            markActiveWorktreeStatus: () => Promise.resolve(),
            recordWorkflowMetric: () => Promise.resolve(null),
        },
    });

    assertEquals(result.executionComplete, true);
    assertEquals(activeTurn.agentName, "frontend-engineer");
    assertEquals(activeTurn.customTools.map((/** @type {any} */ tool) => tool.name), ["pair_checkpoint"]);
    assertStringIncludes(activeTurn.userRequest, "Pair Execution is active");
    assertEquals(hostedSession.getActiveExecutionWorkflow()?.collaborationStyle, "pair");
    assertEquals(hostedSession.getActiveExecutionWorkflow()?.pairCheckpointCount, 0);
});

Deno.test("executePlan runs autonomously when Plan recommends autonomous without prompting", async () => {
    const hostedSession = makeHostedSession("frontend-autonomous-recommendation");
    hostedSession.setInteractionAdapter({
        supportsInteraction: (type) => type === "pair_checkpoint",
        requestInteraction: () => {
            throw new Error("approve & run must not prompt for collaboration style");
        },
    });
    /** @type {any} */
    let executionArgs = null;

    const result = await executePlan({
        planName: "visual-feature",
        triageMeta: { classification: "FEATURE" },
        hostedSession,
        __deps: {
            loadPlan: () =>
                Promise.resolve(
                    /** @type {any} */ ({
                        attrs: {
                            status: "ready_for_work",
                            classification: "FEATURE",
                            executionAgent: "frontend-engineer",
                            collaborationRecommendation: "autonomous",
                        },
                        body: "## Visual Feature",
                    }),
                ),
            executeSingleEngineerPlan: (args) => {
                executionArgs = args;
                return Promise.resolve({ repairRequired: false, executionComplete: false });
            },
            recordWorkflowMetric: () => Promise.resolve(null),
        },
    });

    assertEquals(result.executionComplete, false);
    assertEquals(result.canceled, undefined);
    assertEquals(executionArgs.collaborationStyle, "autonomous");
    assertEquals(executionArgs.collaborationRecommendation, "autonomous");
});

Deno.test("executePlan falls back to autonomous without an interaction adapter", async () => {
    const hostedSession = makeHostedSession("pair-no-adapter");
    /** @type {string[]} */
    const messages = [];
    hostedSession.setEventSink((/** @type {{ message?: string }} */ event) => {
        if (event.message) messages.push(event.message);
    });
    /** @type {any} */
    let executionArgs = null;

    const result = await executePlan({
        planName: "visual-feature",
        triageMeta: { classification: "FEATURE" },
        hostedSession,
        __deps: {
            loadPlan: () =>
                Promise.resolve(
                    /** @type {any} */ ({
                        attrs: {
                            status: "ready_for_work",
                            classification: "FEATURE",
                            executionAgent: "frontend-engineer",
                            collaborationRecommendation: "pair",
                        },
                        body: "## Visual Feature",
                    }),
                ),
            executeSingleEngineerPlan: (args) => {
                executionArgs = args;
                return Promise.resolve({ repairRequired: false, executionComplete: false });
            },
            recordWorkflowMetric: () => Promise.resolve(null),
        },
    });

    assertEquals(result.executionComplete, false);
    assertEquals(executionArgs.collaborationStyle, "autonomous");
    assertEquals(executionArgs.collaborationRecommendation, "pair");
    assertEquals(
        messages.filter((message) => message.includes("Pair Execution is recommended by the Plan")),
        [
            "Pair Execution is recommended by the Plan but unavailable in this host; continuing with autonomous Frontend Engineer execution.",
        ],
    );
});

Deno.test("executePlan falls back to autonomous when the adapter withholds Pair capability", async () => {
    const hostedSession = makeHostedSession("pair-unsupported-adapter");
    let interactionRequested = false;
    hostedSession.setInteractionAdapter({
        supportsInteraction: () => false,
        requestInteraction: () => {
            interactionRequested = true;
            return Promise.resolve({ outcome: "selected", value: "continue" });
        },
    });
    /** @type {any} */
    let executionArgs = null;

    await executePlan({
        planName: "visual-feature",
        triageMeta: { classification: "FEATURE" },
        hostedSession,
        __deps: {
            loadPlan: () =>
                Promise.resolve(
                    /** @type {any} */ ({
                        attrs: {
                            status: "ready_for_work",
                            classification: "FEATURE",
                            executionAgent: "frontend-engineer",
                            collaborationRecommendation: "pair",
                        },
                        body: "## Visual Feature",
                    }),
                ),
            executeSingleEngineerPlan: (args) => {
                executionArgs = args;
                return Promise.resolve({ repairRequired: false, executionComplete: false });
            },
            recordWorkflowMetric: () => Promise.resolve(null),
        },
    });

    assertEquals(interactionRequested, false);
    assertEquals(executionArgs.collaborationStyle, "autonomous");
});

Deno.test("executePlan clears unusable Pair style when execution setup fails", async () => {
    const hostedSession = makeHostedSession("pair-setup-failed");
    hostedSession.setInteractionAdapter({
        supportsInteraction: (type) => type === "pair_checkpoint",
        requestInteraction: () => Promise.resolve({ outcome: "selected", value: "pair" }),
    });
    let activeTurnStarted = false;

    const result = await executePlan({
        planName: "visual-feature",
        triageMeta: { classification: "FEATURE" },
        hostedSession,
        __deps: {
            loadPlan: () =>
                Promise.resolve(
                    /** @type {any} */ ({
                        attrs: {
                            status: "ready_for_work",
                            classification: "FEATURE",
                            executionAgent: "frontend-engineer",
                            collaborationRecommendation: "pair",
                        },
                        body: "## Visual Feature",
                    }),
                ),
            probeGitRepository: () => Promise.resolve({ ok: false, state: "git_missing", cwd: Deno.cwd() }),
            hasNonGitExecutionConsent: () => false,
            confirmNonGitFeaturePlanExecution: () => Promise.resolve(false),
            runActiveAgentTurn: () => {
                activeTurnStarted = true;
                return Promise.resolve([]);
            },
            recordWorkflowMetric: () => Promise.resolve(null),
        },
    });

    assertEquals(result.executionComplete, false);
    assertEquals(activeTurnStarted, false);
    assertEquals(hostedSession.getActiveExecutionWorkflow(), null);
});

Deno.test("executePlan keeps legacy frontend execution autonomous without prompting", async () => {
    const hostedSession = makeHostedSession("legacy-frontend-autonomous");
    hostedSession.setInteractionAdapter({
        supportsInteraction: (type) => type === "pair_checkpoint",
        requestInteraction: () => {
            throw new Error("legacy frontend must not prompt");
        },
    });
    /** @type {any} */
    let executionArgs = null;

    const result = await executePlan({
        planName: "legacy-visual-feature",
        triageMeta: { classification: "FEATURE" },
        hostedSession,
        __deps: {
            loadPlan: () =>
                Promise.resolve(
                    /** @type {any} */ ({
                        attrs: { status: "ready_for_work", classification: "FEATURE", frontend: true },
                        body: "## Legacy Visual Feature",
                    }),
                ),
            executeSingleEngineerPlan: (args) => {
                executionArgs = args;
                return Promise.resolve({ repairRequired: false, executionComplete: false });
            },
            recordWorkflowMetric: () => Promise.resolve(null),
        },
    });

    assertEquals(result.executionComplete, false);
    assertEquals(executionArgs.collaborationStyle, "autonomous");
    assertEquals(executionArgs.triageMeta.executionAgent, "frontend-engineer");
});

Deno.test("executePlan rejects invalid loaded policy before dispatch or lifecycle mutation", async () => {
    let dispatched = false;
    let lifecycleMutated = false;
    /** @type {any[]} */
    const metrics = [];
    const result = await executePlan({
        planName: "bad-feature",
        triageMeta: { classification: "FEATURE", executionAgent: "frontend-engineer" },
        hostedSession: makeHostedSession("bad-feature-execution"),
        __deps: {
            loadPlan: () =>
                Promise.resolve(
                    /** @type {any} */ ({
                        attrs: {
                            status: "ready_for_work",
                            classification: "FEATURE",
                            executionAgent: "unknown-owner",
                            frontend: true,
                        },
                        body: "## Bad Feature",
                        markdown: "## Bad Feature",
                    }),
                ),
            executeSingleEngineerPlan: () => {
                dispatched = true;
                return Promise.resolve({ repairRequired: false, executionComplete: true });
            },
            recordPlanEvent: () => {
                lifecycleMutated = true;
                return Promise.resolve(/** @type {any} */ ({}));
            },
            recordWorkflowMetric: (/** @type {any} */ metric) => {
                metrics.push(metric);
                return Promise.resolve(null);
            },
        },
    });

    assertEquals(result.executionComplete, false);
    assertStringIncludes(result.error || "", "Invalid executionAgent: unknown-owner");
    assertEquals(dispatched, false);
    assertEquals(lifecycleMutated, false);
    assertEquals(metrics.some((metric) => metric.event === "plan_execution_started"), false);
});

Deno.test("executePlan treats incomplete Engineer execution as resumable", async () => {
    const projectRoot = await makeWorkflowProject([{ name: "feature-plan", status: "ready_for_work" }]);
    /** @type {string[]} */
    const events = [];
    /** @type {Array<string | null | undefined>} */
    const worktreeStatuses = [];
    const result = await executePlan({
        planName: "feature-plan",
        triageMeta: { classification: "FEATURE" },
        hostedSession: makeHostedSession("incomplete-feature-execution", projectRoot),
        __deps: {
            loadPlan: () =>
                Promise.resolve(
                    /** @type {any} */ ({
                        attrs: { status: "ready_for_work", classification: "FEATURE" },
                        body: "## Feature",
                        markdown: "## Feature",
                    }),
                ),
            executeSingleEngineerPlan: () =>
                Promise.resolve({
                    repairRequired: false,
                    executionComplete: false,
                    error: "API failed",
                }),
            recordPlanEvent: (/** @type {any} */ { event }) => {
                events.push(event);
                return Promise.resolve(/** @type {any} */ ({}));
            },
            markActiveWorktreeStatus: (/** @type {any} */ status) => {
                worktreeStatuses.push(status);
                return Promise.resolve();
            },
        },
    });

    assertEquals(result, { repairRequired: false, executionComplete: false, error: "API failed" });
    assertEquals(events, []);
    assertEquals(
        (await loadPlan(projectRoot, "feature-plan"))?.attrs.status,
        "ready_for_work",
        "an interrupted turn records no lifecycle completion",
    );
    assertEquals(worktreeStatuses, []);
});

Deno.test("executePlan keeps Engineer active when the implementation turn is interrupted", async () => {
    const projectRoot = await makeWorkflowProject([{ name: "feature-plan", status: "ready_for_work" }]);
    const executionCwd = projectRoot;
    const hostedSession = makeHostedSession("interrupted-feature-execution", projectRoot);
    const plannerHandler = () => Promise.resolve({ kind: "complete" });
    const engineerHandler = () => Promise.resolve({ kind: "complete" });
    const order = /** @type {string[]} */ ([]);
    hostedSession.setRootAgentName("planner");
    hostedSession.setRootAgentSession(/** @type {any} */ ({ dispose: () => {} }));
    hostedSession.setActiveOnMessage(plannerHandler);

    const result = await executePlan({
        planName: "feature-plan",
        triageMeta: { planId: "plan-under-test", classification: "FEATURE" },
        hostedSession,
        __deps: /** @type {any} */ ({
            loadPlan: () =>
                Promise.resolve(
                    /** @type {any} */ ({
                        attrs: { planId: "plan-under-test", status: "ready_for_work", classification: "FEATURE" },
                        body: "## Feature",
                        markdown: "## Feature",
                    }),
                ),
            probeGitRepository: () => Promise.resolve({ ok: false, state: "not_git" }),
            hasNonGitExecutionConsent: () => true,
            confirmNonGitFeaturePlanExecution: () => {
                throw new Error("consent should already be recorded");
            },
            recordPlanEvent: () => Promise.resolve({}),
            recordWorkflowMetric: () => Promise.resolve(null),
            runActiveAgentTurn: (/** @type {any} */ options) =>
                runActiveAgentTurn(options, {
                    switchActiveAgent: /** @type {any} */ ((
                        /** @type {HostedSession} */ session,
                        /** @type {any} */ switchOptions,
                    ) => {
                        order.push("switch");
                        assertEquals(switchOptions.agentName, "engineer");
                        assertEquals(switchOptions.cwd, executionCwd);
                        session.setRootAgentName("engineer");
                        session.setRootAgentSession(
                            /** @type {any} */ ({ agent: { state: { messages: [] } }, dispose: () => {} }),
                        );
                        session.setActiveOnMessage(engineerHandler);
                        return Promise.resolve({ ok: true, agentName: "engineer", changed: true });
                    }),
                    runRootTurn: /** @type {any} */ (() => {
                        order.push("turn");
                        assertEquals(hostedSession.getActiveOnMessage(), engineerHandler);
                        return Promise.reject(new Error("interrupted by user question"));
                    }),
                }),
        }),
    });

    assertEquals(result.repairRequired, false);
    assertEquals(result.executionComplete, false);
    assertEquals(result.error, "interrupted by user question");
    assertEquals(result.executionContext?.executionMode, "non_git_in_place");
    assertEquals(result.executionContext?.executionCwd, executionCwd);
    assertEquals(order, ["switch", "turn"]);
    assertEquals(hostedSession.getRootAgentName(), "engineer");
    assertEquals(hostedSession.getActiveOnMessage(), engineerHandler);
});

Deno.test("executePlan uses single-plan execution for child FEATURE plans", async () => {
    const projectRoot = await makeWorkflowProject([{ name: "epic-a/01-child-feature", status: "ready_for_work" }]);
    let engineerCalled = false;
    const executionContext = /** @type {const} */ ({
        planName: "epic-a/01-child-feature",
        triageMeta: { classification: "FEATURE", parentPlan: "epic-a" },
        executionAgent: "engineer",
        executionMode: "non_git_in_place",
        projectRoot: Deno.cwd(),
        executionCwd: Deno.cwd(),
        nonGitInPlace: true,
    });
    const result = await executePlan({
        planName: "epic-a/01-child-feature",
        triageMeta: { classification: "FEATURE", parentPlan: "epic-a" },
        hostedSession: makeHostedSession("child-feature-execution", projectRoot),
        __deps: {
            loadPlan: () =>
                Promise.resolve(
                    /** @type {any} */ ({
                        attrs: {
                            status: "ready_for_work",
                            classification: "FEATURE",
                            parentPlan: "epic-a",
                        },
                        body: "## Child FEATURE",
                        markdown: "## Child FEATURE",
                    }),
                ),
            executeSingleEngineerPlan: (/** @type {any} */ { triageMeta }) => {
                engineerCalled = true;
                assertEquals(triageMeta.parentPlan, "epic-a");
                return Promise.resolve({ repairRequired: false, executionComplete: true, executionContext });
            },
            recordPlanEvent: () => Promise.resolve(/** @type {any} */ ({})),
            markActiveWorktreeStatus: () => Promise.resolve(),
        },
    });

    assertEquals(result, { repairRequired: false, executionComplete: true, executionContext });
    assertEquals(engineerCalled, true);
});

Deno.test("buildSlicerRequest includes plan name and base instructions", () => {
    const text = buildSlicerRequest("my-plan", undefined);
    assertStringIncludes(text, "Slice Plan: my-plan");
    assertStringIncludes(text, "plans/my-plan.md");
    assertStringIncludes(text, "system prompt");
    // Without triage meta, the report block must not appear.
    assertEquals(text.includes("Triage Report"), false);
});

Deno.test("buildSlicerRequest includes triage report fields when present", () => {
    const text = buildSlicerRequest("my-plan", {
        classification: "PROJECT",
        workKind: "DOCUMENTATION",
        complexity: "HIGH",
        summary: "Initialize RunWield",
        affectedPaths: ["src/foo.js", "src/bar.js"],
    });
    assertStringIncludes(text, "Triage Report");
    assertStringIncludes(text, "Classification: PROJECT");
    assertStringIncludes(text, "Work Kind: DOCUMENTATION");
    assertStringIncludes(text, "Complexity: HIGH");
    assertStringIncludes(text, "Summary: Initialize RunWield");
    assertStringIncludes(text, "src/foo.js, src/bar.js");
});

Deno.test("buildSlicerRequest omits empty affectedPaths", () => {
    const text = buildSlicerRequest("p", {
        classification: "PROJECT",
        complexity: "LOW",
        summary: "x",
        affectedPaths: [],
    });
    assertEquals(text.includes("Affected paths"), false);
});

// ── runSlicerAgent ─────────────────────────────────────────────────

/**
 * @returns {{ loadPlan: () => Promise<any>, findPlansByParent: () => Promise<any[]> }}
 */
function slicerPlanDeps() {
    return {
        loadPlan: () =>
            Promise.resolve({
                attrs: { classification: "PROJECT", status: "approved" },
                markdown: "# Epic",
                body: "# Epic",
            }),
        findPlansByParent: () => Promise.resolve([]),
    };
}

Deno.test("beginSlicerContextPhase persists a clean model-context boundary", () => {
    const manager = SessionManager.inMemory(Deno.cwd());
    manager.appendMessage({
        role: "user",
        content: [{ type: "text", text: "architect sausage making" }],
        timestamp: Date.now(),
    });
    manager.appendMessage({
        role: "assistant",
        content: [{ type: "text", text: "architecture deliberation" }],
        api: "test",
        provider: "test",
        model: "test",
        usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.now(),
    });
    const hostedSession = makeHostedSession();
    hostedSession.setRootAgentName("architect");
    // Pre-existing: a real SessionManager is structurally wider than the minimal shape
    // this setter declares. Only `deno task check`'s non-recursive glob kept it hidden.
    hostedSession.setRootSessionManager(/** @type {any} */ (manager));

    const boundary = beginSlicerContextPhase({ planName: "epic-a", hostedSession, sessionManager: manager });
    assertEquals(boundary?.manager, manager);
    const boundaryContext = manager.buildSessionContext().messages;
    assertEquals(boundaryContext.length, 1);
    assertEquals(boundaryContext[0].role, "compactionSummary");
    assertEquals(JSON.stringify(boundaryContext).includes("architect sausage making"), false);

    manager.appendMessage({
        role: "user",
        content: [{ type: "text", text: "authoritative Epic handoff" }],
        timestamp: Date.now(),
    });
    const slicerContext = manager.buildSessionContext().messages;
    assertEquals(slicerContext.length, 2);
    assertEquals(JSON.stringify(slicerContext).includes("authoritative Epic handoff"), true);
    assertEquals(JSON.stringify(slicerContext).includes("architecture deliberation"), false);

    hostedSession.setRootAgentName("slicer");
    assertEquals(beginSlicerContextPhase({ planName: "epic-a", hostedSession, sessionManager: manager }), null);
    assertEquals(manager.buildContextEntries().filter((entry) => entry.type === "compaction").length, 1);
});

Deno.test("runSlicerAgent returns ok=true when session resolves", async () => {
    let captured = /** @type {any} */ (null);
    /** @type {any[]} */
    const boundaries = [];
    /** @type {string[]} */
    const order = [];
    const sessionManager = /** @type {any} */ ({
        buildSessionContext: () => ({ messages: [{ role: "user", content: "architect history" }] }),
        getLeafId: () => "architect-leaf",
        appendCompaction: (/** @type {any[]} */ ...args) => boundaries.push(args),
    });
    const hostedSession = makeHostedSession();
    hostedSession.setRootAgentName("architect");
    hostedSession.setRootSessionManager(sessionManager);
    const result = await runSlicerAgent({
        planName: "my-plan",
        triageMeta: { classification: "PROJECT", complexity: "LOW", summary: "x", affectedPaths: [] },
        reviewFeedback: "Keep the approved boundary.",
        reviewImages: [{ base64: "YXBwcm92ZWQ=", mimeType: "image/png" }],
        hostedSession,
        __deps: {
            ...slicerPlanDeps(),
            runActiveAgentTurn: (/** @type {any} */ opts) => {
                order.push("activeTurn");
                captured = opts;
                return Promise.resolve([]);
            },
        },
    });
    assertEquals(result.ok, true);
    assertEquals(order, ["activeTurn"]);
    assertEquals(captured.agentName, "slicer");
    assertEquals(captured.allowReturnToRouter, false);
    assertEquals(captured.sessionManager, sessionManager);
    assertEquals(captured.images, [{ base64: "YXBwcm92ZWQ=", mimeType: "image/png" }]);
    assertStringIncludes(captured.userRequest, "Keep the approved boundary.");
    assertEquals(boundaries.length, 1);
    assertEquals(boundaries[0][1], "");
    assertEquals(boundaries[0][3], {
        kind: "agent_context_boundary",
        agentName: "slicer",
        planName: "my-plan",
    });
    assertStringIncludes(
        boundaries[0][0],
        "Earlier Router, Architect, and other-agent conversation was intentionally omitted",
    );
    /** @param {{ name: string }} tool */
    function getToolName(tool) {
        return tool.name;
    }
    assertEquals(captured.customTools.map(getToolName), ["slicer_finalize_decomposition"]);
    assertStringIncludes(captured.userRequest, "my-plan");
});

Deno.test("runSlicerAgent includes existing child Ticket References in resumed handoff", async () => {
    let userRequest = "";
    const sessionManager = /** @type {any} */ ({
        buildSessionContext: () => ({ messages: [] }),
        getLeafId: () => "architect-leaf",
        appendCompaction: () => {},
    });
    const hostedSession = makeHostedSession();
    hostedSession.setRootAgentName("architect");
    hostedSession.setRootSessionManager(sessionManager);

    const result = await runSlicerAgent({
        planName: "epic-a",
        hostedSession,
        __deps: {
            loadPlan: () =>
                Promise.resolve({
                    path: "/tmp/epic-a.md",
                    attrs: {
                        classification: "PROJECT",
                        status: "approved",
                        complexity: "HIGH",
                        summary: "Epic",
                        affectedPaths: [],
                        createdAt: "2026-01-01T00:00:00.000Z",
                    },
                    markdown: "# Epic",
                    body: "# Epic",
                }),
            findPlansByParent: () =>
                Promise.resolve([{
                    name: "epic-a/01-child",
                    path: "/tmp/epic-a/01-child.md",
                    attrs: {
                        classification: "FEATURE",
                        status: "draft",
                        complexity: "MEDIUM",
                        order: 1,
                        summary: "Child slice",
                        affectedPaths: [],
                        createdAt: "2026-01-01T00:00:00.000Z",
                        tickets: [{ url: "https://tracker.example/TICKET-1" }],
                    },
                }]),
            runActiveAgentTurn: (/** @type {any} */ opts) => {
                userRequest = opts.userRequest;
                return Promise.resolve([]);
            },
        },
    });

    assertEquals(result.ok, true);
    assertStringIncludes(userRequest, "Direct Ticket references: https://tracker.example/TICKET-1");
});

Deno.test("runSlicerAgent restores the prior session leaf when isolated Slicer startup fails", async () => {
    /** @type {string[]} */
    const restoredLeaves = [];
    const sessionManager = /** @type {any} */ ({
        buildSessionContext: () => ({ messages: [{ role: "user", content: "architect history" }] }),
        getLeafId: () => "architect-leaf",
        appendCompaction: () => {},
        branch: (/** @type {string} */ leafId) => restoredLeaves.push(leafId),
    });
    const hostedSession = makeHostedSession();
    hostedSession.setRootAgentName("architect");
    hostedSession.setRootSessionManager(sessionManager);

    const result = await runSlicerAgent({
        planName: "p",
        hostedSession,
        __deps: {
            ...slicerPlanDeps(),
            runActiveAgentTurn: () => {
                throw new Error("boom");
            },
        },
    });

    assertEquals(result, { ok: false, error: "boom" });
    assertEquals(restoredLeaves, ["architect-leaf"]);
});

Deno.test("runSlicerAgent surfaces session errors as { ok:false, error }", async () => {
    const result = await runSlicerAgent({
        planName: "p",
        hostedSession: makeHostedSession(),
        __deps: {
            ...slicerPlanDeps(),
            runActiveAgentTurn: () => {
                throw new Error("boom");
            },
        },
    });
    assertEquals(result.ok, false);
    assertEquals(result.error, "boom");
});

Deno.test("runSlicerAgent surfaces non-Error throws as string", async () => {
    const result = await runSlicerAgent({
        planName: "p",
        hostedSession: makeHostedSession(),
        __deps: {
            ...slicerPlanDeps(),
            runActiveAgentTurn: () => {
                throw "string failure";
            },
        },
    });
    assertEquals(result.ok, false);
    assertEquals(result.error, "string failure");
});

Deno.test("runSlicerAgent completes through an event-only HostedSession", async () => {
    const result = await runSlicerAgent({
        planName: "p",
        hostedSession: makeHostedSession(),
        __deps: {
            ...slicerPlanDeps(),
            runActiveAgentTurn: () => Promise.resolve([]),
        },
    });
    assertEquals(result.ok, true);
});

Deno.test("runSlicerAgent reports failure through a system-status event", async () => {
    /** @type {string[]} */
    const messages = [];
    const target = makeHostedSession();
    target.setEventSink((/** @type {{ type?: string, message?: string }} */ event) => {
        if (event.type === "system_status") messages.push(String(event.message || ""));
    });
    await runSlicerAgent({
        planName: "p",
        hostedSession: target,
        __deps: {
            ...slicerPlanDeps(),
            runActiveAgentTurn: () => {
                throw new Error("kaboom");
            },
        },
    });
    assertEquals(messages.some((m) => m.includes("Slicer failed: kaboom")), true);
});

Deno.test("createSlicerFinalizeTool writes draft child FEATURE plans before finalizing approved Epic", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "epic-a", "# Epic", {
            classification: "PROJECT",
            status: "approved",
            worktreeBaseBranch: "feature-base",
        });
        /** @type {Array<{ cwd: string, epicPlanName: string, children: unknown[], parentWorktreeBaseBranch?: string }>} */
        const materializeCalls = [];
        const childDescriptors = [{
            order: 1,
            title: "Child",
            summary: "Child summary",
            affectedPaths: ["src/a.js"],
            dependencies: [],
            content: "# Child",
        }];
        const tool = createSlicerFinalizeTool({
            planName: "epic-a",
            cwd,
            __deps: {
                // Observe the handoff, then do the real write, so the composite
                // transaction settles against Plan files that actually exist.
                materializeSlicerDraft: (args) => {
                    materializeCalls.push(args);
                    return materializeSlicerDraft(args);
                },
            },
        });

        const result = await tool.execute(
            "call-1",
            { confirmation: "yes, finalize", children: childDescriptors },
            new AbortController().signal,
            () => {},
            /** @type {any} */ ({}),
        );

        assertEquals(materializeCalls.length, 1);
        assertEquals(materializeCalls[0].cwd, cwd);
        assertEquals(materializeCalls[0].epicPlanName, "epic-a");
        assertEquals(materializeCalls[0].children, childDescriptors);
        assertEquals(materializeCalls[0].parentWorktreeBaseBranch, "feature-base");
        assertEquals(typeof /** @type {any} */ (materializeCalls[0]).writeOptions?.onChildPlanWritten, "function");
        assertEquals(result.details.status, "ready_for_work");
        assertEquals(result.details.children, ["epic-a/01-child"]);
        assertEquals(result.details.error, "");
        // The Epic Event and the child files commit together, so both are on disk.
        assertEquals((await loadPlan(cwd, "epic-a"))?.attrs.status, "ready_for_work");
        assertEquals((await loadPlan(cwd, "epic-a/01-child"))?.attrs.parentPlan, "epic-a");
    } finally {
        await Deno.remove(cwd, { recursive: true }).catch(() => {});
    }
});

Deno.test("createSlicerFinalizeTool rolls back partially written child drafts when materialization fails", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "epic-a", "# Epic", { classification: "PROJECT", status: "approved" });
        const childDescriptors = [{
            order: 1,
            title: "Child",
            summary: "Child summary",
            affectedPaths: [],
            dependencies: [],
            content: "# Child",
        }];
        const tool = createSlicerFinalizeTool({
            planName: "epic-a",
            cwd,
            __deps: {
                loadPlan,
                findPlansByParent,
                materializeSlicerDraft: async (args) => {
                    await materializeSlicerDraft(args);
                    throw new Error("later child failed");
                },
            },
        });

        const result = await tool.execute(
            "call-1",
            { confirmation: "yes, finalize", children: childDescriptors },
            new AbortController().signal,
            () => {},
            /** @type {any} */ ({}),
        );

        assertEquals(result.details.status, "error");
        assertEquals(await loadPlan(cwd, "epic-a/01-child"), null);
        assertEquals((await loadPlan(cwd, "epic-a"))?.attrs.status, "approved");
    } finally {
        await Deno.remove(cwd, { recursive: true }).catch(() => {});
    }
});

Deno.test("createSlicerFinalizeTool can finalize existing child FEATURE plans without writing", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "epic-a", "# Epic", { classification: "PROJECT", status: "ready_for_decomposition" });
        await savePlan(cwd, "epic-a/01-child", "# Child", {
            classification: "FEATURE",
            status: "draft",
            parentPlan: "epic-a",
            order: 1,
        });
        const tool = createSlicerFinalizeTool({ planName: "epic-a", cwd });

        const result = await tool.execute(
            "call-1",
            { confirmation: "yes, finalize" },
            new AbortController().signal,
            () => {},
            /** @type {any} */ ({}),
        );

        assertEquals(result.details.status, "ready_for_work");
        assertEquals(result.details.children, ["epic-a/01-child"]);
        assertEquals(result.details.writeResults, []);
        assertEquals(result.details.error, "");
        assertEquals((await loadPlan(cwd, "epic-a"))?.attrs.status, "ready_for_work");
    } finally {
        await Deno.remove(cwd, { recursive: true }).catch(() => {});
    }
});

Deno.test("createSlicerFinalizeTool leaves already finalized Epics ready without recording another lifecycle event", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "epic-a", "# Epic", { classification: "PROJECT", status: "ready_for_work" });
        await savePlan(cwd, "epic-a/01-child", "# Child", {
            classification: "FEATURE",
            status: "draft",
            parentPlan: "epic-a",
            order: 1,
        });
        const before = await loadPlan(cwd, "epic-a");
        const tool = createSlicerFinalizeTool({ planName: "epic-a", cwd });

        const result = await tool.execute(
            "call-1",
            { confirmation: "yes, finalize" },
            new AbortController().signal,
            () => {},
            /** @type {any} */ ({}),
        );

        assertEquals(result.details.status, "ready_for_work");
        assertEquals(result.details.children, ["epic-a/01-child"]);
        assertEquals(result.details.writeResults, []);
        // Replaying the Plan Event would rewrite the Epic; an already-ready Epic is
        // left byte-identical instead.
        assertEquals((await loadPlan(cwd, "epic-a"))?.revision, before?.revision);
    } finally {
        await Deno.remove(cwd, { recursive: true }).catch(() => {});
    }
});

Deno.test("materializeSlicerDraft writes child drafts without forcing a parent Work Kind", async () => {
    // Asserts the Plan files that land on disk rather than the arguments handed to
    // saveChildFeaturePlans: an omitted child workKind has to stay omitted in the
    // written Front Matter, which is the thing that actually matters.
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "epic-a", "# Epic", {
            classification: "PROJECT",
            status: "approved",
            workKind: "FEATURE",
            summary: "Epic",
            affectedPaths: [],
        });
        const children = /** @type {import('../../plan-store.js').ChildFeaturePlanDescriptor[]} */ ([{
            sequence: 1,
            title: "Draft child",
            summary: "Draft summary",
            affectedPaths: ["src/plan-store.js"],
            dependencies: [],
            content: "# Draft child",
        }, {
            sequence: 2,
            title: "Explicit Work Kind child",
            summary: "Explicit summary",
            affectedPaths: ["src/constants.js"],
            dependencies: ["01-draft-child"],
            workKind: "DOCUMENTATION",
            content: "# Explicit child",
        }]);

        const result = await materializeSlicerDraft({
            cwd,
            epicPlanName: "epic-a",
            children,
            parentWorktreeBaseBranch: "feature-base",
        });

        assertEquals(result[0].name, "epic-a/01-draft-child");
        const draftChild = await loadPlan(cwd, "epic-a/01-draft-child");
        const explicitChild = await loadPlan(cwd, "epic-a/02-explicit-work-kind-child");
        assertEquals(
            draftChild?.attrs.workKind,
            undefined,
            "an omitted child Work Kind is not inherited from the Epic",
        );
        assertEquals(explicitChild?.attrs.workKind, "DOCUMENTATION");
        assertEquals(draftChild?.attrs.parentPlan, "epic-a");
        assertEquals(draftChild?.attrs.worktreeBaseBranch, "feature-base", "the parent target branch is inherited");
    } finally {
        await Deno.remove(cwd, { recursive: true }).catch(() => {});
    }
});

// ── openSlicerDecomposition ──────────────────────────────────────────────

Deno.test("openSlicerDecomposition opens decomposition when persisted plan is an Epic", async () => {
    let slicerCalls = 0;
    const result = await openSlicerDecomposition({
        planName: "epic-a",
        planPath: "/tmp/epic-a.md",
        hostedSession: makeHostedSession(),
        __deps: {
            readTextFile: () =>
                Promise.resolve([
                    "---",
                    "classification: PROJECT",
                    "status: approved",
                    "---",
                    "# Epic",
                ].join("\n")),
            runSlicerAgent: (opts) => {
                slicerCalls++;
                assertEquals(opts.triageMeta?.classification, "PROJECT");
                return Promise.resolve({ ok: true });
            },
        },
    });

    assertEquals(result, { ok: true, slicerInvoked: true });
    assertEquals(slicerCalls, 1);
});

Deno.test("openSlicerDecomposition returns persisted Epic slicer throws as slicer failure", async () => {
    let slicerCalls = 0;
    const result = await openSlicerDecomposition({
        planName: "epic-a",
        planPath: "/tmp/epic-a.md",
        hostedSession: makeHostedSession(),
        __deps: {
            readTextFile: () =>
                Promise.resolve([
                    "---",
                    "classification: PROJECT",
                    "status: approved",
                    "---",
                    "# Epic",
                ].join("\n")),
            runSlicerAgent: () => {
                slicerCalls++;
                throw new Error("agent definition unavailable");
            },
        },
    });

    assertEquals(result, { ok: false, error: "agent definition unavailable", stage: "slicer" });
    assertEquals(slicerCalls, 1);
});

Deno.test("openSlicerDecomposition returns { ok:false, stage:'slicer' } when epic slicer fails", async () => {
    const result = await openSlicerDecomposition({
        planName: "p",
        planPath: "/tmp/p.md",
        hostedSession: makeHostedSession(),
        __deps: {
            readTextFile: () =>
                Promise.resolve([
                    "---",
                    "classification: PROJECT",
                    "status: approved",
                    "---",
                    "# Epic",
                ].join("\n")),
            runSlicerAgent: () => Promise.resolve({ ok: false, error: "model timeout" }),
        },
    });
    assertEquals(result.ok, false);
    assertEquals(/** @type {any} */ (result).stage, "slicer");
    assertEquals(/** @type {any} */ (result).error, "model timeout");
});

Deno.test("openSlicerDecomposition reports slicer failure when error is missing from result", async () => {
    const result = await openSlicerDecomposition({
        planName: "p",
        planPath: "/tmp/p.md",
        hostedSession: makeHostedSession(),
        __deps: {
            readTextFile: () =>
                Promise.resolve([
                    "---",
                    "classification: PROJECT",
                    "status: approved",
                    "---",
                    "# Epic",
                ].join("\n")),
            runSlicerAgent: () => Promise.resolve({ ok: false }),
        },
    });
    assertEquals(result.ok, false);
    assertEquals(/** @type {any} */ (result).stage, "slicer");
    assertEquals(/** @type {any} */ (result).error, "slicer failed");
});

Deno.test("startActiveExecutionWorkflow records attempt timestamp only after execution starts", async () => {
    const projectRoot = await makeWorkflowProject([{ name: "clock-plan", status: "ready_for_work" }]);
    const hostedSession = makeHostedSession("attempt-clock-workflow", projectRoot);
    const result = await startActiveExecutionWorkflow({
        planName: "clock-plan",
        triageMeta: { planId: "plan-under-test", classification: "FEATURE" },
        currentStatus: "ready_for_work",
        hostedSession,
        __deps: {
            now: () => 4242,
            probeGitRepository: () => Promise.resolve({ ok: false, state: "not_git", cwd: projectRoot }),
            hasNonGitExecutionConsent: () => true,
            recordWorkflowMetric: () => Promise.resolve(null),
        },
    });

    assertEquals(result.executionStarted, true);
    assertEquals(result.executionAttemptStartedAtMs, 4242);
    assertEquals(hostedSession.getActiveExecutionWorkflow()?.executionAttemptStartedAtMs, 4242);
});

Deno.test("executePlan records content-free runtime-style metrics", async () => {
    const cases = [
        {
            id: "canonical-pair-capable",
            attrs: {
                status: "ready_for_work",
                classification: "FEATURE",
                executionAgent: "frontend-engineer",
                collaborationRecommendation: "pair",
            },
            supportsPair: true,
            expected: {
                policySource: "canonical",
                recommendation: "pair",
                runtimeStyle: "pair",
                pairCapable: true,
                resolutionReason: "canonical_pair_capable",
            },
        },
        {
            id: "canonical-autonomous",
            attrs: {
                status: "ready_for_work",
                classification: "FEATURE",
                executionAgent: "frontend-engineer",
                collaborationRecommendation: "autonomous",
            },
            supportsPair: true,
            expected: {
                policySource: "canonical",
                recommendation: "autonomous",
                runtimeStyle: "autonomous",
                pairCapable: true,
                resolutionReason: "canonical_autonomous",
            },
        },
        {
            id: "canonical-pair-unavailable",
            attrs: {
                status: "ready_for_work",
                classification: "FEATURE",
                executionAgent: "frontend-engineer",
                collaborationRecommendation: "pair",
            },
            supportsPair: false,
            expected: {
                policySource: "canonical",
                recommendation: "pair",
                runtimeStyle: "autonomous",
                pairCapable: false,
                resolutionReason: "canonical_pair_unavailable",
            },
        },
        {
            id: "legacy-frontend",
            attrs: { status: "ready_for_work", classification: "FEATURE", frontend: true },
            supportsPair: true,
            expected: {
                policySource: "legacy_frontend",
                recommendation: "autonomous",
                runtimeStyle: "autonomous",
                pairCapable: true,
                resolutionReason: "legacy_autonomous",
            },
        },
    ];

    for (const testCase of cases) {
        const hostedSession = makeHostedSession(`runtime-style-${testCase.id}`);
        hostedSession.setInteractionAdapter({
            supportsInteraction: (type) => testCase.supportsPair && type === "pair_checkpoint",
            requestInteraction: () => Promise.resolve({ outcome: "selected", value: "continue" }),
        });
        const metrics = /** @type {any[]} */ ([]);
        await executePlan({
            planName: `visual-${testCase.id}`,
            triageMeta: { classification: "FEATURE" },
            hostedSession,
            __deps: {
                loadPlan: () => Promise.resolve(/** @type {any} */ ({ attrs: testCase.attrs, body: "## Visual" })),
                executeSingleEngineerPlan: () => Promise.resolve({ repairRequired: false, executionComplete: false }),
                recordWorkflowMetric: (metric) => {
                    metrics.push(metric);
                    return Promise.resolve(null);
                },
            },
        });
        assertEquals(
            metrics.find((metric) => metric.event === "frontend_runtime_style_resolved")?.details,
            testCase.expected,
        );
    }
});

Deno.test("execution preparation ignores Plan body edits the user owns", async () => {
    const projectRoot = await makeWorkflowProject([
        { name: "body-plan", status: "ready_for_work", classification: "FEATURE" },
    ]);
    const stored = await loadPlan(projectRoot, "body-plan");
    const hostedSession = makeHostedSession("exec-body", projectRoot);

    const result = await startActiveExecutionWorkflow({
        planName: "body-plan",
        triageMeta: { planId: PLAN_UNDER_TEST, classification: "FEATURE" },
        currentStatus: "ready_for_work",
        hostedSession,
        __deps: {
            probeGitRepository: () => Promise.resolve({ ok: true, state: "work_tree", cwd: "" }),
            resolveCurrentCheckoutBranch: () => Promise.resolve("main"),
            findReusableWorktree: () => Promise.resolve(null),
            // Same lifecycle front matter, different body: the user edited their
            // Plan outside RunWield, which must not abort execution.
            loadCanonicalExecutionPlanSource: () =>
                Promise.resolve(
                    /** @type {any} */ ({
                        kind: "loaded",
                        path: stored?.path,
                        relativePath: "plans/body-plan.md",
                        markdown: `${stored?.markdown}\n\nEdited in another editor.\n`,
                        attrs: { ...stored?.attrs },
                    }),
                ),
        },
    });

    assertEquals(result.planName, "body-plan");
    // The body edit reached the execution copy rather than being reverted or rejected.
    const executionPlan = await loadPlan(/** @type {string} */ (result.executionCwd), "body-plan");
    assertStringIncludes(String(executionPlan?.markdown), "Edited in another editor.");
});

Deno.test("execution preparation still refuses when lifecycle front matter drifts", async () => {
    const projectRoot = await Deno.makeTempDir({ prefix: "runwield-exec-fm-" });
    try {
        await savePlan(projectRoot, "fm-plan", "# FM Plan\n", {
            planId: "plan-fm",
            classification: "FEATURE",
            status: "ready_for_work",
            summary: "s",
            affectedPaths: [],
        });
        const stored = await loadPlan(projectRoot, "fm-plan");
        const hostedSession = makeHostedSession("exec-fm", projectRoot);

        await assertRejects(
            () =>
                startActiveExecutionWorkflow({
                    planName: "fm-plan",
                    triageMeta: { planId: "plan-fm", classification: "FEATURE" },
                    currentStatus: "ready_for_work",
                    hostedSession,
                    __deps: {
                        probeGitRepository: () => Promise.resolve({ ok: true, state: "work_tree", cwd: "" }),
                        resolveCurrentCheckoutBranch: () => Promise.resolve("main"),
                        findReusableWorktree: () => Promise.resolve(null),
                        // Front matter drifted on disk between the locked read and the
                        // read that materializes the Plan. Drift it in the markdown, the
                        // way a real edit would: attrs are derived from those bytes, so a
                        // fixture that changes attrs alone cannot happen in practice.
                        loadCanonicalExecutionPlanSource: () =>
                            Promise.resolve(
                                /** @type {any} */ ({
                                    kind: "loaded",
                                    path: stored?.path,
                                    relativePath: "plans/fm-plan.md",
                                    markdown: String(stored?.markdown).replace(
                                        'status: "ready_for_work"',
                                        'status: "on_hold"',
                                    ),
                                    attrs: { ...stored?.attrs, status: "on_hold" },
                                }),
                            ),
                    },
                }),
            Error,
            "front matter change",
        );
    } finally {
        await Deno.remove(projectRoot, { recursive: true }).catch(() => {});
    }
});
