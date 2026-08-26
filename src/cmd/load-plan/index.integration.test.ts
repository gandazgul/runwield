import { assertEquals, assertStringIncludes } from "@std/assert";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { loadArchivedPlan, loadPlan, resolveSiblingChildPlanDependencies, savePlan } from "../../plan-store.js";
import { createSessionRuntime, type SessionRuntime } from "../../shared/session/session-runtime.js";
import { recordPlanEvent } from "../../shared/workflow/plan-lifecycle.js";
import { withRuntimeCommandFixture } from "../testing/runtime-command-fixture.ts";
import { runLoadPlanCommand } from "./index.ts";
import type { PlanFrontMatterInput } from "../../plan-store.js";
import type { EditorAPI, SelectOption, UiAPI } from "../../ui/tui/types.js";

interface LoadPlanUiFixture {
    editor: EditorAPI;
    messages: string[];
    promptOptions: SelectOption[][];
    prompts: string[];
    uiAPI: UiAPI;
}

function makeUi(selections: Array<string | null>, textInputs: Array<string | null> = []): LoadPlanUiFixture {
    const pendingSelections = [...selections];
    const pendingTextInputs = [...textInputs];
    const messages: string[] = [];
    const promptOptions: SelectOption[][] = [];
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
            promptOptions.push(options);
            const selection = pendingSelections.shift() ?? null;
            if (selection && !options.some((option) => option.value === selection)) {
                throw new Error(`Fixture selection was not offered for "${title}": ${selection}`);
            }
            return Promise.resolve(selection);
        },
        promptText: () => Promise.resolve(pendingTextInputs.shift() ?? null),
        showModelSelector: () => {},
    };
    return { editor, messages, promptOptions, prompts, uiAPI };
}

