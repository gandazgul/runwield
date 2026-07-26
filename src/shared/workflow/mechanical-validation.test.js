import { assertEquals, assertStringIncludes } from "@std/assert";

import { runLocalCI, runMechanicalValidation } from "./validation.js";
import { HostedSession } from "../session/hosted-session.js";

import { __resetSettingsForTests } from "../settings.js";
import { withProcessGlobalTestLock } from "../../testing/process-global-lock.js";

import { makeRecordedSession, makeUi, noOpWorktreePlanHandoffDeps } from "./validation-test-helpers.js";

function makeValidationUi() {
    const uiAPI = makeUi();
    return { uiAPI, hostedSession: makeRecordedSession("validation-test", uiAPI) };
}

Deno.test("runLocalCI emits one semantic validation tool lifecycle", async () =>
    await withProcessGlobalTestLock(async () => {
        const originalCwd = Deno.cwd();
        const tempDir = await Deno.makeTempDir({ prefix: "runwield-validation-test-" });
        const { uiAPI, hostedSession } = makeValidationUi();

        try {
            Deno.chdir(tempDir);
            __resetSettingsForTests();
            uiAPI.promptText = () => Promise.resolve("printf validation-output");

            const result = await runLocalCI({ hostedSession, cwd: tempDir });

            assertEquals(result.exitCode, 0);
            assertEquals(
                uiAPI.toolCalls.some((/** @type {{ name: string, args: string }} */ call) =>
                    call.name === "bash" && call.args === "printf validation-output"
                ),
                true,
            );
            assertEquals(
                uiAPI.toolOutputs.some((/** @type {string} */ output) => output.includes("validation-output")),
                true,
            );
            assertEquals(uiAPI.toolResults.some((/** @type {{ isError: boolean }} */ result) => !result.isError), true);
        } finally {
            Deno.chdir(originalCwd);
            __resetSettingsForTests();
            await Deno.remove(tempDir, { recursive: true });
        }
    }));

Deno.test("runLocalCI streams large validation output without failing the process buffer", async () =>
    await withProcessGlobalTestLock(async () => {
        const originalCwd = Deno.cwd();
        const tempDir = await Deno.makeTempDir({ prefix: "runwield-validation-large-output-test-" });
        const { uiAPI, hostedSession } = makeValidationUi();

        try {
            Deno.chdir(tempDir);
            __resetSettingsForTests();
            const command = `${Deno.execPath()} eval "console.log('x'.repeat(1200000)); console.error('tail-marker')"`;
            uiAPI.promptText = () => Promise.resolve(command);

            const result = await runLocalCI({ hostedSession, cwd: tempDir });

            assertEquals(result.exitCode, 0);
            assertStringIncludes(result.output, "tail-marker");
            assertStringIncludes(result.output, "stdout truncated; showing last");
            assertEquals(uiAPI.toolResults.some((/** @type {{ isError: boolean }} */ result) => !result.isError), true);
        } finally {
            Deno.chdir(originalCwd);
            __resetSettingsForTests();
            await Deno.remove(tempDir, { recursive: true });
        }
    }));

Deno.test("runMechanicalValidation passes local CI without plan-specific work", async () => {
    const { uiAPI, hostedSession } = makeValidationUi();
    /** @type {string[]} */
    const actions = [];
    /** @type {any[]} */
    const metrics = [];

    const result = await runMechanicalValidation({
        hostedSession,
        sessionManager: undefined,
        cwd: "/repo",
        manualQaName: "small-fix",
        manualQaContext: "Fix the settings save action.",
        __deps: /** @type {any} */ ({
            ...noOpWorktreePlanHandoffDeps(),
            runLocalCI: (/** @type {{ cwd?: string }} */ { cwd }) => {
                actions.push(`ci:${cwd}`);
                return Promise.resolve({ exitCode: 0, output: "ok" });
            },
            runActiveAgentTurn: () => {
                throw new Error("repair should not run");
            },
            switchActiveAgent: (
                /** @type {unknown} */ _hostedSession,
                /** @type {{ agentName: string }} */ options,
            ) => {
                actions.push(`active:${options.agentName}`);
                return Promise.resolve({ ok: true, agentName: options.agentName, changed: true });
            },
            runManualQaChecklistPrompt: (/** @type {any} */ args) => {
                actions.push(`qa:${args.name}:${args.classification}:${args.context}`);
                return Promise.resolve([]);
            },
            recordWorkflowMetric: (/** @type {any} */ metric) => {
                metrics.push(metric);
                return Promise.resolve(null);
            },
        }),
    });

    assertEquals(result, { passed: true, attempts: 0 });
    assertEquals(actions, [
        "ci:/repo",
        "qa:small-fix:QUICK_FIX:Fix the settings save action.",
        "active:engineer",
    ]);
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ m) => m.includes("QUICK_FIX Mechanical Validation passed")),
        true,
    );
    assertEquals(
        uiAPI.systemCalls
            .map((/** @type {typeof uiAPI.systemCalls[number]} */ call) => call.validationProgress?.stage)
            .filter(Boolean),
        ["ci", "ci", "ci", "manual_qa", "terminal"],
    );
    assertEquals(metrics.map((metric) => metric.event), [
        "mechanical_validation_started",
        "mechanical_ci_attempt",
        "mechanical_validation_finished",
    ]);
});

