/**
 * @module shared/workflow/validation
 * Mechanical and semantic validation for completed RunWield execution workflows.
 */

import { extractYaml } from "@std/front-matter";
import { dirname, fromFileUrl, join } from "@std/path";
import { AGENTS, CWD } from "../../constants.js";
import { getAgentDisplayName } from "../session/agents.js";
import { ensureBundledAgentDefFile, runAgentSession } from "../session/session.js";
import { getCodeReviewMode, getCustomSetting, setCustomSetting, shouldCleanupMergedWorktrees } from "../settings.js";
import { extractAssistantOutput, readLatestTaskCompletedOutcome } from "./workflow.js";
import { setActiveAgent } from "../interactive/chat-session.js";
import { getWorkflowDiff } from "./git-snapshot.js";
import { recordPlanEvent } from "./plan-lifecycle.js";
import { formatCodeReviewAnnotations, runPlannotatorCodeReview } from "./code-review.js";
import { mergeExecutionWorktree, removeExecutionWorktree } from "../worktree.js";
import {
    removeEntry as removeWorktreeRegistryEntry,
    updateEntry as updateWorktreeRegistryEntry,
} from "../worktree-registry.js";

export const __dirname = dirname(fromFileUrl(import.meta.url));
const WORKFLOW_PROMPTS_DIR = "workflow-prompts";
const REVIEWER_PROMPT_FILE = "reviewer-prompt.md";
const SUCCESS_MESSAGE_STYLE = { bodyColor: "success" };

/**
 * Load reviewer as a bare workflow prompt instead of a normal agent definition.
 * Normal agent definitions are wrapped with RunWield' shared system prompt, which
 * advertises skills, memory, and exploration tools. Semantic review is a
 * mechanical plan-vs-diff check, so it intentionally receives none of that.
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
 *
 * @returns {Promise<string>}
 */
