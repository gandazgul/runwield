/**
 * @module shared/workflow/validation
 * Mechanical and semantic validation for completed RunWield execution workflows.
 */

import { extractYaml } from "@std/front-matter";
import { dirname, fromFileUrl, join } from "@std/path";
import { AGENTS, CWD } from "../../constants.js";
import { formatGitRequiredMessage, isGitRepositoryRequiredError } from "../git.js";
import { getAgentDisplayName } from "../session/agents.js";
import { ensureBundledAgentDefFile, runAgentSession } from "../session/session.js";
import { getCodeReviewMode, getCustomSetting, setCustomSetting, shouldCleanupMergedWorktrees } from "../settings.js";
import { readLatestReviewOutcome, readLatestTaskCompletedOutcome } from "./workflow.js";
import { setActiveAgent } from "../session/agent-switching.js";
import { getWorkflowDiff } from "./git-snapshot.js";
import { recordPlanEvent, stageValidationPassedInExecutionWorktree } from "./plan-lifecycle.js";
import { formatCodeReviewAnnotations, runPlannotatorCodeReview } from "./code-review.js";
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
import { buildLargeDiffReviewPrompt, createReviewDiffTool } from "./review-diff-tool.js";

export const __dirname = dirname(fromFileUrl(import.meta.url));
const WORKFLOW_PROMPTS_DIR = "workflow-prompts";
const REVIEWER_PROMPT_FILE = "reviewer-prompt.md";
const SUCCESS_MESSAGE_STYLE = { bodyColor: "success" };
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
 * @param {import('./workflow.js').UiAPI} uiAPI
 * @param {string} projectRoot
 *
 * @returns {Promise<string>}
 */
async function getOrAskForValidationCommand(uiAPI, projectRoot) {
    const existingCommand = getCustomSetting("verification_command", "project", projectRoot);
    if (existingCommand) {
        return /** @type {string} */ (existingCommand);
    }

    uiAPI.appendSystemMessage("No validation command found in project settings.");
    const userInput = await uiAPI.promptText(
        "Enter the command to validate this project (e.g., 'deno task ci', 'npm test'): ",
        { allowEmpty: false },
    );

    if (!userInput) {
        return "";
    }

    const newCommand = userInput.trim();
    await setCustomSetting("verification_command", newCommand, "project", projectRoot);

    uiAPI.appendSystemMessage(`Saved validation command: '${newCommand}'`);
    return newCommand;
}

/**
 * Spawns the local validation step.
 *
 * @param {import('./workflow.js').UiAPI} uiAPI
 * @param {string} [cwd]
 *
 * @returns {Promise<{ exitCode: number, output: string }>}
 */
