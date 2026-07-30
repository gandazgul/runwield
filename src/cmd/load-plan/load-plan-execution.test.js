import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { runLoadPlanCommand } from "./index.js";

import { makeRuntimeContext, makeRuntimeFixture, makeUi, noOpRecordPlanEvent } from "./load-plan-test-helpers.js";
import { injectFrontMatter, loadPlan } from "../../plan-store.js";
import { createGitPort } from "../../shared/git-port.ts";
import { defineGitFixture, git } from "../../shared/git-test-fixture.ts";
import { SessionHost } from "../../shared/session/session-host.js";
import { SessionRuntime } from "../../shared/session/session-runtime.js";
import { recordPlanEvent } from "../../shared/workflow/plan-lifecycle.js";
import { findById as findWorktreeById } from "../../shared/worktree-registry.js";
import { removeWorktreeGitArtifacts } from "../../shared/worktree.js";
import { withProcessGlobalTestLock } from "../../testing/process-global-lock.js";

const STALE_EXECUTION_PLAN_NAME = "stale-execution-metadata";
const STALE_EXECUTION_PLAN_ID = "load-plan-stale-metadata-fixture";
const STALE_EXECUTION_PLAN_BODY = "# Preserve footer context\n\nImplement the approved validation-loop fix.";
const STALE_EXECUTION_PLAN_MARKDOWN = injectFrontMatter(STALE_EXECUTION_PLAN_BODY, {
    planId: STALE_EXECUTION_PLAN_ID,
    classification: "PLANNED_CHANGE",
    workKind: "BUG_FIX",
    complexity: "MEDIUM",
    summary: "Preserve footer context during validation",
    affectedPaths: [],
    status: "approved",
    executionAgent: "engineer",
    collaborationRecommendation: "autonomous",
});

const staleExecutionMetadataFixture = defineGitFixture(async (repoPath) => {
    await Deno.mkdir(join(repoPath, "plans"), { recursive: true });
    await Deno.writeTextFile(join(repoPath, ".gitignore"), ".wld/\n");
    await Deno.writeTextFile(
        join(repoPath, "plans", `${STALE_EXECUTION_PLAN_NAME}.md`),
        STALE_EXECUTION_PLAN_MARKDOWN,
    );
    await git(repoPath, ["add", "."]);
    await git(repoPath, ["commit", "-m", "fixture: approved plan"]);
});

Deno.test("runLoadPlanCommand approved plan proceed path", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("proceed");
    let executed = false;

    await runLoadPlanCommand(["plan-a"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-a"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-a",
                    path: "plans/plan-a.md",
                    body: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "approved",
                    },
                }),
            executePlan: () => {
                executed = true;
                return Promise.resolve(undefined);
            },
            recordPlanEvent: noOpRecordPlanEvent,
            resetTuiState: () => {},
        }),
    });

    assertEquals(executed, true);
});

Deno.test("runLoadPlanCommand child Planned Change with verified dependencies executes without warning", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("proceed");
    let executed = false;

    await runLoadPlanCommand(["epic-e/02-second"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: (/** @type {string[]} */ argv) => ({ help: false, _: argv }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "epic-e/02-second",
                    path: "plans/epic-e/02-second.md",
                    body: "child body",
                    markdown: "child body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "Second child",
                        affectedPaths: [],
                        status: "ready_for_work",
                        parentPlan: "epic-e",
                        dependencies: ["01-first"],
                    },
                }),
            resolveSiblingChildPlanDependencies: () =>
                Promise.resolve([
                    {
                        dependency: "01-first",
                        planName: "epic-e/01-first",
                        status: "verified",
                        state: "verified",
                    },
                ]),
            executePlan: () => {
                executed = true;
                return Promise.resolve(undefined);
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(messages.some((message) => message.includes("dependencies that are not verified")), false);
    assertEquals(executed, true);
});

