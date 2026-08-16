/**
 * @module cmd/load-plan
 * Load-plan command implementation. Loads a saved Plan from disk and continues
 * work on it (review/edit/execute), distinct from /resume which restores a
 * previous chat session.
 */

import { parseArgs } from "@std/cli/parse-args";
import { AGENTS, CLI_BIN } from "../../constants.js";
import {
    archivePlan,
    ensurePlanIdentity,
    listPlans,
    loadPlan,
    onboardExternalPlan,
    resolvePlan,
    resolvePlanExecutionPolicy,
    resolveSiblingChildPlanDependencies,
} from "../../plan-store.js";
import { formatArchiveRetentionNudge } from "../../shared/plan-archive-retention.ts";
import { decidePostExecution, decidePostPlanning } from "../../shared/workflow/decisions.js";
import {
    buildPlannerReReviewRequest,
    buildPlanSummary,
    buildReReviewRevisionRequest,
    buildResumeRequest,
} from "./plan-presentation.ts";
import { handlePlanRecovery, SYSTEM_RECOVERY_FLOW_PORTS } from "./plan-recovery-flow.ts";
import {
    buildManagedUnsupportedLoadPlanMessage,
    createPlanSessionSurface,
    isManagedUnsupportedError,
    restorePreviousAgentFlow,
    selectPlanFlowRestoreAgent,
} from "./plan-session-surface.ts";
import { handleEpicPlan } from "./plan-epic-flow.ts";
import {
    confirmAffectedPathChangesBeforeExecution,
    executePostPlanningDecision,
    executeReadyPlanWithRepair,
    prepareApprovedPlanForWork,
    shouldKeepPlanningAgentActive,
    validatePlanExecutionPolicyForReadiness,
    validatePostExecutionDecision,
} from "./plan-execution.ts";
import {
    handleOnHoldPlan,
    isHoldableStatus,
    isUserVerifiableStatus,
    markPlanUserVerified,
    putPlanOnHold,
} from "./plan-hold.ts";
import { confirmChildFeatureDependencies, formatTopLevelPlanOption } from "./plan-epic-children.ts";
import {
    assertRecoveryWorktreeIsManaged,
    reopenPlanForReview,
    resolveRecoveryWorktree,
} from "./plan-recovery-worktree.ts";
import { healSettledTransitionRecords } from "../../shared/workflow/transition-recovery.ts";
import {
    isEpicPlan,
    isExecutablePlanStatus,
    isInValidation,
    isPlanReviewableWithoutReopen,
    recordPlanEvent,
} from "../../shared/workflow/plan-lifecycle.js";
import { normalizePlanApprovalAction, PLAN_APPROVAL_ACTIONS } from "../../shared/workflow/plan-approval.js";
import { loadPlanActionEvidence } from "../../shared/workflow/plan-actions.ts";
import {
    appendSessionCompleteGuidance,
    requestRecoverablePlanReview,
    SESSION_COMPLETE_GUIDANCE,
} from "../../shared/workflow/plan-review-recovery.js";
import { printCommandHelp } from "../help/index.js";
import { startInteractiveSession } from "../../ui/tui/chat-session.ts";
import { SYSTEM_BROWSER_PORT } from "../../shared/browser-port.ts";
import { setTerminalTitleForName } from "../../ui/tui/terminal-title.ts";
import { RuntimeInteractionOutcomes } from "../../shared/session/session-runtime-interactions.js";
import type { CommandContext } from "../registry.js";

export { getLoadPlanCompletions } from "./getArgumentCompletions.js";

type TransitionRecoveryRecord = Awaited<ReturnType<typeof healSettledTransitionRecords>>["remaining"][number];

/**
 * Handle `load-plan` command.
 *
 * @param {string[]} argv
 * @param {import('../registry.js').CommandContext} [options]
 */
