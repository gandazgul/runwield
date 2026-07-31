// deno-lint-ignore-file no-unused-vars
// @ts-nocheck: legacy validation helpers are preserved during TypeScript wrapper migration.
/**
 * @module shared/workflow/validation
 * Mechanical and semantic validation for completed RunWield execution workflows.
 */

import { extractYaml } from "@std/front-matter";
import { dirname, fromFileUrl, join } from "@std/path";
import { AGENT_DEFS_DIR, AGENTS, isPlannedChangeClassification, normalizePlanClassification } from "../../constants.js";
import {
    findPlansByParent,
    getPlanRevisionForText,
    loadPlan,
    resolvePlanExecutionPolicy,
    updatePlanFrontMatter,
} from "../../plan-store.js";
import { formatGitRequiredMessage, isGitRepositoryRequiredError } from "../git.js";
import { getAgentDisplayName, loadAgentDefFromPath } from "../session/agents.js";
import { ensureBundledAgentDefFile } from "../session/agent-assets.js";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { runIsolatedAgentSession } from "../session/session.js";
import {
    getCodeReviewMode,
    getCustomSetting,
    getGuidedReviewMode,
    setCustomSetting,
    shouldCleanupMergedWorktrees,
} from "../settings.js";
import {
    extractAssistantOutput,
    readLatestReviewOutcome,
    readLatestTaskCompletedOutcome,
    readLatestTaskCompletedReport,
} from "./workflow.js";
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
import { runDirectDeliveryPublicationTransition, runValidationOutcomeTransition } from "./state-transition.ts";
import { createGitPort } from "../git-port.ts";
import { resolveValidationExecutionContext } from "./execution-context.js";
import { createPairCheckpointTool } from "../../tools/pair-checkpoint.js";
import {
    assertPreMergeCandidateUnchanged,
    checkpointExecutionWorktree,
    deleteMergedWorktreeBranch,
    mergeExecutionWorktree,
    preparePrimaryPlanPathForMerge,
    removeWorktreeGitArtifacts,
    restorePrimaryPlanPathAfterMergeFailure,
} from "../worktree.js";
import {
    findById as findWorktreeRegistryEntryById,
    removeEntry as removeWorktreeRegistryEntry,
    updateEntry as updateWorktreeRegistryEntry,
} from "../worktree-registry.js";
import { buildGuidedReviewPolicy, recommendGuidedReview } from "./guided-review.js";
import { buildDiffInspectionSection, createReviewDiffTool } from "./review-diff-tool.js";
import {
    applyRoundFindings,
    hasOpenItems,
    normalizeLedger,
    openItems,
    renderOpenItems,
    renderResolvedItems,
} from "./review-ledger.ts";
import {
    autoGenerateWorkRecordForCompletedPlan,
    formatWorkRecordAutoGenerationResult,
} from "../work-records/auto-generation.js";

export const __dirname = dirname(fromFileUrl(import.meta.url));
const WORKFLOW_PROMPTS_DIR = "workflow-prompts";
const REVIEWER_PROMPT_FILE = "reviewer-prompt.md";
const REVIEWER_VERIFY_PROMPT_FILE = "reviewer-verify-prompt.md";
const REVIEWER_FEEDBACK_ENGINEER_FILE = "reviewer-feedback-engineer.md";
const MANUAL_QA_PROMPT_FILE = "manual-qa-prompt.md";
const VALIDATION_STREAM_OUTPUT_LIMIT_BYTES = 1024 * 1024;

/**
 * @type {number} Diff size above which RunWield recommends guided human review.
 *
 * This no longer affects how the diff reaches the Reviewer — every round reads it
 * through `review_diff`. It survives purely as the "this change is large enough to
 * warrant a guided walkthrough" signal consumed by `recommendGuidedReview`.
 */
const GUIDED_REVIEW_LARGE_DIFF_BYTES = 60 * 1024;

/**
 * @typedef {Object} BundledPromptFrontMatter
 * @property {Record<string, unknown>} attrs
 * @property {string} body
 */

/** @param {unknown} error */
function isRecoverableBundledPromptReadError(error) {
    return error instanceof Deno.errors.NotFound ||
        (error instanceof TypeError && /Unexpected end of input|Prompt file was empty/i.test(error.message)) ||
        (error instanceof Error && error.message.startsWith("Bundled agent asset is missing:"));
}

/**
 * @param {unknown} parsed
 * @returns {BundledPromptFrontMatter}
 */
function normalizeBundledPromptFrontMatter(parsed) {
    if (!parsed || typeof parsed !== "object") return { attrs: {}, body: "" };
    const attrs = "attrs" in parsed && parsed.attrs && typeof parsed.attrs === "object"
        ? Object.fromEntries(Object.entries(parsed.attrs))
        : {};
    const body = "body" in parsed && typeof parsed.body === "string" ? parsed.body : "";
    return { attrs, body };
}

