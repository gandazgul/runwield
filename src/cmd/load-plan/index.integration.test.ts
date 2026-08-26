import { assertEquals, assertStringIncludes } from "@std/assert";
import { type Context, fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import {
    loadArchivedPlan,
    loadPlan,
    parsePlanFrontMatter,
    resolveSiblingChildPlanDependencies,
    savePlan,
    updatePlanFrontMatter,
} from "../../plan-store.js";
import { createSessionRuntime, type SessionRuntime } from "../../shared/session/session-runtime.js";
import { addEntry, findById, removeEntry } from "../../shared/worktree-registry.js";
import { executePlanAction, loadPlanActionEvidence } from "../../shared/workflow/plan-actions.ts";
import { recordPlanEvent } from "../../shared/workflow/plan-lifecycle.js";
import { writeControllerState } from "../../shared/workflow/controller-registry.ts";
import { defineCommittedGitFixture } from "../../shared/git-test-fixture.ts";
import { withRuntimeCommandFixture } from "../testing/runtime-command-fixture.ts";
import { runLoadPlanCommand } from "./index.ts";
import type { PlanFrontMatterInput } from "../../plan-store.js";
import type { EditorAPI, SelectOption, UiAPI } from "../../ui/tui/types.js";

interface LoadPlanUiFixture {
    editor: EditorAPI;
    messages: string[];
    prompts: string[];
    uiAPI: UiAPI;
}

const recoverableArchiveFixture = defineCommittedGitFixture({ ".gitignore": ".wld/\n" });

function makeUi(selections: Array<string | null>, textInputs: Array<string | null> = []): LoadPlanUiFixture {
    const pendingSelections = [...selections];
    const pendingTextInputs = [...textInputs];
    const messages: string[] = [];
    const prompts: string[] = [];
    const editor: EditorAPI = {
        disableSubmit: true,
        setText: () => {},
        setAutocompleteProvider: () => {},
        handleInput: () => {},
    };
    const uiAPI: UiAPI = {
        abortActivePrompt: () => {},
        appendSystemMessage: (message) => messages.push(message),
        appendAgentMessageStart: () => ({ appendText: () => {} }),
        requestRender: () => {},
        promptSelect: (title: string, options: SelectOption[]) => {
            prompts.push(title);
            const selection = pendingSelections.shift() ?? null;
            if (selection && !options.some((option) => option.value === selection)) {
                throw new Error(`Fixture selection was not offered for "${title}": ${selection}`);
            }
            return Promise.resolve(selection);
        },
        promptText: () => Promise.resolve(pendingTextInputs.shift() ?? null),
        showModelSelector: () => {},
    };
    return { editor, messages, prompts, uiAPI };
}

async function createRuntime(
    projectRoot: string,
    agentName = "router",
): Promise<{ runtime: SessionRuntime; sessionId: string }> {
    const runtime = createSessionRuntime();
    const sessionId = await runtime.createPromptReadySession({ cwd: projectRoot, agentName });
    return { runtime, sessionId };
}

async function writePlan(
    projectRoot: string,
    planName: string,
    attrs: PlanFrontMatterInput,
    body = `# ${planName}`,
): Promise<void> {
    await savePlan(projectRoot, planName, body, {
        classification: "PLANNED_CHANGE",
        complexity: "LOW",
        summary: `Fixture ${planName}`,
        affectedPaths: [],
        ...attrs,
    });
}

async function git(projectRoot: string, args: string[]): Promise<string> {
    const result = await new Deno.Command("git", {
        cwd: projectRoot,
        args,
        stdout: "piped",
        stderr: "piped",
    }).output();
    if (!result.success) throw new Error(new TextDecoder().decode(result.stderr));
    return new TextDecoder().decode(result.stdout).trim();
}

async function prepareImplementedFollowUpPlan(
    projectRoot: string,
    executionAgent = "engineer",
): Promise<{ planName: string; worktreePath: string; worktreeBranch: string }> {
    await git(projectRoot, ["init", "-b", "main"]);
    await git(projectRoot, ["config", "user.email", "tests@example.com"]);
    await git(projectRoot, ["config", "user.name", "RunWield Tests"]);
    await writePlan(projectRoot, "follow-up", {
        status: "implemented",
        executionAgent,
        executionMode: "worktree",
        planId: "follow-up-plan",
    });
    await git(projectRoot, ["add", "."]);
    await git(projectRoot, ["commit", "-m", "fixture baseline"]);
    const baselineTree = await git(projectRoot, ["rev-parse", "HEAD^{tree}"]);
    const baseCommit = await git(projectRoot, ["rev-parse", "HEAD"]);
    const worktreePath = `${projectRoot}-follow-up-worktree`;
    const branch = `rw/follow-up-${executionAgent}`;
    await git(projectRoot, ["worktree", "add", "-b", branch, worktreePath, "HEAD"]);
    const plan = await loadPlan(projectRoot, "follow-up");
    if (!plan) throw new Error("follow-up Plan fixture disappeared");
    await updatePlanFrontMatter(
        projectRoot,
        "follow-up",
        {
            executionBaselineTree: baselineTree,
            worktreeId: "follow-up-worktree",
            worktreePath,
            worktreeBranch: branch,
            worktreeBaseBranch: "main",
            worktreeStatus: "completed",
        },
        plan.attrs,
        { expectedRevision: plan.revision },
    );
    await addEntry(projectRoot, {
        id: "follow-up-worktree",
        planName: "follow-up",
        planId: "follow-up-plan",
        path: worktreePath,
        branch,
        baseBranch: "main",
        baseRef: "main",
        baseCommit,
        baseTree: baselineTree,
        executionBaselineTree: baselineTree,
        status: "completed",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    });
    return { planName: "follow-up", worktreePath, worktreeBranch: branch };
}

async function captureLogs(run: () => Promise<void>): Promise<string[]> {
    const originalLog = console.log;
    const logs: string[] = [];
    console.log = (message = "") => logs.push(String(message));
    try {
        await run();
    } finally {
        console.log = originalLog;
    }
    return logs;
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await Deno.stat(path);
        return true;
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return false;
        throw error;
    }
}

