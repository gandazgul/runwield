import { assert, assertEquals, assertExists } from "@std/assert";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { loadPlan, savePlan, updatePlanFrontMatter } from "../../plan-store.js";
import { HostedSession } from "../session/hosted-session.js";
import {
    acknowledgeTaskCompletion,
    claimPendingTaskCompletion,
    listPendingTaskCompletions,
    recordAcceptedTaskCompletion,
} from "../session/task-completion-session.ts";
import { isValidationCheckpoint, makeValidationCheckpoint } from "./validation-checkpoint.ts";

type HostedSessionManager = NonNullable<ConstructorParameters<typeof HostedSession>[0]["sessionManager"]>;

function hostedSessionManager(sessionManager: SessionManager): HostedSessionManager {
    return sessionManager as HostedSessionManager;
}

const PRODUCTION_ENTRY_FILES = [
    "../session/agent-handler.ts",
    "../session/session-runtime.js",
    "./orchestrator.ts",
    "./epic-continuation.ts",
    "../../cmd/load-plan/plan-execution.ts",
];

Deno.test("every production entry uses one validation owner", async () => {
    for (const relativePath of PRODUCTION_ENTRY_FILES) {
        const path = new URL(relativePath, import.meta.url);
        const source = await Deno.readTextFile(path);
        assert(source.includes("continueWorkflowValidation"), `${relativePath} does not use the supervisor`);
        assertEquals(source.includes("runValidationLoop"), false, `${relativePath} bypasses the supervisor`);
    }
    const supervisor = await Deno.readTextFile(new URL("./validation-supervisor.ts", import.meta.url));
    assert(supervisor.includes("export async function continueWorkflowValidation"));
    assert(supervisor.includes("await runValidationLoop"));
});

Deno.test("validation checkpoint survives a new Plan load", async () => {
    const root = await Deno.makeTempDir({ prefix: "runwield-validation-checkpoint-" });
    try {
        await savePlan(root, "demo", "# Demo\n", {
            planId: "plan-demo",
            classification: "PLANNED_CHANGE",
            status: "implemented",
            worktreeId: "wt-demo",
        });
        const plan = await loadPlan(root, "demo");
        assertExists(plan);
        const checkpoint = makeValidationCheckpoint({
            attemptId: "wt-demo",
            generation: "generation-one",
            status: "implemented",
            phase: "mechanical",
            state: "awaiting_repair",
            repairKind: "ci",
            repairGeneration: "repair-one",
        });
        await updatePlanFrontMatter(root, "demo", { validationCheckpoint: checkpoint }, plan.attrs, {
            expectedRevision: plan.revision,
        });

        const reopened = await loadPlan(root, "demo");
        assertExists(reopened);
        const value = reopened.attrs.validationCheckpoint;
        assert(value && typeof value === "object" && !Array.isArray(value));
        assert(isValidationCheckpoint(value as Record<string, string | number | undefined>));
        assertEquals(value.generation, "generation-one");
        assertEquals(value.repairGeneration, "repair-one");
    } finally {
        await Deno.remove(root, { recursive: true }).catch(() => {});
    }
});

Deno.test("repair completion survives process loss and resumes once", () => {
    const root = Deno.makeTempDirSync({ prefix: "runwield-validation-owner-" });
    try {
        const manager = SessionManager.inMemory(root);
        const first = new HostedSession({ id: "first", cwd: root, sessionManager: hostedSessionManager(manager) });
        const rootAgent = { dispose: () => {} };
        first.setRootAgentSession(rootAgent);
        first.setActiveExecutionWorkflow({
            planName: "demo",
            triageMeta: { classification: "PLANNED_CHANGE" },
            executionAgent: "engineer",
            executionStarted: true,
            executionMode: "non_git_in_place",
            nonGitInPlace: true,
            validationContinuation: true,
            validationGeneration: "generation-one",
        });
        const completionId = recordAcceptedTaskCompletion({
            hostedSession: first,
            toolCallId: "repair-done",
            agentName: "engineer",
            report: "- Fixed the failed check.",
            timestampMs: 10,
        });
        assertExists(completionId);

        // A new HostedSession reads the durable root journal. It claims the same
        // generation once, then writes one consumed event.
        const resumed = new HostedSession({ id: "resumed", cwd: root, sessionManager: hostedSessionManager(manager) });
        resumed.setRootAgentSession(rootAgent);
        resumed.setActiveExecutionWorkflow({
            planName: "demo",
            triageMeta: { classification: "PLANNED_CHANGE" },
            executionAgent: "engineer",
            executionStarted: true,
            executionMode: "non_git_in_place",
            nonGitInPlace: true,
            validationContinuation: true,
            validationGeneration: "generation-one",
        });
        const claim = claimPendingTaskCompletion(resumed, rootAgent);
        assertExists(claim);
        assertEquals(claim.validationGeneration, "generation-one");
        acknowledgeTaskCompletion(resumed, claim);
        assertEquals(listPendingTaskCompletions(resumed), []);
        assertEquals(claimPendingTaskCompletion(resumed, rootAgent), null);
    } finally {
        Deno.removeSync(root, { recursive: true });
    }
});