Deno.test("runMechanicalValidation repairs CI failures through Engineer and then passes", async () => {
    const hostedSession = makeRecordedSession("validation-test", makeUi());
    /** @type {string[]} */
    const actions = [];
    let ciRuns = 0;

    const result = await runMechanicalValidation({
        hostedSession,
        sessionManager: /** @type {any} */ ({ id: "session" }),
        cwd: "/repo",
        __deps: /** @type {any} */ ({
            ...noOpWorktreePlanHandoffDeps(),
            runLocalCI: () => {
                ciRuns++;
                actions.push(`ci:${ciRuns}`);
                return Promise.resolve(ciRuns === 1 ? { exitCode: 1, output: "boom" } : { exitCode: 0, output: "" });
            },
            runActiveAgentTurn: (/** @type {any} */ opts) => {
                actions.push(`repair:${opts.agentName}:${opts.cwd}:${opts.userRequest.includes("boom")}`);
                return Promise.resolve([]);
            },
            readLatestTaskCompletedOutcome: () => true,
            switchActiveAgent: (
                /** @type {unknown} */ _hostedSession,
                /** @type {{ agentName: string }} */ options,
            ) => {
                actions.push(`active:${options.agentName}`);
                return Promise.resolve({ ok: true, agentName: options.agentName, changed: true });
            },
        }),
    });

    assertEquals(result, { passed: true, attempts: 1 });
    assertEquals(actions, ["ci:1", "repair:engineer:/repo:true", "ci:2", "active:engineer"]);
});

Deno.test("runMechanicalValidation ignores stale task_completed from earlier root turns", async () => {
    const staleHostedSession = new HostedSession({ id: "stale-task-completed-test", cwd: Deno.cwd() });
    staleHostedSession.setRootAgentName("engineer");
    staleHostedSession.setRootAgentSession(
        /** @type {any} */ ({
            agent: {
                state: {
                    messages: [{
                        role: "toolResult",
                        toolName: "task_completed",
                        details: { outcome: "task_completed" },
                    }],
                },
            },
        }),
    );
    /** @type {number[]} */
    const fromIndexes = [];

    const result = await runMechanicalValidation({
        hostedSession: staleHostedSession,
        sessionManager: undefined,
        cwd: "/repo",
        __deps: /** @type {any} */ ({
            ...noOpWorktreePlanHandoffDeps(),
            runLocalCI: () => Promise.resolve({ exitCode: 1, output: "boom" }),
            runActiveAgentTurn: () =>
                Promise.resolve(
                    /** @type {any} */ ([
                        {
                            role: "toolResult",
                            toolName: "task_completed",
                            details: { outcome: "task_completed" },
                        },
                        { role: "assistant", content: [{ type: "text", text: "cancelled" }] },
                    ]),
                ),
            readLatestTaskCompletedOutcome: (/** @type {any[]} */ messages, /** @type {number} */ fromIndex) => {
                fromIndexes.push(fromIndex);
                return messages.slice(fromIndex).some((message) => message.toolName === "task_completed");
            },
        }),
    });

    assertEquals(result.passed, false);
    assertEquals(result.reason, "Engineer stopped without task_completed during QUICK_FIX repair.");
    assertEquals(fromIndexes, [1]);
});

Deno.test("runMechanicalValidation detects task_completed when repair returns a fresh root transcript", async () => {
    const rebuiltHostedSession = new HostedSession({ id: "fresh-root-task-completed-test", cwd: Deno.cwd() });
    rebuiltHostedSession.setRootAgentName("engineer");
    rebuiltHostedSession.setRootAgentSession(
        /** @type {any} */ ({
            agent: {
                state: {
                    messages: [
                        { role: "user", content: [{ type: "text", text: "old" }] },
                        { role: "assistant", content: [{ type: "text", text: "old" }] },
                        {
                            role: "toolResult",
                            toolName: "task_completed",
                            details: { outcome: "task_completed" },
                        },
                    ],
                },
            },
        }),
    );
    let ciRuns = 0;

    const result = await runMechanicalValidation({
        hostedSession: rebuiltHostedSession,
        sessionManager: undefined,
        cwd: "/repo",
        __deps: /** @type {any} */ ({
            ...noOpWorktreePlanHandoffDeps(),
            runLocalCI: () => {
                ciRuns++;
                return Promise.resolve(ciRuns === 1 ? { exitCode: 1, output: "boom" } : { exitCode: 0, output: "" });
            },
            runActiveAgentTurn: () =>
                Promise.resolve(
                    /** @type {any} */ ([{
                        role: "toolResult",
                        toolName: "task_completed",
                        details: { outcome: "task_completed" },
                    }]),
                ),
        }),
    });

    assertEquals(result, { passed: true, attempts: 1 });
});

