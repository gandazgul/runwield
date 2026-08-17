import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";

import { withRuntimeCommandFixture } from "../../cmd/testing/runtime-command-fixture.ts";
import { loadPlan, savePlan } from "../../plan-store.js";
import { recordPlanEvent } from "./plan-lifecycle.js";
import { HostedSession } from "../session/hosted-session.js";
import { ensureRootAgentSession } from "../session/session.js";
import {
    attachRecorder,
    makeUi,
    makeValidationProjectRoot,
    NO_ISOLATED_AGENT_PORT,
    runValidationLoop,
    runValidationPhase,
} from "./validation-test-helpers.js";
import { requestObjectiveCheckWaiver, runPlanObjectiveChecks } from "./validation-mechanical.ts";
import { createValidationSessionPort } from "./validation-session-adapter.ts";
import { makeValidationCheckpoint } from "./validation-checkpoint.ts";

/** @returns {import("./validation-session-adapter.ts").SemanticReviewPort} */
function repairPort(outcomes = ["completed"]) {
    let call = 0;
    return {
        runIsolatedAgentSession: () => {
            const outcome = outcomes[Math.min(call, outcomes.length - 1)];
            call += 1;
            return Promise.resolve(
                /** @type {any} */ (
                    outcome === "completed"
                        ? [{
                            role: "toolResult",
                            toolName: "task_completed",
                            toolCallId: `repair-${call}`,
                            content: [],
                            isError: false,
                            timestamp: Date.now(),
                            details: { outcome: "task_completed", message: `Repair turn ${call} completed.` },
                        }]
                        : []
                ),
            );
        },
    };
}

function makeValidationUi(cwd = Deno.cwd()) {
    const uiAPI = makeUi();
    return { uiAPI, hostedSession: attachRecorder(new HostedSession({ id: "validation-repair-test", cwd }), uiAPI) };
}

/** @typedef {{ label: string }} PromptOption */
/** @typedef {{ promptSelections: string[], promptSelect: (prompt: string, options: PromptOption[]) => Promise<string> }} ValidationPromptUi */

/**
 * @param {ValidationPromptUi} uiAPI
 * @param {string[]} labels
 * @param {string} value
 */
function selectAndCaptureOptions(uiAPI, labels, value) {
    uiAPI.promptSelect = (_prompt, options) => {
        uiAPI.promptSelections.push("prompted");
        labels.splice(0, labels.length, ...options.map((option) => option.label));
        return Promise.resolve(value);
    };
}

/**
 * @param {import("../session/hosted-session.js").HostedSession} hostedSession
 * @param {"engineer" | "frontend-engineer"} agentName
 * @param {string} cwd
 */
async function primeRepairAgentRoot(hostedSession, agentName, cwd) {
    await ensureRootAgentSession({
        hostedSession,
        agentName,
        cwd,
    });
}

/**
 * @param {{ executionAgent?: "engineer" | "frontend-engineer" } & Record<string, unknown>} [attrs]
 */
async function makeImplementedRun(attrs = {}) {
    const projectRoot = await makeValidationProjectRoot("p", {
        classification: "QUICK_FIX",
        status: "implemented",
        ...attrs,
    });
    const { hostedSession, uiAPI } = makeValidationUi(projectRoot);
    const executionAgent = attrs.executionAgent || "engineer";
    await primeRepairAgentRoot(hostedSession, executionAgent, projectRoot);
    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "QUICK_FIX", status: "implemented", ...attrs },
        executionAgent,
        projectRoot,
        executionCwd: projectRoot,
        nonGitInPlace: true,
    });
    return { projectRoot, hostedSession, uiAPI };
}

/**
 * @typedef {Awaited<ReturnType<typeof makeImplementedRun>> & { prompts: string[] }} IncompleteRepairFixture
 */

/**
 * @param {string} prefix
 * @param {{ executionAgent?: "engineer" | "frontend-engineer" } & Record<string, unknown>} attrs
 * @param {(fixture: IncompleteRepairFixture) => Promise<void>} run
 */
