import { assertEquals } from "@std/assert";
import { loadReviewerPrompt, runValidationLoop } from "./validation.js";
import { getActiveExecutionWorkflow, setActiveExecutionWorkflow } from "../session/session-state.js";

/**
 * @returns {any & { messages: string[], systemCalls: Array<{ message: string, isError: boolean, header: string, style: any }>, promptSelections: string[], busyStates: boolean[] }}
 */
function makeUi() {
    /** @type {string[]} */
    const messages = [];
    /** @type {Array<{ message: string, isError: boolean, header: string, style: any }>} */
    const systemCalls = [];
    /** @type {string[]} */
    const promptSelections = [];
    /** @type {boolean[]} */
    const busyStates = [];
    return /** @type {any} */ ({
        messages,
        systemCalls,
        promptSelections,
        busyStates,
        appendSystemMessage: (
            /** @type {string} */ msg,
            /** @type {boolean} */ isError = false,
            /** @type {string} */ header = "",
            /** @type {any} */ style = {},
        ) => {
            messages.push(String(msg));
            systemCalls.push({ message: String(msg), isError, header, style });
        },
        promptSelect: () => {
            promptSelections.push("prompted");
            return Promise.resolve("stop");
        },
        promptText: () => Promise.resolve("deno task test"),
        setBusy: (/** @type {boolean} */ busy) => busyStates.push(busy),
    });
}

function noOpRecordPlanEvent() {
    return Promise.resolve({});
}

Deno.test("loadReviewerPrompt returns a bare tool-free prompt", async () => {
    /** @type {string[]} */
    const readPaths = [];
    const reviewerDef = await loadReviewerPrompt(
        (path) => {
            readPaths.push(path);
            return Promise.resolve([
                "---",
                "name: Reviewer",
                'description: "Review prompt"',
                "tools: []",
                "---",
                "",
                "Review only the supplied plan and diff.",
                "",
            ].join("\n"));
        },
        (relativePath) => Promise.resolve(`/tmp/bundled-agent-definitions/${relativePath}`),
    );

    assertEquals(readPaths, ["/tmp/bundled-agent-definitions/workflow-prompts/reviewer-prompt.md"]);
    assertEquals(reviewerDef.name, "reviewer");
    assertEquals(reviewerDef.displayName, "Reviewer");
    assertEquals(reviewerDef.tools, []);
    assertEquals(reviewerDef.systemPrompt, "Review only the supplied plan and diff.");
    assertEquals(reviewerDef.systemPrompt.includes("{{SKILLS}}"), false);
    assertEquals(reviewerDef.systemPrompt.includes("Available tools"), false);
});

Deno.test("runValidationLoop does not switch active agent unless finalAgentName is provided", async () => {
    const uiAPI = makeUi();
    await runValidationLoop({
        planName: "p",
        planContent: "",
        triageMeta: { classification: "QUICK_FIX" },
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve(""),
            recordPlanEvent: noOpRecordPlanEvent,
            setActiveAgent: () => {
                throw new Error("should not switch agent");
            },
        }),
    });

    assertEquals(
        uiAPI.messages.some((/** @type {string} */ m) => m.includes("execution and validation complete")),
        true,
    );
});

Deno.test("runValidationLoop marks validation progress and success messages with status styling", async () => {
    const uiAPI = makeUi();
    await runValidationLoop({
        planName: "p",
        planContent: "",
        triageMeta: { classification: "QUICK_FIX" },
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve(""),
            recordPlanEvent: noOpRecordPlanEvent,
            setActiveAgent: () => {},
        }),
    });

    assertEquals(
        uiAPI.systemCalls.some((/** @type {{ message: string }} */ call) =>
            call.message.includes("Running CI Validation (Attempt 1/3)...")
        ),
        true,
    );
    assertEquals(
        uiAPI.systemCalls
            .filter((/** @type {{ message: string }} */ call) =>
                call.message.includes("Running CI Validation") || call.message === "Build and tests passed."
            )
            .every((/** @type {{ header: string }} */ call) => call.header === "Harns"),
        true,
    );
    assertEquals(
        uiAPI.systemCalls.some((/** @type {{ message: string }} */ call) =>
            call.message.includes("Running Semantic Code Review...")
        ),
        true,
    );
    assertEquals(
        uiAPI.systemCalls.some((/** @type {{ message: string }} */ call) => call.message.includes("[spinner]")),
        false,
    );
    assertEquals(uiAPI.busyStates, [true, false, true, false]);
    assertEquals(
        uiAPI.systemCalls.some((/** @type {{ message: string, style: any }} */ call) =>
            call.message === "Build and tests passed." && call.style.bodyColor === "success"
        ),
        true,
    );
});