async function assertImplementedFollowUpRebindsFromAgent(initialAgentName: string): Promise<void> {
    await withRuntimeCommandFixture(
        `runwield-load-plan-follow-up-${initialAgentName}-`,
        async ({ projectRoot, setModelResponseFactory }) => {
            const fixture = await prepareImplementedFollowUpPlan(projectRoot);
            const { runtime, sessionId } = await createRuntime(projectRoot, initialAgentName);
            const ui = makeUi(["follow_up"]);
            let replacementId = "";
            const unsubscribe = runtime.subscribeSessionEvents(sessionId, (event) => {
                if (event.type === "session_replaced") replacementId = event.newSessionId;
            });
            let modelCalls = 0;
            let systemPrompt = "";
            setModelResponseFactory((context: Context) => {
                modelCalls++;
                systemPrompt = context.systemPrompt || "";
                return fauxAssistantMessage(fauxText("Follow-up response."));
            });
            try {
                await runLoadPlanCommand([fixture.planName], {
                    sessionRuntime: runtime,
                    sessionId,
                    uiAPI: ui.uiAPI,
                    editor: ui.editor,
                });

                const rebound = runtime.getSessionSnapshot(replacementId);
                assertEquals(Boolean(replacementId && replacementId !== sessionId), true);
                assertEquals(rebound?.activeAgent, "plan-engineer");
                assertEquals(rebound?.activeExecutionWorkflow?.planName, fixture.planName);
                assertEquals(rebound?.activeExecutionWorkflow?.executionAgent, "engineer");
                assertEquals(rebound?.activeExecutionWorkflow?.executionCwd, fixture.worktreePath);
                assertEquals(modelCalls, 0);

                await runtime.promptSession(replacementId, { initialRequest: "Review the implemented change." });
                const afterTurn = runtime.getSessionSnapshot(replacementId);
                assertEquals(afterTurn?.activeExecutionWorkflow?.executionCwd, fixture.worktreePath);
                assertEquals(modelCalls, 1);
                assertStringIncludes(systemPrompt, "You are the Plan Engineer");
            } finally {
                unsubscribe();
                runtime.closeAllSessions();
            }
        },
    );
}

Deno.test("load-plan rebinds an implemented Plan follow-up from Router to its execution Agent and worktree", async () => {
    await assertImplementedFollowUpRebindsFromAgent("router");
});

Deno.test("load-plan rebinds an implemented Plan follow-up from Planner to its execution Agent and worktree", async () => {
    await assertImplementedFollowUpRebindsFromAgent("planner");
});

