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

Deno.test("loadManualQaPrompt returns a bare tool-free prompt", async () => {
    /** @type {string[]} */
    const readPaths = [];
    const promptDef = await loadManualQaPrompt(
        (path) => {
            readPaths.push(path);
            return Promise.resolve([
                "---",
                "name: Manual QA",
                'description: "Checklist prompt"',
                "tools: []",
                "---",
                "",
                "Output only a manual verification checklist.",
                "",
            ].join("\n"));
        },
        (relativePath) => Promise.resolve(`/tmp/bundled-agent-definitions/${relativePath}`),
    );

    assertEquals(readPaths, ["/tmp/bundled-agent-definitions/workflow-prompts/manual-qa-prompt.md"]);
    assertEquals(promptDef.name, "operator");
    assertEquals(promptDef.displayName, "Manual QA");
    assertEquals(promptDef.tools, []);
    assertEquals(promptDef.systemPrompt, "Output only a manual verification checklist.");
});

Deno.test("bundled Manual QA prompt requires the user checklist shape", async () => {
    const prompt = await Deno.readTextFile(
        new URL("../../agent-definitions/workflow-prompts/manual-qa-prompt.md", import.meta.url),
    );

    assertStringIncludes(prompt, "Manual verification steps for <plan name>");
    assertStringIncludes(prompt, "- [ ] step 1");
    assertStringIncludes(prompt, "automated verification has already passed");
});

Deno.test("runManualQaChecklistPrompt uses isolated Plan context without tools", async () => {
    /** @type {any} */
    let invocation;
    const expectedMessages = /** @type {any} */ ([{ role: "assistant", content: "checklist" }]);
    const promptDef = /** @type {any} */ ({
        name: "operator",
        displayName: "Manual QA",
        model: "",
        description: "Checklist prompt",
        tools: [],
        systemPrompt: "Output a checklist.",
    });

    const result = await runManualQaChecklistPrompt({
        hostedSession,
        name: "settings-panel",
        classification: "FEATURE",
        context: "## Verification Plan\n- Manual: save settings and reload",
        cwd: "/repo",
        __deps: {
            loadManualQaPrompt: () => Promise.resolve(promptDef),
            runIsolatedAgentSession: (/** @type {any} */ args) => {
                invocation = args;
                return Promise.resolve(expectedMessages);
            },
        },
    });

    assertEquals(result, expectedMessages);
    assertEquals(invocation.agentName, "operator");
    assertEquals(invocation.cwd, "/repo");
    assertEquals(invocation._agentDefOverride, promptDef);
    assertEquals(invocation.includeEditFallback, false);
    assertEquals(Object.hasOwn(invocation, "useRootSession"), false);
    assertStringIncludes(invocation.userRequest, "Name: settings-panel");
    assertStringIncludes(invocation.userRequest, "Classification: FEATURE");
    assertStringIncludes(invocation.userRequest, "save settings and reload");
});

Deno.test("runManualQaChecklistPrompt persists visible checklist for resume replay", async () => {
    /** @type {Array<Record<string, unknown>>} */
    const entries = [];
    const session = new HostedSession({
        id: "manual-qa-persist",
        cwd: Deno.cwd(),
        sessionManager: /** @type {any} */ ({
            getSessionId: () => "manual-qa-persisted",
            getCwd: () => Deno.cwd(),
            getBranch: () => entries,
            appendCustomEntry: (/** @type {string} */ customType, /** @type {unknown} */ data) => {
                entries.push({ type: "custom", customType, data });
            },
        }),
    });
    const promptDef = /** @type {any} */ ({
        name: "operator",
        displayName: "Manual QA",
        model: "",
        description: "Checklist prompt",
        tools: [],
        systemPrompt: "Output a checklist.",
    });

    await runManualQaChecklistPrompt({
        hostedSession: session,
        name: "settings-panel",
        classification: "FEATURE",
        context: "context",
        cwd: Deno.cwd(),
        __deps: {
            loadManualQaPrompt: () => Promise.resolve(promptDef),
            runIsolatedAgentSession: () =>
                Promise.resolve(
                    /** @type {any} */ ([{
                        role: "assistant",
                        content: [{ type: "text", text: "Manual verification steps for settings-panel" }],
                    }]),
                ),
        },
    });

    assertEquals(entries, [{
        type: "custom",
        customType: "runwield.manual_qa_checklist",
        data: {
            agentName: "Operator",
            text: "Manual verification steps for settings-panel",
            name: "settings-panel",
            classification: "FEATURE",
        },
    }]);
});

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

Deno.test("bundled reviewer prompt permits unrelated formatter-only changes", async () => {
    const prompt = await Deno.readTextFile(
        new URL("../../agent-definitions/workflow-prompts/reviewer-prompt.md", import.meta.url),
    );

    assertStringIncludes(prompt, "Ignore unrelated formatter-only changes");
    assertStringIncludes(prompt, "Do not fail a review merely because the diff touches files the plan did not mention");
});

Deno.test("bundled reviewer prompt reviews implementation semantics rather than verification completion", async () => {
    const prompt = await Deno.readTextFile(
        new URL("../../agent-definitions/workflow-prompts/reviewer-prompt.md", import.meta.url),
    );

    assertStringIncludes(prompt, "Do the changes adhere to the implementation requirements in the Plan's steps?");
    assertStringIncludes(prompt, "Does the resulting implementation meet the Plan's objective?");
    assertStringIncludes(prompt, "Do not audit whether the Engineer performed");
    assertStringIncludes(prompt, "browser/integration/server flow remains unverified");
    assertStringIncludes(prompt, "workflow context, not as semantic requirements or proof");
    assertStringIncludes(prompt, "external verification procedure so that the Reviewer can approve the code");
    assertStringIncludes(prompt, "If missing external verification evidence is your only concern, approve");
    assertStringIncludes(prompt, "Every blocking issue must identify a concrete implementation defect");
    assertStringIncludes(
        prompt,
        "Never send the Engineer a blocking issue whose requested fix is only to run a command",
    );
    assertStringIncludes(prompt, "not a verification-completion audit");
});

Deno.test("bundled reviewer prompt requires exhaustive findings in one review pass", async () => {
    const prompt = await Deno.readTextFile(
        new URL("../../agent-definitions/workflow-prompts/reviewer-prompt.md", import.meta.url),
    );

    assertStringIncludes(prompt, "private coverage checklist of every material implementation requirement");
    assertStringIncludes(prompt, "Do not call `review_complete` while any material");
    assertStringIncludes(prompt, "Finding one blocking issue does not finish the review");
    assertStringIncludes(prompt, "perform a final coverage sweep");
    assertStringIncludes(prompt, "Do not defer discoverable issues to a later review cycle");
    assertStringIncludes(prompt, "Report the complete set now, not one representative issue");
    assertStringIncludes(prompt, "Never stop reviewing after the first valid issue");
    assertStringIncludes(prompt, "Do not hold findings back for a later repair/review cycle");
});
