import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { withRuntimeCommandFixture } from "../../cmd/testing/runtime-command-fixture.ts";
import { loadPlan, type PlanFrontMatter, savePlan, updatePlanFrontMatter } from "../../plan-store.js";
import { HostedSession } from "../session/hosted-session.js";
import { defineCommittedGitFixture, git } from "../git-test-fixture.ts";
import { createWorktreeGitArtifacts, removeWorktreeGitArtifacts, settleWorktreeAttempt } from "../worktree.js";
import { updateEntry as updateWorktreeRegistryEntry } from "../worktree-registry.js";
import { executePlan, startActiveExecutionWorkflow } from "./workflow.js";
import { createExecutionStartPorts } from "./execution-start.ts";
import { captureWorktreeTree } from "./git-snapshot.js";
import { getTransitionJournalDir } from "./state-transition.ts";

interface RuntimeStatusEvent {
    type?: string;
    message?: string;
}

interface TestPlanDescriptor {
    name: string;
    status?: PlanFrontMatter["status"];
    attrs?: Partial<PlanFrontMatter>;
}

const workflowRepo = defineCommittedGitFixture();
const PLAN_ID = "execution-progress-plan";

function messagesFrom(events: RuntimeStatusEvent[]): string[] {
    return events
        .map((event) => typeof event.message === "string" ? event.message : "")
        .filter((message) => message.length > 0);
}

function assertMessageOrder(messages: string[], expected: string[]): void {
    let cursor = -1;
    for (const expectedMessage of expected) {
        const nextIndex = messages.findIndex((message, index) => index > cursor && message.includes(expectedMessage));
        assert(
            nextIndex > cursor,
            `Expected message after index ${cursor}: ${expectedMessage}\n${messages.join("\n")}`,
        );
        cursor = nextIndex;
    }
}

async function makeWorkflowProject(plans: TestPlanDescriptor[]): Promise<string> {
    const cwd = await workflowRepo.checkout({ prefix: "runwield-execution-progress-" });
    for (const [index, plan] of plans.entries()) {
        await savePlan(cwd, plan.name, `# ${plan.name}`, {
            classification: "PLANNED_CHANGE",
            status: plan.status || "ready_for_work",
            summary: plan.name,
            affectedPaths: [],
            planId: index === 0 ? PLAN_ID : `${PLAN_ID}-${index}`,
            ...plan.attrs,
        });
    }
    return cwd;
}

function makeHostedSession(id: string, cwd: string, events: RuntimeStatusEvent[]): HostedSession {
    const hostedSession = new HostedSession({
        id,
        cwd,
        eventSink: (event: RuntimeStatusEvent) => {
            events.push(event);
        },
    });
    const sessionManager = SessionManager.inMemory(cwd);
    // @ts-expect-error SessionManager is runtime-compatible with HostedSession.
    hostedSession.setRootSessionManager(sessionManager);
    return hostedSession;
}

Deno.test("execution preparation progress reports fresh worktree setup before launching Engineer", async () => {
    await withRuntimeCommandFixture("execution-progress-fresh-", async ({ setModelMessages }) => {
        setModelMessages([fauxAssistantMessage(fauxText("Execution remains paused in the fixture."))]);
        const projectRoot = await makeWorkflowProject([{
            name: "fresh-progress",
        }]);
        const events: RuntimeStatusEvent[] = [];
        const hostedSession = makeHostedSession("fresh-progress", projectRoot, events);
        let executionCwd = "";
        try {
            await executePlan({
                planName: "fresh-progress",
                triageMeta: { planId: PLAN_ID, classification: "PLANNED_CHANGE" },
                hostedSession,
            });

            const workflow = hostedSession.getActiveExecutionWorkflow();
            assert(workflow);
            assert(typeof workflow.executionCwd === "string");
            assert(typeof workflow.worktreeBranch === "string");
            executionCwd = workflow.executionCwd;
            const messages = messagesFrom(events);
            assertMessageOrder(messages, [
                "=== Executing Plan: fresh-progress ===",
                "Preparing the implementation target...",
                "Creating the worktree from base branch",
                `Created worktree ${workflow.worktreeBranch} from base branch`,
                "Copying the Plan into the worktree...",
                "Marking the Plan as in progress...",
                "Starting Plan Engineer...",
            ]);
            // An `engineer`-owned Plan runs under the workflow-only Plan Engineer.
            assertEquals(hostedSession.getRootAgentName(), "plan-engineer");
            const executionPlan = await loadPlan(executionCwd, "fresh-progress");
            assertEquals(executionPlan?.attrs.status, "in_progress");
        } finally {
            hostedSession.dispose();
            if (executionCwd) {
                await removeWorktreeGitArtifacts({ projectRoot, path: executionCwd, force: true }).catch(() =>
                    undefined
                );
            }
            await Deno.remove(projectRoot, { recursive: true }).catch(() => undefined);
        }
    });
});