export async function runLocalCI(uiAPI, cwd = CWD) {
    const cmdArgs = await getOrAskForValidationCommand(uiAPI, cwd);

    if (!cmdArgs) {
        return {
            exitCode: 1,
            output:
                "RunWield could not auto-detect a build or test command for this repository. Please explore the project and manually run the appropriate compilation or linting commands to validate your changes.",
        };
    }

    const toolCallId = `validation-ci-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    uiAPI.addToolInvoked?.({
        id: toolCallId,
        name: "bash",
        input: { command: cmdArgs },
    });
    const toolBlock = uiAPI.startToolExecution?.(toolCallId, "$", cmdArgs);
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

        const child = command.spawn();
        const [status, stdout, stderr] = await Promise.all([
            child.status,
            captureProcessStreamTail(child.stdout, VALIDATION_STREAM_OUTPUT_LIMIT_BYTES),
            captureProcessStreamTail(child.stderr, VALIDATION_STREAM_OUTPUT_LIMIT_BYTES),
        ]);
        const output = formatCapturedProcessOutput(stdout, stderr);
        const durationMs = Date.now() - startTime;

        toolBlock?.appendOutput(output.trim() ? output : "(no output)\n");
        toolBlock?.endExecution(status.code !== 0, durationMs);
        uiAPI.addToolResult?.({
            id: toolCallId,
            name: "bash",
            result: output,
            isError: status.code !== 0,
            durationMs,
        });

        return {
            exitCode: status.code,
            output,
        };
    } catch (/** @type {any} */ error) {
        const output = `Failed to spawn validation process: ${error.message}`;
        const durationMs = Date.now() - startTime;
        toolBlock?.appendOutput(`${output}\n`);
        toolBlock?.endExecution(true, durationMs);
        uiAPI.addToolResult?.({
            id: toolCallId,
            name: "bash",
            result: output,
            isError: true,
            durationMs,
        });
        return {
            exitCode: 1,
            output,
        };
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
 * @param {import('./workflow.js').UiAPI} args.uiAPI
 * @param {import('@earendil-works/pi-coding-agent').SessionManager | undefined} args.sessionManager
 * @param {string} [args.cwd]
 * @param {import('../session/hosted-session.js').HostedSession} [args.hostedSession]
 * @param {typeof runAgentSession} [args.runAgentSession]
 * @param {typeof readLatestTaskCompletedOutcome} [args.readLatestTaskCompletedOutcome]
 * @returns {Promise<boolean>}
 */
async function runCompletionGatedRepair({
    agentName,
    userRequest,
    uiAPI,
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
        uiAPI,
        sessionManager,
        cwd,
        useRootSession: true,
    });
    hostedSession?.consumePendingSwitchHandoff?.();

    const returnedRootTranscript = startsWithMessages(messages, previousRootMessages);
    return readTaskCompleted(messages, returnedRootTranscript ? fromIndex : undefined);
}

/**
 * @param {string | undefined} baselineTree
 * @param {string} [cwd]
 * @returns {Promise<string>}
 */
async function getGitDiffText(baselineTree, cwd = CWD) {
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
 * @param {import('./workflow.js').UiAPI} uiAPI
 * @param {string} reason
 * @returns {Promise<"retry" | "stop">}
 */
async function promptForMergeFailureAction(uiAPI, reason) {
    const choice = await uiAPI.promptSelect?.(
        `Worktree merge failed:\n${reason}\n\nResolve and stage the conflicts, or run git merge --abort, then retry.`,
        [
            { value: "retry", label: "Retry/continue merge" },
            { value: "stop", label: "Stop" },
        ],
    );
    return choice === "retry" ? "retry" : "stop";
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
 * @param {import('./workflow.js').UiAPI | undefined} uiAPI
 * @param {string} text
 * @param {boolean} [isError]
 * @param {{ headingColor?: string, bodyColor?: string }} [style]
 */
function appendRunWieldSystemMessage(uiAPI, text, isError = false, style = {}) {
    uiAPI?.appendSystemMessage?.(text, isError, "RunWield", style);
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
 * @param {import('./workflow.js').UiAPI} args.uiAPI
 * @param {import('@earendil-works/pi-coding-agent').SessionManager | undefined} args.sessionManager
 * @param {import('../session/hosted-session.js').HostedSession} [args.hostedSession]
 * @param {string} [args.cwd]
 * @param {{
 *   runLocalCI?: typeof runLocalCI,
 *   runAgentSession?: typeof runAgentSession,
 *   runCompletionGatedRepair?: typeof runCompletionGatedRepair,
 *   readLatestTaskCompletedOutcome?: typeof readLatestTaskCompletedOutcome,
 *   setActiveAgent?: typeof setActiveAgent,
 *   createAgentHandler?: (agentName: string) => import('../session/types.js').AgentMessageHandler,
 *   recordWorkflowMetric?: typeof recordWorkflowMetric,
 * }} [args.__deps] Test-only injection point.
 * @returns {Promise<{ passed: boolean, attempts: number, reason?: string }>}
 */
export async function runMechanicalValidation({ uiAPI, sessionManager, hostedSession, cwd, __deps }) {
    const projectRoot = hostedSession?.cwd || CWD;
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
    const setActiveAgentImpl = __deps?.setActiveAgent || setActiveAgent;
    const createAgentHandlerImpl = __deps?.createAgentHandler ||
        (await import("../session/agent-handler.js")).createAgentHandler;
    const recordWorkflowMetricSource = __deps?.recordWorkflowMetric || recordWorkflowMetric;
    /**
     * @param {Parameters<typeof recordWorkflowMetricSource>[0]} metric
     * @param {Parameters<typeof recordWorkflowMetricSource>[1]} [deps]
     */
    function recordWorkflowMetricImpl(metric, deps = {}) {
        return recordWorkflowMetricSource(metric, { cwd: projectRoot, ...deps });
    }
    /** @param {string} agentName */
    const activateAgent = (agentName) => {
        if (!hostedSession) return;
        const handler = createAgentHandlerImpl(agentName, { hostedSession });
        setActiveAgentImpl(hostedSession, agentName, handler, uiAPI);
    };
    const maxRepairAttempts = 3;
    let repairAttempts = 0;

    await recordWorkflowMetricImpl({
        category: "validation",
        event: "mechanical_validation_started",
        planName: "quick-fix",
        details: { maxRepairAttempts },
    });
    appendRunWieldSystemMessage(uiAPI, "Starting QUICK_FIX Mechanical Validation.");

    while (true) {
        appendRunWieldSystemMessage(
            uiAPI,
            `Running QUICK_FIX CI Validation (Repair Attempts ${repairAttempts}/${maxRepairAttempts})...`,
        );
        uiAPI?.setBusy?.(true);
        let ciResult;
        try {
            ciResult = await runLocalCIImpl(uiAPI, validationCwd);
        } finally {
            uiAPI?.setBusy?.(false);
        }

        await recordWorkflowMetricImpl({
            category: "validation",
            event: "mechanical_ci_attempt",
            planName: "quick-fix",
            details: { attempt: repairAttempts + 1, exitCode: ciResult.exitCode, passed: ciResult.exitCode === 0 },
        });
        if (ciResult.exitCode === 0) {
            appendRunWieldSystemMessage(
                uiAPI,
                "QUICK_FIX Mechanical Validation passed.",
                false,
                SUCCESS_MESSAGE_STYLE,
            );
            await recordWorkflowMetricImpl({
                category: "validation",
                event: "mechanical_validation_finished",
                planName: "quick-fix",
                details: { passed: true, attempts: repairAttempts },
            });
            activateAgent(AGENTS.ENGINEER);
            return { passed: true, attempts: repairAttempts };
        }

        if (repairAttempts >= maxRepairAttempts) {
            const reason =
                `QUICK_FIX Mechanical Validation failed after ${maxRepairAttempts} Engineer repair attempts.`;
            appendRunWieldSystemMessage(uiAPI, reason, true);
            await recordWorkflowMetricImpl({
                category: "validation",
                event: "mechanical_validation_finished",
                planName: "quick-fix",
                details: { passed: false, attempts: repairAttempts, reason: "max_repair_attempts" },
            });
            activateAgent(AGENTS.ENGINEER);
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
        appendRunWieldSystemMessage(
            uiAPI,
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
            uiAPI,
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
            appendRunWieldSystemMessage(
                uiAPI,
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
            });
            activateAgent(AGENTS.ENGINEER);
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
 * @param {import('./workflow.js').UiAPI} args.uiAPI
 * @param {import('@earendil-works/pi-coding-agent').SessionManager | undefined} args.sessionManager
 * @param {import('../session/hosted-session.js').HostedSession} [args.hostedSession]
 * @param {string | undefined} [args.finalAgentName] Agent to restore after router-started or direct workflows.
 * @param {{
 *   runLocalCI?: typeof runLocalCI,
 *   runAgentSession?: typeof runAgentSession,
 *   runCompletionGatedRepair?: typeof runCompletionGatedRepair,
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
 *   setActiveAgent?: typeof setActiveAgent,
 *   createAgentHandler?: (agentName: string) => import('../session/types.js').AgentMessageHandler,
 *   loadReviewerPrompt?: typeof loadReviewerPrompt,
 *   shouldCleanupMergedWorktrees?: typeof shouldCleanupMergedWorktrees,
 *   getCodeReviewMode?: typeof getCodeReviewMode,
 *   runPlannotatorCodeReview?: typeof runPlannotatorCodeReview,
 *   verifyExecutionWorktreeMerged?: typeof verifyExecutionWorktreeMerged,
 *   recordWorkflowMetric?: typeof recordWorkflowMetric,
 * }} [args.__deps] Test-only injection point.
 */
export async function runValidationLoop({
    planName,
    planContent,
    triageMeta,
    uiAPI,
    sessionManager,
    hostedSession,
    finalAgentName,
    __deps,
}) {
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
    const runPlannotatorCodeReviewImpl = __deps?.runPlannotatorCodeReview || runPlannotatorCodeReview;
    const verifyExecutionWorktreeMergedImpl = __deps?.verifyExecutionWorktreeMerged || verifyExecutionWorktreeMerged;
    const recordWorkflowMetricSource = __deps?.recordWorkflowMetric || recordWorkflowMetric;
    const activeWorkflow = hostedSession?.getActiveExecutionWorkflow?.() || null;
    const baselineTree = activeWorkflow?.baselineTree;
    const projectRoot = activeWorkflow?.projectRoot || hostedSession?.cwd || CWD;
    const executionCwd = activeWorkflow?.executionCwd || hostedSession?.cwd || CWD;
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
    const setActiveAgentImpl = __deps?.setActiveAgent || setActiveAgent;
    /** @param {string} reason */
    const pauseForEngineerContinuation = async (reason) => {
        appendRunWieldSystemMessage(
            uiAPI,
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
            const createAgentHandler = __deps?.createAgentHandler ||
                (await import("../session/agent-handler.js")).createAgentHandler;
            const handler = createAgentHandler(AGENTS.ENGINEER, { hostedSession });
            setActiveAgentImpl(hostedSession, AGENTS.ENGINEER, handler, uiAPI);
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
        appendRunWieldSystemMessage(uiAPI, `Starting Validation Cycle ${validationCycles}/${MAX_VALIDATION_CYCLES}`);

        let buildPasses = false;
        let mechanicalAttempts = 0;

        while (!buildPasses && mechanicalAttempts < 3) {
            mechanicalAttempts++;
            appendRunWieldSystemMessage(uiAPI, `Running CI Validation (Attempt ${mechanicalAttempts}/3)...`);
            uiAPI?.setBusy?.(true);
            let ciResult;
            try {
                ciResult = await runLocalCIImpl(uiAPI, executionCwd);
            } finally {
                uiAPI?.setBusy?.(false);
            }

            await recordWorkflowMetricImpl({
                category: "validation",
                event: "ci_attempt",
                planName,
                details: {
                    validationCycle: validationCycles,
                    mechanicalAttempt: mechanicalAttempts,
                    exitCode: ciResult.exitCode,
                    passed: ciResult.exitCode === 0,
                },
            });
            if (ciResult.exitCode === 0) {
                buildPasses = true;
                appendRunWieldSystemMessage(uiAPI, "Build and tests passed.", false, SUCCESS_MESSAGE_STYLE);
            } else {
                appendRunWieldSystemMessage(
                    uiAPI,
                    `Build failed. Dispatching ${getAgentDisplayName(AGENTS.ENGINEER)} to fix syntax/types...`,
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
                    agentName: AGENTS.ENGINEER,
                    userRequest:
                        "The project failed CI validation. Fix the following build errors, then call task_completed " +
                        `when the repair is complete:\n\n${ciResult.output}`,
                    uiAPI,
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
                        `${getAgentDisplayName(AGENTS.ENGINEER)} stopped without task_completed during CI repair.`,
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
            appendRunWieldSystemMessage(
                uiAPI,
                "Git is not available for this project. RunWield cannot compute a Git diff, so automated Semantic Code Review and human diff review are skipped for this in-place execution.",
                true,
            );
            humanReviewMetadata = {
                humanReviewMode: getCodeReviewModeImpl(),
                humanReviewDecision: "skipped",
                humanReviewedAt: null,
            };
            executionComplete = true;
            break;
        }

        appendRunWieldSystemMessage(uiAPI, "Running Semantic Code Review...");
        uiAPI?.setBusy?.(true);
        let diffText = "";
        let reviewResponse = "";
        let reviewOutcome = null;
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
                        uiAPI,
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
                    hostedSession?.consumePendingSwitchHandoff?.();
                } catch (/** @type {any} */ invocationError) {
                    const errorMsg = invocationError instanceof Error
                        ? invocationError.message
                        : String(invocationError);
                    appendRunWieldSystemMessage(
                        uiAPI,
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
                        appendRunWieldSystemMessage(
                            uiAPI,
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
                appendRunWieldSystemMessage(uiAPI, `Workflow halted: ${haltReason}`, true);
            } else {
                throw error;
            }
        } finally {
            uiAPI?.setBusy?.(false);
        }

        if (haltReason) break;

        // Handle reviewer execution failures with retry/cancel menu
        if (reviewerFailed && diffText.trim()) {
            const shouldRetry = await uiAPI.promptSelect?.(
                "Semantic Review failed to complete. What would you like to do?",
                [
                    { value: "retry", label: "Retry Semantic Review" },
                    { value: "cancel", label: "Stop/Cancel Validation" },
                ],
            );
            if (shouldRetry === "retry") {
                // Reset failure flag before retry; the first failure should not carry over
                reviewerFailed = false;
                // Rerun semantic review from the beginning of the cycle
                appendRunWieldSystemMessage(uiAPI, "Retrying Semantic Code Review...");
                uiAPI?.setBusy?.(true);
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
                            uiAPI,
                            cwd: executionCwd,
                            _agentDefOverride: retryAgentDef,
                            customTools: retryCustomTools.length > 0 ? retryCustomTools : undefined,
                            includeEditFallback: false,
                            // Keep retries isolated as well; failed Reviewer context must
                            // not leak into the next independent audit attempt.
                            useRootSession: false,
                        });
                        hostedSession?.consumePendingSwitchHandoff?.();
                        const retryOutcome = readLatestReviewOutcome(retryMessages);
                        reviewResponse = retryOutcome?.feedback || "";
                        // Propagate the reviewOutcome up so the approved/rejected check below sees it
                        reviewOutcome = retryOutcome;
                    } catch (/** @type {any} */ retryError) {
                        const errorMsg = retryError instanceof Error ? retryError.message : String(retryError);
                        appendRunWieldSystemMessage(
                            uiAPI,
                            `Semantic Reviewer retry also failed: ${errorMsg}`,
                            true,
                        );
                        reviewerFailed = true;
                    }
                } finally {
                    uiAPI?.setBusy?.(false);
                }

                if (!reviewerFailed && reviewOutcome?.feedback != null) {
                    appendRunWieldSystemMessage(
                        uiAPI,
                        "Semantic Review retry completed.",
                        false,
                        SUCCESS_MESSAGE_STYLE,
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
            appendRunWieldSystemMessage(
                uiAPI,
                "No changes detected in diff. Assuming approved.",
                false,
                SUCCESS_MESSAGE_STYLE,
            );
            humanReviewMetadata = {
                humanReviewMode: getCodeReviewModeImpl(),
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
            appendRunWieldSystemMessage(uiAPI, "Semantic Code Review Approved.", false, SUCCESS_MESSAGE_STYLE);
            const codeReviewMode = getCodeReviewModeImpl();
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
                    const choice = await uiAPI.promptSelect?.(
                        "Semantic review passed. Open Plannotator for code review before merge-back?",
                        [
                            { value: "open", label: "Open code review" },
                            { value: "skip", label: "Skip code review" },
                        ],
                    );
                    shouldOpenReview = choice === "open";
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
                    appendRunWieldSystemMessage(uiAPI, "Opening Plannotator Code Review...");
                    const humanReview = await runPlannotatorCodeReviewImpl({
                        planName,
                        diffText,
                        executionCwd,
                        uiAPI,
                    });

                    const hasHumanFeedback = Boolean(
                        humanReview.feedback?.trim() || humanReview.annotations?.length,
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
                            },
                        });
                        haltReason = "User code review exited without approval or feedback.";
                        break;
                    }

                    if (humanReview.approved) {
                        appendRunWieldSystemMessage(uiAPI, "User Code Review Approved.", false, SUCCESS_MESSAGE_STYLE);
                        humanReviewMetadata = {
                            humanReviewMode: codeReviewMode,
                            humanReviewDecision: "approved",
                            humanReviewedAt: new Date().toISOString(),
                        };
                        await recordWorkflowMetricImpl({
                            category: "validation",
                            event: "human_review_result",
                            planName,
                            details: { mode: codeReviewMode, decision: "approved" },
                        });
                        executionComplete = true;
                    } else {
                        const annotationText = formatCodeReviewAnnotations(humanReview.annotations || []);
                        const feedbackText = [
                            humanReview.feedback || "(no free-text feedback provided)",
                            annotationText ? `Annotations:\n${annotationText}` : "",
                        ].filter(Boolean).join("\n\n");
                        appendRunWieldSystemMessage(
                            uiAPI,
                            `User code review returned feedback. Sending feedback back to ${
                                getAgentDisplayName(AGENTS.ENGINEER)
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
                            agentName: AGENTS.ENGINEER,
                            userRequest:
                                "The user provided feedback about your implementation during a code review. Please fix them, " +
                                `do not break existing tests, and call task_completed when finished.\n\n` +
                                `User Code Review Feedback:\n${feedbackText}`,
                            uiAPI,
                            sessionManager,
                            cwd: executionCwd,
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
                                    getAgentDisplayName(AGENTS.ENGINEER)
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
            appendRunWieldSystemMessage(
                uiAPI,
                `Review failed. Sending feedback back to ${getAgentDisplayName(AGENTS.ENGINEER)}...`,
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
                agentName: AGENTS.ENGINEER,
                userRequest: "The code reviewer found issues with your implementation. Please fix them, do not break " +
                    `existing tests, and call task_completed when finished.\n\nReviewer Feedback:\n${reviewResponse}`,
                uiAPI,
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
                    `${getAgentDisplayName(AGENTS.ENGINEER)} stopped without task_completed during semantic repair.`,
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
            appendRunWieldSystemMessage(
                uiAPI,
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
                    cleanupMergedWorktrees = shouldCleanupMergedWorktreesImpl();
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
                    appendRunWieldSystemMessage(
                        uiAPI,
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
                                appendRunWieldSystemMessage(
                                    uiAPI,
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
                            appendRunWieldSystemMessage(
                                uiAPI,
                                `Worktree merged, but post-merge verification was inconclusive: ${mergeVerification.message}`,
                                true,
                            );
                        }
                    } catch (verificationError) {
                        mergeVerified = false;
                        const verificationReason = verificationError instanceof Error
                            ? verificationError.message
                            : String(verificationError);
                        appendRunWieldSystemMessage(
                            uiAPI,
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
                        appendRunWieldSystemMessage(
                            uiAPI,
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
                            appendRunWieldSystemMessage(
                                uiAPI,
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
                            appendRunWieldSystemMessage(
                                uiAPI,
                                `Worktree merged, but cleanup failed: ${cleanupReason}`,
                                true,
                            );
                        }
                    }
                    break;
                } catch (/** @type {any} */ error) {
                    let reason = error instanceof Error ? error.message : String(error);
                    if (mergeCompleted) {
                        appendRunWieldSystemMessage(
                            uiAPI,
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
                    appendRunWieldSystemMessage(uiAPI, `Worktree merge failed: ${reason}`, true);
                    if (worktreeId) {
                        try {
                            await updateWorktreeRegistryEntryImpl(projectRoot, worktreeId, {
                                status: "merge_conflict",
                            });
                        } catch (metadataError) {
                            const metadataReason = metadataError instanceof Error
                                ? metadataError.message
                                : String(metadataError);
                            appendRunWieldSystemMessage(
                                uiAPI,
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
                            appendRunWieldSystemMessage(
                                uiAPI,
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
                        appendRunWieldSystemMessage(
                            uiAPI,
                            `Dispatching ${
                                getAgentDisplayName(AGENTS.ENGINEER)
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
                            uiAPI,
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
                        appendRunWieldSystemMessage(
                            uiAPI,
                            `${
                                getAgentDisplayName(AGENTS.ENGINEER)
                            } stopped without task_completed during merge repair.`,
                            true,
                        );
                    }

                    const action = await promptForMergeFailureAction(uiAPI, reason);
                    if (action === "retry") {
                        continue;
                    }
                    appendRunWieldSystemMessage(uiAPI, `Workflow halted: Worktree merge failed: ${reason}`, true);
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
                appendRunWieldSystemMessage(
                    uiAPI,
                    `Worktree merged, but recording Workflow Validation completion failed: ${metricReason}`,
                    true,
                );
            }
            appendRunWieldSystemMessage(
                uiAPI,
                `${triageClassificationDisplay} execution and validation complete.`,
                false,
                SUCCESS_MESSAGE_STYLE,
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
                    appendRunWieldSystemMessage(
                        uiAPI,
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
                    appendRunWieldSystemMessage(
                        uiAPI,
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
        appendRunWieldSystemMessage(uiAPI, `Workflow halted: ${reason}`, true);
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
        const createAgentHandler = __deps?.createAgentHandler ||
            (await import("../session/agent-handler.js")).createAgentHandler;
        const handler = createAgentHandler(finalAgentName, { hostedSession });
        setActiveAgentImpl(hostedSession, finalAgentName, handler, uiAPI);
    }
}