async function withIncompleteRepairModel(prefix, attrs, run) {
    await withRuntimeCommandFixture(prefix, async ({ setModelResponseFactory }) => {
        const prompts = /** @type {string[]} */ ([]);
        setModelResponseFactory((context) => {
            prompts.push(JSON.stringify(context));
            return fauxAssistantMessage(fauxText("Repair remains incomplete."));
        });
        const fixture = await makeImplementedRun(attrs);
        try {
            await run({ ...fixture, prompts });
        } finally {
            fixture.hostedSession.dispose();
        }
    });
}

Deno.test("Engineer-reported defective checks reach user judgement for met unmet and broken results", async () => {
    const objectiveChecks = [
        { id: "OC1", command: "true" },
        { id: "OC2", command: "false" },
        { id: "OC3", command: "not-a-real-runwield-command" },
    ];
    const projectRoot = await makeValidationProjectRoot("p", {
        classification: "PLANNED_CHANGE",
        status: "implemented",
        objectiveChecks,
    });
    const { hostedSession } = makeValidationUi(projectRoot);
    try {
        /** @type {import('./validation-types.ts').ValidationLoopArgs} */
        const loopArgs = {
            session: createValidationSessionPort(hostedSession),
            planName: "p",
            planContent: "# p",
            triageMeta: { classification: "PLANNED_CHANGE", status: "implemented", objectiveChecks },
            localCI: { run: () => Promise.resolve({ exitCode: 0, output: "ok", canceled: false }) },
            git: /** @type {import('../git-port.ts').GitPort} */ ({}),
            workRecordMnemosynePort:
                /** @type {import('../work-records/mnemosyne-port.ts').WorkRecordMnemosynePort} */ ({}),
        };
        const outcome = await runPlanObjectiveChecks(
            loopArgs,
            {
                args: loopArgs,
                projectRoot,
                executionContext: /** @type {import('./execution-context.ts').ResolvedValidationContext} */ ({
                    planName: "p",
                    projectRoot,
                    executionCwd: projectRoot,
                    executionMode: "non_git_in_place",
                    source: "active_session",
                }),
                executionCwd: projectRoot,
                executionAgent: "engineer",
                nonGitInPlace: true,
                workflowBase: {
                    planName: "p",
                    triageMeta: { classification: "PLANNED_CHANGE", status: "implemented", objectiveChecks },
                    executionAgent: "engineer",
                },
            },
            0,
            [
                { id: "OC1", command: "true", explanation: "zero-test filter selected no tests" },
                { id: "OC2", command: "false", explanation: "invalid option makes the check defective" },
                { id: "OC3", command: "not-a-real-runwield-command", explanation: "tool does not exist" },
            ],
        );

        assertEquals(outcome.kind, "broken");
        if (outcome.kind !== "broken") throw new Error("expected broken outcome");
        assertEquals(outcome.results.map((result) => result.id), ["OC1", "OC2", "OC3"]);
        assertEquals(outcome.results.map((result) => result.status), ["met", "unmet", "broken"]);
        assertStringIncludes(outcome.reason, "Engineer reported defective Objective-Failing Checks");
    } finally {
        hostedSession.dispose();
        await Deno.remove(projectRoot, { recursive: true }).catch(() => undefined);
    }
});

Deno.test("stale Engineer defective-check reports pause for follow-up instead of passing", async () => {
    const objectiveChecks = [{ id: "OC1", command: "true" }];
    const projectRoot = await makeValidationProjectRoot("p", {
        classification: "PLANNED_CHANGE",
        status: "implemented",
        objectiveChecks,
    });
    const { hostedSession, uiAPI } = makeValidationUi(projectRoot);
    const offeredOptions = /** @type {string[]} */ ([]);
    selectAndCaptureOptions(uiAPI, offeredOptions, "stop");
    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "PLANNED_CHANGE", status: "implemented", objectiveChecks },
        executionAgent: "engineer",
        projectRoot,
        executionCwd: projectRoot,
        nonGitInPlace: true,
    });
    try {
        const result = await runValidationPhase({
            hostedSession,
            planName: "p",
            planContent: "# p",
            triageMeta: { classification: "PLANNED_CHANGE", status: "implemented", objectiveChecks },
            engineerReportedBrokenObjectiveChecks: [
                { id: "OC1", command: "false", explanation: "the old command is invalid" },
            ],
            semanticReviewPort: NO_ISOLATED_AGENT_PORT,
            localCI: { run: () => Promise.resolve({ exitCode: 0, output: "ok", canceled: false }) },
        });

        const plan = await loadPlan(projectRoot, "p");
        assertEquals(result.kind, "paused");
        assertStringIncludes(result.reason || "", "stale Engineer defective-check report");
        assertEquals(result.retainTaskCompletionClaim, true);
        assertEquals(offeredOptions, ["Engineer follow-up", "Stop"]);
        assertEquals(plan?.attrs.status, "implemented");
    } finally {
        hostedSession.dispose();
        await Deno.remove(projectRoot, { recursive: true }).catch(() => undefined);
    }
});

