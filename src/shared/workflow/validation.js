/**
 * @module shared/workflow/validation
 * Mechanical and semantic validation for completed Harns execution workflows.
 */

import { extractYaml } from "@std/front-matter";
import { dirname, fromFileUrl, join } from "@std/path";
import { AGENTS, CWD } from "../../constants.js";
import { getAgentDisplayName } from "../session/agents.js";
import { ensureBundledAgentDefFile, runAgentSession } from "../session/session.js";
import {
    clearActiveExecutionWorkflow,
    consumePendingSwitchHandoff,
    getActiveExecutionWorkflow,
} from "../session/session-state.js";
import { getCustomSetting, setCustomSetting, shouldCleanupMergedWorktrees } from "../settings.js";
import { extractAssistantOutput, readLatestTaskCompletedOutcome } from "./workflow.js";
import { setActiveAgent } from "../interactive/chat-session.js";
import { getWorkflowDiff } from "./git-snapshot.js";
import { recordPlanEvent } from "./plan-lifecycle.js";
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
 * Normal agent definitions are wrapped with Harns' shared system prompt, which
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
                "Harns could not auto-detect a build or test command for this repository. Please explore the project and manually run the appropriate compilation or linting commands to validate your changes.",
        };
    }

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

        return {
            exitCode: code,
            output: decoder.decode(stdout) + "\n" + decoder.decode(stderr),
        };
    } catch (/** @type {any} */ error) {
        return {
            exitCode: 1,
            output: `Failed to spawn validation process: ${error.message}`,
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
    runAgentSession: runAgentSessionImpl = runAgentSession,
    readLatestTaskCompletedOutcome: readTaskCompleted = readLatestTaskCompletedOutcome,
}) {
    const messages = await runAgentSessionImpl({
        agentName,
        userRequest,
        uiAPI,
        sessionManager,
        cwd,
        useRootSession: true,
    });
    consumePendingSwitchHandoff();

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
 * @param {import('./workflow.js').UiAPI | undefined} uiAPI
 * @param {string} text
 * @param {boolean} [isError]
 * @param {{ headingColor?: string, bodyColor?: string }} [style]
 */
function appendHarnsSystemMessage(uiAPI, text, isError = false, style = {}) {
    uiAPI?.appendSystemMessage?.(text, isError, "Harns", style);
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
 * Unified validation loop. Runs local validation and semantic code review.
 *
 * @param {Object} args
 * @param {string} args.planName
 * @param {string} args.planContent
 * @param {import('../../tools/plan-written.js').TriageMeta} args.triageMeta
 * @param {import('./workflow.js').UiAPI} args.uiAPI
 * @param {import('@earendil-works/pi-coding-agent').SessionManager | undefined} args.sessionManager
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
 * }} [args.__deps] Test-only injection point.
 */