export async function runLoadPlanCommand(argv: string[], options: CommandContext = {}): Promise<void> {
    let sessionRuntime = options.sessionRuntime;
    let runtimeSessionId = options.sessionId;

    const parsedArgs = parseArgs(argv, {
        boolean: ["help"],
        alias: { h: "help" },
        stopEarly: true,
    });

    if (parsedArgs.help) {
        printCommandHelp("load-plan");
        return;
    }

    let [planArg] = parsedArgs._.map(String);
    if (!planArg) {
        if (options.uiAPI && options.editor) {
            if (!sessionRuntime || !runtimeSessionId) {
                throw new Error("runLoadPlanCommand requires an active runtime session for plan selection");
            }
            const activeSnapshot = sessionRuntime.getSessionSnapshot(runtimeSessionId);
            if (!activeSnapshot) throw new Error("runLoadPlanCommand runtime session is missing");
            const plans = await listPlans(activeSnapshot.cwd);
            if (plans.length === 0) {
                options.uiAPI.appendSystemMessage(
                    "No plans available, start one by entering a new request",
                );
                options.editor.setText("");
                options.editor.disableSubmit = false;
                return;
            }

            const topLevelPlans = plans.filter((plan) => !plan.attrs.parentPlan);
            if (topLevelPlans.length === 0) {
                options.uiAPI.appendSystemMessage(
                    "No top-level plans available. Load the parent Epic directly or create a plan.",
                );
                options.editor.setText("");
                options.editor.disableSubmit = false;
                return;
            }

            const planOptions = topLevelPlans.map(formatTopLevelPlanOption);

            const chosen = await options.uiAPI.promptSelect("Load plan:", planOptions, {
                layout: { maxPrimaryColumnWidth: 96 },
            });
            if (!chosen) {
                options.editor.setText("");
                options.editor.disableSubmit = false;
                return;
            }

            planArg = chosen;
        } else {
            console.error(`Usage: ${CLI_BIN} load-plan <plan-name-or-path>`);
            Deno.exit(1);
        }
    }

    let uiAPI = options.uiAPI;

    if (!uiAPI) {
        uiAPI = await startInteractiveSession(
            null,
            {
                browser: SYSTEM_BROWSER_PORT,
                onSessionReady: (nextSessionId, nextRuntime) => {
                    runtimeSessionId = nextSessionId;
                    sessionRuntime = nextRuntime;
                },
            },
        );
    }

    if (!uiAPI) return;
    if (!sessionRuntime || !runtimeSessionId) throw new Error("runLoadPlanCommand requires a runtime session");
    const runtime = sessionRuntime;
    const activeSessionId = runtimeSessionId;
    const session = createPlanSessionSurface(runtime, activeSessionId, {
        executePlan: async (options) => {
            const planId = typeof options.triageMeta?.planId === "string" ? options.triageMeta.planId : "";
            const evidence = planId ? await loadPlanActionEvidence(projectRoot, planId) : null;
            if (evidence?.kind !== "success") {
                console.error("[RunWield] plan_execution_evidence_unavailable", evidence?.kind || "missing_plan_id");
            }
            return await runtime.executePlan(activeSessionId, {
                ...options,
                ...(evidence?.kind === "success" ? { approvalEvidence: evidence.evidence } : {}),
            });
        },
        runPlanningAgent: (options) => runtime.runPlanningAgent(activeSessionId, options),
        runValidation: (options) => runtime.runValidation(activeSessionId, options),
        runSlicerAgent: (options) => runtime.runSlicerAgent(activeSessionId, options),
    });
    const projectRoot = session.cwd;
    const executePlan = session.executePlan;
    const runPlanningAgent = session.runPlanningAgent;
    const continueWorkflowValidation = session.runValidation;
    const runSlicerAgent = session.runSlicerAgent;
    const switchPlanAgent = session.switchAgent;

    let skipRouterRestore = false;
    const initialAgentName = session.getActiveAgentName() || AGENTS.ROUTER;
    let restoreAgentName = initialAgentName;

    let loadedPlanName = null;
    let unresolvedLifecycleRecords: TransitionRecoveryRecord[] = [];

    try {
        const plan = await resolvePlan(projectRoot, planArg);
        loadedPlanName = plan.planName;
        // Clear our own leftovers before doing anything with the Plan. An interrupted
        // lifecycle operation blocks every later one, and the record is RunWield's
        // bookkeeping, not the user's problem — so anything the repository proves is
        // finished gets closed here and the load simply continues. Only what genuinely
        // needs a decision is surfaced, and then with the command that resolves it.
        try {
            const healed = await healSettledTransitionRecords(projectRoot, { planName: plan.planName });
            unresolvedLifecycleRecords = healed.remaining;
            if (healed.closed.length > 0) {
                uiAPI.appendSystemMessage(
                    `Cleared ${healed.closed.length} unfinished lifecycle record${
                        healed.closed.length === 1 ? "" : "s"
                    } for ${plan.planName} that the repository proves are already settled. Continuing.`,
                    false,
                    "RunWield",
                );
            }
            for (const remaining of healed.remaining) {
                uiAPI.appendSystemMessage(
                    `${plan.planName} has an unfinished ${
                        remaining.operation || "lifecycle operation"
                    } that RunWield cannot confirm on its own: ${remaining.reason}. ` +
                        `Lifecycle changes to this Plan stay blocked until it is resolved. ` +
                        `Plan Recovery opens below with "Close the unfinished lifecycle record" as the first option; ` +
                        `run \`${CLI_BIN} plans doctor\` first if you want to see the exact evidence that is missing.`,
                    true,
                    "RunWield",
                );
            }
        } catch (healError) {
            // Never let bookkeeping cleanup stop a Plan from loading.
            uiAPI.appendSystemMessage(
                `Could not check for unfinished lifecycle records: ${
                    healError instanceof Error ? healError.message : String(healError)
                }`,
                true,
                "RunWield",
            );
        }
        // Loading is the deliberate action that adopts a plain markdown file the user
        // wrote into docs/plans/. Reads elsewhere tolerate the missing Front Matter and
        // leave the file alone; here it stops being an anonymous file and becomes a
        // Plan with a durable identity, so the rest of this flow has something to
        // record lifecycle state on.
        if (plan.hasFrontMatter === false) {
            const adopted = await onboardExternalPlan(projectRoot, plan.planName);
            if (adopted.onboarded) {
                plan.attrs = adopted.resource.attrs;
                plan.markdown = adopted.resource.markdown;
                plan.body = adopted.resource.body;
                plan.revision = adopted.resource.revision;
                uiAPI.appendSystemMessage(
                    `Adopted ${plan.planName} as a RunWield Plan: added front matter (status draft, external origin) ` +
                        "and left your text untouched.",
                    false,
                    "RunWield",
                );
            }
        }
        if (!plan.attrs.planId) {
            const identified = await ensurePlanIdentity(projectRoot, plan.planName);
            plan.attrs = identified.attrs;
            plan.markdown = identified.markdown;
            plan.body = identified.body;
            plan.revision = identified.revision;
        }
        uiAPI.appendSystemMessage(`Plan loaded: ${plan.planName}`, false, "RunWield");
        uiAPI.appendSystemMessage(
            `Classification: ${plan.attrs.classification}, Status: ${plan.attrs.status}`,
            false,
            "RunWield",
        );

        // Set terminal title and session name to the plan's name
        setTerminalTitleForName(plan.planName);
        await session.rename(plan.planName);

        const triageMeta = plan.attrs;
        const agentName = triageMeta.classification === "PROJECT" ? AGENTS.ARCHITECT : AGENTS.PLANNER;
        const planFlowRestoreAgent = selectPlanFlowRestoreAgent(initialAgentName, agentName);
        /** @param {string} targetPlanName */
        const loadAnotherPlan = async (targetPlanName: string) => {
            skipRouterRestore = true;
            await runLoadPlanCommand([targetPlanName], {
                ...options,
            });
        };

        if (plan.attrs.parentPlan) {
            try {
                const parentPlan = await resolvePlan(projectRoot, plan.attrs.parentPlan);
                if (parentPlan.attrs.status === "on_hold") {
                    uiAPI.appendSystemMessage(
                        `Parent Epic "${parentPlan.planName}" is on hold. Resume the parent before working on child Planned Change "${plan.planName}".`,
                        true,
                        "RunWield",
                    );
                    while (true) {
                        const answer = await uiAPI.promptSelect("Parent Epic is on hold. What would you like to do?", [
                            { value: "resume_parent", label: "Resume from hold" },
                            { value: "view", label: "View plan details" },
                            { value: "cancel", label: "Cancel / Keep on hold" },
                        ]);
                        if (!answer || answer === "cancel") return;
                        if (answer === "view") {
                            uiAPI.appendSystemMessage(buildPlanSummary(parentPlan), false, "Plan");
                            continue;
                        }
                        if (answer === "resume_parent") {
                            await loadAnotherPlan(parentPlan.planName);
                            return;
                        }
                    }
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                uiAPI.appendSystemMessage(`Could not inspect parent Epic hold status: ${message}`, true, "RunWield");
            }
        }

        if (plan.attrs.status === "on_hold") {
            const result = await handleOnHoldPlan({
                projectRoot,
                plan,
                uiAPI,
            });
            if (result === "handled") return;
        }

        const epicResult = await handleEpicPlan({
            projectRoot,
            plan,
            uiAPI,
            runSlicerAgent,
            loadChildPlan: loadAnotherPlan,
        });
        if (epicResult === "handled") {
            skipRouterRestore = true;
            return;
        }
        const forceReview = epicResult === "review";

        // An unprovable record blocks every lifecycle change, so it has to be reachable
        // from Plan Recovery whatever the Plan's status is. Otherwise a draft or
        // verified Plan is told it is blocked and offered nothing.
        if (
            ["in_progress", "failed"].includes(plan.attrs.status) ||
            isInValidation(plan.attrs.status) ||
            unresolvedLifecycleRecords.length > 0
        ) {
            restoreAgentName = planFlowRestoreAgent;
            const result = await handlePlanRecovery({
                projectRoot,
                plan,
                agentName,
                uiAPI,
                unresolvedRecords: unresolvedLifecycleRecords,
                session,
                ports: SYSTEM_RECOVERY_FLOW_PORTS,
            });
            if (result === "handled") return;
        }

        const dependenciesConfirmed = await confirmChildFeatureDependencies(
            projectRoot,
            plan,
            uiAPI,
            resolveSiblingChildPlanDependencies,
        );
        if (!dependenciesConfirmed) return;

        if (plan.attrs.status === "verified" || plan.attrs.status === "user_verified") {
            uiAPI.appendSystemMessage(
                plan.attrs.status === "verified"
                    ? "This plan is already verified."
                    : "This plan is User Verified by user attestation.",
                false,
                "RunWield",
            );
            while (true) {
                const answer = await uiAPI.promptSelect("What would you like to do?", [
                    { value: "review", label: "Re-open for review (planner/architect)" },
                    { value: "archive", label: "Archive plan" },
                    { value: "view", label: "View plan details" },
                    { value: "cancel", label: "Cancel" },
                ]);
                if (!answer || answer === "cancel") {
                    return;
                }
                if (answer === "view") {
                    uiAPI.appendSystemMessage(buildPlanSummary(plan), false, "Plan");
                    continue;
                }
                if (answer === "archive") {
                    const archived = await archivePlan(projectRoot, plan.planName);
                    uiAPI.appendSystemMessage(
                        `Archived ${plan.planName} to ${archived.relativePath}`,
                        false,
                        "RunWield",
                    );
                    const nudge = await formatArchiveRetentionNudge(projectRoot);
                    if (nudge) uiAPI.appendSystemMessage(nudge, false, "RunWield");
                    return;
                }
                await reopenPlanForReview({
                    projectRoot,
                    plan,
                    currentStatus: plan.attrs.status,
                    session,
                });
                break;
            }
        }

        if (plan.attrs.status === "approved" || isExecutablePlanStatus(plan.attrs.status)) {
            let reviewForced = forceReview;
            while (true) {
                const answer = reviewForced ? "review" : await uiAPI.promptSelect("What would you like to do?", [
                    { value: "proceed", label: "Proceed with execution" },
                    ...(plan.attrs.status === "ready_for_work"
                        ? [{ value: "planner_re_review", label: "Send back to Planner for re-review" }]
                        : []),
                    { value: "review", label: "Re-open for review (edit/annotate)" },
                    {
                        value: "user_verify",
                        label: "Mark as User Verified (user attestation; no Workflow Validation claim)",
                    },
                    { value: "hold", label: "Put on hold" },
                    { value: "view", label: "View plan details" },
                    { value: "cancel", label: "Cancel" },
                ]);
                reviewForced = false;

                if (!answer || answer === "cancel") return;

                if (answer === "hold") {
                    await putPlanOnHold({ projectRoot, plan, uiAPI });
                    return;
                }

                if (answer === "user_verify") {
                    await markPlanUserVerified({
                        projectRoot,
                        plan,
                        uiAPI,
                    });
                    return;
                }

                if (answer === "proceed") {
                    restoreAgentName = planFlowRestoreAgent;
                    if (plan.attrs.status === "approved") {
                        const ready = await prepareApprovedPlanForWork(
                            projectRoot,
                            plan,
                            uiAPI,
                        );
                        if (!ready) {
                            skipRouterRestore = true;
                            return;
                        }
                    }

                    await executeReadyPlanWithRepair({
                        projectRoot,
                        plan,
                        agentName,
                        uiAPI,
                        executePlan,
                        continueWorkflowValidation,
                        session,
                    });
                    return;
                }

                if (answer === "planner_re_review") {
                    restoreAgentName = planFlowRestoreAgent;
                    const preReviewStatus = plan.attrs.status;

                    await reopenPlanForReview({
                        projectRoot,
                        plan,
                        currentStatus: preReviewStatus,
                        session,
                    });
                    await switchPlanAgent(agentName);

                    const outcome = await runPlanningAgent({
                        agentName,
                        initialRequest: buildPlannerReReviewRequest(plan.planName),
                        triageMeta: plan.attrs,
                        planName: plan.planName,
                    });

                    const planningDecision = decidePostPlanning(outcome, {
                        planningAgentName: agentName,
                        fallbackTriageMeta: plan.attrs,
                    });
                    await executePostPlanningDecision({
                        decision: planningDecision,
                        fallbackPlanContent: plan.markdown || plan.body || "",
                        uiAPI,
                        executePlan,
                        continueWorkflowValidation,
                        runSlicerAgent,
                        session,
                    });
                    if (shouldKeepPlanningAgentActive(planningDecision)) {
                        skipRouterRestore = true;
                    }
                    return;
                }

                if (answer === "review") {
                    restoreAgentName = planFlowRestoreAgent;
                    // The reviewer detaches the Plan from its execution generation as
                    // part of committing its decision, so load-plan does not reopen
                    // here. What it must still do is refuse up front: an unmanaged
                    // worktree cannot be abandoned, and finding that out after someone
                    // has reviewed the Plan wastes the review.
                    assertRecoveryWorktreeIsManaged(
                        plan.planName,
                        await resolveRecoveryWorktree(projectRoot, plan),
                    );

                    await switchPlanAgent(agentName);

                    const recoverableReview = await requestRecoverablePlanReview({
                        requestReview: () =>
                            session.reviewPlan({
                                planName: plan.planName,
                                planPath: plan.path,
                                triageMeta: plan.attrs,
                            }),
                        requestRetry: async ({ response }) => {
                            if (response?.cancellationReason === "runtime_cancel") {
                                return { outcome: RuntimeInteractionOutcomes.CANCELED, value: false };
                            }
                            const value = await uiAPI.promptSelect("Review the Plan again?", [
                                { value: "yes", label: "Yes" },
                                { value: "no", label: "No" },
                            ]);
                            return value === "yes"
                                ? { outcome: RuntimeInteractionOutcomes.ACCEPTED, value: true }
                                : { outcome: RuntimeInteractionOutcomes.CANCELED, value: false };
                        },
                        onUnanswered: ({ reason }) => {
                            uiAPI.appendSystemMessage(
                                `Plan review ended without an answer (${reason}).`,
                                false,
                                "RunWield",
                            );
                        },
                    });

                    if (recoverableReview.kind === "complete") {
                        uiAPI.appendSystemMessage(SESSION_COMPLETE_GUIDANCE, false, "RunWield");
                        skipRouterRestore = true;
                        return;
                    }

                    const reviewResult = recoverableReview.response;

                    if (reviewResult.remoteReview) {
                        uiAPI.appendSystemMessage(
                            reviewResult.message || `Plan saved for remote review: ${plan.planName}`,
                            false,
                            "RunWield",
                        );
                        skipRouterRestore = true;
                        return;
                    }

                    // The reviewer's transaction may have abandoned the execution
                    // generation this session was still pointing at.
                    if (!isPlanReviewableWithoutReopen(plan.attrs.status)) {
                        await session.clearActiveExecutionWorkflow();
                    }

                    if (reviewResult.approved) {
                        let reloadedAfterReview = false;
                        try {
                            const latestPlan = await loadPlan(projectRoot, plan.planName);
                            if (latestPlan) {
                                plan.attrs = reviewResult.planAttrs
                                    ? { ...latestPlan.attrs, ...reviewResult.planAttrs }
                                    : latestPlan.attrs;
                                plan.body = latestPlan.body;
                                plan.markdown = latestPlan.markdown || latestPlan.body || plan.markdown;
                                reloadedAfterReview = true;
                            }
                        } catch {
                            // Keep the in-memory Plan if a test fake does not support reloading after review.
                        }
                        if (!reloadedAfterReview && reviewResult.planAttrs) {
                            plan.attrs = { ...plan.attrs, ...reviewResult.planAttrs };
                        }
                        const approvalAction = normalizePlanApprovalAction({
                            classification: plan.attrs.classification,
                            action: reviewResult.approvalAction,
                        });
                        if (isEpicPlan(plan.attrs)) {
                            if (!validatePlanExecutionPolicyForReadiness(plan, uiAPI)) {
                                skipRouterRestore = true;
                                return;
                            }
                            await recordPlanEvent({
                                cwd: projectRoot,
                                planName: plan.planName,
                                event: "epic_readiness_passed",
                                currentStatus: "approved",
                                details: { triageMeta: plan.attrs },
                            });
                            plan.attrs.status = "ready_for_decomposition";
                            uiAPI.appendSystemMessage(
                                `PROJECT Epic ready for decomposition or child plan selection: ${plan.planName}`,
                                false,
                                "RunWield",
                            );
                            if (approvalAction === PLAN_APPROVAL_ACTIONS.DECOMPOSE) {
                                await runSlicerAgent({
                                    planName: plan.planName,
                                    triageMeta: plan.attrs,
                                    reviewFeedback: reviewResult.feedback,
                                    reviewImages: reviewResult.images,
                                });
                            } else {
                                uiAPI.appendSystemMessage(
                                    appendSessionCompleteGuidance(
                                        `Plan saved. Resume later with: ${CLI_BIN} load-plan ${plan.planName}`,
                                    ),
                                    false,
                                    "RunWield",
                                );
                            }
                            skipRouterRestore = true;
                            return;
                        }

                        const ready = await prepareApprovedPlanForWork(
                            projectRoot,
                            plan,
                            uiAPI,
                        );
                        if (!ready) {
                            skipRouterRestore = true;
                            return;
                        }
                        if (approvalAction === PLAN_APPROVAL_ACTIONS.RUN) {
                            const confirmed = await confirmAffectedPathChangesBeforeExecution({
                                projectRoot,
                                planName: plan.planName,
                                triageMeta: plan.attrs,
                                uiAPI,
                            });
                            if (!confirmed) return;

                            const execRes = await executePlan({
                                planName: plan.planName,
                                triageMeta: plan.attrs,
                                reviewFeedback: reviewResult.feedback,
                                reviewImages: reviewResult.images,
                            });
                            const policy = resolvePlanExecutionPolicy(plan.attrs);
                            const executionDecision = decidePostExecution(execRes, {
                                planName: plan.planName,
                                triageMeta: plan.attrs,
                                executionAgentName: policy.ok ? policy.policy.executionAgent : agentName,
                            });
                            await validatePostExecutionDecision({
                                executionDecision,
                                executionResult: execRes,
                                fallbackPlanContent: plan.markdown || plan.body || "",
                                continueWorkflowValidation,
                                session,
                                uiAPI,
                            });
                        } else {
                            uiAPI.appendSystemMessage(
                                appendSessionCompleteGuidance(
                                    `Plan saved. Resume later with: ${CLI_BIN} load-plan ${plan.planName}`,
                                ),
                                false,
                                "RunWield",
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
                        images: reviewResult.images,
                        planName: plan.planName,
                    });

                    const planningDecision = decidePostPlanning(outcome, {
                        planningAgentName: agentName,
                        fallbackTriageMeta: plan.attrs,
                    });
                    await executePostPlanningDecision({
                        decision: planningDecision,
                        fallbackPlanContent: plan.markdown || plan.body || "",
                        uiAPI,
                        executePlan,
                        continueWorkflowValidation,
                        runSlicerAgent,
                        session,
                    });
                    if (shouldKeepPlanningAgentActive(planningDecision)) {
                        skipRouterRestore = true;
                    }
                    return;
                }

                if (answer === "view") {
                    uiAPI.appendSystemMessage(buildPlanSummary(plan), false, "Plan");
                }
            }
        }

        // Not approved — show a first-action menu before kicking off the planning agent.
        if (!forceReview) {
            while (true) {
                const answer = await uiAPI.promptSelect("What would you like to do?", [
                    { value: "resume", label: "Resume planning" },
                    ...(isUserVerifiableStatus(plan.attrs.status)
                        ? [{
                            value: "user_verify",
                            label: "Mark as User Verified (user attestation; no Workflow Validation claim)",
                        }]
                        : []),
                    ...(isHoldableStatus(plan.attrs.status) ? [{ value: "hold", label: "Put on hold" }] : []),
                    { value: "view", label: "View plan details" },
                    { value: "cancel", label: "Cancel" },
                ]);
                if (!answer || answer === "cancel") return;
                if (answer === "view") {
                    uiAPI.appendSystemMessage(buildPlanSummary(plan), false, "Plan");
                    continue;
                }
                if (answer === "hold") {
                    await putPlanOnHold({ projectRoot, plan, uiAPI });
                    return;
                }
                if (answer === "user_verify") {
                    await markPlanUserVerified({
                        projectRoot,
                        plan,
                        uiAPI,
                    });
                    return;
                }
                if (answer === "resume") break;
            }
        }

        uiAPI.appendSystemMessage(buildPlanSummary(plan), false, "Plan");
        restoreAgentName = planFlowRestoreAgent;
        await switchPlanAgent(agentName);

        const outcome = await runPlanningAgent({
            agentName,
            initialRequest: buildResumeRequest(plan.planName, plan.attrs),
            triageMeta: plan.attrs,
            planName: plan.planName,
        });

        const planningDecision = decidePostPlanning(outcome, {
            planningAgentName: agentName,
            fallbackTriageMeta: plan.attrs,
        });
        await executePostPlanningDecision({
            decision: planningDecision,
            fallbackPlanContent: plan.markdown || plan.body || "",
            uiAPI,
            executePlan,
            continueWorkflowValidation,
            runSlicerAgent,
            session,
        });
        if (shouldKeepPlanningAgentActive(planningDecision)) {
            skipRouterRestore = true;
        }
    } catch (error) {
        if (!isManagedUnsupportedError(error)) throw error;
        uiAPI.appendSystemMessage(buildManagedUnsupportedLoadPlanMessage(loadedPlanName), true, "RunWield");
    } finally {
        if (!skipRouterRestore && sessionRuntime.getSessionSnapshot(session.id)) {
            await restorePreviousAgentFlow(uiAPI, restoreAgentName, session);
        }
    }
}
