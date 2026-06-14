/**
 * @module shared/workflow/validation
 * Mechanical and semantic validation for completed Harns execution workflows.
 */

import { AGENTS, CWD } from "../../constants.js";
import { getAgentDisplayName } from "../session/agents.js";
import { runAgentSession } from "../session/session.js";
import { consumePendingSwitchHandoff } from "../session/session-state.js";
import { getCustomSetting, setCustomSetting } from "../settings.js";
import { createSilentUiApi } from "../ui/api.js";
import { extractAssistantOutput, readLatestTaskCompletedOutcome } from "./workflow.js";
import { setActiveAgent } from "../interactive/chat-session.js";

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

    const completed = readTaskCompleted(messages);
    if (!completed) {
        uiAPI?.appendSystemMessage?.(
            `${
                getAgentDisplayName(agentName)
            } stopped without task_completed during validation repair. Halting for human review.`,
            false,
            "Harns",
        );
    }
    return completed;
}

/**
 * @returns {Promise<string>}
 */
async function getGitDiffText() {
    const diffCmd = new Deno.Command("git", { args: ["diff"], cwd: CWD, stdout: "piped" });
    const { stdout: diffOut } = await diffCmd.output();
    return new TextDecoder().decode(diffOut);
}

/**
 * @param {string} response
 * @returns {boolean}
 */
function isApprovedReviewResponse(response) {
    return response.trim() === "APPROVED";
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
 *   setActiveAgent?: typeof setActiveAgent,
 *   createDirectAgentHandler?: (agentName: string) => import('../session/types.js').AgentMessageHandler,
 * }} [args.__deps] Test-only injection point.
 */
export async function runValidationLoop({
    planName: _planName,
    planContent,
    triageMeta,
    uiAPI,
    sessionManager,
    finalAgentName,
    __deps,
}) {
    const runLocalCIImpl = __deps?.runLocalCI || runLocalCI;
    const repair = __deps?.runCompletionGatedRepair ||
        ((args) =>
            runCompletionGatedRepair({
                ...args,
                runAgentSession: __deps?.runAgentSession,
                readLatestTaskCompletedOutcome: __deps?.readLatestTaskCompletedOutcome,
            }));
    const getDiffText = __deps?.getDiffText || getGitDiffText;
    const setActiveAgentImpl = __deps?.setActiveAgent || setActiveAgent;
    let executionComplete = false;
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
                if (!completed) break;
            }
        }

        if (!buildPasses) {
            uiAPI?.appendSystemMessage?.("Mechanical validation failed 3 times. Halting cycle for human review.");
            break;
        }

        uiAPI?.appendSystemMessage?.("Running Semantic Code Review...");

        const diffText = await getDiffText();

        if (!diffText.trim()) {
            uiAPI?.appendSystemMessage?.("No changes detected in diff. Assuming approved.");
            executionComplete = true;
            break;
        }

        const reviewPrompt =
            `Compare the current implementation diff against the original plan. If the code fully satisfies the plan, reply ONLY with the word 'APPROVED'. Otherwise, list the missing semantic requirements.\n\n### Original Plan\n${planContent}\n\n### Git Diff\n${diffText}`;

        const sessionMessages = await runAgentSession({
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
            if (!completed) break;
        }
    }

    if (executionComplete) {
        const triageClassificationDisplay = triageMeta?.classification
            ? triageMeta.classification.toLocaleLowerCase().replace(/^([a-z])/, (c) => c.toUpperCase())
            : "Plan";
        uiAPI.appendSystemMessage(`${triageClassificationDisplay} execution and validation complete.`);
    } else {
        uiAPI.appendSystemMessage(
            "Halting workflow. Maximum validation cycles reached or CI completely failed.",
        );
    }

    if (finalAgentName) {
        const createDirectAgentHandler = __deps?.createDirectAgentHandler ||
            (await import("../session/direct-agent.js")).createDirectAgentHandler;
        setActiveAgentImpl(finalAgentName, createDirectAgentHandler(finalAgentName), uiAPI);
    }
}