Deno.test("execution preparation progress reports reused worktree without claiming creation", async () => {
    const projectRoot = await makeWorkflowProject([{
        name: "reuse-progress",
    }]);
    const events: RuntimeStatusEvent[] = [];
    const hostedSession = makeHostedSession("reuse-progress", projectRoot, events);
    let executionCwd = "";
    try {
        const firstWorkflow = await startActiveExecutionWorkflow({
            planName: "reuse-progress",
            triageMeta: { planId: PLAN_ID, classification: "PLANNED_CHANGE" },
            currentStatus: "ready_for_work",
            hostedSession,
            ports: createExecutionStartPorts(),
        });
        executionCwd = firstWorkflow.executionCwd || "";
        const inProgressPlan = await loadPlan(projectRoot, "reuse-progress");
        assert(inProgressPlan);
        await updatePlanFrontMatter(
            projectRoot,
            "reuse-progress",
            {
                status: "ready_for_work",
            },
            {},
            {
                expectedRevision: inProgressPlan.revision,
            },
        );
        events.length = 0;

        await startActiveExecutionWorkflow({
            planName: "reuse-progress",
            triageMeta: { planId: PLAN_ID, classification: "PLANNED_CHANGE" },
            currentStatus: "ready_for_work",
            hostedSession,
            ports: createExecutionStartPorts(),
        });

        const messages = messagesFrom(events);
        assertStringIncludes(messages.join("\n"), `Reusing worktree ${firstWorkflow.worktreeBranch}`);
        assertEquals(messages.some((message) => message.includes("Creating the worktree")), false);
    } finally {
        if (executionCwd) {
            await removeWorktreeGitArtifacts({ projectRoot, path: executionCwd, force: true }).catch(() => undefined);
        }
        await Deno.remove(projectRoot, { recursive: true }).catch(() => undefined);
    }
});

