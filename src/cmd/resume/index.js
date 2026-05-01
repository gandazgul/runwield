/**
 * @module cmd/resume
 * Resume command implementation.
 */

import { parseArgs } from "@std/cli/parse-args";
import { CLI_BIN, CWD } from "../../constants.js";
import { resolvePlan } from "../../plan-store.js";
import { submitPlanForReview } from "../../shared/workflow/submit-plan.js";
import { planWrittenTool } from "../../tools/plan-written.js";
import { createUserInterviewTool } from "../../tools/user-interview.js";
import { askPostApproval, executePlan, reviewLoop } from "../../shared/workflow/workflow.js";
import { printCommandHelp } from "../../shared/help-text.js";
import { setActiveAgent, startInteractiveSession } from "../../shared/chat-session.js";
import { buildRepairPrompt, resetTuiState } from "../../cmd/command-helpers.js";
export { getResumeCompletions } from "./getArgumentCompletions.js";

/**
 * Restore default Router flow and input readiness after resume command work.
 *
 * @param {import('../../shared/workflow/workflow.js').UiAPI} uiAPI
 */
async function restoreRouterFlow(uiAPI) {
    resetTuiState(undefined, uiAPI, undefined);

    try {
        const { routerCmdOnMessage } = await import("../router/index.js");
        setActiveAgent("Router", routerCmdOnMessage);
        uiAPI.appendSystemMessage("[Harns] Switched back to Router (triage flow).");
    } catch (_e) {
        uiAPI.appendSystemMessage(
            "[Harns] Resume finished. Could not reload Router automatically; use /agent router.",
            true,
        );
    }
}

/**
 * Handle `resume` command.
 *
 * @param {string[]} argv
 * @param {import('../registry.js').CommandContext} [options]
 */
