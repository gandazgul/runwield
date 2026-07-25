// deno-lint-ignore-file no-unused-vars
import { assertEquals, assertStringIncludes } from "@std/assert";
import { loadPlan, savePlan } from "../../plan-store.js";
import { createExecutionWorktree } from "../worktree.js";
import {
    loadManualQaPrompt,
    loadReviewerPrompt,
    runLocalCI,
    runManualQaChecklistPrompt,
    runMechanicalValidation,
    runValidationLoop,
} from "./validation.js";
import { HostedSession } from "../session/hosted-session.js";
import { createSessionRuntimeEvent } from "../session/session-runtime-events.js";
import { __resetSettingsForTests } from "../settings.js";

const hostedSession = new HostedSession({ id: "validation-test", cwd: Deno.cwd() });

/**
 * @param {string} cwd
 * @param {string[]} args
 * @returns {Promise<string>}
 */
async function git(cwd, args) {
    const output = await new Deno.Command("git", { cwd, args, stdout: "piped", stderr: "piped" }).output();
    const text = new TextDecoder().decode(output.stdout);
    if (!output.success) throw new Error(new TextDecoder().decode(output.stderr));
    return text.trim();
}

/**
 * @returns {any & { messages: string[], systemCalls: Array<{ message: string, isError: boolean, header: string, level: string, validationProgress?: import('../session/session-runtime-events.js').RuntimeValidationProgress }>, promptSelections: string[], busyStates: boolean[], toolCalls: Array<{ id: string, name: string, args: string }>, toolOutputs: string[], toolResults: Array<{ id: string, name: string, result: string, isError: boolean, durationMs: number }> }}
 */
function makeUi() {
    /** @type {string[]} */
    const messages = [];
    /** @type {Array<{ message: string, isError: boolean, header: string, level: string, validationProgress?: import('../session/session-runtime-events.js').RuntimeValidationProgress }>} */
    const systemCalls = [];
    /** @type {string[]} */
    const promptSelections = [];
    /** @type {boolean[]} */
    const busyStates = [];
    /** @type {Array<{ id: string, name: string, args: string }>} */
    const toolCalls = [];
    /** @type {string[]} */
    const toolOutputs = [];
    /** @type {Array<{ id: string, name: string, result: string, isError: boolean, durationMs: number }>} */
    const toolResults = [];
    const recorder = /** @type {any} */ ({
        messages,
        systemCalls,
        promptSelections,
        busyStates,
        toolCalls,
        toolOutputs,
        toolResults,
        appendSystemMessage: (
            /** @type {string} */ msg,
            /** @type {boolean} */ isError = false,
            /** @type {string} */ header = "",
        ) => {
            messages.push(String(msg));
            systemCalls.push({ message: String(msg), isError, header, level: isError ? "error" : "info" });
        },
        promptSelect: () => {
            promptSelections.push("prompted");
            return Promise.resolve("stop");
        },
        promptText: () => Promise.resolve("deno task test"),
        setBusy: (/** @type {boolean} */ busy) => busyStates.push(busy),
        startToolExecution: (/** @type {string} */ id, /** @type {string} */ name, /** @type {string} */ args) => {
            toolCalls.push({ id, name, args });
            return {
                setOutput: (/** @type {string} */ text) => toolOutputs.push(text),
                endExecution: (/** @type {boolean} */ isError, /** @type {number} */ durationMs) => {
                    toolResults.push({ id, name, result: "", isError, durationMs });
                },
                bodyText: "",
                startTime: Date.now(),
            };
        },
        addToolInvoked: (/** @type {{ id: string, name: string, input: { command?: string } }} */ event) => {
            toolCalls.push({ id: event.id, name: event.name, args: event.input.command || "" });
        },
        addToolResult: (
            /** @type {{ id: string, name: string, result: string, isError: boolean, durationMs: number }} */ event,
        ) => {
            toolResults.push(event);
        },
    });
    attachRecorder(hostedSession, recorder);
    return recorder;
}

