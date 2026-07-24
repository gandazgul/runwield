/**
 * @module shared/workflow/validation
 * Mechanical and semantic validation for completed RunWield execution workflows.
 */

import { extractYaml } from "@std/front-matter";
import { dirname, fromFileUrl, join } from "@std/path";
import { AGENTS } from "../../constants.js";
import { resolvePlanExecutionPolicy, updatePlanFrontMatter } from "../../plan-store.js";
import { formatGitRequiredMessage, isGitRepositoryRequiredError } from "../git.js";
import { getAgentDisplayName } from "../session/agents.js";
import { ensureBundledAgentDefFile } from "../session/agent-assets.js";
import { runIsolatedAgentSession } from "../session/session.js";
import {
    getCodeReviewMode,
    getCustomSetting,
    getGuidedReviewMode,
    setCustomSetting,
    shouldCleanupMergedWorktrees,
} from "../settings.js";
import { extractAssistantOutput, readLatestReviewOutcome, readLatestTaskCompletedOutcome } from "./workflow.js";
import { runActiveAgentTurn, switchActiveAgent } from "../session/agent-switching.js";
import {
    emitHostedSessionRuntimeEvent,
    emitSystemStatus,
    normalizeRuntimeToolResult,
    RuntimeEventTypes,
} from "../session/session-runtime-events.js";
import { describeRuntimeTool } from "../session/tool-event-title.js";
import { requestHostedSessionInteraction, RuntimeInteractionTypes } from "../session/session-runtime-interactions.js";
import { recordManualQaChecklistMessage } from "../session/workflow-messages.js";
import { getWorkflowDiff } from "./git-snapshot.js";
import { recordPlanEvent, stageValidationPassedInExecutionWorktree } from "./plan-lifecycle.js";
import { recordWorkflowMetric } from "./metrics.js";
import { resolveValidationExecutionContext } from "./execution-context.js";
import { createPairCheckpointTool } from "../../tools/pair-checkpoint.js";
import {
    getBranchHead,
    isCommitAncestorOfBranch,
    mergeExecutionWorktree,
    preparePrimaryPlanPathForMerge,
    removeExecutionWorktree,
    restorePrimaryPlanPathAfterMergeFailure,
    sealExecutionWorktreeCandidate,
} from "../worktree.js";
import {
    findById as findWorktreeRegistryEntryById,
    removeEntry as removeWorktreeRegistryEntry,
    updateEntry as updateWorktreeRegistryEntry,
} from "../worktree-registry.js";
import { buildGuidedReviewPolicy, recommendGuidedReview } from "./guided-review.js";
import { buildLargeDiffReviewPrompt, createReviewDiffTool } from "./review-diff-tool.js";
import {
    autoGenerateWorkRecordForCompletedPlan,
    formatWorkRecordAutoGenerationResult,
} from "../work-records/auto-generation.js";

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
 * @typedef {Object} WorkflowValidationResult
 * @property {"verified"|"paused"|"failed"} kind
 * @property {string} planName
 * @property {string} projectRoot
 * @property {string} [classification]
 * @property {string} [reason]
 * @property {{ completedPlanName: string, projectRoot: string }} [epicContinuation]
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
        name: AGENTS.OPERATOR,
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
 *   runIsolatedAgentSession?: typeof runIsolatedAgentSession,
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
    const runIsolatedAgentSessionImpl = __deps?.runIsolatedAgentSession || runIsolatedAgentSession;
    const agentDef = await loadPrompt();
    const userRequest = [
        "Prepare the post-verification checklist from this source material.",
        `Name: ${name}`,
        `Classification: ${classification}`,
        "",
        "### Source context",
        context,
    ].join("\n");

    const messages = await runIsolatedAgentSessionImpl({
        hostedSession,
        agentName: AGENTS.OPERATOR,
        userRequest,
        cwd,
        _agentDefOverride: agentDef,
        includeEditFallback: false,
    });
    const checklistText = extractAssistantOutput(messages);
    if (checklistText) {
        recordManualQaChecklistMessage(
            /** @type {import('@earendil-works/pi-coding-agent').SessionManager | undefined | null} */ (
                hostedSession.getRootSessionManager?.()
            ),
            { agentName: "Operator", text: checklistText, name, classification },
        );
    }
    return messages;
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
 * @param {Object} args
 * @param {import('../session/hosted-session.js').HostedSession} args.hostedSession
 * @param {string} args.planName
 * @param {string} args.planContent
 * @param {string} args.projectRoot
 * @param {typeof runManualQaChecklistPrompt} args.runManualQaChecklistPrompt
 * @param {typeof autoGenerateWorkRecordForCompletedPlan} args.autoGenerateWorkRecordForCompletedPlan
 * @param {typeof formatWorkRecordAutoGenerationResult} args.formatWorkRecordAutoGenerationResult
 */
