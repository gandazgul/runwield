/**
 * @module cmd/resume
 * Resume command implementation.
 */

import { parseArgs as parseArgsFn } from "@std/cli/parse-args";
import { CLI_BIN, CWD } from "../../constants.js";
import { resolvePlan as resolvePlanFn, updatePlanStatus as updatePlanStatusFn } from "../../plan-store.js";
import {
    askApprovalWithTasks as askApprovalWithTasksFn,
    askPostApproval as askPostApprovalFn,
    executePlan as executePlanFn,
    runPlanningAgent as runPlanningAgentFn,
} from "../../shared/workflow/workflow.js";
import { submitPlanForReview as submitPlanForReviewFn } from "../../shared/workflow/submit-plan.js";
import { printCommandHelp as printCommandHelpFn } from "../help/index.js";
import {
    setActiveAgent as setActiveAgentFn,
    startInteractiveSession as startInteractiveSessionFn,
} from "../../shared/chat-session.js";
import { resetTuiState as resetTuiStateFn } from "../command-helpers.js";
import { createDirectAgentHandler as createDirectAgentHandlerFn } from "../../shared/direct-agent.js";
export { getResumeCompletions } from "./getArgumentCompletions.js";

/**
 * @typedef ResumeTestDeps
 * @property {typeof parseArgsFn} [parseArgs]
 * @property {typeof printCommandHelpFn} [printCommandHelp]
 * @property {typeof startInteractiveSessionFn} [startInteractiveSession]
 * @property {typeof resolvePlanFn} [resolvePlan]
 * @property {typeof executePlanFn} [executePlan]
 * @property {typeof runPlanningAgentFn} [runPlanningAgent]
 * @property {typeof submitPlanForReviewFn} [submitPlanForReview]
 * @property {typeof askPostApprovalFn} [askPostApproval]
 * @property {typeof askApprovalWithTasksFn} [askApprovalWithTasks]
 * @property {typeof setActiveAgentFn} [setActiveAgent]
 * @property {typeof createDirectAgentHandlerFn} [createDirectAgentHandler]
 * @property {typeof resetTuiStateFn} [resetTuiState]
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
    const {
        resetTuiState: resetTuiStateDep,
        setActiveAgent: setActiveAgentDep,
        createDirectAgentHandler: createDirectAgentHandlerDep,
    } = deps;

    const resetTuiState = resetTuiStateDep || resetTuiStateFn;
    const setActiveAgent = setActiveAgentDep || setActiveAgentFn;
    const createDirectAgentHandler = createDirectAgentHandlerDep || createDirectAgentHandlerFn;

    resetTuiState(undefined, uiAPI, undefined);
    setActiveAgent("Router", createDirectAgentHandler("router"));
    uiAPI.appendSystemMessage("[Harns] Switched back to Router (triage flow).");
}

/**
 * Build the resume request handed to the planning agent.
 *
 * @param {string} planName
 * @param {{ classification: string, complexity: string, summary: string, affectedPaths?: string[], status: string }} attrs
 * @returns {string}
 */
function buildResumeRequest(planName, attrs) {
    return [
        `## Resuming Plan: ${planName}`,
        "",
        `This plan was previously saved with status: ${attrs.status}.`,
        `Continue working on it. The plan is at plans/${planName}.md.`,
        "",
        "## Triage Report",
        `- Classification: ${attrs.classification}`,
        `- Complexity: ${attrs.complexity}`,
        `- Summary: ${attrs.summary}`,
        `- Affected paths: ${(attrs.affectedPaths || []).join(", ")}`,
        "",
        "Review the current plan, make any needed updates, and finalize it.",
        "If requirements are unclear, ask clarification questions via user_interview before locking changes.",
        "When the plan is ready, call plan_written to submit it for review.",
    ].join("\n");
}

/**
 * Build the prompt that re-runs the planner after the user submits feedback on a
 * previously approved plan that was re-opened for review.
 *
 * @param {string} planName
 * @param {string | undefined} feedback
 * @returns {string}
 */