Deno.test("load-plan follow-up replaces the TUI Session with one rooted in the execution worktree", async () => {
    await withRuntimeCommandFixture(
        "runwield-load-plan-follow-up-replacement-",
        async ({ projectRoot, setModelResponseFactory }) => {
            const fixture = await prepareImplementedFollowUpPlan(projectRoot);
            const { runtime, sessionId } = await createRuntime(projectRoot, "planner");
            const ui = makeUi(["follow_up"]);
            let replacementId = "";
            const unsubscribe = runtime.subscribeSessionEvents(sessionId, (event) => {
                if (event.type === "session_replaced") replacementId = event.newSessionId;
            });
            let systemPrompt = "";
            setModelResponseFactory((context: Context) => {
                systemPrompt = context.systemPrompt || "";
                return fauxAssistantMessage(fauxText("Follow-up response."));
            });
            try {
                await runLoadPlanCommand([fixture.planName], {
                    sessionRuntime: runtime,
                    sessionId,
                    uiAPI: ui.uiAPI,
                    editor: ui.editor,
                });

                const replacement = runtime.getSessionSnapshot(replacementId);
                assertEquals(Boolean(replacementId && replacementId !== sessionId), true);
                assertEquals(replacement?.cwd, fixture.worktreePath);
                assertEquals(replacement?.activeAgent, "plan-engineer");
                assertEquals(replacement?.activeExecutionWorkflow?.executionCwd, fixture.worktreePath);
                assertEquals(await git(fixture.worktreePath, ["branch", "--show-current"]), fixture.worktreeBranch);

                await runtime.promptSession(replacementId, { initialRequest: "Review the implemented change." });
                const afterTurn = runtime.getSessionSnapshot(replacementId);
                assertEquals(afterTurn?.cwd, fixture.worktreePath);
                assertEquals(afterTurn?.activeExecutionWorkflow?.executionCwd, fixture.worktreePath);
                assertStringIncludes(systemPrompt, "You are the Plan Engineer");
            } finally {
                unsubscribe();
                runtime.closeAllSessions();
            }
        },
    );
});

Deno.test("load-plan prints its real command help", async () => {
    const logs = await captureLogs(() => runLoadPlanCommand(["--help"]));

    assertStringIncludes(logs.join("\n"), "load-plan");
});

Deno.test("sibling dependency resolution reads canonical child Plans from the fixture catalogue", async () => {
    await withRuntimeCommandFixture("runwield-load-plan-command-", async ({ projectRoot }) => {
        await writePlan(projectRoot, "epic", { classification: "PROJECT", status: "ready_for_work" });
        await writePlan(projectRoot, "epic/01-first", { status: "verified", parentPlan: "epic" });
        await writePlan(projectRoot, "epic/02-second", { status: "implemented", parentPlan: "epic" });

        const dependencies = await resolveSiblingChildPlanDependencies(projectRoot, "epic", [
            "01-first",
            "epic/02-second",
            "03-missing",
        ]);

        assertEquals(
            dependencies.map(({ dependency, planName, status, state }) => ({ dependency, planName, status, state })),
            [
                { dependency: "01-first", planName: "epic/01-first", status: "verified", state: "verified" },
                {
                    dependency: "epic/02-second",
                    planName: "epic/02-second",
                    status: "implemented",
                    state: "unverified",
                },
                { dependency: "03-missing", planName: undefined, status: undefined, state: "missing" },
            ],
        );
    });
});

Deno.test("load-plan discovers real top-level Plans and leaves child Plans out of the picker", async () => {
    await withRuntimeCommandFixture("runwield-load-plan-command-", async ({ projectRoot }) => {
        await writePlan(projectRoot, "epic", { classification: "PROJECT", status: "draft" });
        await writePlan(projectRoot, "epic/child", { parentPlan: "epic", status: "draft" });
        const { runtime, sessionId } = await createRuntime(projectRoot);
        const ui = makeUi(["epic", "cancel"]);
        try {
            await runLoadPlanCommand([], {
                sessionRuntime: runtime,
                sessionId,
                uiAPI: ui.uiAPI,
                editor: ui.editor,
            });

            assertEquals(ui.prompts[0], "Load plan:");
            assertStringIncludes(ui.messages.join("\n"), "Plan loaded: epic");
            assertEquals(ui.messages.join("\n").includes("Plan loaded: epic/child"), false);
        } finally {
            runtime.closeAllSessions();
        }
    });
});

Deno.test("load-plan reports an empty real Plan catalogue without touching the checkout", async () => {
    await withRuntimeCommandFixture("runwield-load-plan-command-", async ({ projectRoot }) => {
        const { runtime, sessionId } = await createRuntime(projectRoot);
        const ui = makeUi([]);
        try {
            await runLoadPlanCommand([], {
                sessionRuntime: runtime,
                sessionId,
                uiAPI: ui.uiAPI,
                editor: ui.editor,
            });

            assertEquals(ui.messages, ["No plans available, start one by entering a new request"]);
            assertEquals(ui.editor.disableSubmit, false);
        } finally {
            runtime.closeAllSessions();
        }
    });
});

Deno.test("load-plan archives a verified Plan through the real Plan store", async () => {
    await withRuntimeCommandFixture("runwield-load-plan-command-", async ({ projectRoot }) => {
        await writePlan(projectRoot, "finished", { status: "verified" });
        const { runtime, sessionId } = await createRuntime(projectRoot);
        const ui = makeUi(["archive"]);
        try {
            await runLoadPlanCommand(["finished"], {
                sessionRuntime: runtime,
                sessionId,
                uiAPI: ui.uiAPI,
                editor: ui.editor,
            });

            assertEquals(await loadPlan(projectRoot, "finished"), null);
            assertEquals((await loadArchivedPlan(projectRoot, "finished"))?.attrs.archivedFromStatus, "verified");
            assertStringIncludes(ui.messages.join("\n"), "Archived finished");
        } finally {
            runtime.closeAllSessions();
        }
    });
});