/**
 * @param {HostedSession} session
 * @param {ReturnType<typeof makeUi>} recorder
 * @returns {HostedSession}
 */
function attachRecorder(session, recorder) {
    session.setEventSink((/** @type {any} */ partialEvent) => {
        const event = /** @type {any} */ (createSessionRuntimeEvent(session.id, partialEvent));
        if (event.type === "system_status" || event.type === "terminal_error") {
            const message = String(event.message || "");
            recorder.messages.push(message);
            recorder.systemCalls.push({
                message,
                isError: event.level === "error" || event.type === "terminal_error",
                header: event.header || "",
                level: event.level || (event.type === "terminal_error" ? "error" : "info"),
                ...(event.validationProgress ? { validationProgress: event.validationProgress } : {}),
            });
        } else if (event.type === "busy_changed") {
            recorder.busyStates.push(Boolean(event.busy));
        } else if (event.type === "tool_start") {
            recorder.toolCalls.push({ id: event.toolCallId, name: event.toolName, args: event.args?.command || "" });
        } else if (event.type === "tool_update") {
            recorder.toolOutputs.push(event.output);
        } else if (event.type === "tool_end") {
            recorder.toolOutputs.push(event.output);
            recorder.toolResults.push({
                id: event.toolCallId,
                name: event.toolName,
                result: event.output,
                isError: Boolean(event.isError),
                durationMs: Number(event.durationMs || 0),
            });
        }
    });
    session.setInteractionAdapter({
        requestInteraction: async (request) => {
            if (request.type === "text") {
                const value = await recorder.promptText(request.prompt, request);
                return value === null ? { outcome: "canceled" } : { outcome: "text", value };
            }
            const value = await recorder.promptSelect(request.prompt, request.options || []);
            return value === null ? { outcome: "canceled" } : { outcome: "selected", value };
        },
    });
    return session;
}

/**
 * @param {string} id
 * @param {ReturnType<typeof makeUi>} recorder
 * @returns {HostedSession}
 */
function makeRecordedSession(id, recorder) {
    return attachRecorder(new HostedSession({ id, cwd: Deno.cwd() }), recorder);
}

function noOpRecordPlanEvent() {
    return Promise.resolve({});
}

function noOpWorktreePlanHandoffDeps() {
    return {
        switchActiveAgent: (
            /** @type {unknown} */ _hostedSession,
            /** @type {{ agentName: string }} */ options,
        ) => Promise.resolve({ ok: true, agentName: options.agentName, changed: true }),
        stageValidationPassedInExecutionWorktree: () =>
            Promise.resolve({ attrs: /** @type {any} */ ({ status: "verified" }), planPaths: ["plans/p.md"] }),
        preparePrimaryPlanPathForMerge: () =>
            Promise.resolve({
                projectRoot: "/primary",
                relativePath: "plans/p.md",
                absolutePath: "/primary/plans/p.md",
                existed: true,
                tracked: true,
                headTracked: true,
                indexMode: "100644",
                indexObjectId: "abc123",
                content: "implemented",
            }),
        restorePrimaryPlanPathAfterMergeFailure: () => Promise.resolve(),
        runManualQaChecklistPrompt: () => Promise.resolve([]),
        resolveValidationExecutionContext: (/** @type {any} */ opts) => {
            const context = opts.explicitContext || opts.activeWorkflow || {};
            const executionMode = context.nonGitInPlace || context.executionMode === "non_git_in_place"
                ? "non_git_in_place"
                : "worktree";
            if (
                executionMode === "worktree" && !context.worktreeBaseBranch &&
                Boolean(context.worktreeId || context.worktreeBranch)
            ) {
                return Promise.resolve({
                    kind: "blocked",
                    reason: "missing_worktree_identity",
                    message: "Workflow Validation requires explicit missing worktree delivery identity before merge.",
                });
            }
            return Promise.resolve({
                kind: "ok",
                context: {
                    executionMode,
                    planName: opts.planName,
                    projectRoot: context.projectRoot || opts.projectRoot || Deno.cwd(),
                    executionCwd: context.executionCwd || opts.projectRoot || Deno.cwd(),
                    baselineTree: context.baselineTree,
                    worktreeId: context.worktreeId,
                    worktreeBranch: context.worktreeBranch,
                    worktreeBaseBranch: context.worktreeBaseBranch,
                    source: context.planName ? "active_session" : "explicit",
                },
            });
        },
    };
}

