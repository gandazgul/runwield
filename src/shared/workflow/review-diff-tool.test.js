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

// ─── review-diff-tool tests ────────────────────────────────────────────────

import {
    buildLargeDiffReviewPrompt,
    createReviewDiffTool,
    formatChangedFileList,
    getFileDiff,
    listDiffFiles,
    parseDiffFiles,
} from "./review-diff-tool.js";

const SAMPLE_INLINE_DIFF = [
    "diff --git a/src/a.js b/src/a.js",
    "--- a/src/a.js",
    "+++ b/src/a.js",
    "@@ -1,3 +1,4 @@",
    " line1",
    "-old line",
    "+new line",
    " line3",
    "diff --git a/src/b.js b/src/b.js",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/src/b.js",
    "@@ -0,0 +1,2 @@",
    "+brand new",
    "+file",
    "diff --git a/src/c.js b/src/c.js",
    "deleted file mode 100644",
    "--- a/src/c.js",
    "+++ /dev/null",
    "@@ -1,2 +0,0 @@",
    "-removed line1",
    "-removed line2",
    "diff --git a/src/old.js b/src/new.js",
    "rename from src/old.js",
    "rename to src/new.js",
    "--- a/src/old.js",
    "+++ b/src/new.js",
    "@@ -1,1 +1,2 @@",
    " base",
    "+extra",
    "diff --git a/src/binary.png b/src/binary.png",
    "new file mode 100644",
    "Binary files /dev/null and b/src/binary.png differ",
].join("\n");

Deno.test("parseDiffFiles parses modified, added, deleted, renamed, and binary files", () => {
    const entries = parseDiffFiles(SAMPLE_INLINE_DIFF);
    assertEquals(entries.length, 5, "expected 5 file entries");

    const modEntry = entries.find((e) => e.path === "src/a.js");
    assertEquals(modEntry?.changeType, "modified");
    assertEquals(modEntry?.hunkLines.added, 1);
    assertEquals(modEntry?.hunkLines.removed, 1);

    const addEntry = entries.find((e) => e.path === "src/b.js");
    assertEquals(addEntry?.changeType, "added");
    assertEquals(addEntry?.hunkLines.added, 2);
    assertEquals(addEntry?.hunkLines.removed, 0);

    const delEntry = entries.find((e) => e.path === "src/c.js");
    assertEquals(delEntry?.changeType, "deleted");
    assertEquals(delEntry?.hunkLines.added, 0);
    assertEquals(delEntry?.hunkLines.removed, 2);

    const renameEntry = entries.find((e) => e.path === "src/new.js");
    assertEquals(renameEntry?.changeType, "renamed");

    const binaryEntry = entries.find((e) => e.path === "src/binary.png");
    assertEquals(binaryEntry?.changeType, "modified");
    assertEquals(binaryEntry?.hunkLines.added, 0);
    assertEquals(binaryEntry?.hunkLines.removed, 0);
});

Deno.test("parseDiffFiles returns empty array for empty diff", () => {
    assertEquals(parseDiffFiles(""), []);
    assertEquals(parseDiffFiles("   "), []);
    assertEquals(parseDiffFiles("no header here"), []);
});

Deno.test("formatChangedFileList includes all entries with summary info", () => {
    const entries = parseDiffFiles(SAMPLE_INLINE_DIFF);
    const output = formatChangedFileList(entries);
    assertStringIncludes(output, "src/a.js");
    assertStringIncludes(output, "src/b.js");
    assertStringIncludes(output, "src/c.js");
    assertStringIncludes(output, "1 added, 1 removed");
    assertStringIncludes(output, "2 added, 0 removed");
    assertStringIncludes(output, "0 added, 2 removed");
    assertStringIncludes(output, "5 file(s)");
});

Deno.test("getFileDiff finds file by exact path", () => {
    const entries = parseDiffFiles(SAMPLE_INLINE_DIFF);
    const result = getFileDiff(entries, "src/a.js");
    assertEquals(result.found, true);
    if (result.found) {
        assertStringIncludes(result.content, "new line");
        assertEquals(result.truncated, false);
    }
});

Deno.test("getFileDiff returns not-found for nonexistent file", () => {
    const entries = parseDiffFiles(SAMPLE_INLINE_DIFF);
    const result = getFileDiff(entries, "src/nope.js");
    assertEquals(result.found, false);
    if (!result.found) {
        assertStringIncludes(result.message, "not found");
    }
});