function buildReReviewRevisionRequest(planName, feedback) {
    return [
        `## Plan Review Re-opened: ${planName}`,
        "",
        "The user provided feedback on the previously approved plan:",
        "",
        feedback || "(no specific feedback provided)",
        "",
        `Revise plans/${planName}.md based on this feedback using the edit tool.`,
        "Then call plan_written again to submit the revision for review.",
    ].join("\n");
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
        runPlanningAgent: runPlanningAgentDep,
        submitPlanForReview: submitPlanForReviewDep,
        askPostApproval: askPostApprovalDep,
        askApprovalWithTasks: askApprovalWithTasksDep,
        setActiveAgent: setActiveAgentDep,
        createDirectAgentHandler: createDirectAgentHandlerDep,
        listPlans: listPlansDep,
        updatePlanStatus: updatePlanStatusDep,
    } = deps;

    const parseArgs = parseArgsDep || parseArgsFn;
    const printCommandHelp = printCommandHelpDep || printCommandHelpFn;
    const startInteractiveSession = startInteractiveSessionDep || startInteractiveSessionFn;
    const resolvePlan = resolvePlanDep || resolvePlanFn;
    const executePlan = executePlanDep || executePlanFn;
    const runPlanningAgent = runPlanningAgentDep || runPlanningAgentFn;
    const submitPlanForReview = submitPlanForReviewDep || submitPlanForReviewFn;
    const askPostApproval = askPostApprovalDep || askPostApprovalFn;
    const askApprovalWithTasks = askApprovalWithTasksDep || askApprovalWithTasksFn;
    const setActiveAgent = setActiveAgentDep || setActiveAgentFn;
    const createDirectAgentHandler = createDirectAgentHandlerDep || createDirectAgentHandlerFn;
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

                if (!answer) return;

                if (answer === "proceed") {
                    const execRes = await executePlan(plan.planName, plan.attrs, uiAPI);
                    if (execRes && execRes.repairRequired) {
                        uiAPI.appendSystemMessage(
                            `[Harns] Execution failed due to task table error. Rerouting to ${agentName} for repair...`,
                        );
                        setActiveAgent(agentName, createDirectAgentHandler(agentName), uiAPI);
                        await runPlanningAgent({
                            agentName,
                            initialRequest: [
                                `## Plan Execution Halted — Task Table Repair Required`,
                                "",
                                `The plan "${plan.planName}" had a malformed Tasks table: ${
                                    execRes.error || "Unknown task table error"
                                }.`,
                                "",
                                "Fix the table to follow (Task ID | Assignee | Dependencies | Description),",
                                "then call plan_written again with the corrected tasks array.",
                            ].join("\n"),
                            triageMeta: plan.attrs,
                            uiAPI,
                        });
                    }
                    return;
                }

                if (answer === "review") {
                    setActiveAgent(agentName, createDirectAgentHandler(agentName), uiAPI);

                    const reviewResult = await submitPlanForReview({
                        cwd: CWD,
                        planName: plan.planName,
                        planPath: plan.path,
                        triageMeta: plan.attrs,
                        uiAPI,
                    });

                    if (reviewResult.canceled) {
                        uiAPI.appendSystemMessage("[Harns] Plan review canceled.");
                        skipRouterRestore = true;
                        return;
                    }

                    if (reviewResult.approved) {
                        const action = plan.attrs.classification === "PROJECT"
                            ? await askApprovalWithTasks(plan.planName, uiAPI)
                            : await askPostApproval(plan.planName, uiAPI);
                        if (action === "proceed") {
                            await executePlan(plan.planName, plan.attrs, uiAPI);
                            setActiveAgent("Operator", createDirectAgentHandler("operator"), uiAPI);
                        } else {
                            uiAPI.appendSystemMessage(
                                `[Harns] Plan saved. Resume later with: ${CLI_BIN} resume ${plan.planName}`,
                            );
                            skipRouterRestore = true;
                        }
                        return;
                    }

                    // User submitted feedback — kick off the planning agent to revise.
                    const outcome = await runPlanningAgent({
                        agentName,
                        initialRequest: buildReReviewRevisionRequest(plan.planName, reviewResult.feedback),
                        triageMeta: plan.attrs,
                        uiAPI,
                    });

                    if (outcome.outcome === "executed") {
                        setActiveAgent("Operator", createDirectAgentHandler("operator"), uiAPI);
                    } else if (
                        outcome.outcome === "canceled" || outcome.outcome === "no_call" ||
                        outcome.outcome === "feedback" || outcome.outcome === "repair_required"
                    ) {
                        skipRouterRestore = true;
                    }
                    return;
                }

                if (answer === "view") {
                    uiAPI.appendSystemMessage(`\n${plan.body}\n`);
                }
            }
        }

        // Not approved — kick off the planning agent. plan_written handles review/save/execute.
        setActiveAgent(agentName, createDirectAgentHandler(agentName), uiAPI);

        const outcome = await runPlanningAgent({
            agentName,
            initialRequest: buildResumeRequest(plan.planName, plan.attrs),
            triageMeta,
            uiAPI,
        });

        if (outcome.outcome === "executed") {
            setActiveAgent("Operator", createDirectAgentHandler("operator"), uiAPI);
        } else if (
            outcome.outcome === "canceled" || outcome.outcome === "no_call" ||
            outcome.outcome === "feedback" || outcome.outcome === "repair_required"
        ) {
            skipRouterRestore = true;
        }
    } finally {
        if (!skipRouterRestore) {
            restoreRouterFlow(uiAPI, deps);
        }
    }
}