/**
 * @param {string} relativePath
 * @param {(path: string) => Promise<string>} readTextFile
 * @param {typeof ensureBundledAgentDefFile} ensurePromptFile
 * @returns {Promise<BundledPromptFrontMatter>}
 */
async function readBundledPromptFrontMatter(relativePath, readTextFile, ensurePromptFile) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            const promptPath = await ensurePromptFile(relativePath);
            const raw = await readTextFile(promptPath);
            if (!raw.trim()) throw new TypeError("Prompt file was empty during bundled prompt load");
            return normalizeBundledPromptFrontMatter(extractYaml(raw));
        } catch (error) {
            lastError = error;
            if (!isRecoverableBundledPromptReadError(error)) throw error;
            if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
        }
    }
    if (!isRecoverableBundledPromptReadError(lastError)) throw lastError;
    return normalizeBundledPromptFrontMatter(
        extractYaml(await Deno.readTextFile(join(AGENT_DEFS_DIR, relativePath))),
    );
}
/** @param {import('../../plan-store.js').PlanFrontMatter} attrs */
function hasDirectDeliveryEvidence(attrs) {
    if (attrs.status !== "verified") return true;
    const evidence = attrs.deliveryEvidence;
    return Boolean(
        evidence && typeof evidence === "object" &&
            (evidence.mode === "worktree_merge" || evidence.mode === "non_git_in_place"),
    );
}

/** @param {string} projectRoot @param {string} planName */
async function loadCurrentPlanRevision(projectRoot, planName) {
    const plan = await loadPlan(projectRoot, planName).catch(() => null);
    return plan?.revision;
}

/**
 * @param {string} projectRoot
 * @param {string} planName
 */
async function loadDirectDeliveryHierarchySnapshot(projectRoot, planName) {
    const plan = await loadPlan(projectRoot, planName);
    if (!plan) throw new Error(`Plan not found: ${planName}`);
    const parentValue = /** @type {{ parentPlan?: unknown }} */ (plan.attrs || {}).parentPlan;
    const parentPlan = typeof parentValue === "string" && parentValue.trim() ? parentValue : undefined;
    /** @type {Array<{ name: string, revision: string, status: string | undefined, deliveryEvidence: unknown }>} */
    const siblingPlans = [];
    if (parentPlan) {
        for (const sibling of await findPlansByParent(projectRoot, parentPlan).catch(() => [])) {
            siblingPlans.push({
                name: sibling.name,
                revision: await getPlanRevisionForText(await Deno.readTextFile(sibling.path)),
                status: sibling.attrs.status,
                deliveryEvidence: sibling.attrs.deliveryEvidence,
            });
        }
        siblingPlans.sort((a, b) => a.name.localeCompare(b.name));
    }
    return { revision: plan.revision, parentPlan, siblingPlans };
}

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
 * Every review gets the plan, read-only repository exploration tools (`read`,
 * `grep`, `find`, `ls`), and the `review_diff` tool. The diff is never inlined —
 * there is one delivery path for every round regardless of size. Reviewer has no
 * memory tools so its judgment remains grounded in the supplied evidence.
 *
 * `mode` selects the round contract: `"discovery"` sweeps the whole Plan (rounds
 * one and two), `"verify"` only checks the open ledger and the repair delta
 * (rounds three and above).
 *
 * @param {"discovery" | "verify"} [mode]
 * @param {(path: string) => Promise<string>} [readTextFile]
 * @param {typeof ensureBundledAgentDefFile} [ensurePromptFile]
 * @returns {Promise<import('../session/types.js').AgentDefinition>}
 */
