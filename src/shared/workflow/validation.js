/**
 * @module shared/workflow/validation
 * Mechanical and semantic validation for completed RunWield execution workflows.
 */

import { extractYaml } from "@std/front-matter";
import { dirname, fromFileUrl, join } from "@std/path";
import { AGENTS } from "../../constants.js";
import { formatGitRequiredMessage, isGitRepositoryRequiredError } from "../git.js";
import { getAgentDisplayName } from "../session/agents.js";
import { ensureBundledAgentDefFile } from "../session/agent-assets.js";
import { runAgentSession } from "../session/session.js";
import {
    getCodeReviewMode,
    getCustomSetting,
    getGuidedReviewMode,
    setCustomSetting,
    shouldCleanupMergedWorktrees,
} from "../settings.js";
import { readLatestReviewOutcome, readLatestTaskCompletedOutcome } from "./workflow.js";
import { switchActiveAgent } from "../session/agent-switching.js";
import {
    emitHostedSessionRuntimeEvent,
    emitSystemStatus,
    normalizeRuntimeToolResult,
    RuntimeEventTypes,
} from "../session/session-runtime-events.js";
import { describeRuntimeTool } from "../session/tool-event-title.js";
import { requestHostedSessionInteraction, RuntimeInteractionTypes } from "../session/session-runtime-interactions.js";
import { getWorkflowDiff } from "./git-snapshot.js";
import { recordPlanEvent, stageValidationPassedInExecutionWorktree } from "./plan-lifecycle.js";
import { recordWorkflowMetric } from "./metrics.js";
import {
    mergeExecutionWorktree,
    preparePrimaryPlanPathForMerge,
    removeExecutionWorktree,
    restorePrimaryPlanPathAfterMergeFailure,
} from "../worktree.js";
import {
    removeEntry as removeWorktreeRegistryEntry,
    updateEntry as updateWorktreeRegistryEntry,
} from "../worktree-registry.js";
import { buildGuidedReviewPolicy, recommendGuidedReview } from "./guided-review.js";
import { buildLargeDiffReviewPrompt, createReviewDiffTool } from "./review-diff-tool.js";

export const __dirname = dirname(fromFileUrl(import.meta.url));
const WORKFLOW_PROMPTS_DIR = "workflow-prompts";
const REVIEWER_PROMPT_FILE = "reviewer-prompt.md";
const MANUAL_QA_PROMPT_FILE = "manual-qa-prompt.md";
const VALIDATION_STREAM_OUTPUT_LIMIT_BYTES = 1024 * 1024;

/** @type {number} Maximum bytes of workflow diff to include inline in the reviewer prompt. */
const REVIEW_INLINE_DIFF_MAX_BYTES = 60 * 1024;

/**
 * @typedef {Object} CapturedProcessStream
 * @property {string} text
 * @property {number} totalBytes
 * @property {boolean} truncated
 */

/**
 * @param {Uint8Array<ArrayBufferLike>} left
 * @param {Uint8Array<ArrayBufferLike>} right
 * @returns {Uint8Array<ArrayBufferLike>}
 */
function concatBytes(left, right) {
    const combined = new Uint8Array(left.byteLength + right.byteLength);
    combined.set(left, 0);
    combined.set(right, left.byteLength);
    return combined;
}

/**
 * Read a process stream without using Deno.Command.output(), whose internal
 * buffer can throw before large-but-successful validation commands finish.
 * Retain the tail because build/test failures are usually reported last.
 *
 * @param {ReadableStream<Uint8Array>} stream
 * @param {number} limitBytes
 * @returns {Promise<CapturedProcessStream>}
 */
async function captureProcessStreamTail(stream, limitBytes) {
    const reader = stream.getReader();
    /** @type {Uint8Array<ArrayBufferLike>} */
    let retained = /** @type {Uint8Array<ArrayBufferLike>} */ (new Uint8Array(0));
    let totalBytes = 0;

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            totalBytes += value.byteLength;

            if (value.byteLength >= limitBytes) {
                retained = value.slice(value.byteLength - limitBytes);
                continue;
            }

            retained = concatBytes(retained, value);
            if (retained.byteLength > limitBytes) {
                retained = retained.slice(retained.byteLength - limitBytes);
            }
        }
    } finally {
        reader.releaseLock();
    }

    return {
        text: new TextDecoder().decode(retained),
        totalBytes,
        truncated: totalBytes > retained.byteLength,
    };
}

/**
 * @param {CapturedProcessStream} stdout
 * @param {CapturedProcessStream} stderr
 * @returns {string}
 */
function formatCapturedProcessOutput(stdout, stderr) {
    const output = `${stdout.text}\n${stderr.text}`;
    if (!stdout.truncated && !stderr.truncated) return output;

    const notices = [];
    if (stdout.truncated) {
        notices.push(
            `[RunWield] stdout truncated; showing last ${VALIDATION_STREAM_OUTPUT_LIMIT_BYTES} of ${stdout.totalBytes} bytes.`,
        );
    }
    if (stderr.truncated) {
        notices.push(
            `[RunWield] stderr truncated; showing last ${VALIDATION_STREAM_OUTPUT_LIMIT_BYTES} of ${stderr.totalBytes} bytes.`,
        );
    }
    return `${output}\n${notices.join("\n")}\n`;
}

/**
 * Load reviewer as a bare workflow prompt instead of a normal agent definition.
 * Normal agent definitions are wrapped with RunWield' shared system prompt, which
 * advertises skills, memory, and exploration tools. Semantic review is a
 * mechanical plan-vs-diff check, so it intentionally receives none of that by default.
 *
 * Every review gets the plan, diff context, and read-only repository exploration
 * tools (`read`, `grep`, `find`, `ls`). Large reviews additionally receive a
 * custom `review_diff` tool for bounded per-file diff inspection. Reviewer has
 * no memory tools so its judgment remains grounded in the supplied evidence.
 *
 * @param {(path: string) => Promise<string>} [readTextFile]
 * @param {typeof ensureBundledAgentDefFile} [ensurePromptFile]
 * @returns {Promise<import('../session/types.js').AgentDefinition>}
 */
export async function loadReviewerPrompt(
    readTextFile = Deno.readTextFile,
    ensurePromptFile = ensureBundledAgentDefFile,
) {
    const reviewerPromptPath = await ensurePromptFile(join(WORKFLOW_PROMPTS_DIR, REVIEWER_PROMPT_FILE));
    const raw = await readTextFile(reviewerPromptPath);
    const { attrs, body } = extractYaml(raw);
    const displayName = typeof attrs.name === "string" && attrs.name.trim() ? attrs.name.trim() : "Reviewer";
    const description = typeof attrs.description === "string" ? attrs.description.trim() : "";

    return {
        name: AGENTS.REVIEWER,
        displayName,
        model: "",
        description,
        tools: [],
        systemPrompt: body.trim(),
    };
}

/**
 * Load the post-verification Manual QA generator as a bare, tool-free prompt.
 *
 * @param {(path: string) => Promise<string>} [readTextFile]
 * @param {typeof ensureBundledAgentDefFile} [ensurePromptFile]
 * @returns {Promise<import('../session/types.js').AgentDefinition>}
 */
export async function loadManualQaPrompt(
    readTextFile = Deno.readTextFile,
    ensurePromptFile = ensureBundledAgentDefFile,
) {
    const promptPath = await ensurePromptFile(join(WORKFLOW_PROMPTS_DIR, MANUAL_QA_PROMPT_FILE));
    const raw = await readTextFile(promptPath);
    const { attrs, body } = extractYaml(raw);
    const displayName = typeof attrs.name === "string" && attrs.name.trim() ? attrs.name.trim() : "Manual QA";
    const description = typeof attrs.description === "string" ? attrs.description.trim() : "";

    return {
        name: AGENTS.ROUTER,
        displayName,
        model: "",
        description,
        tools: [],
        systemPrompt: body.trim(),
    };
}

/**
 * Run a transient, tool-free prompt that presents manual checks to the user
 * after automated verification succeeds.
 *
 * @param {Object} args
 * @param {import('../session/hosted-session.js').HostedSession} args.hostedSession
 * @param {string} args.name
 * @param {"QUICK_FIX"|"FEATURE"} args.classification
 * @param {string} args.context
 * @param {string} args.cwd
 * @param {{
 *   loadManualQaPrompt?: typeof loadManualQaPrompt,
 *   runAgentSession?: typeof runAgentSession,
 * }} [args.__deps]
 * @returns {Promise<import('@earendil-works/pi-agent-core').AgentMessage[]>}
 */
export async function runManualQaChecklistPrompt({
    hostedSession,
    name,
    classification,
    context,
    cwd,
    __deps,
}) {
    const loadPrompt = __deps?.loadManualQaPrompt || loadManualQaPrompt;
    const runAgentSessionImpl = __deps?.runAgentSession || runAgentSession;
    const agentDef = await loadPrompt();
    const userRequest = [
        "Prepare the post-verification checklist from this source material.",
        `Name: ${name}`,
        `Classification: ${classification}`,
        "",
        "### Source context",
        context,
    ].join("\n");

    return await runAgentSessionImpl({
        hostedSession,
        agentName: AGENTS.TESTER,
        userRequest,
        cwd,
        _agentDefOverride: agentDef,
        includeEditFallback: false,
        useRootSession: false,
    });
}

/**
 * Checklist generation is a post-verification handoff. A model failure should
 * be visible, but must not retroactively fail successful validation.
 *
 * @param {Object} args
 * @param {import('../session/hosted-session.js').HostedSession} args.hostedSession
 * @param {string} args.name
 * @param {"QUICK_FIX"|"FEATURE"} args.classification
 * @param {string} args.context
 * @param {string} args.cwd
 * @param {typeof runManualQaChecklistPrompt} args.runPrompt
 * @returns {Promise<void>}
 */
async function presentManualQaChecklist({ hostedSession, name, classification, context, cwd, runPrompt }) {
    try {
        await runPrompt({ hostedSession, name, classification, context, cwd });
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        emitRunWieldSystemStatus(
            hostedSession,
            `Automated verification passed, but the manual QA checklist could not be generated: ${reason}`,
            true,
        );
    }
}