Deno.test("runValidationLoop restores requested final agent after validation", async () => {
    const uiAPI = makeUi();
    /** @type {string[]} */
    const switched = [];
    await runValidationLoop({
        planName: "p",
        planContent: "",
        triageMeta: { classification: "QUICK_FIX" },
        uiAPI,
        sessionManager: undefined,
        finalAgentName: "planner",
        __deps: /** @type {any} */ ({
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve(""),
            recordPlanEvent: noOpRecordPlanEvent,
            createAgentHandler: (/** @type {string} */ name) => () => Promise.resolve(name),
            setActiveAgent: (/** @type {string} */ name) => switched.push(name),
        }),
    });

    assertEquals(switched, ["planner"]);
});

Deno.test("runValidationLoop fails FEATURE validation when workflow diff is empty", async () => {
    const uiAPI = makeUi();
    /** @type {Array<{ event: string, details: { failureReason?: string } }>} */
    const events = [];

    await runValidationLoop({
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve(""),
            runAgentSession: () => {
                throw new Error("semantic review should not run");
            },
            recordPlanEvent: (/** @type {any} */ event) => {
                events.push(event);
                return Promise.resolve({});
            },
            setActiveAgent: () => {},
        }),
    });

    assertEquals(events.map((event) => event.event), ["validation_failed"]);
    assertEquals(events[0].details.failureReason, "No implementation changes detected in workflow diff.");
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ m) =>
            m.includes("Workflow halted: No implementation changes detected in workflow diff.")
        ),
        true,
    );
});

Deno.test("runValidationLoop fails PROJECT validation when workflow diff only changes a plan document", async () => {
    const uiAPI = makeUi();
    /** @type {Array<{ event: string, details: { failureReason?: string } }>} */
    const events = [];

    await runValidationLoop({
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "PROJECT" },
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () =>
                Promise.resolve([
                    "diff --git a/plans/p.md b/plans/p.md",
                    "--- a/plans/p.md",
                    "+++ b/plans/p.md",
                    "@@ -1,3 +1,3 @@",
                    "-status: implemented",
                    "+status: verified",
                ].join("\n")),
            runAgentSession: () => {
                throw new Error("semantic review should not run");
            },
            recordPlanEvent: (/** @type {any} */ event) => {
                events.push(event);
                return Promise.resolve({});
            },
            setActiveAgent: () => {},
        }),
    });

    assertEquals(events.map((event) => event.event), ["validation_failed"]);
    assertEquals(
        events[0].details.failureReason,
        "No implementation changes detected in workflow diff; only plan document changes were found.",
    );
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ m) =>
            m.includes(
                "Workflow halted: No implementation changes detected in workflow diff; only plan document changes",
            )
        ),
        true,
    );
});

Deno.test("runValidationLoop halts when CI repair does not call task_completed", async () => {
    const uiAPI = makeUi();
    let repairCalls = 0;
    await runValidationLoop({
        planName: "p",
        planContent: "",
        triageMeta: { classification: "FEATURE" },
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            runLocalCI: () => Promise.resolve({ exitCode: 1, output: "boom" }),
            runAgentSession: () => {
                repairCalls++;
                return Promise.resolve([]);
            },
            readLatestTaskCompletedOutcome: () => false,
            recordPlanEvent: noOpRecordPlanEvent,
            setActiveAgent: () => {},
        }),
    });

    assertEquals(repairCalls, 1);
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ m) =>
            m.includes("Workflow halted: Operator stopped without task_completed during CI repair.")
        ),
        true,
    );
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ m) => m.includes("Mechanical validation failed 3 times")),
        false,
    );
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ m) => m.includes("during validation repair")),
        false,
    );
});

