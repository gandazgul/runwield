import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, join } from "@std/path";
import { listPlans, loadPlan, updatePlanCollaborationMetadata } from "../../plan-store.js";
import { runLoadPlanCommand } from "../../cmd/load-plan/index.ts";
import { withRuntimeCommandFixture } from "../../cmd/testing/runtime-command-fixture.ts";
import { createSessionRuntime } from "../session/session-runtime.js";
import { HostedSession } from "../session/hosted-session.js";
import { defineGitFixture, git } from "../git-test-fixture.ts";
import { COLLABORATION_LOCK_BYPASS } from "../collaboration/lock.js";
import { listEntries } from "../worktree-registry.js";
import { createExecutionStartPorts, startActiveExecutionWorkflow } from "./execution-start.ts";
import { resolveEpicContinuation } from "./epic-continuation.ts";
import { resolveWorkflowPlanLocation } from "./plan-location.ts";
import { preparePlanningWorktreeForPlan } from "./planning-worktree.ts";

async function writePlan(cwd: string, name: string, attrs: Record<string, unknown>, body: string) {
    const path = join(cwd, "docs", "plans", `${name}.md`);
    await Deno.mkdir(dirname(path), { recursive: true });
    const lines = ["---"];
    for (const [key, value] of Object.entries(attrs)) {
        if (Array.isArray(value)) {
            lines.push(`${key}:`);
            for (const item of value) lines.push(`  - ${JSON.stringify(item)}`);
        } else {
            lines.push(`${key}: ${JSON.stringify(value)}`);
        }
    }
    lines.push("---", "", body);
    await Deno.writeTextFile(path, lines.join("\n"));
}

function makeLoadUi(selections: Array<string | null>) {
    const pending = [...selections];
    const messages: string[] = [];
    const editor = {
        disableSubmit: true,
        setText: () => {},
        setAutocompleteProvider: () => {},
        handleInput: () => {},
    };
    const uiAPI = {
        abortActivePrompt: () => {},
        appendSystemMessage: (message: string) => messages.push(message),
        appendAgentMessageStart: () => ({ appendText: () => {} }),
        requestRender: () => {},
        promptSelect: (_title: string, options: Array<{ value: string }>) => {
            const selection = pending.shift() ?? null;
            if (selection && !options.some((option) => option.value === selection)) {
                throw new Error(`Fixture selection was not offered: ${selection}`);
            }
            return Promise.resolve(selection);
        },
        promptText: () => Promise.resolve(null),
        showModelSelector: () => {},
    };
    return { editor, messages, uiAPI };
}

const journeyFixture = defineGitFixture(async (repo) => {
    await writePlan(repo, "epic", {
        planId: "plan-epic",
        classification: "PROJECT",
        complexity: "HIGH",
        status: "ready_for_work",
        targetBranch: "epic-target",
        affectedPaths: [],
        createdAt: "2026-01-01T00:00:00.000Z",
    }, "# Epic\n");
    await git(repo, ["add", "."]);
    await git(repo, ["commit", "-m", "primary epic only"]);
    await git(repo, ["switch", "-c", "epic-target"]);
    await writePlan(repo, "epic/01-done", {
        planId: "plan-child-01",
        classification: "FEATURE",
        complexity: "MEDIUM",
        status: "validated",
        parentPlan: "epic",
        order: 1,
        targetBranch: "epic-target",
        affectedPaths: [],
        createdAt: "2026-01-01T00:00:00.000Z",
    }, "# Done child\n");
    await writePlan(repo, "epic/02-next", {
        planId: "plan-child-02",
        classification: "FEATURE",
        complexity: "MEDIUM",
        status: "ready_for_work",
        parentPlan: "epic",
        order: 2,
        dependencies: ["01-done"],
        targetBranch: "epic-target",
        affectedPaths: ["next.js"],
        createdAt: "2026-01-01T00:00:00.000Z",
    }, "# Next child\n\nTARGET NEXT BODY\n");
    await Deno.writeTextFile(join(repo, "target-only.js"), "target only\n");
    await git(repo, ["add", "."]);
    await git(repo, ["commit", "-m", "target child family"]);
    await git(repo, ["switch", "main"]);
});

Deno.test("Epic branch target child actions select a delivered document after cleanup", async () => {
    const repo = await journeyFixture.checkout();

    const updated = await updatePlanCollaborationMetadata(
        repo,
        "epic/02-next",
        { collaborationRevision: 7 },
        COLLABORATION_LOCK_BYPASS.pull,
    );
    const loaded = await resolveWorkflowPlanLocation(repo, "epic/02-next");
    const primary = await loadPlan(repo, "epic/02-next");

    assertEquals(primary, null);
    assertEquals(updated.planId, "plan-child-02");
    assertEquals(updated.collaborationRevision, 7);
    assert(loaded.documentRoot !== repo);
    assertEquals(loaded.plan?.attrs.collaborationRevision, 7);
});

Deno.test("Epic branch target lookup preserves non-Git child Plan loading", async () => {
    const repo = await Deno.makeTempDir();
    await writePlan(repo, "epic/02-next", {
        planId: "plain-child",
        classification: "FEATURE",
        complexity: "MEDIUM",
        status: "ready_for_work",
        parentPlan: "epic",
        targetBranch: "epic-target",
        affectedPaths: [],
        createdAt: "2026-01-01T00:00:00.000Z",
    }, "# Plain child\n");

    const loaded = await resolveWorkflowPlanLocation(repo, "epic/02-next");

    assertEquals(loaded.documentRoot, repo);
    assertEquals(loaded.plan?.attrs.planId, "plain-child");
});