Deno.test("runLoadPlanCommand child Planned Change warns for unverified dependencies and can proceed", async () => {
    const { uiAPI, selections, messages, prompts } = makeUi();
    selections.push("proceed", "proceed");
    let executed = false;

    await runLoadPlanCommand(["epic-f/02-second"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: (/** @type {string[]} */ argv) => ({ help: false, _: argv }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "epic-f/02-second",
                    path: "plans/epic-f/02-second.md",
                    body: "child body",
                    markdown: "child body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "Second child",
                        affectedPaths: [],
                        status: "ready_for_work",
                        parentPlan: "epic-f",
                        dependencies: ["01-first"],
                    },
                }),
            resolveSiblingChildPlanDependencies: () =>
                Promise.resolve([
                    {
                        dependency: "01-first",
                        planName: "epic-f/01-first",
                        status: "implemented",
                        state: "unverified",
                    },
                ]),
            executePlan: () => {
                executed = true;
                return Promise.resolve(undefined);
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(messages.some((message) => message.includes("epic-f/01-first: implemented")), true);
    assertEquals(prompts[0].prompt, 'Proceed with "epic-f/02-second" anyway?');
    assertEquals(executed, true);
});

Deno.test("runLoadPlanCommand child Planned Change warns for missing dependencies", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("proceed", "proceed");
    let executed = false;

    await runLoadPlanCommand(["epic-g/02-second"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: (/** @type {string[]} */ argv) => ({ help: false, _: argv }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "epic-g/02-second",
                    path: "plans/epic-g/02-second.md",
                    body: "child body",
                    markdown: "child body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "Second child",
                        affectedPaths: [],
                        status: "ready_for_work",
                        parentPlan: "epic-g",
                        dependencies: ["01-first"],
                    },
                }),
            resolveSiblingChildPlanDependencies: () =>
                Promise.resolve([
                    {
                        dependency: "01-first",
                        state: "missing",
                    },
                ]),
            executePlan: () => {
                executed = true;
                return Promise.resolve(undefined);
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(messages.some((message) => message.includes("01-first: missing")), true);
    assertEquals(executed, true);
});

Deno.test("runLoadPlanCommand child Planned Change dependency warning can be canceled", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("cancel");
    let executed = false;

    await runLoadPlanCommand(["epic-h/02-second"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: (/** @type {string[]} */ argv) => ({ help: false, _: argv }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "epic-h/02-second",
                    path: "plans/epic-h/02-second.md",
                    body: "child body",
                    markdown: "child body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "Second child",
                        affectedPaths: [],
                        status: "ready_for_work",
                        parentPlan: "epic-h",
                        dependencies: ["01-first"],
                    },
                }),
            resolveSiblingChildPlanDependencies: () =>
                Promise.resolve([
                    {
                        dependency: "01-first",
                        planName: "epic-h/01-first",
                        status: "ready_for_work",
                        state: "unverified",
                    },
                ]),
            executePlan: () => {
                executed = true;
                return Promise.resolve(undefined);
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(messages.includes("Plan load canceled."), true);
    assertEquals(executed, false);
});

Deno.test("runLoadPlanCommand warns and cancels execution when affected paths changed since updatedAt", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("proceed", "cancel");
    let executed = false;
    /** @type {string | undefined} */
    let checkedTimestamp;
    /** @type {string[] | undefined} */
    let checkedPaths;

    await runLoadPlanCommand(["plan-stale"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-stale"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-stale",
                    path: "plans/plan-stale.md",
                    body: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: ["src/a.js"],
                        createdAt: "2026-01-01T00:00:00.000Z",
                        updatedAt: "2026-01-02T00:00:00.000Z",
                        status: "ready_for_work",
                    },
                }),
            listCommitsTouchingPathsSince: (
                /** @type {string} */ _cwd,
                /** @type {string} */ since,
                /** @type {string[]} */ paths,
            ) => {
                checkedTimestamp = since;
                checkedPaths = paths;
                return Promise.resolve([
                    {
                        hash: "abc1234",
                        date: "2026-01-03T00:00:00-05:00",
                        subject: "change affected file",
                    },
                ]);
            },
            executePlan: () => {
                executed = true;
                return Promise.resolve(undefined);
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(checkedTimestamp, "2026-01-02T00:00:00.000Z");
    assertEquals(checkedPaths, ["src/a.js"]);
    assertEquals(messages.some((m) => m.includes("change affected file")), true);
    assertEquals(messages.some((m) => m.includes("src/a.js")), true);
    assertEquals(messages.some((m) => m.includes("Execution canceled.")), true);
    assertEquals(executed, false);
});

Deno.test("runLoadPlanCommand proceeds after affected path warning confirmation", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("proceed", "proceed");
    let executed = false;
    /** @type {string | undefined} */
    let checkedTimestamp;

    await runLoadPlanCommand(["plan-stale-confirmed"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-stale-confirmed"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-stale-confirmed",
                    path: "plans/plan-stale-confirmed.md",
                    body: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: ["src/a.js"],
                        createdAt: "2026-01-01T00:00:00.000Z",
                        status: "ready_for_work",
                    },
                }),
            listCommitsTouchingPathsSince: (
                /** @type {string} */ _cwd,
                /** @type {string} */ since,
                /** @type {string[]} */ _paths,
            ) => {
                checkedTimestamp = since;
                return Promise.resolve([
                    {
                        hash: "def5678",
                        date: "2026-01-03T00:00:00-05:00",
                        subject: "change affected file",
                    },
                ]);
            },
            executePlan: () => {
                executed = true;
                return Promise.resolve(undefined);
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(checkedTimestamp, "2026-01-01T00:00:00.000Z");
    assertEquals(executed, true);
});