async function runFeaturePostVerificationHandoffs({
    hostedSession,
    planName,
    planContent,
    projectRoot,
    runManualQaChecklistPrompt,
    autoGenerateWorkRecordForCompletedPlan,
    formatWorkRecordAutoGenerationResult,
}) {
    emitRunWieldSystemStatus(
        hostedSession,
        "Preparing post-verification Manual QA checklist and Work Record generation.",
    );
    const manualQaPromise = presentManualQaChecklist({
        hostedSession,
        name: planName,
        classification: "FEATURE",
        context: planContent,
        cwd: projectRoot,
        runPrompt: runManualQaChecklistPrompt,
    });
    const workRecordPromise = autoGenerateWorkRecordForCompletedPlan({ cwd: projectRoot, planName }).catch((error) => {
        const reason = error instanceof Error ? error.message : String(error);
        return {
            status: /** @type {const} */ ("failed"),
            planName,
            error: reason,
            message:
                `Work Record generation failed for ${planName}: ${reason}. The Plan terminal state was preserved; run wld wr backfill after repair.`,
        };
    });
    const [, workRecordResult] = await Promise.all([manualQaPromise, workRecordPromise]);
    emitRunWieldSystemStatus(
        hostedSession,
        workRecordResult.message || formatWorkRecordAutoGenerationResult(workRecordResult),
        workRecordResult.status === "failed" ? "warning" : "info",
    );
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
 * @param {typeof runActiveAgentTurn} [args.runActiveAgentTurn]
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
    runActiveAgentTurn: runActiveAgentTurnImpl = runActiveAgentTurn,
    readLatestTaskCompletedOutcome: readTaskCompleted = readLatestTaskCompletedOutcome,
}) {
    const previousRootMessages = getRootMessages(hostedSession, agentName).slice();
    const fromIndex = previousRootMessages.length;
    const workflow = hostedSession.getActiveExecutionWorkflow?.();
    const customTools = workflow?.executionAgent === AGENTS.FRONTEND_ENGINEER && workflow.collaborationStyle === "pair"
        ? [createPairCheckpointTool({ hostedSession, recordWorkflowMetric })]
        : undefined;
    const messages = await runActiveAgentTurnImpl({
        hostedSession,
        agentName,
        userRequest,
        images,
        sessionManager,
        cwd,
        allowReturnToRouter: false,
        ...(customTools ? { customTools } : {}),
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
 * @param {import('../session/hosted-session.js').HostedSession} hostedSession
 * @param {number} maxValidationCycles
 * @returns {Promise<"retry" | "stop">}
 */
async function promptForSemanticValidationLimitAction(hostedSession, maxValidationCycles) {
    const response = await requestHostedSessionInteraction(hostedSession, {
        type: RuntimeInteractionTypes.SELECT,
        prompt:
            `Semantic validation did not approve after ${maxValidationCycles} cycles.\n\nRetry validation for another ${maxValidationCycles} cycles, or Stop to end the workflow.`,
        options: [
            { value: "retry", label: "Retry validation" },
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
 * @param {string} path
 * @param {string} planName
 * @returns {boolean}
 */
function isPlanMetadataPath(path, planName) {
    return path === `plans/${planName}.md`;
}

/**
 * @param {Object} opts
 * @param {string} opts.executionCwd
 * @param {string} opts.sealedExecutionCommit
 * @param {string} opts.planName
 * @returns {Promise<void>}
 */
async function assertNoUnvalidatedPostSealChanges({ executionCwd, sealedExecutionCommit, planName }) {
    const committed = await runGitForMergeVerification(executionCwd, [
        "diff",
        "--name-only",
        `${sealedExecutionCommit}..HEAD`,
    ]);
    if (committed.exitCode !== 0) {
        throw new Error(`Could not inspect post-seal execution changes: ${committed.stderr.trim()}`);
    }
    const dirty = await runGitForMergeVerification(executionCwd, ["status", "--porcelain"]);
    if (dirty.exitCode !== 0) {
        throw new Error(`Could not inspect execution worktree status after candidate sealing: ${dirty.stderr.trim()}`);
    }
    const changedPaths = [
        ...committed.stdout.split("\n").map((line) => line.trim()).filter(Boolean),
        ...dirty.stdout.split("\n").map((line) => line.slice(3).trim()).filter(Boolean),
    ];
    const nonPlanPaths = [...new Set(changedPaths.filter((path) => !isPlanMetadataPath(path, planName)))];
    if (nonPlanPaths.length > 0) {
        throw new Error(
            "Execution worktree changed after the validated candidate was sealed. " +
                "Run Workflow Validation again before publishing these files: " +
                nonPlanPaths.join(", "),
        );
    }
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

        const mergeBaseResult = await runGitForMergeVerification(projectRoot, [
            "merge-base",
            worktreeBranch,
            targetRef,
        ]);
        const mergeBase = mergeBaseResult.stdout.trim();
        if (mergeBaseResult.exitCode === 0 && mergeBase) {
            const treeDiffResult = await runGitForMergeVerification(projectRoot, [
                "diff",
                "--quiet",
                mergeBase,
                worktreeBranch,
            ]);
            if (treeDiffResult.exitCode === 0) {
                return {
                    merged: true,
                    message:
                        `${worktreeBranch} has no unmerged tree changes beyond ${targetRef}; latest branch-only metadata commit can be safely treated as merged.`,
                };
            }
        }

        const detail = (ancestorResult.stderr || ancestorResult.stdout).trim();
        return {
            merged: false,
            message: detail
                ? `${worktreeBranch} still has changes that are not merged into ${targetRef}: ${detail}`
                : `${worktreeBranch} still has changes that are not merged into ${targetRef}.`,
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

/** @type {WeakMap<object, import('../session/session-runtime-events.js').RuntimeValidationProgress>} */
const CURRENT_VALIDATION_PROGRESS = new WeakMap();

/**
 * @param {import('../session/hosted-session.js').HostedSession | undefined} hostedSession
 * @param {string} text
 * @param {"info" | "success" | "warning" | "error" | boolean} [level]
 * @param {import('../session/session-runtime-events.js').RuntimeValidationProgress} [validationProgress]
 */
function emitRunWieldSystemStatus(hostedSession, text, level = "info", validationProgress) {
    const resolvedLevel = level === true ? "error" : level === false ? "info" : level;
    if (hostedSession && validationProgress) CURRENT_VALIDATION_PROGRESS.set(hostedSession, validationProgress);
    const currentProgress = validationProgress ||
        (hostedSession ? CURRENT_VALIDATION_PROGRESS.get(hostedSession) : undefined);
    emitSystemStatus(hostedSession, text, {
        level: resolvedLevel,
        header: "RunWield",
        ...(currentProgress ? { validationProgress: structuredClone(currentProgress) } : {}),
    });
}

/**
 * @param {Omit<Partial<import('../session/session-runtime-events.js').RuntimeValidationProgress>, 'checks'> & { checks?: Partial<import('../session/session-runtime-events.js').RuntimeValidationCheckResults> }} values
 * @returns {import('../session/session-runtime-events.js').RuntimeValidationProgress}
 */
function createValidationProgress(values) {
    return {
        kind: values.kind || "workflow",
        outcome: values.outcome || "running",
        stage: values.stage || "cycle",
        checks: {
            ci: values.checks?.ci || "pending",
            semanticReview: values.checks?.semanticReview || "pending",
            humanReview: values.checks?.humanReview || "pending",
            merge: values.checks?.merge || "pending",
        },
        ...(values.cycle ? { cycle: values.cycle } : {}),
        ...(values.maxCycles ? { maxCycles: values.maxCycles } : {}),
        ...(values.totalCycle ? { totalCycle: values.totalCycle } : {}),
        ...(values.repairAttempt ? { repairAttempt: values.repairAttempt } : {}),
        ...(values.maxRepairAttempts ? { maxRepairAttempts: values.maxRepairAttempts } : {}),
        ...(values.message ? { message: values.message } : {}),
    };
}

/**
 * @typedef {Omit<Partial<import('../session/session-runtime-events.js').RuntimeValidationProgress>, 'checks' | 'cycle' | 'maxCycles' | 'totalCycle' | 'repairAttempt' | 'maxRepairAttempts' | 'message'> & { checks?: Partial<import('../session/session-runtime-events.js').RuntimeValidationCheckResults>, cycle?: number | null, maxCycles?: number | null, totalCycle?: number | null, repairAttempt?: number | null, maxRepairAttempts?: number | null, message?: string | null }} RuntimeValidationProgressPatch
 */

/**
 * @param {import('../session/session-runtime-events.js').RuntimeValidationProgress} progress
 * @param {RuntimeValidationProgressPatch} patch
 * @returns {import('../session/session-runtime-events.js').RuntimeValidationProgress}
 */
function updateValidationProgress(progress, patch) {
    const next = createValidationProgress(
        /** @type {any} */ ({
            ...progress,
            ...patch,
            checks: { ...progress.checks, ...(patch.checks || {}) },
        }),
    );
    for (const field of ["cycle", "maxCycles", "totalCycle", "repairAttempt", "maxRepairAttempts"]) {
        if (/** @type {Record<string, unknown>} */ (patch)[field] === null) {
            delete /** @type {Record<string, unknown>} */ (next)[field];
        }
    }
    if (!Object.hasOwn(patch, "message") || patch.message === null) {
        delete next.message;
    }
    return next;
}

/**
 * @param {import('../session/session-runtime-events.js').RuntimeValidationProgress} progress
 * @param {boolean} passed
 * @param {string} message
 * @returns {import('../session/session-runtime-events.js').RuntimeValidationProgress}
 */
function completeValidationProgress(progress, passed, message) {
    const terminalChecks =
        /** @type {Record<string, import('../session/session-runtime-events.js').RuntimeValidationCheckResult>} */ ({
            ...progress.checks,
        });
    for (const key of ["ci", "semanticReview", "humanReview", "merge"]) {
        if (terminalChecks[key] === "pending") {
            terminalChecks[key] = "skipped";
        } else if (terminalChecks[key] === "running") {
            terminalChecks[key] = passed ? "skipped" : "failed";
        }
    }
    return updateValidationProgress(progress, {
        outcome: passed ? "verified" : "failed",
        stage: "terminal",
        checks: terminalChecks,
        message,
        repairAttempt: progress.repairAttempt || null,
        maxRepairAttempts: progress.maxRepairAttempts || null,
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
 *   runIsolatedAgentSession?: typeof runIsolatedAgentSession,
 *   runActiveAgentTurn?: typeof runActiveAgentTurn,
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
    const runRepairAgentTurn = __deps?.runActiveAgentTurn || runActiveAgentTurn;
    const repair = __deps?.runCompletionGatedRepair ||
        ((repairArgs) =>
            runCompletionGatedRepair({
                ...repairArgs,
                runActiveAgentTurn: runRepairAgentTurn,
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
    let progress = createValidationProgress({
        kind: "mechanical",
        outcome: "running",
        stage: "ci",
        checks: { ci: "running", semanticReview: "skipped", humanReview: "skipped", merge: "skipped" },
    });

    await recordWorkflowMetricImpl({
        category: "validation",
        event: "mechanical_validation_started",
        planName: "quick-fix",
        details: { maxRepairAttempts },
    });
    emitRunWieldSystemStatus(hostedSession, "Starting QUICK_FIX Mechanical Validation.", "info", progress);

    while (true) {
        progress = updateValidationProgress(progress, {
            outcome: "running",
            stage: "ci",
            repairAttempt: repairAttempts > 0 ? repairAttempts : null,
            maxRepairAttempts: repairAttempts > 0 ? maxRepairAttempts : null,
            checks: { ci: "running" },
        });
        emitRunWieldSystemStatus(
            hostedSession,
            `Running QUICK_FIX CI Validation (Repair Attempts ${repairAttempts}/${maxRepairAttempts})...`,
            "info",
            progress,
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
            progress = updateValidationProgress(progress, {
                outcome: "paused",
                stage: "terminal",
                message: reason,
                checks: { ci: "canceled" },
            });
            emitRunWieldSystemStatus(hostedSession, reason, false, progress);
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
            progress = updateValidationProgress(progress, { checks: { ci: "passed" } });
            emitRunWieldSystemStatus(
                hostedSession,
                "QUICK_FIX Mechanical Validation passed CI.",
                "success",
                progress,
            );
            await recordWorkflowMetricImpl({
                category: "validation",
                event: "mechanical_validation_finished",
                planName: "quick-fix",
                details: { passed: true, attempts: repairAttempts },
            });
            progress = updateValidationProgress(progress, {
                outcome: "running",
                stage: "manual_qa",
                message: "Preparing QUICK_FIX manual QA checklist.",
            });
            emitRunWieldSystemStatus(
                hostedSession,
                "Preparing QUICK_FIX manual QA checklist.",
                "info",
                progress,
            );
            await presentManualQaChecklist({
                hostedSession,
                name: manualQaName,
                classification: "QUICK_FIX",
                context: manualQaContext,
                cwd: validationCwd,
                runPrompt: runManualQaChecklistPromptImpl,
            });
            progress = completeValidationProgress(progress, true, "QUICK_FIX Mechanical Validation passed.");
            emitRunWieldSystemStatus(
                hostedSession,
                "QUICK_FIX Mechanical Validation passed.",
                "success",
                progress,
            );
            await activateAgent(AGENTS.ENGINEER);
            return { passed: true, attempts: repairAttempts };
        }

        if (repairAttempts >= maxRepairAttempts) {
            const reason =
                `QUICK_FIX Mechanical Validation failed after ${maxRepairAttempts} Engineer repair attempts.`;
            progress = completeValidationProgress(
                updateValidationProgress(progress, { checks: { ci: "failed" } }),
                false,
                reason,
            );
            emitRunWieldSystemStatus(hostedSession, reason, true, progress);
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
        progress = updateValidationProgress(progress, {
            outcome: "running",
            stage: "engineer_repair",
            repairAttempt: repairAttempts,
            maxRepairAttempts,
            checks: { ci: "failed" },
        });
        emitRunWieldSystemStatus(
            hostedSession,
            `QUICK_FIX CI failed. Dispatching ${
                getAgentDisplayName(AGENTS.ENGINEER, projectRoot)
            } for repair attempt ${repairAttempts}/${maxRepairAttempts}...`,
            true,
            progress,
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
            progress = updateValidationProgress(progress, {
                outcome: "paused",
                message: reason,
            });
            emitRunWieldSystemStatus(
                hostedSession,
                `${reason} Staying with ${
                    getAgentDisplayName(AGENTS.ENGINEER, projectRoot)
                } so the user can continue the session. ` +
                    "Mechanical Validation will resume after task_completed.",
                true,
                progress,
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
                executionAgent: /** @type {"engineer"} */ (AGENTS.ENGINEER),
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
 * @param {import('../session/hosted-session.js').ActiveExecutionWorkflow} [args.executionContext]
 * @param {{
 *   runLocalCI?: typeof runLocalCI,
 *   runIsolatedAgentSession?: typeof runIsolatedAgentSession,
 *   runActiveAgentTurn?: typeof runActiveAgentTurn,
 *   runCompletionGatedRepair?: typeof runCompletionGatedRepair,
 *   runManualQaChecklistPrompt?: typeof runManualQaChecklistPrompt,
 *   readLatestTaskCompletedOutcome?: typeof readLatestTaskCompletedOutcome,
 *   getDiffText?: typeof getGitDiffText,
 *   recordPlanEvent?: typeof recordPlanEvent,
 *   stageValidationPassedInExecutionWorktree?: typeof stageValidationPassedInExecutionWorktree,
 *   updatePlanFrontMatter?: typeof updatePlanFrontMatter,
 *   preparePrimaryPlanPathForMerge?: typeof preparePrimaryPlanPathForMerge,
 *   restorePrimaryPlanPathAfterMergeFailure?: typeof restorePrimaryPlanPathAfterMergeFailure,
 *   mergeExecutionWorktree?: typeof mergeExecutionWorktree,
 *   sealExecutionWorktreeCandidate?: typeof sealExecutionWorktreeCandidate,
 *   getBranchHead?: typeof getBranchHead,
 *   isCommitAncestorOfBranch?: typeof isCommitAncestorOfBranch,
 *   assertNoUnvalidatedPostSealChanges?: typeof assertNoUnvalidatedPostSealChanges,
 *   removeExecutionWorktree?: typeof removeExecutionWorktree,
 *   removeWorktreeRegistryEntry?: typeof removeWorktreeRegistryEntry,
 *   updateWorktreeRegistryEntry?: typeof updateWorktreeRegistryEntry,
 *   findWorktreeRegistryEntryById?: typeof findWorktreeRegistryEntryById,
 *   switchActiveAgent?: typeof switchActiveAgent,
 *   loadReviewerPrompt?: typeof loadReviewerPrompt,
 *   shouldCleanupMergedWorktrees?: typeof shouldCleanupMergedWorktrees,
 *   getCodeReviewMode?: typeof getCodeReviewMode,
 *   requestInteraction?: typeof requestHostedSessionInteraction,
 *   getGuidedReviewMode?: typeof getGuidedReviewMode,
 *   verifyExecutionWorktreeMerged?: typeof verifyExecutionWorktreeMerged,
 *   resolveValidationExecutionContext?: typeof resolveValidationExecutionContext,
 *   recordWorkflowMetric?: typeof recordWorkflowMetric,
 *   autoGenerateWorkRecordForCompletedPlan?: typeof autoGenerateWorkRecordForCompletedPlan,
 *   formatWorkRecordAutoGenerationResult?: typeof formatWorkRecordAutoGenerationResult,
 * }} [args.__deps] Test-only injection point.
 */
export async function runValidationLoop({
    planName,
    planContent,
    triageMeta,
    sessionManager,
    hostedSession,
    finalAgentName,
    executionContext,
    __deps,
}) {
    if (!hostedSession) throw new Error("runValidationLoop: hostedSession is required");
    const runLocalCIImpl = __deps?.runLocalCI || runLocalCI;
    const runIsolatedAgentSessionImpl = __deps?.runIsolatedAgentSession || runIsolatedAgentSession;
    const runRepairAgentTurn = __deps?.runActiveAgentTurn || runActiveAgentTurn;
    const repair = __deps?.runCompletionGatedRepair ||
        ((args) =>
            runCompletionGatedRepair({
                ...args,
                runActiveAgentTurn: runRepairAgentTurn,
                readLatestTaskCompletedOutcome: __deps?.readLatestTaskCompletedOutcome,
                hostedSession,
            }));
    const getDiffText = __deps?.getDiffText || getGitDiffText;
    const recordPlanEventImpl = __deps?.recordPlanEvent || recordPlanEvent;
    const stageValidationPassedImpl = __deps?.stageValidationPassedInExecutionWorktree ||
        stageValidationPassedInExecutionWorktree;
    const updatePlanFrontMatterImpl = __deps?.updatePlanFrontMatter || updatePlanFrontMatter;
    const preparePrimaryPlanPathImpl = __deps?.preparePrimaryPlanPathForMerge || preparePrimaryPlanPathForMerge;
    const restorePrimaryPlanPathImpl = __deps?.restorePrimaryPlanPathAfterMergeFailure ||
        restorePrimaryPlanPathAfterMergeFailure;
    const mergeExecutionWorktreeImpl = __deps?.mergeExecutionWorktree || mergeExecutionWorktree;
    const sealExecutionWorktreeCandidateImpl = __deps?.sealExecutionWorktreeCandidate ||
        (__deps?.mergeExecutionWorktree
            ? (() => Promise.resolve({ executionCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }))
            : sealExecutionWorktreeCandidate);
    const getBranchHeadImpl = __deps?.getBranchHead ||
        (__deps?.mergeExecutionWorktree
            ? (() => Promise.resolve("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"))
            : getBranchHead);
    const isCommitAncestorOfBranchImpl = __deps?.isCommitAncestorOfBranch ||
        (__deps?.mergeExecutionWorktree ? (() => Promise.resolve(true)) : isCommitAncestorOfBranch);
    const assertNoUnvalidatedPostSealChangesImpl = __deps?.assertNoUnvalidatedPostSealChanges ||
        (__deps?.mergeExecutionWorktree ? (() => Promise.resolve()) : assertNoUnvalidatedPostSealChanges);
    const removeExecutionWorktreeImpl = __deps?.removeExecutionWorktree || removeExecutionWorktree;
    const removeWorktreeRegistryEntryImpl = __deps?.removeWorktreeRegistryEntry || removeWorktreeRegistryEntry;
    const updateWorktreeRegistryEntryImpl = __deps?.updateWorktreeRegistryEntry || updateWorktreeRegistryEntry;
    const findWorktreeRegistryEntryByIdImpl = __deps?.findWorktreeRegistryEntryById || findWorktreeRegistryEntryById;
    const loadReviewerPromptImpl = __deps?.loadReviewerPrompt || loadReviewerPrompt;
    const shouldCleanupMergedWorktreesImpl = __deps?.shouldCleanupMergedWorktrees || shouldCleanupMergedWorktrees;
    const getCodeReviewModeImpl = __deps?.getCodeReviewMode || getCodeReviewMode;
    const requestInteraction = __deps?.requestInteraction || requestHostedSessionInteraction;
    const getGuidedReviewModeImpl = __deps?.getGuidedReviewMode || getGuidedReviewMode;
    const verifyExecutionWorktreeMergedImpl = __deps?.verifyExecutionWorktreeMerged || verifyExecutionWorktreeMerged;
    const recordWorkflowMetricSource = __deps?.recordWorkflowMetric || recordWorkflowMetric;
    const autoGenerateWorkRecordForCompletedPlanImpl = __deps?.autoGenerateWorkRecordForCompletedPlan ||
        autoGenerateWorkRecordForCompletedPlan;
    const formatWorkRecordAutoGenerationResultImpl = __deps?.formatWorkRecordAutoGenerationResult ||
        formatWorkRecordAutoGenerationResult;
    const activeWorkflow = hostedSession?.getActiveExecutionWorkflow?.() || null;
    if (activeWorkflow && !activeWorkflow.executionAgent) {
        throw new Error("runValidationLoop: active execution workflow is missing executionAgent");
    }
    const policy = resolvePlanExecutionPolicy(triageMeta || {});
    if (!policy.ok && policy.reason !== "project_epic") throw new Error(policy.error);
    const executionAgent = activeWorkflow?.executionAgent || executionContext?.executionAgent ||
        (policy.ok ? policy.policy.executionAgent : AGENTS.ENGINEER);
    const initialProjectRoot = activeWorkflow?.projectRoot || executionContext?.projectRoot || hostedSession?.cwd;
    if (!initialProjectRoot) {
        throw new Error("runValidationLoop: hostedSession or active workflow projectRoot is required");
    }
    const resolveValidationExecutionContextImpl = __deps?.resolveValidationExecutionContext ||
        resolveValidationExecutionContext;
    const resolution = await resolveValidationExecutionContextImpl({
        projectRoot: initialProjectRoot,
        planName,
        triageMeta,
        explicitContext: executionContext,
        activeWorkflow,
    });
    let progress = createValidationProgress({
        kind: "workflow",
        outcome: "running",
        stage: "cycle",
        cycle: 1,
        maxCycles: 3,
        totalCycle: 1,
    });
    if (resolution.kind === "blocked") {
        progress = updateValidationProgress(progress, { checks: { ci: "failed" } });
        progress = completeValidationProgress(progress, false, `Workflow halted: ${resolution.message}`);
        emitRunWieldSystemStatus(hostedSession, resolution.message, true, progress);
        await recordWorkflowMetricSource({
            category: "validation",
            event: "workflow_validation_finished",
            planName,
            details: { passed: false, reason: resolution.reason },
        }, { cwd: initialProjectRoot });
        if (planName && planName !== "quick-fix") {
            await recordPlanEventImpl({
                cwd: initialProjectRoot,
                planName,
                event: "validation_failed",
                currentStatus: "implemented",
                details: { triageMeta, failureReason: resolution.message },
            }).catch(() => {});
        }
        return { kind: "failed", planName, projectRoot: initialProjectRoot, reason: resolution.message };
    }
    const resolvedExecutionContext = resolution.context;
    const baselineTree = resolvedExecutionContext.executionMode === "worktree"
        ? resolvedExecutionContext.baselineTree
        : undefined;
    const projectRoot = resolvedExecutionContext.projectRoot;
    const executionCwd = resolvedExecutionContext.executionCwd;
    /**
     * @param {Parameters<typeof recordWorkflowMetricSource>[0]} metric
     * @param {Parameters<typeof recordWorkflowMetricSource>[1]} [deps]
     */
    function recordWorkflowMetricImpl(metric, deps = {}) {
        return recordWorkflowMetricSource(metric, { cwd: projectRoot, ...deps });
    }
    const worktreeBranch = resolvedExecutionContext.executionMode === "worktree"
        ? resolvedExecutionContext.worktreeBranch
        : undefined;
    let worktreeBaseBranch = resolvedExecutionContext.executionMode === "worktree"
        ? resolvedExecutionContext.worktreeBaseBranch
        : undefined;
    const worktreeId = resolvedExecutionContext.executionMode === "worktree"
        ? resolvedExecutionContext.worktreeId
        : undefined;
    const nonGitInPlace = resolvedExecutionContext.executionMode === "non_git_in_place";
    if (activeWorkflow) {
        hostedSession?.clearActiveExecutionWorkflow();
    }
    /**
     * @param {Parameters<typeof repair>[0]} args
     * @returns {Promise<boolean>}
     */
    async function runWorkflowRepair(args) {
        const shouldExposeRepairContext = activeWorkflow?.executionAgent === AGENTS.FRONTEND_ENGINEER;
        if (shouldExposeRepairContext) {
            hostedSession.setActiveExecutionWorkflow({
                ...activeWorkflow,
                planName,
                triageMeta,
                executionAgent: /** @type {"frontend-engineer"} */ (AGENTS.FRONTEND_ENGINEER),
                executionCwd,
                validationContinuation: true,
            });
        }
        const completed = await repair(args);
        if (shouldExposeRepairContext && completed) {
            hostedSession.clearActiveExecutionWorkflow();
        }
        return completed;
    }
    const switchActiveAgentImpl = __deps?.switchActiveAgent || switchActiveAgent;
    const runManualQaChecklistPromptImpl = __deps?.runManualQaChecklistPrompt || runManualQaChecklistPrompt;
    /**
     * @param {string} reason
     * @returns {Promise<WorkflowValidationResult>}
     */
    const pauseForExecutionContinuation = async (reason) => {
        progress = updateValidationProgress(progress, {
            outcome: "paused",
            message: reason,
        });
        emitRunWieldSystemStatus(
            hostedSession,
            `${reason} Staying with ${
                getAgentDisplayName(executionAgent, projectRoot)
            } so the user can continue the session. ` +
                "Validation will resume after task_completed.",
            true,
            progress,
        );
        if (hostedSession) {
            const currentWorkflow = hostedSession.getActiveExecutionWorkflow?.() || null;
            const pausedWorkflow = currentWorkflow?.executionAgent === executionAgent
                ? currentWorkflow
                : activeWorkflow || {};
            hostedSession.setActiveExecutionWorkflow({
                ...pausedWorkflow,
                planName,
                triageMeta,
                executionAgent: /** @type {"engineer"|"frontend-engineer"} */ (executionAgent),
                executionCwd,
                validationContinuation: true,
            });
            await switchActiveAgentImpl(hostedSession, { agentName: executionAgent });
        }
        return { kind: "paused", planName, projectRoot, reason };
    };
    let executionComplete = false;
    let latestDiffText = "";
    /** @type {string | null} */
    let haltReason = null;
    /** @type {HumanReviewMetadata | null} */
    let humanReviewMetadata = null;
    let validationCycles = 0;
    const MAX_VALIDATION_CYCLES = 3;
    progress = createValidationProgress({
        kind: "workflow",
        outcome: "running",
        stage: "cycle",
        cycle: 1,
        maxCycles: MAX_VALIDATION_CYCLES,
        totalCycle: 1,
    });

    await recordWorkflowMetricImpl({
        category: "validation",
        event: "workflow_validation_started",
        planName,
        details: { classification: triageMeta?.classification, hasWorktree: Boolean(worktreeBranch) },
    });

    while (!executionComplete && !haltReason) {
        validationCycles++;
        const validationCycleInBatch = ((validationCycles - 1) % MAX_VALIDATION_CYCLES) + 1;
        await recordWorkflowMetricImpl({
            category: "validation",
            event: "validation_cycle_started",
            planName,
            details: { validationCycle: validationCycles, maxValidationCycles: MAX_VALIDATION_CYCLES },
        });
        progress = createValidationProgress({
            kind: "workflow",
            outcome: "running",
            stage: "cycle",
            cycle: validationCycleInBatch,
            maxCycles: MAX_VALIDATION_CYCLES,
            totalCycle: validationCycles,
        });
        emitRunWieldSystemStatus(
            hostedSession,
            `Starting Validation Cycle ${validationCycleInBatch}/${MAX_VALIDATION_CYCLES}`,
            "info",
            progress,
        );

        let buildPasses = false;
        let mechanicalAttempts = 0;

        while (!buildPasses && mechanicalAttempts < 3) {
            mechanicalAttempts++;
            progress = updateValidationProgress(progress, {
                outcome: "running",
                stage: "ci",
                repairAttempt: null,
                maxRepairAttempts: null,
                checks: { ci: "running" },
            });
            emitRunWieldSystemStatus(
                hostedSession,
                `Running CI Validation (Attempt ${mechanicalAttempts}/3)...`,
                "info",
                progress,
            );
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
                progress = updateValidationProgress(progress, {
                    outcome: "paused",
                    stage: "terminal",
                    message: "CI validation canceled.",
                    checks: { ci: "canceled" },
                });
                emitRunWieldSystemStatus(hostedSession, "CI validation canceled.", false, progress);
                return await pauseForExecutionContinuation("CI validation canceled.");
            }
            if (ciResult.exitCode === 0) {
                buildPasses = true;
                progress = updateValidationProgress(progress, { checks: { ci: "passed" } });
                emitRunWieldSystemStatus(hostedSession, "Build and tests passed.", "success", progress);
            } else {
                progress = updateValidationProgress(progress, {
                    stage: "engineer_repair",
                    repairAttempt: mechanicalAttempts,
                    maxRepairAttempts: 3,
                    checks: { ci: "failed" },
                });
                emitRunWieldSystemStatus(
                    hostedSession,
                    `Build failed. Dispatching ${
                        getAgentDisplayName(executionAgent, projectRoot)
                    } to fix syntax/types...`,
                    true,
                    progress,
                );
                await recordWorkflowMetricImpl({
                    category: "validation",
                    event: "repair_dispatched",
                    agentName: executionAgent,
                    planName,
                    details: { repairKind: "ci", validationCycle: validationCycles, attempt: mechanicalAttempts },
                });
                const completed = await runWorkflowRepair({
                    hostedSession,
                    agentName: executionAgent,
                    userRequest:
                        "The project failed CI validation. Fix the following build errors, then call task_completed " +
                        `when the repair is complete:\n\n${ciResult.output}`,
                    sessionManager,
                    cwd: executionCwd,
                });
                await recordWorkflowMetricImpl({
                    category: "validation",
                    event: "repair_completed",
                    agentName: executionAgent,
                    planName,
                    details: {
                        repairKind: "ci",
                        validationCycle: validationCycles,
                        attempt: mechanicalAttempts,
                        taskCompletedObserved: Boolean(completed),
                    },
                });
                if (!completed) {
                    return await pauseForExecutionContinuation(
                        `${
                            getAgentDisplayName(executionAgent, projectRoot)
                        } stopped without task_completed during CI repair.`,
                    );
                }
            }
        }

        if (!buildPasses) {
            haltReason ||= "CI validation failed after 3 repair attempts.";
            break;
        }

        if (nonGitInPlace) {
            progress = updateValidationProgress(progress, {
                checks: { semanticReview: "skipped", humanReview: "skipped", merge: "skipped" },
            });
            emitRunWieldSystemStatus(
                hostedSession,
                "Git is not available for this project. RunWield cannot compute a Git diff, so automated Semantic Code Review and human diff review are skipped for this in-place execution.",
                true,
                progress,
            );
            humanReviewMetadata = {
                humanReviewMode: getCodeReviewModeImpl(projectRoot),
                humanReviewDecision: "skipped",
                humanReviewedAt: null,
            };
            executionComplete = true;
            break;
        }

        progress = updateValidationProgress(progress, {
            stage: "semantic_review",
            repairAttempt: null,
            maxRepairAttempts: null,
            checks: { semanticReview: "running" },
        });
        emitRunWieldSystemStatus(hostedSession, "Running Semantic Code Review...", "info", progress);
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
                    sessionMessages = await runIsolatedAgentSessionImpl({
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
                    });
                } catch (/** @type {any} */ invocationError) {
                    const errorMsg = invocationError instanceof Error
                        ? invocationError.message
                        : String(invocationError);
                    progress = updateValidationProgress(progress, {
                        stage: "semantic_review",
                        checks: { semanticReview: "failed" },
                        message: `Semantic Reviewer execution failed: ${errorMsg}`,
                    });
                    emitRunWieldSystemStatus(
                        hostedSession,
                        `Semantic Reviewer execution failed: ${errorMsg}`,
                        true,
                        progress,
                    );
                    reviewerFailed = true;
                    reviewResponse = "";
                    sessionMessages = [];
                }

                if (!reviewerFailed) {
                    reviewOutcome = readLatestReviewOutcome(sessionMessages);
                    if (!reviewOutcome) {
                        progress = updateValidationProgress(progress, {
                            stage: "semantic_review",
                            checks: { semanticReview: "failed" },
                            message: "Semantic Reviewer did not call review_complete. Treating as execution failure.",
                        });
                        emitRunWieldSystemStatus(
                            hostedSession,
                            "Semantic Reviewer did not call review_complete. Treating as execution failure.",
                            true,
                            progress,
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
                progress = completeValidationProgress(progress, false, `Workflow halted: ${haltReason}`);
                emitRunWieldSystemStatus(hostedSession, `Workflow halted: ${haltReason}`, true, progress);
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
                progress = updateValidationProgress(progress, {
                    stage: "semantic_review",
                    checks: { semanticReview: "running" },
                });
                emitRunWieldSystemStatus(hostedSession, "Retrying Semantic Code Review...", "info", progress);
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
                        const retryMessages = await runIsolatedAgentSessionImpl({
                            hostedSession,
                            agentName: AGENTS.REVIEWER,
                            userRequest: retryPrompt,
                            cwd: executionCwd,
                            _agentDefOverride: retryAgentDef,
                            customTools: retryCustomTools.length > 0 ? retryCustomTools : undefined,
                            includeEditFallback: false,
                            // Keep retries isolated as well; failed Reviewer context must
                            // not leak into the next independent audit attempt.
                        });
                        const retryOutcome = readLatestReviewOutcome(retryMessages);
                        reviewResponse = retryOutcome?.feedback || "";
                        // Propagate the reviewOutcome up so the approved/rejected check below sees it
                        reviewOutcome = retryOutcome;
                    } catch (/** @type {any} */ retryError) {
                        const errorMsg = retryError instanceof Error ? retryError.message : String(retryError);
                        progress = updateValidationProgress(progress, {
                            stage: "semantic_review",
                            checks: { semanticReview: "failed" },
                            message: `Semantic Reviewer retry also failed: ${errorMsg}`,
                        });
                        emitRunWieldSystemStatus(
                            hostedSession,
                            `Semantic Reviewer retry also failed: ${errorMsg}`,
                            true,
                            progress,
                        );
                        reviewerFailed = true;
                    }
                } finally {
                    // SessionRuntime owns turn/busy state for the full validation operation.
                }

                if (!reviewerFailed && reviewOutcome?.feedback != null) {
                    progress = updateValidationProgress(progress, {
                        checks: { semanticReview: reviewOutcome?.approved ? "passed" : "failed" },
                    });
                    emitRunWieldSystemStatus(
                        hostedSession,
                        "Semantic Review retry completed.",
                        "success",
                        progress,
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
            progress = updateValidationProgress(progress, {
                stage: "cycle",
                checks: { semanticReview: "skipped", humanReview: "skipped" },
            });
            emitRunWieldSystemStatus(
                hostedSession,
                "No changes detected in diff. Assuming approved.",
                "success",
                progress,
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
            progress = updateValidationProgress(progress, { checks: { semanticReview: "passed" } });
            emitRunWieldSystemStatus(hostedSession, "Semantic Code Review Approved.", "success", progress);
            const codeReviewMode = getCodeReviewModeImpl(projectRoot);
            if (codeReviewMode === "none") {
                progress = updateValidationProgress(progress, { checks: { humanReview: "skipped" } });
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
                        progress = updateValidationProgress(progress, { checks: { humanReview: "skipped" } });
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
                    progress = updateValidationProgress(progress, {
                        stage: "human_review",
                        checks: { humanReview: "running" },
                    });
                    emitRunWieldSystemStatus(hostedSession, "Waiting for User Code Review...", "info", progress);
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
                        progress = updateValidationProgress(progress, {
                            checks: { humanReview: humanReview.canceled ? "canceled" : "failed" },
                        });
                        emitRunWieldSystemStatus(hostedSession, "User Code Review halted validation.", true, progress);
                        haltReason = "User code review exited without approval or feedback.";
                        break;
                    }

                    if (humanReview.approved) {
                        progress = updateValidationProgress(progress, { checks: { humanReview: "passed" } });
                        emitRunWieldSystemStatus(
                            hostedSession,
                            "User Code Review Approved.",
                            "success",
                            progress,
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
                        progress = updateValidationProgress(progress, {
                            stage: "engineer_repair",
                            repairAttempt: 1,
                            maxRepairAttempts: MAX_VALIDATION_CYCLES,
                            checks: { humanReview: "failed" },
                        });
                        emitRunWieldSystemStatus(
                            hostedSession,
                            `User code review returned feedback. Sending feedback back to ${
                                getAgentDisplayName(executionAgent, projectRoot)
                            }...\nUser Code Review Feedback:\n${feedbackText}`,
                            true,
                            progress,
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
                            agentName: executionAgent,
                            planName,
                            details: { repairKind: "human_review", validationCycle: validationCycles },
                        });
                        const completed = await runWorkflowRepair({
                            hostedSession,
                            agentName: executionAgent,
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
                            agentName: executionAgent,
                            planName,
                            details: {
                                repairKind: "human_review",
                                validationCycle: validationCycles,
                                taskCompletedObserved: Boolean(completed),
                            },
                        });
                        if (!completed) {
                            return await pauseForExecutionContinuation(
                                `${
                                    getAgentDisplayName(executionAgent, projectRoot)
                                } stopped without task_completed during human code review repair.`,
                            );
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
            progress = updateValidationProgress(progress, {
                stage: "engineer_repair",
                repairAttempt: validationCycleInBatch,
                maxRepairAttempts: MAX_VALIDATION_CYCLES,
                checks: { semanticReview: "failed" },
            });
            emitRunWieldSystemStatus(
                hostedSession,
                `Review failed. Sending feedback back to ${getAgentDisplayName(executionAgent, projectRoot)}...`,
                true,
                progress,
            );
            await recordWorkflowMetricImpl({
                category: "validation",
                event: "repair_dispatched",
                agentName: executionAgent,
                planName,
                details: { repairKind: "semantic", validationCycle: validationCycles },
            });
            const completed = await runWorkflowRepair({
                hostedSession,
                agentName: executionAgent,
                userRequest: "The code reviewer found issues with your implementation. Please fix them, do not break " +
                    `existing tests, and call task_completed when finished.\n\nReviewer Feedback:\n${reviewResponse}`,
                sessionManager,
                cwd: executionCwd,
            });
            await recordWorkflowMetricImpl({
                category: "validation",
                event: "repair_completed",
                agentName: executionAgent,
                planName,
                details: {
                    repairKind: "semantic",
                    validationCycle: validationCycles,
                    taskCompletedObserved: Boolean(completed),
                },
            });
            if (!completed) {
                return await pauseForExecutionContinuation(
                    `${
                        getAgentDisplayName(executionAgent, projectRoot)
                    } stopped without task_completed during semantic repair.`,
                );
            }
        }

        if (!executionComplete && !haltReason && validationCycleInBatch >= MAX_VALIDATION_CYCLES) {
            const action = await promptForSemanticValidationLimitAction(hostedSession, MAX_VALIDATION_CYCLES);
            if (action === "retry") {
                progress = createValidationProgress({
                    kind: "workflow",
                    outcome: "running",
                    stage: "cycle",
                    cycle: 1,
                    maxCycles: MAX_VALIDATION_CYCLES,
                    totalCycle: validationCycles + 1,
                    message: `Retrying Semantic Validation for another ${MAX_VALIDATION_CYCLES} cycles...`,
                });
                emitRunWieldSystemStatus(
                    hostedSession,
                    `Retrying Semantic Validation for another ${MAX_VALIDATION_CYCLES} cycles...`,
                    "info",
                    progress,
                );
                continue;
            }
            haltReason = `Semantic validation did not approve after ${MAX_VALIDATION_CYCLES} cycles.`;
        }
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
        let postMergeVerificationHalted = false;
        /** @type {import('../../plan-store.js').WorktreeDeliveryEvidence | undefined} */
        let deliveryEvidence;
        /** @type {string | undefined} */
        let sealedExecutionMetadataCommit;
        /** @type {string[]} */
        let preservedPlanPaths = [];
        let stagedDeliveryEvidenceKey = "";

        if (worktreeBranch && !worktreeBaseBranch && worktreeId) {
            try {
                const registryEntry = await findWorktreeRegistryEntryByIdImpl(projectRoot, worktreeId);
                if (registryEntry?.baseBranch) {
                    worktreeBaseBranch = registryEntry.baseBranch;
                    emitRunWieldSystemStatus(
                        hostedSession,
                        `Recovered target branch ${worktreeBaseBranch} from the worktree registry for ${worktreeBranch}.`,
                        "info",
                    );
                }
            } catch (error) {
                emitRunWieldSystemStatus(
                    hostedSession,
                    `Could not recover worktree target branch from the registry: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                    true,
                );
            }
        }

        if (worktreeBranch && !worktreeBaseBranch) {
            const reason =
                `Target branch metadata is missing for worktree branch ${worktreeBranch}; Workflow Validation cannot publish Delivery Evidence without a concrete target branch.`;
            emitRunWieldSystemStatus(hostedSession, reason, true);
            executionComplete = false;
            haltReason = reason;
        }

        if (worktreeBranch && !haltReason) {
            while (executionComplete) {
                const planPath = `plans/${planName}.md`;
                /** @type {Awaited<ReturnType<typeof preparePrimaryPlanPathForMerge>>[]} */
                const primaryPlanSnapshots = [];
                let mergeCompleted = false;
                try {
                    cleanupMergedWorktrees = shouldCleanupMergedWorktreesImpl(projectRoot);
                    if (!deliveryEvidence) {
                        const sealedCandidate = await sealExecutionWorktreeCandidateImpl({
                            worktreePath: executionCwd,
                            branch: worktreeBranch,
                            planName,
                            planDescription: triageMeta?.summary,
                        });
                        if (!worktreeBaseBranch) {
                            throw new Error(
                                `Target branch metadata is missing for worktree branch ${worktreeBranch}; cannot publish Delivery Evidence.`,
                            );
                        }
                        const targetHeadBeforeMerge = await getBranchHeadImpl(projectRoot, worktreeBaseBranch);
                        deliveryEvidence = {
                            version: 1,
                            mode: "worktree_merge",
                            executionCommit: sealedCandidate.executionCommit,
                            targetBranch: worktreeBaseBranch,
                            targetHeadBeforeMerge,
                        };
                    } else {
                        await assertNoUnvalidatedPostSealChangesImpl({
                            executionCwd,
                            sealedExecutionCommit: deliveryEvidence.executionCommit,
                            planName,
                        });
                    }
                    const deliveryEvidenceKey =
                        `${deliveryEvidence.executionCommit}:${deliveryEvidence.targetHeadBeforeMerge}`;
                    if (planName && planName !== "quick-fix" && stagedDeliveryEvidenceKey !== deliveryEvidenceKey) {
                        const stagingResult = await stageValidationPassedImpl({
                            projectRoot,
                            executionCwd,
                            planName,
                            details: {
                                triageMeta,
                                executionMode: "worktree",
                                deliveryEvidence,
                                worktreeStatus: "merged",
                                cleanupMergedWorktrees,
                                ...(humanReviewMetadata || {}),
                            },
                        });
                        preservedPlanPaths = stagingResult.planPaths;
                        stagedDeliveryEvidenceKey = deliveryEvidenceKey;
                    }
                    for (const relativePath of preservedPlanPaths) {
                        primaryPlanSnapshots.push(await preparePrimaryPlanPathImpl({ projectRoot, relativePath }));
                    }
                    progress = updateValidationProgress(progress, { stage: "merge", checks: { merge: "running" } });
                    emitRunWieldSystemStatus(
                        hostedSession,
                        worktreeBaseBranch
                            ? `Merging validated worktree branch ${worktreeBranch} into target branch ${worktreeBaseBranch}.`
                            : `Merging validated worktree branch ${worktreeBranch} into primary checkout.`,
                        "info",
                        progress,
                    );
                    const mergeResult = await mergeExecutionWorktreeImpl({
                        projectRoot,
                        branch: worktreeBranch,
                        targetBranch: worktreeBaseBranch,
                        worktreePath: executionCwd,
                        repairMergeWorktreePath: pendingRepairMergeWorktreePath,
                        expectedTargetHead: deliveryEvidence?.mode === "worktree_merge"
                            ? deliveryEvidence.targetHeadBeforeMerge
                            : undefined,
                        planName,
                        planDescription: triageMeta?.summary,
                        sealedExecutionCommit: deliveryEvidence?.mode === "worktree_merge"
                            ? deliveryEvidence.executionCommit
                            : undefined,
                        allowedDirtyPaths: preservedPlanPaths.length > 0 ? preservedPlanPaths : [planPath],
                        preservePlanPaths: preservedPlanPaths,
                    });
                    mergeCompleted = true;
                    mergeBackCompleted = true;
                    sealedExecutionMetadataCommit = mergeResult?.executionMetadataCommit;
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
                    let mergeVerificationFailure = "";
                    try {
                        if (deliveryEvidence?.mode === "worktree_merge") {
                            const candidateMerged = await isCommitAncestorOfBranchImpl(
                                projectRoot,
                                deliveryEvidence.executionCommit,
                                deliveryEvidence.targetBranch,
                            );
                            if (!candidateMerged) {
                                mergeVerificationFailure =
                                    `Validated candidate ${deliveryEvidence.executionCommit} is not contained in ${deliveryEvidence.targetBranch}.`;
                            }
                        }
                        if (
                            !mergeVerificationFailure && sealedExecutionMetadataCommit &&
                            deliveryEvidence?.mode === "worktree_merge"
                        ) {
                            const metadataMerged = await isCommitAncestorOfBranchImpl(
                                projectRoot,
                                sealedExecutionMetadataCommit,
                                deliveryEvidence.targetBranch,
                            );
                            if (!metadataMerged) {
                                mergeVerificationFailure =
                                    `Validation metadata commit ${sealedExecutionMetadataCommit} is not contained in ${deliveryEvidence.targetBranch}.`;
                            }
                        }
                        const mergeVerification = mergeVerificationFailure
                            ? { merged: false, message: mergeVerificationFailure }
                            : await verifyExecutionWorktreeMergedImpl({
                                projectRoot,
                                worktreeBranch,
                                worktreeBaseBranch,
                            });
                        if (!mergeVerification.merged) {
                            mergeVerificationFailure = mergeVerification.message;
                        }
                    } catch (verificationError) {
                        mergeVerificationFailure = verificationError instanceof Error
                            ? verificationError.message
                            : String(verificationError);
                    }
                    if (mergeVerificationFailure) {
                        const reason =
                            `Post-merge verification found remaining merge-back work: ${mergeVerificationFailure}`;
                        await recordWorkflowMetricImpl({
                            category: "validation",
                            event: "merge_back_result",
                            planName,
                            details: {
                                passed: false,
                                mergeFailureKind: "post_merge_verification_failed",
                                verificationFailure: mergeVerificationFailure,
                            },
                        });
                        if (mergeRepairAttempts < maxMergeRepairAttempts) {
                            mergeRepairAttempts++;
                            const repairCwd = pendingRepairMergeWorktreePath || executionCwd || projectRoot;
                            const gitStatusContext = await getGitStatusContext(repairCwd);
                            progress = updateValidationProgress(progress, { checks: { merge: "failed" } });
                            emitRunWieldSystemStatus(
                                hostedSession,
                                `Post-merge verification found remaining merge-back work. Dispatching ${
                                    getAgentDisplayName(executionAgent, projectRoot)
                                } for automatic merge repair attempt ${mergeRepairAttempts}/${maxMergeRepairAttempts}...`,
                                true,
                            );
                            await recordWorkflowMetricImpl({
                                category: "validation",
                                event: "repair_dispatched",
                                agentName: executionAgent,
                                planName,
                                details: { repairKind: "merge_verification", repairAttempt: mergeRepairAttempts },
                            });
                            const completed = await runWorkflowRepair({
                                hostedSession,
                                agentName: executionAgent,
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
                                    mergeFailureKind: "post_merge_verification_failed",
                                }),
                                sessionManager,
                                cwd: repairCwd,
                            });
                            await recordWorkflowMetricImpl({
                                category: "validation",
                                event: "repair_completed",
                                agentName: executionAgent,
                                planName,
                                details: {
                                    repairKind: "merge_verification",
                                    repairAttempt: mergeRepairAttempts,
                                    taskCompletedObserved: Boolean(completed),
                                },
                            });
                            if (completed) continue;
                            emitRunWieldSystemStatus(
                                hostedSession,
                                `${
                                    getAgentDisplayName(executionAgent, projectRoot)
                                } stopped without task_completed during merge verification repair.`,
                                true,
                            );
                        }
                        emitRunWieldSystemStatus(
                            hostedSession,
                            `Automatic merge verification repair did not complete; preserving worktree for manual recovery: ${reason}`,
                            true,
                            progress,
                        );
                        if (worktreeId) {
                            try {
                                await updateWorktreeRegistryEntryImpl(projectRoot, worktreeId, {
                                    status: "merge_conflict",
                                });
                            } catch (registryError) {
                                const registryReason = registryError instanceof Error
                                    ? registryError.message
                                    : String(registryError);
                                emitRunWieldSystemStatus(
                                    hostedSession,
                                    `Could not update worktree registry after merge verification failure: ${registryReason}`,
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
                                    `Could not update plan metadata after merge verification failure: ${metadataReason}`,
                                    true,
                                );
                            }
                        }
                        postMergeVerificationHalted = true;
                        executionComplete = false;
                        haltReason = `Post-merge verification repair did not complete: ${mergeVerificationFailure}`;
                        break;
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
                    if (cleanupMergedWorktrees && executionCwd) {
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
                    progress = updateValidationProgress(progress, { checks: { merge: "failed" } });
                    emitRunWieldSystemStatus(hostedSession, `Worktree merge failed: ${reason}`, true, progress);
                    const mergeFailureKind = getMergeFailureKind(error);

                    if (mergeFailureKind === "target_branch_advanced") {
                        await recordWorkflowMetricImpl({
                            category: "validation",
                            event: "merge_back_result",
                            planName,
                            details: { passed: false, mergeFailureKind },
                        });
                        if (planName && planName !== "quick-fix" && executionCwd) {
                            try {
                                await updatePlanFrontMatterImpl(executionCwd, planName, {
                                    status: "implemented",
                                    verifiedAt: null,
                                    deliveryEvidence: null,
                                    executionMode: null,
                                });
                            } catch (metadataError) {
                                const metadataReason = metadataError instanceof Error
                                    ? metadataError.message
                                    : String(metadataError);
                                emitRunWieldSystemStatus(
                                    hostedSession,
                                    `Could not reset staged validation metadata after target branch advanced: ${metadataReason}`,
                                    true,
                                );
                            }
                        }
                        const haltMessage = `Workflow halted: ${reason}`;
                        progress = completeValidationProgress(progress, false, haltMessage);
                        emitRunWieldSystemStatus(hostedSession, haltMessage, true, progress);
                        executionComplete = false;
                        haltReason = reason;
                        break;
                    }

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
                        details: { passed: false, mergeFailureKind },
                    });

                    if (mergeRepairAttempts < maxMergeRepairAttempts) {
                        mergeRepairAttempts++;
                        const repairCwd = getMergeRepairCwd(error) || pendingRepairMergeWorktreePath || executionCwd ||
                            projectRoot;
                        const gitStatusContext = await getGitStatusContext(repairCwd);
                        progress = updateValidationProgress(progress, {
                            stage: "engineer_repair",
                            repairAttempt: mergeRepairAttempts,
                            maxRepairAttempts: maxMergeRepairAttempts,
                            checks: { merge: "failed" },
                        });
                        emitRunWieldSystemStatus(
                            hostedSession,
                            `Dispatching ${
                                getAgentDisplayName(executionAgent, projectRoot)
                            } for merge repair attempt ${mergeRepairAttempts}/${maxMergeRepairAttempts}...`,
                            true,
                            progress,
                        );
                        await recordWorkflowMetricImpl({
                            category: "validation",
                            event: "repair_dispatched",
                            agentName: executionAgent,
                            planName,
                            details: { repairKind: "merge", repairAttempt: mergeRepairAttempts },
                        });
                        const completed = await runWorkflowRepair({
                            hostedSession,
                            agentName: executionAgent,
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
                                mergeFailureKind,
                            }),
                            sessionManager,
                            cwd: repairCwd,
                        });
                        await recordWorkflowMetricImpl({
                            category: "validation",
                            event: "repair_completed",
                            agentName: executionAgent,
                            planName,
                            details: {
                                repairKind: "merge",
                                repairAttempt: mergeRepairAttempts,
                                taskCompletedObserved: Boolean(completed),
                            },
                        });
                        if (completed) continue;
                        progress = updateValidationProgress(progress, {
                            outcome: "paused",
                            message: `${
                                getAgentDisplayName(AGENTS.ENGINEER, projectRoot)
                            } stopped without task_completed during merge repair.`,
                        });
                        emitRunWieldSystemStatus(
                            hostedSession,
                            `${
                                getAgentDisplayName(executionAgent, projectRoot)
                            } stopped without task_completed during merge repair.`,
                            true,
                            progress,
                        );
                    }

                    const action = await promptForMergeFailureAction(hostedSession, reason);
                    if (action === "retry") {
                        continue;
                    }
                    progress = completeValidationProgress(
                        progress,
                        false,
                        `Workflow halted: Worktree merge failed: ${reason}`,
                    );
                    emitRunWieldSystemStatus(
                        hostedSession,
                        `Workflow halted: Worktree merge failed: ${reason}`,
                        true,
                        progress,
                    );
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
            progress = updateValidationProgress(progress, { checks: { merge: worktreeBranch ? "passed" : "skipped" } });
            if (planName && planName !== "quick-fix" && !worktreeBranch) {
                await recordPlanEventImpl({
                    cwd: projectRoot,
                    planName,
                    event: "validation_passed",
                    currentStatus: "implemented",
                    details: {
                        triageMeta,
                        executionMode: nonGitInPlace ? "non_git_in_place" : undefined,
                        deliveryEvidence: nonGitInPlace ? { version: 1, mode: "non_git_in_place" } : undefined,
                        ...(humanReviewMetadata || {}),
                    },
                });
            }
            if (triageMeta?.classification === "FEATURE") {
                progress = updateValidationProgress(progress, {
                    outcome: "running",
                    stage: "manual_qa",
                    message: "Preparing FEATURE manual QA checklist.",
                });
                emitRunWieldSystemStatus(
                    hostedSession,
                    "Preparing FEATURE manual QA checklist.",
                    "info",
                    progress,
                );
                await runFeaturePostVerificationHandoffs({
                    hostedSession,
                    planName,
                    planContent,
                    projectRoot,
                    runManualQaChecklistPrompt: runManualQaChecklistPromptImpl,
                    autoGenerateWorkRecordForCompletedPlan: autoGenerateWorkRecordForCompletedPlanImpl,
                    formatWorkRecordAutoGenerationResult: formatWorkRecordAutoGenerationResultImpl,
                });
            }
            progress = completeValidationProgress(
                progress,
                true,
                `${triageClassificationDisplay} execution and validation complete.`,
            );
            emitRunWieldSystemStatus(
                hostedSession,
                `${triageClassificationDisplay} execution and validation complete.`,
                "success",
                progress,
            );
        } else if (haltReason) {
            await recordWorkflowMetricImpl({
                category: "validation",
                event: "workflow_validation_finished",
                planName,
                details: { passed: false, validationCycles, reason: "halted_after_merge" },
            });
            if (!postMergeVerificationHalted && worktreeId) {
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
            if (!postMergeVerificationHalted && planName && planName !== "quick-fix") {
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
        progress = completeValidationProgress(progress, false, `Workflow halted: ${reason}`);
        emitRunWieldSystemStatus(hostedSession, `Workflow halted: ${reason}`, true, progress);
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

    if (executionComplete) {
        return /** @type {WorkflowValidationResult} */ ({
            kind: "verified",
            planName,
            projectRoot,
            classification: triageMeta?.classification,
            ...(triageMeta?.classification === "FEATURE"
                ? { epicContinuation: { completedPlanName: planName, projectRoot } }
                : {}),
        });
    }
    return { kind: "failed", planName, projectRoot, reason: haltReason || "Validation stopped before completion." };
}