Deno.test("load-plan offers lifecycle actions for a validated Plan already published to its target branch", async () => {
    await withRuntimeCommandFixture("runwield-load-plan-command-", async ({ projectRoot }) => {
        await git(projectRoot, ["init", "-b", "main"]);
        await git(projectRoot, ["config", "user.email", "tests@example.com"]);
        await git(projectRoot, ["config", "user.name", "RunWield Tests"]);
        await git(projectRoot, ["commit", "--allow-empty", "-m", "fixture baseline"]);
        const executionCommit = await git(projectRoot, ["rev-parse", "HEAD"]);
        await writePlan(projectRoot, "published", {
            status: "validated",
            executionMode: "worktree",
            deliveryEvidence: {
                version: 1,
                mode: "worktree_merge",
                executionCommit,
                targetBranch: "main",
                targetHeadBeforeMerge: executionCommit,
            },
        });
        const { runtime, sessionId } = await createRuntime(projectRoot);
        const ui = makeUi(["archive"]);
        try {
            await runLoadPlanCommand(["published"], {
                sessionRuntime: runtime,
                sessionId,
                uiAPI: ui.uiAPI,
                editor: ui.editor,
            });

            assertEquals(ui.prompts.includes("What would you like to do?"), true);
            assertEquals(await loadPlan(projectRoot, "published"), null);
            assertEquals((await loadArchivedPlan(projectRoot, "published"))?.attrs.archivedFromStatus, "validated");
        } finally {
            runtime.closeAllSessions();
        }
    });
});

Deno.test("load-plan abandons unregistered legacy recovery before archiving a User Verified Plan", async () => {
    await withRuntimeCommandFixture("runwield-load-plan-command-", async ({ projectRoot }) => {
        const lostPath = `${projectRoot}/lost-worktree`;
        await writePlan(projectRoot, "finished-with-stale-worktree", {
            planId: "lost-plan",
            status: "user_verified",
            executionMode: "worktree",
            worktreeStatus: "validation_failed",
            worktreeId: "lost-worktree",
            worktreePath: lostPath,
            worktreeBranch: "worktree/lost-worktree",
            worktreeBaseBranch: "main",
        });
        await writeControllerState(
            projectRoot,
            { planId: "lost-plan", planName: "finished-with-stale-worktree" },
            {},
            {
                recovery: {
                    worktreeId: "lost-worktree",
                    worktreePath: lostPath,
                    worktreeBranch: "worktree/lost-worktree",
                    worktreeBaseBranch: "main",
                    worktreeStatus: "validation_failed",
                },
            },
        );
        assertEquals(await findById(projectRoot, "lost-worktree"), null);
        const { runtime, sessionId } = await createRuntime(projectRoot);
        const ui = makeUi(["abandon", "confirm", "archive"]);
        try {
            await runLoadPlanCommand(["finished-with-stale-worktree"], {
                sessionRuntime: runtime,
                sessionId,
                uiAPI: ui.uiAPI,
                editor: ui.editor,
            });

            assertEquals(await loadPlan(projectRoot, "finished-with-stale-worktree"), null);
            const archived = await loadArchivedPlan(projectRoot, "finished-with-stale-worktree");
            assertEquals(archived?.attrs.archivedFromStatus, "user_verified");
            assertEquals(archived?.attrs.worktreeStatus, undefined, "unregistered recovery hints remain cleared");
            assertEquals(archived?.attrs.worktreeId, undefined);
            assertEquals(archived?.attrs.worktreePath, undefined);
            const archivedDocument = parsePlanFrontMatter(archived?.markdown || "").attrs;
            assertEquals(archivedDocument.worktreeStatus, undefined, "archives do not contain runtime state");
            assertEquals(archivedDocument.worktreeId, undefined);
            assertStringIncludes(ui.messages.join("\n"), "Archived finished-with-stale-worktree");
        } finally {
            runtime.closeAllSessions();
        }
    });
});