Deno.test("getFileDiff supports byte offset for truncated reads", () => {
    const entries = parseDiffFiles(SAMPLE_INLINE_DIFF);
    // Use a very small maxBytes to force truncation
    const result = getFileDiff(entries, "src/a.js", { offsetBytes: 0, maxBytes: 50 });
    assertEquals(result.found, true);
    if (result.found) {
        assertEquals(result.truncated, true);
        assertEquals(result.remainingBytes > 0, true);
    }
});

Deno.test("listDiffFiles marks entries exceeding max inline bytes as truncated", () => {
    const entries = parseDiffFiles(SAMPLE_INLINE_DIFF);
    const summaries = listDiffFiles(entries, 1);

    for (const s of summaries) {
        assertEquals(s.truncated, true);
        assertEquals(s.maxInlineBytes, 1);
    }
});

Deno.test("listDiffFiles does not mark small entries as truncated", () => {
    const entries = parseDiffFiles(SAMPLE_INLINE_DIFF);
    const summaries = listDiffFiles(entries, 10_000_000);

    for (const s of summaries) {
        assertEquals(s.truncated, false);
        assertEquals(s.maxInlineBytes, null);
    }
});

Deno.test("buildLargeDiffReviewPrompt produces compact review packet without full diff", () => {
    const reviewerAgentDef = {
        name: "reviewer",
        displayName: "Reviewer",
        model: "",
        description: "",
        tools: [],
        systemPrompt: "",
    };
    const planContent = "Add a feature that does X.";
    const totalBytes = new TextEncoder().encode(SAMPLE_INLINE_DIFF).byteLength;
    const prompt = buildLargeDiffReviewPrompt(reviewerAgentDef, planContent, SAMPLE_INLINE_DIFF, totalBytes);

    // Should NOT contain the full diff
    assertEquals(prompt.includes("new line"), false);
    assertEquals(prompt.includes("brand new"), false);
    assertEquals(prompt.includes("removed line1"), false);

    // Should contain the changed file listing
    assertStringIncludes(prompt, "src/a.js");
    assertStringIncludes(prompt, "src/b.js");
    assertStringIncludes(prompt, "src/c.js");

    // Should contain the original plan
    assertStringIncludes(prompt, "Add a feature that does X");

    // Should contain usage instructions
    assertStringIncludes(prompt, "review_diff");

    // Should mention the size
    assertStringIncludes(prompt, "omitted");
});

Deno.test("review_diff tool responds to list command", async () => {
    const tool = createReviewDiffTool(SAMPLE_INLINE_DIFF);
    const result = await /** @type {any} */ (tool.execute)("test-1", { command: "list" });
    assertStringIncludes(result.content[0].text, "src/a.js");
    assertStringIncludes(result.content[0].text, "src/b.js");
    assertEquals(result.details.command, "list");
    assertEquals(result.details.fileCount, 5);
});

Deno.test("review_diff tool responds to show command", async () => {
    const tool = createReviewDiffTool(SAMPLE_INLINE_DIFF);
    const result = await /** @type {any} */ (tool.execute)("test-2", { command: "show", path: "src/a.js" });
    assertStringIncludes(result.content[0].text, "new line");
    assertEquals(result.details.command, "show");
    assertEquals(result.details.path, "src/a.js");
});

Deno.test("review_diff tool reports error for missing path in show", async () => {
    const tool = createReviewDiffTool(SAMPLE_INLINE_DIFF);
    const result = await /** @type {any} */ (tool.execute)("test-3", { command: "show" });
    assertEquals(result.isError, true);
    assertStringIncludes(result.content[0].text, "required");
});

Deno.test("review_diff tool reports error for unknown command", async () => {
    const tool = createReviewDiffTool(SAMPLE_INLINE_DIFF);
    const result = await /** @type {any} */ (tool.execute)("test-4", { command: "unknown" });
    assertEquals(result.isError, true);
    assertStringIncludes(result.content[0].text, "unknown command");
});

Deno.test("review_diff tool reports not-found for nonexistent file", async () => {
    const tool = createReviewDiffTool(SAMPLE_INLINE_DIFF);
    const result = await /** @type {any} */ (tool.execute)("test-5", { command: "show", path: "nonexistent.js" });
    assertEquals(result.isError, true);
    assertStringIncludes(result.content[0].text, "not found");
});

Deno.test("review_diff tool returns no-files message for empty diff", async () => {
    const tool = createReviewDiffTool("");
    const result = await /** @type {any} */ (tool.execute)("test-6", { command: "list" });
    assertEquals(result.details.fileCount, 0);
    assertStringIncludes(result.content[0].text, "No changed files");
});

// ─── Large-diff / error-handling integration tests ──────────────────────────