Deno.test("runValidationLoop stages validation_passed before worktree merge succeeds", async () => {
    /** @type {string[]} */
    const actions = [];
    /** @type {any[]} */
    const metrics = [];

    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE", summary: "Preserve metadata in merge commits." },
        executionAgent: "engineer",
        executionMode: "worktree",
        baselineTree: "baseline-tree",
        projectRoot: "/primary",
        executionCwd: "/worktree",
        worktreeId: "wt1",
        worktreeBranch: "runwield/worktree/p-wt1",
        worktreeBaseBranch: "feature-base",
    });

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE", summary: "Preserve metadata in merge commits." },
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            ...noOpWorktreePlanHandoffDeps(),
            stageValidationPassedInExecutionWorktree: (/** @type {any} */ args) => {
                actions.push(`stage:${args.projectRoot}:${args.executionCwd}:${args.planName}`);
                return Promise.resolve({
                    attrs: /** @type {any} */ ({ status: "verified" }),
                    planPaths: ["plans/p.md"],
                });
            },
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve("diff --git a/file.js b/file.js\n+change\n"),
            runIsolatedAgentSession: () =>
                Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "The implementation matches the plan." }],
                    }, {
                        role: "toolResult",
                        toolName: "review_complete",
                        details: { outcome: "approved", approved: true, feedback: "" },
                    }]),
                ),
            mergeExecutionWorktree: (
                /** @type {{ projectRoot: string, branch: string, targetBranch?: string, planName?: string, planDescription?: string }} */ args,
            ) => {
                actions.push(
                    `merge:${args.projectRoot}:${args.branch}:${args.targetBranch || ""}:${args.planName || ""}:${
                        args.planDescription || ""
                    }`,
                );
                return Promise.resolve({ updatedPrimaryCheckout: false });
            },
            restorePrimaryPlanPathAfterMergeFailure: () => {
                actions.push("restore-primary");
                return Promise.resolve();
            },
            removeExecutionWorktree: (
                /** @type {{ projectRoot: string, path: string, branch?: string, force?: boolean }} */ args,
            ) => {
                actions.push(`remove:${args.projectRoot}:${args.path}:${args.branch || ""}:${args.force}`);
                return Promise.resolve();
            },
            removeWorktreeRegistryEntry: (/** @type {string} */ projectRoot, /** @type {string} */ id) => {
                actions.push(`registry-remove:${projectRoot}:${id}`);
                return Promise.resolve();
            },
            verifyExecutionWorktreeMerged: () => Promise.resolve({ merged: true, message: "merged" }),

            updateWorktreeRegistryEntry: (
                /** @type {string} */ _projectRoot,
                /** @type {string} */ _id,
                /** @type {{ status: string }} */ updates,
            ) => {
                actions.push(`registry:${updates.status}`);
                return Promise.resolve({});
            },
            recordPlanEvent: (/** @type {any} */ event) => {
                actions.push(`event:${event.event}:${event.details.worktreeStatus || ""}`);
                return Promise.resolve({});
            },
            getCodeReviewMode: () => "none",
            recordWorkflowMetric: (/** @type {any} */ metric) => {
                metrics.push(metric);
                return Promise.resolve(null);
            },
        }),
    });

    assertEquals(actions, [
        "stage:/primary:/worktree:p",
        "merge:/primary:runwield/worktree/p-wt1:feature-base:p:Preserve metadata in merge commits.",
        "restore-primary",
        "registry:merged",
        "remove:/primary:/worktree:runwield/worktree/p-wt1:false",
        "registry-remove:/primary:wt1",
    ]);
    assertEquals(
        metrics.some((metric) =>
            metric.category === "validation" && metric.event === "human_review_result" &&
            metric.details.mode === "none" && metric.details.decision === "not_required"
        ),
        true,
    );
});

