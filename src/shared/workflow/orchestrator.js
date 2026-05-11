/**
 * @module shared/workflow/orchestrator
 * Session-level orchestrator for the triage flow.
 *
 * Each user message goes through the router agent first. When the router calls
 * `triage_report`, the tool terminates the router's turn and returns the
 * classification. This orchestrator wakes up at that point, reads the outcome,
 * and dispatches the next agent:
 *
 * QUICK_FIX → Operator
 * FEATURE   → Planner   → on `approved_execute`, runs `executePlan`
 * PROJECT   → Architect → on `approved_execute`, runs `executePlan` (parallel tasks)
 *
 * Plan-feedback loops stay inside the planning session because plan_written
 * returns `feedback` non-terminating — the planner sees the tool result and
 * iterates without rebuilding LLM context.
 */

import { join } from "@std/path";
import { CWD } from "../../constants.js";
import { ensurePlansDir } from "../../plan-store.js";
import { setActiveAgent } from "../interactive/chat-session.js";
import { createDirectAgentHandler } from "../session/direct-agent.js";
import { runAgentSession } from "../session/session.js";
import { getCustomSetting, setCustomSetting } from "../settings.js";
import { createSilentUiApi } from "../ui/api.js";
import { executePlan, extractAssistantOutput, runPlanningAgent } from "./workflow.js";

/**
 * @typedef {Object} TriageOutcome
 * @property {"QUICK_FIX" | "FEATURE" | "PROJECT"} classification
 * @property {"LOW" | "MEDIUM" | "HIGH"} complexity
 * @property {string} summary
 * @property {string[]} affectedPaths
 */

/**
 * @param {import('./workflow.js').UiAPI} uiAPI
 *
 * @returns {Promise<string>}
 */
async function getOrAskForVerificationCommand(uiAPI) {
    // 1. Try to read existing custom setting
    const existingCommand = getCustomSetting("verification_command", "project");
    if (existingCommand) {
        return /** @type {string} */ (existingCommand);
    }

    // 2. Fallback: Ask the user interactively
    uiAPI.appendSystemMessage("⚠️ No verification command found in project settings.");
    const userInput = await uiAPI.promptText(
        "Enter the command to verify this project (e.g., 'deno task ci', 'npm test'): ",
        { allowEmpty: false },
    );

    if (!userInput) {
        return "";
    }

    const newCommand = userInput.trim();

    // 3. Save it safely through the locked storage
    await setCustomSetting("verification_command", newCommand, "project");

    uiAPI.appendSystemMessage(`💾 Saved verification command: '${newCommand}'`);
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
        // We don't know how to test this. Return a special failure state
        // that prompts the Operator agent to figure it out.
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
 * Read the latest triage_report tool result's details from a message stream.
 *
 * @param {import('@earendil-works/pi-agent-core').AgentMessage[]} messages
 * @returns {TriageOutcome | null}
 */
export function readLatestTriageOutcome(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (
            msg && "role" in msg && msg.role === "toolResult" &&
            "toolName" in msg && msg.toolName === "triage_report"
        ) {
            // @ts-ignore details set by tool implementation
            const details = msg.details;
            if (details && details.classification) {
                return /** @type {TriageOutcome} */ (details);
            }
        }
    }
    return null;
}

/**
 * @param {TriageOutcome} triage
 */
function buildTriageBlock(triage) {
    return [
        "## Triage Report",
        `- Classification: ${triage.classification}`,
        `- Complexity: ${triage.complexity}`,
        `- Summary: ${triage.summary}`,
        `- Affected paths: ${(triage.affectedPaths || []).join(", ")}`,
        "",
    ].join("\n");
}