/**
 * @param {import('../session/hosted-session.js').HostedSession} hostedSession
 * @param {string} projectRoot
 *
 * @returns {Promise<string>}
 */
async function getOrAskForValidationCommand(hostedSession, projectRoot) {
    const existingCommand = getCustomSetting("verification_command", "project", projectRoot);
    if (existingCommand) {
        return /** @type {string} */ (existingCommand);
    }

    emitSystemStatus(hostedSession, "No validation command found in project settings.");
    const response = await requestHostedSessionInteraction(hostedSession, {
        type: RuntimeInteractionTypes.TEXT,
        prompt: "Enter the command to validate this project (e.g., 'deno task ci', 'npm test'): ",
        allowEmpty: false,
    });
    const userInput = response.outcome === "text" ? String(response.value || "") : "";

    if (!userInput) {
        return "";
    }

    const newCommand = userInput.trim();
    await setCustomSetting("verification_command", newCommand, "project", projectRoot);

    emitSystemStatus(hostedSession, `Saved validation command: '${newCommand}'`);
    return newCommand;
}

/**
 * Spawns the local validation step.
 *
 * @typedef {Object} LocalCIResult
 * @property {number} exitCode
 * @property {string} output
 * @property {boolean} [canceled]
 */

/**
 * @param {{ hostedSession: import('../session/hosted-session.js').HostedSession, cwd: string }} options
 *
 * @returns {Promise<LocalCIResult>}
 */