export async function loadReviewerPrompt(
    mode = "discovery",
    readTextFile = Deno.readTextFile,
    ensurePromptFile = ensureBundledAgentDefFile,
) {
    const { attrs, body } = await readBundledPromptFrontMatter(
        join(WORKFLOW_PROMPTS_DIR, mode === "verify" ? REVIEWER_VERIFY_PROMPT_FILE : REVIEWER_PROMPT_FILE),
        readTextFile,
        ensurePromptFile,
    );
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
 * Load the Reviewer-Feedback Engineer definition.
 *
 * Unlike the Reviewer, this is a real execution agent and receives the full
 * shared system prompt via `loadAgentDefFromPath`. It lives under
 * `workflow-prompts/` rather than the top-level agent directory because
 * Workflow Validation dispatches it — a user never selects it, so it must stay
 * out of `/agent` listings and `return_to_router` targets.
 *
 * @param {typeof ensureBundledAgentDefFile} [ensurePromptFile]
 * @param {typeof loadAgentDefFromPath} [loadFromPath]
 * @returns {Promise<import('../session/types.js').AgentDefinition>}
 */
export async function loadReviewerFeedbackEngineerDef(
    ensurePromptFile = ensureBundledAgentDefFile,
    loadFromPath = loadAgentDefFromPath,
) {
    const promptPath = await ensurePromptFile(join(WORKFLOW_PROMPTS_DIR, REVIEWER_FEEDBACK_ENGINEER_FILE));
    return await loadFromPath(promptPath, { agentName: AGENTS.REVIEWER_FEEDBACK_ENGINEER });
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
    const { attrs, body } = await readBundledPromptFrontMatter(
        join(WORKFLOW_PROMPTS_DIR, MANUAL_QA_PROMPT_FILE),
        readTextFile,
        ensurePromptFile,
    );
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
 * @param {"QUICK_FIX"|"PLANNED_CHANGE"|"FEATURE"} args.classification
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
    const normalizedClassification = classification === "FEATURE" ? "PLANNED_CHANGE" : classification;
    const userRequest = [
        "Prepare the post-verification checklist from this source material.",
        `Name: ${name}`,
        `Classification: ${normalizedClassification}`,
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
            { agentName: "Operator", text: checklistText, name, classification: normalizedClassification },
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
 * @param {"QUICK_FIX"|"PLANNED_CHANGE"|"FEATURE"} args.classification
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
export async function runFeaturePostVerificationHandoffs({
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
        classification: "PLANNED_CHANGE",
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
 * Whether the Reviewer actually opened the diff during an invocation.
 *
 * The diff is never inlined into the prompt, so a `review_complete` call made
 * without any `review_diff` call is a verdict reached without reading the code.
 *
 * @param {import('@earendil-works/pi-agent-core').AgentMessage[]} messages
 * @returns {boolean}
 */
export function usedReviewDiffTool(messages) {
    if (!Array.isArray(messages)) return false;
    return messages.some((msg) => {
        if (!msg || typeof msg !== "object" || !("role" in msg) || msg.role !== "toolResult") return false;
        if (!("toolName" in msg) || msg.toolName !== "review_diff") return false;
        // A failed lookup or an absent repair scope is not an inspection: the
        // Reviewer saw no code, so it must not satisfy the read-before-deciding
        // requirement.
        if (/** @type {any} */ (msg).isError) return false;
        const details = /** @type {any} */ (msg).details || {};
        return details.available !== false;
    });
}

/**
 * Open ledger identities a review result failed to mention.
 *
 * The ledger only converges if every round returns a verdict on every open item.
 * An omission is not neutral: it would let an approval merge over a finding
 * nobody addressed, and it makes a re-reported issue arrive as a new identity
 * beside the original, so one defect becomes two and the count grows each round.
 *
 * @param {import('./review-ledger.ts').ReviewLedger} ledger
 * @param {import('../../tools/review-complete.js').ReviewFinding[] | undefined} findings
 * @returns {string[]}
 */
export function unaccountedOpenItems(ledger, findings) {
    const mentioned = new Set(
        (findings || []).map((finding) => finding?.id).filter((id) => typeof id === "string" && id),
    );
    return openItems(ledger).map((item) => item.id).filter((id) => !mentioned.has(id));
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
 * Choice presented when the automatic review rounds are spent.
 *
 * There is deliberately no "Stop" here. Stopping strands the work with nowhere
 * to go, which is the dead end this replaced. Either buy another verification
 * round, or hand the change to a human — whose approval is authoritative even
 * though semantic review never approved. The user can still cancel the
 * interaction itself, which falls through to another round.
 *
 * @param {import('../session/hosted-session.js').HostedSession} hostedSession
 * @param {number} semanticRound
 * @param {typeof requestHostedSessionInteraction} [requestInteraction]
 * @returns {Promise<"continue" | "code_review">}
 */
async function promptForSemanticRoundLimitAction(
    hostedSession,
    semanticRound,
    requestInteraction = requestHostedSessionInteraction,
) {
    const response = await requestInteraction(hostedSession, {
        type: RuntimeInteractionTypes.SELECT,
        prompt: `Semantic review has not approved after ${semanticRound} rounds. The latest repair has not been ` +
            "verified by a reviewer.\n\nRun another verification round, or open Code Review and decide yourself.",
        options: [
            { value: "continue", label: "Run another verification round" },
            { value: "code_review", label: "Open Code Review now" },
        ],
    });
    return response.outcome === "selected" && response.value === "code_review" ? "code_review" : "continue";
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
 * Post-merge proof: everything that had to reach the target branch did.
 *
 * The paired precondition is `assertPreMergeCandidateUnchanged` in worktree.js, which
 * runs before the ref moves. This runs after, and answers three questions that used to
 * be asked separately at each call site:
 *
 * 1. Is the validated candidate commit contained in the target branch? (the work)
 * 2. Is the metadata commit contained in it? (the Plan Front Matter that went with it)
 * 3. Is the execution branch itself contained in it? (nothing left behind)
 *
 * They are genuinely different subjects — a commit and a branch are not the same claim,
 * and they only coincide when the branch tip happens to be the metadata commit. Asking
 * them here rather than inline means one verdict, one message format, and no call site
 * that checks two of the three and calls it proof.
 *
 * Returns a verdict instead of throwing: the caller decides whether an unproven
 * publication is a halt, a repair, or a reconciliation recipe.
 *
 * @param {Object} opts
 * @param {string} opts.projectRoot
 * @param {string} opts.worktreeBranch
 * @param {string | undefined} opts.worktreeBaseBranch
 * @param {import('../git-port.ts').GitPort} opts.git
 * @param {string} [opts.executionCommit] Validated candidate, when Delivery Evidence names one.
 * @param {string} [opts.metadataCommit] Commit carrying the staged Plan metadata.
 * @param {string} [opts.targetBranch] Branch the evidence says was published to.
 * @returns {Promise<MergeVerificationResult>}
 */
export async function verifyPostMergeCandidatePublished(
    { projectRoot, worktreeBranch, worktreeBaseBranch, git, executionCommit, metadataCommit, targetBranch },
) {
    // Commit containment first: it names the exact thing validation approved, so its
    // failure is more specific than "the branch is not contained".
    if (targetBranch && executionCommit) {
        if (!(await git.isAncestor(projectRoot, executionCommit, targetBranch))) {
            return {
                merged: false,
                message: `Validated candidate ${executionCommit} is not contained in ${targetBranch}.`,
            };
        }
        if (metadataCommit && !(await git.isAncestor(projectRoot, metadataCommit, targetBranch))) {
            return {
                merged: false,
                message: `Validation metadata commit ${metadataCommit} is not contained in ${targetBranch}.`,
            };
        }
    }
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
 * Attach an unrecorded-outcome note to a halt reason.
 *
 * A halt reason is what the user reads and what the Plan's failure reason keeps.
 * If RunWield also failed to write that outcome down, saying only why the work
 * stopped would imply the Plan reflects it.
 *
 * @param {string} reason
 * @param {string} unsettledNote
 * @returns {string}
 */
function appendUnsettledNote(reason, unsettledNote) {
    return unsettledNote ? `${reason} ${unsettledNote}` : reason;
}

/**
 * Explain a lifecycle settlement that did not commit.
 *
 * When recording an outcome fails, the Plan's metadata is behind what actually
 * happened in the repository — the merge really did fail, but the Plan may still
 * read `implemented` with no reason attached. That gap is RunWield's own
 * bookkeeping, so it must be stated plainly with the commands that resolve it,
 * never left as a one-line warning the user is expected to decode.
 *
 * @param {import('./state-transition.ts').TransitionResult} transition
 * @param {string} intent What RunWield was trying to record.
 * @returns {string}
 */
function describeUnsettledTransition(transition, intent) {
    const commands = (transition.recoveryActions || [])
        .map((action) => action.command)
        .filter((command, index, all) => command && all.indexOf(command) === index);
    return [
        `RunWield could not record ${intent}: ${transition.message}`,
        "The repository change already happened; only RunWield's record of it is behind, so the Plan may still show " +
        "its previous status until this is resolved.",
        ...(commands.length > 0 ? [`Resolve it with: ${commands.join("  or  ")}`] : []),
    ].join(" ");
}

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
    return isPlannedChangeClassification(triageMeta?.classification) || triageMeta?.classification === "PROJECT";
}

/**
 * @param {import('../../tools/plan-written.js').TriageMeta} triageMeta
 * @returns {boolean}
 */
export function shouldRunWorkflowValidation(triageMeta) {
    return isPlannedChangeClassification(triageMeta?.classification) || triageMeta?.classification === "PROJECT";
}

/**
 * @param {import('../../tools/plan-written.js').TriageMeta} triageMeta
 * @returns {boolean}
 */
export function shouldContinueParentEpicAfterValidation(triageMeta) {
    const parentPlan = /** @type {{ parentPlan?: unknown }} */ (triageMeta || {}).parentPlan;
    return isPlannedChangeClassification(triageMeta?.classification) &&
        typeof parentPlan === "string" &&
        parentPlan.trim().length > 0;
}

/** @param {unknown} classification */
function formatValidationClassificationDisplay(classification) {
    if (typeof classification !== "string" || !classification.trim()) return "Plan";
    const normalized = normalizePlanClassification(classification);
    if (normalized === "PLANNED_CHANGE") return "Planned change";
    if (normalized === "QUICK_FIX") return "Quick fix";
    if (normalized === "PROJECT") return "Project";
    return "Plan";
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
                "run appropriate verification, then call task_completed when the repair is complete. " +
                "If the repair involves tests, follow the write-tests skill for sound testing behavior:\n\n" +
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