Deno.test("Objective-Failing Check waiver follow-up collects user feedback", async () => {
    const objectiveChecks = [{ id: "OC1", command: "not-a-real-runwield-command" }];
    const projectRoot = await makeValidationProjectRoot("p", {
        classification: "PLANNED_CHANGE",
        status: "implemented",
        objectiveChecks,
    });
    const { hostedSession, uiAPI } = makeValidationUi(projectRoot);
    const offeredOptions = /** @type {string[]} */ ([]);
    selectAndCaptureOptions(uiAPI, offeredOptions, "engineer_follow_up");
    uiAPI.promptText = () => Promise.resolve("Use the renamed test file and include the fresh failure output.");
    try {
        const session = createValidationSessionPort(hostedSession);
        /** @type {import('./validation-types.ts').ValidationLoopArgs} */
        const loopArgs = {
            session,
            planName: "p",
            planContent: "# p",
            triageMeta: { classification: "PLANNED_CHANGE", status: "implemented", objectiveChecks },
            localCI: { run: () => Promise.resolve({ exitCode: 0, output: "ok", canceled: false }) },
            git: /** @type {import('../git-port.ts').GitPort} */ ({}),
            workRecordMnemosynePort:
                /** @type {import('../work-records/mnemosyne-port.ts').WorkRecordMnemosynePort} */ ({}),
        };
        const judgement = await requestObjectiveCheckWaiver(
            loopArgs,
            {
                args: loopArgs,
                projectRoot,
                executionContext: /** @type {import('./execution-context.ts').ResolvedValidationContext} */ ({
                    planName: "p",
                    projectRoot,
                    executionCwd: projectRoot,
                    executionMode: "non_git_in_place",
                    source: "active_session",
                }),
                executionCwd: projectRoot,
                executionAgent: "engineer",
                nonGitInPlace: true,
                workflowBase: {
                    planName: "p",
                    triageMeta: { classification: "PLANNED_CHANGE", status: "implemented", objectiveChecks },
                    executionAgent: "engineer",
                },
            },
            "fresh output: command not found",
            [{
                id: "OC1",
                command: "not-a-real-runwield-command",
                status: "broken",
                stdout: "",
                stderr: "command not found",
                exitCode: null,
                durationMs: 1,
                output: "command not found",
                reason: "command not found",
            }],
            "engineer_report",
        );

        assertEquals(judgement.kind, "engineer_follow_up");
        if (judgement.kind !== "engineer_follow_up") throw new Error("expected follow-up judgement");
        assertEquals(judgement.feedback, "Use the renamed test file and include the fresh failure output.");
        assertEquals(offeredOptions, ["Waive defective checks", "Engineer follow-up", "Stop"]);
    } finally {
        hostedSession.dispose();
        await Deno.remove(projectRoot, { recursive: true }).catch(() => undefined);
    }
});

Deno.test("runValidationLoop pauses with Engineer when CI repair does not call task_completed", async () => {
    await withIncompleteRepairModel("validation-repair-ci-", {}, async ({ projectRoot, hostedSession, prompts }) => {
        const result = await runValidationPhase({
            hostedSession,
            planName: "p",
            planContent: "# p",
            triageMeta: { classification: "QUICK_FIX", status: "implemented" },
            localCI: {
                run: () => Promise.resolve({ exitCode: 1, output: "type error", canceled: false }),
            },
        });

        const plan = await loadPlan(projectRoot, "p");
        assertEquals(result.kind, "paused");
        assertEquals(prompts.length, 1);
        assertEquals(hostedSession.getRootAgentName(), "engineer");
        assertStringIncludes(prompts[0], "type error");
        assertEquals(hostedSession.getActiveExecutionWorkflow()?.validationContinuation, true);
        assertEquals(plan?.attrs.status, "implemented");
        assertEquals(plan?.attrs.validationCiAttempts, 1);
    });
});

