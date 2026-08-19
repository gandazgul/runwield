import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { withRuntimeCommandFixture } from "../../cmd/testing/runtime-command-fixture.ts";
import { loadPlan, type PlanFrontMatter, savePlan, updatePlanFrontMatter } from "../../plan-store.js";
import { HostedSession } from "../session/hosted-session.js";
import { defineCommittedGitFixture } from "../git-test-fixture.ts";
import { removeWorktreeGitArtifacts } from "../worktree.js";
import { executePlan, startActiveExecutionWorkflow } from "./workflow.js";
import { createExecutionStartPorts } from "./execution-start.ts";

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
            attrs: { objectiveChecks: [{ id: "OC_PROGRESS", command: "test -f fresh-progress-marker" }] },
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
                "preparing execution target...",
                "creating execution worktree from base branch",
                `created worktree ${workflow.worktreeBranch} from base branch`,
                "materializing Plan in execution worktree...",
                "running Plan Objective-Failing Check baseline...",
                "updating Plan status to in_progress...",
                "launching Plan Engineer to execute...",
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
        attrs: { objectiveChecks: [{ id: "OC_PROGRESS", command: "test -f reuse-progress-marker" }] },
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
                objectiveChecks: [{ id: "OC_PROGRESS", command: "test -f reuse-progress-marker" }],
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
        assertStringIncludes(messages.join("\n"), `reusing worktree ${firstWorkflow.worktreeBranch}`);
        assertEquals(messages.some((message) => message.includes("creating execution worktree")), false);
        assertEquals(messages.some((message) => message.includes("Objective-Failing Check baseline")), false);
    } finally {
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
            objectiveChecks: [{ id: "OC_PROGRESS", command: "test -f non-git-progress-marker" }],
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
            "preparing execution target...",
            "preparing in-place execution because Git is unavailable...",
            "running Plan Objective-Failing Check baseline...",
            "updating Plan status to in_progress...",
        ]);
        assertEquals(messages.some((message) => message.includes("worktree")), false);
    } finally {
        await Deno.remove(projectRoot, { recursive: true }).catch(() => undefined);
    }
});

Deno.test("execution preparation progress preserves Objective-Failing Check baseline rejection behavior", async () => {
    await withRuntimeCommandFixture("execution-progress-rejected-", async ({ setModelMessages }) => {
        setModelMessages([fauxAssistantMessage(fauxText("I will revise the already-satisfied check."))]);
        const projectRoot = await makeWorkflowProject([{
            name: "already-met-progress",
            attrs: { objectiveChecks: [{ id: "OC_TRUE", command: "true" }] },
        }]);
        const events: RuntimeStatusEvent[] = [];
        const hostedSession = makeHostedSession("already-met-progress", projectRoot, events);
        try {
            const result = await executePlan({
                planName: "already-met-progress",
                triageMeta: { planId: PLAN_ID, classification: "PLANNED_CHANGE" },
                hostedSession,
            });

            const messages = messagesFrom(events).join("\n");
            assertStringIncludes(messages, "running Plan Objective-Failing Check baseline...");
            assertStringIncludes(messages, "Execution did not start:");
            assertEquals(messages.includes("launching Plan Engineer to execute..."), false);
            assertEquals(result.executionComplete, false);
            assertEquals(hostedSession.getRootAgentName(), "planner");
            const plan = await loadPlan(projectRoot, "already-met-progress");
            assertEquals(plan?.attrs.status, "feedback");
        } finally {
            hostedSession.dispose();
            await Deno.remove(projectRoot, { recursive: true }).catch(() => undefined);
        }
    });
});
