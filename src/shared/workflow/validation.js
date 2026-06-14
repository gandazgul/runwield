/**
 * @module shared/workflow/validation
 * Mechanical and semantic validation for completed Harns execution workflows.
 */

import { AGENTS, CWD } from "../../constants.js";
import { getAgentDisplayName } from "../session/agents.js";
import { runAgentSession } from "../session/session.js";
import {
    clearActiveExecutionWorkflow,
    consumePendingSwitchHandoff,
    getActiveExecutionWorkflow,
} from "../session/session-state.js";
import { getCustomSetting, setCustomSetting } from "../settings.js";
import { createSilentUiApi } from "../ui/api.js";
import { extractAssistantOutput, readLatestTaskCompletedOutcome } from "./workflow.js";
import { setActiveAgent } from "../interactive/chat-session.js";
import { getWorkflowDiff } from "./git-snapshot.js";
import { recordPlanEvent } from "./plan-lifecycle.js";

/**
 * @param {import('./workflow.js').UiAPI} uiAPI
 *
 * @returns {Promise<string>}
 */
async function getOrAskForVerificationCommand(uiAPI) {
    const existingCommand = getCustomSetting("verification_command", "project");
    if (existingCommand) {
        return /** @type {string} */ (existingCommand);
    }

    uiAPI.appendSystemMessage("No verification command found in project settings.");
    const userInput = await uiAPI.promptText(
        "Enter the command to verify this project (e.g., 'deno task ci', 'npm test'): ",
        { allowEmpty: false },
    );

    if (!userInput) {
        return "";
    }

    const newCommand = userInput.trim();
    await setCustomSetting("verification_command", newCommand, "project");

    uiAPI.appendSystemMessage(`Saved verification command: '${newCommand}'`);
    return newCommand;
}

/**
 * Spawns the local verification step.
 *
 * @param {import('./workflow.js').UiAPI} uiAPI
 *
 * @returns {Promise<{ exitCode: number, output: string }>}
 */