Deno.test("runValidationLoop dispatches repair when Objective-Failing Checks are unmet", async () => {
    const objectiveChecks = [{ id: "OC1", command: "false", rationale: "must become true" }];
    await withIncompleteRepairModel(
        "validation-repair-objective-",
        { classification: "PLANNED_CHANGE", objectiveChecks },
        async ({ projectRoot, hostedSession, prompts }) => {
            const result = await runValidationPhase({
                hostedSession,
                planName: "p",
                planContent: "# p",
                triageMeta: { classification: "PLANNED_CHANGE", status: "implemented", objectiveChecks },
                localCI: {
                    run: () => Promise.resolve({ exitCode: 0, output: "ok", canceled: false }),
                },
            });

            const plan = await loadPlan(projectRoot, "p");
            assertEquals(result.kind, "paused");
            assertEquals(prompts.length, 1);
            assertStringIncludes(prompts[0], "Objective-Failing Checks");
            assertStringIncludes(prompts[0], "OC1: unmet");
            assertStringIncludes(prompts[0], "test filter selects zero tests");
            assertStringIncludes(prompts[0], "brokenObjectiveChecks");
            assertEquals(plan?.attrs.validationObjectiveCheckAttempts, 1);
        },
    );
});

Deno.test("runValidationLoop sends rejected broken Objective-Failing Check waiver feedback to Engineer", async () => {
    const objectiveChecks = [{ id: "OC1", command: "not-a-real-runwield-command" }];
    await withIncompleteRepairModel(
        "validation-repair-broken-objective-",
        { classification: "PLANNED_CHANGE", objectiveChecks },
        async ({ projectRoot, hostedSession, prompts }) => {
            const result = await runValidationPhase({
                hostedSession,
                planName: "p",
                planContent: "# p",
                triageMeta: { classification: "PLANNED_CHANGE", status: "implemented", objectiveChecks },
                localCI: {
                    run: () => Promise.resolve({ exitCode: 0, output: "ok", canceled: false }),
                },
            });

            const plan = await loadPlan(projectRoot, "p");
            assertEquals(result.kind, "paused");
            assertStringIncludes(result.reason || "", "Objective-Failing Check judgement");
            assertEquals(prompts.length, 0);
            assertEquals(plan?.attrs.validationCiAttempts, undefined);
            assertEquals(plan?.attrs.objectiveCheckWaivers, undefined);
        },
    );
});

Deno.test("runValidationLoop preserves Frontend Engineer owner when CI repair pauses", async () => {
    await withIncompleteRepairModel(
        "validation-repair-frontend-",
        { executionAgent: "frontend-engineer" },
        async ({ projectRoot, hostedSession, prompts }) => {
            const result = await runValidationPhase({
                hostedSession,
                planName: "p",
                planContent: "# p",
                triageMeta: { classification: "QUICK_FIX", status: "implemented" },
                localCI: {
                    run: () => Promise.resolve({ exitCode: 1, output: "css failed", canceled: false }),
                },
            });

            const plan = await loadPlan(projectRoot, "p");
            assertEquals(result.kind, "paused");
            assertEquals(hostedSession.getRootAgentName(), "frontend-engineer");
            assertStringIncludes(prompts[0], "css failed");
            assertEquals(hostedSession.getActiveExecutionWorkflow()?.executionAgent, "frontend-engineer");
            assertEquals(plan?.attrs.validationCiAttempts, 1);
        },
    );
});