async function getOrAskForValidationCommand(uiAPI) {
    const existingCommand = getCustomSetting("verification_command", "project");
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
    await setCustomSetting("verification_command", newCommand, "project");

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
    const cmdArgs = await getOrAskForValidationCommand(uiAPI);

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

        const { code, stdout, stderr } = await command.output();
        const decoder = new TextDecoder();
        const output = decoder.decode(stdout) + "\n" + decoder.decode(stderr);
        const durationMs = Date.now() - startTime;

        toolBlock?.appendOutput(output.trim() ? output : "(no output)\n");
        toolBlock?.endExecution(code !== 0, durationMs);
        uiAPI.addToolResult?.({
            id: toolCallId,
            name: "bash",
            result: output,
            isError: code !== 0,
            durationMs,
        });

        return {
            exitCode: code,
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

    return readTaskCompleted(messages);
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
 * @param {string} response
 * @returns {boolean}
 */
function isApprovedReviewResponse(response) {
    return response.trim() === "APPROVED";
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
 * }} [args.__deps] Test-only injection point.
 * @returns {Promise<{ passed: boolean, attempts: number, reason?: string }>}
 */
export async function runMechanicalValidation({ uiAPI, sessionManager, hostedSession, cwd = CWD, __deps }) {
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
    /** @param {string} agentName */
    const activateAgent = (agentName) => {
        const handler = createAgentHandlerImpl(agentName, { hostedSession });
        setActiveAgentImpl(hostedSession, agentName, handler, uiAPI);
    };
    const maxRepairAttempts = 3;
    let repairAttempts = 0;

    appendRunWieldSystemMessage(uiAPI, "Starting QUICK_FIX Mechanical Validation.");

    while (true) {
        appendRunWieldSystemMessage(
            uiAPI,
            `Running QUICK_FIX CI Validation (Repair Attempts ${repairAttempts}/${maxRepairAttempts})...`,
        );
        uiAPI?.setBusy?.(true);
        let ciResult;
        try {
            ciResult = await runLocalCIImpl(uiAPI, cwd);
        } finally {
            uiAPI?.setBusy?.(false);
        }

        if (ciResult.exitCode === 0) {
            appendRunWieldSystemMessage(
                uiAPI,
                "QUICK_FIX Mechanical Validation passed.",
                false,
                SUCCESS_MESSAGE_STYLE,
            );
            activateAgent(AGENTS.ENGINEER);
            return { passed: true, attempts: repairAttempts };
        }

        if (repairAttempts >= maxRepairAttempts) {
            const reason =
                `QUICK_FIX Mechanical Validation failed after ${maxRepairAttempts} Engineer repair attempts.`;
            appendRunWieldSystemMessage(uiAPI, reason, true);
            activateAgent(AGENTS.ENGINEER);
            return { passed: false, attempts: repairAttempts, reason };
        }

        repairAttempts++;
        appendRunWieldSystemMessage(
            uiAPI,
            `QUICK_FIX CI failed. Dispatching ${
                getAgentDisplayName(AGENTS.ENGINEER)
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
            cwd,
            hostedSession,
        });
        if (!completed) {
            const reason = `${
                getAgentDisplayName(AGENTS.ENGINEER)
            } stopped without task_completed during QUICK_FIX repair.`;
            appendRunWieldSystemMessage(uiAPI, reason, true);
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
    const mergeExecutionWorktreeImpl = __deps?.mergeExecutionWorktree || mergeExecutionWorktree;
    const removeExecutionWorktreeImpl = __deps?.removeExecutionWorktree || removeExecutionWorktree;
    const removeWorktreeRegistryEntryImpl = __deps?.removeWorktreeRegistryEntry || removeWorktreeRegistryEntry;
    const updateWorktreeRegistryEntryImpl = __deps?.updateWorktreeRegistryEntry || updateWorktreeRegistryEntry;
    const loadReviewerPromptImpl = __deps?.loadReviewerPrompt || loadReviewerPrompt;
    const shouldCleanupMergedWorktreesImpl = __deps?.shouldCleanupMergedWorktrees || shouldCleanupMergedWorktrees;
    const getCodeReviewModeImpl = __deps?.getCodeReviewMode || getCodeReviewMode;
    const runPlannotatorCodeReviewImpl = __deps?.runPlannotatorCodeReview || runPlannotatorCodeReview;
    const activeWorkflow = hostedSession?.getActiveExecutionWorkflow?.() || null;
    const baselineTree = activeWorkflow?.baselineTree;
    const projectRoot = activeWorkflow?.projectRoot || CWD;
    const executionCwd = activeWorkflow?.executionCwd || CWD;
    const worktreeBranch = activeWorkflow?.worktreeBranch;
    const worktreeBaseBranch = activeWorkflow?.worktreeBaseBranch;
    const worktreeId = activeWorkflow?.worktreeId;
    if (activeWorkflow) {
        hostedSession?.clearActiveExecutionWorkflow();
    }
    const setActiveAgentImpl = __deps?.setActiveAgent || setActiveAgent;
    let executionComplete = false;
    let latestDiffText = "";
    /** @type {string | null} */
    let haltReason = null;
    /** @type {HumanReviewMetadata | null} */
    let humanReviewMetadata = null;
    let validationCycles = 0;
    const MAX_VALIDATION_CYCLES = 3;

    while (!executionComplete && !haltReason && validationCycles < MAX_VALIDATION_CYCLES) {
        validationCycles++;
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

            if (ciResult.exitCode === 0) {
                buildPasses = true;
                appendRunWieldSystemMessage(uiAPI, "Build and tests passed.", false, SUCCESS_MESSAGE_STYLE);
            } else {
                appendRunWieldSystemMessage(
                    uiAPI,
                    `Build failed. Dispatching ${getAgentDisplayName(AGENTS.OPERATOR)} to fix syntax/types...`,
                    true,
                );
                const completed = await repair({
                    agentName: AGENTS.OPERATOR,
                    userRequest:
                        "The project failed CI validation. Fix the following build errors, then call task_completed " +
                        `when the repair is complete:\n\n${ciResult.output}`,
                    uiAPI,
                    sessionManager,
                    cwd: executionCwd,
                });
                if (!completed) {
                    haltReason = `${
                        getAgentDisplayName(AGENTS.OPERATOR)
                    } stopped without task_completed during CI repair.`;
                    break;
                }
            }
        }

        if (!buildPasses) {
            haltReason ||= "CI validation failed after 3 repair attempts.";
            break;
        }

        appendRunWieldSystemMessage(uiAPI, "Running Semantic Code Review...");
        uiAPI?.setBusy?.(true);
        let diffText = "";
        let reviewResponse = "";
        try {
            diffText = await getDiffText(baselineTree, executionCwd);
            latestDiffText = diffText;

            if (
                (!requiresImplementationDiff(triageMeta) || hasImplementationDiff(diffText, planName)) &&
                diffText.trim()
            ) {
                const reviewPrompt =
                    `Compare the current implementation diff against the original plan. If the code fully satisfies the plan, reply ONLY with the word 'APPROVED'. Otherwise, list the missing semantic requirements.\n\n### Original Plan\n${planContent}\n\n### Git Diff\n${diffText}`;
                const reviewerAgentDef = await loadReviewerPromptImpl();

                const sessionMessages = await runAgentSessionImpl({
                    hostedSession,
                    agentName: AGENTS.REVIEWER,
                    userRequest: reviewPrompt,
                    uiAPI,
                    sessionManager,
                    cwd: executionCwd,
                    _agentDefOverride: reviewerAgentDef,
                    includeEditFallback: false,
                    useRootSession: false,
                });
                hostedSession?.consumePendingSwitchHandoff?.();

                reviewResponse = extractAssistantOutput(sessionMessages) || "";
            }
        } finally {
            uiAPI?.setBusy?.(false);
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

        if (isApprovedReviewResponse(reviewResponse)) {
            appendRunWieldSystemMessage(uiAPI, "Semantic Code Review Approved.", false, SUCCESS_MESSAGE_STYLE);
            const codeReviewMode = getCodeReviewModeImpl();
            if (codeReviewMode === "none") {
                humanReviewMetadata = {
                    humanReviewMode: "none",
                    humanReviewDecision: "not_required",
                    humanReviewedAt: null,
                };
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
                        if (!completed) {
                            haltReason = `${
                                getAgentDisplayName(AGENTS.ENGINEER)
                            } stopped without task_completed during human code review repair.`;
                            break;
                        }
                    }
                }
            }
        } else {
            appendRunWieldSystemMessage(
                uiAPI,
                `Review failed. Sending feedback back to ${getAgentDisplayName(AGENTS.ENGINEER)}...\n\n` +
                    `Reviewer Feedback:\n${reviewResponse || "(no reviewer output captured)"}`,
                true,
            );
            const completed = await repair({
                agentName: AGENTS.ENGINEER,
                userRequest: "The code reviewer found issues with your implementation. Please fix them, do not break " +
                    `existing tests, and call task_completed when finished.\n\nReviewer Feedback:\n${reviewResponse}`,
                uiAPI,
                sessionManager,
                cwd: executionCwd,
            });
            if (!completed) {
                haltReason = `${
                    getAgentDisplayName(AGENTS.ENGINEER)
                } stopped without task_completed during semantic repair.`;
                break;
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
                try {
                    cleanupMergedWorktrees = shouldCleanupMergedWorktreesImpl();
                    appendRunWieldSystemMessage(
                        uiAPI,
                        worktreeBaseBranch
                            ? `Merging validated worktree branch ${worktreeBranch} into target branch ${worktreeBaseBranch}.`
                            : `Merging validated worktree branch ${worktreeBranch} into primary checkout.`,
                    );
                    await mergeExecutionWorktreeImpl({
                        projectRoot,
                        branch: worktreeBranch,
                        targetBranch: worktreeBaseBranch,
                        worktreePath: executionCwd,
                        repairMergeWorktreePath: pendingRepairMergeWorktreePath,
                        planName,
                        planDescription: triageMeta?.summary,
                        allowedDirtyPaths: [
                            `plans/${planName}.md`,
                            ".wld/",
                            ".wld/worktrees.json",
                            ".wld/worktrees.lock",
                        ],
                    });
                    pendingRepairMergeWorktreePath = undefined;
                    if (worktreeId) {
                        await updateWorktreeRegistryEntryImpl(projectRoot, worktreeId, { status: "merged" });
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
                            appendRunWieldSystemMessage(
                                uiAPI,
                                `Worktree merged, but cleanup failed: ${cleanupReason}`,
                                true,
                            );
                        }
                    }
                    break;
                } catch (/** @type {any} */ error) {
                    const reason = error instanceof Error ? error.message : String(error);
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
                                cwd: CWD,
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
            appendRunWieldSystemMessage(
                uiAPI,
                `${triageClassificationDisplay} execution and validation complete.`,
                false,
                SUCCESS_MESSAGE_STYLE,
            );
            if (planName && planName !== "quick-fix") {
                await recordPlanEventImpl({
                    cwd: CWD,
                    planName,
                    event: "validation_passed",
                    currentStatus: "implemented",
                    details: {
                        triageMeta,
                        worktreeStatus: worktreeBranch ? "merged" : undefined,
                        cleanupMergedWorktrees: worktreeBranch ? cleanupMergedWorktrees : undefined,
                        ...(humanReviewMetadata || {}),
                    },
                });
            }
        }
    } else {
        const reason = haltReason || "Validation stopped before completion.";
        appendRunWieldSystemMessage(uiAPI, `Workflow halted: ${reason}`, true);
        if (worktreeId) {
            await updateWorktreeRegistryEntryImpl(projectRoot, worktreeId, { status: "validation_failed" });
        }
        if (planName && planName !== "quick-fix") {
            await recordPlanEventImpl({
                cwd: CWD,
                planName,
                event: "validation_failed",
                currentStatus: "implemented",
                details: { triageMeta, failureReason: reason },
            });
        }
    }

    if (finalAgentName) {
        const createAgentHandler = __deps?.createAgentHandler ||
            (await import("../session/agent-handler.js")).createAgentHandler;
        const handler = createAgentHandler(finalAgentName, { hostedSession });
        setActiveAgentImpl(hostedSession, finalAgentName, handler, uiAPI);
    }
}