Deno.test("load-plan archives a verified Epic with every child Plan and keeps the folder structure", async () => {
    await withRuntimeCommandFixture("runwield-load-plan-command-", async ({ projectRoot }) => {
        await writePlan(projectRoot, "epic", { classification: "PROJECT", status: "verified" });
        await writePlan(projectRoot, "epic/01-first", { status: "verified", parentPlan: "epic", order: 1 });
        await writePlan(projectRoot, "epic/02-second", { status: "ready_for_work", parentPlan: "epic", order: 2 });
        const { runtime, sessionId } = await createRuntime(projectRoot);
        const ui = makeUi(["archive_epic", "confirm"]);
        try {
            await runLoadPlanCommand(["epic"], {
                sessionRuntime: runtime,
                sessionId,
                uiAPI: ui.uiAPI,
                editor: ui.editor,
            });

            assertEquals(await loadPlan(projectRoot, "epic"), null);
            assertEquals(await loadPlan(projectRoot, "epic/01-first"), null);
            assertEquals(await loadPlan(projectRoot, "epic/02-second"), null);
            assertEquals((await loadArchivedPlan(projectRoot, "epic"))?.attrs.archivedFromStatus, "verified");
            assertEquals((await loadArchivedPlan(projectRoot, "epic/01-first"))?.attrs.archivedFromStatus, "verified");
            assertEquals(
                (await loadArchivedPlan(projectRoot, "epic/02-second"))?.attrs.archivedFromStatus,
                "ready_for_work",
            );
            await Deno.stat(`${projectRoot}/docs/plans/archived/epic.md`);
            await Deno.stat(`${projectRoot}/docs/plans/archived/epic/01-first.md`);
            await Deno.stat(`${projectRoot}/docs/plans/archived/epic/02-second.md`);
            assertEquals(await pathExists(`${projectRoot}/docs/plans/epic`), false);
        } finally {
            runtime.closeAllSessions();
        }
    });
});

Deno.test("load-plan refuses to archive an Epic whose child has a recoverable worktree", async () => {
    await withRuntimeCommandFixture("runwield-load-plan-command-", async () => {
        const projectRoot = await recoverableArchiveFixture.checkout();
        await writePlan(projectRoot, "epic", { classification: "PROJECT", status: "verified" });
        await writePlan(projectRoot, "epic/child", {
            planId: "active-child",
            status: "ready_for_work",
            parentPlan: "epic",
            worktreeStatus: "active",
        });
        await git(projectRoot, ["add", "docs"]);
        await git(projectRoot, ["commit", "-m", "Epic with recoverable child"]);
        const worktreePath = `${projectRoot}-child`;
        await git(projectRoot, ["worktree", "add", "-b", "worktree/child", worktreePath]);
        await addEntry(projectRoot, {
            id: "child-attempt",
            planId: "active-child",
            planName: "epic/child",
            path: worktreePath,
            branch: "worktree/child",
            baseBranch: "main",
            baseRef: "main",
            baseCommit: await git(projectRoot, ["rev-parse", "HEAD"]),
            baseTree: await git(projectRoot, ["rev-parse", "HEAD^{tree}"]),
            status: "active",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
        });
        const { runtime, sessionId } = await createRuntime(projectRoot);
        const ui = makeUi(["archive_epic", "cancel"]);
        try {
            await runLoadPlanCommand(["epic"], {
                sessionRuntime: runtime,
                sessionId,
                uiAPI: ui.uiAPI,
                editor: ui.editor,
            });

            assertEquals((await loadPlan(projectRoot, "epic"))?.attrs.status, "verified");
            assertEquals((await loadPlan(projectRoot, "epic/child"))?.attrs.worktreeStatus, "active");
            assertEquals(await loadArchivedPlan(projectRoot, "epic"), null);
            assertEquals(await loadArchivedPlan(projectRoot, "epic/child"), null);
            assertStringIncludes(ui.messages.join("\n"), "epic/child");
            assertStringIncludes(ui.messages.join("\n"), "active");
        } finally {
            runtime.closeAllSessions();
            await git(projectRoot, ["worktree", "remove", "--force", worktreePath]).catch(() => {});
            await Deno.remove(projectRoot, { recursive: true });
        }
    });
});

Deno.test("load-plan puts a draft Plan on hold through the lifecycle transaction", async () => {
    await withRuntimeCommandFixture("runwield-load-plan-command-", async ({ projectRoot }) => {
        await writePlan(projectRoot, "paused", { status: "draft" });
        const { runtime, sessionId } = await createRuntime(projectRoot);
        const ui = makeUi(["hold"], ["Waiting for fixture input"]);
        try {
            await runLoadPlanCommand(["paused"], {
                sessionRuntime: runtime,
                sessionId,
                uiAPI: ui.uiAPI,
                editor: ui.editor,
            });

            const plan = await loadPlan(projectRoot, "paused");
            assertEquals(plan?.attrs.status, "on_hold");
            assertEquals(plan?.attrs.holdReason, "Waiting for fixture input");
        } finally {
            runtime.closeAllSessions();
        }
    });
});