Deno.test("runValidationLoop offers a way out when the repair rounds for CI are spent", async () => {
    const projectRoot = await makeValidationProjectRoot("p", {
        classification: "QUICK_FIX",
        status: "implemented",
        validationCiAttempts: 2,
    });
    const { hostedSession, uiAPI } = makeValidationUi();
    const offeredOptions = /** @type {string[]} */ ([]);
    selectAndCaptureOptions(uiAPI, offeredOptions, "stop");
    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "QUICK_FIX", status: "implemented", validationCiAttempts: 2 },
        executionAgent: "engineer",
        projectRoot,
        executionCwd: projectRoot,
        nonGitInPlace: true,
    });

    const result = await runValidationLoop({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "QUICK_FIX", status: "implemented", validationCiAttempts: 2 },
        semanticReviewPort: repairPort(),
        localCI: {
            run: () => Promise.resolve({ exitCode: 1, output: "type error", canceled: false }),
        },
    });

    const plan = await loadPlan(projectRoot, "p");
    // The user is asked before RunWield gives up, and told what would help.
    assertEquals(uiAPI.promptSelections.length, 1);
    assertEquals(result.kind, "failed");
    assertStringIncludes(result.reason || "", "still failing");
    assertStringIncludes(result.reason || "", "Pick Engineer follow-up");
    assertEquals(offeredOptions, ["Engineer follow-up", "Retry", "Stop"]);
    assertEquals(plan?.attrs.status, "implemented");
    // Cleared, so the Retry the message promises actually gets rounds to spend.
    assertEquals(plan?.attrs.validationCiAttempts, 0);
});

Deno.test("Objective-Failing Checks after spent rounds can return control to Engineer", async () => {
    const objectiveChecks = [{ id: "OC1", command: "false", rationale: "must become true" }];
    const projectRoot = await makeValidationProjectRoot("p", {
        classification: "PLANNED_CHANGE",
        status: "implemented",
        validationObjectiveCheckAttempts: 2,
        objectiveChecks,
    });
    const { hostedSession, uiAPI } = makeValidationUi();
    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: {
            classification: "PLANNED_CHANGE",
            status: "implemented",
            validationObjectiveCheckAttempts: 2,
            objectiveChecks,
        },
        executionAgent: "engineer",
        projectRoot,
        executionCwd: projectRoot,
        nonGitInPlace: true,
    });
    const offeredOptions = /** @type {string[]} */ ([]);
    selectAndCaptureOptions(uiAPI, offeredOptions, "engineer_follow_up");

    const result = await runValidationPhase({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: {
            classification: "PLANNED_CHANGE",
            status: "implemented",
            validationObjectiveCheckAttempts: 2,
            objectiveChecks,
        },
        semanticReviewPort: repairPort(["completed", "incomplete"]),
        localCI: {
            run: () => Promise.resolve({ exitCode: 0, output: "ok", canceled: false }),
        },
    });

    assertEquals(result.kind, "paused");
    assertStringIncludes(result.reason || "", "Engineer follow-up");
    assertEquals(offeredOptions, ["Engineer follow-up", "Retry", "Stop"]);
    assertEquals(hostedSession.getActiveExecutionWorkflow()?.executionAgent, "engineer");
    assertEquals(hostedSession.getActiveExecutionWorkflow()?.validationContinuation, true);
    assertEquals((await loadPlan(projectRoot, "p"))?.attrs.status, "implemented");
});

Deno.test("Objective-Failing Checks offer recovery after three completed repairs from attempt zero", async () => {
    const objectiveChecks = [{ id: "OC1", command: "false", rationale: "must become true" }];
    const projectRoot = await makeValidationProjectRoot("p", {
        classification: "PLANNED_CHANGE",
        status: "implemented",
        objectiveChecks,
    });
    const { hostedSession, uiAPI } = makeValidationUi(projectRoot);
    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "PLANNED_CHANGE", status: "implemented", objectiveChecks },
        executionAgent: "engineer",
        projectRoot,
        executionCwd: projectRoot,
        nonGitInPlace: true,
    });
    const offeredOptions = /** @type {string[]} */ ([]);
    selectAndCaptureOptions(uiAPI, offeredOptions, "stop");
    let repairs = 0;

    const result = await runValidationPhase({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "PLANNED_CHANGE", status: "implemented", objectiveChecks },
        semanticReviewPort: {
            runIsolatedAgentSession: () => {
                repairs += 1;
                return Promise.resolve([{
                    role: "toolResult",
                    toolName: "task_completed",
                    toolCallId: `repair-${repairs}`,
                    content: [],
                    isError: false,
                    timestamp: Date.now(),
                    details: { outcome: "task_completed", message: `Repair ${repairs} completed.` },
                }]);
            },
        },
        localCI: { run: () => Promise.resolve({ exitCode: 0, output: "ok", canceled: false }) },
    });

    assertEquals(repairs, 3);
    assertEquals(uiAPI.promptSelections.length, 1);
    assertEquals(offeredOptions, ["Engineer follow-up", "Retry", "Stop"]);
    assertStringIncludes(result.reason || "", "tried 3 times");
});