Deno.test("runLoadPlanCommand validates completed execution against freshly loaded plan content", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("proceed");
    const runtimeFixture = makeRuntimeFixture();
    /** @type {string | undefined} */
    let validatedPlanContent;

    await runLoadPlanCommand(["plan-fresh"], {
        ...runtimeFixture.context,
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-fresh"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-fresh",
                    path: "plans/plan-fresh.md",
                    body: "stale body",
                    markdown: "stale markdown",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "approved",
                    },
                }),
            executePlan: () => Promise.resolve({ repairRequired: false, executionComplete: true }),
            loadPlan: () =>
                Promise.resolve({
                    markdown: "fresh markdown",
                    body: "fresh body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "fresh summary",
                        affectedPaths: [],
                        status: "implemented",
                        executionMode: "non_git_in_place",
                        worktreeId: "wt1",
                        worktreePath: "/worktree",
                        worktreeBranch: "runwield/worktree/plan-fresh-wt1",
                        worktreeBaseBranch: "feature-base",
                    },
                }),
            runValidationLoop: (/** @type {{ planContent: string }} */ args) => {
                validatedPlanContent = args.planContent;
                return Promise.resolve();
            },
            recordPlanEvent: noOpRecordPlanEvent,
            resetTuiState: () => {},
        }),
    });

    assertEquals(validatedPlanContent, "fresh markdown");
    assertEquals(runtimeFixture.state.workflow?.executionMode, "non_git_in_place");
});

Deno.test("runLoadPlanCommand ready_for_work plan proceed path executes", async () => {
    const { uiAPI, selections } = makeUi();
    selections.push("proceed");
    let executed = false;

    await runLoadPlanCommand(["plan-ready-exec"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-ready-exec"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-ready-exec",
                    path: "plans/plan-ready-exec.md",
                    body: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: [],
                        status: "ready_for_work",
                    },
                }),
            executePlan: () => {
                executed = true;
                return Promise.resolve(undefined);
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(executed, true);
});

Deno.test("runLoadPlanCommand skips affected path history in non-Git projects", async () => {
    const { uiAPI, selections, messages } = makeUi();
    selections.push("proceed");
    let executed = false;

    await runLoadPlanCommand(["plan-non-git-history"], {
        ...makeRuntimeContext(),
        uiAPI,
        editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
        __testDeps: /** @type {any} */ ({
            parseArgs: () => ({ help: false, _: ["plan-non-git-history"] }),
            resolvePlan: () =>
                Promise.resolve({
                    planName: "plan-non-git-history",
                    path: "plans/plan-non-git-history.md",
                    body: "body",
                    attrs: {
                        classification: "FEATURE",
                        complexity: "LOW",
                        summary: "s",
                        affectedPaths: ["src/a.js"],
                        status: "ready_for_work",
                        updatedAt: "2026-01-01T00:00:00.000Z",
                    },
                }),
            listCommitsTouchingPathsSince: () =>
                Promise.reject({
                    name: "GitRepositoryRequiredError",
                    message: "Checking affected path commit history requires a Git repository.",
                }),
            executePlan: () => {
                executed = true;
                return Promise.resolve(undefined);
            },
            resetTuiState: () => {},
        }),
    });

    assertEquals(executed, true);
    assertEquals(
        messages.some((message) =>
            message.includes("Skipping affected path history check because this project is not a Git repository")
        ),
        true,
    );
});