Deno.test("runValidationLoop reports exact semantic repair halt reason", async () => {
    const uiAPI = makeUi();
    await runValidationLoop({
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve("diff"),
            runAgentSession: () =>
                Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "missing requirement" }],
                    }]),
                ),
            runCompletionGatedRepair: () => Promise.resolve(false),
            recordPlanEvent: noOpRecordPlanEvent,
            setActiveAgent: () => {},
        }),
    });

    assertEquals(
        uiAPI.messages.some((/** @type {string} */ m) =>
            m.includes("Workflow halted: Engineer stopped without task_completed during semantic repair.")
        ),
        true,
    );
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ m) =>
            m.includes("Review failed. Sending feedback back to Engineer") &&
            m.includes("Reviewer Feedback:\nmissing requirement")
        ),
        true,
    );
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ m) => m.includes("Maximum validation cycles")),
        false,
    );
});

Deno.test("runValidationLoop reviews the diff scoped to the active workflow baseline", async () => {
    const uiAPI = makeUi();
    /** @type {string[]} */
    const reviewPrompts = [];
    /** @type {Array<string | undefined>} */
    const baselineArgs = [];

    setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        baselineTree: "baseline-tree",
    });

    await runValidationLoop({
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: (/** @type {string | undefined} */ baselineTree) => {
                baselineArgs.push(baselineTree);
                return Promise.resolve("diff --git a/workflow.js b/workflow.js\n+scoped workflow change\n");
            },
            runAgentSession: (/** @type {any} */ opts) => {
                reviewPrompts.push(opts.userRequest);
                return Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "APPROVED" }],
                    }]),
                );
            },
            recordPlanEvent: noOpRecordPlanEvent,
            setActiveAgent: () => {},
        }),
    });

    assertEquals(baselineArgs, ["baseline-tree"]);
    assertEquals(reviewPrompts.length, 1);
    assertEquals(reviewPrompts[0].includes("scoped workflow change"), true);
    assertEquals(reviewPrompts[0].includes("pre-existing dirty change"), false);
    assertEquals(getActiveExecutionWorkflow(), null);
});

Deno.test("runValidationLoop runs validation and reviewer in active execution cwd", async () => {
    const uiAPI = makeUi();
    /** @type {Array<string | undefined>} */
    const ciCwds = [];
    /** @type {Array<string | undefined>} */
    const diffCwds = [];
    /** @type {Array<string | undefined>} */
    const sessionCwds = [];
    /** @type {Array<any>} */
    const sessionOpts = [];

    setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        baselineTree: "baseline-tree",
        projectRoot: "/primary",
        executionCwd: "/worktree",
        worktreeId: "wt1",
        worktreeBranch: "harns/worktree/p-wt1",
    });

    await runValidationLoop({
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            runLocalCI: (/** @type {any} */ _uiAPI, /** @type {string | undefined} */ cwd) => {
                ciCwds.push(cwd);
                return Promise.resolve({ exitCode: 0, output: "" });
            },
            getDiffText: (/** @type {string | undefined} */ _baselineTree, /** @type {string | undefined} */ cwd) => {
                diffCwds.push(cwd);
                return Promise.resolve("diff --git a/file.js b/file.js\n+change\n");
            },
            runAgentSession: (/** @type {any} */ opts) => {
                sessionCwds.push(opts.cwd);
                sessionOpts.push(opts);
                return Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "APPROVED" }],
                    }]),
                );
            },
            mergeExecutionWorktree: () => Promise.resolve(),
            updateWorktreeRegistryEntry: () => Promise.resolve({}),
            recordPlanEvent: noOpRecordPlanEvent,
            setActiveAgent: () => {},
        }),
    });

    assertEquals(ciCwds, ["/worktree"]);
    assertEquals(diffCwds, ["/worktree"]);
    assertEquals(sessionCwds, ["/worktree"]);
    assertEquals(sessionOpts[0].uiAPI, uiAPI);
    assertEquals(sessionOpts[0]._agentDefOverride.tools, []);
    assertEquals(sessionOpts[0]._agentDefOverride.systemPrompt.includes("{{SKILLS}}"), false);
    assertEquals(sessionOpts[0].includeEditFallback, false);
    assertEquals(sessionOpts[0].useRootSession, true);
});