Deno.test("Objective-Failing Checks follow-up reopens the retained repair session", async () => {
    const objectiveChecks = [{ id: "OC1", command: "false", rationale: "must become true" }];
    await withIncompleteRepairModel(
        "validation-repair-objective-follow-up-",
        { classification: "PLANNED_CHANGE", validationObjectiveCheckAttempts: 2, objectiveChecks },
        async ({ projectRoot, hostedSession, uiAPI, prompts }) => {
            const offeredOptions = /** @type {string[]} */ ([]);
            selectAndCaptureOptions(uiAPI, offeredOptions, "engineer_follow_up");
            let ciRuns = 0;

            const result = await runValidationLoop({
                hostedSession,
                planName: "p",
                planContent: "# p",
                triageMeta: {
                    classification: "PLANNED_CHANGE",
                    status: "implemented",
                    validationObjectiveCheckAttempts: 2,
                    objectiveChecks,
                },
                semanticReviewPort: repairPort(["completed", "incomplete"]),
                localCI: {
                    run: () => {
                        ciRuns += 1;
                        return Promise.resolve({ exitCode: 0, output: "ok", canceled: false });
                    },
                },
            });

            assertEquals(result.kind, "paused");
            assertEquals(offeredOptions, ["Engineer follow-up", "Retry", "Stop"]);
            assertEquals(ciRuns, 2);
            assertEquals(prompts.length, 0);
            assertEquals(hostedSession.getActiveExecutionWorkflow()?.executionAgent, "engineer");
            assertEquals(hostedSession.getActiveExecutionWorkflow()?.validationContinuation, true);
            assertEquals((await loadPlan(projectRoot, "p"))?.attrs.status, "implemented");
        },
    );
});

Deno.test("Retry after the CI rounds run out runs the tests again and carries on", async () => {
    const projectRoot = await makeValidationProjectRoot("p", {
        classification: "QUICK_FIX",
        status: "implemented",
        validationCiAttempts: 2,
    });
    const { hostedSession, uiAPI } = makeValidationUi();
    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "QUICK_FIX", status: "implemented", validationCiAttempts: 2 },
        executionAgent: "engineer",
        projectRoot,
        executionCwd: projectRoot,
        nonGitInPlace: true,
    });
    // The user fixes the tests, then picks Retry — exactly what the pause told them
    // to do. RunWield must run them again in the same breath, not make the user
    // start the whole Plan over.
    let ciRuns = 0;
    uiAPI.promptSelect = () => {
        uiAPI.promptSelections.push("prompted");
        return Promise.resolve("retry");
    };

    const result = await runValidationPhase({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "QUICK_FIX", status: "implemented", validationCiAttempts: 2 },
        semanticReviewPort: repairPort(),
        localCI: {
            run: () => {
                ciRuns += 1;
                return Promise.resolve(
                    ciRuns === 1
                        ? { exitCode: 1, output: "type error", canceled: false }
                        : { exitCode: 0, output: "ok", canceled: false },
                );
            },
        },
    });

    assertEquals(uiAPI.promptSelections.length, 1);
    assertEquals(ciRuns, 2);
    assertEquals(result.kind, "paused");
    assertEquals((await loadPlan(projectRoot, "p"))?.attrs.status, "validated_ci");
});

Deno.test("a stopped test run asks rather than reporting the work as broken", async () => {
    const projectRoot = await makeValidationProjectRoot("p", { classification: "QUICK_FIX", status: "implemented" });
    const { hostedSession, uiAPI } = makeValidationUi();
    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "QUICK_FIX", status: "implemented" },
        executionAgent: "engineer",
        projectRoot,
        executionCwd: projectRoot,
        nonGitInPlace: true,
    });

    const result = await runValidationPhase({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "QUICK_FIX", status: "implemented" },
        semanticReviewPort: NO_ISOLATED_AGENT_PORT,
        localCI: {
            run: () => Promise.resolve({ exitCode: 130, output: "", canceled: true }),
        },
    });

    assertEquals(uiAPI.promptSelections.length, 1);
    assertEquals(result.kind, "paused");
    assertStringIncludes(result.reason || "", "stopped before they finished");
    // Nothing was learned, so nothing is recorded: the Plan stays where it was.
    assertEquals((await loadPlan(projectRoot, "p"))?.attrs.status, "implemented");
});