Deno.test("runLoadPlanCommand self-heals stale committed execution metadata before starting Engineer", async () => {
    await withProcessGlobalTestLock(async () => {
        const projectRoot = await staleExecutionMetadataFixture.checkout({
            prefix: "runwield-load-plan-metadata-",
        });
        const isolatedHome = await Deno.makeTempDir({ prefix: "runwield-load-plan-home-" });
        const previousHome = Deno.env.get("HOME");
        /** @type {string | undefined} */
        let executionCwd;
        try {
            // Worktree placement and every global RunWield path resolve beneath
            // this throwaway HOME. Nothing in this test can reach the developer's
            // checkout or ~/.wld.
            Deno.env.set("HOME", isolatedHome);

            const committedPlan = await loadPlan(projectRoot, STALE_EXECUTION_PLAN_NAME);
            assert(committedPlan);
            assertEquals(committedPlan.attrs.status, "approved");
            await recordPlanEvent({
                cwd: projectRoot,
                planName: STALE_EXECUTION_PLAN_NAME,
                event: "readiness_passed",
                currentStatus: "approved",
                details: { triageMeta: committedPlan.attrs },
            });
            const readyPlan = await loadPlan(projectRoot, STALE_EXECUTION_PLAN_NAME);
            assert(readyPlan);
            assertEquals(readyPlan.attrs.status, "ready_for_work");

            const realGit = createGitPort();
            const committedHead = await realGit.branchHead(projectRoot, "main");
            const runtimeEvents = /** @type {Array<{ message?: string }>} */ ([]);
            const sessionId = "real-load-plan-stale-metadata";
            const sessionHost = new SessionHost();
            const hostedSession = sessionHost.createSession({
                id: sessionId,
                cwd: projectRoot,
                eventSink: (/** @type {{ message?: string }} */ event) => runtimeEvents.push(event),
            });
            hostedSession.setRootAgentName("router");
            const runtime = new SessionRuntime({
                sessionHost,
                // Agent activation is an external session/LLM boundary. The
                // runtime, lifecycle, Plan store, Git worktree, and registry all
                // remain the production implementations exercised below.
                switchActiveAgent: (session, options) => {
                    session.setRootAgentName(options.agentName);
                    return Promise.resolve({ ok: true, changed: true, agentName: options.agentName });
                },
            });
            const { uiAPI, selections, messages } = makeUi();
            selections.push("proceed");
            /** @type {Array<{ cwd?: string }>} */
            const engineerTurns = [];

            await runLoadPlanCommand([STALE_EXECUTION_PLAN_NAME], {
                sessionId,
                sessionRuntime: runtime,
                uiAPI,
                editor: /** @type {any} */ ({ disableSubmit: false, setText: () => {} }),
                __testDeps: /** @type {any} */ ({
                    // This adapter still calls the real runtime executePlan. Only
                    // the true external Engineer turn is replaced.
                    executePlan: (/** @type {Record<string, unknown>} */ options) =>
                        runtime.executePlan(sessionId, {
                            ...options,
                            __deps: {
                                runActiveAgentTurn: (/** @type {{ cwd?: string }} */ turn) => {
                                    engineerTurns.push(turn);
                                    return Promise.resolve([]);
                                },
                            },
                        }),
                    setTerminalTitleForName: () => {},
                    resetTuiState: () => {},
                }),
            });

            assertEquals(engineerTurns.length, 1);
            const workflow = hostedSession.getActiveExecutionWorkflow();
            assert(workflow);
            assert(typeof workflow.executionCwd === "string");
            assert(typeof workflow.worktreeBranch === "string");
            assert(typeof workflow.worktreeId === "string");
            executionCwd = workflow.executionCwd;
            assert(executionCwd.startsWith(join(isolatedHome, ".wld", "worktrees")));
            assertEquals(engineerTurns[0].cwd, executionCwd);
            assertEquals(await realGit.branchHead(projectRoot, workflow.worktreeBranch), committedHead);

            const executionPlan = await loadPlan(executionCwd, STALE_EXECUTION_PLAN_NAME);
            assert(executionPlan);
            assertEquals(executionPlan.attrs.status, "ready_for_work");
            assertEquals(executionPlan.attrs.classification, "PLANNED_CHANGE");
            assertEquals(executionPlan.body, STALE_EXECUTION_PLAN_BODY);

            const canonicalPlan = await loadPlan(projectRoot, STALE_EXECUTION_PLAN_NAME);
            assert(canonicalPlan);
            assertEquals(canonicalPlan.attrs.status, "in_progress");
            const registryEntry = await findWorktreeById(projectRoot, workflow.worktreeId);
            assert(registryEntry);
            assertEquals(registryEntry.path, executionCwd);
            assertEquals(registryEntry.status, "active");

            const visibleText = [
                ...messages,
                ...runtimeEvents.map((event) => typeof event.message === "string" ? event.message : ""),
            ].join("\n");
            assertEquals(visibleText.includes("Plan metadata is incompatible"), false);
            assertEquals(visibleText.includes("Execution did not start"), false);
        } finally {
            if (executionCwd) {
                await removeWorktreeGitArtifacts({ projectRoot, path: executionCwd, force: true }).catch(() => {});
            }
            if (previousHome === undefined) Deno.env.delete("HOME");
            else Deno.env.set("HOME", previousHome);
            await Deno.remove(projectRoot, { recursive: true }).catch(() => {});
            await Deno.remove(isolatedHome, { recursive: true }).catch(() => {});
        }
    });
});
