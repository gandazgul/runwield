/**
 * @module cmd/resume
 * Resume command implementation.
 */

import { parseArgs as parseArgsFn } from "@std/cli/parse-args";
import { CLI_BIN, CWD } from "../../constants.js";
import { resolvePlan as resolvePlanFn, updatePlanStatus as updatePlanStatusFn } from "../../plan-store.js";
import { planWrittenTool as planWrittenToolFn } from "../../tools/plan-written.js";
import { createUserInterviewTool as createUserInterviewToolFn } from "../../tools/user-interview.js";
import {
    executePlan as executePlanFn,
    reviewLoop as reviewLoopFn,
    runPlanLifecycle as runPlanLifecycleFn,
} from "../../shared/workflow/workflow.js";
import { printCommandHelp as printCommandHelpFn } from "../help/index.js";
import {
    setActiveAgent as setActiveAgentFn,
    startInteractiveSession as startInteractiveSessionFn,
} from "../../shared/chat-session.js";
import { resetTuiState as resetTuiStateFn } from "../command-helpers.js";
import { buildRepairPrompt as buildRepairPromptFn } from "../../shared/workflow/workflow.js";
import { createDirectAgentHandler as createDirectAgentHandlerFn } from "../../shared/direct-agent.js";
export { getResumeCompletions } from "./getArgumentCompletions.js";

/**
 * @typedef ResumeTestDeps
 * @property {typeof parseArgsFn} [parseArgs]
 * @property {typeof printCommandHelpFn} [printCommandHelp]
 * @property {typeof startInteractiveSessionFn} [startInteractiveSession]
 * @property {typeof resolvePlanFn} [resolvePlan]
 * @property {typeof executePlanFn} [executePlan]
 * @property {typeof reviewLoopFn} [reviewLoop]
 * @property {typeof runPlanLifecycleFn} [runPlanLifecycle]
 * @property {typeof setActiveAgentFn} [setActiveAgent]
 * @property {typeof createDirectAgentHandlerFn} [createDirectAgentHandler]
 * @property {typeof buildRepairPromptFn} [buildRepairPrompt]
 * @property {typeof resetTuiStateFn} [resetTuiState]
 * @property {typeof createUserInterviewToolFn} [createUserInterviewTool]
 * @property {typeof planWrittenToolFn} [planWrittenTool]
 * @property {(cwd: string) => Promise<Array<{name: string, attrs: {classification: string, status: string}}>>} [listPlans]
 * @property {typeof updatePlanStatusFn} [updatePlanStatus]
 */

/**
 * Restore default Router flow and input readiness after resume command work.
 *
 * @param {import('../../shared/workflow/workflow.js').UiAPI} uiAPI
 * @param {ResumeTestDeps} [deps]
 */
function restoreRouterFlow(uiAPI, deps = {}) {
    const { resetTuiState: resetTuiStateDep, setActiveAgent: setActiveAgentDep, createDirectAgentHandler: createDirectAgentHandlerDep } = deps;

    const resetTuiState = resetTuiStateDep || resetTuiStateFn;
    const setActiveAgent = setActiveAgentDep || setActiveAgentFn;
    const createDirectAgentHandler = createDirectAgentHandlerDep || createDirectAgentHandlerFn;

    resetTuiState(undefined, uiAPI, undefined);
    setActiveAgent("Router", createDirectAgentHandler("router"));
    uiAPI.appendSystemMessage("[Harns] Switched back to Router (triage flow).");
}

/**
 * Handle `resume-plan` command.
 *
 * @param {string[]} argv
 * @param {import('../registry.js').CommandContext & { __testDeps?: ResumeTestDeps }} [options]
 */