Deno.test("stopped validation can return control to the Engineer session", async () => {
    const projectRoot = await makeValidationProjectRoot("p", { classification: "QUICK_FIX", status: "implemented" });
    const { hostedSession, uiAPI } = makeValidationUi();
    hostedSession.setActiveExecutionWorkflow({
        planName: "p",
        triageMeta: { classification: "QUICK_FIX", status: "implemented" },
        executionAgent: "engineer",
        projectRoot,
        executionCwd: projectRoot,
        nonGitInPlace: true,
    });
    const offeredOptions = /** @type {string[]} */ ([]);
    selectAndCaptureOptions(uiAPI, offeredOptions, "engineer_follow_up");

    const result = await runValidationPhase({
        hostedSession,
        planName: "p",
        planContent: "# p",
        triageMeta: { classification: "QUICK_FIX", status: "implemented" },
        semanticReviewPort: NO_ISOLATED_AGENT_PORT,
        localCI: {
            run: () => Promise.resolve({ exitCode: 130, output: "", canceled: true }),
        },
    });

    assertEquals(result.kind, "paused");
    assertStringIncludes(result.reason || "", "Engineer follow-up");
    assertEquals(offeredOptions, ["Engineer follow-up", "Retry", "Stop"]);
    assertEquals(hostedSession.getActiveExecutionWorkflow()?.executionAgent, "engineer");
    assertEquals(hostedSession.getActiveExecutionWorkflow()?.validationContinuation, true);
    assertEquals((await loadPlan(projectRoot, "p"))?.attrs.status, "implemented");
});

Deno.test("runValidationPhase re-runs CI after a repair even when the Plan status jumped ahead", async () => {
    await withIncompleteRepairModel("validation-repair-rerun-", {}, async ({ projectRoot, hostedSession }) => {
        /** @type {number[]} */
        const ciExitCodes = [];
        const localCI = {
            run: () => {
                ciExitCodes.push(1);
                return Promise.resolve({ exitCode: 1, output: "type error", canceled: false });
            },
        };

        const first = await runValidationPhase({
            hostedSession,
            planName: "p",
            planContent: "# p",
            triageMeta: { classification: "QUICK_FIX", status: "implemented" },
            localCI,
        });
        assertEquals(first.kind, "paused");
        assertEquals(ciExitCodes.length, 1);

        // Simulate a process boundary where status says Semantic Review is next, but
        // the durable validation checkpoint still owns Mechanical Validation. Session
        // memory is not used for this recovery decision.
        await recordPlanEvent({
            cwd: projectRoot,
            planName: "p",
            event: "mechanical_validation_passed",
            currentStatus: "implemented",
            details: { triageMeta: { classification: "QUICK_FIX", status: "implemented" } },
        });
        const advanced = await loadPlan(projectRoot, "p");
        assertExists(advanced);
        assertEquals(advanced.attrs.status, "validated_ci");
        const checkpoint = makeValidationCheckpoint({
            attemptId: "in-place",
            generation: crypto.randomUUID(),
            status: "implemented",
            phase: "mechanical",
            state: "running",
        });
        await savePlan(projectRoot, "p", advanced.body, {
            ...advanced.attrs,
            validationCheckpoint: checkpoint,
        }, { expectedRevision: advanced.revision });

        // Status now says Semantic Review is next. The durable checkpoint says the CI
        // repair did not settle, so Mechanical Validation runs again.
        const second = await runValidationPhase({
            hostedSession,
            planName: "p",
            planContent: "# p",
            triageMeta: { classification: "QUICK_FIX", status: "validated_ci", validationCheckpoint: checkpoint },
            continuationPhase: checkpoint.nextPhase,
            validationCheckpoint: checkpoint,
            localCI,
        });

        assertEquals(second.kind, "paused");
        assertEquals(
            ciExitCodes.length,
            2,
            "Expected CI to run again rather than being skipped by the advanced status.",
        );
    });
});