/**
 * Dispatch the next agent based on the router's triage classification, then
 * (for FEATURE/PROJECT) execute the approved plan.
 *
 * @param {Object} args
 * @param {TriageOutcome} args.triage
 * @param {string} args.userRequest
 * @param {import('../session/types.js').ImageAttachment[] | undefined} args.images
 * @param {import('./workflow.js').UiAPI} args.uiAPI
 * @param {import('@earendil-works/pi-coding-agent').SessionManager | undefined} args.sessionManager
 */
export async function dispatchPostTriage({ triage, userRequest, images, uiAPI, sessionManager }) {
    if (!uiAPI) throw new Error("dispatchPostTriage: uiAPI is required");

    const triageBlock = buildTriageBlock(triage);
    const decoratedRequest = ["## User Request", userRequest, "", triageBlock].join("\n");

    if (triage.classification === "QUICK_FIX") {
        uiAPI.appendSystemMessage("=== Phase B: Operator (Execute) ===");
        setActiveAgent("Operator", createDirectAgentHandler("operator"), uiAPI);

        await runAgentSession({
            agentName: "operator",
            userRequest: decoratedRequest,
            images,
            uiAPI,
            sessionManager,
        });

        uiAPI.appendSystemMessage("✅ Operator execution complete.");
        sessionManager?.appendCustomMessageEntry?.(
            "system",
            "Quick fix executed by operator.",
            true,
            `Quick fix executed by operator. Summary:\n${triage.summary}`,
        );
        return;
    }

    if (triage.classification === "FEATURE" || triage.classification === "PROJECT") {
        const isFeature = triage.classification === "FEATURE";
        const agentName = isFeature ? "planner" : "architect";
        const displayName = isFeature ? "Planner" : "Architect";
        const phaseLabel = isFeature
            ? "FEATURE detected. Handing off to Planner..."
            : "PROJECT detected. Handing off to Architect for targeted deep exploration + planning...";

        uiAPI.appendSystemMessage(phaseLabel);
        uiAPI.appendSystemMessage(`=== Phase B: ${displayName} ===`);
        setActiveAgent(displayName, createDirectAgentHandler(agentName), uiAPI);

        await ensurePlansDir(CWD);

        const outcome = await runPlanningAgent({
            agentName,
            initialRequest: decoratedRequest,
            triageMeta: triage,
            uiAPI,
            sessionManager,
        });

        if (outcome.outcome !== "approved_execute" || !outcome.planName) return;

        // ... (planner/architect runs, returns approved_execute) ...

        await executePlan(
            outcome.planName,
            outcome.triageMeta || triage,
            uiAPI,
            outcome.tasks,
            sessionManager,
        );

        // ==========================================
        // PHASE C & D: THE UNIFIED VALIDATION LOOP
        // ==========================================
        let executionComplete = false;
        let validationCycles = 0;
        const MAX_VALIDATION_CYCLES = 3; // How many times we allow the Engineer to attempt fixes

        // Read the plan text once to feed to the reviewer
        const planContent = await Deno.readTextFile(join(CWD, "plans", `${outcome.planName}.md`));

        while (!executionComplete && validationCycles < MAX_VALIDATION_CYCLES) {
            validationCycles++;
            uiAPI.appendSystemMessage(`\n🔄 Starting Validation Cycle ${validationCycles}/${MAX_VALIDATION_CYCLES}`);

            // ------------------------------------------
            // Step 1: Mechanical Validation (CI)
            // ------------------------------------------
            let buildPasses = false;
            let mechanicalAttempts = 0;

            while (!buildPasses && mechanicalAttempts < 3) {
                mechanicalAttempts++;
                uiAPI.appendSystemMessage(`⚙️ Running CI Validation (Attempt ${mechanicalAttempts}/3)...`);
                const ciResult = await runLocalCI(uiAPI);

                if (ciResult.exitCode === 0) {
                    buildPasses = true;
                    uiAPI.appendSystemMessage("✅ Build and tests passed!");
                } else {
                    uiAPI.appendSystemMessage("❌ Build failed. Dispatching Operator to fix syntax/types...");
                    setActiveAgent("Operator", createDirectAgentHandler("operator"), uiAPI);
                    await runAgentSession({
                        agentName: "operator",
                        userRequest:
                            `The project failed CI validation. Fix the following build errors:\n\n${ciResult.output}`,
                        uiAPI,
                        sessionManager,
                    });
                }
            }

            if (!buildPasses) {
                uiAPI.appendSystemMessage("⚠️ Mechanical validation failed 3 times. Halting cycle for human review.");
                break; // Break out of the unified loop, halt execution
            }

            // ------------------------------------------
            // Step 2: Semantic Code Review
            // ------------------------------------------
            uiAPI.appendSystemMessage(`🧐 Running Semantic Code Review...`);

            const diffCmd = new Deno.Command("git", { args: ["diff"], cwd: CWD, stdout: "piped" });
            const { stdout: diffOut } = await diffCmd.output();
            const diffText = new TextDecoder().decode(diffOut);

            if (!diffText.trim()) {
                uiAPI.appendSystemMessage("✅ No changes detected in diff. Assuming approved.");
                executionComplete = true;
                break;
            }

            const reviewPrompt =
                `Compare the current implementation diff against the original plan. If the code fully satisfies the plan, reply ONLY with the word 'APPROVED'. Otherwise, list the missing semantic requirements.\n\n### Original Plan\n${planContent}\n\n### Git Diff\n${diffText}`;

            // Ensure you use the specialized 'reviewer' agent here
            const sessionMessages = await runAgentSession({
                agentName: "reviewer",
                userRequest: reviewPrompt,
                uiAPI: createSilentUiApi(),
                sessionManager,
            });

            const reviewResponse = extractAssistantOutput(sessionMessages) || "";

            if (reviewResponse.includes("APPROVED")) {
                uiAPI.appendSystemMessage("✅ Semantic Code Review Approved!");
                executionComplete = true;
                // This will exit the while loop cleanly!
            } else {
                uiAPI.appendSystemMessage("❌ Review failed. Sending feedback back to Engineer...");
                setActiveAgent("Engineer", createDirectAgentHandler("engineer"), uiAPI);
                await runAgentSession({
                    agentName: "engineer",
                    userRequest:
                        `The code reviewer found issues with your implementation. Please fix them. Do not break existing tests.\n\nReviewer Feedback:\n${reviewResponse}`,
                    uiAPI,
                    sessionManager,
                });
                // The loop continues -> goes back to Step 1 (Mechanical) to ensure the Engineer's fixes compile!
            }
        }

        if (executionComplete) {
            const triageClassificationDisplay = triage.classification.toLocaleLowerCase().replace("/^([a-z])/", () => {
                return triage.classification.charAt(0).toUpperCase() + triage.classification.slice(1);
            });
            uiAPI.appendSystemMessage(`🎉 ${triageClassificationDisplay} execution and validation complete.`);
        } else {
            uiAPI.appendSystemMessage(
                `🛑 Halting workflow. Maximum validation cycles reached or CI completely failed.`,
            );
        }

        setActiveAgent("Engineer", createDirectAgentHandler("engineer"), uiAPI);
    }
}

/**
 * Build the onMessage handler used as the active agent at the start of a
 * chat session. Runs the router agent, reads its triage outcome, and
 * dispatches the next agent.
 *
 * @returns {import('../session/types.js').AgentMessageHandler}
 */
export function createRouterOrchestratorHandler() {
    return async (userRequest, images, uiAPI, sessionManager) => {
        if (!uiAPI) throw new Error("router orchestrator handler: uiAPI is required");

        const messages = await runAgentSession({
            agentName: "router",
            userRequest,
            images,
            uiAPI,
            sessionManager,
        });

        const triage = readLatestTriageOutcome(messages);
        if (!triage) return;

        await dispatchPostTriage({ triage, userRequest, images, uiAPI, sessionManager });
    };
}