async function createRuntime(projectRoot: string): Promise<{ runtime: SessionRuntime; sessionId: string }> {
    const runtime = createSessionRuntime();
    const sessionId = await runtime.createPromptReadySession({ cwd: projectRoot, agentName: "router" });
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
        objectiveChecks: [{ id: "OC1", command: "true" }],
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

Deno.test("load-plan abandons a lost worktree before archiving a User Verified Plan", async () => {
    await withRuntimeCommandFixture("runwield-load-plan-command-", async ({ projectRoot }) => {
        const lostPath = `${projectRoot}/lost-worktree`;
        await writePlan(projectRoot, "finished-with-stale-worktree", {
            status: "user_verified",
            executionMode: "worktree",
            worktreeStatus: "validation_failed",
            worktreeId: "lost-worktree",
            worktreePath: lostPath,
            worktreeBranch: "worktree/lost-worktree",
            worktreeBaseBranch: "main",
        });
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
            assertEquals(archived?.attrs.worktreeStatus, "abandoned");
            assertEquals(archived?.attrs.worktreeId, undefined);
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
    await withRuntimeCommandFixture("runwield-load-plan-command-", async ({ projectRoot }) => {
        await writePlan(projectRoot, "epic", { classification: "PROJECT", status: "verified" });
        await writePlan(projectRoot, "epic/child", {
            status: "ready_for_work",
            parentPlan: "epic",
            worktreeStatus: "active",
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

Deno.test("direct review from draft approves for later without a planning turn", async () => {
    await withRuntimeCommandFixture("runwield-load-plan-command-", async ({ projectRoot }) => {
        await writePlan(projectRoot, "direct-draft", { status: "draft" });
        const { runtime, sessionId } = await createRuntime(projectRoot);
        runtime.setInteractionAdapter(sessionId, {
            requestInteraction: async () => {
                const beforeReview = await loadPlan(projectRoot, "direct-draft");
                if (!beforeReview) throw new Error("Fixture Plan disappeared before direct review");
                assertEquals(runtime.getSessionSnapshot(sessionId)?.workflowContext?.planName, undefined);
                await recordPlanEvent({
                    cwd: projectRoot,
                    planName: "direct-draft",
                    event: "review_approved",
                    currentStatus: beforeReview.attrs.status,
                    expectedRevision: beforeReview.revision,
                    details: { triageMeta: beforeReview.attrs },
                });
                const approved = await loadPlan(projectRoot, "direct-draft");
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
        const ui = makeUi(["review"]);
        try {
            await runLoadPlanCommand(["direct-draft"], {
                sessionRuntime: runtime,
                sessionId,
                uiAPI: ui.uiAPI,
                editor: ui.editor,
            });

            assertEquals((await loadPlan(projectRoot, "direct-draft"))?.attrs.status, "ready_for_work");
            assertEquals(runtime.getRuntimeActiveExecutionWorkflow(sessionId), null);
            assertEquals(
                ui.promptOptions[0].some((option) => option.value === "review" && option.label === "Review plan"),
                true,
            );
        } finally {
            runtime.closeAllSessions();
        }
    });
});

Deno.test("direct review from draft can approve and start execution", async () => {
    await withRuntimeCommandFixture("runwield-load-plan-command-", async ({ projectRoot, setModelMessages }) => {
        await writePlan(projectRoot, "direct-run", {
            status: "draft",
            objectiveChecks: [{ id: "OC1", command: "false" }],
        });
        setModelMessages([fauxAssistantMessage(fauxToolCall("task_completed", { message: "- direct run complete" }))]);
        const { runtime, sessionId } = await createRuntime(projectRoot);
        runtime.setInteractionAdapter(sessionId, {
            requestInteraction: async (request) => {
                if (
                    request.type === "select" && request.options?.some((option) => option.value === "proceed") === true
                ) {
                    return { outcome: "selected", value: "proceed" };
                }
                const beforeReview = await loadPlan(projectRoot, "direct-run");
                if (!beforeReview) throw new Error("Fixture Plan disappeared before direct review");
                await recordPlanEvent({
                    cwd: projectRoot,
                    planName: "direct-run",
                    event: "review_approved",
                    currentStatus: beforeReview.attrs.status,
                    expectedRevision: beforeReview.revision,
                    details: { triageMeta: beforeReview.attrs },
                });
                const approved = await loadPlan(projectRoot, "direct-run");
                return {
                    outcome: "accepted",
                    _meta: {
                        approved: true,
                        approvalAction: "run",
                        revision: approved?.revision,
                        planAttrs: approved?.attrs,
                    },
                };
            },
        });
        const ui = makeUi(["review", "proceed"]);
        try {
            await runLoadPlanCommand(["direct-run"], {
                sessionRuntime: runtime,
                sessionId,
                uiAPI: ui.uiAPI,
                editor: ui.editor,
            });

            assertEquals((await loadPlan(projectRoot, "direct-run"))?.attrs.executionMode, "non_git_in_place");
            assertEquals((await loadPlan(projectRoot, "direct-run"))?.attrs.status === "draft", false);
            assertEquals(
                ui.promptOptions[0].some((option) => option.value === "review" && option.label === "Review plan"),
                true,
            );
        } finally {
            runtime.closeAllSessions();
        }
    });
});

Deno.test("direct review from feedback can send feedback back through Planner", async () => {
    await withRuntimeCommandFixture("runwield-load-plan-command-", async ({ projectRoot, setModelMessages }) => {
        await writePlan(projectRoot, "direct-feedback", { status: "feedback" });
        setModelMessages([
            fauxAssistantMessage(fauxToolCall("plan_written", {
                planName: "direct-feedback",
                objectiveChecks: [{ id: "OC1", command: "true" }],
            })),
        ]);
        const { runtime, sessionId } = await createRuntime(projectRoot);
        let reviewCount = 0;
        runtime.setInteractionAdapter(sessionId, {
            requestInteraction: async () => {
                reviewCount += 1;
                const plan = await loadPlan(projectRoot, "direct-feedback");
                if (!plan) throw new Error("Fixture Plan disappeared before review");
                if (reviewCount === 1) {
                    await recordPlanEvent({
                        cwd: projectRoot,
                        planName: "direct-feedback",
                        event: "review_feedback",
                        currentStatus: plan.attrs.status,
                        expectedRevision: plan.revision,
                        details: { triageMeta: plan.attrs },
                    });
                    return {
                        outcome: "accepted",
                        _meta: {
                            approved: false,
                            feedback: "Revise the Plan directly.",
                            images: [{ base64: "aW1hZ2U=", mimeType: "image/png" }],
                        },
                    };
                }
                await recordPlanEvent({
                    cwd: projectRoot,
                    planName: "direct-feedback",
                    event: "review_approved",
                    currentStatus: plan.attrs.status,
                    expectedRevision: plan.revision,
                    details: { triageMeta: plan.attrs },
                });
                const approved = await loadPlan(projectRoot, "direct-feedback");
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
        const ui = makeUi(["review"]);
        try {
            await runLoadPlanCommand(["direct-feedback"], {
                sessionRuntime: runtime,
                sessionId,
                uiAPI: ui.uiAPI,
                editor: ui.editor,
            });

            assertEquals(reviewCount, 2);
            assertEquals((await loadPlan(projectRoot, "direct-feedback"))?.attrs.status, "ready_for_work");
            assertEquals(runtime.getSessionSnapshot(sessionId)?.workflowContext?.planName, "direct-feedback");
        } finally {
            runtime.closeAllSessions();
        }
    });
});

Deno.test("direct review from ready_for_work reopens review and approves for later", async () => {
    await withRuntimeCommandFixture("runwield-load-plan-command-", async ({ projectRoot }) => {
        await writePlan(projectRoot, "direct-ready", { status: "ready_for_work" });
        const { runtime, sessionId } = await createRuntime(projectRoot);
        runtime.setInteractionAdapter(sessionId, {
            requestInteraction: async () => {
                const readyPlan = await loadPlan(projectRoot, "direct-ready");
                if (!readyPlan) throw new Error("Fixture Plan disappeared before review");
                await recordPlanEvent({
                    cwd: projectRoot,
                    planName: "direct-ready",
                    event: "review_reopened",
                    currentStatus: readyPlan.attrs.status,
                    expectedRevision: readyPlan.revision,
                    details: { triageMeta: readyPlan.attrs },
                });
                const reopenedPlan = await loadPlan(projectRoot, "direct-ready");
                if (!reopenedPlan) throw new Error("Fixture Plan disappeared after reopen");
                await recordPlanEvent({
                    cwd: projectRoot,
                    planName: "direct-ready",
                    event: "review_approved",
                    currentStatus: reopenedPlan.attrs.status,
                    expectedRevision: reopenedPlan.revision,
                    details: { triageMeta: reopenedPlan.attrs },
                });
                const approved = await loadPlan(projectRoot, "direct-ready");
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
        const ui = makeUi(["review"]);
        try {
            await runLoadPlanCommand(["direct-ready"], {
                sessionRuntime: runtime,
                sessionId,
                uiAPI: ui.uiAPI,
                editor: ui.editor,
            });

            assertEquals((await loadPlan(projectRoot, "direct-ready"))?.attrs.status, "ready_for_work");
            assertEquals(
                ui.promptOptions[0].some((option) => option.value === "review" && option.label === "Review plan"),
                true,
            );
        } finally {
            runtime.closeAllSessions();
        }
    });
});

Deno.test("direct review menu is omitted when a draft lacks Objective-Failing Checks", async () => {
    await withRuntimeCommandFixture("runwield-load-plan-command-", async ({ projectRoot }) => {
        await writePlan(projectRoot, "incomplete-draft", { status: "draft", objectiveChecks: [] });
        const { runtime, sessionId } = await createRuntime(projectRoot);
        const ui = makeUi(["cancel"]);
        try {
            await runLoadPlanCommand(["incomplete-draft"], {
                sessionRuntime: runtime,
                sessionId,
                uiAPI: ui.uiAPI,
                editor: ui.editor,
            });

            assertEquals(ui.promptOptions[0].some((option) => option.value === "review"), false);
            assertEquals(ui.promptOptions[0].some((option) => option.value === "resume"), true);
        } finally {
            runtime.closeAllSessions();
        }
    });
});

Deno.test("direct review menu is omitted when a draft has an invalid execution policy", async () => {
    await withRuntimeCommandFixture("runwield-load-plan-command-", async ({ projectRoot }) => {
        await Deno.mkdir(`${projectRoot}/docs/plans`, { recursive: true });
        await Deno.writeTextFile(
            `${projectRoot}/docs/plans/invalid-policy-draft.md`,
            [
                "---",
                "classification: PLANNED_CHANGE",
                "complexity: LOW",
                "summary: Invalid policy draft",
                "affectedPaths: []",
                "objectiveChecks:",
                "  - id: OC1",
                '    command: "true"',
                "status: draft",
                "executionAgent: architect",
                "collaborationRecommendation: autonomous",
                "---",
                "# Invalid policy draft",
                "",
            ].join("\n"),
        );
        const { runtime, sessionId } = await createRuntime(projectRoot);
        const ui = makeUi(["cancel"]);
        try {
            await runLoadPlanCommand(["invalid-policy-draft"], {
                sessionRuntime: runtime,
                sessionId,
                uiAPI: ui.uiAPI,
                editor: ui.editor,
            });

            assertEquals(ui.promptOptions[0].some((option) => option.value === "review"), false);
            assertEquals(ui.promptOptions[0].some((option) => option.value === "resume"), true);
        } finally {
            runtime.closeAllSessions();
        }
    });
});

Deno.test("direct review on a PROJECT Epic approves and slices", async () => {
    await withRuntimeCommandFixture("runwield-load-plan-command-", async ({ projectRoot, setModelMessages }) => {
        await writePlan(projectRoot, "direct-epic", { classification: "PROJECT", status: "draft" });
        setModelMessages([fauxAssistantMessage(fauxToolCall("task_completed", { message: "- sliced" }))]);
        const { runtime, sessionId } = await createRuntime(projectRoot);
        runtime.setInteractionAdapter(sessionId, {
            requestInteraction: async () => {
                const beforeReview = await loadPlan(projectRoot, "direct-epic");
                if (!beforeReview) throw new Error("Fixture Epic disappeared before direct review");
                await recordPlanEvent({
                    cwd: projectRoot,
                    planName: "direct-epic",
                    event: "review_approved",
                    currentStatus: beforeReview.attrs.status,
                    expectedRevision: beforeReview.revision,
                    details: { triageMeta: beforeReview.attrs },
                });
                const approved = await loadPlan(projectRoot, "direct-epic");
                return {
                    outcome: "accepted",
                    _meta: {
                        approved: true,
                        approvalAction: "decompose",
                        revision: approved?.revision,
                        planAttrs: approved?.attrs,
                    },
                };
            },
        });
        const ui = makeUi(["direct_review"]);
        try {
            await runLoadPlanCommand(["direct-epic"], {
                sessionRuntime: runtime,
                sessionId,
                uiAPI: ui.uiAPI,
                editor: ui.editor,
            });

            assertEquals((await loadPlan(projectRoot, "direct-epic"))?.attrs.status, "ready_for_decomposition");
            assertEquals(
                ui.promptOptions[0].some((option) =>
                    option.value === "direct_review" && option.label === "Review plan"
                ),
                true,
            );
            assertEquals(
                ui.promptOptions[0].some((option) =>
                    option.value === "review" && option.label === "Review with Architect"
                ),
                true,
            );
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
                    objectiveChecks: [{ id: "OC1", command: "true" }],
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