export async function runLocalCI(uiAPI) {
    const cmdArgs = await getOrAskForVerificationCommand(uiAPI);

    if (!cmdArgs) {
        return {
            exitCode: 1,
            output:
                "Harns could not auto-detect a build or test command for this repository. Please explore the project and manually run the appropriate compilation or linting commands to verify your changes.",
        };
    }

    try {
        const isWindows = Deno.build.os === "windows";
        const cmdExe = isWindows ? "cmd" : "sh";
        const cmdFlag = isWindows ? "/c" : "-c";

        const command = new Deno.Command(cmdExe, {
            args: [cmdFlag, cmdArgs],
            cwd: CWD,
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
            output: `Failed to spawn verification process: ${error.message}`,
        };
    }
}

/**
 * @param {Object} args
 * @param {string} args.agentName
 * @param {string} args.userRequest
 * @param {import('./workflow.js').UiAPI} args.uiAPI
 * @param {import('@earendil-works/pi-coding-agent').SessionManager | undefined} args.sessionManager
 * @param {typeof runAgentSession} [args.runAgentSession]
 * @param {typeof readLatestTaskCompletedOutcome} [args.readLatestTaskCompletedOutcome]
 * @returns {Promise<boolean>}
 */
async function runCompletionGatedRepair({
    agentName,
    userRequest,
    uiAPI,
    sessionManager,
    runAgentSession: runAgentSessionImpl = runAgentSession,
    readLatestTaskCompletedOutcome: readTaskCompleted = readLatestTaskCompletedOutcome,
}) {
    const messages = await runAgentSessionImpl({
        agentName,
        userRequest,
        uiAPI,
        sessionManager,
    });
    consumePendingSwitchHandoff();

    return readTaskCompleted(messages);
}

/**
 * @param {string | undefined} baselineTree
 * @returns {Promise<string>}
 */
async function getGitDiffText(baselineTree) {
    return await getWorkflowDiff(CWD, baselineTree);
}

/**
 * @param {string} response
 * @returns {boolean}
 */
function isApprovedReviewResponse(response) {
    return response.trim() === "APPROVED";
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
 * Unified validation loop. Runs local verification and semantic code review.
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
 *   setActiveAgent?: typeof setActiveAgent,
 *   createDirectAgentHandler?: (agentName: string) => import('../session/types.js').AgentMessageHandler,
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
    const activeWorkflow = getActiveExecutionWorkflow();
    const baselineTree = activeWorkflow?.baselineTree;
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
        uiAPI?.appendSystemMessage?.(`\nStarting Validation Cycle ${validationCycles}/${MAX_VALIDATION_CYCLES}`);

        let buildPasses = false;
        let mechanicalAttempts = 0;

        while (!buildPasses && mechanicalAttempts < 3) {
            mechanicalAttempts++;
            uiAPI?.appendSystemMessage?.(`Running CI Validation (Attempt ${mechanicalAttempts}/3)...`);
            const ciResult = await runLocalCIImpl(uiAPI);

            if (ciResult.exitCode === 0) {
                buildPasses = true;
                uiAPI?.appendSystemMessage?.("Build and tests passed.");
            } else {
                uiAPI?.appendSystemMessage?.(
                    `Build failed. Dispatching ${getAgentDisplayName(AGENTS.OPERATOR)} to fix syntax/types...`,
                );
                const completed = await repair({
                    agentName: AGENTS.OPERATOR,
                    userRequest:
                        "The project failed CI validation. Fix the following build errors, then call task_completed " +
                        `when the repair is complete:\n\n${ciResult.output}`,
                    uiAPI,
                    sessionManager,
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

        uiAPI?.appendSystemMessage?.("Running Semantic Code Review...");

        const diffText = await getDiffText(baselineTree);

        if (requiresImplementationDiff(triageMeta) && !hasImplementationDiff(diffText, planName)) {
            haltReason = diffText.trim()
                ? "No implementation changes detected in workflow diff; only plan document changes were found."
                : "No implementation changes detected in workflow diff.";
            break;
        }

        if (!diffText.trim()) {
            uiAPI?.appendSystemMessage?.("No changes detected in diff. Assuming approved.");
            executionComplete = true;
            break;
        }

        const reviewPrompt =
            `Compare the current implementation diff against the original plan. If the code fully satisfies the plan, reply ONLY with the word 'APPROVED'. Otherwise, list the missing semantic requirements.\n\n### Original Plan\n${planContent}\n\n### Git Diff\n${diffText}`;

        const sessionMessages = await runAgentSessionImpl({
            agentName: AGENTS.REVIEWER,
            userRequest: reviewPrompt,
            uiAPI: createSilentUiApi(),
            sessionManager,
        });
        consumePendingSwitchHandoff();

        const reviewResponse = extractAssistantOutput(sessionMessages) || "";

        if (isApprovedReviewResponse(reviewResponse)) {
            uiAPI?.appendSystemMessage?.("Semantic Code Review Approved.");
            executionComplete = true;
        } else {
            uiAPI?.appendSystemMessage?.(
                `Review failed. Sending feedback back to ${getAgentDisplayName(AGENTS.ENGINEER)}...`,
            );
            const completed = await repair({
                agentName: AGENTS.ENGINEER,
                userRequest: "The code reviewer found issues with your implementation. Please fix them, do not break " +
                    `existing tests, and call task_completed when finished.\n\nReviewer Feedback:\n${reviewResponse}`,
                uiAPI,
                sessionManager,
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
        uiAPI.appendSystemMessage(`${triageClassificationDisplay} execution and validation complete.`);
        if (planName && planName !== "quick-fix") {
            await recordPlanEventImpl({
                cwd: CWD,
                planName,
                event: "validation_passed",
                currentStatus: "implemented",
                details: { triageMeta },
            });
        }
    } else {
        const reason = haltReason || "Validation stopped before completion.";
        uiAPI.appendSystemMessage(`Workflow halted: ${reason}`);
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
        const createDirectAgentHandler = __deps?.createDirectAgentHandler ||
            (await import("../session/direct-agent.js")).createDirectAgentHandler;
        setActiveAgentImpl(finalAgentName, createDirectAgentHandler(finalAgentName), uiAPI);
    }
}