export async function runResumeCommand(argv, options = {}) {
    const parsedArgs = parseArgs(argv, {
        boolean: ["help"],
        alias: { h: "help" },
        stopEarly: true,
    });

    if (parsedArgs.help) {
        printCommandHelp("resume");
        return;
    }

    let [planArg] = parsedArgs._.map(String);
    if (!planArg) {
        if (options.uiAPI && options.editor) {
            const { listPlans } = await import("../../plan-store.js");
            const plans = await listPlans(Deno.cwd());
            if (plans.length === 0) {
                options.uiAPI.appendSystemMessage(
                    "No plans available, start one by entering a new request",
                );
                options.editor.setText("");
                options.editor.disableSubmit = false;
                return;
            }

            const planOptions = plans.map((p) => ({
                value: p.name,
                label: p.name,
                description: `${p.attrs.classification} - ${p.attrs.status}`,
            }));

            const chosen = await options.uiAPI.promptSelect("Resume plan:", planOptions);
            if (!chosen) {
                options.uiAPI.appendSystemMessage("Resume canceled.");
                options.editor.setText("");
                options.editor.disableSubmit = false;
                return;
            }

            planArg = chosen;
        } else {
            console.error(`Usage: ${CLI_BIN} resume <plan-name-or-path>`);
            Deno.exit(1);
        }
    }

    let uiAPI = options.uiAPI;

    if (!uiAPI) {
        // We were invoked from the CLI directly, boot the TUI!
        uiAPI = await startInteractiveSession(
            null,
            (_userRequest, _images, currentUiAPI) => {
                currentUiAPI.appendSystemMessage("Please wait for the plan to load...");
                return Promise.resolve();
            },
        );
    }

    if (!uiAPI) return;

    try {
        uiAPI.appendSystemMessage(`[Harns] Resuming plan: ${planArg}`);

        const plan = await resolvePlan(CWD, planArg);
        uiAPI.appendSystemMessage(`[Harns] Plan loaded: ${plan.planName}`);
        uiAPI.appendSystemMessage(
            `[Harns] Classification: ${plan.attrs.classification}, Status: ${plan.attrs.status}`,
        );

        const triageMeta = plan.attrs;
        const agentName = triageMeta.classification === "PROJECT" ? "architect" : "planner";

        if (plan.attrs.status === "approved") {
            uiAPI.appendSystemMessage("[Harns] This plan has already been approved.");

            while (true) {
                const answer = await uiAPI.promptSelect("What would you like to do?", [
                    { value: "proceed", label: "Proceed with execution" },
                    { value: "review", label: "Re-open for review (edit/annotate)" },
                    { value: "view", label: "View plan details" },
                ]);

                if (!answer) {
                    uiAPI.appendSystemMessage("[Harns] Resume canceled.");
                    return;
                }

                if (answer === "proceed") {
                    const execRes = await executePlan(plan.planName, plan.attrs, uiAPI);
                    if (execRes && execRes.repairRequired) {
                        const agentName = triageMeta.classification === "PROJECT" ? "architect" : "planner";
                        uiAPI.appendSystemMessage(
                            `[Harns] Execution failed due to task table error. Rerouting to ${agentName} for repair...`,
                        );
                        await reviewLoop({
                            agentName,
                            customTools: [planWrittenTool, createUserInterviewTool(uiAPI)],
                            initialRequest: buildRepairPrompt(
                                plan.planName,
                                execRes.error || "Unknown task table error",
                            ),
                            triageMeta: plan.attrs,
                            uiAPI,
                        });
                    }
                    return;
                }

                if (answer === "review") {
                    const result = await submitPlanForReview({
                        cwd: CWD,
                        planName: plan.planName,
                        planPath: plan.path,
                        triageMeta: plan.attrs,
                        uiAPI,
                    });

                    if (result.approved) {
                        const action = await askPostApproval(plan.planName, uiAPI);
                        if (action === "proceed") {
                            await executePlan(plan.planName, plan.attrs, uiAPI);
                        } else {
                            uiAPI.appendSystemMessage(
                                `[Harns] Plan saved. Resume later with: ${CLI_BIN} resume ${plan.planName}`,
                            );
                        }
                    } else {
                        uiAPI.appendSystemMessage(
                            "[Harns] Plan denied. To continue the revision loop, run:",
                        );
                        uiAPI.appendSystemMessage(`  ${CLI_BIN} resume ${plan.planName}`);
                    }
                    return;
                }

                if (answer === "view") {
                    uiAPI.appendSystemMessage(`\n${plan.body}\n`);
                }
            }
        }

        // Not approved - enter review loop
        // deno-lint-ignore require-await
        setActiveAgent(agentName, async (_userRequest, _images, currentUiAPI) => {
            // The review loop drives the agent invocations internally.
            // Manual input during an active agent invocation is not yet supported.
            currentUiAPI.appendSystemMessage(
                "Warning: Manual input while agent is running is not yet handled.",
            );
        });

        const resumeRequest = [
            `## Resuming Plan: ${plan.planName}`,
            "",
            `This plan was previously saved with status: ${plan.attrs.status}.`,
            `Continue working on it. The plan is at plans/${plan.planName}.md.`,
            "",
            "## Triage Report",
            `- Classification: ${triageMeta.classification}`,
            `- Complexity: ${triageMeta.complexity}`,
            `- Summary: ${triageMeta.summary}`,
            `- Affected paths: ${(triageMeta.affectedPaths || []).join(", ")}`,
            "",
            "Review the current plan, make any needed updates, and finalize it.",
            "If requirements are unclear, ask clarification questions via user_interview before locking changes.",
            "Ask one question or a focused 1-3 question batch per call and adapt based on answers.",
        ].join("\n");

        const result = await reviewLoop({
            agentName,
            customTools: [planWrittenTool, createUserInterviewTool(uiAPI)],
            initialRequest: resumeRequest,
            triageMeta,
            uiAPI,
        });

        if (result) {
            // Temporarily bypass CLI prompts inside TUI if possible
            uiAPI.appendSystemMessage(`[Harns] Plan "${result.planName}" approved!`);
            uiAPI.appendSystemMessage(`[Harns] Proceeding with execution...`);
            const execRes = await executePlan(result.planName, triageMeta, uiAPI, result.tasks);
            if (execRes && execRes.repairRequired) {
                const agentName = triageMeta.classification === "PROJECT" ? "architect" : "planner";
                uiAPI.appendSystemMessage(
                    `[Harns] Execution failed due to task table error. Rerouting to ${agentName} for repair...`,
                );
                await reviewLoop({
                    agentName,
                    customTools: [planWrittenTool, createUserInterviewTool(uiAPI)],
                    initialRequest: buildRepairPrompt(result.planName, execRes.error || "Unknown task table error"),
                    triageMeta,
                    uiAPI,
                });
            }
        }
    } finally {
        await restoreRouterFlow(uiAPI);
    }
}