Deno.test("load-plan resumes an on-hold Plan after the real non-Git Resume Check", async () => {
    await withRuntimeCommandFixture("runwield-load-plan-command-", async ({ projectRoot }) => {
        await writePlan(projectRoot, "paused", {
            status: "on_hold",
            heldFromStatus: "draft",
            holdReason: "Waiting for fixture input",
        });
        const { runtime, sessionId } = await createRuntime(projectRoot);
        const ui = makeUi(["resume", "cancel"]);
        try {
            await runLoadPlanCommand(["paused"], {
                sessionRuntime: runtime,
                sessionId,
                uiAPI: ui.uiAPI,
                editor: ui.editor,
            });

            assertEquals((await loadPlan(projectRoot, "paused"))?.attrs.status, "draft");
            assertStringIncludes(ui.messages.join("\n"), "Resumed from hold");
        } finally {
            runtime.closeAllSessions();
        }
    });
});

Deno.test("load-plan marks an Epic done enough only after the real lifecycle write", async () => {
    await withRuntimeCommandFixture("runwield-load-plan-command-", async ({ projectRoot }) => {
        await writePlan(projectRoot, "epic", { classification: "PROJECT", status: "ready_for_work" });
        await writePlan(projectRoot, "epic/child", {
            status: "ready_for_work",
            parentPlan: "epic",
            order: 1,
        });
        const { runtime, sessionId } = await createRuntime(projectRoot);
        const ui = makeUi(["done_enough", "confirm", "cancel"]);
        try {
            await runLoadPlanCommand(["epic"], {
                sessionRuntime: runtime,
                sessionId,
                uiAPI: ui.uiAPI,
                editor: ui.editor,
            });

            const epic = await loadPlan(projectRoot, "epic");
            assertEquals(epic?.attrs.status, "validated");
            assertEquals(typeof epic?.attrs.epicDoneEnoughAt, "string");
            assertEquals((await loadPlan(projectRoot, "epic/child"))?.attrs.status, "ready_for_work");
        } finally {
            runtime.closeAllSessions();
        }
    });
});

Deno.test("Approve for Later creates no execution segment", async () => {
    await withRuntimeCommandFixture("runwield-load-plan-command-", async ({ projectRoot }) => {
        await writePlan(projectRoot, "reviewed", { status: "approved" });
        const { runtime, sessionId } = await createRuntime(projectRoot);
        runtime.setInteractionAdapter(sessionId, {
            requestInteraction: async (request) => {
                const plan = await loadPlan(projectRoot, "reviewed");
                return {
                    outcome: "accepted",
                    _meta: {
                        approved: true,
                        approvalAction: "later",
                        revision: plan?.revision,
                        planAttrs: plan?.attrs,
                        interactionType: request.type,
                    },
                };
            },
        });
        const ui = makeUi(["review"]);
        try {
            await runLoadPlanCommand(["reviewed"], {
                sessionRuntime: runtime,
                sessionId,
                uiAPI: ui.uiAPI,
                editor: ui.editor,
            });

            assertEquals(
                (await loadPlan(projectRoot, "reviewed"))?.attrs.status,
                "ready_for_work",
                ui.messages.join("\n"),
            );
            assertEquals(runtime.getRuntimeActiveExecutionWorkflow(sessionId), null);
            assertStringIncludes(ui.messages.join("\n"), "Plan saved. Resume later");
        } finally {
            runtime.closeAllSessions();
        }
    });
});

Deno.test("load-plan runs the real Planner and plan_written machinery against the faux model boundary", async () => {
    await withRuntimeCommandFixture(
        "runwield-load-plan-command-",
        async ({ projectRoot, setModelMessages }) => {
            await writePlan(projectRoot, "planned", { status: "draft" });
            setModelMessages([
                fauxAssistantMessage(fauxToolCall("plan_written", {
                    planName: "planned",
                })),
            ]);
            const { runtime, sessionId } = await createRuntime(projectRoot);
            runtime.setInteractionAdapter(sessionId, {
                requestInteraction: async () => {
                    const beforeReview = await loadPlan(projectRoot, "planned");
                    if (!beforeReview) throw new Error("Fixture Plan disappeared before review");
                    await recordPlanEvent({
                        cwd: projectRoot,
                        planName: "planned",
                        event: "review_approved",
                        currentStatus: beforeReview.attrs.status,
                        expectedRevision: beforeReview.revision,
                        details: { triageMeta: beforeReview.attrs },
                    });
                    const approved = await loadPlan(projectRoot, "planned");
                    return {
                        outcome: "accepted",
                        _meta: {
                            approved: true,
                            approvalAction: "later",
                            revision: approved?.revision,
                            planAttrs: approved?.attrs,
                        },
                    };
                },
            });
            const ui = makeUi(["resume"]);
            try {
                await runLoadPlanCommand(["planned"], {
                    sessionRuntime: runtime,
                    sessionId,
                    uiAPI: ui.uiAPI,
                    editor: ui.editor,
                });

                assertEquals((await loadPlan(projectRoot, "planned"))?.attrs.status, "ready_for_work");
                assertEquals(runtime.getSessionSnapshot(sessionId)?.activeAgent, "planner");
                // The resumed Planner turn records the Plan it was opened on, so a
                // compaction mid-draft still has a pointer back to the file.
                assertEquals(runtime.getSessionSnapshot(sessionId)?.workflowContext?.planName, "planned");
            } finally {
                runtime.closeAllSessions();
            }
        },
    );
});

