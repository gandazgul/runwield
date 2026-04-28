/**
 * @module cmd/resume
 * Resume command implementation.
 */

import { parseArgs } from "@std/cli/parse-args";
import { CLI_BIN, CWD, TOOLSETS } from "../../constants.js";
import { resolvePlan } from "../../plan-store.js";
import { submitPlanForReview } from "../../tools/submit-plan.js";
import { planWrittenTool } from "../../tools/plan-written.js";
import { askPostApproval, executePlan, reviewLoop } from "../../shared/workflow.js";
import { printCommandHelp } from "../../shared/help-text.js";
import { setActiveAgent, startInteractiveSession } from "../../shared/chat-session.js";

/**
 * Handle `resume` command.
 *
 * @param {string[]} argv
 * @param {Object} [options]
 * @param {import('../../shared/workflow.js').UiAPI} [options.uiAPI]
 * @param {any} [options.editor]
 * @param {string} [options.text]
 * @param {Function} [options.originalHandleInput]
 */
export async function runResumeCommand(argv, options = {}) {
    const parsed = parseArgs(argv, {
        boolean: ["help"],
        alias: { h: "help" },
        stopEarly: true,
    });

    if (parsed.help) {
        printCommandHelp("resume");
        return;
    }

    const [planArg] = parsed._.map(String);
    if (!planArg) {
        if (options.uiAPI && options.editor) {
            if (options.text !== "/resume") {
                options.uiAPI.appendSystemMessage("Resume canceled.");
                options.editor.setText("");
                options.editor.disableSubmit = false;
                return;
            }

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

            options.editor.setText("/resume ");
            options.editor.cursorCol = 8;
            options.editor.disableSubmit = false;

            // Delay autocomplete request slightly to ensure it fires AFTER
            // the current submission cycle is fully resolved in the pi-tui loop.
            setTimeout(() => {
                if (typeof options.editor.requestAutocomplete === "function") {
                    try {
                        options.editor.requestAutocomplete({ force: true });
                    } catch (_e) {
                        if (options.originalHandleInput) {
                            options.originalHandleInput(" ");
                        }
                    }
                } else if (options.originalHandleInput) {
                    options.originalHandleInput(" ");
                }
            }, 50);
            return;
        }

        console.error(`Usage: ${CLI_BIN} resume <plan-name-or-path>`);
        Deno.exit(1);
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
                        toolNames: TOOLSETS.PLANNING,
                        customTools: [planWrittenTool],
                        initialRequest:
                            `The previously approved plan "${plan.planName}" had a malformed Tasks table: ${execRes.error}.\n\nPlease fix the table to ensure it follows the required format (Task ID | Assignee | Dependencies | Description) and call plan_written again.`,
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
    ].join("\n");

    const result = await reviewLoop({
        agentName,
        toolNames: TOOLSETS.PLANNING,
        customTools: [planWrittenTool],
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
                toolNames: TOOLSETS.PLANNING,
                customTools: [planWrittenTool],
                initialRequest:
                    `The previously approved plan "${result.planName}" had a malformed Tasks table: ${execRes.error}.\n\nPlease fix the table to ensure it follows the required format (Task ID | Assignee | Dependencies | Description) and call plan_written again.`,
                triageMeta,
                uiAPI,
            });
        }
    }
}