Deno.test("runValidationLoop merges verified Plan metadata in Git and leaves the primary checkout clean", async () => {
    const projectRoot = await Deno.makeTempDir();
    const worktreeRoot = await Deno.makeTempDir();
    const session = new HostedSession({ id: "validation-git-integration", cwd: Deno.cwd() });
    try {
        await git(projectRoot, ["init", "-b", "main"]);
        await git(projectRoot, ["config", "user.email", "tests@example.com"]);
        await git(projectRoot, ["config", "user.name", "RunWield Tests"]);
        await Deno.writeTextFile(`${projectRoot}/.gitignore`, ".wld/\n");
        await savePlan(projectRoot, "git-plan", "# Git Plan", {
            status: "ready_for_work",
            classification: "FEATURE",
            summary: "Verify metadata in history.",
        });
        await git(projectRoot, ["add", ".gitignore", "plans/git-plan.md"]);
        await git(projectRoot, ["commit", "-m", "add plan"]);
        const baselineTree = await git(projectRoot, ["rev-parse", "HEAD^{tree}"]);
        const worktree = await createExecutionWorktree({
            projectRoot,
            planName: "Git Plan",
            worktreeRoot,
        });
        await savePlan(projectRoot, "git-plan", "# Git Plan", {
            status: "implemented",
            classification: "FEATURE",
            summary: "Verify metadata in history.",
            worktreeId: worktree.id,
            worktreePath: worktree.path,
            worktreeBranch: worktree.branch,
            worktreeBaseBranch: "main",
            worktreeStatus: "completed",
        });
        await Deno.writeTextFile(`${worktree.path}/implemented.js`, "export const implemented = true;\n");
        session.setActiveExecutionWorkflow({
            planName: "git-plan",
            triageMeta: { classification: "FEATURE", summary: "Verify metadata in history." },
            executionAgent: "engineer",
            executionMode: "worktree",
            baselineTree,
            projectRoot,
            executionCwd: worktree.path,
            worktreeId: worktree.id,
            worktreeBranch: worktree.branch,
            worktreeBaseBranch: "main",
        });

        await runValidationLoop({
            hostedSession: session,
            planName: "git-plan",
            planContent: "plan",
            triageMeta: { classification: "FEATURE", summary: "Verify metadata in history." },
            sessionManager: undefined,
            __deps: /** @type {any} */ ({
                runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
                getDiffText: () => Promise.resolve("diff --git a/implemented.js b/implemented.js\n+change\n"),
                runIsolatedAgentSession: () =>
                    Promise.resolve(
                        /** @type {any} */ ([{
                            role: "assistant",
                            content: [{ type: "text", text: "The implementation matches the plan." }],
                        }, {
                            role: "toolResult",
                            toolName: "review_complete",
                            details: { outcome: "approved", approved: true, feedback: "" },
                        }]),
                    ),
                getCodeReviewMode: () => "none",
                autoGenerateWorkRecordForCompletedPlan: () =>
                    Promise.resolve({ status: "disabled", planName: "git-plan", message: "disabled" }),
                recordWorkflowMetric: () => Promise.resolve(null),
            }),
        });

        assertEquals((await loadPlan(projectRoot, "git-plan"))?.attrs.status, "verified");
        assertStringIncludes(await git(projectRoot, ["log", "-p", "--", "plans/git-plan.md"]), 'status: "verified"');
        assertEquals(await git(projectRoot, ["status", "--porcelain"]), "");
    } finally {
        await Deno.remove(projectRoot, { recursive: true }).catch(() => {});
        await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
    }
});