Deno.test("load-plan uses real Git history and cancels stale affected-path execution", async () => {
    await withRuntimeCommandFixture("runwield-load-plan-command-", async ({ projectRoot }) => {
        await git(projectRoot, ["init", "-b", "main"]);
        await git(projectRoot, ["config", "user.email", "tests@example.com"]);
        await git(projectRoot, ["config", "user.name", "RunWield Tests"]);
        await Deno.writeTextFile(`${projectRoot}/app.ts`, "export const value = 1;\n");
        await writePlan(projectRoot, "stale", {
            status: "ready_for_work",
            affectedPaths: ["app.ts"],
            updatedAt: "2020-01-01T00:00:00.000Z",
        });
        await git(projectRoot, ["add", "."]);
        await git(projectRoot, ["commit", "-m", "fixture baseline"]);
        await Deno.writeTextFile(`${projectRoot}/app.ts`, "export const value = 2;\n");
        await git(projectRoot, ["add", "app.ts"]);
        await git(projectRoot, ["commit", "-m", "change affected path"]);

        const { runtime, sessionId } = await createRuntime(projectRoot);
        const ui = makeUi(["proceed", "cancel"]);
        try {
            await runLoadPlanCommand(["stale"], {
                sessionRuntime: runtime,
                sessionId,
                uiAPI: ui.uiAPI,
                editor: ui.editor,
            });

            assertEquals((await loadPlan(projectRoot, "stale"))?.attrs.status, "ready_for_work");
            assertStringIncludes(ui.messages.join("\n"), "touched affected paths");
            assertStringIncludes(ui.messages.join("\n"), "Execution canceled");
        } finally {
            runtime.closeAllSessions();
        }
    });
});

Deno.test("load-plan blocks a child Plan while its real parent Epic is on hold", async () => {
    await withRuntimeCommandFixture("runwield-load-plan-command-", async ({ projectRoot }) => {
        await writePlan(projectRoot, "epic", { classification: "PROJECT", status: "on_hold", heldFromStatus: "draft" });
        await writePlan(projectRoot, "epic/child", { status: "draft", parentPlan: "epic" });
        const { runtime, sessionId } = await createRuntime(projectRoot);
        const ui = makeUi(["cancel"]);
        try {
            await runLoadPlanCommand(["epic/child"], {
                sessionRuntime: runtime,
                sessionId,
                uiAPI: ui.uiAPI,
                editor: ui.editor,
            });

            assertEquals((await loadPlan(projectRoot, "epic/child"))?.attrs.status, "draft");
            assertStringIncludes(ui.messages.join("\n"), 'Parent Epic "epic" is on hold');
        } finally {
            runtime.closeAllSessions();
        }
    });
});

Deno.test("load-plan recursively loads a real child selected from an Epic", async () => {
    await withRuntimeCommandFixture("runwield-load-plan-command-", async ({ projectRoot }) => {
        await writePlan(projectRoot, "epic", { classification: "PROJECT", status: "ready_for_work" });
        await writePlan(projectRoot, "epic/child", { status: "draft", parentPlan: "epic", order: 1 });
        const { runtime, sessionId } = await createRuntime(projectRoot);
        const ui = makeUi(["pick_child", "epic/child", "load", "cancel"]);
        try {
            await runLoadPlanCommand(["epic"], {
                sessionRuntime: runtime,
                sessionId,
                uiAPI: ui.uiAPI,
                editor: ui.editor,
            });

            assertStringIncludes(ui.messages.join("\n"), "Plan loaded: epic/child");
            assertEquals((await loadPlan(projectRoot, "epic/child"))?.attrs.status, "draft");
        } finally {
            runtime.closeAllSessions();
        }
    });
});

Deno.test("load-plan adopts a plain Markdown file into the real Plan catalogue", async () => {
    await withRuntimeCommandFixture("runwield-load-plan-command-", async ({ projectRoot }) => {
        await Deno.mkdir(`${projectRoot}/docs/plans`, { recursive: true });
        await Deno.writeTextFile(`${projectRoot}/docs/plans/external.md`, "# External Plan\n\nKeep this body.\n");
        const { runtime, sessionId } = await createRuntime(projectRoot);
        const ui = makeUi(["cancel"]);
        try {
            await runLoadPlanCommand(["external"], {
                sessionRuntime: runtime,
                sessionId,
                uiAPI: ui.uiAPI,
                editor: ui.editor,
            });

            const plan = await loadPlan(projectRoot, "external");
            assertEquals(plan?.attrs.status, "draft");
            assertEquals(typeof plan?.attrs.planId, "string");
            assertStringIncludes(plan?.body || "", "Keep this body.");
            assertStringIncludes(ui.messages.join("\n"), "Adopted external as a RunWield Plan");
        } finally {
            runtime.closeAllSessions();
        }
    });
});