export async function runValidationLoop({
    planName,
    planContent,
    triageMeta,
    uiAPI,
    sessionManager,
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
            }));
    const getDiffText = __deps?.getDiffText || getGitDiffText;
    const recordPlanEventImpl = __deps?.recordPlanEvent || recordPlanEvent;
    const mergeExecutionWorktreeImpl = __deps?.mergeExecutionWorktree || mergeExecutionWorktree;
    const removeExecutionWorktreeImpl = __deps?.removeExecutionWorktree || removeExecutionWorktree;
    const removeWorktreeRegistryEntryImpl = __deps?.removeWorktreeRegistryEntry || removeWorktreeRegistryEntry;
    const updateWorktreeRegistryEntryImpl = __deps?.updateWorktreeRegistryEntry || updateWorktreeRegistryEntry;
    const loadReviewerPromptImpl = __deps?.loadReviewerPrompt || loadReviewerPrompt;
    const shouldCleanupMergedWorktreesImpl = __deps?.shouldCleanupMergedWorktrees || shouldCleanupMergedWorktrees;
    const activeWorkflow = getActiveExecutionWorkflow();
    const baselineTree = activeWorkflow?.baselineTree;
    const projectRoot = activeWorkflow?.projectRoot || CWD;
    const executionCwd = activeWorkflow?.executionCwd || CWD;
    const worktreeBranch = activeWorkflow?.worktreeBranch;
    const worktreeId = activeWorkflow?.worktreeId;
    if (activeWorkflow) {
        clearActiveExecutionWorkflow();
    }
    const setActiveAgentImpl = __deps?.setActiveAgent || setActiveAgent;
    let executionComplete = false;
    /** @type {string | null} */
    let haltReason = null;
    let validationCycles = 0;
    const MAX_VALIDATION_CYCLES = 3;

    while (!executionComplete && validationCycles < MAX_VALIDATION_CYCLES) {
        validationCycles++;
        appendHarnsSystemMessage(uiAPI, `Starting Validation Cycle ${validationCycles}/${MAX_VALIDATION_CYCLES}`);

        let buildPasses = false;
        let mechanicalAttempts = 0;

        while (!buildPasses && mechanicalAttempts < 3) {
            mechanicalAttempts++;
            appendHarnsSystemMessage(uiAPI, `Running CI Validation (Attempt ${mechanicalAttempts}/3)...`);
            uiAPI?.setBusy?.(true);
            let ciResult;
            try {
                ciResult = await runLocalCIImpl(uiAPI, executionCwd);
            } finally {
                uiAPI?.setBusy?.(false);
            }

            if (ciResult.exitCode === 0) {
                buildPasses = true;
                appendHarnsSystemMessage(uiAPI, "Build and tests passed.", false, SUCCESS_MESSAGE_STYLE);
            } else {
                appendHarnsSystemMessage(
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

        appendHarnsSystemMessage(uiAPI, "Running Semantic Code Review...");
        uiAPI?.setBusy?.(true);
        let diffText = "";
        let reviewResponse = "";
        try {
            diffText = await getDiffText(baselineTree, executionCwd);

            if (
                (!requiresImplementationDiff(triageMeta) || hasImplementationDiff(diffText, planName)) &&
                diffText.trim()
            ) {
                const reviewPrompt =
                    `Compare the current implementation diff against the original plan. If the code fully satisfies the plan, reply ONLY with the word 'APPROVED'. Otherwise, list the missing semantic requirements.\n\n### Original Plan\n${planContent}\n\n### Git Diff\n${diffText}`;
                const reviewerAgentDef = await loadReviewerPromptImpl();

                const sessionMessages = await runAgentSessionImpl({
                    agentName: AGENTS.REVIEWER,
                    userRequest: reviewPrompt,
                    uiAPI,
                    sessionManager,
                    cwd: executionCwd,
                    _agentDefOverride: reviewerAgentDef,
                    includeEditFallback: false,
                    useRootSession: true,
                });
                consumePendingSwitchHandoff();

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
            appendHarnsSystemMessage(
                uiAPI,
                "No changes detected in diff. Assuming approved.",
                false,
                SUCCESS_MESSAGE_STYLE,
            );
            executionComplete = true;
            break;
        }

        if (isApprovedReviewResponse(reviewResponse)) {
            appendHarnsSystemMessage(uiAPI, "Semantic Code Review Approved.", false, SUCCESS_MESSAGE_STYLE);
            executionComplete = true;
        } else {
            appendHarnsSystemMessage(
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

        if (worktreeBranch) {
            while (executionComplete) {
                try {
                    cleanupMergedWorktrees = shouldCleanupMergedWorktreesImpl();
                    appendHarnsSystemMessage(
                        uiAPI,
                        `Merging validated worktree branch ${worktreeBranch} into primary checkout.`,
                    );
                    await mergeExecutionWorktreeImpl({
                        projectRoot,
                        branch: worktreeBranch,
                        worktreePath: executionCwd,
                        allowedDirtyPaths: [
                            `plans/${planName}.md`,
                            ".hns/",
                            ".hns/worktrees.json",
                            ".hns/worktrees.lock",
                        ],
                    });
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
                            appendHarnsSystemMessage(
                                uiAPI,
                                `Worktree merged, but cleanup failed: ${cleanupReason}`,
                                true,
                            );
                        }
                    }
                    break;
                } catch (/** @type {any} */ error) {
                    const reason = error instanceof Error ? error.message : String(error);
                    appendHarnsSystemMessage(uiAPI, `Worktree merge failed: ${reason}`, true);
                    if (worktreeId) {
                        try {
                            await updateWorktreeRegistryEntryImpl(projectRoot, worktreeId, {
                                status: "merge_conflict",
                            });
                        } catch (metadataError) {
                            const metadataReason = metadataError instanceof Error
                                ? metadataError.message
                                : String(metadataError);
                            appendHarnsSystemMessage(
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
                                details: { triageMeta, failureReason: reason },
                            });
                        } catch (metadataError) {
                            const metadataReason = metadataError instanceof Error
                                ? metadataError.message
                                : String(metadataError);
                            appendHarnsSystemMessage(
                                uiAPI,
                                `Could not update plan metadata while merge conflict is active: ${metadataReason}`,
                                true,
                            );
                        }
                    }

                    const action = await promptForMergeFailureAction(uiAPI, reason);
                    if (action === "retry") {
                        continue;
                    }
                    appendHarnsSystemMessage(uiAPI, `Workflow halted: Worktree merge failed: ${reason}`, true);
                    executionComplete = false;
                }
            }
        }

        if (executionComplete) {
            appendHarnsSystemMessage(
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
                    },
                });
            }
        }
    } else {
        const reason = haltReason || "Validation stopped before completion.";
        appendHarnsSystemMessage(uiAPI, `Workflow halted: ${reason}`, true);
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
        setActiveAgentImpl(finalAgentName, createAgentHandler(finalAgentName), uiAPI);
    }
}