Deno.test("runValidationLoop reapplies verified Plan metadata after real merge-conflict rollback", async () => {
    const projectRoot = await Deno.makeTempDir();
    const worktreeRoot = await Deno.makeTempDir();
    const session = new HostedSession({ id: "validation-git-conflict-retry", cwd: Deno.cwd() });
    try {
        await git(projectRoot, ["init", "-b", "main"]);
        await git(projectRoot, ["config", "user.email", "tests@example.com"]);
        await git(projectRoot, ["config", "user.name", "RunWield Tests"]);
        await Deno.writeTextFile(`${projectRoot}/.gitignore`, ".wld/\n");
        await Deno.writeTextFile(`${projectRoot}/conflict.txt`, "base\n");
        await savePlan(projectRoot, "conflict-plan", "# Conflict Plan", {
            status: "ready_for_work",
            classification: "FEATURE",
        });
        await git(projectRoot, ["add", ".gitignore", "conflict.txt", "plans/conflict-plan.md"]);
        await git(projectRoot, ["commit", "-m", "add conflict plan"]);
        const baselineTree = await git(projectRoot, ["rev-parse", "HEAD^{tree}"]);
        const worktree = await createExecutionWorktree({ projectRoot, planName: "Conflict Plan", worktreeRoot });
        await Deno.writeTextFile(`${projectRoot}/conflict.txt`, "target\n");
        await git(projectRoot, ["add", "conflict.txt"]);
        await git(projectRoot, ["commit", "-m", "target conflict"]);
        await savePlan(projectRoot, "conflict-plan", "# Conflict Plan", {
            status: "implemented",
            classification: "FEATURE",
            worktreeId: worktree.id,
            worktreePath: worktree.path,
            worktreeBranch: worktree.branch,
            worktreeBaseBranch: "main",
            worktreeStatus: "completed",
        });
        await Deno.writeTextFile(`${worktree.path}/conflict.txt`, "execution\n");
        session.setActiveExecutionWorkflow({
            planName: "conflict-plan",
            triageMeta: { classification: "FEATURE" },
            executionAgent: "engineer",
            executionMode: "worktree",
            baselineTree,
            projectRoot,
            executionCwd: worktree.path,
            worktreeId: worktree.id,
            worktreeBranch: worktree.branch,
            worktreeBaseBranch: "main",
        });

        await runValidationLoop({
            hostedSession: session,
            planName: "conflict-plan",
            planContent: "plan",
            triageMeta: { classification: "FEATURE" },
            sessionManager: undefined,
            __deps: /** @type {any} */ ({
                runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
                getDiffText: () => Promise.resolve("diff --git a/conflict.txt b/conflict.txt\n+execution\n"),
                runIsolatedAgentSession: () =>
                    Promise.resolve(
                        /** @type {any} */ ([{
                            role: "assistant",
                            content: [{ type: "text", text: "The implementation matches the plan." }],
                        }, {
                            role: "toolResult",
                            toolName: "review_complete",
                            details: { outcome: "approved", approved: true, feedback: "" },
                        }]),
                    ),
                runCompletionGatedRepair: async () => {
                    await Deno.writeTextFile(`${projectRoot}/conflict.txt`, "resolved\n");
                    await git(projectRoot, ["add", "conflict.txt"]);
                    return true;
                },
                updateWorktreeRegistryEntry: () => Promise.resolve({}),
                shouldCleanupMergedWorktrees: () => false,
                getCodeReviewMode: () => "none",
                recordWorkflowMetric: () => Promise.resolve(null),
            }),
        });

        assertEquals((await loadPlan(projectRoot, "conflict-plan"))?.attrs.status, "verified");
        assertStringIncludes(
            await git(projectRoot, ["log", "-1", "-p", "--", "plans/conflict-plan.md"]),
            'status: "verified"',
        );
        assertEquals(await Deno.readTextFile(`${projectRoot}/conflict.txt`), "resolved\n");
    } finally {
        await git(projectRoot, ["merge", "--abort"]).catch(() => {});
        await Deno.remove(projectRoot, { recursive: true }).catch(() => {});
        await Deno.remove(worktreeRoot, { recursive: true }).catch(() => {});
    }
});