Deno.test("load-plan recovery rejects replaced worktree registry evidence before mutation", async () => {
    await withRuntimeCommandFixture("runwield-load-plan-command-", async ({ projectRoot }) => {
        const worktreePath = `${projectRoot}-failed-worktree`;
        const worktreeBranch = "worktree/failed-worktree-old";
        await writePlan(projectRoot, "failed-worktree", {
            status: "failed",
            planId: "plan-failed-worktree",
            executionMode: "worktree",
            worktreeId: "wt-old",
            worktreePath,
            worktreeBranch,
            worktreeBaseBranch: "main",
            worktreeStatus: "active",
            failureReason: "Fixture execution stopped",
        });
        await git(projectRoot, ["init", "-b", "main"]);
        await git(projectRoot, ["config", "user.email", "runwield@example.test"]);
        await git(projectRoot, ["config", "user.name", "RunWield Test"]);
        await git(projectRoot, ["add", "docs/plans/failed-worktree.md"]);
        await git(projectRoot, ["commit", "-m", "seed failed worktree Plan"]);
        const baseCommit = await git(projectRoot, ["rev-parse", "HEAD"]);
        await git(projectRoot, ["worktree", "add", "-b", worktreeBranch, worktreePath, "HEAD"]);
        try {
            await addEntry(projectRoot, {
                id: "wt-old",
                planName: "failed-worktree",
                planId: "plan-failed-worktree",
                baseBranch: "main",
                baseRef: "refs/heads/main",
                baseCommit,
                branch: worktreeBranch,
                path: worktreePath,
                status: "active",
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
            });
            const evidence = await loadPlanActionEvidence(projectRoot, "plan-failed-worktree");
            if (evidence.kind !== "success") throw new Error(evidence.message);
            // Replace the actual attempt, not a retired Plan front-matter pointer.
            const old = await findById(projectRoot, "wt-old");
            if (!old) throw new Error("fixture attempt disappeared");
            await removeEntry(projectRoot, "wt-old");
            await addEntry(projectRoot, { ...old, id: "wt-new" });

            const result = await executePlanAction(projectRoot, {
                planId: "plan-failed-worktree",
                expectedRevision: evidence.evidence.revision,
                expectedStatus: evidence.evidence.status,
                expectedWorktree: evidence.evidence.worktree,
                action: "reset_to_draft",
            });

            assertEquals(result.kind, "recovery_required");
            assertEquals((await loadPlan(worktreePath, "failed-worktree"))?.attrs.status, "failed");
        } finally {
            await git(projectRoot, ["worktree", "remove", "--force", worktreePath]).catch(() => {});
        }
    });
});

Deno.test("load-plan enters real recovery for a failed Plan and cancellation preserves it", async () => {
    await withRuntimeCommandFixture("runwield-load-plan-command-", async ({ projectRoot }) => {
        await writePlan(projectRoot, "failed", {
            status: "failed",
            failureReason: "Fixture execution stopped",
            executionMode: "non_git_in_place",
        });
        const { runtime, sessionId } = await createRuntime(projectRoot);
        const ui = makeUi(["inspect", "cancel"]);
        try {
            await runLoadPlanCommand(["failed"], {
                sessionRuntime: runtime,
                sessionId,
                uiAPI: ui.uiAPI,
                editor: ui.editor,
            });

            assertEquals((await loadPlan(projectRoot, "failed"))?.attrs.status, "failed");
            assertEquals(ui.prompts.filter((prompt) => prompt === "Plan recovery (failed):").length, 2);
        } finally {
            runtime.closeAllSessions();
        }
    });
});

Deno.test("load-plan hold recovery exits after one prompt and puts the failed Plan on hold", async () => {
    await withRuntimeCommandFixture("runwield-load-plan-command-", async ({ projectRoot }) => {
        await writePlan(projectRoot, "failed-hold", {
            status: "failed",
            failureReason: "Fixture execution stopped",
            executionMode: "non_git_in_place",
        });
        const { runtime, sessionId } = await createRuntime(projectRoot);
        const ui = makeUi(["hold"]);
        try {
            await runLoadPlanCommand(["failed-hold"], {
                sessionRuntime: runtime,
                sessionId,
                uiAPI: ui.uiAPI,
                editor: ui.editor,
            });

            assertEquals((await loadPlan(projectRoot, "failed-hold"))?.attrs.status, "on_hold");
            assertEquals(ui.prompts.filter((prompt) => prompt === "Plan recovery (failed):").length, 1);
        } finally {
            runtime.closeAllSessions();
        }
    });
});