Deno.test("Epic branch manual load command binds the Session to the target child document", async () => {
    await withRuntimeCommandFixture("epic-branch-manual-load-", async () => {
        const repo = await journeyFixture.checkout();
        const runtime = createSessionRuntime();
        const sessionId = await runtime.createPromptReadySession({ cwd: repo, agentName: "router" });
        const ui = makeLoadUi(["cancel"]);
        try {
            await runLoadPlanCommand(["epic/02-next"], {
                sessionRuntime: runtime,
                sessionId,
                uiAPI: ui.uiAPI,
                editor: ui.editor,
            });
            const loaded = await resolveWorkflowPlanLocation(repo, "epic/02-next");
            const snapshot = runtime.getSessionSnapshot(sessionId);

            assertStringIncludes(ui.messages.join("\n"), "Plan loaded: epic/02-next");
            assert(loaded.documentRoot !== repo);
            assertEquals(snapshot?.cwd, loaded.documentRoot);
        } finally {
            runtime.closeAllSessions();
        }
    });
});

Deno.test("Epic branch manual load uses target child documents and saved planning edits", async () => {
    const repo = await journeyFixture.checkout();
    const plansBefore = await listPlans(repo);
    assert(plansBefore.some((plan) => plan.name === "epic/02-next"));

    const planning = await preparePlanningWorktreeForPlan(repo, "epic/02-next", {
        planId: "plan-child-02",
        targetBranch: "epic-target",
    });
    const planPath = join(planning.entry.path, "docs", "plans", "epic", "02-next.md");
    await Deno.writeTextFile(
        planPath,
        (await Deno.readTextFile(planPath)).replace("TARGET NEXT BODY", "SAVED PLANNER BODY"),
    );

    const loaded = await resolveWorkflowPlanLocation(repo, "epic/02-next");
    const catalog = await listPlans(repo);
    const listed = catalog.find((plan) => plan.name === "epic/02-next");

    assertEquals(loaded.documentRoot, planning.entry.path);
    assertStringIncludes(loaded.plan?.markdown || "", "SAVED PLANNER BODY");
    assertEquals(listed?.path, planPath);
});

Deno.test("Epic branch execution promotion rollback restores planning state", async () => {
    const repo = await journeyFixture.checkout();
    const planning = await preparePlanningWorktreeForPlan(repo, "epic/02-next", {
        planId: "plan-child-02",
        targetBranch: "epic-target",
    });
    const planPath = join(planning.entry.path, "docs", "plans", "epic", "02-next.md");
    await Deno.writeTextFile(
        planPath,
        (await Deno.readTextFile(planPath)).replace('status: "ready_for_work"', 'status: "approved"'),
    );
    const plan = await loadPlan(planning.entry.path, "epic/02-next");
    assert(plan);
    const hostedSession = new HostedSession({ id: "epic-branch-promotion-rollback", cwd: repo, sessionManager: null });

    await startActiveExecutionWorkflow({
        planName: "epic/02-next",
        triageMeta: plan.attrs,
        currentStatus: plan.attrs.status,
        hostedSession,
        ports: createExecutionStartPorts(),
    }).catch(() => null);
    const entries = await listEntries(repo);

    assertEquals(entries.length, 1);
    assertEquals(entries[0].id, planning.entry.id);
    assertEquals(entries[0].status, "planning");
    assertEquals(entries[0].executionBaselineTree, undefined);
});

Deno.test("Epic branch execution promotes the saved planning worktree", async () => {
    const repo = await journeyFixture.checkout();
    const planning = await preparePlanningWorktreeForPlan(repo, "epic/02-next", {
        planId: "plan-child-02",
        targetBranch: "epic-target",
    });
    const plan = await loadPlan(planning.entry.path, "epic/02-next");
    assert(plan);
    const hostedSession = new HostedSession({ id: "epic-branch-promotion", cwd: repo, sessionManager: null });

    await startActiveExecutionWorkflow({
        planName: "epic/02-next",
        triageMeta: plan.attrs,
        currentStatus: plan.attrs.status,
        hostedSession,
        ports: createExecutionStartPorts(),
    });
    const workflow = hostedSession.getActiveExecutionWorkflow();
    const entries = await listEntries(repo);

    assertEquals(workflow?.worktreeId, planning.entry.id);
    assertEquals(workflow?.executionCwd, planning.entry.path);
    assertEquals(entries.length, 1);
    assertEquals(entries[0].status, "active");
});

Deno.test("Epic branch continuation selects the next child from target state", async () => {
    const repo = await journeyFixture.checkout();

    const resolution = await resolveEpicContinuation({ cwd: repo, completedPlanName: "epic/01-done" });

    assertEquals(resolution.kind, "execute");
    assertEquals(resolution.parentPlanName, "epic");
    assertEquals(resolution.childPlanName, "epic/02-next");
    assertEquals(resolution.childAttrs?.planId, "plan-child-02");
});

Deno.test("Epic branch continuation ignores stale primary completed child status", async () => {
    const repo = await journeyFixture.checkout();
    await writePlan(repo, "epic/01-done", {
        planId: "plan-child-01",
        classification: "FEATURE",
        complexity: "MEDIUM",
        status: "ready_for_work",
        parentPlan: "epic",
        order: 1,
        targetBranch: "epic-target",
        affectedPaths: [],
        createdAt: "2026-01-01T00:00:00.000Z",
    }, "# Stale done child\n");

    const resolution = await resolveEpicContinuation({ cwd: repo, completedPlanName: "epic/01-done" });

    assertEquals(resolution.kind, "execute");
    assertEquals(resolution.childPlanName, "epic/02-next");
});