Deno.test("runMechanicalValidation emits paused progress when Engineer repair stops without completion", async () => {
    const { uiAPI } = makeValidationUi();
    const session = makeRecordedSession("mechanical-paused-progress-test", uiAPI);

    const result = await runMechanicalValidation({
        hostedSession: session,
        sessionManager: undefined,
        cwd: "/repo",
        __deps: /** @type {any} */ ({
            ...noOpWorktreePlanHandoffDeps(),
            runLocalCI: () => Promise.resolve({ exitCode: 1, output: "boom" }),
            runActiveAgentTurn: () => Promise.resolve([]),
            readLatestTaskCompletedOutcome: () => false,
            recordWorkflowMetric: () => Promise.resolve(null),
        }),
    });

    assertEquals(result.reason, "Engineer stopped without task_completed during QUICK_FIX repair.");
    const paused = uiAPI.systemCalls.find((/** @type {typeof uiAPI.systemCalls[number]} */ call) =>
        call.message.includes("Mechanical Validation will resume")
    )?.validationProgress;
    assertEquals(paused?.outcome, "paused");
    assertEquals(paused?.stage, "engineer_repair");
    assertEquals(paused?.repairAttempt, 1);
    assertEquals(paused?.checks, { ci: "failed", semanticReview: "skipped", humanReview: "skipped", merge: "skipped" });
});

Deno.test("runMechanicalValidation stops after three Engineer repair attempts without Plan side effects", async () => {
    const { uiAPI, hostedSession } = makeValidationUi();
    let repairCalls = 0;
    let manualQaCalls = 0;

    const result = await runMechanicalValidation({
        hostedSession,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            ...noOpWorktreePlanHandoffDeps(),
            runLocalCI: () => Promise.resolve({ exitCode: 1, output: "still broken" }),
            runActiveAgentTurn: () => {
                repairCalls++;
                return Promise.resolve([]);
            },
            readLatestTaskCompletedOutcome: () => true,
            runManualQaChecklistPrompt: () => {
                manualQaCalls++;
                return Promise.resolve([]);
            },
            recordPlanEvent: () => {
                throw new Error("plan events should not run");
            },
        }),
    });

    assertEquals(result.passed, false);
    assertEquals(result.attempts, 3);
    assertEquals(repairCalls, 3);
    assertEquals(manualQaCalls, 0);
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ m) => m.includes("failed after 3 Engineer repair attempts")),
        true,
    );
    const terminal = uiAPI.systemCalls.find((/** @type {typeof uiAPI.systemCalls[number]} */ call) =>
        call.message.includes("failed after 3 Engineer repair attempts") &&
        call.validationProgress?.stage === "terminal"
    )?.validationProgress;
    assertEquals(terminal?.outcome, "failed");
    assertEquals(terminal?.checks, {
        ci: "failed",
        semanticReview: "skipped",
        humanReview: "skipped",
        merge: "skipped",
    });
});

Deno.test("runMechanicalValidation stops on canceled CI and stays with Engineer", async () => {
    const { uiAPI } = makeValidationUi();
    const session = makeRecordedSession("mechanical-cancel-test", uiAPI);
    /** @type {string[]} */
    const switchedAgents = [];

    const result = await runMechanicalValidation({
        hostedSession: session,
        sessionManager: undefined,
        __deps: /** @type {any} */ ({
            runLocalCI: () => Promise.resolve({ exitCode: 130, output: "Validation canceled.", canceled: true }),
            switchActiveAgent: (
                /** @type {import("../session/hosted-session.js").HostedSession} */ _session,
                /** @type {{ agentName: string }} */ options,
            ) => {
                switchedAgents.push(options.agentName);
                return Promise.resolve({ ok: true });
            },
            recordWorkflowMetric: () => Promise.resolve(),
        }),
    });

    assertEquals(result, { passed: false, attempts: 0, reason: "canceled" });
    assertEquals(switchedAgents, ["engineer"]);
    assertEquals(
        uiAPI.messages.some((/** @type {string} */ message) => message.includes("Mechanical Validation canceled")),
        true,
    );
});