export async function runResumePlanCommand(argv, options = {}) {
    const deps = /** @type {ResumeTestDeps} */ ((/** @type {any} */ (options)).__testDeps || {});
    const {
        parseArgs: parseArgsDep,
        printCommandHelp: printCommandHelpDep,
        startInteractiveSession: startInteractiveSessionDep,
        resolvePlan: resolvePlanDep,
        executePlan: executePlanDep,
        reviewLoop: reviewLoopDep,
        runPlanLifecycle: runPlanLifecycleDep,
        setActiveAgent: setActiveAgentDep,
        createDirectAgentHandler: createDirectAgentHandlerDep,
        buildRepairPrompt: buildRepairPromptDep,
        createUserInterviewTool: createUserInterviewToolDep,
        planWrittenTool: planWrittenToolDep,
        listPlans: listPlansDep,
        updatePlanStatus: updatePlanStatusDep,
    } = deps;

    const parseArgs = parseArgsDep || parseArgsFn;
    const printCommandHelp = printCommandHelpDep || printCommandHelpFn;
    const startInteractiveSession = startInteractiveSessionDep || startInteractiveSessionFn;
    const resolvePlan = resolvePlanDep || resolvePlanFn;
    const executePlan = executePlanDep || executePlanFn;
    const reviewLoop = reviewLoopDep || reviewLoopFn;
    const runPlanLifecycle = runPlanLifecycleDep || runPlanLifecycleFn;
    const setActiveAgent = setActiveAgentDep || setActiveAgentFn;
    const createDirectAgentHandler = createDirectAgentHandlerDep || createDirectAgentHandlerFn;
    const buildRepairPrompt = buildRepairPromptDep || buildRepairPromptFn;
    const createUserInterviewTool = createUserInterviewToolDep || createUserInterviewToolFn;
    const planWrittenToolDef = planWrittenToolDep || planWrittenToolFn;
    const updatePlanStatus = updatePlanStatusDep || updatePlanStatusFn;

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
            const listPlans = listPlansDep || (await import("../../plan-store.js")).listPlans;
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
                // User pressed Esc — silently cancel
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

    let skipRouterRestore = false;

    try {
        uiAPI.appendSystemMessage(`[Harns] Resuming plan: ${planArg}`);

        const plan = await resolvePlan(CWD, planArg);
        uiAPI.appendSystemMessage(`[Harns] Plan loaded: ${plan.planName}`);
        uiAPI.appendSystemMessage(
            `[Harns] Classification: ${plan.attrs.classification}, Status: ${plan.attrs.status}`,
        );

        const triageMeta = plan.attrs;
        const agentName = triageMeta.classification === "PROJECT" ? "architect" : "planner";

        if (plan.attrs.status === "completed") {
            uiAPI.appendSystemMessage("[Harns] Warning: This plan is already marked as completed.");
            const answer = await uiAPI.promptSelect("Are you sure you want to resume it?", [
                { value: "yes", label: "Yes, resume and reset to in_review" },
                { value: "no", label: "No, cancel" },
            ]);
            if (answer !== "yes") {
                return;
            }
            await updatePlanStatus(CWD, plan.planName, "in_review", plan.attrs);
            plan.attrs.status = "in_review";
        }

        if (plan.attrs.status === "approved") {
            uiAPI.appendSystemMessage("[Harns] This plan has already been approved.");

            while (true) {
                const answer = await uiAPI.promptSelect("What would you like to do?", [
                    { value: "proceed", label: "Proceed with execution" },
                    { value: "review", label: "Re-open for review (edit/annotate)" },
                    { value: "view", label: "View plan details" },
                ]);

                if (!answer) {
                    // User pressed Esc — silently cancel
                    return;
                }

                if (answer === "proceed") {
                    const execRes = await executePlan(plan.planName, plan.attrs, uiAPI);
                    if (execRes && execRes.repairRequired) {
                        const repairAgentName = triageMeta.classification === "PROJECT" ? "architect" : "planner";
                        uiAPI.appendSystemMessage(
                            `[Harns] Execution failed due to task table error. Rerouting to ${repairAgentName} for repair...`,
                        );
                        await reviewLoop({
                            agentName: repairAgentName,
                            customTools: [planWrittenToolDef, createUserInterviewTool(uiAPI)],
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
                    const lifecycle = await runPlanLifecycle({
                        agentName,
                        triageMeta: plan.attrs,
                        customTools: [planWrittenToolDef, createUserInterviewTool(uiAPI)],
                        existingPlan: {
                            planName: plan.planName,
                            planPath: plan.path,
                        },
                        uiAPI,
                        buildRepairPrompt,
                    });

                    if (lifecycle.status === "executed") {
                        setActiveAgent("Operator", createDirectAgentHandler("operator"), uiAPI);
                    } else if (lifecycle.status === "canceled") {
                        skipRouterRestore = true;
                        setActiveAgent(agentName, createDirectAgentHandler(agentName), uiAPI);
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

        const lifecycle = await runPlanLifecycle({
            agentName,
            triageMeta,
            customTools: [planWrittenToolDef, createUserInterviewTool(uiAPI)],
            initialRequest: resumeRequest,
            uiAPI,
            buildRepairPrompt,
        });

        if (lifecycle.status === "executed") {
            setActiveAgent("Operator", createDirectAgentHandler("operator"), uiAPI);
        } else if (lifecycle.status === "canceled") {
            skipRouterRestore = true;
            setActiveAgent(agentName, createDirectAgentHandler(agentName), uiAPI);
        }
    } finally {
        if (!skipRouterRestore) {
            restoreRouterFlow(uiAPI, deps);
        }
    }
}