Deno.test("runValidationLoop does not preserve a nonexistent Plan path for quick-fix worktrees", async () => {
    /** @type {string[][]} */
    const preservedPaths = [];
    hostedSession.setActiveExecutionWorkflow({
        planName: "quick-fix",
        triageMeta: { classification: "QUICK_FIX" },
        executionAgent: "engineer",
        baselineTree: "baseline-tree",
        projectRoot: "/primary",
        executionCwd: "/worktree",
        worktreeBranch: "runwield/worktree/quick-fix-wt1",
        worktreeBaseBranch: "main",
    });

    await runValidationLoop({
        hostedSession,
        planName: "quick-fix",
        planContent: "fix",
        triageMeta: { classification: "QUICK_FIX" },
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve("diff --git a/file.js b/file.js\n+change\n"),
            runIsolatedAgentSession: () =>
                Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "The quick fix is valid." }],
                    }, {
                        role: "toolResult",
                        toolName: "review_complete",
                        details: { outcome: "approved", approved: true, feedback: "" },
                    }]),
                ),
            mergeExecutionWorktree: (/** @type {{ preservePlanPaths: string[] }} */ args) => {
                preservedPaths.push(args.preservePlanPaths);
                return Promise.resolve();
            },
            verifyExecutionWorktreeMerged: () => Promise.resolve({ merged: true, message: "merged" }),
            removeExecutionWorktree: () => Promise.resolve(),
            getCodeReviewMode: () => "none",
            recordWorkflowMetric: () => Promise.resolve(null),
        }),
    });

    assertEquals(preservedPaths, [[]]);
});

Deno.test("runValidationLoop halts and preserves worktree when post-merge verification fails", async () => {
    const uiAPI = makeUi();
    /** @type {string[]} */
    const actions = [];

    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE", executionAgent: "frontend-engineer" },
        executionAgent: "frontend-engineer",
        baselineTree: "baseline-tree",
        projectRoot: "/primary",
        executionCwd: "/worktree",
        worktreeId: "wt1",
        worktreeBranch: "runwield/worktree/p-wt1",
        worktreeBaseBranch: "feature-base",
    });

    await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE", executionAgent: "frontend-engineer" },
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            ...noOpWorktreePlanHandoffDeps(),
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve("diff --git a/file.js b/file.js\n+change\n"),
            runIsolatedAgentSession: () =>
                Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "The implementation matches the plan." }],
                    }, {
                        role: "toolResult",
                        toolName: "review_complete",
                        details: { outcome: "approved", approved: true, feedback: "" },
                    }]),
                ),
            getCodeReviewMode: () => "none",
            mergeExecutionWorktree: () => {
                actions.push("merge");
                return Promise.resolve();
            },
            verifyExecutionWorktreeMerged: () =>
                Promise.resolve({ merged: false, message: "branch is not contained in target" }),
            runCompletionGatedRepair: (/** @type {any} */ opts) => {
                actions.push(`repair:${opts.agentName}:merge_verification`);
                return Promise.resolve(false);
            },
            updateWorktreeRegistryEntry: (
                /** @type {string} */ _projectRoot,
                /** @type {string} */ _id,
                /** @type {{ status: string }} */ updates,
            ) => {
                actions.push(`registry:${updates.status}`);
                return Promise.reject(new Error("registry unavailable"));
            },
            removeExecutionWorktree: () => {
                actions.push("remove");
                return Promise.resolve();
            },
            recordPlanEvent: (/** @type {any} */ event) => {
                actions.push(
                    `event:${event.event}:${event.details.failureReason || event.details.worktreeStatus || ""}`,
                );
                return Promise.resolve({});
            },
        }),
    });

    assertEquals(actions, [
        "merge",
        "repair:frontend-engineer:merge_verification",
        "registry:merge_conflict",
        "event:worktree_merge_failed:Post-merge verification found remaining merge-back work: branch is not contained in target",
    ]);
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ message) =>
            message.includes("Dispatching Frontend Engineer for automatic merge repair attempt")
        ),
        true,
    );
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ message) => message.includes("preserving worktree for recovery")),
        false,
    );
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ message) =>
            message.includes(
                "Could not update worktree registry after merge verification failure: registry unavailable",
            )
        ),
        true,
    );
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ message) => message.includes("execution and validation complete")),
        false,
    );
});