Deno.test("restart resumes a dirty ready-for-work worktree without repeating preparation", async () => {
    const projectRoot = await makeWorkflowProject([{ name: "restart-progress" }]);
    const events: RuntimeStatusEvent[] = [];
    const hostedSession = makeHostedSession("restart-progress", projectRoot, events);
    let resumedSession: HostedSession | undefined;
    let executionCwd = "";
    try {
        const worktree = await settleWorktreeAttempt(
            projectRoot,
            await createWorktreeGitArtifacts({
                projectRoot,
                planName: "restart-progress",
                planId: PLAN_ID,
            }),
        );
        executionCwd = worktree.path;
        await savePlan(worktree.path, "restart-progress", "# restart-progress", {
            classification: "PLANNED_CHANGE",
            status: "ready_for_work",
            summary: "restart-progress",
            affectedPaths: ["implemented.txt"],
            planId: PLAN_ID,
        });
        await Deno.writeTextFile(`${worktree.path}/implemented.txt`, "Agent work survived the restart.\n");
        const poisonedBaseline = await captureWorktreeTree(worktree.path);
        await updateWorktreeRegistryEntry(projectRoot, worktree.id, {
            status: "active",
            executionBaselineTree: poisonedBaseline,
        });
        const headBefore = await git(worktree.path, ["rev-parse", "HEAD"]);

        const workflow = await startActiveExecutionWorkflow({
            planName: "restart-progress",
            triageMeta: {
                planId: PLAN_ID,
                classification: "PLANNED_CHANGE",
                worktreeId: worktree.id,
                worktreePath: worktree.path,
                worktreeBranch: worktree.branch,
                worktreeBaseBranch: worktree.baseBranch,
                worktreeStatus: "active",
            },
            currentStatus: "ready_for_work",
            hostedSession,
            ports: createExecutionStartPorts(),
        });

        const executionPlan = await loadPlan(worktree.path, "restart-progress");
        assertEquals(executionPlan?.attrs.status, "in_progress");
        assertEquals(await Deno.readTextFile(`${worktree.path}/implemented.txt`), "Agent work survived the restart.\n");
        assertEquals(
            workflow.baselineTree,
            worktree.baseTree,
            "the dirty recovery snapshot cannot become the baseline",
        );
        const headAfter = await git(worktree.path, ["rev-parse", "HEAD"]);
        assertEquals(headAfter, headBefore, "resume must not checkpoint unreviewed Agent files as setup");
        const messages = messagesFrom(events);
        assertStringIncludes(messages.join("\n"), `Reusing worktree ${worktree.branch}`);

        // Mirror the durable residue left by the old failure: the Plan Event landed,
        // the registry contains a tree captured after the Agent edits, and the
        // execution-worktree journal still says recovery is needed.
        await updateWorktreeRegistryEntry(projectRoot, worktree.id, {
            status: "active",
            executionBaselineTree: poisonedBaseline,
        });
        const recoveryDirectory = getTransitionJournalDir(worktree.path);
        const recoveryPath = `${recoveryDirectory}/interrupted-restart.json`;
        await Deno.mkdir(recoveryDirectory, { recursive: true });
        await Deno.writeTextFile(
            recoveryPath,
            JSON.stringify({
                version: 1,
                transitionId: "interrupted-restart",
                operation: "execution_preparation",
                planName: "restart-progress",
                state: "needs_recovery",
                resources: [
                    { kind: "plan", id: "restart-progress" },
                    { kind: "attempt", id: worktree.id },
                ],
                completedEffects: [
                    {
                        effect: "git_worktree_reused",
                        proof: { worktreeId: worktree.id, path: worktree.path, branch: worktree.branch },
                    },
                    {
                        effect: "worktree_registry_updated",
                        proof: { worktreeId: worktree.id, status: "active" },
                    },
                    { effect: "plan_event_recorded", proof: { planName: "restart-progress" } },
                ],
            }),
        );
        resumedSession = makeHostedSession("restart-progress-after-failure", projectRoot, []);
        const resumedWorkflow = await startActiveExecutionWorkflow({
            planName: "restart-progress",
            triageMeta: {
                planId: PLAN_ID,
                classification: "PLANNED_CHANGE",
                worktreeId: worktree.id,
                worktreePath: worktree.path,
                worktreeBranch: worktree.branch,
                worktreeBaseBranch: worktree.baseBranch,
                worktreeStatus: "active",
            },
            currentStatus: "in_progress",
            hostedSession: resumedSession,
            ports: createExecutionStartPorts(),
        });
        assertEquals(resumedWorkflow.baselineTree, worktree.baseTree);
        assertEquals(await Deno.stat(recoveryPath).then(() => true).catch(() => false), false);
    } finally {
        resumedSession?.dispose();
        hostedSession.dispose();
        if (executionCwd) {
            await removeWorktreeGitArtifacts({ projectRoot, path: executionCwd, force: true }).catch(() => undefined);
        }
        await Deno.remove(projectRoot, { recursive: true }).catch(() => undefined);
    }
});

Deno.test("execution preparation progress reports non-Git in-place preparation without worktree creation", async () => {
    const projectRoot = await Deno.makeTempDir({ prefix: "runwield-non-git-progress-" });
    const events: RuntimeStatusEvent[] = [];
    const hostedSession = makeHostedSession("non-git-progress", projectRoot, events);
    try {
        await Deno.mkdir(join(projectRoot, "docs", "plans"), { recursive: true });
        await savePlan(projectRoot, "non-git-progress", "# non-git-progress", {
            classification: "PLANNED_CHANGE",
            status: "ready_for_work",
            summary: "non-git-progress",
            affectedPaths: [],
            planId: PLAN_ID,
        });

        await startActiveExecutionWorkflow({
            planName: "non-git-progress",
            triageMeta: { planId: PLAN_ID, classification: "PLANNED_CHANGE" },
            currentStatus: "ready_for_work",
            hostedSession,
            ports: {
                ...createExecutionStartPorts(),
                hasNonGitExecutionConsent: () => true,
            },
        });

        const messages = messagesFrom(events);
        assertMessageOrder(messages, [
            "Preparing the implementation target...",
            "Preparing in-place work because Git is unavailable...",
            "Marking the Plan as in progress...",
        ]);
        assertEquals(messages.some((message) => message.includes("worktree")), false);
    } finally {
        await Deno.remove(projectRoot, { recursive: true }).catch(() => undefined);
    }
});