Deno.test("runValidationLoop records validation_passed only after worktree merge succeeds", async () => {
    const uiAPI = makeUi();
    /** @type {string[]} */
    const actions = [];

    setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        baselineTree: "baseline-tree",
        projectRoot: "/primary",
        executionCwd: "/worktree",
        worktreeId: "wt1",
        worktreeBranch: "harns/worktree/p-wt1",
    });

    await runValidationLoop({
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve("diff --git a/file.js b/file.js\n+change\n"),
            runAgentSession: () =>
                Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "APPROVED" }],
                    }]),
                ),
            mergeExecutionWorktree: (/** @type {{ projectRoot: string, branch: string }} */ args) => {
                actions.push(`merge:${args.projectRoot}:${args.branch}`);
                return Promise.resolve();
            },
            removeExecutionWorktree: (/** @type {{ projectRoot: string, path: string, branch?: string }} */ args) => {
                actions.push(`remove:${args.projectRoot}:${args.path}:${args.branch || ""}`);
                return Promise.resolve();
            },
            removeWorktreeRegistryEntry: (/** @type {string} */ projectRoot, /** @type {string} */ id) => {
                actions.push(`registry-remove:${projectRoot}:${id}`);
                return Promise.resolve();
            },

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
            setActiveAgent: () => {},
        }),
    });

    assertEquals(actions, [
        "merge:/primary:harns/worktree/p-wt1",
        "registry:merged",
        "remove:/primary:/worktree:harns/worktree/p-wt1",
        "registry-remove:/primary:wt1",
        "event:validation_passed:merged",
    ]);
});

Deno.test("runValidationLoop keeps merged worktree when cleanup setting is disabled", async () => {
    const uiAPI = makeUi();
    /** @type {string[]} */
    const actions = [];

    setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        baselineTree: "baseline-tree",
        projectRoot: "/primary",
        executionCwd: "/worktree",
        worktreeId: "wt1",
        worktreeBranch: "harns/worktree/p-wt1",
    });

    await runValidationLoop({
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve("diff --git a/file.js b/file.js\n+change\n"),
            runAgentSession: () =>
                Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "APPROVED" }],
                    }]),
                ),
            mergeExecutionWorktree: () => {
                actions.push("merge");
                return Promise.resolve();
            },
            removeExecutionWorktree: () => {
                actions.push("remove");
                return Promise.resolve();
            },
            removeWorktreeRegistryEntry: () => {
                actions.push("registry-remove");
                return Promise.resolve();
            },
            updateWorktreeRegistryEntry: () => {
                actions.push("registry");
                return Promise.resolve({});
            },
            recordPlanEvent: (/** @type {any} */ event) => {
                actions.push(`event:${event.event}:${event.details.cleanupMergedWorktrees}`);
                return Promise.resolve({});
            },
            shouldCleanupMergedWorktrees: () => false,
            setActiveAgent: () => {},
        }),
    });

    assertEquals(actions, ["merge", "registry", "event:validation_passed:false"]);
});

Deno.test("runValidationLoop records worktree_merge_failed when merge-back fails", async () => {
    const uiAPI = makeUi();
    /** @type {string[]} */
    const actions = [];

    setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        baselineTree: "baseline-tree",
        projectRoot: "/primary",
        executionCwd: "/worktree",
        worktreeId: "wt1",
        worktreeBranch: "harns/worktree/p-wt1",
    });

    await runValidationLoop({
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve("diff --git a/file.js b/file.js\n+change\n"),
            runAgentSession: () =>
                Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "APPROVED" }],
                    }]),
                ),
            mergeExecutionWorktree: () => Promise.reject(new Error("conflict")),
            updateWorktreeRegistryEntry: (
                /** @type {string} */ _projectRoot,
                /** @type {string} */ _id,
                /** @type {{ status: string }} */ updates,
            ) => {
                actions.push(`registry:${updates.status}`);
                return Promise.resolve({});
            },
            recordPlanEvent: (/** @type {any} */ event) => {
                actions.push(`event:${event.event}:${event.details.failureReason}`);
                return Promise.resolve({});
            },
            setActiveAgent: () => {},
        }),
    });

    assertEquals(actions, ["registry:merge_conflict", "event:worktree_merge_failed:conflict"]);
    assertEquals(uiAPI.promptSelections, ["prompted"]);
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ message) => message.includes("Worktree merge failed: conflict")),
        true,
    );
    assertEquals(
        uiAPI.systemCalls.some((/** @type {{ message: string, isError: boolean }} */ call) =>
            call.message.includes("Worktree merge failed: conflict") && call.isError
        ),
        true,
    );
});