export async function runLocalCI({ hostedSession, cwd }) {
    if (!cwd) throw new Error("runLocalCI: cwd is required");
    if (!hostedSession) throw new Error("runLocalCI: hostedSession is required");
    const cmdArgs = await getOrAskForValidationCommand(hostedSession, cwd);

    if (!cmdArgs) {
        return {
            exitCode: 1,
            output:
                "RunWield could not auto-detect a build or test command for this repository. Please explore the project and manually run the appropriate compilation or linting commands to validate your changes.",
        };
    }

    const toolCallId = `validation-ci-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const interactionId = `validation-ci:${toolCallId}`;
    const abortController = new AbortController();
    /** @type {Deno.ChildProcess | null} */
    let child = null;
    let canceled = false;
    const abortValidationProcess = () => {
        canceled = true;
        try {
            child?.kill();
        } catch (_e) {
            // Process may have already exited.
        }
    };
    abortController.signal.addEventListener("abort", abortValidationProcess, { once: true });
    hostedSession.addActiveInteraction(interactionId, { abortController });
    const runtimeTool = describeRuntimeTool("bash", { command: cmdArgs });

    emitHostedSessionRuntimeEvent(hostedSession, {
        type: RuntimeEventTypes.TOOL_START,
        toolCallId,
        ...runtimeTool,
        args: { command: cmdArgs },
    });
    const startTime = Date.now();

    try {
        const isWindows = Deno.build.os === "windows";
        const cmdExe = isWindows ? "cmd" : "sh";
        const cmdFlag = isWindows ? "/c" : "-c";

        const command = new Deno.Command(cmdExe, {
            args: [cmdFlag, cmdArgs],
            cwd,
            stdout: "piped",
            stderr: "piped",
        });

        child = command.spawn();
        const [status, stdout, stderr] = await Promise.all([
            child.status,
            captureProcessStreamTail(child.stdout, VALIDATION_STREAM_OUTPUT_LIMIT_BYTES),
            captureProcessStreamTail(child.stderr, VALIDATION_STREAM_OUTPUT_LIMIT_BYTES),
        ]);
        const output = canceled
            ? `${formatCapturedProcessOutput(stdout, stderr)}\nValidation canceled.\n`
            : formatCapturedProcessOutput(stdout, stderr);
        const durationMs = Date.now() - startTime;
        const isError = canceled || status.code !== 0;

        emitHostedSessionRuntimeEvent(hostedSession, {
            type: RuntimeEventTypes.TOOL_END,
            toolCallId,
            ...runtimeTool,
            ...normalizeRuntimeToolResult(output.trim() ? output : "(no output)\n"),
            isError,
            durationMs,
        });

        return {
            exitCode: canceled ? 130 : status.code,
            output,
            ...(canceled ? { canceled: true } : {}),
        };
    } catch (/** @type {any} */ error) {
        const output = canceled ? "Validation canceled." : `Failed to spawn validation process: ${error.message}`;
        const durationMs = Date.now() - startTime;
        emitHostedSessionRuntimeEvent(hostedSession, {
            type: RuntimeEventTypes.TOOL_END,
            toolCallId,
            ...runtimeTool,
            ...normalizeRuntimeToolResult(`${output}\n`),
            isError: true,
            durationMs,
        });
        return {
            exitCode: canceled ? 130 : 1,
            output,
            ...(canceled ? { canceled: true } : {}),
        };
    } finally {
        abortController.signal.removeEventListener("abort", abortValidationProcess);
        hostedSession.removeActiveInteraction(interactionId);
    }
}

/**
 * @param {import('../session/hosted-session.js').HostedSession | undefined} hostedSession
 * @param {string} agentName
 * @returns {unknown[]}
 */
function getRootMessages(hostedSession, agentName) {
    if (hostedSession?.getRootAgentName?.() !== agentName) return [];
    const rootSession = hostedSession?.getRootAgentSession?.();
    const messages = /** @type {{ agent?: { state?: { messages?: unknown[] } } } | undefined} */ (rootSession)?.agent
        ?.state
        ?.messages;
    return Array.isArray(messages) ? messages : [];
}

/**
 * @param {unknown} left
 * @param {unknown} right
 * @returns {boolean}
 */
function isSameMessage(left, right) {
    if (left === right) return true;
    try {
        return JSON.stringify(left) === JSON.stringify(right);
    } catch {
        return false;
    }
}

/**
 * @param {unknown[]} messages
 * @param {unknown[]} prefix
 * @returns {boolean}
 */
function startsWithMessages(messages, prefix) {
    return prefix.every((message, index) => isSameMessage(messages[index], message));
}

/**
 * @param {Object} args
 * @param {string} args.agentName
 * @param {string} args.userRequest
 * @param {Array<{base64: string, mimeType: string}>} [args.images]
 * @param {import('@earendil-works/pi-coding-agent').SessionManager | undefined} args.sessionManager
 * @param {string} [args.cwd]
 * @param {import('../session/hosted-session.js').HostedSession} args.hostedSession
 * @param {typeof runAgentSession} [args.runAgentSession]
 * @param {typeof readLatestTaskCompletedOutcome} [args.readLatestTaskCompletedOutcome]
 * @returns {Promise<boolean>}
 */
async function runCompletionGatedRepair({
    agentName,
    userRequest,
    images = [],
    sessionManager,
    cwd,
    hostedSession,
    runAgentSession: runAgentSessionImpl = runAgentSession,
    readLatestTaskCompletedOutcome: readTaskCompleted = readLatestTaskCompletedOutcome,
}) {
    const previousRootMessages = getRootMessages(hostedSession, agentName).slice();
    const fromIndex = previousRootMessages.length;
    const messages = await runAgentSessionImpl({
        hostedSession,
        agentName,
        userRequest,
        images,
        sessionManager,
        cwd,
        useRootSession: true,
    });

    const returnedRootTranscript = startsWithMessages(messages, previousRootMessages);
    return readTaskCompleted(messages, returnedRootTranscript ? fromIndex : undefined);
}

/**
 * @param {string | undefined} baselineTree
 * @param {string} [cwd]
 * @returns {Promise<string>}
 */
async function getGitDiffText(baselineTree, cwd) {
    if (!cwd) throw new Error("getGitDiffText: cwd is required");
    return await getWorkflowDiff(cwd, baselineTree);
}

/**
 * @typedef {"not_required" | "skipped" | "approved"} HumanReviewDecision
 */

/**
 * @typedef {Object} HumanReviewMetadata
 * @property {"none" | "ask" | "always"} humanReviewMode
 * @property {HumanReviewDecision} humanReviewDecision
 * @property {string | null} humanReviewedAt
 */

/**
 * @param {import('../session/hosted-session.js').HostedSession} hostedSession
 * @param {string} reason
 * @returns {Promise<"retry" | "stop">}
 */
async function promptForMergeFailureAction(hostedSession, reason) {
    const response = await requestHostedSessionInteraction(hostedSession, {
        type: RuntimeInteractionTypes.SELECT,
        prompt:
            `Worktree merge failed:\n${reason}\n\nResolve and stage the conflicts, or run git merge --abort, then retry.`,
        options: [
            { value: "retry", label: "Retry/continue merge" },
            { value: "stop", label: "Stop" },
        ],
    });
    return response.outcome === "selected" && response.value === "retry" ? "retry" : "stop";
}

/**
 * @param {unknown} error
 * @returns {string | undefined}
 */
function getMergeRepairCwd(error) {
    if (error && typeof error === "object" && "repairCwd" in error) {
        const repairCwd = /** @type {{ repairCwd?: unknown }} */ (error).repairCwd;
        return typeof repairCwd === "string" ? repairCwd : undefined;
    }
    return undefined;
}

/**
 * @param {unknown} error
 * @returns {string | undefined}
 */
function getMergeWorktreePath(error) {
    if (error && typeof error === "object" && "mergeWorktreePath" in error) {
        const mergeWorktreePath = /** @type {{ mergeWorktreePath?: unknown }} */ (error).mergeWorktreePath;
        return typeof mergeWorktreePath === "string" ? mergeWorktreePath : undefined;
    }
    return undefined;
}

/**
 * @param {unknown} error
 * @returns {string | undefined}
 */
function getMergeFailureKind(error) {
    if (error && typeof error === "object" && "mergeFailureKind" in error) {
        const kind = /** @type {{ mergeFailureKind?: unknown }} */ (error).mergeFailureKind;
        return typeof kind === "string" ? kind : undefined;
    }
    return undefined;
}

/**
 * @param {string} cwd
 * @returns {Promise<string | undefined>}
 */
async function getGitStatusContext(cwd) {
    try {
        const command = new Deno.Command("git", { args: ["status", "--short"], cwd, stdout: "piped", stderr: "piped" });
        const output = await command.output();
        if (output.code !== 0) return undefined;
        const status = new TextDecoder().decode(output.stdout).trim();
        return status || "(clean)";
    } catch {
        return undefined;
    }
}

/**
 * @param {string} cwd
 * @param {string[]} args
 * @returns {Promise<{ exitCode: number, stdout: string, stderr: string }>}
 */
async function runGitForMergeVerification(cwd, args) {
    const command = new Deno.Command("git", { args, cwd, stdout: "piped", stderr: "piped" });
    const output = await command.output();
    const decoder = new TextDecoder();
    return {
        exitCode: output.code,
        stdout: decoder.decode(output.stdout),
        stderr: decoder.decode(output.stderr),
    };
}

/**
 * @typedef {Object} MergeVerificationResult
 * @property {boolean} merged
 * @property {string} message
 */

/**
 * @param {Object} opts
 * @param {string} opts.projectRoot
 * @param {string} opts.worktreeBranch
 * @param {string | undefined} opts.worktreeBaseBranch
 * @returns {Promise<MergeVerificationResult>}
 */
async function verifyExecutionWorktreeMerged({ projectRoot, worktreeBranch, worktreeBaseBranch }) {
    try {
        const targetRef = worktreeBaseBranch ? `refs/heads/${worktreeBaseBranch}` : "HEAD";
        const branchResult = await runGitForMergeVerification(projectRoot, ["rev-parse", "--verify", worktreeBranch]);
        if (branchResult.exitCode !== 0) {
            return {
                merged: false,
                message: `Could not verify execution branch ${worktreeBranch}: ${branchResult.stderr.trim()}`,
            };
        }

        const targetResult = await runGitForMergeVerification(projectRoot, ["rev-parse", "--verify", targetRef]);
        if (targetResult.exitCode !== 0) {
            return {
                merged: false,
                message: `Could not verify merge target ${targetRef}: ${targetResult.stderr.trim()}`,
            };
        }

        const ancestorResult = await runGitForMergeVerification(projectRoot, [
            "merge-base",
            "--is-ancestor",
            worktreeBranch,
            targetRef,
        ]);
        if (ancestorResult.exitCode === 0) {
            return { merged: true, message: `${worktreeBranch} is contained in ${targetRef}.` };
        }

        const detail = (ancestorResult.stderr || ancestorResult.stdout).trim();
        return {
            merged: false,
            message: detail
                ? `${worktreeBranch} is not verified as merged into ${targetRef}: ${detail}`
                : `${worktreeBranch} is not verified as merged into ${targetRef}.`,
        };
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return { merged: false, message: `Could not run merge verification: ${reason}` };
    }
}

/**
 * @param {Object} opts
 * @param {string} opts.planName
 * @param {string} opts.reason
 * @param {string | undefined} opts.executionCwd
 * @param {string | undefined} opts.worktreeBranch
 * @param {string | undefined} opts.worktreeBaseBranch
 * @param {string} opts.currentPlanStatus
 * @param {string | undefined} opts.diffContext
 * @param {string | undefined} opts.gitStatusContext
 * @param {string | undefined} opts.repairCwd
 * @param {string | undefined} opts.mergeFailureKind
 * @returns {string}
 */
function buildMergeRepairRequest({
    planName,
    reason,
    executionCwd,
    worktreeBranch,
    worktreeBaseBranch,
    currentPlanStatus,
    diffContext,
    gitStatusContext,
    repairCwd,
    mergeFailureKind,
}) {
    return [
        `Worktree merge-back failed for plan ${planName}.`,
        "Fix the merge/conflict state or make the merge retryable, then call task_completed.",
        "Do not expand scope beyond resolving this merge-back failure.",
        "",
        `Failure reason:\n${reason}`,
        "",
        `Execution worktree path: ${executionCwd || "(unknown)"}`,
        `Execution worktree branch: ${worktreeBranch || "(unknown)"}`,
        `Current plan status: ${currentPlanStatus}`,
        `Recorded target branch: ${worktreeBaseBranch || "(unknown; legacy current-checkout fallback)"}`,
        `Repair cwd: ${repairCwd || executionCwd || "(project root)"}`,
        `Merge path: ${
            mergeFailureKind === "detached_merge_conflict"
                ? "detached merge worktree"
                : "checked-out/current checkout fallback or unknown"
        }`,
        `Merge failure kind: ${mergeFailureKind || "unknown"}`,
        gitStatusContext ? `Git status context:\n${gitStatusContext}` : "Git status context: (unavailable)",
        diffContext
            ? `Diff/context:
${diffContext}`
            : "Diff/context: (unavailable)",
        "",
        "Expected repair:",
        "- Inspect git status/conflicts in the repair cwd.",
        "- Resolve and stage conflicts, or abort/reset the failed merge state and adjust the execution branch so merge-back can retry cleanly.",
        "- Run appropriate verification for the repair.",
        "- Call task_completed when the merge repair is ready for RunWield to retry merge-back.",
    ].join("\n");
}

/**
 * @param {import('../session/hosted-session.js').HostedSession | undefined} hostedSession
 * @param {string} text
 * @param {"info" | "success" | "warning" | "error" | boolean} [level]
 */
function emitRunWieldSystemStatus(hostedSession, text, level = "info") {
    const resolvedLevel = level === true ? "error" : level === false ? "info" : level;
    emitSystemStatus(hostedSession, text, {
        level: resolvedLevel,
        header: "RunWield",
    });
}

/**
 * @param {Array<{file?: string, path?: string, filePath?: string, line?: number, text?: string, comment?: string}>} annotations
 */
function formatCodeReviewAnnotations(annotations) {
    return annotations.map((annotation, index) => {
        const file = annotation.file || annotation.path || annotation.filePath || "unknown file";
        const line = typeof annotation.line === "number" ? `:${annotation.line}` : "";
        const text = annotation.text || annotation.comment || "";
        return `${index + 1}. ${file}${line}${text ? `\n${text}` : ""}`;
    }).join("\n\n");
}

/**
 * @param {string} path
 * @param {string} planName
 * @returns {boolean}
 */
function isPlanDocumentPath(path, planName) {
    return path === `plans/${planName}.md` || /^plans\/[^/]+\.md$/.test(path);
}

/**
 * @param {string} diffText
 * @returns {string[]}
 */
function extractDiffPaths(diffText) {
    /** @type {string[]} */
    const paths = [];
    const diffHeaderPattern = /^diff --git a\/(.+?) b\/(.+)$/gm;
    let match;

    while ((match = diffHeaderPattern.exec(diffText)) !== null) {
        paths.push(match[1], match[2]);
    }

    return paths;
}

/**
 * @param {string} diffText
 * @param {string} planName
 * @returns {boolean}
 */
function hasImplementationDiff(diffText, planName) {
    if (!diffText.trim()) {
        return false;
    }

    const diffPaths = extractDiffPaths(diffText);
    if (diffPaths.length === 0) {
        return true;
    }

    return diffPaths.some((path) => !isPlanDocumentPath(path, planName));
}

/**
 * @param {import('../../tools/plan-written.js').TriageMeta} triageMeta
 * @returns {boolean}
 */
function requiresImplementationDiff(triageMeta) {
    return triageMeta?.classification === "FEATURE" || triageMeta?.classification === "PROJECT";
}

/**
 * @param {import('../../tools/plan-written.js').TriageMeta} triageMeta
 * @returns {boolean}
 */
export function shouldRunWorkflowValidation(triageMeta) {
    return triageMeta?.classification === "FEATURE" || triageMeta?.classification === "PROJECT";
}

/**
 * No-plan Mechanical Validation for direct QUICK_FIX work. Runs configured local
 * CI and sends failures back to Engineer, without Plan lifecycle, semantic
 * review, code review, implementation diff checks, worktree merge-back, or
 * worktree registry updates.
 *
 * @param {Object} args
 * @param {import('@earendil-works/pi-coding-agent').SessionManager | undefined} args.sessionManager
 * @param {import('../session/hosted-session.js').HostedSession} [args.hostedSession]
 * @param {string} [args.cwd]
 * @param {string} [args.manualQaName]
 * @param {string} [args.manualQaContext]
 * @param {{
 *   runLocalCI?: typeof runLocalCI,
 *   runAgentSession?: typeof runAgentSession,
 *   runCompletionGatedRepair?: typeof runCompletionGatedRepair,
 *   runManualQaChecklistPrompt?: typeof runManualQaChecklistPrompt,
 *   readLatestTaskCompletedOutcome?: typeof readLatestTaskCompletedOutcome,
 *   switchActiveAgent?: typeof switchActiveAgent,
 *   recordWorkflowMetric?: typeof recordWorkflowMetric,
 * }} [args.__deps] Test-only injection point.
 * @returns {Promise<{ passed: boolean, attempts: number, reason?: string }>}
 */
export async function runMechanicalValidation({
    sessionManager,
    hostedSession,
    cwd,
    manualQaName = "quick-fix",
    manualQaContext = "The QUICK_FIX implementation completed and passed automated verification.",
    __deps,
}) {
    if (!hostedSession) throw new Error("runMechanicalValidation: hostedSession is required");
    const projectRoot = hostedSession?.cwd || cwd;
    if (!projectRoot) throw new Error("runMechanicalValidation: hostedSession or cwd is required");
    const validationCwd = cwd || hostedSession?.getActiveExecutionCwd?.() || projectRoot;
    const runLocalCIImpl = __deps?.runLocalCI || runLocalCI;
    const runAgentSessionImpl = __deps?.runAgentSession || runAgentSession;
    const repair = __deps?.runCompletionGatedRepair ||
        ((repairArgs) =>
            runCompletionGatedRepair({
                ...repairArgs,
                runAgentSession: runAgentSessionImpl,
                readLatestTaskCompletedOutcome: __deps?.readLatestTaskCompletedOutcome,
                hostedSession,
            }));
    const switchActiveAgentImpl = __deps?.switchActiveAgent || switchActiveAgent;
    const runManualQaChecklistPromptImpl = __deps?.runManualQaChecklistPrompt || runManualQaChecklistPrompt;
    const recordWorkflowMetricSource = __deps?.recordWorkflowMetric || recordWorkflowMetric;
    /**
     * @param {Parameters<typeof recordWorkflowMetricSource>[0]} metric
     * @param {Parameters<typeof recordWorkflowMetricSource>[1]} [deps]
     */
    function recordWorkflowMetricImpl(metric, deps = {}) {
        return recordWorkflowMetricSource(metric, { cwd: projectRoot, ...deps });
    }
    /** @param {string} agentName */
    const activateAgent = async (agentName) => {
        if (!hostedSession) return;
        await switchActiveAgentImpl(hostedSession, { agentName });
    };
    const maxRepairAttempts = 3;
    let repairAttempts = 0;

    await recordWorkflowMetricImpl({
        category: "validation",
        event: "mechanical_validation_started",
        planName: "quick-fix",
        details: { maxRepairAttempts },
    });
    emitRunWieldSystemStatus(hostedSession, "Starting QUICK_FIX Mechanical Validation.");

    while (true) {
        emitRunWieldSystemStatus(
            hostedSession,
            `Running QUICK_FIX CI Validation (Repair Attempts ${repairAttempts}/${maxRepairAttempts})...`,
        );
        const ciResult = await runLocalCIImpl({ hostedSession, cwd: validationCwd });

        await recordWorkflowMetricImpl({
            category: "validation",
            event: "mechanical_ci_attempt",
            planName: "quick-fix",
            details: {
                attempt: repairAttempts + 1,
                exitCode: ciResult.exitCode,
                passed: ciResult.exitCode === 0,
                canceled: ciResult.canceled === true,
            },
        });
        if (ciResult.canceled) {
            const reason = "QUICK_FIX Mechanical Validation canceled. Staying with Engineer so messages can continue.";
            emitRunWieldSystemStatus(hostedSession, reason, false);
            await recordWorkflowMetricImpl({
                category: "validation",
                event: "mechanical_validation_finished",
                planName: "quick-fix",
                details: { passed: false, canceled: true, attempts: repairAttempts },
            });
            await activateAgent(AGENTS.ENGINEER);
            return { passed: false, attempts: repairAttempts, reason: "canceled" };
        }
        if (ciResult.exitCode === 0) {
            emitRunWieldSystemStatus(
                hostedSession,
                "QUICK_FIX Mechanical Validation passed.",
                "success",
            );
            await recordWorkflowMetricImpl({
                category: "validation",
                event: "mechanical_validation_finished",
                planName: "quick-fix",
                details: { passed: true, attempts: repairAttempts },
            });
            await presentManualQaChecklist({
                hostedSession,
                name: manualQaName,
                classification: "QUICK_FIX",
                context: manualQaContext,
                cwd: validationCwd,
                runPrompt: runManualQaChecklistPromptImpl,
            });
            await activateAgent(AGENTS.ENGINEER);
            return { passed: true, attempts: repairAttempts };
        }

        if (repairAttempts >= maxRepairAttempts) {
            const reason =
                `QUICK_FIX Mechanical Validation failed after ${maxRepairAttempts} Engineer repair attempts.`;
            emitRunWieldSystemStatus(hostedSession, reason, true);
            await recordWorkflowMetricImpl({
                category: "validation",
                event: "mechanical_validation_finished",
                planName: "quick-fix",
                details: { passed: false, attempts: repairAttempts, reason: "max_repair_attempts" },
            });
            await activateAgent(AGENTS.ENGINEER);
            return { passed: false, attempts: repairAttempts, reason };
        }

        repairAttempts++;
        await recordWorkflowMetricImpl({
            category: "validation",
            event: "mechanical_repair_dispatched",
            agentName: AGENTS.ENGINEER,
            planName: "quick-fix",
            details: { repairAttempt: repairAttempts },
        });
        emitRunWieldSystemStatus(
            hostedSession,
            `QUICK_FIX CI failed. Dispatching ${
                getAgentDisplayName(AGENTS.ENGINEER, projectRoot)
            } for repair attempt ${repairAttempts}/${maxRepairAttempts}...`,
            true,
        );
        const completed = await repair({
            agentName: AGENTS.ENGINEER,
            userRequest:
                "The no-plan QUICK_FIX failed Mechanical Validation. Fix the following CI errors, do not expand scope, " +
                "run appropriate verification, then call task_completed when the repair is complete:\n\n" +
                ciResult.output,
            sessionManager,
            cwd: validationCwd,
            hostedSession,
        });
        await recordWorkflowMetricImpl({
            category: "validation",
            event: "mechanical_repair_completed",
            agentName: AGENTS.ENGINEER,
            planName: "quick-fix",
            details: { repairAttempt: repairAttempts, taskCompletedObserved: Boolean(completed) },
        });
        if (!completed) {
            const reason = `${
                getAgentDisplayName(AGENTS.ENGINEER, projectRoot)
            } stopped without task_completed during QUICK_FIX repair.`;
            emitRunWieldSystemStatus(
                hostedSession,
                `${reason} Staying with ${
                    getAgentDisplayName(AGENTS.ENGINEER, projectRoot)
                } so the user can continue the session. ` +
                    "Mechanical Validation will resume after task_completed.",
                true,
            );
            await recordWorkflowMetricImpl({
                category: "validation",
                event: "mechanical_validation_finished",
                planName: "quick-fix",
                details: { passed: false, attempts: repairAttempts, reason: "repair_without_task_completed" },
            });
            hostedSession?.setActiveExecutionWorkflow({
                planName: "quick-fix",
                triageMeta: { classification: "QUICK_FIX" },
                executionCwd: validationCwd,
                validationContinuation: true,
                manualQaName,
                manualQaContext,
            });
            await activateAgent(AGENTS.ENGINEER);
            return { passed: false, attempts: repairAttempts, reason };
        }
    }
}

/**
 * Unified validation loop. Runs local validation and semantic code review.
 *
 * @param {Object} args
 * @param {string} args.planName
 * @param {string} args.planContent
 * @param {import('../../tools/plan-written.js').TriageMeta} args.triageMeta
 * @param {import('@earendil-works/pi-coding-agent').SessionManager | undefined} args.sessionManager
 * @param {import('../session/hosted-session.js').HostedSession} args.hostedSession
 * @param {string | undefined} [args.finalAgentName] Agent to restore after router-started or direct workflows.
 * @param {{
 *   runLocalCI?: typeof runLocalCI,
 *   runAgentSession?: typeof runAgentSession,
 *   runCompletionGatedRepair?: typeof runCompletionGatedRepair,
 *   runManualQaChecklistPrompt?: typeof runManualQaChecklistPrompt,
 *   readLatestTaskCompletedOutcome?: typeof readLatestTaskCompletedOutcome,
 *   getDiffText?: typeof getGitDiffText,
 *   recordPlanEvent?: typeof recordPlanEvent,
 *   stageValidationPassedInExecutionWorktree?: typeof stageValidationPassedInExecutionWorktree,
 *   preparePrimaryPlanPathForMerge?: typeof preparePrimaryPlanPathForMerge,
 *   restorePrimaryPlanPathAfterMergeFailure?: typeof restorePrimaryPlanPathAfterMergeFailure,
 *   mergeExecutionWorktree?: typeof mergeExecutionWorktree,
 *   removeExecutionWorktree?: typeof removeExecutionWorktree,
 *   removeWorktreeRegistryEntry?: typeof removeWorktreeRegistryEntry,
 *   updateWorktreeRegistryEntry?: typeof updateWorktreeRegistryEntry,
 *   switchActiveAgent?: typeof switchActiveAgent,
 *   loadReviewerPrompt?: typeof loadReviewerPrompt,
 *   shouldCleanupMergedWorktrees?: typeof shouldCleanupMergedWorktrees,
 *   getCodeReviewMode?: typeof getCodeReviewMode,
 *   requestInteraction?: typeof requestHostedSessionInteraction,
 *   getGuidedReviewMode?: typeof getGuidedReviewMode,
 *   verifyExecutionWorktreeMerged?: typeof verifyExecutionWorktreeMerged,
 *   recordWorkflowMetric?: typeof recordWorkflowMetric,
 * }} [args.__deps] Test-only injection point.
 */
export async function runValidationLoop({
    planName,
    planContent,
    triageMeta,
    sessionManager,
    hostedSession,
    finalAgentName,
    __deps,
}) {
    if (!hostedSession) throw new Error("runValidationLoop: hostedSession is required");
    const runLocalCIImpl = __deps?.runLocalCI || runLocalCI;
    const runAgentSessionImpl = __deps?.runAgentSession || runAgentSession;
    const repair = __deps?.runCompletionGatedRepair ||
        ((args) =>
            runCompletionGatedRepair({
                ...args,
                runAgentSession: runAgentSessionImpl,
                readLatestTaskCompletedOutcome: __deps?.readLatestTaskCompletedOutcome,
                hostedSession,
            }));
    const getDiffText = __deps?.getDiffText || getGitDiffText;
    const recordPlanEventImpl = __deps?.recordPlanEvent || recordPlanEvent;
    const stageValidationPassedImpl = __deps?.stageValidationPassedInExecutionWorktree ||
        stageValidationPassedInExecutionWorktree;
    const preparePrimaryPlanPathImpl = __deps?.preparePrimaryPlanPathForMerge || preparePrimaryPlanPathForMerge;
    const restorePrimaryPlanPathImpl = __deps?.restorePrimaryPlanPathAfterMergeFailure ||
        restorePrimaryPlanPathAfterMergeFailure;
    const mergeExecutionWorktreeImpl = __deps?.mergeExecutionWorktree || mergeExecutionWorktree;
    const removeExecutionWorktreeImpl = __deps?.removeExecutionWorktree || removeExecutionWorktree;
    const removeWorktreeRegistryEntryImpl = __deps?.removeWorktreeRegistryEntry || removeWorktreeRegistryEntry;
    const updateWorktreeRegistryEntryImpl = __deps?.updateWorktreeRegistryEntry || updateWorktreeRegistryEntry;
    const loadReviewerPromptImpl = __deps?.loadReviewerPrompt || loadReviewerPrompt;
    const shouldCleanupMergedWorktreesImpl = __deps?.shouldCleanupMergedWorktrees || shouldCleanupMergedWorktrees;
    const getCodeReviewModeImpl = __deps?.getCodeReviewMode || getCodeReviewMode;
    const requestInteraction = __deps?.requestInteraction || requestHostedSessionInteraction;
    const getGuidedReviewModeImpl = __deps?.getGuidedReviewMode || getGuidedReviewMode;
    const verifyExecutionWorktreeMergedImpl = __deps?.verifyExecutionWorktreeMerged || verifyExecutionWorktreeMerged;
    const recordWorkflowMetricSource = __deps?.recordWorkflowMetric || recordWorkflowMetric;
    const activeWorkflow = hostedSession?.getActiveExecutionWorkflow?.() || null;
    const baselineTree = activeWorkflow?.baselineTree;
    const projectRoot = activeWorkflow?.projectRoot || hostedSession?.cwd;
    if (!projectRoot) throw new Error("runValidationLoop: hostedSession or active workflow projectRoot is required");
    const executionCwd = activeWorkflow?.executionCwd || hostedSession?.cwd || projectRoot;
    /**
     * @param {Parameters<typeof recordWorkflowMetricSource>[0]} metric
     * @param {Parameters<typeof recordWorkflowMetricSource>[1]} [deps]
     */
    function recordWorkflowMetricImpl(metric, deps = {}) {
        return recordWorkflowMetricSource(metric, { cwd: projectRoot, ...deps });
    }
    const worktreeBranch = activeWorkflow?.worktreeBranch;
    const worktreeBaseBranch = activeWorkflow?.worktreeBaseBranch;
    const worktreeId = activeWorkflow?.worktreeId;
    const nonGitInPlace = activeWorkflow?.nonGitInPlace === true;
    if (activeWorkflow) {
        hostedSession?.clearActiveExecutionWorkflow();
    }
    const switchActiveAgentImpl = __deps?.switchActiveAgent || switchActiveAgent;
    const runManualQaChecklistPromptImpl = __deps?.runManualQaChecklistPrompt || runManualQaChecklistPrompt;
    /** @param {string} reason */
    const pauseForEngineerContinuation = async (reason) => {
        emitRunWieldSystemStatus(
            hostedSession,
            `${reason} Staying with ${
                getAgentDisplayName(AGENTS.ENGINEER, projectRoot)
            } so the user can continue the session. ` +
                "Validation will resume after task_completed.",
            true,
        );
        if (hostedSession) {
            hostedSession.setActiveExecutionWorkflow({
                ...(activeWorkflow || {}),
                planName,
                triageMeta,
                executionCwd,
                validationContinuation: true,
            });
            await switchActiveAgentImpl(hostedSession, { agentName: AGENTS.ENGINEER });
        }
    };
    let executionComplete = false;
    let latestDiffText = "";
    /** @type {string | null} */
    let haltReason = null;
    /** @type {HumanReviewMetadata | null} */
    let humanReviewMetadata = null;
    let validationCycles = 0;
    const MAX_VALIDATION_CYCLES = 3;

    await recordWorkflowMetricImpl({
        category: "validation",
        event: "workflow_validation_started",
        planName,
        details: { classification: triageMeta?.classification, hasWorktree: Boolean(worktreeBranch) },
    });

    while (!executionComplete && !haltReason && validationCycles < MAX_VALIDATION_CYCLES) {
        validationCycles++;
        await recordWorkflowMetricImpl({
            category: "validation",
            event: "validation_cycle_started",
            planName,
            details: { validationCycle: validationCycles, maxValidationCycles: MAX_VALIDATION_CYCLES },
        });
        emitRunWieldSystemStatus(
            hostedSession,
            `Starting Validation Cycle ${validationCycles}/${MAX_VALIDATION_CYCLES}`,
        );

        let buildPasses = false;
        let mechanicalAttempts = 0;

        while (!buildPasses && mechanicalAttempts < 3) {
            mechanicalAttempts++;
            emitRunWieldSystemStatus(hostedSession, `Running CI Validation (Attempt ${mechanicalAttempts}/3)...`);
            const ciResult = await runLocalCIImpl({ hostedSession, cwd: executionCwd });

            await recordWorkflowMetricImpl({
                category: "validation",
                event: "ci_attempt",
                planName,
                details: {
                    validationCycle: validationCycles,
                    mechanicalAttempt: mechanicalAttempts,
                    exitCode: ciResult.exitCode,
                    passed: ciResult.exitCode === 0,
                    canceled: ciResult.canceled === true,
                },
            });
            if (ciResult.canceled) {
                await pauseForEngineerContinuation("CI validation canceled.");
                return;
            }
            if (ciResult.exitCode === 0) {
                buildPasses = true;
                emitRunWieldSystemStatus(hostedSession, "Build and tests passed.", "success");
            } else {
                emitRunWieldSystemStatus(
                    hostedSession,
                    `Build failed. Dispatching ${
                        getAgentDisplayName(AGENTS.ENGINEER, projectRoot)
                    } to fix syntax/types...`,
                    true,
                );
                await recordWorkflowMetricImpl({
                    category: "validation",
                    event: "repair_dispatched",
                    agentName: AGENTS.OPERATOR,
                    planName,
                    details: { repairKind: "ci", validationCycle: validationCycles, attempt: mechanicalAttempts },
                });
                const completed = await repair({
                    hostedSession,
                    agentName: AGENTS.ENGINEER,
                    userRequest:
                        "The project failed CI validation. Fix the following build errors, then call task_completed " +
                        `when the repair is complete:\n\n${ciResult.output}`,
                    sessionManager,
                    cwd: executionCwd,
                });
                await recordWorkflowMetricImpl({
                    category: "validation",
                    event: "repair_completed",
                    agentName: AGENTS.OPERATOR,
                    planName,
                    details: {
                        repairKind: "ci",
                        validationCycle: validationCycles,
                        attempt: mechanicalAttempts,
                        taskCompletedObserved: Boolean(completed),
                    },
                });
                if (!completed) {
                    await pauseForEngineerContinuation(
                        `${
                            getAgentDisplayName(AGENTS.ENGINEER, projectRoot)
                        } stopped without task_completed during CI repair.`,
                    );
                    return;
                }
            }
        }

        if (!buildPasses) {
            haltReason ||= "CI validation failed after 3 repair attempts.";
            break;
        }

        if (nonGitInPlace) {
            emitRunWieldSystemStatus(
                hostedSession,
                "Git is not available for this project. RunWield cannot compute a Git diff, so automated Semantic Code Review and human diff review are skipped for this in-place execution.",
                true,
            );
            humanReviewMetadata = {
                humanReviewMode: getCodeReviewModeImpl(projectRoot),
                humanReviewDecision: "skipped",
                humanReviewedAt: null,
            };
            executionComplete = true;
            break;
        }

        emitRunWieldSystemStatus(hostedSession, "Running Semantic Code Review...");
        let diffText = "";
        let reviewResponse = "";
        let reviewOutcome = null;
        let semanticUsedLargeDiffPath = false;
        // Track reviewer execution failures (errors, blank output) for retry flow
        /** @type {boolean} */
        let reviewerFailed = false;
        try {
            diffText = await getDiffText(baselineTree, executionCwd);
            latestDiffText = diffText;

            if (
                (!requiresImplementationDiff(triageMeta) || hasImplementationDiff(diffText, planName)) &&
                diffText.trim()
            ) {
                const diffBytes = new TextEncoder().encode(diffText).byteLength;
                const isLargeDiff = diffBytes > REVIEW_INLINE_DIFF_MAX_BYTES;
                semanticUsedLargeDiffPath = isLargeDiff;

                let reviewPrompt;
                let reviewerAgentDef = await loadReviewerPromptImpl();
                /** @type {import('@earendil-works/pi-coding-agent').ToolDefinition[]} */
                const reviewerCustomTools = [];
                const reviewerToolNames = ["read", "grep", "find", "ls", "review_complete"];

                if (isLargeDiff) {
                    reviewPrompt = buildLargeDiffReviewPrompt(reviewerAgentDef, planContent, diffText, diffBytes);
                    // Attach the bounded diff-inspection tool
                    reviewerCustomTools.push(createReviewDiffTool(diffText));
                    // Create a modified definition that permits these tools
                    reviewerAgentDef = {
                        ...reviewerAgentDef,
                        tools: reviewerToolNames,
                    };
                } else {
                    // Inline diffs still permit read-only repository investigation when
                    // the diff alone is insufficient to judge the Plan requirement.
                    reviewerAgentDef = {
                        ...reviewerAgentDef,
                        tools: reviewerToolNames,
                    };
                    reviewPrompt =
                        `Compare the current implementation diff against the original plan. If the code fully satisfies the plan, call review_complete with approved: true. Otherwise, call review_complete with approved: false and a feedback string listing the missing semantic requirements.\n\n### Original Plan\n${planContent}\n\n### Git Diff\n${diffText}`;
                }

                /** @type {import('@earendil-works/pi-agent-core').AgentMessage[]} */
                let sessionMessages;
                try {
                    sessionMessages = await runAgentSessionImpl({
                        hostedSession,
                        agentName: AGENTS.REVIEWER,
                        userRequest: reviewPrompt,
                        cwd: executionCwd,
                        _agentDefOverride: reviewerAgentDef,
                        customTools: reviewerCustomTools.length > 0 ? reviewerCustomTools : undefined,
                        includeEditFallback: false,
                        // Reviewer must judge only the supplied plan/diff and its own
                        // read-only investigation, not the workflow's conversation history.
                        // Omitting the shared manager gives this transient invocation a
                        // fresh in-memory SessionManager.
                        useRootSession: false,
                    });
                } catch (/** @type {any} */ invocationError) {
                    const errorMsg = invocationError instanceof Error
                        ? invocationError.message
                        : String(invocationError);
                    emitRunWieldSystemStatus(
                        hostedSession,
                        `Semantic Reviewer execution failed: ${errorMsg}`,
                        true,
                    );
                    reviewerFailed = true;
                    reviewResponse = "";
                    sessionMessages = [];
                }

                if (!reviewerFailed) {
                    reviewOutcome = readLatestReviewOutcome(sessionMessages);
                    if (!reviewOutcome) {
                        emitRunWieldSystemStatus(
                            hostedSession,
                            "Semantic Reviewer did not call review_complete. Treating as execution failure.",
                            true,
                        );
                        reviewerFailed = true;
                    } else {
                        reviewResponse = reviewOutcome.feedback || "";
                    }
                }
            }
        } catch (error) {
            if (isGitRepositoryRequiredError(error)) {
                haltReason = formatGitRequiredMessage(error);
                emitRunWieldSystemStatus(hostedSession, `Workflow halted: ${haltReason}`, true);
            } else {
                throw error;
            }
        } finally {
            // SessionRuntime owns turn/busy state for the full validation operation.
        }

        if (haltReason) break;

        // Handle reviewer execution failures with retry/cancel menu
        if (reviewerFailed && diffText.trim()) {
            const retryResponse = await requestHostedSessionInteraction(hostedSession, {
                type: RuntimeInteractionTypes.SELECT,
                prompt: "Semantic Review failed to complete. What would you like to do?",
                options: [
                    { value: "retry", label: "Retry Semantic Review" },
                    { value: "cancel", label: "Stop/Cancel Validation" },
                ],
            });
            if (retryResponse.outcome === "selected" && retryResponse.value === "retry") {
                // Reset failure flag before retry; the first failure should not carry over
                reviewerFailed = false;
                // Rerun semantic review from the beginning of the cycle
                emitRunWieldSystemStatus(hostedSession, "Retrying Semantic Code Review...");
                try {
                    // Rebuild diff and try again
                    const retryDiffText = await getDiffText(baselineTree, executionCwd);
                    const diffBytes = new TextEncoder().encode(retryDiffText).byteLength;
                    const isLargeDiff = diffBytes > REVIEW_INLINE_DIFF_MAX_BYTES;

                    let retryPrompt;
                    let retryAgentDef = await loadReviewerPromptImpl();
                    /** @type {import('@earendil-works/pi-coding-agent').ToolDefinition[]} */
                    const retryCustomTools = [];

                    if (isLargeDiff) {
                        retryPrompt = buildLargeDiffReviewPrompt(retryAgentDef, planContent, retryDiffText, diffBytes);
                        retryCustomTools.push(createReviewDiffTool(retryDiffText));
                        retryAgentDef = {
                            ...retryAgentDef,
                            tools: ["read", "grep", "find", "ls", "review_complete"],
                        };
                    } else {
                        retryAgentDef = {
                            ...retryAgentDef,
                            tools: ["read", "grep", "find", "ls", "review_complete"],
                        };
                        retryPrompt =
                            `Compare the current implementation diff against the original plan. If the code fully satisfies the plan, call review_complete with approved: true. Otherwise, call review_complete with approved: false and a feedback string listing the missing semantic requirements.\n\n### Original Plan\n${planContent}\n\n### Git Diff\n${retryDiffText}`;
                    }

                    try {
                        const retryMessages = await runAgentSessionImpl({
                            hostedSession,
                            agentName: AGENTS.REVIEWER,
                            userRequest: retryPrompt,
                            cwd: executionCwd,
                            _agentDefOverride: retryAgentDef,
                            customTools: retryCustomTools.length > 0 ? retryCustomTools : undefined,
                            includeEditFallback: false,
                            // Keep retries isolated as well; failed Reviewer context must
                            // not leak into the next independent audit attempt.
                            useRootSession: false,
                        });
                        const retryOutcome = readLatestReviewOutcome(retryMessages);
                        reviewResponse = retryOutcome?.feedback || "";
                        // Propagate the reviewOutcome up so the approved/rejected check below sees it
                        reviewOutcome = retryOutcome;
                    } catch (/** @type {any} */ retryError) {
                        const errorMsg = retryError instanceof Error ? retryError.message : String(retryError);
                        emitRunWieldSystemStatus(
                            hostedSession,
                            `Semantic Reviewer retry also failed: ${errorMsg}`,
                            true,
                        );
                        reviewerFailed = true;
                    }
                } finally {
                    // SessionRuntime owns turn/busy state for the full validation operation.
                }

                if (!reviewerFailed && reviewOutcome?.feedback != null) {
                    emitRunWieldSystemStatus(
                        hostedSession,
                        "Semantic Review retry completed.",
                        "success",
                    );
                    // Reset reviewerFailed so normal flow continues below
                    reviewerFailed = false;
                } else {
                    haltReason = "Semantic Review failed after retry. Validation halted.";
                    await recordWorkflowMetricImpl({
                        category: "validation",
                        event: "semantic_review_result",
                        planName,
                        details: {
                            validationCycle: validationCycles,
                            approved: false,
                            reason: "failed_and_retried",
                        },
                    });
                    // Fall through to the halt handling below
                }
            } else {
                haltReason = "User canceled validation after Semantic Review failure.";
                reviewerFailed = true;
            }

            if (haltReason) {
                await recordWorkflowMetricImpl({
                    category: "validation",
                    event: "semantic_review_result",
                    planName,
                    details: {
                        validationCycle: validationCycles,
                        approved: false,
                        reason: haltReason,
                    },
                });
                break;
            }
        }

        if (requiresImplementationDiff(triageMeta) && !hasImplementationDiff(diffText, planName)) {
            haltReason = diffText.trim()
                ? "No implementation changes detected in workflow diff; only plan document changes were found."
                : "No implementation changes detected in workflow diff.";
            break;
        }

        if (!diffText.trim()) {
            emitRunWieldSystemStatus(
                hostedSession,
                "No changes detected in diff. Assuming approved.",
                "success",
            );
            humanReviewMetadata = {
                humanReviewMode: getCodeReviewModeImpl(projectRoot),
                humanReviewDecision: "not_required",
                humanReviewedAt: null,
            };
            executionComplete = true;
            break;
        }

        if (!reviewerFailed && reviewOutcome?.approved) {
            await recordWorkflowMetricImpl({
                category: "validation",
                event: "semantic_review_result",
                planName,
                details: { validationCycle: validationCycles, approved: true, hasDiff: Boolean(diffText.trim()) },
            });
            emitRunWieldSystemStatus(hostedSession, "Semantic Code Review Approved.", "success");
            const codeReviewMode = getCodeReviewModeImpl(projectRoot);
            if (codeReviewMode === "none") {
                humanReviewMetadata = {
                    humanReviewMode: "none",
                    humanReviewDecision: "not_required",
                    humanReviewedAt: null,
                };
                await recordWorkflowMetricImpl({
                    category: "validation",
                    event: "human_review_result",
                    planName,
                    details: { mode: "none", decision: "not_required" },
                });
                executionComplete = true;
            } else {
                let shouldOpenReview = codeReviewMode === "always";
                if (codeReviewMode === "ask") {
                    const reviewResponse = await requestInteraction(hostedSession, {
                        type: RuntimeInteractionTypes.SELECT,
                        prompt: "Semantic review passed. Open code review before merge-back?",
                        options: [
                            { value: "open", label: "Open code review" },
                            { value: "skip", label: "Skip code review" },
                        ],
                    });
                    shouldOpenReview = reviewResponse.outcome === "selected" && reviewResponse.value === "open";
                    if (!shouldOpenReview) {
                        humanReviewMetadata = {
                            humanReviewMode: "ask",
                            humanReviewDecision: "skipped",
                            humanReviewedAt: null,
                        };
                        await recordWorkflowMetricImpl({
                            category: "validation",
                            event: "human_review_result",
                            planName,
                            details: { mode: "ask", decision: "skipped" },
                        });
                        executionComplete = true;
                    }
                }

                if (shouldOpenReview) {
                    /** @type {Record<string, unknown>} */
                    let planAttrs = {};
                    try {
                        planAttrs = extractYaml(planContent).attrs || {};
                    } catch {
                        planAttrs = {};
                    }
                    const guidedReviewMode = getGuidedReviewModeImpl(projectRoot);
                    const guidedRecommendation = recommendGuidedReview({
                        planAttrs,
                        planContent,
                        diffText,
                        usedLargeDiffPath: semanticUsedLargeDiffPath,
                    });
                    let guidedAskAccepted = false;
                    if (guidedReviewMode === "ask" && guidedRecommendation.recommended) {
                        const guidedReviewResponse = await requestInteraction(hostedSession, {
                            type: RuntimeInteractionTypes.SELECT,
                            prompt:
                                `Generate a Guided Review Explainer before code review? This uses an additional LLM call. Reasons: ${
                                    guidedRecommendation.reasons.join(", ") || "policy recommendation"
                                }.`,
                            options: [
                                { value: "generate", label: "Generate guided review" },
                                { value: "skip", label: "Open plain diff only" },
                            ],
                        });
                        guidedAskAccepted = guidedReviewResponse.outcome === "selected" &&
                            guidedReviewResponse.value === "generate";
                    }
                    const guidedReview = buildGuidedReviewPolicy(
                        guidedReviewMode,
                        guidedRecommendation,
                        guidedAskAccepted,
                    );
                    if (guidedReview.autoStart) {
                        emitRunWieldSystemStatus(
                            hostedSession,
                            `Opening code review with Guided Review generation queued (extra LLM call). Reasons: ${
                                guidedReview.reasons.join(", ") || guidedReview.mode
                            }...`,
                        );
                    } else {
                        const reasonText = guidedReview.reasons.join(", ") || guidedReview.mode;
                        const guideState = guidedReview.mode === "none"
                            ? "automatic generation is disabled"
                            : guidedRecommendation.recommended
                            ? "Guided Review was recommended but not queued automatically"
                            : "automatic generation is not recommended";
                        emitRunWieldSystemStatus(
                            hostedSession,
                            `Opening code review. ${guideState}. Manual Guided Review generation remains available and uses an additional LLM call. Reasons: ${reasonText}.`,
                        );
                    }
                    await recordWorkflowMetricImpl({
                        category: "validation",
                        event: "guided_review_policy",
                        planName,
                        details: {
                            mode: guidedReview.mode,
                            autoStart: guidedReview.autoStart,
                            score: guidedReview.score,
                            reasons: guidedReview.reasons,
                            stats: guidedReview.stats,
                        },
                    });
                    const humanReviewResponse = await requestInteraction(hostedSession, {
                        type: RuntimeInteractionTypes.CODE_REVIEW,
                        prompt: `Review implementation diff for "${planName}"`,
                        _meta: { planName, planContent, planAttrs, diffText, executionCwd, guidedReview },
                    });
                    const humanReview = /** @type {any} */ (humanReviewResponse._meta || {
                        approved: false,
                        feedback: humanReviewResponse.message || "",
                        annotations: [],
                        images: [],
                        exit: true,
                        canceled: humanReviewResponse.outcome === "canceled",
                    });

                    const hasHumanFeedback = Boolean(
                        humanReview.feedback?.trim() || humanReview.annotations?.length || humanReview.images?.length,
                    );
                    if (humanReview.exit || (!humanReview.approved && !hasHumanFeedback)) {
                        const decision = humanReview.canceled ? "canceled" : humanReview.exit ? "exited" : "halted";
                        await recordWorkflowMetricImpl({
                            category: "validation",
                            event: "human_review_result",
                            planName,
                            details: {
                                mode: codeReviewMode,
                                decision,
                                hasFeedback: Boolean(humanReview.feedback?.trim()),
                                annotationCount: humanReview.annotations?.length || 0,
                                imageCount: humanReview.images?.length || 0,
                            },
                        });
                        haltReason = "User code review exited without approval or feedback.";
                        break;
                    }

                    if (humanReview.approved) {
                        emitRunWieldSystemStatus(
                            hostedSession,
                            "User Code Review Approved.",
                            "success",
                        );
                        humanReviewMetadata = {
                            humanReviewMode: codeReviewMode,
                            humanReviewDecision: "approved",
                            humanReviewedAt: new Date().toISOString(),
                        };
                        await recordWorkflowMetricImpl({
                            category: "validation",
                            event: "human_review_result",
                            planName,
                            details: {
                                mode: codeReviewMode,
                                decision: "approved",
                                hasFeedback: Boolean(humanReview.feedback?.trim()),
                                annotationCount: humanReview.annotations?.length || 0,
                                imageCount: humanReview.images?.length || 0,
                            },
                        });
                        executionComplete = true;
                    } else {
                        const annotationText = formatCodeReviewAnnotations(humanReview.annotations || []);
                        const feedbackText = [
                            humanReview.feedback || "(no free-text feedback provided)",
                            annotationText ? `Annotations:\n${annotationText}` : "",
                        ].filter(Boolean).join("\n\n");
                        emitRunWieldSystemStatus(
                            hostedSession,
                            `User code review returned feedback. Sending feedback back to ${
                                getAgentDisplayName(AGENTS.ENGINEER, projectRoot)
                            }...\nUser Code Review Feedback:\n${feedbackText}`,
                            true,
                        );
                        await recordWorkflowMetricImpl({
                            category: "validation",
                            event: "human_review_result",
                            planName,
                            details: {
                                mode: codeReviewMode,
                                decision: "feedback_requested",
                                hasFeedback: Boolean(humanReview.feedback?.trim()),
                                annotationCount: humanReview.annotations?.length || 0,
                                imageCount: humanReview.images?.length || 0,
                            },
                        });
                        await recordWorkflowMetricImpl({
                            category: "validation",
                            event: "repair_dispatched",
                            agentName: AGENTS.ENGINEER,
                            planName,
                            details: { repairKind: "human_review", validationCycle: validationCycles },
                        });
                        const completed = await repair({
                            hostedSession,
                            agentName: AGENTS.ENGINEER,
                            userRequest:
                                "The user provided feedback about your implementation during a code review. Please fix them, " +
                                `do not break existing tests, and call task_completed when finished.\n\n` +
                                `User Code Review Feedback:\n${feedbackText}`,
                            sessionManager,
                            cwd: executionCwd,
                            images: /** @type {Array<{base64: string, mimeType: string}>} */ (
                                /** @type {unknown} */ (humanReview.images || [])
                            ),
                        });
                        await recordWorkflowMetricImpl({
                            category: "validation",
                            event: "repair_completed",
                            agentName: AGENTS.ENGINEER,
                            planName,
                            details: {
                                repairKind: "human_review",
                                validationCycle: validationCycles,
                                taskCompletedObserved: Boolean(completed),
                            },
                        });
                        if (!completed) {
                            await pauseForEngineerContinuation(
                                `${
                                    getAgentDisplayName(AGENTS.ENGINEER, projectRoot)
                                } stopped without task_completed during human code review repair.`,
                            );
                            return;
                        }
                    }
                }
            }
        } else {
            await recordWorkflowMetricImpl({
                category: "validation",
                event: "semantic_review_result",
                planName,
                details: {
                    validationCycle: validationCycles,
                    approved: false,
                    hasReviewerOutput: Boolean(reviewResponse),
                },
            });
            emitRunWieldSystemStatus(
                hostedSession,
                `Review failed. Sending feedback back to ${getAgentDisplayName(AGENTS.ENGINEER, projectRoot)}...`,
                true,
            );
            await recordWorkflowMetricImpl({
                category: "validation",
                event: "repair_dispatched",
                agentName: AGENTS.ENGINEER,
                planName,
                details: { repairKind: "semantic", validationCycle: validationCycles },
            });
            const completed = await repair({
                hostedSession,
                agentName: AGENTS.ENGINEER,
                userRequest: "The code reviewer found issues with your implementation. Please fix them, do not break " +
                    `existing tests, and call task_completed when finished.\n\nReviewer Feedback:\n${reviewResponse}`,
                sessionManager,
                cwd: executionCwd,
            });
            await recordWorkflowMetricImpl({
                category: "validation",
                event: "repair_completed",
                agentName: AGENTS.ENGINEER,
                planName,
                details: {
                    repairKind: "semantic",
                    validationCycle: validationCycles,
                    taskCompletedObserved: Boolean(completed),
                },
            });
            if (!completed) {
                await pauseForEngineerContinuation(
                    `${
                        getAgentDisplayName(AGENTS.ENGINEER, projectRoot)
                    } stopped without task_completed during semantic repair.`,
                );
                return;
            }
        }
    }

    if (!executionComplete && !haltReason && validationCycles >= MAX_VALIDATION_CYCLES) {
        haltReason = `Semantic validation did not approve after ${MAX_VALIDATION_CYCLES} cycles.`;
    }

    if (executionComplete) {
        const triageClassificationDisplay = triageMeta?.classification
            ? triageMeta.classification.toLocaleLowerCase().replace(/^([a-z])/, (c) => c.toUpperCase())
            : "Plan";
        let cleanupMergedWorktrees = true;
        const maxMergeRepairAttempts = 2;
        let mergeRepairAttempts = 0;
        /** @type {string | undefined} */
        let pendingRepairMergeWorktreePath;
        let mergeBackCompleted = false;

        if (worktreeBranch && !worktreeBaseBranch) {
            emitRunWieldSystemStatus(
                hostedSession,
                "Recorded worktree target branch is unknown; using legacy current-checkout merge fallback. " +
                    "Recover the target from the worktree registry when possible before retrying.",
                true,
            );
        }

        if (worktreeBranch) {
            while (executionComplete) {
                const planPath = `plans/${planName}.md`;
                /** @type {Awaited<ReturnType<typeof preparePrimaryPlanPathForMerge>>[]} */
                const primaryPlanSnapshots = [];
                /** @type {string[]} */
                let preservedPlanPaths = [];
                let mergeCompleted = false;
                try {
                    cleanupMergedWorktrees = shouldCleanupMergedWorktreesImpl(projectRoot);
                    if (planName && planName !== "quick-fix") {
                        const stagingResult = await stageValidationPassedImpl({
                            projectRoot,
                            executionCwd,
                            planName,
                            details: {
                                triageMeta,
                                worktreeStatus: "merged",
                                cleanupMergedWorktrees,
                                ...(humanReviewMetadata || {}),
                            },
                        });
                        preservedPlanPaths = stagingResult.planPaths;
                        for (const relativePath of preservedPlanPaths) {
                            primaryPlanSnapshots.push(await preparePrimaryPlanPathImpl({ projectRoot, relativePath }));
                        }
                    }
                    emitRunWieldSystemStatus(
                        hostedSession,
                        worktreeBaseBranch
                            ? `Merging validated worktree branch ${worktreeBranch} into target branch ${worktreeBaseBranch}.`
                            : `Merging validated worktree branch ${worktreeBranch} into primary checkout.`,
                    );
                    const mergeResult = await mergeExecutionWorktreeImpl({
                        projectRoot,
                        branch: worktreeBranch,
                        targetBranch: worktreeBaseBranch,
                        worktreePath: executionCwd,
                        repairMergeWorktreePath: pendingRepairMergeWorktreePath,
                        planName,
                        planDescription: triageMeta?.summary,
                        allowedDirtyPaths: [
                            planPath,
                            ".wld/",
                            ".wld/worktrees.json",
                            ".wld/worktrees.lock",
                        ],
                        preservePlanPaths: preservedPlanPaths,
                    });
                    mergeCompleted = true;
                    mergeBackCompleted = true;
                    if (mergeResult?.updatedPrimaryCheckout === false) {
                        for (const snapshot of primaryPlanSnapshots.toReversed()) {
                            try {
                                await restorePrimaryPlanPathImpl(snapshot);
                            } catch (restoreError) {
                                const restoreReason = restoreError instanceof Error
                                    ? restoreError.message
                                    : String(restoreError);
                                emitRunWieldSystemStatus(
                                    hostedSession,
                                    `Worktree merged, but restoring the primary Plan snapshot failed: ${restoreReason}`,
                                    true,
                                );
                            }
                        }
                    }
                    let mergeVerified = true;
                    try {
                        const mergeVerification = await verifyExecutionWorktreeMergedImpl({
                            projectRoot,
                            worktreeBranch,
                            worktreeBaseBranch,
                        });
                        if (!mergeVerification.merged) {
                            mergeVerified = false;
                            emitRunWieldSystemStatus(
                                hostedSession,
                                `Worktree merged, but post-merge verification was inconclusive: ${mergeVerification.message}`,
                                true,
                            );
                        }
                    } catch (verificationError) {
                        mergeVerified = false;
                        const verificationReason = verificationError instanceof Error
                            ? verificationError.message
                            : String(verificationError);
                        emitRunWieldSystemStatus(
                            hostedSession,
                            `Worktree merged, but post-merge verification failed: ${verificationReason}`,
                            true,
                        );
                    }
                    pendingRepairMergeWorktreePath = undefined;
                    try {
                        await recordWorkflowMetricImpl({
                            category: "validation",
                            event: "merge_back_result",
                            planName,
                            details: {
                                passed: true,
                                hasWorktreeBranch: Boolean(worktreeBranch),
                                cleanupMergedWorktrees,
                            },
                        });
                    } catch (metricError) {
                        const metricReason = metricError instanceof Error ? metricError.message : String(metricError);
                        emitRunWieldSystemStatus(
                            hostedSession,
                            `Worktree merged, but recording the merge result failed: ${metricReason}`,
                            true,
                        );
                    }
                    if (worktreeId) {
                        try {
                            await updateWorktreeRegistryEntryImpl(projectRoot, worktreeId, { status: "merged" });
                        } catch (registryError) {
                            const registryReason = registryError instanceof Error
                                ? registryError.message
                                : String(registryError);
                            emitRunWieldSystemStatus(
                                hostedSession,
                                `Worktree merged, but updating its registry status failed: ${registryReason}`,
                                true,
                            );
                        }
                    }
                    if (mergeVerified && cleanupMergedWorktrees && executionCwd) {
                        try {
                            await removeExecutionWorktreeImpl({
                                projectRoot,
                                path: executionCwd,
                                branch: worktreeBranch,
                                force: true,
                            });
                            if (worktreeId) {
                                await removeWorktreeRegistryEntryImpl(projectRoot, worktreeId);
                            }
                        } catch (cleanupError) {
                            const cleanupReason = cleanupError instanceof Error
                                ? cleanupError.message
                                : String(cleanupError);
                            emitRunWieldSystemStatus(
                                hostedSession,
                                `Worktree merged, but cleanup failed: ${cleanupReason}`,
                                true,
                            );
                        }
                    }
                    break;
                } catch (/** @type {any} */ error) {
                    let reason = error instanceof Error ? error.message : String(error);
                    if (mergeCompleted) {
                        emitRunWieldSystemStatus(
                            hostedSession,
                            `Worktree merged, but post-merge processing failed: ${reason}`,
                            true,
                        );
                        break;
                    }
                    if (primaryPlanSnapshots.length > 0) {
                        for (const snapshot of primaryPlanSnapshots.toReversed()) {
                            try {
                                await restorePrimaryPlanPathImpl(snapshot);
                            } catch (restoreError) {
                                const restoreReason = restoreError instanceof Error
                                    ? restoreError.message
                                    : String(restoreError);
                                reason += ` Primary Plan rollback also failed: ${restoreReason}`;
                            }
                        }
                    }
                    emitRunWieldSystemStatus(hostedSession, `Worktree merge failed: ${reason}`, true);
                    if (worktreeId) {
                        try {
                            await updateWorktreeRegistryEntryImpl(projectRoot, worktreeId, {
                                status: "merge_conflict",
                            });
                        } catch (metadataError) {
                            const metadataReason = metadataError instanceof Error
                                ? metadataError.message
                                : String(metadataError);
                            emitRunWieldSystemStatus(
                                hostedSession,
                                `Could not update worktree registry while merge conflict is active: ${metadataReason}`,
                                true,
                            );
                        }
                    }
                    if (planName && planName !== "quick-fix") {
                        try {
                            await recordPlanEventImpl({
                                cwd: projectRoot,
                                planName,
                                event: "worktree_merge_failed",
                                currentStatus: "implemented",
                                details: {
                                    triageMeta,
                                    failureReason: reason,
                                    worktreePath: executionCwd,
                                    worktreeBranch,
                                    worktreeBaseBranch,
                                },
                            });
                        } catch (metadataError) {
                            const metadataReason = metadataError instanceof Error
                                ? metadataError.message
                                : String(metadataError);
                            emitRunWieldSystemStatus(
                                hostedSession,
                                `Could not update plan metadata while merge conflict is active: ${metadataReason}`,
                                true,
                            );
                        }
                    }

                    pendingRepairMergeWorktreePath = getMergeWorktreePath(error) || pendingRepairMergeWorktreePath;

                    await recordWorkflowMetricImpl({
                        category: "validation",
                        event: "merge_back_result",
                        planName,
                        details: { passed: false, mergeFailureKind: getMergeFailureKind(error) },
                    });

                    if (mergeRepairAttempts < maxMergeRepairAttempts) {
                        mergeRepairAttempts++;
                        const repairCwd = getMergeRepairCwd(error) || pendingRepairMergeWorktreePath || executionCwd ||
                            projectRoot;
                        const gitStatusContext = await getGitStatusContext(repairCwd);
                        emitRunWieldSystemStatus(
                            hostedSession,
                            `Dispatching ${
                                getAgentDisplayName(AGENTS.ENGINEER, projectRoot)
                            } for merge repair attempt ${mergeRepairAttempts}/${maxMergeRepairAttempts}...`,
                            true,
                        );
                        await recordWorkflowMetricImpl({
                            category: "validation",
                            event: "repair_dispatched",
                            agentName: AGENTS.ENGINEER,
                            planName,
                            details: { repairKind: "merge", repairAttempt: mergeRepairAttempts },
                        });
                        const completed = await repair({
                            hostedSession,
                            agentName: AGENTS.ENGINEER,
                            userRequest: buildMergeRepairRequest({
                                planName,
                                reason,
                                executionCwd,
                                worktreeBranch,
                                worktreeBaseBranch,
                                currentPlanStatus: "implemented",
                                diffContext: latestDiffText.trim() ? latestDiffText.slice(0, 6000) : undefined,
                                gitStatusContext,
                                repairCwd,
                                mergeFailureKind: getMergeFailureKind(error),
                            }),
                            sessionManager,
                            cwd: repairCwd,
                        });
                        await recordWorkflowMetricImpl({
                            category: "validation",
                            event: "repair_completed",
                            agentName: AGENTS.ENGINEER,
                            planName,
                            details: {
                                repairKind: "merge",
                                repairAttempt: mergeRepairAttempts,
                                taskCompletedObserved: Boolean(completed),
                            },
                        });
                        if (completed) continue;
                        emitRunWieldSystemStatus(
                            hostedSession,
                            `${
                                getAgentDisplayName(AGENTS.ENGINEER, projectRoot)
                            } stopped without task_completed during merge repair.`,
                            true,
                        );
                    }

                    const action = await promptForMergeFailureAction(hostedSession, reason);
                    if (action === "retry") {
                        continue;
                    }
                    emitRunWieldSystemStatus(hostedSession, `Workflow halted: Worktree merge failed: ${reason}`, true);
                    executionComplete = false;
                    haltReason = `Worktree merge failed: ${reason}`;
                }
            }
        }

        if (executionComplete) {
            try {
                await recordWorkflowMetricImpl({
                    category: "validation",
                    event: "workflow_validation_finished",
                    planName,
                    details: { passed: true, validationCycles, hasWorktreeBranch: Boolean(worktreeBranch) },
                });
            } catch (metricError) {
                if (!mergeBackCompleted) throw metricError;
                const metricReason = metricError instanceof Error ? metricError.message : String(metricError);
                emitRunWieldSystemStatus(
                    hostedSession,
                    `Worktree merged, but recording Workflow Validation completion failed: ${metricReason}`,
                    true,
                );
            }
            emitRunWieldSystemStatus(
                hostedSession,
                `${triageClassificationDisplay} execution and validation complete.`,
                "success",
            );
            if (planName && planName !== "quick-fix" && !worktreeBranch) {
                await recordPlanEventImpl({
                    cwd: projectRoot,
                    planName,
                    event: "validation_passed",
                    currentStatus: "implemented",
                    details: {
                        triageMeta,
                        ...(humanReviewMetadata || {}),
                    },
                });
            }
            if (triageMeta?.classification === "FEATURE") {
                await presentManualQaChecklist({
                    hostedSession,
                    name: planName,
                    classification: "FEATURE",
                    context: planContent,
                    cwd: projectRoot,
                    runPrompt: runManualQaChecklistPromptImpl,
                });
            }
        } else if (haltReason) {
            await recordWorkflowMetricImpl({
                category: "validation",
                event: "workflow_validation_finished",
                planName,
                details: { passed: false, validationCycles, reason: "halted_after_merge" },
            });
            if (worktreeId) {
                try {
                    await updateWorktreeRegistryEntryImpl(projectRoot, worktreeId, { status: "validation_failed" });
                } catch (metadataError) {
                    const metadataReason = metadataError instanceof Error
                        ? metadataError.message
                        : String(metadataError);
                    emitRunWieldSystemStatus(
                        hostedSession,
                        `Could not update worktree registry after merge halt: ${metadataReason}`,
                        true,
                    );
                }
            }
            if (planName && planName !== "quick-fix") {
                try {
                    await recordPlanEventImpl({
                        cwd: projectRoot,
                        planName,
                        event: "validation_failed",
                        currentStatus: "implemented",
                        details: { triageMeta, failureReason: haltReason, nonGitInPlace },
                    });
                } catch (metadataError) {
                    const metadataReason = metadataError instanceof Error
                        ? metadataError.message
                        : String(metadataError);
                    emitRunWieldSystemStatus(
                        hostedSession,
                        `Could not update plan metadata after merge halt: ${metadataReason}`,
                        true,
                    );
                }
            }
        }
    } else {
        const reason = haltReason || "Validation stopped before completion.";
        await recordWorkflowMetricImpl({
            category: "validation",
            event: "workflow_validation_finished",
            planName,
            details: { passed: false, validationCycles, reason: "halted" },
        });
        emitRunWieldSystemStatus(hostedSession, `Workflow halted: ${reason}`, true);
        if (worktreeId) {
            await updateWorktreeRegistryEntryImpl(projectRoot, worktreeId, { status: "validation_failed" });
        }
        if (planName && planName !== "quick-fix") {
            await recordPlanEventImpl({
                cwd: projectRoot,
                planName,
                event: "validation_failed",
                currentStatus: "implemented",
                details: { triageMeta, failureReason: reason, nonGitInPlace },
            });
        }
    }

    if (finalAgentName && hostedSession) {
        await switchActiveAgentImpl(hostedSession, { agentName: finalAgentName });
    }
}
