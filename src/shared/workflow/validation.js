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
    isPlanDependencySatisfiedStatus,
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
 * @param {import('../git-port.ts').GitPort} [args.git] The Git boundary. Defaults to the real one.
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
 *   assertNoUnvalidatedPostSealChanges?: typeof assertNoUnvalidatedPostSealChanges,
 *   removeExecutionWorktree?: typeof removeExecutionWorktree,
 *   removeWorktreeRegistryEntry?: typeof removeWorktreeRegistryEntry,
 *   updateWorktreeRegistryEntry?: typeof updateWorktreeRegistryEntry,
 *   findWorktreeRegistryEntryById?: typeof findWorktreeRegistryEntryById,
 *   runValidationOutcomeTransition?: typeof runValidationOutcomeTransition,
 *   runDirectDeliveryPublicationTransition?: typeof runDirectDeliveryPublicationTransition,
 *   switchActiveAgent?: typeof switchActiveAgent,
 *   loadReviewerPrompt?: typeof loadReviewerPrompt,
 *   loadReviewerFeedbackEngineerDef?: typeof loadReviewerFeedbackEngineerDef,
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
    git = createGitPort(),
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
    // Git is a real boundary, so it arrives as a port. It used to be four entries in the
    // bag, each gated on whether `mergeExecutionWorktree` happened to be injected — so a
    // test that faked a merge silently got a constant branch head and an ancestry check
    // that always said yes, without asking for either.
    const gitPort = git;
    const sealExecutionWorktreeCandidateImpl = __deps?.sealExecutionWorktreeCandidate ||
        sealExecutionWorktreeCandidate;
    const assertNoUnvalidatedPostSealChangesImpl = __deps?.assertNoUnvalidatedPostSealChanges ||
        assertNoUnvalidatedPostSealChanges;
    const removeExecutionWorktreeImpl = __deps?.removeExecutionWorktree || removeExecutionWorktree;
    const removeWorktreeRegistryEntryImpl = __deps?.removeWorktreeRegistryEntry || removeWorktreeRegistryEntry;
    const updateWorktreeRegistryEntryImpl = __deps?.updateWorktreeRegistryEntry || updateWorktreeRegistryEntry;
    const findWorktreeRegistryEntryByIdImpl = __deps?.findWorktreeRegistryEntryById || findWorktreeRegistryEntryById;
    // The real transaction runs in tests too. Substituting a no-op stand-in whenever
    // any dependency was injected meant the whole validation-loop suite ran without
    // journaling, locking, revision checks, or rollback — so it proved the
    // choreography while leaving the atomicity guarantees untested. A test that
    // genuinely needs to observe a transition in isolation injects it by name.
    const runValidationOutcomeTransitionImpl = __deps?.runValidationOutcomeTransition ||
        runValidationOutcomeTransition;
    const runDirectDeliveryPublicationTransitionImpl = __deps?.runDirectDeliveryPublicationTransition ||
        runDirectDeliveryPublicationTransition;
    const loadReviewerPromptImpl = __deps?.loadReviewerPrompt || loadReviewerPrompt;
    const loadReviewerFeedbackEngineerDefImpl = __deps?.loadReviewerFeedbackEngineerDef ||
        loadReviewerFeedbackEngineerDef;
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
    if (resolution.restoredPlanFile) {
        emitRunWieldSystemStatus(
            hostedSession,
            `Restored missing execution worktree Plan file from the canonical Project Plan: ${resolution.restoredPlanFile.relativePath}. Continuing Workflow Validation.`,
            false,
            progress,
        );
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
                // Carry the review round, ledger, and repair baseline across the pause
                // so a nudge resumes this attempt instead of restarting at round one.
                ...roundStateForWorkflowRecord(),
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

    // Rounds one and two sweep the whole Plan; round three and beyond only verify
    // the open ledger and the repair delta. Two sweeps give a requirement missed
    // once a second independent look; narrowing after that is what lets the loop
    // terminate instead of rediscovering the implementation forever.
    const DISCOVERY_ROUNDS = 2;
    const AUTOMATIC_ROUNDS = 3;

    // Round state is rehydrated from the workflow record captured before this loop
    // cleared it, and written back whenever validation pauses. It cannot live only
    // in these locals: validation exits on every pause (see
    // pauseForExecutionContinuation) and the agent handler re-enters it from
    // scratch, so a nudge would otherwise restart at round one with an empty
    // ledger.
    let semanticRound = typeof activeWorkflow?.semanticRound === "number" && activeWorkflow.semanticRound > 0
        ? activeWorkflow.semanticRound
        : 0;
    let reviewLedger = normalizeLedger(activeWorkflow?.reviewLedger);
    let repairBaselineTree = typeof activeWorkflow?.repairBaselineTree === "string"
        ? activeWorkflow.repairBaselineTree
        : "";
    let lastRepairReport = typeof activeWorkflow?.lastRepairReport === "string" ? activeWorkflow.lastRepairReport : "";
    // Set once the change is in a human's hands — either because they chose Code
    // Review at the round limit, or because they returned feedback on a review
    // that had already been approved. From then on automatic semantic rounds are
    // over and only the human ends the loop.
    let semanticEscapeToHumanReview = typeof activeWorkflow?.humanReviewCycle === "number" &&
        activeWorkflow.humanReviewCycle > 0;
    // Human review cycles are deliberately uncapped: the loop ends when the human
    // approves or quits, not on a count. This exists for progress display and
    // metrics only — never to stop the loop.
    let humanReviewCycle = typeof activeWorkflow?.humanReviewCycle === "number" ? activeWorkflow.humanReviewCycle : 0;

    /**
     * Round state to fold into the workflow record whenever validation pauses.
     *
     * Pausing is the only exit that resumes, and `pauseForExecutionContinuation` is
     * the only place that rebuilds the record — this loop clears it on entry, so
     * there is deliberately no mid-loop write. Approval and halt are terminal and
     * need no carry-over.
     */
    const roundStateForWorkflowRecord = () => ({
        semanticRound,
        reviewLedger,
        repairBaselineTree,
        lastRepairReport,
        humanReviewCycle,
    });

    progress = createValidationProgress({
        kind: "workflow",
        outcome: "running",
        stage: "cycle",
        cycle: Math.min(semanticRound + 1, AUTOMATIC_ROUNDS),
        maxCycles: AUTOMATIC_ROUNDS,
        totalCycle: semanticRound + 1,
    });

    await recordWorkflowMetricImpl({
        category: "validation",
        event: "workflow_validation_started",
        planName,
        details: {
            classification: triageMeta?.classification,
            hasWorktree: Boolean(worktreeBranch),
            resumedAtRound: semanticRound > 0 ? semanticRound : undefined,
        },
    });

    /**
     * Dispatch review feedback to the Reviewer-Feedback Engineer in a fresh
     * isolated session.
     *
     * The repair does not run on the execution transcript. Appending it there put
     * the most correctness-sensitive task in the workflow at the tail of a long,
     * context-exhausted conversation whose whole gravity was "follow the
     * Implementation Steps" — so the findings competed with the plan for
     * attention and usually lost. A fresh session with a bounded packet makes the
     * findings the entire job.
     *
     * @param {{ reason: string, findingsSection: string, repairKind: "semantic" | "human_feedback",
     *   images?: Array<{base64: string, mimeType: string}> }} args
     * @returns {Promise<{ paused?: WorkflowValidationResult }>}
     */
    async function runReviewFeedbackRepair({ reason, findingsSection, repairKind, images }) {
        emitRunWieldSystemStatus(hostedSession, reason, true, progress);

        // Capture the pre-repair tree so the next round can diff only what this
        // repair changed. Fail closed: silently reviewing the full scope instead
        // would hide whether the repair did anything.
        try {
            repairBaselineTree = await gitPort.captureTree(executionCwd);
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            haltReason = `Could not capture the pre-repair tree for focused review: ${detail}`;
            return {};
        }

        await recordWorkflowMetricImpl({
            category: "validation",
            event: "repair_dispatched",
            agentName: AGENTS.REVIEWER_FEEDBACK_ENGINEER,
            planName,
            details: { repairKind, semanticRound },
        });

        const packet = [
            repairKind === "human_feedback"
                ? "A human reviewed this change and asked for the following. Their feedback is authoritative."
                : "A code reviewer found the following issues with this implementation. Fix every one of them.",
            "",
            "### Findings",
            "",
            findingsSection || "(no findings text supplied)",
            "",
            buildDiffInspectionSection(latestDiffText),
            "",
            "### Approved Plan",
            "",
            planContent,
            "",
            "Report a disposition for every finding in your task_completed message.",
        ].join("\n");

        let completed = false;
        let report = "";
        try {
            const agentDef = await loadReviewerFeedbackEngineerDefImpl();
            const sessionMessages = await runIsolatedAgentSessionImpl({
                hostedSession,
                agentName: AGENTS.REVIEWER_FEEDBACK_ENGINEER,
                userRequest: packet,
                images,
                cwd: executionCwd,
                _agentDefOverride: agentDef,
                customTools: [createReviewDiffTool({ full: latestDiffText })],
            });
            const outcome = readLatestTaskCompletedReport(sessionMessages);
            completed = outcome.completed;
            report = outcome.message;
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            haltReason = `Reviewer-Feedback Engineer execution failed: ${detail}`;
            return {};
        }

        lastRepairReport = report;

        await recordWorkflowMetricImpl({
            category: "validation",
            event: "repair_completed",
            agentName: AGENTS.REVIEWER_FEEDBACK_ENGINEER,
            planName,
            details: { repairKind, semanticRound, taskCompletedObserved: completed, hasReport: Boolean(report) },
        });

        if (!completed) {
            return {
                paused: await pauseForExecutionContinuation(
                    `${
                        getAgentDisplayName(AGENTS.REVIEWER_FEEDBACK_ENGINEER, projectRoot)
                    } stopped without task_completed during ${
                        repairKind === "human_feedback" ? "code review" : "semantic"
                    } repair.`,
                ),
            };
        }
        return {};
    }

    while (!executionComplete && !haltReason) {
        // Once the change is in the human's hands, automatic rounds are over: this
        // pass reruns CI, skips semantic review entirely, and reopens Code Review.
        const skipSemanticReview = semanticEscapeToHumanReview;
        if (!skipSemanticReview) semanticRound++;
        const reviewMode = semanticRound <= DISCOVERY_ROUNDS ? "discovery" : "verify";
        await recordWorkflowMetricImpl({
            category: "validation",
            event: "validation_cycle_started",
            planName,
            details: {
                semanticRound,
                reviewMode: skipSemanticReview ? "human_review_only" : reviewMode,
                automaticRounds: AUTOMATIC_ROUNDS,
            },
        });
        progress = createValidationProgress({
            kind: "workflow",
            outcome: "running",
            stage: "cycle",
            cycle: Math.min(semanticRound, AUTOMATIC_ROUNDS),
            maxCycles: AUTOMATIC_ROUNDS,
            totalCycle: semanticRound,
        });
        emitRunWieldSystemStatus(
            hostedSession,
            skipSemanticReview
                ? `Rerunning CI before reopening Code Review${
                    humanReviewCycle > 1 ? ` (feedback round ${humanReviewCycle})` : ""
                }...`
                : `Starting Review Round ${semanticRound}${
                    semanticRound <= AUTOMATIC_ROUNDS ? `/${AUTOMATIC_ROUNDS}` : ""
                } (${reviewMode === "discovery" ? "full Plan review" : "verifying repairs"})`,
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
                    semanticRound,
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
                    details: { repairKind: "ci", semanticRound, attempt: mechanicalAttempts },
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
                        semanticRound,
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

        if (!skipSemanticReview) {
            progress = updateValidationProgress(progress, {
                stage: "semantic_review",
                repairAttempt: null,
                maxRepairAttempts: null,
                checks: { semanticReview: "running" },
            });
            emitRunWieldSystemStatus(
                hostedSession,
                reviewMode === "discovery"
                    ? `Running Semantic Code Review (round ${semanticRound}, full Plan review)...`
                    : `Running Semantic Code Review (round ${semanticRound}, verifying repairs)...`,
                "info",
                progress,
            );
        }
        let diffText = "";
        let repairDiffText = "";
        let reviewResponse = "";
        let reviewOutcome = null;
        let semanticUsedLargeDiffPath = false;
        /** @type {boolean} */
        let reviewerFailed = false;
        let inspectedDiff = false;
        let roundResolvedCount = 0;
        let roundAppendedCount = 0;
        /** @type {string} */
        let reviewerPauseReason = "";
        const maxReviewerAttempts = 3;
        const reviewerToolNames = ["read", "grep", "find", "ls", "review_diff", "review_complete"];
        /**
         * Build one Reviewer invocation.
         *
         * The diff is never inlined — every round reads it through `review_diff`,
         * so there is one delivery path and no size threshold to tune. A
         * continuation attempt sends only a short nudge: the Reviewer keeps its
         * own session across attempts, so re-sending the full prompt would throw
         * away analysis it has already done.
         *
         * @param {import('../session/types.js').AgentDefinition} reviewerAgentDef
         * @param {number} attempt
         * @param {string} [nudgeReason]
         * @returns {{ prompt: string, agentDef: import('../session/types.js').AgentDefinition, customTools: import('@earendil-works/pi-coding-agent').ToolDefinition[] }}
         */
        const buildSemanticReviewAttempt = (reviewerAgentDef, attempt, nudgeReason) => {
            const hasRepairScope = Boolean(repairDiffText);
            /** @type {import('@earendil-works/pi-coding-agent').ToolDefinition[]} */
            const customTools = [
                createReviewDiffTool(hasRepairScope ? { full: diffText, repair: repairDiffText } : { full: diffText }),
            ];

            if (attempt > 1) {
                return {
                    prompt: nudgeReason ||
                        "You have not called review_complete yet. Finish this review now by calling review_complete " +
                            "with your decision. Do not restart the review — use what you have already inspected.",
                    agentDef: { ...reviewerAgentDef, tools: reviewerToolNames },
                    customTools,
                };
            }

            const sections = [
                `You are reviewing ${planName}. This is review round ${semanticRound}.`,
                "",
            ];

            if (reviewMode === "discovery" && hasOpenItems(reviewLedger)) {
                sections.push(
                    "A previous round opened the findings below and a repair has been attempted since. Sweep the Plan" +
                        " as usual **and** independently verify each open finding against the code.",
                    "",
                    "### Open Findings",
                    "",
                    renderOpenItems(reviewLedger),
                    "",
                );
            } else if (reviewMode === "verify") {
                sections.push(
                    `Rounds 1-${DISCOVERY_ROUNDS} already reviewed this implementation against the whole Plan. Verify` +
                        " the open findings below and check the repair for regressions. Do not sweep the Plan again.",
                    "",
                    "### Open Findings",
                    "",
                    renderOpenItems(reviewLedger),
                    "",
                    "### Already Resolved",
                    "",
                    renderResolvedItems(reviewLedger),
                    "",
                );
            }

            if (lastRepairReport) {
                sections.push(
                    "### Repair Agent's Report",
                    "",
                    "These are claims to verify, not proof. Check each one against the code yourself.",
                    "",
                    lastRepairReport,
                    "",
                );
            }

            sections.push(
                buildDiffInspectionSection(diffText, { hasRepairScope }),
                "",
                "### Approved Plan",
                "",
                planContent,
            );

            return {
                prompt: sections.join("\n"),
                agentDef: { ...reviewerAgentDef, tools: reviewerToolNames },
                customTools,
            };
        };
        try {
            diffText = await getDiffText(baselineTree, executionCwd);
            latestDiffText = diffText;
            semanticUsedLargeDiffPath = new TextEncoder().encode(diffText).byteLength > GUIDED_REVIEW_LARGE_DIFF_BYTES;

            // The repair scope only exists once something has been repaired, and only
            // when the baseline capture succeeded. Fail closed if the stored tree can
            // no longer be diffed: reviewing the full scope while telling the Reviewer
            // it is looking at a repair delta would make its verdict meaningless.
            if (repairBaselineTree && !skipSemanticReview) {
                try {
                    repairDiffText = await gitPort.diffTrees(
                        executionCwd,
                        repairBaselineTree,
                        await gitPort.captureTree(executionCwd),
                    );
                } catch (error) {
                    const detail = error instanceof Error ? error.message : String(error);
                    haltReason = `Could not compute the repair diff for review round ${semanticRound}: ${detail}`;
                }
            }
            if (haltReason) break;

            if (
                !skipSemanticReview &&
                (!requiresImplementationDiff(triageMeta) || hasImplementationDiff(diffText, planName)) &&
                diffText.trim()
            ) {
                let lastReviewerFailure = "Semantic Reviewer did not complete.";
                /** @type {string | undefined} */
                let nudgeReason;
                // One manager for the whole round so a continuation nudges the same
                // conversation instead of restarting the review. It is still separate
                // from the workflow root manager, so the Reviewer never sees the
                // workflow's conversation history.
                const reviewerSessionManager = SessionManager.inMemory(executionCwd);

                for (let reviewAttempt = 1; reviewAttempt <= maxReviewerAttempts && !reviewOutcome; reviewAttempt++) {
                    if (reviewAttempt > 1) {
                        progress = updateValidationProgress(progress, {
                            stage: "semantic_review",
                            checks: { semanticReview: "running" },
                        });
                        emitRunWieldSystemStatus(
                            hostedSession,
                            `Nudging Semantic Reviewer to finish round ${semanticRound} (${reviewAttempt}/${maxReviewerAttempts})...`,
                            "info",
                            progress,
                        );
                    }

                    const reviewerAgentDef = await loadReviewerPromptImpl(reviewMode);
                    const reviewAttemptConfig = buildSemanticReviewAttempt(
                        reviewerAgentDef,
                        reviewAttempt,
                        nudgeReason,
                    );
                    nudgeReason = undefined;

                    try {
                        const sessionMessages = await runIsolatedAgentSessionImpl({
                            hostedSession,
                            agentName: AGENTS.REVIEWER,
                            userRequest: reviewAttemptConfig.prompt,
                            cwd: executionCwd,
                            _agentDefOverride: reviewAttemptConfig.agentDef,
                            customTools: reviewAttemptConfig.customTools,
                            includeEditFallback: false,
                            // Isolation here means excluding the workflow's conversation
                            // history, not discarding the Reviewer's own prior turn: the
                            // dedicated manager above carries its analysis between the
                            // bounded continuation attempts within this round.
                            sessionManager: reviewerSessionManager,
                        });
                        if (usedReviewDiffTool(sessionMessages)) inspectedDiff = true;
                        const attemptOutcome = readLatestReviewOutcome(sessionMessages);
                        const unaccounted = unaccountedOpenItems(reviewLedger, attemptOutcome?.findings);
                        if (!attemptOutcome) {
                            lastReviewerFailure = "Semantic Reviewer finished without calling review_complete.";
                        } else if (!inspectedDiff) {
                            // A verdict reached without opening the diff is not a review.
                            // Spend a continuation attempt rather than trusting it.
                            lastReviewerFailure = "Semantic Reviewer decided without inspecting the diff.";
                            nudgeReason =
                                "You called review_complete without inspecting the diff. Read the changes with " +
                                'review_diff(command: "list") and then review_diff(command: "show", ...) before ' +
                                "deciding, then call review_complete again with your decision.";
                        } else if (unaccounted.length > 0) {
                            // Every open finding must come back resolved or still open.
                            // Silence is the dangerous case in both directions: it would
                            // let an approval merge over an unaddressed finding, and it
                            // makes a re-reported issue land as a duplicate alongside the
                            // original — inflating the ledger every round.
                            lastReviewerFailure = `Semantic Reviewer did not account for open finding(s): ${
                                unaccounted.join(", ")
                            }.`;
                            nudgeReason =
                                `Your result does not mention ${
                                    unaccounted.length === 1 ? "this open finding" : "these open findings"
                                }: ${
                                    unaccounted.join(", ")
                                }. Every open finding must appear in your \`findings\` array — ` +
                                "with `resolved: true` if you have verified the fix in the code, or with " +
                                "`resolved: false` and what is still missing. Reuse the existing identities exactly; " +
                                "do not renumber them or report the same issue as a new finding. Call " +
                                "review_complete again with the complete set.";
                        } else {
                            reviewOutcome = attemptOutcome;
                        }
                    } catch (/** @type {any} */ invocationError) {
                        const errorMsg = invocationError instanceof Error
                            ? invocationError.message
                            : String(invocationError);
                        lastReviewerFailure = `Semantic Reviewer execution failed: ${errorMsg}`;
                    }
                }

                if (reviewOutcome) {
                    reviewResponse = reviewOutcome.feedback || "";
                    const applied = applyRoundFindings(
                        reviewLedger,
                        reviewOutcome.findings || [],
                        semanticRound,
                    );
                    reviewLedger = applied.ledger;
                    roundResolvedCount = applied.resolvedCount;
                    roundAppendedCount = applied.appendedCount;
                    // The Reviewer's own signal wins over the ledger only when it
                    // approves; a rejection with no structured findings still needs
                    // something actionable, which the feedback projection provides.
                    progress = updateValidationProgress(progress, {
                        checks: { semanticReview: reviewOutcome.approved ? "passed" : "failed" },
                    });
                } else {
                    reviewerFailed = true;
                    // Pause rather than halt: the Reviewer's session is still the
                    // current steering target, so the user can nudge it by hand. The
                    // pause carries the round and ledger, so continuing resumes this
                    // round intact.
                    reviewerPauseReason = `${lastReviewerFailure} Review round ${semanticRound} did not finish after ` +
                        `${maxReviewerAttempts} attempts. Nudge the Reviewer to finish, or run /compact first if its ` +
                        "context is full. Validation resumes this round from the preserved findings.";
                    progress = updateValidationProgress(progress, {
                        stage: "semantic_review",
                        outcome: "paused",
                        checks: { semanticReview: "failed" },
                        message: reviewerPauseReason,
                    });
                    emitRunWieldSystemStatus(hostedSession, reviewerPauseReason, true, progress);
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

        if (reviewerFailed) {
            await recordWorkflowMetricImpl({
                category: "validation",
                event: "semantic_review_result",
                planName,
                details: {
                    semanticRound,
                    reviewMode,
                    approved: false,
                    reason: "failed_after_automatic_continuation_attempts",
                },
            });
            // Step back so the resumed run re-runs this round rather than skipping it.
            semanticRound--;
            return await pauseForExecutionContinuation(reviewerPauseReason);
        }

        if (haltReason) break;

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

        if (!reviewerFailed && (skipSemanticReview || reviewOutcome?.approved)) {
            if (skipSemanticReview) {
                // Never fabricate a semantic approval. The record has to show that a
                // human took this decision without one. The stage moves off
                // semantic_review because a skipped check cannot sit under it.
                progress = updateValidationProgress(progress, {
                    stage: "cycle",
                    checks: { semanticReview: "skipped" },
                });
                emitRunWieldSystemStatus(
                    hostedSession,
                    "Opening Code Review without semantic approval — your decision is final for this change.",
                    "info",
                    progress,
                );
            } else {
                await recordWorkflowMetricImpl({
                    category: "validation",
                    event: "semantic_review_result",
                    planName,
                    details: {
                        semanticRound,
                        reviewMode,
                        approved: true,
                        hasDiff: Boolean(diffText.trim()),
                        approvedByRoundTwo: semanticRound <= 2,
                        resolvedThisRound: roundResolvedCount,
                        advisoryCount: (reviewOutcome?.advisories || []).length,
                    },
                });
                progress = updateValidationProgress(progress, { checks: { semanticReview: "passed" } });
                emitRunWieldSystemStatus(
                    hostedSession,
                    `Semantic Code Review Approved (round ${semanticRound}).`,
                    "success",
                    progress,
                );
            }
            const codeReviewMode = getCodeReviewModeImpl(projectRoot);
            // When the user escaped to Code Review, the configured mode does not get a
            // vote: they asked for the review, and nothing else has approved this change.
            if (codeReviewMode === "none" && !skipSemanticReview) {
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
                let shouldOpenReview = codeReviewMode === "always" || skipSemanticReview;
                if (codeReviewMode === "ask" && !skipSemanticReview) {
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
                    // Quitting is the only way out of this loop other than approving.
                    // Feedback always continues it, however many times it is given.
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
                                humanReviewCycle,
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
                                // Distinguishes "human confirmed an approved change" from
                                // "human overrode an unapproved one" in the record.
                                withoutSemanticApproval: skipSemanticReview,
                                semanticRound,
                                humanReviewCycle,
                            },
                        });
                        executionComplete = true;
                    } else {
                        const annotationText = formatCodeReviewAnnotations(humanReview.annotations || []);
                        const feedbackText = [
                            humanReview.feedback || "(no free-text feedback provided)",
                            annotationText ? `Annotations:\n${annotationText}` : "",
                        ].filter(Boolean).join("\n\n");
                        humanReviewCycle++;
                        // No repairAttempt/maxRepairAttempts here: this loop has no
                        // cap, and showing "1/3" would promise a limit that does not
                        // exist.
                        progress = updateValidationProgress(progress, {
                            stage: "engineer_repair",
                            repairAttempt: null,
                            maxRepairAttempts: null,
                            checks: { humanReview: "failed" },
                        });
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
                                humanReviewCycle,
                            },
                        });
                        // Human feedback goes to the same fresh-context repair agent as
                        // semantic findings. It is scoped, concrete, and attached to a
                        // diff, so it does not need the execution transcript — but it
                        // does need the annotations and images verbatim, since that is
                        // where the human pointed.
                        const humanRepair = await runReviewFeedbackRepair({
                            reason: `User code review returned feedback. Dispatching repair...\nUser Code Review ` +
                                `Feedback:\n${feedbackText}`,
                            findingsSection: feedbackText,
                            repairKind: "human_feedback",
                            images: /** @type {Array<{base64: string, mimeType: string}>} */ (
                                /** @type {unknown} */ (humanReview.images || [])
                            ),
                        });
                        if (humanRepair.paused) return humanRepair.paused;
                        if (haltReason) break;
                        // Reopen human review on the next pass rather than re-entering
                        // automatic semantic rounds: the human owns this decision now,
                        // and this loop ends only when they approve or quit.
                        semanticEscapeToHumanReview = true;
                    }
                }
            }
        } else {
            const openCount = openItems(reviewLedger).length;
            await recordWorkflowMetricImpl({
                category: "validation",
                event: "semantic_review_result",
                planName,
                details: {
                    semanticRound,
                    reviewMode,
                    approved: false,
                    hasReviewerOutput: Boolean(reviewResponse),
                    openFindingCount: openCount,
                    resolvedThisRound: roundResolvedCount,
                    // The serial-discovery signal: how often a later round finds what
                    // an earlier one missed. High values in round 2 mean round 1's
                    // prompt needs work; high values in a verify round mean repairs
                    // are introducing damage.
                    appendedThisRound: roundAppendedCount,
                    advisoryCount: (reviewOutcome?.advisories || []).length,
                },
            });
            progress = updateValidationProgress(progress, {
                stage: "engineer_repair",
                repairAttempt: Math.min(semanticRound, AUTOMATIC_ROUNDS),
                maxRepairAttempts: AUTOMATIC_ROUNDS,
                checks: { semanticReview: "failed" },
            });

            const repairResult = await runReviewFeedbackRepair({
                reason: `Review round ${semanticRound} found ${openCount || "open"} issue(s). Dispatching repair...`,
                findingsSection: openCount > 0 ? renderOpenItems(reviewLedger) : reviewResponse,
                repairKind: "semantic",
            });
            if (repairResult.paused) return repairResult.paused;
            // The repair can halt (tree capture or agent execution failure). Stop here
            // rather than asking the user to choose a next round we are not going to
            // run — the loop condition would discard their answer.
            if (haltReason) break;

            if (semanticRound >= AUTOMATIC_ROUNDS) {
                // Automatic rounds are spent. Never strand the work: the user either
                // buys another verification round or hands the change to a human,
                // whose approval is authoritative even without semantic approval.
                const action = await promptForSemanticRoundLimitAction(
                    hostedSession,
                    semanticRound,
                    requestInteraction,
                );
                await recordWorkflowMetricImpl({
                    category: "validation",
                    event: "semantic_round_limit_choice",
                    planName,
                    details: { semanticRound, choice: action, openFindingCount: openItems(reviewLedger).length },
                });
                if (action === "code_review") {
                    // Hand the change to the human. From here the loop ends only on
                    // their approval or their exit — no automatic path closes it.
                    semanticEscapeToHumanReview = true;
                    humanReviewCycle = Math.max(humanReviewCycle, 1);
                    continue;
                }
                progress = updateValidationProgress(progress, {
                    outcome: "running",
                    stage: "cycle",
                    message: `Continuing with verification round ${semanticRound + 1}...`,
                });
                emitRunWieldSystemStatus(
                    hostedSession,
                    `Continuing with verification round ${semanticRound + 1}...`,
                    "info",
                    progress,
                );
            }
        }
    }

    if (executionComplete) {
        const triageClassificationDisplay = formatValidationClassificationDisplay(triageMeta?.classification);
        let cleanupMergedWorktrees = true;
        const maxMergeRepairAttempts = 2;
        const maxTargetAdvanceRetries = 3;
        let mergeRepairAttempts = 0;
        let targetAdvanceRetries = 0;
        /** @type {string | undefined} */
        let pendingRepairMergeWorktreePath;
        let mergeBackCompleted = false;
        let postMergeVerificationHalted = false;
        // Set when RunWield failed to record a lifecycle outcome. Carried into the
        // halt reason so a run never ends describing state it did not manage to write.
        let unsettledLifecycleNote = "";
        /** @type {import('../../plan-store.js').WorktreeDeliveryEvidence | undefined} */
        let deliveryEvidence;
        /** @type {string | undefined} */
        let sealedExecutionMetadataCommit;
        /** @type {string[]} */
        let preservedPlanPaths = [];
        let stagedDeliveryEvidenceKey = "";
        /** @type {string | undefined} */
        let validatedExecutionCommit;

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
                        if (!validatedExecutionCommit) {
                            const sealedCandidate = await sealExecutionWorktreeCandidateImpl({
                                worktreePath: executionCwd,
                                branch: worktreeBranch,
                                planName,
                                planDescription: triageMeta?.summary,
                            });
                            validatedExecutionCommit = sealedCandidate.executionCommit;
                        } else {
                            await assertNoUnvalidatedPostSealChangesImpl({
                                executionCwd,
                                sealedExecutionCommit: validatedExecutionCommit,
                                planName,
                            });
                        }
                        if (!worktreeBaseBranch) {
                            throw new Error(
                                `Target branch metadata is missing for worktree branch ${worktreeBranch}; cannot publish Delivery Evidence.`,
                            );
                        }
                        const targetHeadBeforeMerge = await gitPort.branchHead(projectRoot, worktreeBaseBranch);
                        deliveryEvidence = {
                            version: 1,
                            mode: "worktree_merge",
                            executionCommit: validatedExecutionCommit,
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
                    progress = updateValidationProgress(progress, { stage: "merge", checks: { merge: "running" } });
                    emitRunWieldSystemStatus(
                        hostedSession,
                        worktreeBaseBranch
                            ? `Merging validated worktree branch ${worktreeBranch} into target branch ${worktreeBaseBranch}.`
                            : `Merging validated worktree branch ${worktreeBranch} into primary checkout.`,
                        "info",
                        progress,
                    );
                    const directDeliveryHierarchy = planName && planName !== "quick-fix"
                        ? await loadDirectDeliveryHierarchySnapshot(projectRoot, planName).catch(() => ({
                            revision: undefined,
                            parentPlan: undefined,
                            siblingPlans: [],
                        }))
                        : { revision: undefined, parentPlan: undefined, siblingPlans: [] };
                    const directDeliveryParentPlan = directDeliveryHierarchy.parentPlan;
                    const directDeliverySiblingPlans = directDeliveryHierarchy.siblingPlans;
                    const directDeliverySiblingPlanNames = directDeliverySiblingPlans.map((plan) => plan.name);
                    let mergeVerificationAlreadyProved = false;
                    const mergeResult = await (planName && planName !== "quick-fix"
                        ? (async () => {
                            /** @type {Awaited<ReturnType<typeof mergeExecutionWorktreeImpl>> | undefined} */
                            let result;
                            return await runDirectDeliveryPublicationTransitionImpl({
                                projectRoot,
                                planName,
                                expectedRevision: directDeliveryHierarchy.revision,
                                worktreeId,
                                targetRef: worktreeBaseBranch,
                                parentPlan: directDeliveryParentPlan,
                                siblingPlanNames: directDeliverySiblingPlanNames,
                                publicationProof: {
                                    deliveryEvidence,
                                    cleanupMergedWorktrees,
                                    phase: "stage_merge_settle",
                                },
                                publish: async ({ beforePlan, markEffect, registerRollback }) => {
                                    const lockedParentValue =
                                        /** @type {{ parentPlan?: unknown }} */ (beforePlan?.attrs || {})
                                            .parentPlan;
                                    const lockedParentPlan = typeof lockedParentValue === "string" &&
                                            lockedParentValue.trim()
                                        ? lockedParentValue
                                        : undefined;
                                    if (lockedParentPlan !== directDeliveryParentPlan) {
                                        throw new Error(
                                            `Direct Delivery parent changed while publishing ${planName}; retry validation with the current Plan hierarchy.`,
                                        );
                                    }
                                    /** @type {Array<{ name: string, revision: string, status: string | undefined, deliveryEvidence: unknown }>} */
                                    const lockedSiblingPlans = [];
                                    if (directDeliveryParentPlan) {
                                        for (
                                            const plan of await findPlansByParent(
                                                projectRoot,
                                                directDeliveryParentPlan,
                                            ).catch(() => [])
                                        ) {
                                            lockedSiblingPlans.push({
                                                name: plan.name,
                                                revision: await getPlanRevisionForText(
                                                    await Deno.readTextFile(plan.path),
                                                ),
                                                status: plan.attrs.status,
                                                deliveryEvidence: plan.attrs.deliveryEvidence,
                                            });
                                        }
                                        lockedSiblingPlans.sort((a, b) => a.name.localeCompare(b.name));
                                    }
                                    const lockedSiblingPlanNames = lockedSiblingPlans.map((plan) => plan.name);
                                    if (
                                        lockedSiblingPlanNames.join("\n") !== directDeliverySiblingPlanNames.join("\n")
                                    ) {
                                        throw new Error(
                                            `Direct Delivery sibling set changed while publishing ${planName}; retry validation with the current parent Epic child set.`,
                                        );
                                    }
                                    for (const expected of directDeliverySiblingPlans) {
                                        const locked = lockedSiblingPlans.find((plan) => plan.name === expected.name);
                                        if (
                                            !locked || locked.revision !== expected.revision ||
                                            locked.status !== expected.status ||
                                            JSON.stringify(locked.deliveryEvidence ?? null) !==
                                                JSON.stringify(expected.deliveryEvidence ?? null)
                                        ) {
                                            throw new Error(
                                                `Direct Delivery sibling ${expected.name} changed while publishing ${planName}; retry validation with current child evidence.`,
                                            );
                                        }
                                        const projectedAttrs =
                                            /** @type {import('../../plan-store.js').PlanFrontMatter} */ ({
                                                status: locked.name === planName ? "verified" : locked.status,
                                                deliveryEvidence: locked.name === planName
                                                    ? deliveryEvidence
                                                    : locked.deliveryEvidence,
                                            });
                                        if (
                                            !isPlanDependencySatisfiedStatus(projectedAttrs.status) ||
                                            !hasDirectDeliveryEvidence(projectedAttrs)
                                        ) {
                                            throw new Error(
                                                `Direct Delivery sibling ${expected.name} is not eligible for Epic publication; retry after every child has mode-appropriate Delivery Evidence.`,
                                            );
                                        }
                                    }
                                    if (stagedDeliveryEvidenceKey !== deliveryEvidenceKey) {
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
                                        primaryPlanSnapshots.push(
                                            await preparePrimaryPlanPathImpl({ projectRoot, relativePath }),
                                        );
                                    }
                                    if (primaryPlanSnapshots.length > 0) {
                                        registerRollback("restore_primary_plan_snapshots", async () => {
                                            if (mergeCompleted) return;
                                            for (const snapshot of primaryPlanSnapshots.toReversed()) {
                                                await restorePrimaryPlanPathImpl(snapshot);
                                            }
                                            primaryPlanSnapshots.splice(0, primaryPlanSnapshots.length);
                                        });
                                    }
                                    await markEffect("direct_delivery_publication_started", {
                                        planName,
                                        worktreeId,
                                        worktreeBranch,
                                        targetBranch: worktreeBaseBranch,
                                        expectedTargetHead: deliveryEvidence?.mode === "worktree_merge"
                                            ? deliveryEvidence.targetHeadBeforeMerge
                                            : undefined,
                                        sealedExecutionCommit: deliveryEvidence?.mode === "worktree_merge"
                                            ? deliveryEvidence.executionCommit
                                            : undefined,
                                        preservedPlanPaths,
                                    });
                                    result = await mergeExecutionWorktreeImpl({
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
                                        allowedDirtyPaths: preservedPlanPaths.length > 0
                                            ? preservedPlanPaths
                                            : [planPath],
                                        preservePlanPaths: preservedPlanPaths,
                                    });
                                    mergeCompleted = true;
                                    mergeBackCompleted = true;
                                    sealedExecutionMetadataCommit = result?.executionMetadataCommit;
                                    await markEffect("direct_delivery_target_ref_moved", {
                                        planName,
                                        worktreeId,
                                        worktreeBranch,
                                        targetBranch: worktreeBaseBranch,
                                        updatedPrimaryCheckout: result?.updatedPrimaryCheckout,
                                        executionMetadataCommit: result?.executionMetadataCommit,
                                        sealedExecutionCommit: deliveryEvidence?.mode === "worktree_merge"
                                            ? deliveryEvidence.executionCommit
                                            : undefined,
                                        expectedTargetHead: deliveryEvidence?.mode === "worktree_merge"
                                            ? deliveryEvidence.targetHeadBeforeMerge
                                            : undefined,
                                    });
                                    let mergeVerificationFailure = "";
                                    if (deliveryEvidence?.mode === "worktree_merge") {
                                        const candidateMerged = await gitPort.isAncestor(
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
                                        !mergeVerificationFailure && result?.executionMetadataCommit &&
                                        deliveryEvidence?.mode === "worktree_merge"
                                    ) {
                                        const metadataMerged = await gitPort.isAncestor(
                                            projectRoot,
                                            result.executionMetadataCommit,
                                            deliveryEvidence.targetBranch,
                                        );
                                        if (!metadataMerged) {
                                            mergeVerificationFailure =
                                                `Validation metadata commit ${result.executionMetadataCommit} is not contained in ${deliveryEvidence.targetBranch}.`;
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
                                        throw new Error(
                                            `Direct Delivery publication requires reconciliation: ${mergeVerification.message}`,
                                        );
                                    }
                                    mergeVerificationAlreadyProved = true;
                                    if (result?.updatedPrimaryCheckout === false) {
                                        for (const snapshot of primaryPlanSnapshots.toReversed()) {
                                            await restorePrimaryPlanPathImpl(snapshot);
                                        }
                                        primaryPlanSnapshots.splice(0, primaryPlanSnapshots.length);
                                    }
                                    if (worktreeId) {
                                        await updateWorktreeRegistryEntryImpl(projectRoot, worktreeId, {
                                            status: "merged",
                                        });
                                        await markEffect("worktree_registry_updated", { worktreeId, status: "merged" });
                                    }
                                    return { mergeResult: result, siblingPlanNames: lockedSiblingPlanNames };
                                },
                            }).then((transition) => {
                                if (transition.status !== "committed") {
                                    // Rethrow the original failure, not a summary of it. The merge
                                    // handler below classifies typed merge errors and reads the
                                    // worktree to repair in off them; a fresh Error would strip that
                                    // and send repair to the wrong checkout with a generic reason.
                                    if (transition.cause !== undefined) throw transition.cause;
                                    throw new Error(
                                        transition.message ||
                                            `Direct Delivery publication transaction did not commit for ${planName}.`,
                                    );
                                }
                                return result;
                            });
                        })()
                        : await mergeExecutionWorktreeImpl({
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
                        }));
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
                            const candidateMerged = await gitPort.isAncestor(
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
                            const metadataMerged = await gitPort.isAncestor(
                                projectRoot,
                                sealedExecutionMetadataCommit,
                                deliveryEvidence.targetBranch,
                            );
                            if (!metadataMerged) {
                                mergeVerificationFailure =
                                    `Validation metadata commit ${sealedExecutionMetadataCommit} is not contained in ${deliveryEvidence.targetBranch}.`;
                            }
                        }
                        const mergeVerification = mergeVerificationFailure || mergeVerificationAlreadyProved
                            ? { merged: mergeVerificationAlreadyProved, message: mergeVerificationFailure }
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
                        if (planName && planName !== "quick-fix") {
                            emitRunWieldSystemStatus(
                                hostedSession,
                                `Direct Delivery publication needs reconciliation after target-ref verification failed: ${reason}`,
                                true,
                                progress,
                            );
                            postMergeVerificationHalted = true;
                            executionComplete = false;
                            haltReason =
                                `Direct Delivery publication needs reconciliation: ${mergeVerificationFailure}`;
                            break;
                        }
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
                        if (planName && planName !== "quick-fix") {
                            const transition = await runValidationOutcomeTransitionImpl({
                                projectRoot,
                                planName,
                                expectedRevision: await loadCurrentPlanRevision(projectRoot, planName),
                                worktreeId,
                                targetRef: worktreeBaseBranch,
                                outcome: "merge_failed",
                                proof: { reason, worktreePath: executionCwd, worktreeBranch, worktreeBaseBranch },
                                settle: async ({ markEffect }) => {
                                    /** @type {Error | undefined} */
                                    let registryFailure;
                                    if (worktreeId) {
                                        try {
                                            await updateWorktreeRegistryEntryImpl(projectRoot, worktreeId, {
                                                status: "merge_conflict",
                                            });
                                            await markEffect("worktree_registry_updated", {
                                                worktreeId,
                                                status: "merge_conflict",
                                            });
                                        } catch (error) {
                                            registryFailure = error instanceof Error ? error : new Error(String(error));
                                            emitRunWieldSystemStatus(
                                                hostedSession,
                                                `Could not update worktree registry after merge verification failure: ${registryFailure.message}`,
                                                true,
                                            );
                                        }
                                    }
                                    let attrs;
                                    try {
                                        attrs = await recordPlanEventImpl({
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
                                        throw metadataError;
                                    }
                                    if (registryFailure) throw registryFailure;
                                    return attrs;
                                },
                            });
                            if (transition.status !== "committed") {
                                unsettledLifecycleNote = describeUnsettledTransition(
                                    transition,
                                    `the merge verification failure for ${planName}`,
                                );
                                emitRunWieldSystemStatus(hostedSession, unsettledLifecycleNote, true);
                            }
                        } else if (worktreeId) {
                            await updateWorktreeRegistryEntryImpl(projectRoot, worktreeId, {
                                status: "merge_conflict",
                            });
                        }
                        postMergeVerificationHalted = true;
                        executionComplete = false;
                        haltReason = appendUnsettledNote(
                            `Post-merge verification repair did not complete: ${mergeVerificationFailure}`,
                            unsettledLifecycleNote,
                        );
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
                    if (planName && planName !== "quick-fix" && cleanupMergedWorktrees && executionCwd) {
                        try {
                            await removeExecutionWorktreeImpl({
                                projectRoot,
                                path: executionCwd,
                                branch: worktreeBranch,
                                force: false,
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
                                `Worktree published and registry settlement completed, but cleanup needs manual follow-up: ${cleanupReason}`,
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
                                const rollbackTransition = await runValidationOutcomeTransitionImpl({
                                    projectRoot: executionCwd,
                                    planName,
                                    expectedRevision: await loadCurrentPlanRevision(executionCwd, planName),
                                    outcome: "retry",
                                    proof: { reason: "target_branch_advanced_metadata_rollback" },
                                    settle: async ({ beforePlan }) => {
                                        // Keep the attempt's worktree metadata: the retry below
                                        // republishes from this same attempt, so clearing it would
                                        // strand the worktree.
                                        await updatePlanFrontMatterImpl(
                                            executionCwd,
                                            planName,
                                            {
                                                status: "implemented",
                                                verifiedAt: null,
                                                deliveryEvidence: null,
                                                executionMode: "worktree",
                                                executionBaselineTree: baselineTree,
                                                worktreeId,
                                                worktreePath: executionCwd,
                                                worktreeBranch,
                                                worktreeBaseBranch,
                                                worktreeStatus: "completed",
                                            },
                                            beforePlan?.attrs || {},
                                            { expectedRevision: beforePlan?.revision },
                                        );
                                    },
                                });
                                if (rollbackTransition.status !== "committed") {
                                    throw new Error(
                                        rollbackTransition.message ||
                                            `Validation metadata rollback transaction did not commit for ${planName}.`,
                                    );
                                }
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
                        deliveryEvidence = undefined;
                        stagedDeliveryEvidenceKey = "";
                        preservedPlanPaths = [];
                        sealedExecutionMetadataCommit = undefined;
                        if (targetAdvanceRetries < maxTargetAdvanceRetries) {
                            targetAdvanceRetries++;
                            emitRunWieldSystemStatus(
                                hostedSession,
                                `Target branch advanced during publication; retrying merge against its current head ` +
                                    `(${targetAdvanceRetries}/${maxTargetAdvanceRetries}).`,
                                "info",
                            );
                            continue;
                        }
                        const haltMessage = `Workflow halted: ${reason}`;
                        progress = completeValidationProgress(progress, false, haltMessage);
                        emitRunWieldSystemStatus(hostedSession, haltMessage, true, progress);
                        executionComplete = false;
                        haltReason = reason;
                        break;
                    }

                    if (planName && planName !== "quick-fix") {
                        const transition = await runValidationOutcomeTransitionImpl({
                            projectRoot,
                            planName,
                            expectedRevision: await loadCurrentPlanRevision(projectRoot, planName),
                            worktreeId,
                            targetRef: worktreeBaseBranch,
                            outcome: "merge_failed",
                            proof: { reason, worktreePath: executionCwd, worktreeBranch, worktreeBaseBranch },
                            settle: async ({ markEffect }) => {
                                /** @type {Error | undefined} */
                                let registryFailure;
                                if (worktreeId) {
                                    try {
                                        await updateWorktreeRegistryEntryImpl(projectRoot, worktreeId, {
                                            status: "merge_conflict",
                                        });
                                        await markEffect("worktree_registry_updated", {
                                            worktreeId,
                                            status: "merge_conflict",
                                        });
                                    } catch (error) {
                                        registryFailure = error instanceof Error ? error : new Error(String(error));
                                        emitRunWieldSystemStatus(
                                            hostedSession,
                                            `Could not update worktree registry while merge conflict is active: ${registryFailure.message}`,
                                            true,
                                        );
                                    }
                                }
                                let attrs;
                                try {
                                    attrs = await recordPlanEventImpl({
                                        cwd: projectRoot,
                                        planName,
                                        event: "worktree_merge_failed",
                                        currentStatus: "implemented",
                                        details: {
                                            triageMeta,
                                            failureReason: reason,
                                            worktreeId,
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
                                    throw metadataError;
                                }
                                if (registryFailure) throw registryFailure;
                                return attrs;
                            },
                        });
                        if (transition.status !== "committed") {
                            unsettledLifecycleNote = describeUnsettledTransition(
                                transition,
                                `the merge failure for ${planName}`,
                            );
                            emitRunWieldSystemStatus(hostedSession, unsettledLifecycleNote, true);
                        }
                    } else if (worktreeId) {
                        await updateWorktreeRegistryEntryImpl(projectRoot, worktreeId, { status: "merge_conflict" });
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
                    haltReason = appendUnsettledNote(`Worktree merge failed: ${reason}`, unsettledLifecycleNote);
                }
            }
        }

        if (executionComplete) {
            try {
                await recordWorkflowMetricImpl({
                    category: "validation",
                    event: "workflow_validation_finished",
                    planName,
                    details: {
                        passed: true,
                        semanticRounds: semanticRound,
                        hasWorktreeBranch: Boolean(worktreeBranch),
                    },
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
            if (isPlannedChangeClassification(triageMeta?.classification)) {
                progress = updateValidationProgress(progress, {
                    outcome: "running",
                    stage: "manual_qa",
                    message: "Preparing Planned Change manual QA checklist.",
                });
                emitRunWieldSystemStatus(
                    hostedSession,
                    "Preparing Planned Change manual QA checklist.",
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
                details: { passed: false, semanticRounds: semanticRound, reason: "halted_after_merge" },
            });
            if (!postMergeVerificationHalted && planName && planName !== "quick-fix") {
                const transition = await runValidationOutcomeTransitionImpl({
                    projectRoot,
                    planName,
                    expectedRevision: await loadCurrentPlanRevision(projectRoot, planName),
                    worktreeId,
                    targetRef: worktreeBaseBranch,
                    outcome: "failed",
                    proof: { failureReason: haltReason || "Validation halted.", nonGitInPlace },
                    settle: async ({ markEffect }) => {
                        if (worktreeId) {
                            await updateWorktreeRegistryEntryImpl(projectRoot, worktreeId, {
                                status: "validation_failed",
                            });
                            await markEffect("worktree_registry_updated", { worktreeId, status: "validation_failed" });
                        }
                        return await recordPlanEventImpl({
                            cwd: projectRoot,
                            planName,
                            event: "validation_failed",
                            currentStatus: "implemented",
                            details: { triageMeta, failureReason: haltReason || "Validation halted.", nonGitInPlace },
                        });
                    },
                });
                if (transition.status !== "committed") {
                    emitRunWieldSystemStatus(
                        hostedSession,
                        `Could not settle validation halt transaction: ${transition.message}`,
                        true,
                    );
                }
            } else if (!postMergeVerificationHalted && worktreeId) {
                await updateWorktreeRegistryEntryImpl(projectRoot, worktreeId, { status: "validation_failed" });
            }
        }
    } else {
        const reason = haltReason || "Validation stopped before completion.";
        await recordWorkflowMetricImpl({
            category: "validation",
            event: "workflow_validation_finished",
            planName,
            details: { passed: false, semanticRounds: semanticRound, reason: "halted" },
        });
        progress = completeValidationProgress(progress, false, `Workflow halted: ${reason}`);
        emitRunWieldSystemStatus(hostedSession, `Workflow halted: ${reason}`, true, progress);
        if (planName && planName !== "quick-fix") {
            const transition = await runValidationOutcomeTransitionImpl({
                projectRoot,
                planName,
                expectedRevision: await loadCurrentPlanRevision(projectRoot, planName),
                worktreeId,
                targetRef: worktreeBaseBranch,
                outcome: "failed",
                proof: { failureReason: reason, nonGitInPlace },
                settle: async ({ markEffect }) => {
                    if (worktreeId) {
                        await updateWorktreeRegistryEntryImpl(projectRoot, worktreeId, { status: "validation_failed" });
                        await markEffect("worktree_registry_updated", { worktreeId, status: "validation_failed" });
                    }
                    return await recordPlanEventImpl({
                        cwd: projectRoot,
                        planName,
                        event: "validation_failed",
                        currentStatus: "implemented",
                        details: { triageMeta, failureReason: reason, nonGitInPlace },
                    });
                },
            });
            if (transition.status !== "committed") {
                emitRunWieldSystemStatus(
                    hostedSession,
                    `Could not settle validation failure transaction: ${transition.message}`,
                    true,
                );
            }
        } else if (worktreeId) {
            await updateWorktreeRegistryEntryImpl(projectRoot, worktreeId, { status: "validation_failed" });
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
            ...(shouldContinueParentEpicAfterValidation(triageMeta)
                ? { epicContinuation: { completedPlanName: planName, projectRoot } }
                : {}),
        });
    }
    return { kind: "failed", planName, projectRoot, reason: haltReason || "Validation stopped before completion." };
}