Deno.test("runValidationLoop still prompts when merge-conflict metadata updates fail", async () => {
    const uiAPI = makeUi();
    /** @type {string[]} */
    const actions = [];

    setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        baselineTree: "baseline-tree",
        projectRoot: "/primary",
        executionCwd: "/worktree",
        worktreeId: "wt1",
        worktreeBranch: "harns/worktree/p-wt1",
    });

    await runValidationLoop({
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve("diff --git a/file.js b/file.js\n+change\n"),
            runAgentSession: () =>
                Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "APPROVED" }],
                    }]),
                ),
            mergeExecutionWorktree: () => Promise.reject(new Error("merge conflict")),
            updateWorktreeRegistryEntry: () => {
                actions.push("registry-failed");
                return Promise.reject(new SyntaxError("Expected double-quoted property name"));
            },
            recordPlanEvent: () => {
                actions.push("plan-event-failed");
                return Promise.reject(new Error("front matter conflict markers"));
            },
            setActiveAgent: () => {},
        }),
    });

    assertEquals(actions, ["registry-failed", "plan-event-failed"]);
    assertEquals(uiAPI.promptSelections, ["prompted"]);
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ message) =>
            message.includes("Could not update worktree registry while merge conflict is active")
        ),
        true,
    );
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ message) =>
            message.includes("Could not update plan metadata while merge conflict is active")
        ),
        true,
    );
});

Deno.test("runValidationLoop retries worktree merge after user fixes primary checkout", async () => {
    const uiAPI = makeUi();
    /** @type {string[]} */
    const actions = [];
    let mergeAttempts = 0;
    uiAPI.promptSelect = () => {
        uiAPI.promptSelections.push("retry");
        return Promise.resolve("retry");
    };

    setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        baselineTree: "baseline-tree",
        projectRoot: "/primary",
        executionCwd: "/worktree",
        worktreeId: "wt1",
        worktreeBranch: "harns/worktree/p-wt1",
    });

    await runValidationLoop({
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve("diff --git a/file.js b/file.js\n+change\n"),
            runAgentSession: () =>
                Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "APPROVED" }],
                    }]),
                ),
            mergeExecutionWorktree: () => {
                mergeAttempts++;
                actions.push(`merge:${mergeAttempts}`);
                if (mergeAttempts === 1) return Promise.reject(new Error("primary dirty"));
                return Promise.resolve();
            },
            updateWorktreeRegistryEntry: (
                /** @type {string} */ _projectRoot,
                /** @type {string} */ _id,
                /** @type {{ status: string }} */ updates,
            ) => {
                actions.push(`registry:${updates.status}`);
                return Promise.resolve({});
            },
            recordPlanEvent: (/** @type {any} */ event) => {
                actions.push(
                    `event:${event.event}:${event.details.failureReason || event.details.worktreeStatus || ""}`,
                );
                return Promise.resolve({});
            },
            removeExecutionWorktree: () => {
                actions.push("remove");
                return Promise.resolve();
            },
            setActiveAgent: () => {},
        }),
    });

    assertEquals(actions, [
        "merge:1",
        "registry:merge_conflict",
        "event:worktree_merge_failed:primary dirty",
        "merge:2",
        "registry:merged",
        "remove",
        "event:validation_passed:merged",
    ]);
    assertEquals(uiAPI.promptSelections, ["retry"]);
});

Deno.test("runValidationLoop marks active worktree validation_failed when validation fails", async () => {
    const uiAPI = makeUi();
    /** @type {string[]} */
    const actions = [];

    setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "FEATURE" },
        baselineTree: "baseline-tree",
        projectRoot: "/primary",
        executionCwd: "/worktree",
        worktreeId: "wt1",
        worktreeBranch: "harns/worktree/p-wt1",
    });

    await runValidationLoop({
        planName: "p",
        planContent: "plan",
        triageMeta: { classification: "FEATURE" },
        uiAPI,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            runLocalCI: () => Promise.resolve({ exitCode: 0, output: "" }),
            getDiffText: () => Promise.resolve(""),
            updateWorktreeRegistryEntry: (
                /** @type {string} */ _projectRoot,
                /** @type {string} */ _id,
                /** @type {{ status: string }} */ updates,
            ) => {
                actions.push(`registry:${updates.status}`);
                return Promise.resolve({});
            },
            recordPlanEvent: (/** @type {any} */ event) => {
                actions.push(`event:${event.event}:${event.details.failureReason}`);
                return Promise.resolve({});
            },
            setActiveAgent: () => {},
        }),
    });

    assertEquals(actions, [
        "registry:validation_failed",
        "event:validation_failed:No implementation changes detected in workflow diff.",
    ]);
});
